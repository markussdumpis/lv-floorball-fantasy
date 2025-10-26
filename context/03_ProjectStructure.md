# 03_ProjectStructure.md
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
│ │ └── profile.tsx # Profile/Auth placeholder
│ ├── src/
│ │ ├── lib/ # setup utils (supabaseClient, auth helpers)
│ │ │ └── supabaseClient.ts
│ │ ├── hooks/ # reusable logic (data/state)
│ │ │ └── usePlayers.ts
│ │ ├── components/ # reusable UI pieces
│ │ │ ├── PlayerCard.tsx
│ │ │ ├── FilterChip.tsx
│ │ │ └── BudgetBar.tsx
│ │ └── types/ # shared TS types (Player, FantasyTeam, etc.)
│ ├── assets/
│ ├── .env # EXPO_PUBLIC* vars (never commit)
│ ├── app.json
│ ├── package.json
│ └── tsconfig.json
├── services/ # server-side utilities (later)
│ └── scraper/ # LFS scraping + GPT normalization (server only)
├── supabase/
│ └── migrations/ # SQL files / schema changes (optional)
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
- **App.tsx** is not used with Expo Router (uses expo-router/entry) and should be absent or minimal.

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
import { usePlayers } from '../src/hooks/usePlayers'
import { PlayerCard } from '../src/components/PlayerCard'
import { supabase } from '../src/lib/supabaseClient'
From a component:
import { Player } from '../src/types/Player'
