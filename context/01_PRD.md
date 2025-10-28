# 01_PRD.md — Product Requirements

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
  * 1 Flex (accepts players with position F or D, not a player position itself)
* One captain per gameweek → **captain's points ×2**.
* **Gameweek definition:** Calendar-based weeks (Monday to Sunday), starting from season start date.

### Transfers

* **MVP Implementation:** Static 3 transfers per gameweek (no accrual system for MVP)
* **Post-MVP:** Start with 3 transfers, gain +1 per calendar month, max 6 in bank
* **Reset cadence:** Transfers reset to base amount at start of each new season
* **Usage tracking:** Track transfers used per gameweek, prevent exceeding limit
* **Carryover:** Unused transfers do not carry over to next gameweek in MVP

### Budget

* Total **100 credits** per team.

### Scoring System

**Event Types (match_events.event_type enumeration):**
- `goal` - Player scores a goal
- `assist` - Player assists a goal
- `hat_trick` - Player scores 3+ goals in one match
- `penalty_shot_scored` - Player scores on penalty shot
- `penalty_shot_missed` - Player misses penalty shot
- `minor_2` - Player receives 2-minute penalty
- `double_minor` - Player receives 4-minute penalty
- `red_card` - Player receives red card
- `mvp` - Player receives MVP award (optional)
- `save` - Goalkeeper makes a save
- `goal_allowed` - Goalkeeper allows a goal

**Points per Role:**
**Forwards:** Goal +1.5, Assist +1.0
**Defenders:** Goal +2.0, Assist +1.5
**All skaters:** Hat-trick +3, Penalty shot scored +0.5, missed –0.5, Minor 2 –0.5, Double minor –2, Red card –6, MVP +2 *(if available)*
**Goalies:** +0.1 per save, +2 win (if reliable); GA bands → 0 = +8, 1–2 = +5, 3–5 = +2, 6–9 = –2, ≥10 = –5

**Goalie Points Calculation:**
- **Saves:** +0.1 per save (from `match_events` where `event_type = 'save'`)
- **Win bonus:** +2 if team wins (from `matches.home_score` vs `matches.away_score`)
- **GA bands:** Based on total goals allowed by the goalie's team in the match (per-match aggregate, not per-event)
  - 0 goals against = +8 points
  - 1-2 goals against = +5 points  
  - 3-5 goals against = +2 points
  - 6-9 goals against = -2 points
  - 10+ goals against = -5 points
  - **Calculation:** For home goalie, use `matches.away_score`; for away goalie, use `matches.home_score`

**Win Determination:** Match result based on `matches.home_score` vs `matches.away_score` (home_score > away_score = home team win)

**Captain Multiplier:** Apply captain multiplier after summing a player's match points; multiply the rostered captain's total by 2 in `fantasy_team_match_points` view.

**Stacking Rules:** Bonuses and penalties are additive (e.g., goal + hat-trick = 1.5 + 3 = 4.5 points)

**Removed:** Game-winning goal, coach points.

---

## 4. Pricing Model

**Final Formula (Order of Operations):**
1. Compute **FPPG (Fantasy Points Per Game)** from parsed stats (last 10 games or season average).
2. Apply role boosts: D ×1.15, G ×1.10 (boosts applied to FPPG before percentile calculation).
3. Calculate percentile pricing by position using 90th percentile method:
   - Sort all players by boosted FPPG within position
   - Percentile price = base_price + (percentile_rank / 100) × (max_price - base_price)
4. Apply gamma adjustment: adjusted_price = percentile_price × (1 + (percentile/100)^γ) where γ = 1.9
5. Enforce min/max caps: final_price = CLAMP(adjusted_price, min_price, max_price)
6. Price ranges: Forwards 4–13, Defenders 3–14, Goalies 5–12
7. Median team (5F, 3D, 1G, 1 Flex) ≈ 95 credits

**Example Calculation:**
- Player: Forward with 2.5 FPPG, 85th percentile
- Step 1-2: FPPG = 2.5 (Forward, no boost)
- Step 3: Percentile price = 4 + (0.85 × 9) = 11.65
- Step 4: Gamma adjustment = 11.65 × (1 + 0.85^1.9) = 11.65 × 1.72 = 20.04
- Step 5: Final price = CLAMP(20.04, 4, 13) = 13 (capped at max)

