# Vote Them Off the Road

Source code for **https://votethemofftheroad.com/**. New Hampshire is the first launch state.

## Current state

- Responsive static homepage, New Hampshire page, community guidelines and privacy notice.
- Full-stack Cloudflare Worker with static asset fallback.
- Cloudflare D1 database binding named `DB`, pointing to `votethemofftheroad-prod`.
- The schema in `migrations/0001_initial_schema.sql` defines `incidents`, `incident_media`, `votes`, and `reports`.
- Public incident submissions, up to five photos, off/pass voting, and abuse reports are live.
- The protected `/admin/` dashboard manages moderation. Optional jury engagement features activate after migrations 0002 and 0003.

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

## Browser voting (Phase 2C)

- POST `/api/incidents/:id/vote` accepts `{"choice":"off"}` or `{"choice":"pass"}` for published incidents only.
- GET `/api/incidents?state=NH` sets a secure, HttpOnly, SameSite=Lax cookie `vtor_voter` if one is absent. A random browser ID identifies the browser for the voting feature; D1 stores only its SHA-256 hash.
- Returning visitors see their selected vote via the `my_vote` field. D1 uses an upsert on `(incident_id, voter_key_hash)` so changing a vote replaces the old choice, not adding a second vote.
- `VOTE_RATE_LIMITER` (namespace 2002) is 30 requests/minute per network IP and is approximate across Cloudflare locations. This enforces one stored vote per visitor identifier, not verified one-person-one-vote. Add stronger abuse protection or accounts before expecting robust public rankings.
- Requests must carry the same-site origin and valid JSON. A hidden/removed incident cannot be voted on.
- To inspect counts in D1: `SELECT incident_id, choice, COUNT(*) AS total FROM votes GROUP BY incident_id, choice ORDER BY incident_id, choice;`
- A report or removal request creates a `reports` row with `status='open'`; the incident stays public until an operator hides/removes it. Check the queue daily until admin alerts and one-click hide are built.


## Private Admin Dashboard (Phase 2D)

The administrative dashboard is at `/admin/`. It is **closed by default**, including on workers.dev and preview URLs. The Worker checks a Cloudflare Access **RS256 signed JWT**, its issuer, its application audience, expiry, and the administrator's email before serving any admin HTML or API data.

### Cloudflare Access setup

