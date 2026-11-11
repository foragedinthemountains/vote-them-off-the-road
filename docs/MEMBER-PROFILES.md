# Member profiles and opt-in public author credit

## Features

- Every public page has a visible account avatar/menu. When signed in it shows the selected avatar, public handle or My Account, links to profile/incidents/jury dashboard, and **Sign Out**. When signed out it displays Sign In / Create Account. The protected admin login is still a separate Cloudflare Access session.
- Under **My Jury Account**, members can choose a case-insensitive unique public handle of 3 to 20 letters/numbers/underscores (starting with a letter), choose from eight preset icons, or upload a JPG/PNG/WebP photo. The browser resizes photos to a 320-pixel maximum dimension, then compresses to WebP under 250 KB. The Worker independently enforces a 256 KB byte limit, verifies the binary image signature, and stores the file in the existing private R2 binding.
- A signed-in member may **opt into public author credit per incident**, either when submitting a new incident or afterward from My Incidents. If enabled, public incident cards, featured cases, weekly lists, and funniest lists display **Posted by @username** with an avatar when available.
- Existing and guest posts remain anonymous by default. Public credit can be turned off later. Account ownership and XP are private and independent of this choice. We never identify the *driver*; the displayed user is the **poster**.
- Public avatars are served by `GET /avatars/:id` after validating that the image belongs to a registered profile. Public URLs are unguessable UUIDs and sent with no-store and noindex headers; they should still be treated as public once linked on a case.

## Required one-time D1 migration

**Only after the new GitHub/Cloudflare Worker deployment succeeds**, apply migration 0007 from the repository root:

```bash
npx wrangler d1 execute votethemofftheroad-prod --remote --file=migrations/0007_public_profiles_and_author_credit.sql
```

Or open the Cloudflare D1 production database `votethemofftheroad-prod` in the Cloudflare dashboard and run the SQL from `migrations/0007_public_profiles_and_author_credit.sql` using its SQL editor. Do not run both methods unnecessarily.

The migration adds `public_profiles`, `incident_attribution`, and a completion marker. It is idempotent. It requires migration 0006 to have been applied first. It does **not** modify existing incidents or votes, require new Cloudflare bindings, change WorkOS, or expose old author identities. If migration 0007 is missing, the rest of the site continues to function but profile customization is unavailable.

## After deploying and migrating

1. Open /nh/ signed out; header shows **Sign In**. Public feed and anonymous voting still function.
2. Sign in; header shows **My Account**, and menu includes **Sign Out**. Sign out and confirm it returns to the signed-out state.
3. Visit /nh/account/. Choose an available handle, preset avatar, and Save. Check menu updates. Repeat with an uploaded image. Try Remove photo.
4. Try creating an account with another handle using a different signed-in test account; confirm duplicate handles are rejected even with different capitalization.
5. Submit one incident with the public-author checkbox **off**, and one with it **on**. The first is anonymous; the second shows the member's username/portrait. Confirm guest mode hides credit even if the checkbox had been checked.
6. In **My Incidents**, toggle credit on/off for each post and confirm the public feed reflects your preference on refresh. Another member and a guest cannot change this flag.
7. Verify the published/hidden security rule still holds, profile photos don't affect incident photo cropping, and old incident records remain anonymous until intentionally enabled.

No new subscription or hosted identity provider is added. Production release remains unverified until the actual Cloudflare deploy and D1 migration are completed.
