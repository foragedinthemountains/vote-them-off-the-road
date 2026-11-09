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
- The live Worst podium displays up to three highest **Off + unique-browser head-to-head win scores** in each category. An **official weekly award** requires at least `WEEKLY_MIN_VOTES=5` combined reactions/duel points and a Worst score exceeding Pass + Funny reactions. Otherwise the card is provisional/ineligible. Former weeks with archived snapshots show those recorded winners only.
- Users can generate a 1200×630 branded canvas PNG for social sharing. The graphic states that votes are community opinion and not verified traffic violations.
- The configured week/archive selector supports the current week and the previous eight weeks. Admin auto-hiding and permanent removal exclude stories from public podium and archived link displays.

**Additional game endpoints (available after migration 0003):**

- `POST /api/jury/checkin`: maintain an active day only when already caught up with all published incidents.
- `POST /api/jury/streak-save`: one monthly earned rescue, server-validated against genuine preceding activity.
- `GET /api/jury/battle` / `POST /api/jury/battle`: anonymously judge the worse of two currently published incident stories. At most one stored choice per browser per unordered pair. Battles **do not** change the original Off/Pass/Funny reaction totals. Eligible same-category, same-week duel wins **do** add independent points to weekly award rankings.
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

## Phase 4B: Voting-first navigation and direct sharing

- The New Hampshire page starts with a compact hero and **immediately presents the incident voting board**. Weekly results, daily jury duty, and jury games follow below on the same page. The redundant oversized intro panel was removed.
- `/nh/` includes a responsive jump-navigation component: desktop-wide left rail, sticky horizontally scrollable tabs on smaller screens, section anchors and active-section highlighting in `assets/jump.js`.
- Every published incident includes a prominent **Share on Facebook** link opening Facebook's share dialog plus a **Share this case** menu for X, Reddit, WhatsApp, copying the incident permalink, or device-native sharing when supported. Sharing is initiated by the visitor; the site cannot publish to a social account automatically.
- Shared links take the form `/nh/?incident=ID#incidents`. Facebook, X, and Reddit sharing URLs omit the fragment, leaving `/nh/?incident=ID`. When the matching public post is not in the first feed page, the browser fetches it by ID and scrolls to the case.
- A Worker-first route for **`/nh/`** adds case-specific Open Graph and Twitter metadata on query-param requests. It only reads **published** incidents, uses an escaped case title, non-accusatory standard description and an optional public cover-photo URL, and returns `Cache-Control: private, no-store`. Other NH page requests continue through Cloudflare static assets.
- Social networks may cache a preview after a link has been shared. Hiding/deleting a case removes the public site and its media response, but cannot guarantee immediate deletion of third-party cached previews.

## Phase 4C: Return-visitor case discovery (no new migration)

- The New Hampshire feed defaults to **Not voted yet** for ordinary visits, using the existing anonymous, hashed browser-voter ID. Arriving from a specific social permalink defaults to **Newest** so the shared incident appears even if the visitor already voted on it.
- `GET /api/incidents?sort=unvoted&state=NH&offset=N` checks D1 for published incidents that do not have a vote associated with the current browser. On first visits with no cookie, all public incidents qualify. The endpoint accepts newest, top, week, or unvoted, optionally category, and uses 20-case pagination with `has_more` and `next_offset`. Offset is validated as an integer between 0 and 2000.
- The **Load more cases** button appends the next 20 cases. Filter or sort changes start from the first page. Shared-case inserts are deduplicated when a paginated result later contains that same incident.
- `GET /api/featured-case` picks one of the 60 most recently submitted **published** New Hampshire incidents using a deterministic hash of the Eastern day. The same incident is picked across visitors that day unless its publication status changes. It rechecks publication status before returning; unpublished/removed stories are excluded. Returns `next_reset_at` and shares the regular voting cookie.
- The featured-card panel links to that case's normal voting buttons and provides one-click Facebook sharing. Ordinary off/pass votes and anonymous jury duty progress remain unchanged.
- The Daily Jury Duty shortcut now switches the feed to **Not voted yet**. The homepage CTA navigates directly to the voting section.

