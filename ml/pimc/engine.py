"""
Fast pure-Python Shanghai Rummy simulation for PIMC rollouts.

Card encoding: integers  card = suit * 16 + rank
  suit:  0=clubs  1=diamonds  2=hearts  3=spades  4=joker
  rank:  0=joker  1=Ace  2-10  11=Jack  12=Queen  13=King
  Joker: 4*16 + 0 = 64

Integer encoding lets us extract suit/rank with bit-ops (c>>4, c&15)
instead of tuple unpacking, which halves inner-loop overhead.

Rules (mirrors meld-validator.ts and rules.ts):
  - 2 decks (108 cards) for <= 4 players
  - Rounds 1-4: 10 cards dealt; Rounds 5-7: 12 cards
  - 7 rounds; lowest cumulative score wins
  - Min set: 3 same rank; min run: 4 same suit consecutive
  - Aces: low (A=1) or high (A=14) in runs; no wrap
  - Going out: hand must reach zero via meld+layoff (cant discard last card)
  - Jokers worth 25 pts; fill gaps in sets/runs

Rollout simplifications (intentional -- speed over perfection):
  - No buying (all players draw from pile)
  - Greedy go-down: go down immediately when requirement met
  - Greedy layoff: lay off all possible cards immediately after going down
  - Greedy discard: discard highest-point card (never discard last card)
  - No joker swaps
  - No Free Take priority rule

Target: >= 100 games/second single-threaded.
"""

import random
from typing import Optional

# ─────────────────────────────────────────────────────────────
# Card encoding and constants
# ─────────────────────────────────────────────────────────────

CLUBS, DIAMONDS, HEARTS, SPADES, JOKER = 0, 1, 2, 3, 4

# card_int = suit * 16 + rank; joker = 64
JOKER_INT: int = 64

# Round requirements: (req_sets, req_runs) for rounds 0-6
ROUND_REQS: list = [
    (2, 0), (1, 1), (0, 2), (3, 0),
    (2, 1), (1, 2), (0, 3),
]

CARDS_DEALT: list = [10, 10, 10, 10, 12, 12, 12]
MAX_TURNS_PER_ROUND = 30   # outer orbits (×n_players player-turns total per round)
MAX_BUYS_PER_ROUND  = 5   # per player per round (mirrors rules.ts MAX_BUYS)
DECK_COUNT = 2   # 2 decks for <= 4 players

# Pre-computed single deck of card ints (copied per game, not reallocated)
_SINGLE_DECK_INT: list = (
    [s * 16 + r for s in range(4) for r in range(1, 14)]
    + [JOKER_INT, JOKER_INT]      # 2 jokers per deck
)

# Pre-computed point lookup by card_int (index 0..80)
_POINTS_LUT: list = [0] * 80
for _s in range(4):
    for _r in range(1, 14):
        _pts = 25 if _r == 0 else (15 if _r == 1 else (10 if _r >= 10 else 5))
        _POINTS_LUT[_s * 16 + _r] = _pts
_POINTS_LUT[JOKER_INT] = 25

# Public helper functions (used by pimc.py and tests)

def card_int(suit: int, rank: int) -> int:
    return suit * 16 + rank

def suit_of(c: int) -> int:
    return c >> 4

def rank_of(c: int) -> int:
    return c & 15

def is_joker(c: int) -> bool:
    return c >= JOKER_INT

def card_points(c: int) -> int:
    return _POINTS_LUT[c]

def hand_points(hand: list) -> int:
    lut = _POINTS_LUT
    return sum(lut[c] for c in hand)

def make_deck(deck_count: int = DECK_COUNT) -> list:
    """Return a fresh (unshuffled) deck of card ints."""
    return list(_SINGLE_DECK_INT * deck_count)

# Convenience: convert (suit, rank) tuple to card int (for tests / bridge interop)
def from_tuple(suit: int, rank: int) -> int:
    return suit * 16 + rank

def to_tuple(c: int) -> tuple:
    return (c >> 4, c & 15)


# ─────────────────────────────────────────────────────────────
# Meld validation (mirrors meld-validator.ts)
# ─────────────────────────────────────────────────────────────