1. In Cloudflare Zero Trust, open **Access controls > Applications > Add an application > Self-hosted**, then select the production hostname `votethemofftheroad.com` and **path `/admin/*`**. The public site outside this path should remain unprotected.
2. Create an **Allow** policy where the **Emails** selector matches only the intended administrator email address. Never use Everyone or the Login Methods selector by itself. Use an authentication method enabled in Zero Trust (Cloudflare's provider or one-time PIN).
3. Copy the application's **Application Audience (AUD) Tag** from Additional settings, and the Zero Trust team domain from Zero Trust > Settings (e.g. `team.cloudflareaccess.com`).
4. In the existing Worker > Settings > Variables and Secrets add:
   - `ADMIN_ACCESS_TEAM` (Text): the team hostname **without `https://`**, for example `team.cloudflareaccess.com`.
   - `ADMIN_ACCESS_AUD` (Text): the Access application's AUD tag.
   - `ADMIN_EMAIL` (Secret or Text): the **exact** permitted login email.
5. Deploy the settings. Visiting `/admin/` should trigger Cloudflare Access login, then show the dashboard for the approved email only.

The Worker also verifies the Access JWT cryptographically, so Cloudflare Access application rules are not the only line of defense. Do not turn off Access or publish the above configuration values in a public file.

Admin endpoints (all JWT-protected):
- `GET /admin/api/me`
- `GET /admin/api/reports`
- `GET /admin/api/incidents`
- `PATCH /admin/api/reports/:id` with `action`: `reviewing`, `resolve`, `dismiss`, `reopen`, or `hide_and_resolve`.
- `PATCH /admin/api/incidents/:id` with `status`: `published`, `hidden`, `removed`.

The dashboard lets the operator hide a post and resolve its report together. **Reports do not automatically unpublish posts.** The status `removed` means removed from public pages; it does not permanently erase D1 records or R2 photos. Add durable purge, notifications, pagination, and an audit log before substantial traffic.

## Admin notifications and permanent deletion (Phase 2E)

- Authenticated operators can choose **Permanently delete + photos** in `/admin/` and must type `DELETE` to confirm. This calls `DELETE /admin/api/incidents/:id` with a second server-side confirmation (`{ "confirm": "DELETE <incident-id>" }`). The endpoint requires the same signed Access JWT and same-origin checks as all other admin mutations.
- The Worker sets the incident to `removed` before deleting its associated R2 keys, then deletes the D1 incident. SQLite foreign-key cascades remove media metadata, votes and reports. A storage failure leaves the incident hidden for retry. Non-R2 storage is not deleted automatically. Manual database deletion can leave orphaned R2 files.
- Report emails use the existing secret `ADMIN_EMAIL` as recipient; the sender is `alerts@votethemofftheroad.com`. **Email sending is disabled until configured**.
- For free alerts to your own inbox, under Cloudflare **Email Service > Email Routing > Destination Addresses**, add the same email used as `ADMIN_EMAIL` and follow the verification email. Configure the site's sender domain for Email Service if Cloudflare prompts you. Once Email Service is ready, add `"send_email": [{ "name": "REPORT_ALERT_EMAIL" }]` to `wrangler.jsonc`, then deploy. Do not add the binding before Email Service is enabled for the account.
- Every successfully persisted report/removal request schedules a notification through `ctx.waitUntil` without blocking the reporter. Email delivery failure is logged and doesn't reject the report. The email links to the protected dashboard and doesn't disclose the reporter's contact details. When the binding is absent the dashboard reports "Email alerts awaiting setup".

## Phase 3: Moderation automation, categories, weekly rankings, and returning-visitor incentives

### REQUIRED database migration

The production database must be migrated manually by running **migrations/0002_categories_report_moderation.sql** once in Cloudflare D1 `votethemofftheroad-prod`. The Worker deliberately checks the schema first: the public site will keep accepting existing posts and reports before the migration, but category fields, independent-report automatic hides, and category-based rankings will remain inactive. Wait for the latest Worker deployment before running the migration.

### Report moderation rules

- One report per incident per reporting browser, deduplicated using the same anonymous browser cookie hash already used for voting (when available). No raw IP addresses stored in D1.
- HMAC of the reporting network IP is used solely for independent-network counting. A report can still be submitted without a browser cookie or detectable network, but it won't count toward automatic takedown unless both are present. Cookie deletion, NAT and VPNs mean this is **not verified user identity**, and organized abuse may remain possible.
- After **5 distinct reporting browsers from at least 3 distinct networks** report the same published incident during the last **7 days**, its status becomes `hidden`, `auto_hidden_at` records the event, and it is prioritized in the administrator queue. All report reasons count toward this threshold; ordinary off/pass votes do not.
- This is temporary hiding, not automatic deletion, punishment, or a claim that any traffic offense occurred. Explicitly republishing an incident records its reviewed timestamp and clears the auto-hidden flag, so older reports cannot immediately hide it again. Reports remain available for human moderation.
- `AUTO_HIDE_REPORT_THRESHOLD` in Wrangler vars defaults to `5`; validation allows values 3–25. Network diversity minimum remains 3 in the Worker.
- New D1 columns: incident `category`, `auto_hidden_at`, `reviewed_at`; report `reporter_key_hash`, `network_key_hash`, plus a partial unique index on (incident ID, reporter hash).
- Earlier report rows do not qualify for automated hiding, since their anonymous browser/network identities were never collected.

### Categories and engagement

- New submissions can choose a **community-reported driving-behavior category**, such as parking, tailgating, speeding, signals, distracted driving, road rage and more. Existing posts default to `other`.
- The public incident feed supports `?sort=week` and `?category=...`; `GET /api/weekly-board` returns this week's top publicly visible incidents per category and aggregate category counts.
- Weekly board uses Monday **America/New_York** time as the start of the week. It includes incidents first posted during that week and is ranked by votes to take off the road. Do not describe a week's winners as proof of violations or verified identities.
- `GET /api/my-stats` counts distinct incidents voted on by the browser's random voter identifier and assigns "juror" badges. This is browser-level engagement, not user-account identity.
- Individual story links use `/nh/?incident=ID#incidents`, allowing easy sharing without leaking hidden/removed incident content.
- Admin `GET /admin/api/analytics` returns aggregate report reasons and driving-behavior category counts. The admin dashboard sorts auto-hidden incidents first and filters reports by reason, status and urgent auto-hidden state.

Next-stage ideas, not yet implemented: opt-in weekly email summaries, optional verified user accounts and cross-device streak syncing, local region leaderboards, trust-weighted moderation, and followable categories.

### Daily jury duty

The browser-keyed `GET /api/my-stats` endpoint tracks anonymous distinct incident votes, an available-case-aware challenge of up to three new votes per **Eastern Time** calendar day, and a consecutive-Eastern-day participation streak. The browser's server-stored hashed voter identifier is used, not a registered user account. Changing a prior vote does not create a new incident vote or additional participation credit. These streaks and badges can be reset by clearing browser cookies or switching devices, so they are **lightweight participation incentives**, not verified rewards. The weekly jury UI refreshes after votes are saved.

## Phase 4: Daily Jury Duty, challenges, weekly podium and archive

**Deployment and migration order:**

1. Wait until the latest GitHub-connected Worker deployment shows Ready.
2. Apply `migrations/0002_categories_report_moderation.sql` in the Cloudflare D1 Console if it has not already been applied. **Do not re-run its ALTER statements if they already succeeded.**
3. Apply `migrations/0003_jury_games_and_weekly_archive.sql` once in the **same production database**. All its tables use CREATE TABLE IF NOT EXISTS. It is harmless if the migration is re-run, although it should be tracked as applied.
4. Refresh `/nh/`, confirm the week's board and the two jury games load, and run the tests below. The Worker falls back safely when game tables do not yet exist.
5. Cron triggers are defined in `wrangler.jsonc` as `5 4,5 * * 1`. At 00:05 **Eastern Monday**, the Worker archives the previous week's top three qualifying publicly visible incidents in each category and the community's category-submission totals. It executes only during the one schedule slot that actually corresponds to 00:05 Eastern, regardless of DST. See Cloudflare Workers > Settings > Triggers to confirm Cron is deployed.
6. Previous weeks without a stored snapshot are explicitly marked **not finalized**; their live historical rankings can change. Archived result snapshots retain vote counts as they were at archiving, while removing/hiding content prevents the associated incident from appearing publicly.

**Voting and streak rules:**

- Reset is **12:00 AM America/New_York**, automatically following daylight-saving time. The browser displays the countdown to that boundary.
- Each unique incident **first voted on** that day counts toward daily jury duty. Editing a previous vote does **not** add more participation. Daily target is min(3, today's new incident votes plus eligible published cases the browser has not yet voted on).
- Streak activity counts at least one **first-time incident vote** in an Eastern day, or an explicit "caught up" check-in **only when no eligible unvoted cases remain**.
- An eligible juror can rescue **yesterday**, once per Eastern month, if they had three consecutive active days immediately before the missed day. Saved days display as ★ in the streak calendar.
- Everything is browser-anonymous. Cookies, switching devices and deleted posts can affect displayed history, and activity counters do not prove identity. Accounts and cross-device sync are **not implemented**.

**Weekly rankings:**

- Weekly contests run Monday 00:00 through the following Monday 00:00 Eastern.
- Eligible cases were **first submitted during that week** and are currently published. Regular Off/Pass votes accumulate only once per browser/incident; there is no separate weekly vote.
- The live podium displays up to the three highest off-vote cases in each category. An **official weekly award** requires at least `WEEKLY_MIN_VOTES=5` total regular votes **and more Off than Pass votes**. Otherwise the card is provisional/ineligible. Former weeks with archived snapshots show those recorded winners only.
- Users can generate a 1200×630 branded canvas PNG for social sharing. The graphic states that votes are community opinion and not verified traffic violations.
- The configured week/archive selector supports the current week and the previous eight weeks. Admin auto-hiding and permanent removal exclude stories from public podium and archived link displays.

**Additional game endpoints (available after migration 0003):**

- `POST /api/jury/checkin`: maintain an active day only when already caught up with all published incidents.
- `POST /api/jury/streak-save`: one monthly earned rescue, server-validated against genuine preceding activity.
- `GET /api/jury/battle` / `POST /api/jury/battle`: anonymously judge the worse of two currently published incident stories. At most one stored choice per browser per unordered pair. Battles **do not** add Off/Pass votes or affect regular rankings.
- `GET /api/jury/prediction` / `POST /api/jury/prediction`: submit or update one anonymous prediction about the **most-submitted driving category during the upcoming Eastern week**. A prediction is scored only when that future week has an archived, nonzero category total. Tied top categories both count as correct.
- The public site uses rate limiting and same-origin checks for these game writes, and the game endpoints stay disabled when required D1 tables are absent.
- No points or badges reward filing reports or attempting to identify drivers.

**Manual acceptance tests:**

- Voting on a previously unvoted case increases daily progress. Changing that same vote must not increase progress.
- Verify /api/my-stats returns `next_reset_at` and its countdown resets at Eastern midnight, including daylight-saving dates.
- A case with fewer than five votes is labeled provisional, and a Pass-majority case cannot earn an official worst-of-week award.
- After migration 0003 and at least two published cases, head-to-head returns a pairing; submitting once works and repeating the exact pair fails.
- Predict a next-week category, reload, and verify the choice remains. Changing it before next week begins should update the stored preference.
- Run an old test incident's hide action in the admin dashboard and verify it disappears from the public weekly board.