Acceptance checks:
1. Open `/nh/`: the first filter is **Not voted yet**; today's featured card appears above the feed.
2. Vote on an unjudged case. Refresh the unvoted feed: that case should disappear from the list, but continue appearing under **Newest**.
3. Switch filters and click Load More when there are more than 20 cases. Each page should append without duplicates.
4. Open a public `/nh/?incident=<id>#incidents` shared URL in a browser that has already voted on it. The specific case should be visible.
5. Hide the featured incident in admin and reload. It must not be returned by the featured endpoint or visible in public feeds.
6. Before migrations 0002 and 0003 are applied, basic new/unvoted filtering, pagination, and featured cases should still function because they use only original D1 tables.

## Phase 4D: That's Just Funny reactions and Funniest Moment of the Week

**Activate with one non-destructive migration:** `migrations/0004_funniest_reactions.sql` in Cloudflare D1 `votethemofftheroad-prod`. Run after migrations 0002 and 0003. The migration creates `votes_v4` with allowed choices `off`, `pass`, `funny`, copies all existing original votes and their timestamps via INSERT OR IGNORE, indexes the new table, creates `weekly_funny_awards`, and inserts a final readiness marker in `humor_migration_complete`. **The old `votes` table is not dropped or changed.**

The Worker uses the original `votes` table until `humor_migration_complete` contains `id=1` and the new tables exist. Afterward, *all site voting, admin vote counts, daily jury duty, streak calculation and weekly competitions* use `votes_v4`. After migration, use `votes_v4` for checking current totals: `SELECT choice, COUNT(*) FROM votes_v4 GROUP BY choice;`. The original `votes` remains a read-only legacy snapshot. This switch is safe for existing data; during a migration, keep an eye on concurrent writes in the brief activation window.

- One mutually exclusive reaction per browser/incident, with the ability to change from Off or Pass to Funny or vice versa; no credit for repeated votes on the same incident.
- New submission category: `funny_unexpected` ("Funny / Unexpected"). Existing incidents stay in their original categories until the protected admin category selector changes them.
- `GET /api/config` and `GET /api/incidents` expose `funny_enabled`; browser hides the third button until migration activates.
- `GET /api/weekly-funniest?offset=N` (N=0..12) shows the top three published cases first submitted in that Eastern calendar week, ranked by Funny reactions **across all categories**. An official award requires at least 5 total reactions and a **majority** to be Funny (funny > off+pass). Other cards remain provisional. Archived awards use snapshot counts.
- Explicitly funny category cases are excluded from the "Worst of the Week" competition. Other categories can still be nominated as funny when voters react that way.
- The Monday Eastern scheduled job archives the top three qualifying Funny-majority cases into `weekly_funny_awards` alongside regular `weekly_awards` and `weekly_snapshots`. Hidden/removed cases disappear from public leaderboards.
- The "Funniest Moment of the Week" panel appears inside `/nh/#weekly`, follows the same past-week selector, and offers voting links, a Facebook share, and the existing branded winner graphic.
- `/admin/` now includes each incident's Funny total and a **Save category** dropdown. This can recategorize the blue heron story without reposting it.
- Casual Funny reactions are not evidence of a traffic offense, do not trigger content removal, and do not earn extra points beyond the normal one-reaction-per-case Jury Duty rule.

**After applying 0004**, verify these console queries:

```sql
SELECT (SELECT COUNT(*) FROM votes) AS original_votes,
       (SELECT COUNT(*) FROM votes_v4) AS new_reactions;
SELECT id, completed_at FROM humor_migration_complete;
```

The new count should initially be at least the original count; after voting resumes, only `votes_v4` is updated. Wait up to 30 seconds for the Worker's schema cache to detect the readiness marker, then refresh `/nh/` and check for the third reaction and new weekly panel.

## Category-specific head-to-head and combined weekly award scores

The site compares only pairs of NH cases **from the exact same category and the same current Eastern Monday–Sunday week**. Visitors who choose a category in the public feed filter get head-to-head pairings *within that selected category*. With just one Funny/Unexpected and one Other case, the head-to-head panel correctly displays a "need two matching cases" message instead of asking users to choose between unrelated stories.

