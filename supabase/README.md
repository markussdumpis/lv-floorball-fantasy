# Supabase Infrastructure

This directory contains SQL migrations and infrastructure notes for the Supabase project. Run these migrations after provisioning your database to align with the schema described in `context/01_PRD.md` and `context/02_ImplementationPlan.md`.

## Applying Migrations

```bash
supabase db push
# or
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_core_schema.sql
```

The migrations provision:

- `public_players` view (anon-safe player listings)
- Auth-protected fantasy team tables with RLS policies
- Points aggregation views for match and fantasy summaries
- Enum + index helpers required by the scoring pipeline

## Delete Account Flow

Production account deletion is handled server-side via:

- SQL migration `supabase/migrations/20260217113000_delete_account_flow.sql`
- Edge Function `supabase/functions/delete-account/index.ts`

Behavior:

- Writes anonymized season totals to `public.deleted_user_season_summaries` (no user identifier, no PII)
- Deletes user-owned rows via `public.delete_user_data(p_user_id uuid)`
- Deletes auth identity from `auth.users` using Supabase Admin API

Required function secrets:

```bash
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Deploy:

```bash
supabase functions deploy delete-account
```

Tables/rows deleted for a user:

- `public.fantasy_team_players` (by user team ids)
- `public.fantasy_team_captain_periods` (by user team ids)
- `public.fantasy_teams` (`user_id`)
- `public.profiles` (`id`)
- plus `public.leaderboard` / `public.user_season_points` only if those objects are base tables in that environment

## Smoke Tests

Run a quick view sanity check after applying migrations:

```sql
select * from public_players limit 5;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'public_players';
```
