# Shanghai Tracker Roadmap

> Living document mapping milestones to priorities. Updated as the project evolves.

## Current Focus

### Hybrid v2 — Opponent-Aware AI `IN PROGRESS`
Train the ML system to understand opponent behavior and make smarter draw decisions.
- Learned opponent embeddings (OpponentEncoderNet)
- Neural draw decisions (DrawEvalNet)
- Retrain all networks on 5K-10K game data
- **Target:** < 300 avg score vs Shark (down from 428 in v1)
- **Tracking:** [Milestone](../../milestone/1) | [Issue #3](../../issues/3)

---

## Up Next

### Polish & UX Pass
Make every interaction feel polished before going to the app store.
- Fix countdown transition animations ([#6](../../issues/6))
- Improve analytics dashboard ([#5](../../issues/5))
- Accessibility audit (colorblind mode, screen reader, touch targets)
- Performance pass (startup time, animation jank on older devices)
- **Tracking:** [Milestone](../../milestone/2)

---

## Planned

### Social & Community
Make the game social — give players reasons to play with friends.
- Friends list and favorite players
- Global and friends leaderboards
- Share game results (screenshot card or deep link)
- In-game chat for multiplayer
- Invite links ("tap to join my game")
- Player avatars and profile customization
- **Tracking:** [Milestone](../../milestone/3)

### Competitive Play
Build a competitive ecosystem for serious players.
- ELO / skill rating system
- Tournament format expansion (round robin, swiss)
- Seasonal rankings with resets
- Match history with searchable filters
- Unified hard AI tier (consolidate personalities — [#7](../../issues/7))
- **Tracking:** [Milestone](../../milestone/4)

### Content & Customization
Retention and personalization features.
- Card back and table felt themes
- Custom house rules (adjustable buys, round counts)
- Daily/weekly challenges
- Unlockable cosmetics tied to achievements
- **Tracking:** [Milestone](../../milestone/5)

---

## Long Term

### App Store Launch
Ship to Apple App Store and Google Play.
- Native wrapper (Capacitor)
- Store assets, screenshots, metadata
- Privacy policy and terms of service
- Push notifications (native)
- Deep linking / universal links
- Compliance and review submission
- **Tracking:** [Milestone](../../milestone/6) | [Issue #4](../../issues/4)

### AI Mastery
Push the AI to human-level and beyond.
- Adaptive difficulty curve (smooth ramp from easy to hard)
- Composable AI personality traits
- Self-play training pipeline (AI vs AI at scale)
- "Coach mode" — AI suggests your best move while learning
- **Tracking:** [Milestone](../../milestone/7)

---

## Milestone Overview

| Milestone | Status | Key Issues |
|-----------|--------|------------|
| Hybrid v2 — Opponent-Aware AI | In Progress | #3 |
| Polish & UX Pass | Planned | #5, #6 |
| Social & Community | Planned | — |
| Competitive Play | Planned | #7 |
| Content & Customization | Planned | — |
| App Store Launch | Planned | #4 |
| AI Mastery | Planned | #7 |

---

*Last updated: 2026-04-03*
