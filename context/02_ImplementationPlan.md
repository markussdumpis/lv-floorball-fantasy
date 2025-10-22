#

---

## 0) Ground Rules (Context Engineering)

* Keep `06_WorkflowRules.md` always loaded; load other docs only when needed.
* Source of truth order: **01_PRD.md → this file → 03_ProjectStructure.md**.
* Prefer **vertical slices** (feature end‑to‑end) with a demo at the end of each phase.

---

## Phase 1 — Foundation & Data (Vertical Slice: list players from Supabase)

### Tasks

1. **Repo & Context**

   * Ensure `/context` exists with `01_PRD.md`, `06_WorkflowRules.md`.
   * Commit docs.
2. **Env & Client**

   * Create `/apps/mobile/.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   * Create `src/lib/supabaseClient.ts` and export initialized client.
3. **DB: players table**

   * Columns: `id uuid pk`, `name text`, `position text check (F|D|G)`, `team text`, `price int`, `external_id text`, timestamps.
   * RLS: public read; write restricted.
   * Seed minimal data (5–10 players) from CSV.
4. **UI: PlayerList screen**

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
2. **Auth client**

   * Add `@react-native-async-storage/async-storage` and session persistence.
   * `src/lib/auth.ts`: `signUp`, `signIn`, `signOut`, `getSession` helpers.
3. **Auth UI**

   * `AuthScreen`: email, password, login/register toggle.
   * `ProfileScreen`: shows user email + Sign Out.
4. **Navigation Guard**

   * If no session → show `AuthScreen`; otherwise show app tabs.

### Acceptance

* Can sign up, sign in/out.
* Session persists after app reload.
* Protected screens hidden when signed out.

---

## Phase 3 — Fantasy Team Builder (Roster + Budget + Captain)

### Tables

* `fantasy_teams`: `id uuid pk`, `user_id uuid fk auth.users`, `name text`, `budget int default 100`, timestamps. RLS: user owns row.
* `fantasy_rosters`: `id uuid pk`, `team_id uuid fk`, `player_id uuid fk`, `is_captain bool default false`, `gameweek int`, timestamps. RLS: only owner via team.

### Tasks

1. **APIs/Queries**

   * Create/sync single `fantasy_team` per user (upsert).
   * Add/remove roster entries; enforce unique captain per user+gameweek.
2. **Validation (client)**

   * Role counters: 5F, 3D, 1G, 1 Flex (F/D).
   * Budget bar: cannot exceed 100 credits; disable Add when over.
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

* `matches`: `id`, `home_team`, `away_team`, `start_time`, etc.
* `match_events`: `id`, `match_id`, `player_id`, `event_type`, `value`, `minute` (or timestamp).
* `player_match_points` (VIEW): sum rules by player+match from `match_events` per PRD.
* `fantasy_team_match_points` (VIEW): join roster + player points; apply captain ×2.

### Tasks

1. **Seed a demo match** and a few `match_events` covering: goal, assist, minor, saves & GA bands.
2. **Realtime subscription**

   * Subscribe to `match_events` for a `match_id`; recompute visible totals client‑side or refetch the view.
3. **Points UI**

   * `MatchPointsScreen`: show per‑player points; highlight captain bonus.

### Acceptance

* Inserting a new event updates scores on device (visible change).
* Captain shows doubled points in team total.

---

## Phase 5 — Polish, Testing, and Bug Triage

### Tasks

* UI polish (empty states, spinners, error toasts).
* Performance: simple pagination or lazy loading for players.
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

**Players fetch (why):** prove end‑to‑end connectivity.
*Minimal hook/snippet*

```ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function usePlayers() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('price', { ascending: false })
      if (error) setError(error.message)
      else setData(data ?? [])
      setLoading(false)
    })()
  }, [])

  return { data, loading, error }
}
```

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
