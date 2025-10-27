I have the following comments after thorough review of file. Implement the comments by following the instructions verbatim.

---
## Comment 1: UI/UX doc matches current screen routes and basic styling, but PlayerList lacks search/filters and floating action button noted in 04_UI_UX.md.

Add search and filter UI to `apps/mobile/app/players.tsx` per `context/04_UI_UX.md` (position/team/price filters). Include a floating action button for selected players. Leverage `FilterChip` from `apps/mobile/src/components/FilterChip.tsx` and implement local filter state in the screen while keeping data fetch in `usePlayers`. Update empty and error states to match the doc copy.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/apps/mobile/app/players.tsx
- /Users/markussdumpis/lv-floorball-fantasy/apps/mobile/src/components/FilterChip.tsx
- /Users/markussdumpis/lv-floorball-fantasy/context/04_UI_UX.md
---
## Comment 2: `src/lib/auth.ts` helpers referenced in plan are missing; Auth UI and guards are not implemented yet.

Create `apps/mobile/src/lib/auth.ts` with `signUp`, `signIn`, `signOut`, `getSession` using Supabase client and AsyncStorage. Add `AuthScreen` under `apps/mobile/app/` and implement a navigation guard that shows `AuthScreen` when no session is present. Update `profile.tsx` to show user email and a Sign Out button.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/context/02_ImplementationPlan.md
- /Users/markussdumpis/lv-floorball-fantasy/apps/mobile/app/profile.tsx
---
## Comment 3: Scoring views (`player_match_points`, `fantasy_team_match_points`) described in docs are not represented in code repo (expected server-side).

Add SQL migration files under `supabase/migrations/` to create `public_players` view and the scoring views (`player_match_points`, `fantasy_team_match_points`). Include any enums and constraints used in MVP (e.g., captain unique partial index). Reference these migrations from README setup steps.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/context/01_PRD.md
- /Users/markussdumpis/lv-floorball-fantasy/context/02_ImplementationPlan.md
- /Users/markussdumpis/lv-floorball-fantasy/context/03_ProjectStructure.md
---
## Comment 4: WorkflowRules defines a clear priority order and AI collaboration flow, but lacks explicit Traycer → Cursor → Review handoff checklist.

Update `context/06_WorkflowRules.md` to add a section titled `AI Collaboration Flow` describing steps: Traycer analysis and plan; Cursor implements; Reviewer verifies and updates context. Include a short checklist of expected outputs (summary, diffs-only PR, updated docs, bug tracker entries) and the context loading hierarchy reminder.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/context/06_WorkflowRules.md
---
## Comment 5: 04_UI_UX.md contains emoji tab names; ensure production titles use plain text consistently across locales.

Add a note in `context/04_UI_UX.md` that emoji are illustrative and production tab titles should be plain text. Verify `_layout.tsx` continues using plain text titles.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/apps/mobile/app/_layout.tsx
- /Users/markussdumpis/lv-floorball-fantasy/context/04_UI_UX.md
---
## Comment 6: Minor formatting inconsistencies across context files (leading blank markers and code fences).

Normalize headings and code fences across `/context/*.md`. Remove stray leading markers at file top, ensure fences specify language where applicable, and maintain consistent section dividers (`---`).

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/context/01_PRD.md
- /Users/markussdumpis/lv-floorball-fantasy/context/02_ImplementationPlan.md
- /Users/markussdumpis/lv-floorball-fantasy/context/03_ProjectStructure.md
- /Users/markussdumpis/lv-floorball-fantasy/context/04_UI_UX.md
- /Users/markussdumpis/lv-floorball-fantasy/context/05_BugTracker.md
- /Users/markussdumpis/lv-floorball-fantasy/context/06_WorkflowRules.md
---
## Comment 7: PlayerList error/empty states exist but copy and behavior should match 04_UI_UX.md expectations.

Update `apps/mobile/app/players.tsx` to include a clear empty state when `data.length === 0` and no error, with copy from `context/04_UI_UX.md`. Ensure pull-to-refresh triggers `refetch` and that the bottom loader appears only when paginating.

### Relevant Files
- /Users/markussdumpis/lv-floorball-fantasy/apps/mobile/app/players.tsx
- /Users/markussdumpis/lv-floorball-fantasy/context/04_UI_UX.md
---