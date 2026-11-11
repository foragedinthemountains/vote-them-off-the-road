# Public Jury XP Leaderboard

## Why this is opt-in

The public ranking shows **only** members who have explicitly enabled
"Show me on the Jury Leaderboard" under My Jury Account. No existing
account, poster, or guest is enrolled automatically. Posting an incident with
public author credit is a **separate** choice and does not opt anyone into
the leaderboard.

The public payload contains only:
- position, chosen username, preset or uploaded avatar URL;
- XP for the selected period and lifetime XP;
- lifetime game rank and its icon.

It **never** returns WorkOS user IDs, emails, account ID, guest/browser voter
hashes, individual votes, owned incidents, or private moderation records.
Changing the opt-in option to off removes the member from subsequent reads,
though previously saved screenshots cannot be recalled. Clearing a public
username also revokes the opt-in record.

## Scoring and fairness

- **This week**: XP earned during the current Monday-Sunday Eastern Time
  calendar week. The Monday/week boundary matches the jury games.
- **All time**: total account Jury XP, including guest activity that the
  member explicitly linked to their account.
- If the same XP event exists under a linked browser and account, it is
  included only **once** using its event key. Its earliest earning day
  determines which week gets the credit; linking old activity later does not
  create new weekly points.
- Ranks (Regular Juror, Judge, etc.) are based on **lifetime** XP even
  when ranking by weekly XP.
- Ordered by the period score, then username case-insensitively. Up to
  25 public accounts are shown.
- No bonus XP is granted for joining a ranking or posting unverified
  allegations.

The leaderboard is read directly from D1 without per-visitor telemetry,
paid scoring services, or additional cookies. Large future deployments
should consider a scheduled materialized public ranking to avoid computing
the entire scoreboard on every read. Do **not** add public-response caching
that delays opt-out privacy without implementing explicit invalidation.

## Release sequence: one small database migration

First verify the Worker deployment after GitHub merge succeeded.

Then apply migration \`0008\` to the **same** production D1 database where
you successfully applied migration \`0007\`.

**Cloudflare Dashboard method:**

1. Open Cloudflare → Storage & databases → D1 SQL Database.
2. Select \`votethemofftheroad-prod\`, then the **Console**.
3. Open GitHub
   \`migrations/0008_public_juror_leaderboard.sql\`,
   copy **all** its SQL, paste into the Console, and run it.
4. After success, refresh \`/nh/account/\` and visit
   \`/nh/leaderboard/\`.

**Terminal alternative** (only from a cloned repository; not required):

\`\`\`bash
npx wrangler d1 execute votethemofftheroad-prod --remote --file=migrations/0008_public_juror_leaderboard.sql
\`\`\`

The SQL is idempotent, adds no public rows, requires migration 0006 and
0007, and does not rewrite incident, vote, or existing profile tables.
Until migration 0008 is applied, the new leaderboard displays a
configuration notice and the opt-in checkbox stays disabled. Existing
voting, XP, profiles and incidents remain functional.

## Acceptance tests

1. Open the public \`/nh/leaderboard/\` without signing in; it works, but
   does not show accounts that didn't opt in.
2. Under \`/nh/account/#account-profile-panel\`, save a public username.
   Check **Show me on the Jury Leaderboard**, confirm consent and open
   the leaderboard. The account appears with its avatar.
3. Switch This Week / All Time. Confirm the all-time score matches your
   private Jury Dashboard XP; the weekly amount is at most that total.
4. Toggle the setting **off** and refresh the public leaderboard. The
   account disappears. Turning off public *incident author credit* is
   independent from this setting, and vice versa.
5. Test a guest and a signed-in account with no username. Neither should
   appear without explicit consent.
6. Link old guest history from the account dashboard and check its XP
   events aren't counted twice.
7. Inspect the public response at
   \`/api/jury/leaderboard?period=week\`; it contains no account IDs,
   emails or voting keys. Unsupported period values must return 400.
