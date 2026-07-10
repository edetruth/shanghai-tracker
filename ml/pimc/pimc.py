"""
PIMC (Perfect Information Monte Carlo) agent for Shanghai Rummy.

At each decision point the agent:
  1. Samples N opponent-hand configurations from the unseen card pool
     (determinizations).
  2. Simulates the remaining game forward under each configuration using
     the fast greedy rollout in engine.py.
  3. Picks the action with the best (lowest) expected score.

MVP scope:
  - Discard decision: which card to discard from hand?
  - Draw decision:    take top discard vs draw from pile?

Parallelism:
  Set n_workers > 1 on PIMCAgent to evaluate discard candidates
  concurrently across CPU cores.  On a 4-core machine this gives
  ~3-4x speedup for discard decisions and ~2x for draw decisions.
  Default is n_workers=1 (serial) for backward compatibility.

  The module-level ProcessPoolExecutor is shared across all agents and
  created lazily on the first parallel call.  On Windows (spawn start
  method) worker processes import pimc.py fresh but never call
  _get_pool(), so there is no recursive pool creation.
"""

import os
import random
from concurrent.futures import ProcessPoolExecutor
from typing import Optional

from engine import (
    play_game,
    play_round,
    find_meld_assignment,
    _lay_off_greedy,
    _build_table_melds,
    hand_points,
    ROUND_REQS,
    CARDS_DEALT,
    JOKER_INT,
    DECK_COUNT,
)

# Single-round rollout is ~7x faster than full-game rollout and gives
# equivalent EV signal for the current discard decision.
_SINGLE_ROUND_ROLLOUT = True
from card_tracker import CardTracker


# ─────────────────────────────────────────────────────────────────
# Module-level process pool (shared, lazily created)
# ─────────────────────────────────────────────────────────────────

_pool: Optional[ProcessPoolExecutor] = None
_pool_n_workers: int = 0


def _get_pool(n_workers: int) -> ProcessPoolExecutor:
    """Return the shared ProcessPoolExecutor, (re)creating if size changed."""
    global _pool, _pool_n_workers
    if _pool is None or _pool_n_workers != n_workers:
        if _pool is not None:
            _pool.shutdown(wait=False)
        _pool = ProcessPoolExecutor(max_workers=n_workers)
        _pool_n_workers = n_workers
    return _pool


# ─────────────────────────────────────────────────────────────────
# Top-level worker function — must be picklable (no instance methods)
# ─────────────────────────────────────────────────────────────────

def _eval_candidate_mp(args: tuple) -> float:
    """
    Evaluate one candidate hand via N single-round rollouts.

    Top-level function so multiprocessing can pickle it.
    Each worker does its own imports — no shared state with the parent.

    Args packed as a tuple (all plain Python types):
        hyp_hand    : list[int]  hand after the hypothetical action
        opp_sizes   : list[int]  estimated cards held by each opponent
        n_rollouts  : int
        round_idx   : int        0-indexed current round
        n_players   : int
        deck_count  : int
        unseen_pool : list[int]  snapshot of CardTracker.unseen_pool()
        player_idx  : int
        seed        : int        per-worker RNG seed

    Returns mean score for player_idx (lower is better).
    """
    (hyp_hand, opp_sizes, n_rollouts, round_idx, n_players,
     deck_count, unseen_pool, player_idx, seed) = args

    # Ensure engine.py is importable in worker processes on all platforms.
    # On Windows (spawn), workers get a copy of parent sys.path, but this
    # guard makes it explicit and robust when CWD differs.
    import sys as _sys
    import os as _os
    _here = _os.path.dirname(_os.path.abspath(__file__))
    if _here not in _sys.path:
        _sys.path.insert(0, _here)

    import random as _random
    from engine import play_round as _play_round

    rng = _random.Random(seed)
    total = 0.0

    for _ in range(n_rollouts):
        pool = list(unseen_pool)   # copy — shuffle is in-place
        rng.shuffle(pool)

        opp_hands: list = []
        idx = 0
        for sz in opp_sizes:
            opp_hands.append(pool[idx: idx + sz])
            idx += sz

        initial_hands: list = []
        opp_iter = iter(opp_hands)
        for seat in range(n_players):
            if seat == player_idx:
                initial_hands.append(hyp_hand)
            else:
                initial_hands.append(next(opp_iter, []))

        round_scores = _play_round(round_idx, n_players, rng, deck_count, initial_hands)
        total += round_scores[player_idx]

    return total / n_rollouts