- **Worst of the Week** = one point per Off reaction, plus one point per browser that picks that incident in a head-to-head duel. Qualification requires five combined actions and more Worst points than Pass + Funny reactions. Funny/Unexpected cases are excluded.
- **Funniest Moment of the Week** = one point per Funny reaction, plus one point per browser choosing a Funny/Unexpected case in a comedy duel. Qualification requires five combined actions and more Funny points than Off + Pass reactions. Other categories remain eligible through Funny reactions.
- Regular reaction tallies and duel-win points are shown **separately**, followed by the total weekly score. A browser can vote on an incident normally and also make a duel choice, but cannot inflate a case's weekly duel score by picking that same case across multiple pairings. One distinct browser contributes at most **one duel win point per case per week**, via `COUNT(DISTINCT voter_key_hash)`.
- Battle API prevents a cross-category or stale-week pairing on both display and submission. Invalid cross-category POSTs are rejected. Battle decisions from before this rule change that compare different categories are not included in weekly scoring.
- Only duels **cast within the active week** between cases **first submitted during that week** count toward weekly results. Monday finalization freezes the ranked podium positions; later duels can't change a past week's final standings.
- Uses the existing `battle_votes` records, migrations `0003` and `0004`, and existing archived award tables. **No additional SQL migration is needed.**
- The persistent duel data can be reused for monthly and annual awards, but month/year brackets, separate cutoffs and official archives are **future work**, not currently live.

Acceptance tests: /api/jury/battle should return `pair:null` with a clear explanation when only one Funny and one Other case exist. Adding two cases of the same category in the same Eastern week enables a matchup. A successful duel must increase the winner's `battle_wins` on the weekly board, but must not change the underlying regular reaction totals. Funny-category duels contribute to the Funniest board only.

## Phase 5: Jury XP, Daily Missions, Guess the Verdict, Share My Verdict

**REQUIRED activation:** after 0001-0004 are applied and the latest GitHub Worker build is Ready, execute `migrations/0005_jury_xp_verdict_guess.sql` in the **production** Cloudflare D1 database `votethemofftheroad-prod`. It adds `jury_xp_events`, `jury_verdict_guesses`, and a final `jury_xp_migration_complete` activation marker. It does not change the legacy `votes` or active `votes_v4` schemas. It copies existing `votes_v4` as 10 XP per previously recorded distinct incident reaction, once per browser and incident (idempotent). The historical Eastern date from a fixed -5h offset is approximate around DST; only base XP, not historical daily-mission bonuses, is backfilled. Do not run this before 0004.

**Jury XP ranks:** Jury Member 0, Regular Juror 100, Road Referee 350, Jury Foreperson 1000, Judge 2500, Chief Justice 7000. All are cosmetic/progression milestones; they do not add voting weight or moderation authority.

**XP rewards and safeguards:**
- +10 XP when first voting on a unique incident, including the original data backfill. Changing Off/Pass/Funny later **does not award another 10 XP**. Unique ledger key: `vote:<incident-id>`.
- +20 XP once per Eastern day upon completing the dynamic Daily Jury Duty target (up to 3 first-time incident votes, limited by eligible cases), never granted purely for checking in.
- When every published case has been judged, a `POST /api/jury/checkin` check-in maintains the streak and grants +5 XP at most once per Eastern day. No extra XP for repeat check-ins.
- +5 XP for each of the first **3** valid first-time head-to-head decisions each Eastern day. Each unordered pair is once per browser. A head-to-head decision never changes the underlying Off/Pass/Funny vote.
- +5 XP for each of the first **2** distinct case verdict guesses each Eastern day, plus up to +5 more when a guess correctly predicts the uniquely leading reaction in a tally with at least **2** total votes. Ties do not earn an accuracy bonus. One guess per browser and case for life, and later vote changes don't modify the recorded guess.
- +5 daily return bonus when completing a meaningful action and the same browser completed a qualifying action the previous Eastern day.
- +30 XP for correctly predicting the most-submitted category of a week, only when the week's official category snapshot is archived and has nonzero submissions; ties for most submissions both qualify. Pending credit is settled on a later visit to the Jury XP dashboard. A visitor may change their category prediction before that week begins, but no XP is awarded for changing it.