def is_valid_set(cards: list) -> bool:
    """3+ same rank; jokers substitute; all-joker set valid."""
    if len(cards) < 3:
        return False
    rank = -1
    for c in cards:
        if c < JOKER_INT:           # non-joker
            r = c & 15
            if rank == -1:
                rank = r
            elif r != rank:
                return False
    return True   # all naturals share rank (or all-joker)


def _can_form_run(sorted_ranks: list, jokers: int) -> bool:
    if not sorted_ranks:
        return jokers >= 4
    span = sorted_ranks[-1] - sorted_ranks[0] + 1
    gaps = span - len(sorted_ranks)
    return gaps <= jokers and len(sorted_ranks) + jokers >= 4


def is_valid_run(cards: list) -> bool:
    """4+ same suit consecutive; ace low or high; all-joker run valid."""
    n = len(cards)
    if n < 4:
        return False
    suit = -1
    ranks = []
    joker_count = 0
    for c in cards:
        if c >= JOKER_INT:
            joker_count += 1
        else:
            s, r = c >> 4, c & 15
            if suit == -1:
                suit = s
            elif s != suit:
                return False
            ranks.append(r)
    if not ranks:
        return True           # all-joker run
    ranks.sort()
    if len(set(ranks)) != len(ranks):
        return False          # duplicate ranks
    if _can_form_run(ranks, joker_count):
        return True
    if 1 in ranks:            # try ace-high
        hi = sorted(14 if r == 1 else r for r in ranks)
        return _can_form_run(hi, joker_count)
    return False


# ─────────────────────────────────────────────────────────────
# Meld finding -- greedy, index-tracked (handles multi-deck duplicates)
# ─────────────────────────────────────────────────────────────

def _find_set_indices(
    hand: list, non_joker_idx: list, jokers_avail: int, req: int
) -> tuple:
    """Greedily find req sets. Returns (groups, jokers_used) or (None, 0)."""
    if req == 0:
        return [], 0

    # Group non-joker indices by rank (rank = c & 15)
    by_rank: dict = {}
    for idx in non_joker_idx:
        r = hand[idx] & 15
        if r in by_rank:
            by_rank[r].append(idx)
        else:
            by_rank[r] = [idx]

    # Sort groups: largest first (need fewest jokers)
    groups = sorted(by_rank.values(), key=lambda g: -len(g))

    found = []
    jokers_used = 0

    for g in groups:
        if len(found) == req:
            break
        sz = len(g)
        if sz >= 3:
            found.append(g[:3])
        elif sz == 2 and jokers_used + 1 <= jokers_avail:
            found.append(g[:2])
            jokers_used += 1
        elif sz == 1 and jokers_used + 2 <= jokers_avail:
            found.append(g[:1])
            jokers_used += 2

    if len(found) < req:
        return None, 0
    return found, jokers_used


