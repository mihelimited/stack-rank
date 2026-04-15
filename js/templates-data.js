// Templates catalog loader
// -----------------------------------------------------------------------------
// Fetches data/templates.json once and caches it. Used by the LocalDB fallback
// and by the templates browser UI. The Firebase adapter keeps its own copy in
// Firestore, so this file is only hit in local/offline mode.

let _cache = null;
let _inflight = null;

export async function loadTemplateCatalog() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;

  _inflight = fetch(new URL('../data/templates.json', import.meta.url))
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load templates.json: ${res.status}`);
      return res.json();
    })
    .then(data => {
      _cache = data;
      _inflight = null;
      return data;
    })
    .catch(err => {
      _inflight = null;
      throw err;
    });

  return _inflight;
}

export async function getCategories() {
  const cat = await loadTemplateCatalog();
  return cat.categories;
}

export async function getTemplatesByCategory(categoryId) {
  const cat = await loadTemplateCatalog();
  if (!categoryId || categoryId === 'all') return cat.templates;
  return cat.templates.filter(t => t.category === categoryId);
}

export async function getTemplateBySlug(slug) {
  const cat = await loadTemplateCatalog();
  return cat.templates.find(t => t.slug === slug) || null;
}