class PIMCAgent:
    """
    PIMC agent that wraps a CardTracker and uses rollout simulation to choose
    the best discard and draw actions.

    Usage (per round):
        agent = PIMCAgent(player_idx=0, n_players=4, round_idx=ri, n_workers=4)
        agent.see_hand(my_initial_hand)

        # At draw decision time:
        action = agent.choose_draw(my_hand, discard_top, n_rollouts=20)
        # action is 'take' or 'draw'

        # If you took discard, see it:
        if action == 'take':
            agent.see(discard_top)

        # At discard decision time:
        discard_card = agent.choose_discard(my_hand, n_rollouts=20)

        # Record the discard (it's now visible to opponents):
        agent.see(discard_card)
    """

    def __init__(
        self,
        player_idx: int,
        n_players: int,
        round_idx: int,
        cumulative_scores: Optional[list] = None,
        deck_count: int = DECK_COUNT,
        seed: Optional[int] = None,
        n_workers: int = 1,
    ):
        self.player_idx = player_idx
        self.n_players = n_players
        self.round_idx = round_idx
        self.deck_count = deck_count
        # Scores accumulated before this round (for future-round rollouts)
        self.cumulative_scores = list(cumulative_scores) if cumulative_scores else [0] * n_players
        self.tracker = CardTracker(deck_count)
        self._rng = random.Random(seed)
        self._n_workers = n_workers   # >1 enables parallel candidate evaluation
        # Set after every choose_discard / choose_draw call — read by data collector
        self.last_candidates: list = []
        self.last_evs: list = []

    def see(self, card_int: int) -> None:
        """Record one observed card (own draw, discard top, opponent meld card)."""
        self.tracker.see(card_int)

    def see_hand(self, hand: list) -> None:
        """Record all cards in own initial hand."""
        self.tracker.see_many(hand)

    # ─────────────────────────────────────────────────────────────
    # Opponent hand size estimation
    # ─────────────────────────────────────────────────────────────

    def _estimate_hand_sizes(self, my_hand: list, my_has_laid_down: bool) -> list:
        """
        Rough estimate of each opponent's hand size.
        Uses CARDS_DEALT as a baseline; a production agent would track
        buys and discards per player.
        """
        # Conservative: assume opponents all have the standard dealt count
        return [CARDS_DEALT[self.round_idx]] * (self.n_players - 1)

    # ─────────────────────────────────────────────────────────────
    # Discard decision
    # ─────────────────────────────────────────────────────────────

    def choose_discard(
        self,
        my_hand: list,
        n_rollouts: int = 20,
        my_has_laid_down: bool = False,
    ) -> int:
        """
        Return the card from my_hand that minimises expected future score.

        Uses PIMC: for each candidate discard, run n_rollouts determinized
        games and average the resulting score for this player.

        When self._n_workers > 1, candidates are evaluated concurrently via
        a shared ProcessPoolExecutor.

        Args:
            my_hand:          Current hand (list of card ints).
            n_rollouts:       Number of opponent-hand samples per candidate.
            my_has_laid_down: Whether this player has already gone down.

        Returns:
            The card int to discard.
        """
        if len(my_hand) == 0:
            raise ValueError("Cannot choose discard from empty hand")
        if len(my_hand) == 1:
            self.last_candidates = [my_hand[0]]
            self.last_evs = [0.0]
            return my_hand[0]

        # Never discard a joker (always the worst choice)
        candidates = [c for c in my_hand if c < JOKER_INT]
        if not candidates:
            self.last_candidates = [my_hand[0]]
            self.last_evs = [0.0]
            return my_hand[0]   # only jokers — forced

        # Prune: only evaluate the top-N highest-point candidates.
        # The best discard is almost never a low-point card that completes a
        # meld — only high-deadwood singletons are real candidates.
        # Limiting to 5 cuts rollout count by ~50% with negligible quality loss.
        _MAX_CANDIDATES = 5
        if len(candidates) > _MAX_CANDIDATES:
            from engine import _POINTS_LUT
            candidates = sorted(
                candidates, key=lambda c: _POINTS_LUT[c], reverse=True
            )[:_MAX_CANDIDATES]

        opp_sizes = self._estimate_hand_sizes(my_hand, my_has_laid_down)

        # Build (card, hypothetical-hand) pairs — remove exactly one copy
        candidate_hands: list = []
        for discard_c in candidates:
            hyp_hand = [c for c in my_hand if c != discard_c]
            if len(hyp_hand) == len(my_hand):
                # Multiple copies — remove exactly one
                hyp_hand = list(my_hand)
                hyp_hand.remove(discard_c)
            candidate_hands.append((discard_c, hyp_hand))

        if self._n_workers > 1 and len(candidates) > 1:
            # Parallel path: all candidates evaluated concurrently
            unseen = self.tracker.unseen_pool()
            mp_args = [
                (hyp_hand, opp_sizes, n_rollouts, self.round_idx,
                 self.n_players, self.deck_count, unseen, self.player_idx,
                 self._rng.randint(0, 2 ** 31))
                for _, hyp_hand in candidate_hands
            ]
            evs = list(_get_pool(self._n_workers).map(_eval_candidate_mp, mp_args))
        else:
            # Serial path
            evs = [
                self._rollout_ev(hyp_hand, opp_sizes, n_rollouts)
                for _, hyp_hand in candidate_hands
            ]

        best_idx = evs.index(min(evs))
        self.last_candidates = [card for card, _ in candidate_hands]
        self.last_evs = list(evs)
        return candidate_hands[best_idx][0]

    # ─────────────────────────────────────────────────────────────
    # Draw decision
    # ─────────────────────────────────────────────────────────────

    def choose_draw(
        self,
        my_hand: list,
        discard_top: int,
        n_rollouts: int = 20,
        my_has_laid_down: bool = False,
    ) -> str:
        """
        Decide whether to take the top discard card or draw from the pile.

        Returns 'take' or 'draw'.
        When self._n_workers > 1, both options are evaluated concurrently.
        """
        if discard_top < 0:
            self.last_candidates = ["draw"]
            self.last_evs = [0.0]
            return "draw"   # no discard available

        opp_sizes = self._estimate_hand_sizes(my_hand, my_has_laid_down)
        hand_take = list(my_hand) + [discard_top]

        if self._n_workers > 1:
            # Parallel path: take vs draw evaluated concurrently (2 workers)
            unseen = self.tracker.unseen_pool()
            mp_args = [
                (hand_take, opp_sizes, n_rollouts, self.round_idx,
                 self.n_players, self.deck_count, unseen, self.player_idx,
                 self._rng.randint(0, 2 ** 31)),
                (my_hand,   opp_sizes, n_rollouts, self.round_idx,
                 self.n_players, self.deck_count, unseen, self.player_idx,
                 self._rng.randint(0, 2 ** 31)),
            ]
            ev_take, ev_draw = _get_pool(self._n_workers).map(_eval_candidate_mp, mp_args)
        else:
            # Option A: take the discard
            ev_take = self._rollout_ev(hand_take, opp_sizes, n_rollouts)
            # Option B: draw from pile (approximate: hand stays as-is)
            ev_draw = self._rollout_ev(my_hand, opp_sizes, n_rollouts)

        self.last_candidates = ["take", "draw"]
        self.last_evs = [ev_take, ev_draw]
        return "take" if ev_take < ev_draw else "draw"

    # ─────────────────────────────────────────────────────────────
    # PIMC rollout core (serial path)
    # ─────────────────────────────────────────────────────────────

    def _rollout_ev(
        self,
        my_hand: list,
        opp_sizes: list,
        n_rollouts: int,
    ) -> float:
        """
        Estimate expected score for this player given the current hand.

        For each of n_rollouts determinizations:
          - Sample opponent hands from unseen pool.
          - Build initial_hands = [my_hand, opp_hand_1, ..., opp_hand_n-1].
          - Simulate play_game from current round onwards.
          - Record this player's score.

        Returns the mean score across rollouts (lower = better).
        """
        rng = self._rng
        tracker = self.tracker
        player_idx = self.player_idx
        round_idx = self.round_idx
        n_players = self.n_players
        deck_count = self.deck_count
        cum = self.cumulative_scores

        total = 0.0
        for _ in range(n_rollouts):
            # Sample opponent hands from unseen pool
            opp_hands = tracker.sample_opponent_hands(opp_sizes, rng)

            # Build full hand list in seat order
            initial_hands = []
            opp_iter = iter(opp_hands)
            for seat in range(n_players):
                if seat == player_idx:
                    initial_hands.append(my_hand)
                else:
                    initial_hands.append(next(opp_iter, []))

            if _SINGLE_ROUND_ROLLOUT:
                # Simulate only the current round — ~7× faster than full-game.
                # EV signal for the current discard is equivalent: we care about
                # which discard minimises this round's deadwood, not multi-round
                # cumulative score. The relative ordering between candidates is
                # the same either way.
                round_scores = play_round(
                    round_idx, n_players, rng, deck_count, initial_hands
                )
                total += round_scores[player_idx]
            else:
                scores = play_game(
                    n_players,
                    rng,
                    deck_count,
                    starting_round=round_idx,
                    initial_scores=cum,
                    initial_hands=initial_hands,
                )
                total += scores[player_idx]

        return total / n_rollouts


