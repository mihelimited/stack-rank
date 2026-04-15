# Stack Rank — v2 feature plan

## Features requested
1. **Templates** — 50 premade lists (food, sports, films, languages, landmarks, etc.) + user-saved templates
2. **Share podium image** — shareable PNG with top 3 on a podium, remainder in a pile
3. **Friend invites via link** — blind multi-user ranking (hide others' results until you've ranked)
4. **Aggregate rankings for templates** — record each user's ranking on templated lists, show community consensus after they've ranked
5. **Programmatic SEO pages** — for any template with 10+ rankers, auto-publish `/top/<slug>.html` — "Top N films, as ranked by X people"

## Architectural decisions

### Backend: Firebase Firestore + GitHub Pages
- Keep static `index.html` on GitHub Pages (current URL stays working).
- Add Firebase SDK (v10 modular, CDN) to the page for: templates, rooms, rankings, aggregates.
- Firestore API keys are public by design — security comes from rules, not secrecy.
- No new CLI to install; use the Firebase MCP tools already available.

### Firestore data model
```
/templates/{templateId}
  - title: string
  - slug: string          (e.g. "best-films-of-all-time")
  - category: string      (food | sports | films | ...)
  - items: string[]       (text only; image templates v2)
  - creator: "system" | "user"
  - createdAt: timestamp
  - rankingCount: number  (denormalised counter)

/templates/{templateId}/rankings/{rankingId}
  - order: string[]       (array of item strings, best→worst)
  - createdAt: timestamp
  - userFingerprint: string  (anonymous client id for dedupe)

/templates/{templateId}/aggregate (single doc)
  - scores: { [item]: { totalRank: number, count: number } }
  - lastUpdated: timestamp
  - // computed server-side via Cloud Function on write, OR
  - // re-computed client-side on read from N latest rankings (simpler for v1)

/rooms/{roomId}
  - items: string[]
  - creator: string       (display name or fingerprint)
  - createdAt: timestamp
  - templateId?: string   (nullable — if room was created from a template)

/rooms/{roomId}/rankings/{rankingId}
  - order: string[]
  - name: string          (participant display name)
  - userFingerprint: string
  - createdAt: timestamp
```

**Size cap:** Firestore docs are 1 MB. For text items this is fine. **Image items are out of scope** for rooms/templates in v2 — show an explicit "Images are local only" message if the user tries to save an image list as a template.

### Security rules
- Anyone can read `/templates/*` and `/rooms/*`.
- Anyone can create a new template (community contribution) — rate-limited by fingerprint via a count check.
- Anyone can create a new room.
- Anyone can submit a ranking (sub-collection write) — rules check that order has same length as parent items and contains same set.
- No auth required; anonymous fingerprint in localStorage.
- System templates (creator === "system") are only writable via service account (i.e. from the seeding script, not client).

### SEO pages (static, pre-rendered)
- GitHub Action runs hourly.
- Reads Firestore for templates with `rankingCount >= 10`.
- For each, computes aggregate ranking and writes `/top/<slug>.html` with:
  - Title: `Top {N} {Template} — Ranked by {X} People | Stack Rank`
  - Meta description, Open Graph, Twitter card
  - JSON-LD `ItemList` structured data
  - H1, ordered list, last-updated stamp, CTA to play the game
- Committed to `main`, Pages rebuilds automatically.
- `/top/index.html` lists all generated pages.
- `sitemap.xml` regenerated too.

## Build order (incremental, each step is independently testable)

### Step 1 — Templates (client-only)
- [ ] Hand-curate 50 text templates across 10 categories, 10 items each, in `data/templates.json`
- [ ] Redesign setup screen: tabs become `Text · Images · Templates`
- [ ] Template browser: category filter chips, searchable grid, click to load
- [ ] Verify: browse → load → rank → results

### Step 2 — Shareable podium image (canvas, no backend)
- [ ] After results, "Share as image" button
- [ ] Canvas renderer: 1200×630 OG-sized, title, #1 podium (tall center), #2 (left), #3 (right), remaining items in a tilted "pile" below
- [ ] Stack Rank branding + link
- [ ] Download PNG + Web Share API fallback
- [ ] Verify: rank a list → share → downloads a valid PNG

### Step 3 — Firebase setup
- [ ] Create Firebase project `stack-rank` (or reuse)
- [ ] Enable Firestore in native mode, default database
- [ ] Deploy security rules
- [ ] Add Firebase SDK initialisation to index.html with config
- [ ] Seed system templates via a Node script using the Firebase Admin SDK (one-off)

### Step 4 — Aggregate rankings for templates
- [ ] When a user finishes ranking a template, POST their order to `/templates/{id}/rankings`
- [ ] Increment `rankingCount` via transaction
- [ ] After user submits, read latest 500 rankings from the sub-collection, compute average position per item, display "Community ranking" alongside user's result
- [ ] Verify: submit 3 rankings, see average render

### Step 5 — Friend invite rooms
- [ ] "Rank with friends" button on setup screen → asks for display name, creates `/rooms/{id}` with current list, navigates to `?room=<id>`
- [ ] Visiting `?room=<id>` shows name prompt, loads item list, plays the game, submits ranking
- [ ] Results screen: if user hasn't submitted yet → blocked ("Finish ranking to see what your friends chose"). After submit → show all participants' rankings side-by-side + a combined Borda-count leaderboard
- [ ] Real-time via `onSnapshot` so new rankings appear live
- [ ] Copy link button

### Step 6 — User-saved templates
- [ ] On results screen, "Save as template" → asks for title, category, visibility; writes to `/templates/` with `creator: "user"`
- [ ] Templates browser includes community section with a Community tab

### Step 7 — Programmatic SEO pages
- [ ] `scripts/build-seo-pages.mjs` — Node script: Firebase Admin SDK → read templates with ≥10 rankings → render HTML via template literals → write to `top/`
- [ ] `.github/workflows/seo-pages.yml` — hourly cron + manual trigger, runs the script, commits changes
- [ ] Service-account key stored as GitHub secret `FIREBASE_SERVICE_ACCOUNT`
- [ ] `top/index.html` listing page + `sitemap.xml`
- [ ] Verify: manually run script locally with a ≥10-count template, inspect generated page

## Open questions for user
1. **Firebase project** — create new `stack-rank` project or reuse existing?
2. **Image-list features** — OK to scope rooms + shareable templates to **text only** in v2? Images stay local-only. (1 MB Firestore doc limit makes base64 images impractical, and Storage adds auth complexity.)
3. **Moderation** — community-submitted templates go live immediately. OK or should they require manual approval via a `published: false` flag?
4. **SEO page slugs** — auto-generated from title? Any domain preference or stick with `mihelimited.github.io/stack-rank/top/<slug>.html`?
5. **50 templates** — I'll draft them but flag any categories you specifically want beyond: food, sports, films, programming languages, London landmarks, restaurants, games, music, travel destinations, historical figures.