def _find_run_indices(
    hand: list, non_joker_idx: list, jokers_avail: int, req: int
) -> tuple:
    """Greedily find req runs. Returns (groups, jokers_used) or (None, 0)."""
    if req == 0:
        return [], 0

    # Build per-suit (rank, idx) lists -- deduplicate by rank using bitmask
    # bitmask[s] bit r is set if rank r was seen in suit s
    suit_items: list = [[], [], [], []]   # [(rank, idx), ...]
    suit_mask:  list = [0, 0, 0, 0]      # bitmask per suit (replaces 4 sets)

    for idx in non_joker_idx:
        c = hand[idx]
        s = c >> 4
        r = c & 15
        bit = 1 << r
        mask = suit_mask[s]
        if not (mask & bit):
            suit_mask[s] = mask | bit
            suit_items[s].append((r, idx))

    # Sort each suit's items by rank (usually 0-4 items -- very fast)
    for s in range(4):
        si = suit_items[s]
        if len(si) > 1:
            si.sort()

    ja = jokers_avail       # local alias

    # ── Fast path: req == 1 (most common) ─────────────────────
    # Avoid building a candidates list; just track the best window.
    if req == 1:
        best_gaps = ja + 1
        best_nat  = 0
        best_idx  = None

        for suit in range(4):
            items = suit_items[suit]
            m = len(items)
            if not m:
                continue

            # Ace-low pass
            for i in range(m):
                gaps = 0
                for j in range(i, m):
                    if j > i:
                        gaps += items[j][0] - items[j-1][0] - 1
                        if gaps > ja:
                            break
                    n_nat = j - i + 1
                    if n_nat + ja >= 4:
                        if gaps < best_gaps or (gaps == best_gaps and n_nat > best_nat):
                            best_gaps = gaps
                            best_nat  = n_nat
                            best_idx  = [items[k][1] for k in range(i, j+1)]

            # Ace-high pass (only when ace is present)
            if items[0][0] == 1:
                hi = sorted((14 if r == 1 else r, idx) for r, idx in items)
                hm = len(hi)
                for i in range(hm):
                    gaps = 0
                    for j in range(i, hm):
                        if j > i:
                            gaps += hi[j][0] - hi[j-1][0] - 1
                            if gaps > ja:
                                break
                        n_nat = j - i + 1
                        if n_nat + ja >= 4:
                            if gaps < best_gaps or (gaps == best_gaps and n_nat > best_nat):
                                best_gaps = gaps
                                best_nat  = n_nat
                                best_idx  = [hi[k][1] for k in range(i, j+1)]

        if best_idx is None:
            return None, 0
        return [best_idx], best_gaps

    # ── General path: req >= 2 ─────────────────────────────────
    candidates = []

    for suit in range(4):
        items = suit_items[suit]
        m = len(items)
        if not m:
            continue

        for i in range(m):
            gaps = 0
            for j in range(i, m):
                if j > i:
                    gaps += items[j][0] - items[j-1][0] - 1
                    if gaps > ja:
                        break
                n_nat = j - i + 1
                if n_nat + ja >= 4:
                    candidates.append((gaps, -n_nat, [items[k][1] for k in range(i, j+1)]))

        if items[0][0] == 1:
            hi = sorted((14 if r == 1 else r, idx) for r, idx in items)
            hm = len(hi)
            for i in range(hm):
                gaps = 0
                for j in range(i, hm):
                    if j > i:
                        gaps += hi[j][0] - hi[j-1][0] - 1
                        if gaps > ja:
                            break
                    n_nat = j - i + 1
                    if n_nat + ja >= 4:
                        candidates.append((gaps, -n_nat, [hi[k][1] for k in range(i, j+1)]))

    candidates.sort(key=lambda x: (x[0], x[1]))

    found = []
    jokers_used = 0
    used_set: set = set()

    for gaps, _, indices in candidates:
        if len(found) == req:
            break
        if jokers_used + gaps > ja:
            continue
        # Early-exit overlap check (avoids generator overhead)
        overlap = False
        for idx in indices:
            if idx in used_set:
                overlap = True
                break
        if overlap:
            continue
        found.append(indices)
        jokers_used += gaps
        used_set.update(indices)

    if len(found) < req:
        return None, 0
    return found, jokers_used


def find_meld_assignment(
    hand: list, req_sets: int, req_runs: int
) -> Optional[tuple]:
    """
    Find a valid meld combination meeting (req_sets, req_runs).

    Returns (meld_indices, remaining_indices) or None.
    meld_indices includes joker positions allocated to melds.
    """
    n = len(hand)
    joker_idx = []
    non_joker_idx = []
    for i in range(n):
        if hand[i] >= JOKER_INT:
            joker_idx.append(i)
        else:
            non_joker_idx.append(i)
    n_jokers = len(joker_idx)

    for sets_first in (True, False):
        if sets_first:
            s_groups, s_j = _find_set_indices(hand, non_joker_idx, n_jokers, req_sets)
            if s_groups is None and req_sets:
                continue
            s_groups = s_groups or []; s_j = s_j or 0

            used_s = {idx for g in s_groups for idx in g}
            rem_nj = [i for i in non_joker_idx if i not in used_s]

            r_groups, r_j = _find_run_indices(hand, rem_nj, n_jokers - s_j, req_runs)
            if r_groups is None and req_runs:
                continue
            r_groups = r_groups or []; r_j = r_j or 0
        else:
            r_groups, r_j = _find_run_indices(hand, non_joker_idx, n_jokers, req_runs)
            if r_groups is None and req_runs:
                continue
            r_groups = r_groups or []; r_j = r_j or 0

            used_r = {idx for g in r_groups for idx in g}
            rem_nj = [i for i in non_joker_idx if i not in used_r]

            s_groups, s_j = _find_set_indices(hand, rem_nj, n_jokers - r_j, req_sets)
            if s_groups is None and req_sets:
                continue
            s_groups = s_groups or []; s_j = s_j or 0

        if len(s_groups) >= req_sets and len(r_groups) >= req_runs:
            total_j = s_j + r_j
            meld_idx = (
                [i for g in s_groups for i in g]
                + [i for g in r_groups for i in g]
                + joker_idx[:total_j]
            )
            meld_set = set(meld_idx)
            return meld_idx, [i for i in range(n) if i not in meld_set]

    return None