XP is tracked by anonymous hashed browser identifier, not verified people. Switching devices or clearing cookies can lose continuity; shared/cleared cookies and coordinated abuse can undermine integrity. These values are for playful engagement and should not be presented as verified user reputation.

**Daily missions:** first fresh case verdict; finish dynamically sized Daily Jury Duty (or caught-up check-in); play Guess the Verdict if any case with votes is available; judge a same-category head-to-head if available. Unavailable missions are clearly marked and do not prevent completing Jury Duty. Progress is based on server-side D1 records, not browser local storage.

**Guess the Community Verdict:** `GET /api/jury/verdict-guess?category=...` returns one public, not-yet-guessed case that already has at least one Off, Pass, or Funny reaction, without the tally. `POST /api/jury/verdict-guess` stores a single immutable browser guess, captures the current live totals, reveals the leading reaction and counts, and awards limited Jury XP. Because the public incident board already displays counts, this is a casual instant-reveal mini-game, not a secret prediction market. It does not affect any incident's actual votes, weekly award score, or removal process.

**Share My Verdict:** once a browser has voted on a case, its incident card offers `Share My Verdict`. It generates an original branded **1200x630 PNG**, with title, personal reaction, and a community-opinion disclaimer. On compatible mobile devices, the native share sheet can send the PNG and case permalink. Otherwise the PNG is saved and the existing Facebook button shares the case's social preview URL (visitors attach their saved PNG manually). Clicking Share never awards XP. The site cannot automatically post to a visitor's Facebook account.

**Endpoints:** `GET /api/jury/xp`, `GET /api/jury/verdict-guess`, and `POST /api/jury/verdict-guess`; all mutating actions require same-origin checks and existing rate limiting. These features are gated by the final 0005 marker, and the original public voting/game endpoints continue to work before migration.

