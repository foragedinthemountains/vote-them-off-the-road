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

## Story submissions and reports (Phase 2)

- Backend: POST /api/incidents, POST /api/incidents/:id/reports, GET /api/config.
- Public writing is closed until TURNSTILE_SITE_KEY (Text) and TURNSTILE_SECRET_KEY (Secret) are set in Cloudflare Worker Settings > Variables and Secrets, and the WRITE_RATE_LIMITER binding is configured.
- Create a Cloudflare Turnstile widget restricted to votethemofftheroad.com. Never commit a secret key to GitHub.
- GET /api/config will report submissions_enabled: true when runtime configuration is active.
- Users can submit text stories at /nh/submit/. Stories publish without routine pre-approval. Optional photo uploads (up to 5) activate when R2 is connected; voting is a future feature.
- Every incident in the NH feed has a report/removal request link. Reports are stored in the private D1 reports table.
- Until we have an admin dashboard and alerts, the site operator must manually monitor the reports queue.
- D1 queue SQL: SELECT id,incident_id,reason,details,contact_email,created_at FROM reports WHERE status='open' ORDER BY created_at DESC;
- To hide a specific incident: UPDATE incidents SET status='hidden', updated_at=unixepoch() WHERE id='REPLACE-WITH-ID';
- Do not announce a broad public launch until removal requests can be handled promptly.

## Optional photo uploads (R2)

- Create a private **Standard** R2 bucket named `votethemofftheroad-photos` in the Cloudflare account. A bucket is required before adding the R2 binding to `wrangler.jsonc`.
- Add `r2_buckets: [{ "binding": "PHOTOS", "bucket_name": "votethemofftheroad-photos" }]` to Wrangler after the bucket exists, then deploy.
- `GET /api/config` includes `photos_enabled`, which stays false until the `PHOTOS` binding is available; text-only submissions keep working meanwhile.
- The browser resizes/re-encodes each photo to a maximum of 1920 pixels and 5 MB in WebP; server checks count, bytes, signatures and MIME. Supported original inputs: JPG, PNG and WebP.
- Media are only served through `/media/:id` after a database check that the parent incident is published. Do not enable public bucket access.
- Existing `incident_media` schema supports photo order; first image acts as cover in the feed's swipe gallery.
- Deleting/hiding an incident does not automatically delete its R2 objects; build an admin purge flow before broad launch.
