// Database abstraction layer
// -----------------------------------------------------------------------------
// Two implementations share this interface:
//   * LocalDB   — localStorage fallback. Used when Firebase config is missing.
//                Single-device only. Useful for dev and "I just want to try it".
//   * FirebaseDB — Cloud Firestore. Used when window.STACK_RANK_FIREBASE_CONFIG
//                 is present. Supports cross-device rooms, aggregate community
//                 rankings, and user-saved templates.
//
// Interface:
//   listTemplates()           -> Promise<Template[]>
//   getTemplate(slug)         -> Promise<Template | null>
//   saveTemplate(template)    -> Promise<string>   // slug of saved doc
//   submitTemplateRanking(slug, order, fingerprint)
//                             -> Promise<void>
//   getAggregateRanking(slug) -> Promise<{ items: [{label, avgRank, count}], totalRankers }>
//
//   createRoom(items, creatorName, templateSlug?)
//                             -> Promise<string>   // roomId
//   getRoom(roomId)           -> Promise<Room | null>
//   submitRoomRanking(roomId, order, name, fingerprint)
//                             -> Promise<void>
//   subscribeRoom(roomId, cb) -> () => void        // unsubscribe
//
//   hasFingerprintRanked(type, key, fingerprint)
//                             -> Promise<boolean>

import { loadTemplateCatalog } from './templates-data.js';

// ---------- Helpers ----------
function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function getFingerprint() {
  let fp = localStorage.getItem('stack-rank:fp');
  if (!fp) {
    fp = uid('u-');
    localStorage.setItem('stack-rank:fp', fp);
  }
  return fp;
}

function computeAggregate(rankings) {
  // rankings: Array<{ order: string[] }>
  // Returns: { items: [{label, avgRank, count}], totalRankers }
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

// ---------- LocalDB ----------
class LocalDB {
  constructor() {
    this.kind = 'local';
    this.systemTemplates = null;
  }

  async _loadSystem() {
    if (!this.systemTemplates) {
      this.systemTemplates = await loadTemplateCatalog();
    }
    return this.systemTemplates;
  }

  async listTemplates() {
    const catalog = await this._loadSystem();
    const userRaw = localStorage.getItem('stack-rank:user-templates');
    const userTemplates = userRaw ? JSON.parse(userRaw) : [];
    return [
      ...catalog.templates.map(t => ({ ...t, creator: 'system', rankingCount: this._countRankings(t.slug) })),
      ...userTemplates.map(t => ({ ...t, creator: 'user', rankingCount: this._countRankings(t.slug) })),
    ];
  }

  async getTemplate(slug) {
    const all = await this.listTemplates();
    return all.find(t => t.slug === slug) || null;
  }

  async saveTemplate(template) {
    const raw = localStorage.getItem('stack-rank:user-templates');
    const userTemplates = raw ? JSON.parse(raw) : [];
    const slug = template.slug || uid('t-');
    const existing = userTemplates.findIndex(t => t.slug === slug);
    const record = { ...template, slug, creator: 'user', createdAt: Date.now() };
    if (existing >= 0) userTemplates[existing] = record;
    else userTemplates.push(record);
    localStorage.setItem('stack-rank:user-templates', JSON.stringify(userTemplates));
    return slug;
  }

  _countRankings(slug) {
    const raw = localStorage.getItem(`stack-rank:template-rankings:${slug}`);
    return raw ? JSON.parse(raw).length : 0;
  }

  async submitTemplateRanking(slug, order, fingerprint) {
    const key = `stack-rank:template-rankings:${slug}`;
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    // Dedupe by fingerprint
    const existing = list.findIndex(r => r.fingerprint === fingerprint);
    const record = { order, fingerprint, createdAt: Date.now() };
    if (existing >= 0) list[existing] = record;
    else list.push(record);
    localStorage.setItem(key, JSON.stringify(list));
  }

  async getAggregateRanking(slug) {
    const raw = localStorage.getItem(`stack-rank:template-rankings:${slug}`);
    const rankings = raw ? JSON.parse(raw) : [];
    return computeAggregate(rankings);
  }

  async createRoom(items, creatorName, templateSlug = null) {
    const roomId = uid('r-');
    const room = {
      id: roomId,
      items,
      creator: creatorName,
      templateSlug,
      createdAt: Date.now(),
      rankings: [],
    };
    localStorage.setItem(`stack-rank:room:${roomId}`, JSON.stringify(room));
    return roomId;
  }

  async getRoom(roomId) {
    const raw = localStorage.getItem(`stack-rank:room:${roomId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async submitRoomRanking(roomId, order, name, fingerprint) {
    const key = `stack-rank:room:${roomId}`;
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Room not found');
    const room = JSON.parse(raw);
    const existing = room.rankings.findIndex(r => r.fingerprint === fingerprint);
    const record = { order, name, fingerprint, createdAt: Date.now() };
    if (existing >= 0) room.rankings[existing] = record;
    else room.rankings.push(record);
    localStorage.setItem(key, JSON.stringify(room));
    // Emit storage event across the same-origin tabs
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(room) }));
  }

  subscribeRoom(roomId, callback) {
    const key = `stack-rank:room:${roomId}`;
    const handler = (e) => {
      if (e.key === key) {
        const raw = localStorage.getItem(key);
        if (raw) callback(JSON.parse(raw));
      }
    };
    window.addEventListener('storage', handler);
    // Fire initial
    this.getRoom(roomId).then(r => r && callback(r));
    return () => window.removeEventListener('storage', handler);
  }

  async hasFingerprintRanked(type, key, fingerprint) {
    if (type === 'template') {
      const raw = localStorage.getItem(`stack-rank:template-rankings:${key}`);
      if (!raw) return false;
      return JSON.parse(raw).some(r => r.fingerprint === fingerprint);
    }
    if (type === 'room') {
      const room = await this.getRoom(key);
      return !!room && room.rankings.some(r => r.fingerprint === fingerprint);
    }
    return false;
  }
}

// ---------- FirebaseDB (stub — wired up when SDK is loaded) ----------
// Lives in db-firebase.js. Imported dynamically only if config is present.
async function createFirebaseDB(config) {
  const mod = await import('./db-firebase.js');
  return mod.createFirebaseDB(config);
}

// ---------- Export singleton ----------
let _db = null;

export async function getDB() {
  if (_db) return _db;
  const config = window.STACK_RANK_FIREBASE_CONFIG;
  if (config && config.apiKey) {
    try {
      _db = await createFirebaseDB(config);
      console.log('[stack-rank] Using Firebase backend');
      return _db;
    } catch (e) {
      console.warn('[stack-rank] Firebase init failed, falling back to local:', e);
    }
  }
  _db = new LocalDB();
  console.log('[stack-rank] Using local backend (single-device)');
  return _db;
}

export { getFingerprint, computeAggregate };
