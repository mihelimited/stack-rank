// Templates browser UI
// -----------------------------------------------------------------------------
// Renders the "Templates" tab on the setup screen: category chips, search,
// grid of cards. Clicking a card loads the items into the game via a
// callback passed in from app.js.

import { getDB } from './db.js';

export class TemplatesBrowser {
  constructor({ root, onPick, onRemix }) {
    this.root = root;
    this.onPick = onPick;
    this.onRemix = onRemix;
    this.activeCategory = 'all';
    this.query = '';
    this.templates = [];
    this.categories = null;
    this._renderSkeleton();
    this._load();
  }

  _renderSkeleton() {
    this.root.innerHTML = `<div class="template-empty">Loading templates…</div>`;
  }

  async _load() {
    const db = await getDB();
    this.templates = await db.listTemplates();
    // Pull categories from data/templates.json directly for the emoji list
    const res = await fetch(new URL('../data/templates.json', import.meta.url));
    const json = await res.json();
    this.categories = json.categories;
    this._render();
  }

  _filtered() {
    return this.templates.filter(t => {
      if (this.activeCategory !== 'all' && t.category !== this.activeCategory) return false;
      if (this.query) {
        const q = this.query.toLowerCase();
        const hay = (t.title + ' ' + (t.description || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  _cardHtml(t) {
    const cat = this.categories.find(c => c.id === t.category);
    const emoji = cat ? cat.emoji : '📋';
    const rankers = t.rankingCount > 0
      ? `<span class="t-badge">${t.rankingCount} ranker${t.rankingCount === 1 ? '' : 's'}</span>`
      : '';
    return `
      <div class="template-card" data-slug="${escapeAttr(t.slug)}" role="button" tabindex="0">
        <div class="t-title">${emoji} ${escapeHtml(t.title)}</div>
        <div class="t-desc">${escapeHtml(t.description || '')}</div>
        <div class="t-meta">
          <span>${t.items.length} items</span>
          ${rankers}
        </div>
        <button
          type="button"
          class="t-remix"
          data-slug="${escapeAttr(t.slug)}"
          title="Remix — edit title and items before ranking"
          aria-label="Remix template">
          <span aria-hidden="true">✎</span> Remix
        </button>
      </div>
    `;
  }

  _render() {
    if (!this.categories) {
      this._renderSkeleton();
      return;
    }

    const chips = [
      `<button class="chip ${this.activeCategory === 'all' ? 'active' : ''}" data-cat="all">All</button>`,
      ...this.categories.map(c => `
        <button class="chip ${this.activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">
          ${c.emoji} ${c.label}
        </button>
      `),
    ].join('');

    const filtered = this._filtered();
    const cards = filtered.map(t => this._cardHtml(t)).join('') ||
      '<div class="template-empty">No templates match.</div>';

    this.root.innerHTML = `
      <input
        type="search"
        class="template-search"
        placeholder="Search templates…"
        value="${escapeAttr(this.query)}"
      >
      <div class="category-chips">${chips}</div>
      <div class="template-grid">${cards}</div>
    `;

    this._wire();
  }

  _wire() {
    this.root.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.activeCategory = chip.dataset.cat;
        this._renderGridAndChips();
      });
    });
    this._wireCards();
    const searchInput = this.root.querySelector('.template-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.query = e.target.value;
        this._renderGridOnly();
      });
    }
  }

  _wireCards() {
    this.root.querySelectorAll('.template-card').forEach(card => {
      const slug = card.dataset.slug;
      const lookup = () => this.templates.find(x => x.slug === slug);

      card.addEventListener('click', (e) => {
        // Clicks on the remix button bubble here; ignore them.
        if (e.target.closest('.t-remix')) return;
        const t = lookup();
        if (t) this.onPick(t);
      });
      // Keyboard a11y: the card is a div with role=button, so handle keys.
      card.addEventListener('keydown', (e) => {
        if (e.target.closest('.t-remix')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const t = lookup();
          if (t) this.onPick(t);
        }
      });
    });
    this.root.querySelectorAll('.t-remix').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slug = btn.dataset.slug;
        const t = this.templates.find(x => x.slug === slug);
        if (t && this.onRemix) this.onRemix(t);
      });
    });
  }

  // Partial re-renders so the search input doesn't lose focus / cursor
  _renderGridOnly() {
    const grid = this.root.querySelector('.template-grid');
    if (!grid) return this._render();
    const filtered = this._filtered();
    grid.innerHTML = filtered.map(t => this._cardHtml(t)).join('') ||
      '<div class="template-empty">No templates match.</div>';
    this._wireCards();
  }

  _renderGridAndChips() {
    const chipsEl = this.root.querySelector('.category-chips');
    if (chipsEl) {
      chipsEl.querySelectorAll('.chip').forEach(chip => {
        if (chip.dataset.cat === this.activeCategory) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    }
    this._renderGridOnly();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
