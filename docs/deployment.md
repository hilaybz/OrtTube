# Deployment (Vercel)

Local setup is in [`CLAUDE.md`](../CLAUDE.md). This covers production.

## Environment variables

| Variable | Notes |
| --- | --- |
| `ANTHROPIC_API_KEY` | read implicitly by the Anthropic SDK |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; bypasses RLS |
| `TRANSCRIPT_BUCKET` | `transcripts` |
| `CRON_SECRET` | guards `/api/jobs/*`; Vercel Cron sends it |
| `ADMIN_SECRET` | guards `/api/admin/*`; must differ from `CRON_SECRET` |
| `YOUTUBE_PROXY_URLS` | production only; see below |

Optional, defaulted: `GC_VIDEO_GRACE_MINUTES`, `PURGE_RETENTION_DAYS`,
`RECONCILE_AUTH_MINUTES`, `TRANSCRIPT_TTL_DAYS`.

Never set `SUPABASE_DB_URL` in production. Only the test harness reads it, and
it truncates every table.

## YouTube egress

YouTube refuses caption downloads from datacenter IPs, including Vercel's.
Production needs a **rotating residential** proxy pool in `YOUTUBE_PROXY_URLS`
(comma-separated, `http://user:pass@host:port` or `host:port:user:pass`). Exits
that answer 403, 429 or a bot check are skipped and their connection dropped so
the next request gets a new IP. Empty means no proxy, which is right locally and
is the production kill switch. `npm run probe:proxy` verifies a pool by fetching a
real subtitle track.

## Scheduled jobs

[`vercel.json`](../vercel.json) schedules the five job endpoints daily (content
purge weekly). Vercel Cron issues GET, so each job route exports `GET = POST`.
