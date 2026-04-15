// Firebase Firestore adapter
// -----------------------------------------------------------------------------
// Dynamically imported by db.js only when window.STACK_RANK_FIREBASE_CONFIG is
// present. Uses Firebase v10 modular SDK from the CDN so there's no build step.
//
// Interface matches LocalDB in db.js — see that file for method signatures.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getFirestore,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where,
  orderBy, limit, serverTimestamp, onSnapshot, increment, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import { loadTemplateCatalog } from './templates-data.js';

export async function createFirebaseDB(config) {
  const app = initializeApp(config);
  const db = getFirestore(app);
  return new FirebaseDB(db);
}

class FirebaseDB {
  constructor(db) {
    this.kind = 'firebase';
    this.db = db;
  }

  async listTemplates() {
    const snap = await getDocs(collection(this.db, 'templates'));
    if (!snap.empty) {
      return snap.docs.map(d => ({ ...d.data(), slug: d.data().slug || d.id }));
    }
    // Fall back to bundled JSON so the UI has something if Firestore is empty
    const catalog = await loadTemplateCatalog();
    return catalog.templates.map(t => ({ ...t, creator: 'system', rankingCount: 0 }));
  }

  async getTemplate(slug) {
    // Prefer doc id = slug for system templates; query for user templates.
    try {
      const d = await getDoc(doc(this.db, 'templates', slug));
      if (d.exists()) return { ...d.data(), slug };
    } catch (e) {
      console.warn('Firestore template read failed:', e);
    }
    const snap = await getDocs(query(collection(this.db, 'templates'), where('slug', '==', slug)));
    if (!snap.empty) {
      const d = snap.docs[0];
      return { ...d.data(), slug };
    }
    // Bundled fallback
    const catalog = await loadTemplateCatalog();
    return catalog.templates.find(t => t.slug === slug) || null;
  }

  async saveTemplate(template) {
    const slug = template.slug || slugify(template.title) + '-' + Math.random().toString(36).slice(2, 6);
    const record = {
      ...template,
      slug,
      creator: 'user',
      createdAt: serverTimestamp(),
      rankingCount: 0,
    };
    await setDoc(doc(this.db, 'templates', slug), record);
    return slug;
  }

  async submitTemplateRanking(slug, order, fingerprint) {
    const ref = doc(this.db, 'templates', slug);
    await runTransaction(this.db, async (tx) => {
      const d = await tx.get(ref);
      if (!d.exists()) throw new Error('Template not found: ' + slug);
      const rankingRef = doc(collection(ref, 'rankings'), fingerprint);
      tx.set(rankingRef, { order, fingerprint, createdAt: serverTimestamp() });
      tx.update(ref, { rankingCount: increment(1) });
    });
  }

  async getAggregateRanking(slug) {
    const ref = collection(doc(this.db, 'templates', slug), 'rankings');
    const snap = await getDocs(query(ref, orderBy('createdAt', 'desc'), limit(500)));
    const rankings = snap.docs.map(d => d.data());
    return computeAggregate(rankings);
  }

  async createRoom(items, creatorName, templateSlug = null) {
    const ref = await addDoc(collection(this.db, 'rooms'), {
      items,
      creator: creatorName,
      templateSlug,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async getRoom(roomId) {
    const d = await getDoc(doc(this.db, 'rooms', roomId));
    if (!d.exists()) return null;
    const room = { id: d.id, ...d.data(), rankings: [] };
    const snap = await getDocs(collection(doc(this.db, 'rooms', roomId), 'rankings'));
    room.rankings = snap.docs.map(r => r.data());
    return room;
  }

  async submitRoomRanking(roomId, order, name, fingerprint) {
    const ref = doc(collection(doc(this.db, 'rooms', roomId), 'rankings'), fingerprint);
    await setDoc(ref, { order, name, fingerprint, createdAt: serverTimestamp() });
  }

  subscribeRoom(roomId, callback) {
    const roomRef = doc(this.db, 'rooms', roomId);
    const ranksRef = collection(roomRef, 'rankings');
    let roomData = null;
    let rankings = [];
    const emit = () => {
      if (!roomData) return;
      callback({ id: roomId, ...roomData, rankings });
    };
    const unsubRoom = onSnapshot(roomRef, (d) => {
      if (d.exists()) { roomData = d.data(); emit(); }
    });
    const unsubRanks = onSnapshot(ranksRef, (snap) => {
      rankings = snap.docs.map(d => d.data());
      emit();
    });
    return () => { unsubRoom(); unsubRanks(); };
  }

  async hasFingerprintRanked(type, key, fingerprint) {
    if (type === 'template') {
      const d = await getDoc(doc(collection(doc(this.db, 'templates', key), 'rankings'), fingerprint));
      return d.exists();
    }
    if (type === 'room') {
      const d = await getDoc(doc(collection(doc(this.db, 'rooms', key), 'rankings'), fingerprint));
      return d.exists();
    }
    return false;
  }
}

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
  const items = [...scores.entries()].map(([label, s]) => ({
    label,
    avgRank: s.totalRank / s.count,
    count: s.count,
  }));
  items.sort((a, b) => a.avgRank - b.avgRank);
  return { items, totalRankers: rankings.length };
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'template';
}
