#!/usr/bin/env node
// Programmatic SEO page builder
// -----------------------------------------------------------------------------
// Generates static HTML under /top/<slug>.html for any template with 10+
// community rankings. Runs hourly via GitHub Actions (see
// .github/workflows/seo-pages.yml).
//
// Reads from Firestore via the Firebase Admin SDK. Expects the service-account
// JSON in the FIREBASE_SERVICE_ACCOUNT env var (set as a GitHub secret).
//
// Locally, you can also run it with GOOGLE_APPLICATION_CREDENTIALS pointing to
// a service-account file, or with FIREBASE_SERVICE_ACCOUNT inline.
//
// Usage: node scripts/build-seo-pages.mjs [--min-rankings=10] [--dry-run]

import admin from 'firebase-admin';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'top');

const SITE_URL = process.env.STACK_RANK_SITE_URL || 'https://mihelimited.github.io/stack-rank';

const args = new Map(
  process.argv.slice(2).map(a => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const MIN_RANKINGS = Number(args.get('min-rankings') || 10);
const DRY_RUN = args.get('dry-run') === 'true';

async function main() {
  await initFirebase();
  const db = admin.firestore();

  console.log(`[seo] Reading templates with rankingCount >= ${MIN_RANKINGS}`);
  const tplSnap = await db.collection('templates')
    .where('rankingCount', '>=', MIN_RANKINGS)
    .get();

  if (tplSnap.empty) {
    console.log('[seo] No templates qualify yet.');
    await fs.mkdir(OUT_DIR, { recursive: true });
    await writeIndex([]);
    await writeSitemap([]);
    return;
  }

  const generated = [];
  for (const tplDoc of tplSnap.docs) {
    const tpl = tplDoc.data();
    console.log(`[seo] Processing: ${tpl.slug} (${tpl.rankingCount} rankers)`);

    // Read the 500 most recent rankings
    const rankSnap = await db.collection(`templates/${tplDoc.id}/rankings`)
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    if (rankSnap.size < MIN_RANKINGS) {
      console.log(`  skipped — only ${rankSnap.size} rankings fetched`);
      continue;
    }

    const aggregate = computeAggregate(rankSnap.docs.map(d => d.data()));
    const html = renderPage({ template: tpl, aggregate, totalRankers: rankSnap.size });
    const outPath = path.join(OUT_DIR, `${tpl.slug}.html`);
    if (DRY_RUN) {
      console.log(`  [dry] would write ${outPath} (${html.length} bytes)`);
    } else {
      await fs.mkdir(OUT_DIR, { recursive: true });
      await fs.writeFile(outPath, html, 'utf8');
      console.log(`  wrote ${outPath}`);
    }
    generated.push({
      slug: tpl.slug,
      title: tpl.title,
      category: tpl.category,
      count: rankSnap.size,
      updatedAt: new Date().toISOString(),
    });
  }

  if (!DRY_RUN) {
    await writeIndex(generated);
    await writeSitemap(generated);
  }
  console.log(`[seo] Done. ${generated.length} pages ${DRY_RUN ? 'planned' : 'generated'}.`);
}

// ---------- Firebase init ----------
async function initFirebase() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const credentials = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
    return;
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return;
  }
  throw new Error(
    'No Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.'
  );
}

// ---------- Aggregate ----------
function computeAggregate(rankings) {
  const scores = new Map();
  for (const r of rankings) {
    for (let i = 0; i < r.order.length; i++) {
      const item = r.order[i];
      const pos = i + 1;
      if (!scores.has(item)) scores.set(item, { totalRank: 0, count: 0 });
      const s = scores.get(item);
      s.totalRank += pos;
      s.count += 1;
    }
  }
  return [...scores.entries()]
    .map(([label, s]) => ({ label, avgRank: s.totalRank / s.count, count: s.count }))
    .sort((a, b) => a.avgRank - b.avgRank);
}

// ---------- HTML rendering ----------
function renderPage({ template, aggregate, totalRankers }) {
  const n = aggregate.length;
  const title = `Top ${n} ${template.title} — Ranked by ${totalRankers} People`;
  const desc = `The definitive community ranking of ${template.title.toLowerCase()}, based on ${totalRankers} real rankings. See the full list with average positions.`;
  const canonical = `${SITE_URL}/top/${template.slug}.html`;
  const playUrl = `${SITE_URL}/?template=${template.slug}`;

  const listItems = aggregate.map((it, idx) => `
    <li class="rank-row">
      <span class="rank-number">#${idx + 1}</span>
      <span class="rank-text">${escapeHtml(it.label)}</span>
      <span class="rank-meta">avg #${it.avgRank.toFixed(2)} · ${it.count} voters</span>
    </li>
  `).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    description: desc,
    url: canonical,
    numberOfItems: n,
    itemListElement: aggregate.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.label,
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} | Stack Rank</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<link rel="stylesheet" href="../styles.css">
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
</head>
<body>
<header>
  <a href="../" class="logo" style="text-decoration:none;">Stack<span>Rank</span></a>
</header>
<main>
  <section class="screen">
    <div class="results-header">
      <h2>${escapeHtml(title.split(' — ')[0])}</h2>
      <p>Ranked by <strong>${totalRankers}</strong> people. Updated ${new Date().toUTCString()}.</p>
      <p style="margin-top:18px;">
        <a class="primary" href="${playUrl}" style="text-decoration:none; display:inline-block;">Rank it yourself →</a>
      </p>
    </div>
    <ol class="ranking" style="max-width:720px; margin:0 auto; list-style:none; padding:0;">
      ${listItems}
    </ol>
    <div class="results-actions">
      <a class="ghost" href="./index.html" style="text-decoration:none;">See all rankings</a>
      <a class="primary" href="${playUrl}" style="text-decoration:none;">Play Stack Rank</a>
    </div>
  </section>
</main>
</body>
</html>
`;
}

async function writeIndex(generated) {
  const list = generated.sort((a, b) => b.count - a.count);
  const body = list.map(p => `
    <li class="rank-row">
      <a href="./${p.slug}.html" style="text-decoration:none; color:inherit; display:flex; align-items:center; gap:14px; flex:1;">
        <span class="rank-text">${escapeHtml(p.title)}</span>
        <span class="rank-meta">${p.count} rankers</span>
      </a>
    </li>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Community Rankings | Stack Rank</title>
<meta name="description" content="The definitive community rankings of films, food, music, and more — all decided by real people, one tap at a time.">
<link rel="canonical" href="${SITE_URL}/top/">
<link rel="stylesheet" href="../styles.css">
</head>
<body>
<header>
  <a href="../" class="logo" style="text-decoration:none;">Stack<span>Rank</span></a>
</header>
<main>
  <section class="screen">
    <div class="results-header">
      <h2>Community <span class="gradient">rankings</span></h2>
      <p>Every list ranked by 10+ people, ordered by popularity.</p>
    </div>
    <ol class="ranking" style="max-width:720px; margin:0 auto; list-style:none; padding:0;">
      ${body || '<li class="rank-row"><span class="rank-text">No community rankings yet.</span></li>'}
    </ol>
  </section>
</main>
</body>
</html>
`;
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), html, 'utf8');
  console.log(`[seo] wrote top/index.html`);
}

async function writeSitemap(generated) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/top/`,
    ...generated.map(p => `${SITE_URL}/top/${p.slug}.html`),
  ];
  const body = urls.map(u => `  <url><loc>${u}</loc><lastmod>${new Date().toISOString()}</lastmod></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log(`[seo] wrote sitemap.xml`);
}

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

main().catch(err => {
  console.error('[seo] FATAL:', err);
  process.exit(1);
});
