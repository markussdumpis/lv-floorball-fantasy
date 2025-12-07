# LFS Season Stats Ingest

This package fetches the Latvian Floorball Federation (LFS) season stats pages for skaters and goalies, parses the tables, and upserts normalized data into Supabase.

## Prerequisites

- Node 18+ (the repo uses `tsx` + ESM)
- Supabase project with `teams` and `players` tables (unique constraint on `(team_id, name)`)
- `.env` file in `services/lfs-ingest/` containing:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
LFS_SKATERS_URL=...
LFS_GOALIES_URL=...
LFS_SKATERS_ENDPOINT=...
LFS_SKATERS_FORM=...
LFS_GOALIES_ENDPOINT=...
LFS_GOALIES_FORM=...
LFS_USER_AGENT=...    # copy from working cURL
LFS_COOKIE=...        # copy from working cURL
# Optional helpers
# DEBUG_SAVE_HTML=1
```

The service role key stays in this package only—do not expose it to client apps.

## Install

```bash
cd services/lfs-ingest
npm install
```

## Usage

- `npm run seed:stats` – one-shot seed that pulls both pages and writes players + teams.
- `npm run refresh:stats` – repeatable update using the same logic (idempotent upserts).

Both commands log counts for processed teams and players. The ingest run calls `public.recompute_prices()` automatically after upserting rows.

## Notes

- Requests use a shared fetch client with retries and a one-second gap to stay polite.
- Parsers are header-driven and tolerate Latvian/English column name variants.
- All numeric values are parsed defensively; missing or malformed values land as `null`.
- Set `DEBUG_SAVE_HTML=1` to persist the raw HTML under `.cache/` for troubleshooting.
- When the AJAX endpoints return zero rows, the raw payload is written to `.cache/last_skaters.json` or `.cache/last_goalies.json` for debugging.
