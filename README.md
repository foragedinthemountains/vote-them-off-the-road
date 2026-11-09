# Vote Them Off the Road: Launch Preview

This is a static preview website (no framework or database required) for **VoteThemOffTheRoad.com**.

## Included

- `/` Homepage
- `/nh/` New Hampshire launch page
- `/guidelines/` Preview community rules
- `/privacy/` Preview privacy notice
- `/404.html` Useful not-found page
- Mobile-responsive styling, SVG favicon, sitemap, Cloudflare security headers

**Not yet included:** submission forms, photo uploads, real voting, user accounts, moderation tools, analytics, or a Facebook page link. The sample incident on the homepage is labeled fictional and voting controls are illustrative, not buttons.

## Local preview

In the project folder, run:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000 in a browser. You can also use `npx serve .` if available.

## Deploy through GitHub + Cloudflare Pages (recommended)

1. Create a new GitHub repository (suggestion: `vote-them-off-the-road`).
2. Upload **all files and folders in this directory** to the repository root (NOT the enclosing folder). The repo root should contain `index.html` and `assets/`, `nh/`, `guidelines/`, and `privacy/`.
3. In Cloudflare, go to **Workers & Pages → Create application → Pages → Import an existing Git repository**.
4. Select the repository. Choose **no framework**; set the build command to `exit 0` and the build output directory to `.` (repository root). Leave root directory at its default. Cloudflare documents `exit 0` for a static HTML project.
5. Deploy to a temporary `*.pages.dev` address. Check the homepage and `/nh/` link.
6. Add the purchased domain to Cloudflare and, for the root domain, update your registrar's domain nameservers to the two Cloudflare nameservers assigned to YOUR account. Preserve any existing email-related DNS records.
7. Open **Pages project → Custom domains → Set up a domain** and add `votethemofftheroad.com`. Add `www` separately if desired and configure a redirect to the primary domain.

Cloudflare docs: https://developers.cloudflare.com/pages/get-started/git-integration/ and https://developers.cloudflare.com/pages/configuration/custom-domains/

## After the preview is live

- Customize the homepage and add a genuine Facebook page URL once known.
- Add user-generated incident submissions, image uploads, blur/redaction tools, moderator approval, abuse reporting, and a removal workflow.
- Add one-user-one-vote (or other abuse-resistant) voting, public rankings, and state pages backed by a database (e.g., Supabase).
- Add Cloudflare Turnstile to submission forms with mandatory server-side token verification.
- Update privacy disclosures and legal terms before collecting or publishing user content.
- Consider conversion to SvelteKit to support full server-rendered state pages and submissions, reusing the existing visual design.

## Facebook Page copy

Page category: **Entertainment website** or similar category actually offered by Facebook.

Short bio:
> Bad driving. Public verdict. 🚧 New Hampshire first. Share the ridiculous, vote on the outrageous, and let the internet decide. Coming soon!

Long About:
> Vote Them Off the Road is a community-powered place for the most ridiculous moments behind the wheel. From head-scratching parking jobs to unbelievable road maneuvers, we'll feature moderated, anonymous submissions and let visitors cast their votes. We're starting in New Hampshire and plan to expand state by state. We're here for the laughs, not to identify or harass drivers. Follow for launch updates!

Suggested first pinned post:
> 🚧 New Hampshire, you're first! We’re building Vote Them Off the Road, a place to share the wildest driving moments and let the community vote on them. The website preview is on the way, with moderated submissions and voting to follow. Give the page a follow. We’ll announce when nominations open!
