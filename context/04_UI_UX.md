# 04_UI_UX.md — Latvian Floorball Fantasy App

---

## 🎨 Design Philosophy

The app follows a **clean, dynamic, and modern sports UI**, inspired by **Premier League Fantasy**, adapted for Latvian floorball.

Focus points:

* Clear role distinction (F, D, G, Flex)
* Intuitive navigation between Home, Team Builder, and Player List
* Fast readability of player stats and fantasy points
* React Native StyleSheet-based design for Expo + React Native (MVP)

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

React Native StyleSheet example:

```ts
const styles = StyleSheet.create({
  title: {
    color: '#F8FAFC',
    fontWeight: '600',
    fontSize: 18,
  },
});
```

---

## 🧭 Navigation Hierarchy

The app uses **Expo Router** with the following structure:

```
/app
  ├── _layout.tsx  ← Bottom tab navigator
  ├── index.tsx    ← Home
  ├── players.tsx  ← Players list & filters
  ├── squad.tsx    ← Team builder
  ├── profile.tsx  ← Profile/Auth
  └── onboarding/  ← Future expansion
```

**Tabs:**

* `Home` — Overview, upcoming matches, top scorers, your total points
* `Players` — Player list (filter + sort)
* `Squad` — Fantasy team builder (validation + budget)
* `Profile` — User info, team name, and logout
*Emoji Tab Icons:* Tabs use emoji icons as placeholders during MVP. Replace with design system icons in Phase 4 after UI polish (documented here to prevent premature swaps).

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
* Scrollable list of `PlayerCard`s with infinite scroll (20 players per page)
* Loading spinner at bottom during pagination load
* Pull-to-refresh for manual refresh
* Floating button to view selected players
* Empty state: "No players found" with retry button
* Error state: Error message with retry button

**PlayerCard includes:**

* Name, Team, Position, Price, FPPG snapshot
* Add button (state changes to "Added")

**Pagination Behavior:**
* Load initial 20 players on mount
* Auto-load next page when user scrolls near bottom (`onEndReached`)
* Show loading spinner at bottom while fetching next page
* Disable loading when all players loaded or error occurs

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

| Component   | Description                             | StyleSheet Example                                |
| ----------- | --------------------------------------- | ----------------------------------------------------- |
| `Button`    | Primary + secondary variants            | `backgroundColor: '#FF6B00', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8`          |
| `Card`      | Used for players, matches, or summaries | `backgroundColor: '#2D3748', borderRadius: 12, padding: 12, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3`                    |
| `BudgetBar` | Displays remaining credits              | `backgroundColor: '#4A5568', borderRadius: 8, height: 8`                        |
| `Badge`     | For roles (F, D, G, Flex)               | `backgroundColor: '#FF6B00', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12`            |
| `Input`     | Search/filter fields                    | `backgroundColor: '#2D3748', borderColor: '#4A5568', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8` |

---

## 🧠 Interaction & Feedback Guidelines

* Always show **budget counter + formation validity** live
* Use **toast/snackbar** for feedback (added, removed, invalid)
* Apply subtle **motion transitions** (React Native Animated API) for smoothness
* Keep tap targets >= 44px

---

## 🧩 React Native StyleSheet Reference Snippets

Examples for Cursor to follow when generating UI components:

```tsx
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#CBD5E1',
  },
  value: {
    color: '#FF6B00',
    fontWeight: '600',
  },
});

<View style={styles.container}>
  <Text style={styles.title}>My Team</Text>
  <View style={styles.row}>
    <Text style={styles.label}>Remaining budget:</Text>
    <Text style={styles.value}>35.5 credits</Text>
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
2. Apply UI patterns defined above using React Native StyleSheet
3. Add sorting and filtering by position and price
4. Reuse shared components (`Card`, `Button`, `Badge`)
5. **Styling approach:** Use React Native StyleSheet for MVP, avoid NativeWind dependencies

---

**Owner:** Markuss
**Bridge Assistant:** GPT-5 (Latvian Floorball Fantasy)
**Last updated:** 2025-10-26