# ─────────────────────────────────────────────────────────────
# Table meld tracking (simplified, for layoff detection)
# ─────────────────────────────────────────────────────────────
# Each table meld is a small list: [type, ...fields]
#   Set:  [0, rank]               type=0
#   Run:  [1, suit, lo, hi]       type=1

def _make_set_meld(rank: int) -> list:
    return [0, rank]

def _make_run_meld(suit: int, lo: int, hi: int) -> list:
    return [1, suit, lo, hi]

def _can_lay_off(c: int, meld: list) -> bool:
    if meld[0] == 0:                   # set
        return c >= JOKER_INT or (c & 15) == meld[1]
    # run
    if c >= JOKER_INT:
        return meld[2] > 1 or meld[3] < 14
    if (c >> 4) != meld[1]:            # meld[1]=suit, meld[2]=lo, meld[3]=hi
        return False
    # meld = [1, suit, lo, hi]
    lo, hi = meld[2], meld[3]
    r = c & 15
    return r == lo - 1 or r == hi + 1 or (r == 1 and hi == 13)

def _extend_meld(c: int, meld: list) -> None:
    """Mutate meld in place after card c is laid off."""
    if meld[0] == 0:
        return          # sets don't change bounds
    lo, hi = meld[2], meld[3]
    if c >= JOKER_INT:
        if lo > 1:  meld[2] = lo - 1
        else:       meld[3] = hi + 1
    else:
        r = c & 15
        if r == 1 and hi == 13:
            meld[3] = 14            # ace-high extension
        elif r < lo:
            meld[2] = r
        elif r > hi:
            meld[3] = r


# ─────────────────────────────────────────────────────────────
# Lay-off helper
# ─────────────────────────────────────────────────────────────

def _lay_off_greedy(hand: list, table_melds: list) -> None:
    """
    Lay off as many cards from hand onto table_melds as possible.
    Modifies hand in place. Returns nothing.
    _can_lay_off and _extend_meld are inlined here to avoid 7M function calls.
    """
    JI = JOKER_INT
    changed = True
    while changed and hand:
        changed = False
        i = 0
        n = len(hand)
        while i < n:
            c = hand[i]
            laid = False
            for meld in table_melds:
                if meld[0] == 0:                        # ── set meld ──
                    if c >= JI or (c & 15) == meld[1]:
                        hand.pop(i)
                        n -= 1
                        laid = True
                        changed = True
                        break
                else:                                   # ── run meld ──
                    if c >= JI:                         # joker lay-off
                        lo, hi = meld[2], meld[3]
                        if lo > 1 or hi < 14:
                            if lo > 1:
                                meld[2] = lo - 1
                            else:
                                meld[3] = hi + 1
                            hand.pop(i)
                            n -= 1
                            laid = True
                            changed = True
                            break
                    elif (c >> 4) == meld[1]:           # same suit
                        r = c & 15
                        lo, hi = meld[2], meld[3]
                        if r == lo - 1:
                            meld[2] = r
                            hand.pop(i); n -= 1; laid = True; changed = True; break
                        elif r == hi + 1:
                            meld[3] = r
                            hand.pop(i); n -= 1; laid = True; changed = True; break
                        elif r == 1 and hi == 13:       # ace-high extension
                            meld[3] = 14
                            hand.pop(i); n -= 1; laid = True; changed = True; break
            if not laid:
                i += 1


