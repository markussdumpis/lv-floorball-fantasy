# Latvian Floorball Fantasy

A fantasy sports application for Latvian floorball, built with React Native and Expo, powered by Supabase.

## Quickstart

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)
- Expo Go app on your mobile device
- Supabase account and project

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd lv-floorball-fantasy
   ```

2. **Install dependencies**
   ```bash
   cd apps/mobile
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your Supabase credentials
   # Get these from your Supabase project settings
   EXPO_PUBLIC_SUPABASE_URL=your-actual-supabase-url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-actual-anon-key
   ```

4. **Start the development server**
   ```bash
   npx expo start
   ```

5. **Run on device**
   - Install Expo Go on your mobile device
   - Scan the QR code from the terminal/browser
   - The app will load on your device

### Database Setup

The app requires a Supabase database with the following setup:
- `players` table with RLS policies
- `public_players` view exposing limited columns (`id, name, position, team, price, fppg`) for anonymous access
- Fantasy team tables (`gameweeks`, `fantasy_teams`, `fantasy_rosters`, `fantasy_transfers`) with RLS
- Aggregation views (`player_match_points`, `fantasy_team_match_points`)

Apply the SQL migrations in `supabase/migrations/` after provisioning your project:

```bash
supabase db push
# or
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_core_schema.sql
```

If the Supabase environment variables are missing, the mobile app will show a friendly error instead of crashing. Update `.env` with valid credentials to enable authentication and data fetching.

### Documentation

- **Product Requirements**: `/context/01_PRD.md`
- **Implementation Plan**: `/context/02_ImplementationPlan.md`
- **Project Structure**: `/context/03_ProjectStructure.md`
- **UI/UX Guidelines**: `/context/04_UI_UX.md`
- **Workflow Rules**: `/context/06_WorkflowRules.md`
- **Supabase Schema**: `/supabase/migrations/`
- **Backend Services Placeholder**: `/services/`

### Development

This project follows a structured development workflow. See `/context/06_WorkflowRules.md` for detailed process rules and coding standards.

### Features

- **Player Management**: Browse and filter players with pagination
- **Fantasy Teams**: Build and manage fantasy teams with budget constraints
- **Real-time Scoring**: Live score updates during matches
- **Authentication**: User registration and login
- **Responsive Design**: Optimized for mobile devices

### Tech Stack

- **Frontend**: React Native, Expo
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **Language**: TypeScript
- **State Management**: React Hooks
