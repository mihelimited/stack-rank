// Main app wiring
// -----------------------------------------------------------------------------
// Glues together: setup screen (text/image/templates), game screen, results
// screen, room lobby, and the various "load" flows (fresh list / template /
// room-invite URL).

import { InteractiveMergeSort, estimateComparisons } from './sorter.js';
import { getDB, getFingerprint, computeAggregate } from './db.js';
import { TemplatesBrowser } from './templates.js';
import { renderPodium, sharePodium, downloadPodium, FORMATS as PODIUM_FORMATS } from './podium.js';
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
  // Pre-rendered podium Files keyed by format, cached on results show so we
  // can call navigator.share synchronously inside the click handler (iOS
  // transient-user-activation requires this — any async work before
  // share() on iOS drops the gesture token and the call is rejected).
  podiumFiles: { landscape: null, square: null, story: null },
  podiumPreviewURLs: { landscape: null, square: null, story: null },
  podiumFileKey: null,   // invalidation key so we don't serve stale
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
const remixModal = $('remixModal');
const remixTitleInput = $('remixTitle');
const remixItemsInput = $('remixItems');
const remixCount = $('remixCount');
const remixStartBtn = $('remixStart');
const remixCancelBtn = $('remixCancel');
const formatPickerModal = $('formatPickerModal');
const formatPickerGrid = $('formatPickerGrid');
const formatPickerCancel = $('formatPickerCancel');

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
  wireRemixModal();
  wireFormatPickerModal();

  // Always-visible template catalog below the hero so first-time visitors
  // can scroll straight into it without hunting for the tab.
  if (browseTemplatesRoot) {
    homepageTemplatesBrowser = new TemplatesBrowser({
      root: browseTemplatesRoot,
      onPick: handleTemplatePick,
      onRemix: handleTemplateRemix,
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
  clearPodiumCache();
}

function clearPodiumCache() {
  // Revoke any outstanding preview object URLs before discarding them
  for (const key of Object.keys(state.podiumPreviewURLs)) {
    const url = state.podiumPreviewURLs[key];
    if (url) URL.revokeObjectURL(url);
    state.podiumPreviewURLs[key] = null;
  }
  state.podiumFiles = { landscape: null, square: null, story: null };
  state.podiumFileKey = null;
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
          onRemix: handleTemplateRemix,
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
    // Pre-render podium so the Share button works synchronously on iOS.
    // Room results are always text. Pass the combined Borda aggregate so
    // the hot-take callout can point out where you disagree with friends.
    const roomAggregate = computeAggregate(room.rankings.map(r => ({ order: r.order })));
    prerenderPodium(state.source?.title || 'My Stack Rank', result, roomAggregate);
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

  let templateAggregate = null;
  if (state.source?.kind === 'template') {
    try {
      templateAggregate = await db.getAggregateRanking(state.source.slug);
      showCommunityRanking(templateAggregate);
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

  // Pre-render the podium PNG for text-only rankings so navigator.share
  // can be called synchronously from the click handler on iOS.
  if (result.every(it => it.type === 'text')) {
    prerenderPodium(
      state.source?.title || 'My Stack Rank',
      result,
      templateAggregate,
    );
  }
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
      await copyTextToClipboard(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy as list', 1500);
    } catch (e) {
      console.warn('Copy failed:', e);
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => copyBtn.textContent = 'Copy as list', 1500);
    }
  });

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const result = state.sorter.result();
      // Shareable images are text-only
      if (result.some(it => it.type !== 'text')) {
        shareBtn.textContent = 'Images not supported';
        setTimeout(() => shareBtn.textContent = 'Share image', 1500);
        return;
      }
      openFormatPicker();
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

// Opens the remix modal so the user can edit the title and items
// before ranking. Submits as a fresh flow with the edited title/items.
function handleTemplateRemix(template) {
  if (!remixModal) return;
  remixTitleInput.value = template.title;
  remixItemsInput.value = template.items.join('\n');
  updateRemixCount();
  remixModal.classList.add('visible');
  setTimeout(() => remixTitleInput.focus(), 50);
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
  // Pre-fill with the in-progress title (e.g. from a remixed template)
  saveTemplateTitle.value = state.source?.title || '';
  saveTemplateModal.classList.add('visible');
}

// ---------- Remix modal ----------
function getRemixItems() {
  return remixItemsInput.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}
function updateRemixCount() {
  if (!remixCount) return;
  const n = getRemixItems().length;
  remixCount.textContent = `${n} item${n === 1 ? '' : 's'}`;
  if (remixStartBtn) remixStartBtn.disabled = n < 2;
}
function wireRemixModal() {
  if (!remixModal) return;
  const close = () => remixModal.classList.remove('visible');
  remixCancelBtn.addEventListener('click', close);
  remixModal.addEventListener('click', (e) => {
    if (e.target === remixModal) close();
  });
  remixItemsInput.addEventListener('input', updateRemixCount);
  remixStartBtn.addEventListener('click', () => {
    const title = (remixTitleInput.value || '').trim() || 'Remixed list';
    const labels = getRemixItems();
    if (labels.length < 2) return;
    const items = labels.map((label, i) => ({
      id: 'remix-' + i,
      type: 'text',
      value: label,
      label,
    }));
    close();
    // Clear template route if any — this is no longer the original template.
    setRoute({ template: null, room: null });
    startGame(items, { kind: 'fresh', title });
  });
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

// ---------- Clipboard (iOS-safe) ----------
// Tries the modern async API first, then falls back to a legacy
// textarea+execCommand flow that still works in WKWebView-based
// browsers where navigator.clipboard throws or is undefined.
async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      console.warn('navigator.clipboard.writeText failed, falling back:', e);
    }
  }
  // Legacy path
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Off-screen but still selectable (opacity/display:none block iOS selection)
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  // Prevent iOS zoom on focus
  ta.style.fontSize = '16px';
  document.body.appendChild(ta);

  const iOS = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
  try {
    if (iOS) {
      // iOS needs contenteditable + Range+Selection to get a valid copy target
      ta.contentEditable = 'true';
      ta.readOnly = true;
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length);
    } else {
      ta.select();
    }
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand("copy") returned false');
  } finally {
    document.body.removeChild(ta);
  }
}

