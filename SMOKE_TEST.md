# Smoke Test (Two Users)

Goal: 10–15 minute checklist for User A and User B to validate auth, session persistence, core writes, captain rules, RLS, and slow network handling without changing game mechanics.

## Pre-reqs
- Two test accounts: **User A** and **User B** (email + password; Google if configured).
- Test data has at least a few unlocked and locked players for today (if none are locked, note "no locks today").
- App built/run in Expo (dev or preprod) with Supabase URL/anon key set.
- Optional: set `EXPO_PUBLIC_DIAGNOSTICS_LOGGING=true` to capture console breadcrumbs; `EXPO_PUBLIC_DIAGNOSTICS=true` to keep Diagnostics route visible.

## Checklist (≈12 minutes)
1) **Login**
   - User A: email/password login succeeds; lands on Home. (If Google enabled, also verify Google flow completes.)
   - User B: repeat.
2) **Restart & Session restore**
   - Fully close the app, reopen.
   - Expect quick load into tabs (no infinite spinner). Auth state should be "logged in".
3) **Create squad (User A)**
   - Build a valid squad and save.
   - Verify on Supabase: `fantasy_teams` row exists for User A; corresponding `fantasy_team_players` rows exist (ensure save order worked).
   - Check app shows saved players without errors.
4) **Captain selection rules (User A)**
   - Set a captain when allowed → success message/state updates.
   - If captain lock is active, attempt change → blocked with clear message.
5) **Leaderboard visibility**
   - Open global leaderboard → loads without errors; shows ranks/points.
   - Confirm it does **not** show private team details (no player lists) for other users.
6) **RLS sanity across users**
   - User A tries to open User B team page or player selections (if any route exists) → access denied/empty state.
   - User B tries to view User A team → also denied/empty.
7) **Slow network behaviour**
   - Toggle Airplane Mode (or OS Low Data) once while on a fetch.
   - App should show error state or toast; must not spin indefinitely. Restore network afterwards.
8) **Locked players today view**
   - Open locked players/today view.
   - If locks exist: ensure locked players are marked/blocked consistently.
   - If no locks: empty state is shown (no crash).
9) **Session + writes traces (optional)**
   - Open Diagnostics (tap version label 7× on Profile, or route if enabled).
   - Confirm fields populate and show last API error (if any) and last core write timestamps.

## Pass/Fail
- Record PASS/FAIL per step with notes (screenshot or short log line).
- If any step fails, capture the on-screen message and the `last API error` + `last core write` from Diagnostics.
