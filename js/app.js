// Main app wiring
// -----------------------------------------------------------------------------
// Glues together: setup screen (text/image/templates), game screen, results
// screen, room lobby, and the various "load" flows (fresh list / template /
// room-invite URL).

import { InteractiveMergeSort, estimateComparisons } from './sorter.js';
import { getDB, getFingerprint, computeAggregate } from './db.js';
import { TemplatesBrowser } from './templates.js';
import { sharePodium, downloadPodium } from './podium.js';
import { getRoute, setRoute, onRouteChange } from './router.js';

// ---------- State ----------
const state = {
  mode: 'text',          // 'text' | 'image' | 'templates'
  items: [],             // current game items
  sorter: null,
  comparisonsDone: 0,
  totalEstimate: 0,
  source: null,          // { kind: 'fresh'|'template'|'room', slug?, roomId?, title? }
  imageItems: [],
  roomUnsub: null,
};

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const setupScreen = $('setupScreen');
const gameScreen = $('gameScreen');
const resultsScreen = $('resultsScreen');
const roomScreen = $('roomScreen');

// Setup
const tabs = document.querySelectorAll('.tab');
const textPanel = $('textPanel');
const imagePanel = $('imagePanel');
const templatesPanel = $('templatesPanel');
const browseTemplatesRoot = $('browseTemplates');
const textInput = $('textInput');
const fileInput = $('fileInput');
const fileDrop = $('fileDrop');
const thumbs = $('thumbs');
const itemCount = $('itemCount');
const startBtn = $('startBtn');
const inviteBtn = $('inviteBtn');
const errorMsg = $('errorMsg');

// Game
const cardLeft = $('cardLeft');
const cardRight = $('cardRight');
const gameSubtitle = $('gameSubtitle');

// Results
const resultsSubtitle = $('resultsSubtitle');
const ranking = $('ranking');
const communityRanking = $('communityRanking');
const resultsColumns = $('resultsColumns');
const yourColumnHeading = $('yourColumnHeading');
const communityColumn = $('communityColumn');
const restartBtn = $('restartBtn');
const copyBtn = $('copyBtn');
const shareBtn = $('shareBtn');
const saveTemplateBtn = $('saveTemplateBtn');
const blockerBanner = $('blockerBanner');

// Room lobby
const roomTitle = $('roomTitle');
const roomParticipants = $('roomParticipants');
const roomStartBtn = $('roomStartBtn');
const inviteLinkInput = $('inviteLinkInput');
const copyLinkBtn = $('copyLinkBtn');
const roomHint = $('roomHint');

// Progress
const progressWrap = $('progressWrap');
const progressText = $('progressText');
const progressFill = $('progressFill');

// Modals
const nameModal = $('nameModal');
const nameModalInput = $('nameModalInput');
const nameModalSubmit = $('nameModalSubmit');
const saveTemplateModal = $('saveTemplateModal');
const saveTemplateTitle = $('saveTemplateTitle');
const saveTemplateCategory = $('saveTemplateCategory');
const saveTemplateSubmit = $('saveTemplateSubmit');
const saveTemplateCancel = $('saveTemplateCancel');

// ---------- Initialisation ----------
let templatesBrowser = null;
let homepageTemplatesBrowser = null;

async function init() {
  wireTabs();
  wireTextInput();
  wireImageInput();
  wireStart();
  wireGame();
  wireResults();
  wireLogo();
  wireRoomLobby();
  wireNameModal();
  wireSaveTemplateModal();

  // Always-visible template catalog below the hero so first-time visitors
  // can scroll straight into it without hunting for the tab.
  if (browseTemplatesRoot) {
    homepageTemplatesBrowser = new TemplatesBrowser({
      root: browseTemplatesRoot,
      onPick: handleTemplatePick,
    });
  }

  // React to URL changes
  onRouteChange(handleRoute);
  await handleRoute(getRoute());
}

async function handleRoute(route) {
  if (route.room) {
    await enterRoomFlow(route.room);
    return;
  }
  if (route.template) {
    await enterTemplateFlow(route.template);
    return;
  }
  showSetup();
}

// ---------- Screen switching ----------
function hideAll() {
  setupScreen.style.display = 'none';
  gameScreen.style.display = 'none';
  resultsScreen.style.display = 'none';
  roomScreen.style.display = 'none';
  progressWrap.style.display = 'none';
  if (blockerBanner) blockerBanner.style.display = 'none';
  if (communityColumn) communityColumn.style.display = 'none';
  if (resultsColumns) resultsColumns.classList.remove('with-community');
}
function showSetup() {
  hideAll();
  setupScreen.style.display = 'block';
  stopRoomSubscription();
  state.source = null;
}