**Implementation:** Run in Supabase function during CSV import, store in `players.price` column.

---

## 5. Data Pipeline (MVP)

1. Scrape data from LFS site (match results, stats tables).
2. Use GPT to clean and normalize (fix names, compute fantasy points).
3. Export as CSV: `players.csv`, `matches.csv`, `match_events.csv`.
4. Import into Supabase.
5. Create DB views for `player_match_points` and `fantasy_team_match_points`.

### CSV Schemas

**players.csv:**
- `external_id` (string, unique, stable across seasons)
- `name` (string, normalized by GPT)
- `position` (enum: F, D, G)
- `team` (string, team code)
- `season` (string, e.g., "2024-25")
- `goals` (integer)
- `assists` (integer)
- `saves` (integer, goalies only)
- `goals_against` (integer, goalies only)
- `games_played` (integer)

**matches.csv:**
- `external_id` (string, unique)
- `home_team` (string, team code)
- `away_team` (string, team code)
- `home_score` (integer)
- `away_score` (integer)
- `start_time` (timestamp)
- `season` (string)

**match_events.csv:**
- `external_id` (string, unique)
- `match_id` (string, references matches.external_id)
- `player_id` (string, references players.external_id)
- `event_type` (enum: goal, assist, hat_trick, penalty_shot_scored, penalty_shot_missed, minor_2, double_minor, red_card, mvp, save, goal_allowed)
- `minute` (integer)
- `timestamp` (timestamp)

### Reconciliation Rules

- **Name normalization:** GPT removes accents, standardizes spelling, handles nicknames
- **ID mapping:** Create `external_id` → `internal_id` mapping table for stable references
- **Team codes:** Standardize team names to 3-letter codes (e.g., "RIG" for Riga)
- **Season boundaries:** Use calendar year (2024-25 season = 2024-09-01 to 2025-08-31)
- **Duplicate handling:** `external_id` must be unique, update existing records on re-import

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
* Public read for `players` table (limited columns only); secure writes for user data only.
* **Players table access:** Create `public_players` VIEW exposing only `id`, `name`, `position`, `team`, `price`, `fppg` columns. Client fetches from `public_players` view instead of `players` table directly.
* **PII avoidance:** Do not store personal information (email, phone, address) in `players` table.
* **Rate limiting:** Implement pagination (20 players per page) and request throttling for public endpoints.

---

## 8. MVP Acceptance Criteria

| Feature          | Test Condition                                            |
| ---------------- | --------------------------------------------------------- |
| **Auth**         | User can sign up, sign in/out, and session persists.      |
| **Players**      | Player list loads live from Supabase with pagination (20 per page). |
| **Team Builder** | Budget and position limits enforced; captain selectable.  |
| **Scoring View** | Player and team points display correctly with captain ×2. |
| **Realtime**     | Adding `match_event` in Supabase updates score on device. |
| **RLS**          | Users can only modify their own teams/rosters.            |
| **Error Handling** | Network errors show retry button, loading states display, graceful degradation. |
| **Performance**  | Players list loads within 2 seconds, lazy loading for large datasets. |

**Consolidated Acceptance Checklist:** See `context/02_ImplementationPlan.md` Phase-by-Phase Acceptance section for detailed acceptance criteria mapped to implementation phases.

---

## 9. Risks & Mitigations

| Risk                         | Mitigation                                                            |
| ---------------------------- | --------------------------------------------------------------------- |
| Inconsistent LFS scraping    | Manual cleanup for top players before import.                         |
| Missing MVP awards            | Treat as optional, off by default.                                    |
| Context overload in AI tools | Keep only `06_WorkflowRules.md` always loaded; load others as needed. |

---

## 10. Glossary

**LFS:** Latvian Floorball Federation (data source).
**FPPG:** Fantasy Points Per Game.
**GA Band:** Goals Against performance tier for goalies.
**MVP:** Most Valuable Player (optional bonus).

---
