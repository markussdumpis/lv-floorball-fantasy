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