// ---------- Tabs ----------
function wireTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.tab;
      textPanel.style.display = state.mode === 'text' ? 'block' : 'none';
      imagePanel.style.display = state.mode === 'image' ? 'block' : 'none';
      templatesPanel.style.display = state.mode === 'templates' ? 'block' : 'none';
      if (state.mode === 'templates' && !templatesBrowser) {
        templatesBrowser = new TemplatesBrowser({
          root: templatesPanel,
          onPick: handleTemplatePick,
        });
      }
      updateItemCount();
    });
  });
}

// ---------- Text input ----------
function wireTextInput() {
  textInput.addEventListener('input', updateItemCount);
}
function getTextItems() {
  return textInput.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map((line, i) => ({
      id: 'text-' + i,
      type: 'text',
      value: line,
      label: line,
    }));
}

// ---------- Image input ----------
function wireImageInput() {
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  ['dragenter', 'dragover'].forEach(ev =>
    fileDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      fileDrop.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    fileDrop.addEventListener(ev, (e) => {
      e.preventDefault();
      fileDrop.classList.remove('dragover');
    })
  );
  fileDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}
function handleFiles(files) {
  const newOnes = Array.from(files).filter(f => f.type.startsWith('image/'));
  newOnes.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.imageItems.push({
        id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        type: 'image',
        value: e.target.result,
        label: file.name.replace(/\.[^.]+$/, ''),
      });
      renderThumbs();
      updateItemCount();
    };
    reader.readAsDataURL(file);
  });
}
function renderThumbs() {
  thumbs.innerHTML = '';
  state.imageItems.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.style.backgroundImage = `url('${item.value}')`;
    const btn = document.createElement('button');
    btn.className = 'thumb-remove';
    btn.textContent = '×';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.imageItems.splice(idx, 1);
      renderThumbs();
      updateItemCount();
    });
    div.appendChild(btn);
    thumbs.appendChild(div);
  });
}

function updateItemCount() {
  const items = state.mode === 'text' ? getTextItems()
              : state.mode === 'image' ? state.imageItems
              : [];
  itemCount.textContent = items.length + ' item' + (items.length === 1 ? '' : 's');
  startBtn.disabled = items.length < 2;
  if (inviteBtn) {
    // Rooms are text-only in v2
    inviteBtn.disabled = items.length < 2 || state.mode !== 'text';
    inviteBtn.title = state.mode !== 'text'
      ? 'Friend invites are text-only in v2'
      : '';
  }
  errorMsg.textContent = '';
}

// ---------- Start button / game flow ----------
function wireStart() {
  startBtn.addEventListener('click', () => {
    const items = state.mode === 'text' ? getTextItems() : state.imageItems;
    startGame(items, { kind: 'fresh' });
  });
  if (inviteBtn) {
    inviteBtn.addEventListener('click', createRoomFromSetup);
  }
}

