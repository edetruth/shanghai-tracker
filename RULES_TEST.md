# Shanghai Rummy — Manual Pre-Deploy Checklist

Run through these tests before deploying. Check each item manually in the app using a 2-player game (1 human + 1 AI, Hard difficulty).

---

## 1. Round Requirements

- [ ] Round 1 displays "2 Sets" and AI lays down 2 sets when it can
- [ ] Round 2 displays "1 Set + 1 Run" and AI lays down 1 set + 1 run
- [ ] Round 3 displays "2 Runs" — AI lays down 2 runs (not sets)
- [ ] Round 4 displays "3 Sets"
- [ ] Rounds 5–7: 12 cards dealt instead of 10 (check hand count after deal)
- [ ] Cannot lay down with fewer melds than required (try tapping Confirm with incomplete selection)

---

## 2. Laying Down

- [ ] Only the required melds for the round can be laid down (no extra/bonus melds)
- [ ] Auto-fill places sets into set slots and runs into run slots (correct ordering)

---

## 3. Joker Placement Picker

- [ ] When laying down a run with an ambiguous joker (extra joker beyond gaps), the joker placement picker appears
- [ ] Two options shown (low end / high end) with full sequence preview
- [ ] After picking, the meld is built with joker in the chosen position
- [ ] AI places jokers automatically (no picker shown for AI)

---

## 4. Joker Swap (Post-Lay-Down)

- [ ] After laying down, "Lay Off / Swap" button opens the modal with two tabs
- [ ] Swap Joker tab: only RUN melds with jokers appear as valid targets (sets are greyed out / not shown)
- [ ] Swapping a natural card removes it from hand, puts the joker in hand
- [ ] Joker label updates in the meld after swap (joker is gone, natural card shows)
- [ ] Cannot swap a joker from a set (sets excluded per house rules)

---

## 5. Pre-Lay-Down Joker Swap

- [ ] When not yet laid down and a swappable joker exists on the table, "Swap Joker" button appears (before "Lay Down Hand")
- [ ] After tapping Swap Joker, the "You must lay down after this swap" banner appears
- [ ] After confirming swap, the meld modal opens immediately with lock (no X, no Cancel)
- [ ] Cannot close locked meld modal — must lay down
- [ ] Swap is rejected if getting the joker still wouldn't enable laying down (validation message shown)

---

## 6. Laying Off

- [ ] Can lay a card off onto a run at either end (try extending 5-6-7-8 with 4 and with 9)
- [ ] Can lay an ace at the high end of a K-high run (K-A extension)
- [ ] Can lay a joker off onto any meld (set or run)
- [ ] Cannot lay off a card in the middle of an existing run
- [ ] Cannot lay off wrong suit on a run
- [ ] Cannot lay off wrong rank on a set
- [ ] Valid targets highlighted green ("tap to lay off ✓") when a card is selected
- [ ] Joker lay-off shows extension hint (e.g. "→ 9♥") on run melds

---

## 7. Stuck-State Prevention

- [ ] If laying off would leave exactly 1 card that can't be played anywhere, the lay-off is blocked with an error message
- [ ] Blocked message says to keep 2 cards so you can discard
- [ ] Chain lay-off works: lay off card A, then the remaining hand can lay off card B if it's now valid (fix for Bug 2A)
- [ ] Example: run 5-6-7-8 + hand [4♥, 3♥] → lay off 4♥ first (now run is 4-8), then lay off 3♥ (now run is 3-8) → goes out

---

## 8. Going Out

- [ ] Can go out by laying off the last card in hand
- [ ] CANNOT go out by discarding — discard button is disabled when hand has 1 card, shows error message
- [ ] AI (Medium/Hard) can go out via a chain of sequential lay-offs (e.g. [4♥, 3♥] onto run 5♥-8♥: lay off 4♥, run becomes 4-8, lay off 3♥, gone)
- [ ] Medium AI: after a normal lay-off reduces hand to 1 card, AI immediately attempts the final going-out lay-off (does NOT cycle back to draw)
- [ ] After going out (by lay-off), round ends immediately and buying window opens
- [ ] Player who goes out scores 0 for the round
- [ ] Remaining players score the sum of their remaining hand cards

---

## 9. Buying (Rule 9A)

- [ ] After a player discards, the NEXT player in turn order gets first right to take the discard (their normal draw — no buy used)
- [ ] If next player takes the discard, NO buying window opens for other players
- [ ] If next player draws from the pile instead, a buying window opens for remaining players
- [ ] Human buy banner appears correctly when it's a human player's buy decision
- [ ] AI makes buy decisions automatically (with brief "Alice buys!" or "Alice passes" messages)
- [ ] Buying gives: the discard card + 1 penalty card from draw pile
- [ ] Each player has 5 buys per round (resets at start of each new round)
- [ ] Buy counter shown in top bar and player mini-cards

---

## 10. AI Behavior

- [ ] Easy AI: never buys, takes discard rarely, lays down required melds only, discards highest card
- [ ] Medium AI: buys when beneficial, lays down required melds only, 1 lay-off max per turn (exception: always lays off when 1 card remains to go out)
- [ ] Hard AI: aggressive buying, lays down required melds only, unlimited lay-offs, does joker swaps
- [ ] AI messages ("Alice lays down!", "Bob discards", etc.) appear and clear after ~1 second
- [ ] AI handles Round 3 (2 Runs) correctly — lays down 2 runs, not sets

---

## 11. Scoring & Round Progression

- [ ] Round summary shows each player's score and who went out (0 pts)
- [ ] "Shanghaied" shown for players who never laid down this round
- [ ] Cumulative scores shown in top bar player mini-cards
- [ ] After Round 7, "Game Over" screen shows with final standings
- [ ] Auto-save badge appears on game over screen
- [ ] Saved game appears in Score Tracker → Stats

---

## 12. Game Speed & Pause

- [ ] Pause menu accessible via ⏸ button
- [ ] Speed can be changed to Fast / Normal / Slow from pause menu
- [ ] Abandon Game returns to home screen
- [ ] Resume Game continues from current state

---

## 13. Edge Cases

- [ ] Draw pile reshuffle: when pile is empty, discard pile (minus top card) is reshuffled; toast message appears
- [ ] Stalemate: after many turns with no melds and 2+ pile depletions, round force-ends with scores
- [ ] Undo discard: 3s window shows after human discards; tapping Undo restores hand and state
- [ ] Hand sort (Rank / Suit toggle) works consistently in hand display and meld modal
- [ ] 7-round game completes without crash from start to game-over screen