# ─────────────────────────────────────────────────────────────
# Build table meld objects from allocated meld cards
# ─────────────────────────────────────────────────────────────

def _build_table_melds(meld_cards: list, req_sets: int, req_runs: int) -> list:
    """
    Reconstruct simplified set/run meld objects from the going-down cards.
    Called once per player per round when they go down.
    """
    melds = []

    # Re-run the greedy finder on the meld cards themselves to learn which are sets vs runs
    n = len(meld_cards)
    joker_idx_m = [i for i in range(n) if meld_cards[i] >= JOKER_INT]
    non_joker_m  = [i for i in range(n) if meld_cards[i] < JOKER_INT]
    nj = len(joker_idx_m)

    s_groups, s_j = _find_set_indices(meld_cards, non_joker_m, nj, req_sets)
    s_groups = s_groups or []
    used_s = {i for g in s_groups for i in g}
    rem_m   = [i for i in non_joker_m if i not in used_s]
    r_groups, _ = _find_run_indices(meld_cards, rem_m, nj - (s_j or 0), req_runs)
    r_groups = r_groups or []

    # Build SetMelds
    for g in s_groups:
        for idx in g:
            if meld_cards[idx] < JOKER_INT:
                melds.append(_make_set_meld(meld_cards[idx] & 15))
                break
        else:
            melds.append(_make_set_meld(0))   # all-joker set placeholder

    # Build RunMelds
    for g in r_groups:
        naturals = [meld_cards[i] for i in g if meld_cards[i] < JOKER_INT]
        if not naturals:
            continue
        suit = naturals[0] >> 4
        ranks = [c & 15 for c in naturals]
        ace_high = (1 in ranks and any(r >= 10 for r in ranks))
        if ace_high:
            ranks = [14 if r == 1 else r for r in ranks]
        melds.append(_make_run_meld(suit, min(ranks), max(ranks)))

    return melds


# ─────────────────────────────────────────────────────────────
# Round simulation
# ─────────────────────────────────────────────────────────────

def _draw_from_pile(draw_pile: list, discard_pile: list, rng: random.Random) -> bool:
    """Reshuffle discard into draw pile if needed. Returns False if truly stuck."""
    if draw_pile:
        return True
    if len(discard_pile) <= 1:
        return False
    top = discard_pile.pop()
    rng.shuffle(discard_pile)
    draw_pile += discard_pile   # mutate in-place so caller's reference stays valid
    del discard_pile[:]
    discard_pile.append(top)
    return bool(draw_pile)