# ─────────────────────────────────────────────────────────────────
# Quick smoke test
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time

    print("PIMC smoke test — R1, 4 players, player_idx=0")

    C = lambda s, r: s * 16 + r
    J = JOKER_INT

    # Player 0's initial hand for R1: has a pair of 7s and pair of 9s (needs sets)
    my_hand = [
        C(0, 7), C(1, 7),   # pair of 7s — one joker away from set
        C(0, 9), C(1, 9),   # pair of 9s
        J,                   # joker — helps complete a set
        C(0, 2), C(1, 3), C(2, 4), C(3, 5), C(0, 6),  # deadwood
    ]

    agent = PIMCAgent(player_idx=0, n_players=4, round_idx=0, seed=42)
    agent.see_hand(my_hand)

    print(f"  Hand ({len(my_hand)} cards, {hand_points(my_hand)} pts): {my_hand}")
    print(f"  Tracker: {agent.tracker}")

    from engine import rank_of, suit_of
    rank_names = {1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',
                  8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K'}
    suit_names = {0:'c',1:'d',2:'h',3:'s'}

    def _card_str(c: int) -> str:
        if c >= J:
            return "Joker"
        return rank_names.get(rank_of(c), '?') + suit_names.get(suit_of(c), '?')

    # ── Serial path ───────────────────────────────────────────────
    print("\n--- Serial (n_workers=1) ---")
    t0 = time.perf_counter()
    best_s = agent.choose_discard(my_hand, n_rollouts=10)
    t_serial = time.perf_counter() - t0
    print(f"  Best discard: {_card_str(best_s)}  [{t_serial:.2f}s for 10 rollouts]")

    # ── Parallel path ─────────────────────────────────────────────
    n_cpu = os.cpu_count() or 1
    print(f"\n--- Parallel (n_workers={n_cpu}) ---")
    agent_p = PIMCAgent(player_idx=0, n_players=4, round_idx=0, seed=42, n_workers=n_cpu)
    agent_p.see_hand(my_hand)
    t0 = time.perf_counter()
    best_p = agent_p.choose_discard(my_hand, n_rollouts=10)
    t_par = time.perf_counter() - t0
    speedup = t_serial / t_par if t_par > 0 else 0.0
    print(f"  Best discard: {_card_str(best_p)}  [{t_par:.2f}s for 10 rollouts]")
    print(f"  Speedup vs serial: {speedup:.1f}x  (workers={n_cpu}, candidates<=5)")

    # ── Draw decision ─────────────────────────────────────────────
    discard_top = C(2, 9)   # 9 of hearts — matches pair of 9s
    agent2 = PIMCAgent(player_idx=0, n_players=4, round_idx=0, seed=99)
    agent2.see_hand(my_hand)
    action = agent2.choose_draw(my_hand, discard_top, n_rollouts=10)
    print(f"\n  Draw decision (top discard=9h): {action}  (expect 'take')")

    # ── Speed comparison (serial vs parallel) ─────────────────────
    print()
    reps = 5
    for n_r in [5, 10, 20]:
        # Serial
        ag_s = PIMCAgent(player_idx=0, n_players=4, round_idx=0, seed=0)
        ag_s.see_hand(my_hand)
        t0 = time.perf_counter()
        for _ in range(reps):
            ag_s.choose_discard(my_hand, n_rollouts=n_r)
        t_s = (time.perf_counter() - t0) / reps

        # Parallel
        ag_p = PIMCAgent(player_idx=0, n_players=4, round_idx=0, seed=0, n_workers=n_cpu)
        ag_p.see_hand(my_hand)
        t0 = time.perf_counter()
        for _ in range(reps):
            ag_p.choose_discard(my_hand, n_rollouts=n_r)
        t_p = (time.perf_counter() - t0) / reps

        sx = t_s / t_p if t_p > 0 else 0.0
        print(f"  rollouts={n_r:2d}:  serial={t_s:.3f}s  parallel={t_p:.3f}s  ({sx:.1f}x speedup)")