// ---------- Podium pre-render (iOS-safe share) ----------
// Renders the podium PNG in every aspect ratio eagerly so the format-picker
// click handlers can call navigator.share synchronously. Any awaited work
// between a click and navigator.share() on iOS drops the transient
// user-activation token, so we MUST have the File ready ahead of time.
async function prerenderPodium(title, items, aggregate = null) {
  const key = [
    items.map(it => it.label).join('|'),
    title || '',
    aggregate?.totalRankers || 0,
  ].join('::');

  clearPodiumCache();
  state.podiumFileKey = key;

  const formats = Object.keys(PODIUM_FORMATS);
  await Promise.all(formats.map(async (format) => {
    try {
      const blob = await renderPodium({ title, items, aggregate, format });
      // Guard against stale renders (user navigated away or re-ranked)
      if (state.podiumFileKey !== key) return;
      const file = new File([blob], `stack-rank-${format}.png`, { type: 'image/png' });
      state.podiumFiles[format] = file;
      state.podiumPreviewURLs[format] = URL.createObjectURL(file);
      // If the format picker is already open, refresh its thumbs
      if (formatPickerModal && formatPickerModal.classList.contains('visible')) {
        refreshFormatPickerThumb(format);
      }
    } catch (e) {
      console.warn(`Podium pre-render (${format}) failed:`, e);
    }
  }));
}

// ---------- Format picker modal ----------
const FORMAT_PICKER_ORDER = [
  { id: 'square',    label: 'Square',  sub: 'Twitter · WhatsApp',  ratio: '1 / 1' },
  { id: 'story',     label: 'Story',   sub: 'Instagram · TikTok',  ratio: '9 / 16' },
  { id: 'landscape', label: 'Banner',  sub: 'Facebook · link',     ratio: '1200 / 630' },
];