def play_round(
    round_idx: int,
    n_players: int,
    rng: random.Random,
    deck_count: int = DECK_COUNT,
    initial_hands: Optional[list] = None,
    discard_hook=None,
    draw_hook=None,
    laydown_hook=None,
    buy_hook=None,
) -> list:
    """Simulate one complete round. Returns list of scores per player.

    Rollout policy:
      - Active player takes top discard if it matches a rank in hand (free take)
        OR continues a same-suit sequence already in hand.
      - Otherwise draws from the draw pile.
      - After each discard: player p+1 gets first free-take right; then players
        p+2..p+n-1 may BUY (take discard + penalty draw, costs 1 of 5 buys).
      - Greedy go-down: lay down as soon as requirement is met.
      - Greedy discard: prefer high-value singleton-rank cards; never discard jokers.
    """
    req_sets, req_runs = ROUND_REQS[round_idx]
    cards_dealt = CARDS_DEALT[round_idx]
    lut = _POINTS_LUT          # local alias: eliminates global lookup in inner loop
    JI  = JOKER_INT

    # ── Deal (or use pre-specified hands for PIMC rollouts) ──────
    deck = make_deck(deck_count)

    if initial_hands is not None:
        # PIMC mode: use provided hands; build draw pile from remaining deck cards.
        hands = [list(h) for h in initial_hands]
        hand_cnt: dict = {}
        for h in hands:
            for c in h:
                hand_cnt[c] = hand_cnt.get(c, 0) + 1
        draw_pile = []
        for c in deck:
            cnt = hand_cnt.get(c, 0)
            if cnt > 0:
                hand_cnt[c] = cnt - 1
            else:
                draw_pile.append(c)
    else:
        rng.shuffle(deck)
        hands = [[] for _ in range(n_players)]
        pos = 0
        for _ in range(cards_dealt):
            for p in range(n_players):
                hands[p].append(deck[pos])
                pos += 1
        draw_pile = deck[pos:]

    rng.shuffle(draw_pile)
    discard_pile: list = [draw_pile.pop()]

    has_laid_down   = [False] * n_players
    buys_remaining  = [MAX_BUYS_PER_ROUND] * n_players
    # pre_drew[p]=True if p already received a card via free-take in the buying window
    pre_drew        = [False] * n_players
    table_melds: list = []
    winner: int = -1

    # ── Turn loop ─────────────────────────────────────────────
    for _turn in range(MAX_TURNS_PER_ROUND):
        if winner >= 0:
            break

        for p in range(n_players):
            if winner >= 0:
                break

            hand = hands[p]

            # ── Draw (or use pre-received free-take card) ─────
            if pre_drew[p]:
                pre_drew[p] = False          # already have the extra card
            else:
                took = False
                if discard_pile:
                    dc = discard_pile[-1]
                    if dc < JI:
                        dr, ds = dc & 15, dc >> 4
                        if has_laid_down[p]:
                            # Post-laydown: take discard only if it can be laid off immediately
                            if _can_lay_off(dc, table_melds[0]) if len(table_melds) == 1 else any(_can_lay_off(dc, m) for m in table_melds):
                                hand.append(discard_pile.pop())
                                took = True
                        else:
                            # Pre-laydown: take discard if it helps build a set or run
                            rm = sm = 0
                            for hc in hand:
                                if hc < JI:
                                    if (hc & 15) == dr:
                                        rm += 1
                                    elif (hc >> 4) == ds and abs((hc & 15) - dr) <= 2:
                                        sm += 1
                            if rm >= 1 or sm >= 2:
                                hand.append(discard_pile.pop())
                                took = True
                if not took:
                    if not _draw_from_pile(draw_pile, discard_pile, rng):
                        break               # truly stuck
                    hand.append(draw_pile.pop())

            # ── Try to go down ────────────────────────────────
            if not has_laid_down[p]:
                assignment = find_meld_assignment(hand, req_sets, req_runs)
                if assignment is not None:
                    should_down = True
                    if laydown_hook is not None:
                        decision = laydown_hook(p, hand, assignment, round_idx, has_laid_down)
                        if decision is False:
                            should_down = False
                    if should_down:
                        meld_idx, rem_idx = assignment
                        meld_cards = [hand[i] for i in meld_idx]
                        hands[p] = [hand[i] for i in rem_idx]
                        hand = hands[p]
                        has_laid_down[p] = True

                        new_melds = _build_table_melds(meld_cards, req_sets, req_runs)
                        table_melds.extend(new_melds)

                        if table_melds and hand:
                            _lay_off_greedy(hand, table_melds)

                        if not hand:
                            winner = p
                            break

            # ── Lay off if already down ───────────────────────
            elif table_melds and hand:
                _lay_off_greedy(hand, table_melds)
                if not hand:
                    winner = p
                    break

            # ── Discard ───────────────────────────────────────
            if winner >= 0 or not hand:
                continue

            h_len = len(hand)
            if h_len == 1 and has_laid_down[p]:
                # Can't discard last card; attempt final lay-off
                c = hand[0]
                for meld in table_melds:
                    if _can_lay_off(c, meld):
                        _extend_meld(c, meld)
                        hand.clear()
                        winner = p
                        break
                # If still stuck, fall through and draw next turn (hand stays at 1)
                continue

            # Prefer discarding a high-value singleton-rank card (preserves sets)
            rank_cnt: dict = {}
            for c in hand:
                if c < JI:
                    r = c & 15
                    rank_cnt[r] = rank_cnt.get(r, 0) + 1
            best_i  = -1
            best_pts = -1
            for i in range(h_len):
                c = hand[i]
                if c >= JI:
                    continue
                r = c & 15
                if rank_cnt[r] == 1:
                    pts = lut[c]
                    if pts > best_pts:
                        best_pts = pts
                        best_i = i
            if best_i == -1:
                for i in range(h_len):
                    c = hand[i]
                    if c < JI:
                        pts = lut[c]
                        if pts > best_pts:
                            best_pts = pts
                            best_i = i
            if best_i == -1:
                best_i = 0

            # ── Discard hook (for PIMC agent) ─────────────────
            # If provided, overrides the greedy choice for player p.
            if discard_hook is not None:
                hook_card = discard_hook(p, hand, has_laid_down[p], table_melds, round_idx)
                if hook_card is not None:
                    try:
                        best_i = hand.index(hook_card)
                    except ValueError:
                        pass  # fallback to greedy if hook returns invalid card

            discard_pile.append(hand.pop(best_i))

            # ── Buying window after discard ───────────────────
            # Rule 9A: player p+1 gets first right as FREE TAKE (no buy cost).
            # If p+1 declines, players p+2..p+n-1 may BUY (penalty draw + 1 buy used).
            if winner >= 0 or not discard_pile:
                continue
            dc = discard_pile[-1]
            if dc >= JI:
                continue            # jokers in discard: skip buying window
            dr = dc & 15
            claimed = False

            # Check p+1 for free take
            p1 = (p + 1) % n_players
            if not has_laid_down[p1] and not pre_drew[p1]:
                h1 = hands[p1]
                if draw_hook is not None:
                    # Ask hook; None return means use greedy heuristic
                    hook_decision = draw_hook(p1, h1, dc, has_laid_down[p1], round_idx)
                    if hook_decision is not None:
                        take_it = hook_decision == "take"
                    else:
                        rm = sum(1 for hc in h1 if hc < JI and (hc & 15) == dr)
                        take_it = rm >= 1
                else:
                    rm = sum(1 for hc in h1 if hc < JI and (hc & 15) == dr)
                    take_it = rm >= 1
                if take_it:
                    h1.append(discard_pile.pop())
                    pre_drew[p1] = True
                    claimed = True

            # If still unclaimed, check p+2 .. p+n-1 for buying
            if not claimed:
                for off in range(2, n_players):
                    buyer = (p + off) % n_players
                    if buys_remaining[buyer] <= 0 or has_laid_down[buyer]:
                        continue
                    hb = hands[buyer]
                    rm = 0
                    for hc in hb:
                        if hc < JI and (hc & 15) == dr:
                            rm += 1
                    greedy_buy = rm >= 2
                    if buy_hook is not None:
                        hook_result = buy_hook(
                            buyer, list(hb), dc, buys_remaining[buyer],
                            has_laid_down[buyer], round_idx,
                        )
                        should_buy = hook_result if hook_result is not None else greedy_buy
                    else:
                        should_buy = greedy_buy
                    if should_buy:
                        discard_pile.pop()
                        hb.append(dc)
                        # Penalty draw
                        if _draw_from_pile(draw_pile, discard_pile, rng):
                            hb.append(draw_pile.pop())
                        buys_remaining[buyer] -= 1
                        break

    # ── Score the round ───────────────────────────────────────
    return [0 if p == winner else hand_points(hands[p]) for p in range(n_players)]