function startGame(rawItems, source) {
  const seen = new Set();
  const unique = rawItems.filter(it => {
    const key = it.type === 'text' ? it.label.toLowerCase() : it.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length < 2) {
    errorMsg.textContent = 'Need at least 2 unique items.';
    return;
  }

  state.items = unique;
  state.sorter = new InteractiveMergeSort(unique);
  state.comparisonsDone = 0;
  state.totalEstimate = estimateComparisons(unique.length);
  state.source = source || { kind: 'fresh' };

  hideAll();
  gameScreen.style.display = 'block';
  progressWrap.style.display = 'block';
  // Subtitle tells the user what they're ranking
  if (gameSubtitle) {
    gameSubtitle.textContent = source?.title ? source.title.toUpperCase() : '';
    gameSubtitle.style.display = source?.title ? 'block' : 'none';
  }
  updateProgress();
  showNextPair();
}

function showNextPair() {
  const pair = state.sorter.nextPair();
  if (!pair) {
    finishGame();
    return;
  }
  renderCard(cardLeft, pair[0]);
  renderCard(cardRight, pair[1]);
}

function renderCard(el, item) {
  el.classList.remove('text-card', 'image-card');
  if (item.type === 'image') {
    el.classList.add('image-card');
    el.style.backgroundImage = `url('${item.value}')`;
    el.textContent = '';
  } else {
    el.classList.add('text-card');
    el.style.backgroundImage = '';
    el.textContent = item.value;
  }
}

function wireGame() {
  cardLeft.addEventListener('click', () => pick('left'));
  cardRight.addEventListener('click', () => pick('right'));
  document.addEventListener('keydown', (e) => {
    if (gameScreen.style.display === 'none') return;
    if (e.key === 'ArrowLeft') pick('left');
    if (e.key === 'ArrowRight') pick('right');
  });
}

function pick(side) {
  if (!state.sorter) return;
  state.sorter.answer(side);
  state.comparisonsDone++;
  updateProgress();
  showNextPair();
}

function updateProgress() {
  const pct = Math.min(100, (state.comparisonsDone / state.totalEstimate) * 100);
  progressFill.style.width = pct + '%';
  progressText.textContent = `${state.comparisonsDone} / ~${state.totalEstimate} battles`;
}

// ---------- Results ----------
async function finishGame() {
  const result = state.sorter.result();
  const db = await getDB();
  const fp = getFingerprint();
  const order = result.map(it => it.label);

  // Submit ranking first so the room subscription (if any) fires before we
  // render the results screen — otherwise the live-update callback will
  // overwrite the results screen with the room lobby.
  if (state.source?.kind === 'template') {
    try {
      await db.submitTemplateRanking(state.source.slug, order, fp);
    } catch (e) {
      console.warn('Template submit failed:', e);
    }
  } else if (state.source?.kind === 'room') {
    try {
      await db.submitRoomRanking(state.source.roomId, order, state.source.name || 'You', fp);
    } catch (e) {
      console.warn('Room submit failed:', e);
    }
  }

  // Room flow has its own results screen with "Group combined" labelling
  if (state.source?.kind === 'room') {
    const room = await db.getRoom(state.source.roomId);
    showRoomResults(room);
    progressWrap.style.display = 'block';
    progressFill.style.width = '100%';
    progressText.textContent = `${state.comparisonsDone} battles · done`;
    return;
  }

  // Generic results screen for fresh + template flows
  hideAll();
  resultsScreen.style.display = 'block';
  progressWrap.style.display = 'block';
  progressFill.style.width = '100%';
  progressText.textContent = `${state.comparisonsDone} battles · done`;

  if (yourColumnHeading) yourColumnHeading.textContent = 'Your ranking';
  renderRanking(ranking, result);

  if (state.source?.kind === 'template') {
    try {
      const aggregate = await db.getAggregateRanking(state.source.slug);
      showCommunityRanking(aggregate);
    } catch (e) {
      console.warn('Aggregate read failed:', e);
    }
  }

  // "Save as template" only makes sense for text-only fresh lists
  if (saveTemplateBtn) {
    const canSave = state.source?.kind === 'fresh' && result.every(it => it.type === 'text');
    saveTemplateBtn.style.display = canSave ? 'inline-block' : 'none';
  }

  // Share is always available
  if (shareBtn) shareBtn.style.display = 'inline-block';
}

function renderRanking(container, items, extraMeta) {
  container.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.style.animationDelay = (idx * 0.04) + 's';

    const num = document.createElement('div');
    num.className = 'rank-number';
    num.textContent = '#' + (idx + 1);
    row.appendChild(num);

    if (item.type === 'image') {
      const img = document.createElement('div');
      img.className = 'rank-image';
      img.style.backgroundImage = `url('${item.value}')`;
      row.appendChild(img);
    }

    const txt = document.createElement('div');
    txt.className = 'rank-text';
    txt.textContent = item.label;
    row.appendChild(txt);

    if (extraMeta && typeof extraMeta === 'function') {
      const meta = extraMeta(item, idx);
      if (meta) {
        const m = document.createElement('div');
        m.className = 'rank-meta';
        m.textContent = meta;
        row.appendChild(m);
      }
    }

    container.appendChild(row);
  });
}

function showCommunityRanking(aggregate) {
  if (!communityRanking || !resultsColumns || !communityColumn) return;
  if (!aggregate.totalRankers) return;
  const items = aggregate.items.map(it => ({
    type: 'text',
    label: it.label,
    value: it.label,
    avgRank: it.avgRank,
    count: it.count,
  }));
  renderRanking(communityRanking, items, (item) => `avg #${item.avgRank.toFixed(1)}`);
  resultsColumns.classList.add('with-community');
  communityColumn.style.display = 'block';
  const note = document.querySelector('#communityColumn .community-note');
  if (note) {
    note.textContent = `Across ${aggregate.totalRankers} ranker${aggregate.totalRankers === 1 ? '' : 's'}`;
  }
}

