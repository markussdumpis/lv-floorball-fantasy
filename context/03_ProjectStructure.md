# 03_ProjectStructure.md

---

## Purpose
Defines the folder/file structure for the Latvian Floorball Fantasy mobile MVP. Cursor must follow this layout and naming when creating or editing files.

---

## Repository Layout

lv-floorball-fantasy/
├── context/ # Context engineering (always source of truth)
│ ├── 01_PRD.md
│ ├── 02_ImplementationPlan.md
│ ├── 03_ProjectStructure.md
│ ├── 04_UI_UX.md
│ ├── 05_BugTracker.md
│ └── 06_WorkflowRules.md
├── apps/
│ └── mobile/ # Expo React Native app
│ ├── app/ # expo-router screens (files == routes)
│ │ ├── _layout.tsx # Tabs wrapper
│ │ ├── index.tsx # Home
│ │ ├── players.tsx # Players list & filters
│ │ ├── squad.tsx # Team builder
│ │ ├── profile.tsx # Profile (signed-in experience)
│ │ └── auth.tsx # Auth screen (rendered from _layout)
│ ├── src/
│ │ ├── lib/ # setup utils (supabaseClient, auth helpers)
│ │ │ ├── auth.ts
│ │ │ └── supabaseClient.ts
│ │ ├── constants/ # shared config (fantasy rules, etc.)
│ │ │ └── fantasyRules.ts
│ │ ├── hooks/ # reusable logic (data/state)
│ │ │ ├── useMatchEvents.ts
│ │ │ └── usePlayers.ts
│ │ ├── components/ # reusable UI pieces
│ │ │ ├── PlayerCard.tsx
│ │ │ ├── FilterBar.tsx
│ │ │ └── BudgetBar.tsx
│ │ └── types/ # shared TS types (Player, FantasyTeam, etc.)
│ ├── assets/
│ ├── .env # EXPO_PUBLIC* vars (never commit)
│ ├── app.json
│ ├── package.json
│ └── tsconfig.json
├── services/ # server-side utilities (later)
│ └── README.md # placeholder until services land
├── supabase/
│ ├── README.md # how to apply database migrations
│ └── migrations/ # SQL files / schema changes
└── README.md

---

## Naming Rules
- **Screens (in `/app`)**: lowercase file names → `players.tsx`, `squad.tsx`.
- **Components**: `PascalCase` → `PlayerCard.tsx`, `BudgetBar.tsx`.
- **Hooks**: `camelCase` → `usePlayers.ts`, `useTeamBuilder.ts`.
- **Types**: `PascalCase` files → `Player.ts`, `FantasyTeam.ts` in `/src/types`.

---

## Layer Rules (do not violate)
- **Screens** use **hooks** and **components**. Screens do **not** call Supabase directly.
- **Hooks** handle data/state and may use `/src/lib/supabaseClient`.
- **Components** are presentational (no DB calls, no navigation side-effects).
- **Supabase client** exists **once** at `/src/lib/supabaseClient.ts`.
- **Expo Router entry point:** With expo-router, use `expo-router/entry` as the main entry point. Do not use `index.ts` or `App.tsx` as root files. `_layout.tsx` is the canonical navigation entry.
- **Roster rules:** UI and hooks (e.g., `TeamBuilder`) must import counts from `apps/mobile/src/constants/fantasyRules.ts` instead of hardcoding totals.

---

## Shared Dependencies (mobile)
- Expo Router, React Native, TypeScript
- `@supabase/supabase-js`
- `@react-native-async-storage/async-storage` (auth persistence)
- *(Optional later)* nativewind/Tailwind for styling

---

## Standard Imports
From a screen:
```ts
import { usePlayers } from '../src/hooks/usePlayers';
import { PlayerCard } from '../src/components/PlayerCard';
import { getSupabaseClient } from '../src/lib/supabaseClient';
```
From a component:
```ts
import { Player } from '../src/types/Player';
```
Note: Supabase SQL views (player_match_points, fantasy_team_match_points) exist server-side only.
