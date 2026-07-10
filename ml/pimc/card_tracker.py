"""
CardTracker — tracks seen cards during a Shanghai Rummy game.

Used by the PIMC agent to:
  1. Know which cards are visible (own hand, discards seen, opponent melds).
  2. Compute the "unseen pool" = full deck − all seen cards.
  3. Sample plausible opponent hands for PIMC determinizations.

Card encoding mirrors engine.py:
  card_int = suit * 16 + rank
  suit: 0=clubs 1=diamonds 2=hearts 3=spades
  rank: 1=Ace 2-10 11=J 12=Q 13=K
  JOKER_INT = 64
"""

import random
from engine import make_deck, JOKER_INT, DECK_COUNT, CARDS_DEALT


class CardTracker:
    """Tracks the full information state available to one player."""

    def __init__(self, deck_count: int = DECK_COUNT):
        self._deck_count = deck_count
        full_deck = make_deck(deck_count)
        # _total[card_int] = how many copies exist in the full deck
        self._total: dict = {}
        for c in full_deck:
            self._total[c] = self._total.get(c, 0) + 1
        # _seen[card_int] = how many copies have been seen (any context)
        self._seen: dict = {}

    # ─────────────────────────────────────────────────────────────
    # Observing cards
    # ─────────────────────────────────────────────────────────────

    def see(self, card_int: int) -> None:
        """Record one seen card (own hand, discard top, opponent meld card, buy)."""
        self._seen[card_int] = self._seen.get(card_int, 0) + 1

    def see_many(self, cards) -> None:
        """Record multiple seen cards at once."""
        for c in cards:
            self._seen[c] = self._seen.get(c, 0) + 1

    def unsee(self, card_int: int) -> None:
        """Un-record a card (e.g., a discard that was bought by an opponent leaves
        the visible discard but enters their private hand — still 'seen' overall,
        so this is rarely needed; provided for completeness)."""
        cnt = self._seen.get(card_int, 0)
        if cnt > 1:
            self._seen[card_int] = cnt - 1
        elif cnt == 1:
            del self._seen[card_int]

    # ─────────────────────────────────────────────────────────────
    # Unseen pool (cards that could be in opponent hands or the draw pile)
    # ─────────────────────────────────────────────────────────────

    def unseen_pool(self) -> list:
        """
        Return all cards not yet seen, as a flat list (with duplicates for 2-deck).
        These are the cards that could be in opponent hands or the draw pile.
        """
        pool = []
        seen = self._seen
        for c, total in self._total.items():
            available = total - seen.get(c, 0)
            if available > 0:
                pool.extend([c] * available)
        return pool

    def unseen_count(self) -> int:
        """Number of unseen cards."""
        return sum(
            max(0, total - self._seen.get(c, 0))
            for c, total in self._total.items()
        )

    # ─────────────────────────────────────────────────────────────
    # Determinization: sample plausible opponent hands
    # ─────────────────────────────────────────────────────────────

    def sample_opponent_hands(
        self,
        hand_sizes: list,
        rng: random.Random,
    ) -> list:
        """
        Sample one determinization: assign plausible hands to each opponent.

        Args:
            hand_sizes: list of ints, one per opponent (number of cards each holds).
            rng:        seeded Random instance for reproducibility.

        Returns:
            list of lists — one hand per opponent. Cards drawn without replacement
            from the unseen pool. If the pool is smaller than needed, the last
            hand(s) receive fewer cards.
        """
        pool = self.unseen_pool()
        rng.shuffle(pool)

        hands = []
        idx = 0
        for sz in hand_sizes:
            h = pool[idx: idx + sz]
            idx += sz
            hands.append(h)
        return hands

    # ─────────────────────────────────────────────────────────────
    # Convenience
    # ─────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Clear all seen cards (call at the start of each round)."""
        self._seen.clear()

    def seen_count(self) -> int:
        return sum(self._seen.values())

    def __repr__(self) -> str:
        return (
            f"CardTracker(seen={self.seen_count()}, "
            f"unseen={self.unseen_count()}, "
            f"decks={self._deck_count})"
        )


# ─────────────────────────────────────────────────────────────────
# Quick correctness check
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("CardTracker — correctness check")
    rng = random.Random(42)

    tracker = CardTracker(deck_count=2)
    print(f"  Fresh: {tracker}")
    assert tracker.unseen_count() == 108, f"Expected 108, got {tracker.unseen_count()}"

    # See own hand (10 cards)
    from engine import card_int as CI, JOKER_INT as JI
    hand = [CI(0, 7), CI(1, 7), CI(2, 7), CI(0, 9), CI(1, 9),
            CI(2, 9), CI(0, 2), CI(1, 3), CI(2, 4), CI(3, 5)]
    tracker.see_many(hand)
    print(f"  After seeing 10-card hand: {tracker}")
    assert tracker.unseen_count() == 98, f"Expected 98, got {tracker.unseen_count()}"

    # Pool has 98 cards; sample 2 opponent hands of 10 cards each
    opp_hands = tracker.sample_opponent_hands([10, 10], rng)
    assert len(opp_hands) == 2
    assert len(opp_hands[0]) == 10
    assert len(opp_hands[1]) == 10

    # Sampled cards should not overlap
    all_sampled = opp_hands[0] + opp_hands[1]
    # Check no card sampled exceeds its unseen count
    from collections import Counter
    pool_cnt = Counter(tracker.unseen_pool())
    sample_cnt = Counter(all_sampled)
    for c, cnt in sample_cnt.items():
        assert cnt <= pool_cnt[c], f"Sampled {cnt} of {c} but only {pool_cnt[c]} unseen"

    print("  Sampling check passed.")
    print("  All checks passed.")