function wireResults() {
  restartBtn.addEventListener('click', () => {
    setRoute({ room: null, template: null });
    showSetup();
    state.comparisonsDone = 0;
    state.sorter = null;
  });

  copyBtn.addEventListener('click', async () => {
    const result = state.sorter.result();
    const text = result.map((it, i) => `${i + 1}. ${it.label}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy as list', 1500);
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
  });

  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const result = state.sorter.result();
      // Shareable images are text-only
      if (result.some(it => it.type !== 'text')) {
        shareBtn.textContent = 'Images not supported';
        setTimeout(() => shareBtn.textContent = 'Share image', 1500);
        return;
      }
      shareBtn.disabled = true;
      shareBtn.textContent = 'Rendering…';
      try {
        await sharePodium({
          title: state.source?.title || 'My Stack Rank',
          items: result,
        });
        shareBtn.textContent = 'Share image';
      } catch (e) {
        console.warn('Share failed:', e);
        shareBtn.textContent = 'Share failed';
        setTimeout(() => shareBtn.textContent = 'Share image', 1500);
      } finally {
        shareBtn.disabled = false;
      }
    });
  }

  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener('click', () => openSaveTemplateModal());
  }
}

function wireLogo() {
  const logo = document.querySelector('.logo');
  if (!logo) return;
  logo.addEventListener('click', () => {
    setRoute({ room: null, template: null });
    showSetup();
  });
}

// ---------- Template flow ----------
async function handleTemplatePick(template) {
  setRoute({ template: template.slug });
  await enterTemplateFlow(template.slug);
}

async function enterTemplateFlow(slug) {
  const db = await getDB();
  const template = await db.getTemplate(slug);
  if (!template) {
    showSetup();
    errorMsg.textContent = 'Template not found.';
    return;
  }
  const items = template.items.map((label, i) => ({
    id: 'tpl-' + i,
    type: 'text',
    value: label,
    label,
  }));
  startGame(items, { kind: 'template', slug, title: template.title });
}

// ---------- Room flow ----------
async function createRoomFromSetup() {
  if (state.mode !== 'text') return;
  const items = getTextItems();
  if (items.length < 2) return;

  const name = await askName('What should we call you?');
  if (!name) return;

  const db = await getDB();
  const roomId = await db.createRoom(
    items.map(it => it.label),
    name,
    null,
  );
  // Set source + navigate into room lobby
  state.source = { kind: 'room', roomId, name };
  setRoute({ room: roomId });
}

async function enterRoomFlow(roomId) {
  const db = await getDB();
  const room = await db.getRoom(roomId);
  if (!room) {
    showSetup();
    errorMsg.textContent = 'Room not found.';
    return;
  }

  // Need a name before we can proceed
  let name = state.source?.name;
  if (!name) name = await askName(`Join ${room.creator}'s ranking`);
  if (!name) {
    showSetup();
    setRoute({ room: null });
    return;
  }

  state.source = { kind: 'room', roomId, name, title: `${room.creator}'s ranking` };
  showRoomLobby(room);

  // Subscribe for live updates
  stopRoomSubscription();
  state.roomUnsub = db.subscribeRoom(roomId, (updated) => {
    showRoomLobby(updated);
  });
}

function stopRoomSubscription() {
  if (state.roomUnsub) {
    state.roomUnsub();
    state.roomUnsub = null;
  }
}

function showRoomLobby(room) {
  hideAll();
  roomScreen.style.display = 'block';
  roomTitle.textContent = `${room.creator}'s ranking`;
  inviteLinkInput.value = `${window.location.origin}${window.location.pathname}?room=${room.id}`;

  const fp = getFingerprint();
  const myName = state.source?.name;
  const alreadyRanked = room.rankings.some(r => r.fingerprint === fp);

  const pills = room.rankings.length
    ? room.rankings.map(r => `<div class="participant-pill done">${escapeHtml(r.name)}</div>`).join('')
    : '<div class="muted">No rankings yet</div>';
  // Show "me" as pending if I haven't submitted yet
  const mePill = (!alreadyRanked && myName)
    ? `<div class="participant-pill">${escapeHtml(myName)} (you)</div>`
    : '';
  roomParticipants.innerHTML = pills + mePill;

  // Button states
  if (alreadyRanked) {
    roomStartBtn.textContent = 'See results';
    roomStartBtn.onclick = () => showRoomResults(room);
    roomHint.textContent = `You've already ranked. See everyone's picks →`;
  } else {
    roomStartBtn.textContent = 'Rank now →';
    roomStartBtn.onclick = () => startRoomRanking(room);
    roomHint.textContent = `${room.rankings.length} friend${room.rankings.length === 1 ? ' has' : 's have'} ranked. Your turn.`;
  }
}

function startRoomRanking(room) {
  const items = room.items.map((label, i) => ({
    id: 'room-' + i,
    type: 'text',
    value: label,
    label,
  }));
  startGame(items, {
    kind: 'room',
    roomId: room.id,
    name: state.source?.name,
    title: `${room.creator}'s ranking`,
  });
}

async function showRoomResults(room) {
  // Blind reveal: compute combined leaderboard via Borda count (computeAggregate)
  const aggregate = computeAggregate(room.rankings.map(r => ({ order: r.order })));
  hideAll();
  resultsScreen.style.display = 'block';

  // "Your" column shows the current user's ranking
  const fp = getFingerprint();
  const mine = room.rankings.find(r => r.fingerprint === fp);
  const myItems = mine
    ? mine.order.map(lbl => ({ type: 'text', label: lbl, value: lbl }))
    : [];
  renderRanking(ranking, myItems);
  if (yourColumnHeading) yourColumnHeading.textContent = 'Your ranking';

  // Community column shows the combined group leaderboard
  const combinedItems = aggregate.items.map(it => ({
    type: 'text', label: it.label, value: it.label, avgRank: it.avgRank, count: it.count,
  }));
  renderRanking(communityRanking, combinedItems, (item) => `avg #${item.avgRank.toFixed(1)}`);
  resultsColumns.classList.add('with-community');
  communityColumn.style.display = 'block';
  const colHead = communityColumn.querySelector('h3');
  if (colHead) colHead.textContent = 'Group combined';
  const note = communityColumn.querySelector('.community-note');
  if (note) note.textContent = `Across ${room.rankings.length} friend${room.rankings.length === 1 ? '' : 's'}`;
}

// ---------- Room lobby wiring ----------
function wireRoomLobby() {
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLinkInput.value);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => copyLinkBtn.textContent = 'Copy link', 1500);
      } catch {
        copyLinkBtn.textContent = 'Copy failed';
      }
    });
  }
}

