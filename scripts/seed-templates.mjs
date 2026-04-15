#!/usr/bin/env node
// Seed system templates from data/templates.json into Firestore
// -----------------------------------------------------------------------------
// One-off script to populate the /templates collection with the curated 50.
// Uses the Firebase Admin SDK (bypasses security rules).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   node scripts/seed-templates.mjs

import admin from 'firebase-admin';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  await initFirebase();
  const db = admin.firestore();

  const raw = await fs.readFile(path.join(ROOT, 'data/templates.json'), 'utf8');
  const catalog = JSON.parse(raw);

  console.log(`[seed] Uploading ${catalog.templates.length} system templates`);
  const batch = db.batch();
  for (const tpl of catalog.templates) {
    const ref = db.collection('templates').doc(tpl.slug);
    batch.set(ref, {
      slug: tpl.slug,
      title: tpl.title,
      category: tpl.category,
      description: tpl.description,
      items: tpl.items,
      creator: 'system',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      rankingCount: 0,
    }, { merge: true });
  }
  await batch.commit();
  console.log('[seed] Done.');
}

async function initFirebase() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
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

main().catch(err => {
  console.error('[seed] FATAL:', err);
  process.exit(1);
});
