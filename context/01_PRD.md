#

---

## 1. Product Summary

**App Name:** Latvian Floorball Fantasy
**Goal:** A fantasy sports mobile app where users draft floorball players from the Latvian highest league earn points based on real match stats.
**Platforms:** Expo (React Native) for Android (via Expo Go).
**Backend:** Supabase (Postgres + Auth + Realtime).
**Data Source:** Latvian Floorball Federation (LFS) website — scraped → processed by GPT → imported into Supabase.

---

## 2. MVP Scope (Must-Haves)

1. **Auth:** Email/password sign-up & login (no email confirmation during dev).
2. **Player Data:** Fetch live player list from Supabase (`players` table).
3. **Team Builder:** Allow users to build teams with budget + roster limits, and choose a captain.
4. **Scoring System:** Calculate fantasy points from player match events (manual data OK for MVP).
5. **Realtime Points:** Subscribe to `match_events` in Supabase to see score updates live.
6. **Data Security:** Row Level Security — each user can only edit their own fantasy team.

---

## 3. Game Rules (Finalized for MVP)

### Team Roster

* Total 10 players:

  * 5 Forwards (F)
  * 3 Defenders (D)
  * 1 Goalie (G)
  * 1 Flex (F/D)
* One captain per gameweek → **captain’s points ×2**.

### Transfers

* Start with **3 transfers**, gain **+1 per month**, max **6** in bank.

### Budget

* Total **100 credits** per team.

### Scoring System

**Forwards:** Goal +1.5, Assist +1.0
**Defenders:** Goal +2.0, Assist +1.5
**All skaters:** Hat-trick +3, Penalty shot scored +0.5, missed –0.5, Minor 2 –0.5, Double minor –2, Red card –6, MVP +2 *(if available)*
**Goalies:** +0.1 per save, +2 win (if reliable); GA bands → 0 = +8, 1–2 = +5, 3–5 = +2, 6–9 = –2, ≥10 = –5
**Removed:** Game-winning goal, coach points.

---

## 4. Pricing Model

1. Compute **FPPG (Fantasy Points Per Game)** from parsed stats.
2. Apply role boosts: D ×1.15, G ×1.10.
3. Calculate percentile pricing by position.
4. Gamma curve for top-player premium (γ = 1.9).
5. Price ranges: Forwards 4–13, Defenders 3–14, Goalies 5–12.
6. Median team (5F, 3D, 1G, 1 Flex) ≈ 95 credits.

---

## 5. Data Pipeline (MVP)

1. Scrape data from LFS site (match results, stats tables).
2. Use GPT to clean and normalize (fix names, compute fantasy points).
3. Export as CSV: `players.csv`, `matches.csv`, `match_events.csv`.
4. Import into Supabase.
5. Create DB views for `player_match_points` and `fantasy_team_match_points`.

---

## 6. Non-Goals (Not in MVP)

* Social leagues or friends comparison.
* Push notifications.
* Dynamic price updates or trading system.
* Historical analytics or projections.
* Multi-language support.

---

## 7. Technical Setup

* Expo + React Native + TypeScript.
* Supabase: Postgres DB, Auth, Realtime, RLS.
* Environment variables stored in `/apps/mobile/.env`.
* Public read for `players` table; secure writes for user data only.

---

## 8. MVP Acceptance Criteria

| Feature          | Test Condition                                            |
| ---------------- | --------------------------------------------------------- |
| **Auth**         | User can sign up, sign in/out, and session persists.      |
| **Players**      | Player list loads live from Supabase.                     |
| **Team Builder** | Budget and position limits enforced; captain selectable.  |
| **Scoring View** | Player and team points display correctly with captain ×2. |
| **Realtime**     | Adding `match_event` in Supabase updates score on device. |
| **RLS**          | Users can only modify their own teams/rosters.            |

---

## 9. Risks & Mitigations

| Risk                         | Mitigation                                                            |
| ---------------------------- | --------------------------------------------------------------------- |
| Inconsistent LFS scraping    | Manual cleanup for top players before import.                         |
| Missing MVP/MVP awards       | Treat as optional, off by default.                                    |
| Context overload in AI tools | Keep only `06_WorkflowRules.md` always loaded; load others as needed. |

---

## 10. Glossary

**LFS:** Latvian Floorball Federation (data source).
**FPPG:** Fantasy Points Per Game.
**GA Band:** Goals Against performance tier for goalies.
**MVP:** Most Valuable Player (optional bonus).

---