# ─────────────────────────────────────────────────────────────
# Full 7-round game simulation
# ─────────────────────────────────────────────────────────────

def play_game(
    n_players: int = 4,
    rng: Optional[random.Random] = None,
    deck_count: int = DECK_COUNT,
    starting_round: int = 0,
    initial_scores: Optional[list] = None,
    initial_hands: Optional[list] = None,
    discard_hook=None,
    draw_hook=None,
    laydown_hook=None,
    buy_hook=None,
) -> list:
    """Simulate rounds starting_round..6. Returns cumulative scores per player.

    Args:
        starting_round:  First round to simulate (0-6). Default 0 = full game.
        initial_scores:  Scores accumulated before starting_round. Default zeros.
        initial_hands:   If set, used as dealt hands only for starting_round.
                         (Subsequent rounds deal fresh.) For PIMC rollouts.
        discard_hook:    Optional callable(player_idx, hand, has_laid_down,
                         table_melds, round_idx) -> card_int | None. Overrides
                         the greedy discard for specific players.
        draw_hook:       Optional callable(player_idx, hand, discard_top,
                         has_laid_down, round_idx) -> 'take' | 'draw' | None.
                         Overrides the greedy free-take decision for player p+1
                         after each discard. None return = use greedy heuristic.
        laydown_hook:    Optional callable(player_idx, hand, assignment, round_idx,
                         has_laid_down) -> bool | None. Return False to skip lay-down
                         for this turn; True or None to proceed (greedy default).
    """
    if rng is None:
        rng = random.Random()
    scores = list(initial_scores) if initial_scores is not None else [0] * n_players
    for round_idx in range(starting_round, 7):
        ih = initial_hands if round_idx == starting_round else None
        for p, s in enumerate(play_round(round_idx, n_players, rng, deck_count, ih, discard_hook, draw_hook, laydown_hook, buy_hook)):
            scores[p] += s
    return scores


