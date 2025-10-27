#

---

## 0) Ground Rules (Context Engineering)

* Keep `06_WorkflowRules.md` always loaded; load other docs only when needed.
* **Source of truth order (conflict resolution):** See `06_WorkflowRules.md` Document Priority Order section for authoritative definition.
* **Process-only docs:** `06_WorkflowRules.md` is process-only and does not override product/tech specs.
* Prefer **vertical slices** (feature end‑to‑end) with a demo at the end of each phase.

---

## Phase 1 — Foundation & Data (Vertical Slice: list players from Supabase)

### Tasks

1. **Repo & Context**

   * Ensure `/context` exists with `01_PRD.md`, `06_WorkflowRules.md`.
   * Commit docs.
2. **Env & Client**

   * Create `/apps/mobile/.env.example` with placeholder values: `EXPO_PUBLIC_SUPABASE_URL=your-url`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key`.
   * Create `/apps/mobile/.env` locally (never commit) with real values.
   * **Security:** Only anon public keys go under `EXPO_PUBLIC_*`, never service-role or secrets.
   * **Production:** Use EAS secrets or separate `.env.production` for production keys.
   * **Setup instructions:** Copy `.env.example` to `.env` and fill in real values. Do not share real keys in PRs or issues.
   * Create `src/lib/supabaseClient.ts` and export initialized client.
3. **DB: players table**

   * Columns: `id uuid pk`, `name text`, `position text check (position IN ('F', 'D', 'G'))`, `team text`, `price int`, `external_id text`, `fppg decimal`, timestamps.
   * RLS: public read; write restricted.
   * Seed minimal data (5–10 players) from CSV.
   * Note: `position` is an enum (F, D, G). Flex is a roster slot accepting players with position F or D, not a player position.
4. **Data Pipeline: Price Calculation**
   * CSV fields: `external_id`, `name`, `position`, `team`, `season`, `goals`, `assists`, `saves`, `goals_against`, `games_played`
   * Name normalization: GPT removes accents, standardizes spelling, handles nicknames
   * ID mapping: Create `external_id` → `internal_id` mapping table for stable references
   * **Pricing formula (same as PRD):** Compute FPPG, apply role boosts (D ×1.15, G ×1.10), calculate percentile pricing, apply gamma adjustment (γ=1.9), enforce min/max caps per position
   * Run pricing function during CSV import, store in `players.price` column

5. **Importer Mapping**
   * **CSV→DB column mapping:**
     * `players.csv`: `external_id` → `external_id`, `name` → `name`, `position` → `position` (enum: F/D/G), `team` → `team`, `season` → `season`, `goals` → `goals`, `assists` → `assists`, `saves` → `saves`, `goals_against` → `goals_against`, `games_played` → `games_played`
     * `matches.csv`: `external_id` → `external_id`, `home_team` → `home_team`, `away_team` → `away_team`, `home_score` → `home_score`, `away_score` → `away_score`, `start_time` → `start_time`, `season` → `season`
     * `match_events.csv`: `external_id` → `external_id`, `match_id` → `match_id` (FK lookup), `player_id` → `player_id` (FK lookup), `event_type` → `event_type` (enum), `minute` → `minute`, `timestamp` → `timestamp`
   * **Enum translation:** `event_type` enum values must match exactly: `goal`, `assist`, `hat_trick`, `penalty_shot_scored`, `penalty_shot_missed`, `minor_2`, `double_minor`, `red_card`, `mvp`, `save`, `goal_allowed` (case-sensitive).
   * **Fallback behavior:** Unknown event types log warning and skip row (do not reject entire batch).
   * **ID mapping:** Use `external_id` for stable references; generate internal UUIDs for `id` pk column.
6. **UI: PlayerList screen**

   * Route: `/players` (stack/tab as per 03).
   * Fetch with `supabase.from('players').select('*')` and render FlatList.
   * Loading/empty/error states.

### Acceptance

* Expo Go shows a Player List loaded from Supabase.
* `.env` not committed.
* RLS allows anonymous read, denies write.

---

## Phase 2 — Auth (Email/Password)

**Why:** We need user identity for personal fantasy teams and RLS.

### Tasks

1. **Enable Auth in Supabase** (disable email confirmation in dev).
   * Auth settings: Email confirmation disabled, password min length 6.
   * JWT expiry: 1 hour, refresh token: 30 days.
2. **Auth client**

   * Add `@react-native-async-storage/async-storage` and session persistence.
   * `src/lib/auth.ts`: `signUp`, `signIn`, `signOut`, `getSession` helpers.
   * Session persistence: `supabase.auth.onAuthStateChange` with AsyncStorage.
3. **RLS Policies**
   * `fantasy_teams`: `user_id = auth.uid()` for SELECT, INSERT, UPDATE, DELETE.
   * `fantasy_rosters`: `team_id IN (SELECT id FROM fantasy_teams WHERE user_id = auth.uid())` for all operations.
   * `players`: Create `public_players` VIEW exposing only `id`, `name`, `position`, `team`, `price`, `fppg` columns for anonymous read.
   * **Players access pattern:** `CREATE VIEW public_players AS SELECT id, name, position, team, price, fppg FROM players;` then grant SELECT on view to anon role. Client fetches from `public_players` view instead of `players` table directly.
4. **Auth UI**

   * `AuthScreen`: email, password, login/register toggle.
   * `ProfileScreen`: shows user email + Sign Out.
5. **Navigation Guard**

   * If no session → show `AuthScreen`; otherwise show app tabs.

### Acceptance

* Can sign up, sign in/out.
* Session persists after app reload.
* Protected screens hidden when signed out.

---

## Phase 3 — Fantasy Team Builder (Roster + Budget + Captain)

### Tables

* `gameweeks`: `id uuid pk`, `week_number int`, `start_date date`, `end_date date`, `season text`, timestamps.
  * **Unique constraint:** `UNIQUE (season, week_number)` to prevent duplicate gameweeks.
  * **Mapping:** Create view or trigger to assign matches to `gameweek_id` based on match date falling between `start_date` and `end_date`.
* `fantasy_teams`: `id uuid pk`, `user_id uuid fk auth.users`, `name text`, `budget int default 100`, timestamps. RLS: user owns row.
* `fantasy_rosters`: `id uuid pk`, `team_id uuid fk`, `player_id uuid fk`, `is_captain bool default false`, `gameweek_id uuid fk`, timestamps. RLS: only owner via team.
* `fantasy_transfers`: `id uuid pk`, `team_id uuid fk`, `gameweek_id uuid fk`, `transfers_used int default 0`, `transfers_available int default 3`, timestamps. RLS: user owns row.
* **Captaincy constraint:** Unique partial index on `(team_id, gameweek_id)` where `is_captain = true`.
* **MVP Transfer Rules:** Static 3 transfers per gameweek (no accrual), unused transfers do not carry over, reset each gameweek. Enforce via `fantasy_transfers.transfers_used` counter and client-side validation.

### Tasks

1. **APIs/Queries**

   * Create/sync single `fantasy_team` per user (upsert).
   * Add/remove roster entries; enforce unique captain per user+gameweek via DB constraint.
   * Server-side enforcement: Trigger or constraint prevents multiple captains per team+gameweek.
2. **Validation (client)**

   * Role counters: 5F, 3D, 1G, 1 Flex (accepts F or D players).
   * Budget bar: cannot exceed 100 credits; disable Add when over.
   * Flex slot validation: only allow players with position F or D, UI does not show Flex as a player position filter option.
3. **UI**

   * `TeamBuilderScreen`: two panes (players / my team).
   * Filters by position; search by name.
   * Tap to add/remove; long‑press to set captain.
4. **RLS tests**

   * Ensure users cannot modify others’ teams.

### Acceptance

* Cannot add 6th Forward; cannot exceed 100 credits.
* Exactly one captain per gameweek.
* Data persists and reloads correctly across app restarts.

---

## Phase 4 — Scoring & Realtime (Demo with seed data)

### Tables & Views

* `matches`: `id`, `home_team`, `away_team`, `home_score`, `away_score`, `start_time`, `result`, `overtime`, `shootout`, `season`, etc.
* `match_events`: `id`, `match_id`, `player_id`, `event_type` (enum: goal, assist, hat_trick, penalty_shot_scored, penalty_shot_missed, minor_2, double_minor, red_card, mvp, save, goal_allowed), `value`, `minute`, `timestamp`.
* **Note:** Goalie GA band calculation uses per-match aggregate from `matches.home_score`/`away_score`, not per-event `goals_against`.
* `player_match_points` (VIEW): sum rules by player+match from `match_events` per PRD with role-based multipliers. For goalies, join `matches` to derive goals_against from match score.
  * **Access:** Public read (contains only aggregated per-player data).
* `fantasy_team_match_points` (VIEW): join roster + player points; apply captain ×2 after summing a player's match points (apply captain multiplier in this view). References gameweek_id mapping from matches to gameweeks.
  * **Access:** Requires authentication via RLS policy `user_id = auth.uid()` (users can only view their own team points).

### Tasks

1. **Seed a demo match** and a few `match_events` covering: goal, assist, minor, saves & GA bands.
   * Example: Goalie with 5 saves, 2 goals against = +0.5 (saves) + +5 (GA band) + +2 (win) = +7.5 points
2. **Realtime subscription**

   * Subscribe to `match_events` table filtered by selected `match_id` using Supabase Realtime.
   * Channel: `match_events:match_id=eq.{selected_match_id}`
   * **Auth state handling:** Handle `supabase.auth.onAuthStateChange` token changes; rejoin channel when token refreshes.
   * **Reconnection logic:** Implement exponential backoff with jitter (initial delay 1s, max 32s, factor 2, ±20% jitter), max 5 retries.
   * **Telemetry:** Log connection lifecycle events (subscribed, error, closed) with screen-level status indicator.
   * Initial fetch: Get last 50 events for the match or refetch view if late join.
   * Debounce strategy: 500ms delay before UI updates to coalesce rapid events.
   * Pagination: Load events in 20-event chunks, maintain time window for long matches.
   * Error handling: Show connection status, retry button for failed subscriptions.
3. **Points UI**

   * `MatchPointsScreen`: show per‑player points; highlight captain bonus.

### Acceptance

* Inserting a new event updates scores on device (visible change).
* Captain shows doubled points in team total.
* Reconnection after token refresh: Channel automatically rejoins after auth token refresh completes.
* Connection status visible: Screen shows "Connected", "Connecting", or "Disconnected" status.
* Manual reconnection works: Retry button successfully reconnects after max retries reached.

---

## Phase 5 — Polish, Testing, and Bug Triage

### Tasks

* UI polish (empty states, spinners, error toasts).
* Performance: pagination (20 players per page) and lazy loading for players.
* Error handling: retry buttons, exponential backoff, graceful degradation.
* Add initial `05_BugTracker.md` entries; resolve critical ones.
* Verify RLS with anon vs authed.
* Prepare internal test build.

### Acceptance

* Clean runs on Expo Go; no crashers in happy path.
* Checklists ticked; known issues documented.

---

## Commands & Snippets (Copy‑Paste)


*Create **`/apps/mobile/.env`*

```
EXPO_PUBLIC_SUPABASE_URL=your-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Supabase client (why):** single source to talk to DB.
*`apps/mobile/src/lib/supabaseClient.ts`*

```ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)
```

**Players fetch (why):** prove end‑to‑end connectivity with pagination.
*Minimal hook/snippet with pagination*

```ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function usePlayers(page: number = 0, pageSize: number = 20) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('public_players')
        .select('id, name, position, team, price, fppg')
        .order('price', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) setError(error.message)
      else setData(data ?? [])
      setLoading(false)
    })()
  }, [page, pageSize])

  return { data, loading, error }
}
```
*Note: Implement infinite scroll in PlayerListScreen using FlatList's `onEndReached` to load next page.

---

## Consolidated Acceptance Checklist

| PRD Feature | Phase | Acceptance Criteria | Test Steps |
|-------------|-------|---------------------|------------|
| **Auth** | 2 | User can sign up, sign in/out, session persists | 1. Sign up with new email<br>2. Sign out and sign in<br>3. Close app, reopen → session persists |
| **Players** | 1, 5 | Player list loads with pagination (20/page) | 1. Load PlayerList screen<br>2. Verify initial 20 players load<br>3. Scroll to bottom → next 20 load<br>4. Verify load time < 2s |
| **Team Builder** | 3 | Budget (100 max) and position limits enforced | 1. Add 6th forward → blocked<br>2. Exceed 100 credits → blocked<br>3. Select captain → only one active |
| **Scoring View** | 4 | Points display with captain ×2 | 1. View player match points<br>2. View team total with captain bonus<br>3. Captain shows doubled points |
| **Realtime** | 4 | Live score updates | 1. Insert match_event in Supabase<br>2. Verify score updates on device<br>3. Verify connection status visible |
| **RLS** | 2, 3 | Users can only modify own data | 1. Try to access other user's team → denied<br>2. Verify public_players view accessible |
| **Error Handling** | 5 | Network errors show retry | 1. Disable network<br>2. Verify error state with retry button<br>3. Re-enable → retry works |
| **Performance** | 1, 5 | Fast load times | 1. Players list < 2s load<br>2. Pagination smooth<br>3. No UI blocking on actions |

---

## External Docs to Load (on demand)

* Supabase: auth & JS client; RLS policies; Realtime docs.
* Expo RN: environment variables, navigation.
* React Native: FlatList, Pressable, AsyncStorage.

---

## Definition of Done (per phase)

* Code compiles; types satisfied.
* Feature demonstrable on device.
* Minimal tests/checks or manual checklist.
* Related docs updated (02/03/05).

---

## Next Smallest Task (start here)

* **Create ************************`/apps/mobile/.env`************************ and ************************`src/lib/supabaseClient.ts`**, then build **PlayerList** to verify live data.
* Commit when PlayerList renders real rows from Supabase.