// ---------- Name modal ----------
let _nameResolver = null;
function askName(prompt) {
  nameModal.querySelector('.modal-prompt').textContent = prompt || 'What should we call you?';
  nameModalInput.value = '';
  nameModal.classList.add('visible');
  setTimeout(() => nameModalInput.focus(), 50);
  return new Promise(resolve => { _nameResolver = resolve; });
}
function wireNameModal() {
  const close = (value) => {
    nameModal.classList.remove('visible');
    if (_nameResolver) { _nameResolver(value); _nameResolver = null; }
  };
  nameModalSubmit.addEventListener('click', () => {
    const v = nameModalInput.value.trim();
    if (v) close(v);
  });
  nameModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = nameModalInput.value.trim();
      if (v) close(v);
    } else if (e.key === 'Escape') {
      close(null);
    }
  });
  nameModal.addEventListener('click', (e) => {
    if (e.target === nameModal) close(null);
  });
}

// ---------- Save-as-template modal ----------
function openSaveTemplateModal() {
  if (!saveTemplateModal) return;
  // Populate category dropdown
  fetch(new URL('../data/templates.json', import.meta.url))
    .then(r => r.json())
    .then(json => {
      saveTemplateCategory.innerHTML = json.categories
        .map(c => `<option value="${c.id}">${c.emoji} ${c.label}</option>`)
        .join('');
    });
  saveTemplateTitle.value = '';
  saveTemplateModal.classList.add('visible');
}

function wireSaveTemplateModal() {
  if (!saveTemplateModal) return;
  const close = () => saveTemplateModal.classList.remove('visible');
  saveTemplateCancel.addEventListener('click', close);
  saveTemplateModal.addEventListener('click', (e) => {
    if (e.target === saveTemplateModal) close();
  });
  saveTemplateSubmit.addEventListener('click', async () => {
    const title = saveTemplateTitle.value.trim();
    if (!title) return;
    const result = state.sorter.result();
    const items = result.map(it => it.label);
    const db = await getDB();
    const slug = await db.saveTemplate({
      title,
      category: saveTemplateCategory.value,
      items,
      description: `Saved by ${getFingerprint().slice(0, 8)}`,
    });
    close();
    saveTemplateBtn.textContent = 'Saved ✓';
    setTimeout(() => saveTemplateBtn.textContent = 'Save as template', 1800);
  });
}

// ---------- Utilities ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Go ----------
init().catch(e => {
  console.error(e);
  errorMsg.textContent = 'Something went wrong loading the app.';
});
