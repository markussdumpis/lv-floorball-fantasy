# 04_UI_UX.md — Latvian Floorball Fantasy App

## 🎨 Design Philosophy

The app follows a **clean, dynamic, and modern sports UI**, inspired by **Premier League Fantasy**, adapted for Latvian floorball.

Focus points:

* Clear role distinction (F, D, G, Flex)
* Intuitive navigation between Home, Team Builder, and Player List
* Fast readability of player stats and fantasy points
* NativeWind-based responsive design for Expo + React Native

---

## 🎨 Color Palette & Typography

**Primary Colors:**

* `bg-primary`: `#1E293B` (dark navy — base background)
* `bg-accent`: `#FF6B00` (floorball orange highlight)
* `bg-card`: `#2D3748` (card surfaces)
* `text-primary`: `#F8FAFC`
* `text-secondary`: `#CBD5E1`

**Status Colors:**

* Success: `#22C55E`
* Warning: `#EAB308`
* Error: `#EF4444`

**Fonts:**

* **Headings:** Inter SemiBold
* **Body:** Inter Regular
* **Numeric Data (e.g., points):** Inter Bold

Tailwind-style example:

```ts
className="text-white font-semibold text-lg"
```

---

## 🧭 Navigation Hierarchy

The app uses **Expo Router** with the following structure:

```
/app
  ├── (tabs)/
  │   ├── home.tsx
  │   ├── players.tsx
  │   ├── team.tsx
  │   ├── profile.tsx
  ├── _layout.tsx  ← Bottom tab navigator
  ├── onboarding/  ← Future expansion
```

**Tabs:**

* 🏠 `Home` — Overview, upcoming matches, top scorers, your total points
* 🧑‍🤝‍🧑 `Players` — Player list (filter + sort)
* ⚙️ `Team` — Fantasy team builder (validation + budget)
* 👤 `Profile` — User info, team name, and logout

---

## 📱 Screen Layouts

### 🏠 HomeScreen

* Header with app name + total points
* Section: Upcoming matches
* Section: Top performers (carousel style)
* Section: Team summary shortcut

**Components:**

* `MatchCard` — opponent logos, date, time
* `PlayerMiniCard` — small cards with top player names + points

### 🧑‍🤝‍🧑 PlayerListScreen

* Search bar + filters (by position, team, price)
* Scrollable list of `PlayerCard`s
* Floating button to view selected players

**PlayerCard includes:**

* Name, Team, Position, Price, Points
* Add button (state changes to “Added”)

### ⚙️ TeamBuilderScreen

* Formation layout grid (5F, 3D, 1G, 1 Flex)
* Budget and remaining credits bar
* Validation feedback (real-time)
* Captain selection UI (radio highlight)

**UI Components:**

* `PlayerSlotCard` — placeholder or selected player
* `BudgetBar` — dynamic width progress bar
* `ConfirmButton` — active only when team is valid

### 👤 ProfileScreen

* Team name + edit option
* Season total points
* Logout button

---

## 🧩 Reusable Components Library

| Component   | Description                             | Tailwind Style Example                                |
| ----------- | --------------------------------------- | ----------------------------------------------------- |
| `Button`    | Primary + secondary variants            | `bg-accent text-white rounded-2xl px-4 py-2`          |
| `Card`      | Used for players, matches, or summaries | `bg-card rounded-xl p-3 shadow-md`                    |
| `BudgetBar` | Displays remaining credits              | `bg-gray-700 rounded-full h-2`                        |
| `Badge`     | For roles (F, D, G, Flex)               | `bg-accent text-xs px-2 py-1 rounded-full`            |
| `Input`     | Search/filter fields                    | `bg-card border border-gray-600 rounded-xl px-3 py-2` |

---

## 🧠 Interaction & Feedback Guidelines

* Always show **budget counter + formation validity** live
* Use **toast/snackbar** for feedback (added, removed, invalid)
* Apply subtle **motion transitions** (`framer-motion/native`) for smoothness
* Keep tap targets >= 44px

---

## 🧩 NativeWind Class Reference Snippets

Examples for Cursor to follow when generating UI components:

```tsx
<View className="flex-1 bg-primary px-4 py-2">
  <Text className="text-xl font-bold text-white mb-2">My Team</Text>
  <View className="flex-row justify-between items-center">
    <Text className="text-gray-300">Remaining budget:</Text>
    <Text className="text-accent font-semibold">35.5 credits</Text>
  </View>
</View>
```

---

## 🧭 Design Reference Summary

| Screen       | Key Components                           | Goal                        |
| ------------ | ---------------------------------------- | --------------------------- |
| Home         | MatchCard, PlayerMiniCard                | Quick overview + engagement |
| Player List  | PlayerCard, FilterBar                    | Easy discovery + selection  |
| Team Builder | PlayerSlotCard, BudgetBar, ConfirmButton | Team creation & validation  |
| Profile      | InfoCard, LogoutButton                   | Personalization & control   |

---

## ✅ Next Steps for Cursor

1. Implement `PlayerListScreen` using Supabase data (players table)
2. Apply UI patterns defined above
3. Add sorting and filtering by position and price
4. Reuse shared components (`Card`, `Button`, `Badge`)

---

**Owner:** Markuss
**Bridge Assistant:** GPT-5 (Latvian Floorball Fantasy)
**Last updated:** 2025-10-26
