# Vote Them Off the Road: Brand System v1

**Tagline:** You be the judge.

## Core identity
The canonical mark is the bold black verdict checkmark over a perspective road on a saturated yellow square. Use the exact same source geometry for favicon, PWA icons, wordmarks, social preview and printed material. Avoid alternate checkmarks, mock police seals, or arbitrary traffic-sign imagery.

| Role | Token | Hex |
| --- | --- | --- |
| Brand yellow | `--brand-yellow` | `#FFD200` |
| Brand black | `--brand-black` | `#050505` |
| Cream surface | `--brand-cream` | `#FFFDF5` |
| Asphalt gray | `--brand-gray` | `#3A3A3A` |

Fonts in current web design: **Barlow Condensed** (bold headlines and wordmark) and **DM Sans** (legible controls, body text). Keep readable high contrast; not every surface should be yellow.

## Canonical sources
- `assets/brand/mark.svg`: master artwork and favicon source.
- `assets/favicon.svg`: matching standalone favicon.
- `assets/brand/wordmark-on-dark.svg`: full lockup for dark campaign surfaces.
- `assets/brand/wordmark-on-light.svg`: full lockup for light surfaces.
- `assets/app-192.png`, `assets/app-512.png`: web app manifest icons.
- `assets/app-maskable.svg`: inset artwork for Android adaptive masks.
- `assets/brand/social-default.svg`: 1200×630 editorial/social source, with a clearly marked **SAMPLE INCIDENT**.
- `assets/brand/social-default.png`: rendered social media PNG, generated from that SVG by the brand workflow.
- `assets/brand/apple-touch-180.png`: rendered Apple touch icon.

The PNG outputs are generated from committed SVGs using `scripts/generate_brand_assets.py` and the GitHub Actions brand workflow. The production Worker does **not** depend on a Python runtime, image API, or added paid service.

## Real incident-card anatomy
1. An **uncropped** visitor-submitted photo when available, or a compact text case.
2. The submitted headline, relevant category, approximate location and date.
3. Three **mutually exclusive** actual verdict controls, always displayed in one row on both mobile and desktop: **⚖ Vote Off**, **✓ Pass**, and **☺ Funny**. Keep their real server-side values (`off`, `pass`, `funny`) unchanged.
4. Vote tallies, report options and share links remain functional and outside the static marketing mockup.

**Important:** The homepage and branded social art show a *hypothetical* example, not an actual report. Do not fabricate incident-specific videos, audience counts, police findings, road conditions, dates, or locations in branded defaults. Individual shared incident links retain their own true title and description metadata.

## Public author identity
Users can earn account XP or own incidents without public attribution. Author recognition should be opt-in per incident to protect privacy and prevent harassment/retaliation.

## Rollout checks
After the PR merges, verify the brand image build workflow generates the social PNG and Apple icon. Test a shared root link and a real incident link in Facebook Sharing Debugger and ensure image is 1200×630. Refresh site pages and the installed PWA; verify favicon, manifest and Android/iOS icon use the same checkmark-and-road mark. Test all 3 live vote buttons on mobile and desktop and confirm choices and counts still work.

## Brand zip
The companion `vtor-brand-kit.zip` downloadable file produced during design has PNG and SVG exports for marketing and offline use. It is not required by Cloudflare deployment.
