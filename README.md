# Vote Them Off the Road

Source code for **https://votethemofftheroad.com/**. New Hampshire is the first launch state.

## Current state

- Responsive static homepage, New Hampshire page, community guidelines and privacy notice.
- Full-stack Cloudflare Worker with static asset fallback.
- Cloudflare D1 database binding named `DB`, pointing to `votethemofftheroad-prod`.
- The schema in `migrations/0001_initial_schema.sql` defines `incidents`, `incident_media`, `votes`, and `reports`.
- **Read-only** incident endpoints and a New Hampshire listing that shows the empty state until actual submissions are available.
- No public posting, uploading, voting, commenting, or reporting endpoints are enabled yet.

## Architecture

- GitHub repository: `foragedinthemountains/vote-them-off-the-road`
- Deployment: Git-connected Cloudflare Worker `vote-them-off-the-road`
- Worker configuration: `wrangler.jsonc`
- Backend entry point: `src/worker.js`
- Static assets served from the repository root; `.assetsignore` prevents Worker source, migrations, and config being published as assets.
- Production domain: `votethemofftheroad.com`
- Database: Cloudflare D1.

## Read-only API

- `GET /api/health` returns `{"ok":true,"database":"connected"}` if D1 is bound and reachable.
- `GET /api/incidents?state=NH&sort=newest` returns the latest 20 published incidents.
- `GET /api/incidents?state=NH&sort=top` sorts by votes to vote off.
- `GET /api/incidents/{id}` returns a published incident or 404.
- All API responses disable caching so hidden/removed content is not retained in feed caches.
- Methods other than GET are disabled. No arbitrary SQL is derived from user input.

## Getting the database ready

The SQL schema must be executed against the **production** D1 database, using the D1 dashboard's Console or the Wrangler D1 migration tooling. The presence of the file in GitHub does not execute the migration.

## Deployment

Cloudflare Builds deploys the Worker from GitHub using `wrangler.jsonc`. A new commit to `main` should trigger a deployment. Confirm the latest deployment is healthy before publishing changes to the public.

Do not commit credentials or API secrets. Turnstile secrets and any future admin credentials belong in Cloudflare Worker secrets, not in this public repository.

## Next milestones

1. Confirm both `/api/health` and `/api/incidents?state=NH` return expected JSON.
2. Set up Cloudflare Turnstile with mandatory server-side token verification and rate limiting.
3. Add a simple real incident submission form, with validation and immediate reporting/removal tools. Routine submissions need not require admin preapproval.
4. Set up R2 image storage with validated file types, size limits, and safe delivery.
5. Add votes with abuse controls and dynamic rankings; expand video support with spending limits.
6. Add individual shareable incident pages, Facebook page integration, analytics, and search indexing.
7. Expand to additional states and monetization after real audience growth.

The goal is entertainment and community voting, not driver identification. Ordinary public-road footage is not subject to a blanket face/plate blurring requirement, but threats, harassment and targeted publication of private contact details are prohibited.