# ─────────────────────────────────────────────────────────────
# Benchmark
# ─────────────────────────────────────────────────────────────

def benchmark(n_games: int = 500, n_players: int = 4, seed: int = 42) -> float:
    """Run n_games and return games-per-second."""
    import time
    rng = random.Random(seed)
    t0 = time.perf_counter()
    for _ in range(n_games):
        play_game(n_players, rng)
    elapsed = time.perf_counter() - t0
    gps = n_games / elapsed
    print(f"  {n_games} games in {elapsed:.2f}s -> {gps:.1f} games/sec")
    return gps


# ─────────────────────────────────────────────────────────────
# Correctness checks (run as __main__)
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Shanghai Rummy Engine -- correctness check")
    print()

    # ── Meld validation ───────────────────────────────────────
    print("Meld validation:")
    C = lambda s, r: s * 16 + r        # shorthand: card int
    J = JOKER_INT

    # Sets
    assert is_valid_set([C(0,7), C(1,7), C(2,7)]),         "3 sevens = valid set"
    assert is_valid_set([C(0,7), C(1,7), J]),               "2 sevens + joker = valid"
    assert not is_valid_set([C(0,7), C(1,8), C(2,7)]),      "mixed ranks = invalid"
    assert not is_valid_set([C(0,7), C(1,7)]),              "only 2 = invalid"

    # Runs
    assert is_valid_run([C(0,3), C(0,4), C(0,5), C(0,6)]),             "4 consec clubs"
    assert is_valid_run([C(0,3), C(0,5), C(0,6), C(0,7), J]),          "gap filled by joker"
    assert is_valid_run([C(0,1), C(0,2), C(0,3), C(0,4)]),             "A-2-3-4 ace-low"
    assert is_valid_run([C(0,1), C(0,11), C(0,12), C(0,13)]),          "A-J-Q-K ace-high"
    assert not is_valid_run([C(0,3), C(0,4), C(0,5)]),                 "only 3 = invalid"
    assert not is_valid_run([C(0,3), C(1,4), C(0,5), C(0,6)]),         "mixed suits = invalid"
    print("  All meld checks passed.")

    # ── Meld finding ──────────────────────────────────────────
    print("Meld finding:")
    # R1 hand: two natural sets
    hand = [C(0,7), C(1,7), C(2,7), C(0,9), C(1,9), C(2,9), C(0,2), C(1,3), C(2,4), C(3,5)]
    result = find_meld_assignment(hand, 2, 0)
    assert result is not None, "Should find 2 sets in hand with 2 natural groups of 3"

    # R3 hand: two runs
    hand2 = [C(0,3), C(0,4), C(0,5), C(0,6), C(1,7), C(1,8), C(1,9), C(1,10), C(2,1), C(3,2)]
    result2 = find_meld_assignment(hand2, 0, 2)
    assert result2 is not None, "Should find 2 runs"

    print("  Meld finding checks passed.")

    # ── Game simulation ───────────────────────────────────────
    print("\n10 game scores (4P):")
    for i in range(10):
        scores = play_game(4, random.Random(i))
        winner = min(range(4), key=lambda p: scores[p])
        print(f"  Game {i}: {scores}  winner=P{winner}")

    # ── Speed benchmark ───────────────────────────────────────
    print("\nSpeed benchmark (4P, 500 games):")
    benchmark(500, 4)