function openFormatPicker() {
  if (!formatPickerModal || !formatPickerGrid) return;
  formatPickerGrid.innerHTML = '';
  for (const fmt of FORMAT_PICKER_ORDER) {
    const file = state.podiumFiles[fmt.id];
    const url = state.podiumPreviewURLs[fmt.id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'format-option';
    btn.dataset.format = fmt.id;
    btn.disabled = !file;
    btn.innerHTML = `
      <div class="format-thumb" style="aspect-ratio:${fmt.ratio};">
        ${url ? `<img alt="${escapeHtml(fmt.label)} preview" src="${url}">` : '<span class="format-loading">Rendering…</span>'}
      </div>
      <div class="format-label">
        <strong>${fmt.label}</strong>
        <span>${fmt.sub}</span>
      </div>
    `;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleFormatPick(fmt.id);
    });
    formatPickerGrid.appendChild(btn);
  }
  formatPickerModal.classList.add('visible');
}

function refreshFormatPickerThumb(format) {
  if (!formatPickerGrid) return;
  const btn = formatPickerGrid.querySelector(`.format-option[data-format="${format}"]`);
  if (!btn) return;
  const url = state.podiumPreviewURLs[format];
  const file = state.podiumFiles[format];
  if (!file || !url) return;
  const thumb = btn.querySelector('.format-thumb');
  if (!thumb) return;
  thumb.innerHTML = `<img alt="${format} preview" src="${url}">`;
  btn.disabled = false;
}

function handleFormatPick(formatId) {
  const file = state.podiumFiles[formatId];
  if (!file) return;

  // Call navigator.share synchronously inside this click handler so iOS
  // keeps the user-gesture token alive. We can't await anything before the
  // navigator.share() call — the returned promise is awaited afterward,
  // which is fine.
  let shareStarted = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      const p = navigator.share({
        files: [file],
        title: state.source?.title || 'Stack Rank',
        text: 'My ranking — made with Stack Rank',
      });
      shareStarted = true;
      formatPickerModal.classList.remove('visible');
      p.catch((e) => {
        if (e && e.name === 'AbortError') return;
        console.warn('navigator.share failed:', e);
        showImageSaveFallback(file);
      });
    } catch (e) {
      console.warn('navigator.share threw synchronously:', e);
    }
  }

  if (!shareStarted) {
    formatPickerModal.classList.remove('visible');
    showImageSaveFallback(file);
  }
}

function wireFormatPickerModal() {
  if (!formatPickerModal) return;
  const close = () => formatPickerModal.classList.remove('visible');
  if (formatPickerCancel) formatPickerCancel.addEventListener('click', close);
  formatPickerModal.addEventListener('click', (e) => {
    if (e.target === formatPickerModal) close();
  });
}

// Fallback image-save modal for when navigator.share isn't available
// or refuses to fire. The user long-presses (iOS) or right-clicks
// (desktop) the image to save it.
function showImageSaveFallback(file) {
  const url = URL.createObjectURL(file);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop visible';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:600px;">
      <h3>Save your ranking</h3>
      <p>Long-press the image below and pick <strong>Save to Photos</strong> (or <strong>Download image</strong> on desktop).</p>
      <img alt="Your ranking" style="display:block; width:100%; border-radius:12px; margin-bottom:16px; border:1px solid var(--border);">
      <div class="modal-actions">
        <button class="primary" type="button">Done</button>
      </div>
    </div>
  `;
  backdrop.querySelector('img').src = url;
  const cleanup = () => {
    backdrop.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  backdrop.querySelector('button').addEventListener('click', cleanup);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cleanup();
  });
  document.body.appendChild(backdrop);
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
// Expose state on window for debugging / preview verification only.
// Not used by any production code path.
if (typeof window !== 'undefined') {
  window.__stackRank = { state };
}

init().catch(e => {
  console.error(e);
  errorMsg.textContent = 'Something went wrong loading the app.';
});