**Quick acceptance tests after 0005:**
1. Run `SELECT id FROM jury_xp_migration_complete;` (should return 1); `SELECT kind,COUNT(*) FROM jury_xp_events GROUP BY kind;` should show pre-existing vote XP if votes existed.
2. Open `/nh/#daily-jury` and confirm a Jury XP rank, daily mission cards and progression meter appear.
3. Vote on a previously unjudged case: +10 XP, plus +20 XP if it completes today's dynamic Jury Duty. Change the reaction on that case and verify no additional XP.
4. Guess the Verdict on a case with at least one community reaction. Confirm a single guess reveals the counts, and repeating it yields an error without XP.
5. If enough cases exist, cast an eligible head-to-head decision; check the XP ledger reflects no more than three +5 battle awards per day.
6. Click Share My Verdict on a voted case. On desktop a PNG is saved; on compatible mobile browsers the device share sheet opens. The saved graphic must not contain any invented name or claims.
7. Clear a test cookie to verify progress is browser-scoped (avoid doing this with a real active juror's profile if continuity matters).

## Phase 6: Optional public accounts and incident ownership

**Status:** Code and frontend are prepared in GitHub. Guest ownership turns on only after the 0006 migration; public accounts also require the site's own Clerk instance. Cloudflare Access remains exclusive to the existing protected admin dashboard. Public users never log in through Access.

### Required later: Cloudflare / Clerk activation (do not guess keys)

1. Verify the GitHub deployment that includes `src/ownership.js`, `assets/public-account.js`, and author-management endpoints is **Ready** in Cloudflare Workers.
2. In Cloudflare D1, choose `votethemofftheroad-prod` and run the complete `migrations/0006_optional_accounts_and_ownership.sql` **once** after migrations 0001–0005. This creates `incident_ownership`, `account_voter_links`, `incident_author_edits`, and `ownership_migration_complete`; no existing records are assigned an owner.
3. Verify `SELECT id,completed_at FROM ownership_migration_complete;` returns `id=1`. Visit `/api/account/config` and confirm `ownership_enabled:true` after the Worker cache (~30 seconds). New *guest* submissions will now receive a private management link. The key appears only on the successful submit confirmation and cannot be recovered from D1.
4. **Optional sign-in:** Create a free <https://dashboard.clerk.com/> application for **votethemofftheroad.com**. Configure the site's authorized origin and preferred email/Google sign-in settings. In that app's API keys, obtain the **Publishable Key** (safe for the browser), and the **Frontend API URL** / issuer (e.g. `https://<instance>.clerk.accounts.dev` or its production equivalent).
5. Add **Cloudflare Worker variables** `CLERK_PUBLISHABLE_KEY` (e.g. `pk_live_...`) and `CLERK_ISSUER` (the complete HTTPS issuer URL, no trailing path). Set `CLERK_AUDIENCE` only if you configure an audience claim in the session token. Never add a Clerk secret key to GitHub. This integration verifies Clerk session JWT signatures using the instance JWKS URL and does **not** need a Clerk secret API key for basic session verification.
6. Wait for the refreshed deployment, visit `/api/account/config` again to verify `enabled:true`, then test `/nh/account/`, `/nh/submit/`, and `/nh/manage/` on two browsers and with a logged-out session. If any verification fails, remove the two Clerk vars to turn sign-in off while keeping guest use functional.

### Supported now in the prepared code

- Anonymous and authenticated submissions both remain protected by Turnstile; no account is required. A signed-in submission is linked to the *verified Clerk subject*; guest submissions receive a 256-bit random management token. **Only the SHA-256 token hash** is written to D1; the raw key is shown in the response once, then used in the URL fragment (`#key=...`) of the private management link. URL fragments are not transmitted to the server. The browser sends the key as a custom request header for owner API actions.
- `GET /api/owner/incidents/:id`, `PATCH /api/owner/incidents/:id`, and `DELETE /api/owner/incidents/:id` require the matching guest capability or a valid account JWT with the corresponding author ID. Mutations have Origin checks and throttling, and prevent editing removed posts.
- Self-service edits support headline, story, category, and optional location, but not yet changing photos. A case already receiving votes is automatically hidden after substantive edits and its previous fields are recorded in `incident_author_edits` for admin review. Edits to an already hidden case never automatically republish it. Admin can restore after review.
- Self-service `DELETE` is a **public removal**, not permanent data erasure. Media and private records may be retained for moderation, legal compliance, and abuse response pending an explicit permanent-erasure workflow. UI is intentionally labeled "Remove from public view".
- Signed-in authors can see `GET /api/account/incidents` and manage their posts at `/nh/manage/?id=<id>`. The guest author can claim a post by signing in *while possessing its original private link*. `POST /api/owner/incidents/:id/claim` atomically revokes the old guest token when it attaches the verified account ID.
- `GET /api/account/me` returns the verified account identity's link status. `POST /api/account/link-browser` explicitly and permanently associates a browser's anonymous voter hash with one Clerk user ID, without leaking raw cookies. `GET /api/account/xp` deduplicates `jury_xp_events` by event key across linked browsers, so the account page displays a combined XP rank.
- **Not yet implemented:** merging the same user's votes and streaks across multiple browsers into one canonical identity, self-service photo changes, verified ownership claims for incidents posted before 0006, automated permanent erasure, and public account moderation tools. Do not imply these are live.
- `GET /api/account/config` exposes only the safe publishable key when sign-in is configured and 0006 is active. Guest ownership is gated separately, and can function without Clerk. No public account can access `/admin/` or Cloudflare Access.

### Verification and security test checklist

- Before 0006: submit/vote/report as guests must work exactly as before. `/api/account/config` returns `enabled:false,ownership_enabled:false`. Owner endpoints return a safe 503.
- After 0006: anonymous submission's success confirmation shows a private management link. Copy and test it. Title/description/category edits work; a case with votes becomes hidden pending review. Removing a case makes its public feed and preview disappear.
- An unrelated browser without the key must get 403, and the incident ID alone never grants access. A wrong key must also get 403. A forged Clerk JWT must get 401. A token signed by another Clerk instance, an expired token, or one with incorrect `azp` must be rejected.
- With Clerk configured, log in and create an incident, then verify it appears under My Incidents. In another account it must not appear or be editable. Claim a guest post with its private key and confirm the guest link stops working.
- Signed-in visitors can opt in to linking browser XP on `/nh/account/` and see deduplicated account XP. A browser previously linked to account A must not be silently reassigned to B.
- No new account provider script is fetched before Clerk is configured. No public-member secret or raw management token is checked into GitHub.
