// Podium share-image renderer
// -----------------------------------------------------------------------------
// Renders the user's ranking as a shareable PNG in three aspect ratios:
//
//   landscape (1200×630)  — OG image, Twitter card, link preview
//   square    (1080×1080) — Twitter, iMessage, WhatsApp
//   story     (1080×1920) — Instagram/TikTok story
//
// Every format shares the same visual language:
//   * Gradient background + purple/pink accent glows
//   * StackRank wordmark
//   * Title (big) and optional "vs N rankers" subtitle
//   * Podium for top 3 — brand NAMES are the hero (bigger than the rank #)
//   * Clean dark-tile list for items 4+, with an "avg #X" chip when we know
//     how the crowd ranked each item
//   * Hot-take callout when the user rates something way higher than the
//     crowd does — designed to pick fights in the replies
//   * CTA: "Think you can do better? Rank yours →"
//
// Text-only rankings. Image rankings aren't shared (v2 scope — the base64
// blobs would blow past the Firestore doc limit anyway).
//
// Public API:
//   renderPodium({ title, items, aggregate?, format? }) -> Promise<Blob>
//   downloadPodium({ ..., filename? })                  -> Promise<void>
//   sharePodium({ ... })                                -> Promise<string>
//   FORMATS                                             -> format spec map

export const FORMATS = {
  landscape: {
    width: 1200, height: 630, layout: 'side',
    label: 'Banner', sub: 'Facebook · link preview',
  },
  square: {
    width: 1080, height: 1080, layout: 'stack',
    label: 'Square', sub: 'Twitter · WhatsApp',
  },
  story: {
    width: 1080, height: 1920, layout: 'stack',
    label: 'Story', sub: 'Instagram · TikTok',
  },
};

const FONT = '-apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';

// ---------- Main entry ----------
export async function renderPodium({
  title,
  items,
  aggregate = null,
  format = 'square',
}) {
  const spec = FORMATS[format] || FORMATS.square;
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');

  const aggMap = aggregate ? buildAggRankMap(aggregate) : null;
  const hotTake = aggMap ? findHotTake(items, aggMap) : null;

  const env = {
    ctx,
    W: spec.width,
    H: spec.height,
    format,
    title: (title || 'My Stack Rank').trim(),
    items,
    aggregate,
    aggMap,
    hotTake,
  };

  drawBackground(env);

  if (spec.layout === 'side') {
    drawSideLayout(env);
  } else {
    drawStackLayout(env);
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// ---------- Background ----------
function drawBackground({ ctx, W, H }) {
  // Base gradient matching the app
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f0c29');
  bg.addColorStop(0.5, '#302b63');
  bg.addColorStop(1, '#24243e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Purple accent glow (top-centre)
  const glowR = Math.max(W, H) * 0.7;
  const gx = W * 0.5;
  const gy = H * 0.25;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, glowR);
  glow.addColorStop(0, 'rgba(124, 92, 255, 0.42)');
  glow.addColorStop(1, 'rgba(124, 92, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Hot-pink accent (bottom-right)
  const pink = ctx.createRadialGradient(W, H, 0, W, H, W * 0.55);
  pink.addColorStop(0, 'rgba(255, 77, 143, 0.22)');
  pink.addColorStop(1, 'rgba(255, 77, 143, 0)');
  ctx.fillStyle = pink;
  ctx.fillRect(0, 0, W, H);
}

// ---------- Stack layout (square / story) ----------
function drawStackLayout(env) {
  const { ctx, W, H, format, title, aggregate, hotTake, items } = env;
  const isStory = format === 'story';
  const M = Math.round(W * 0.06);

  // Wordmark top-left
  drawWordmark(ctx, M, M + 6, W * 0.18);

  // Title
  let y = M + (isStory ? 130 : 92);
  const titleSize = isStory ? 80 : 64;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${titleSize}px ${FONT}`;
  const titleLines = wrapLines(ctx, title, W - M * 2, 2);
  const titleLineH = Math.round(titleSize * 1.06);
  titleLines.forEach((line, i) => {
    ctx.fillText(line, W / 2, y + i * titleLineH);
  });
  y += titleLines.length * titleLineH + (isStory ? 14 : 8);

  // Subtitle
  if (aggregate && aggregate.totalRankers) {
    const subSize = isStory ? 34 : 26;
    ctx.font = `600 ${subSize}px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    const rankers = aggregate.totalRankers;
    ctx.fillText(
      `My take vs ${rankers} ranker${rankers === 1 ? '' : 's'}`,
      W / 2,
      y,
    );
    y += subSize + (isStory ? 28 : 18);
  } else {
    y += 10;
  }

  // Podium — leaves room for list + CTA below
  const podiumH = isStory ? 600 : 380;
  drawPodium(env, M, y, W - M * 2, podiumH);
  y += podiumH + (isStory ? 70 : 32);

  // Hot take callout
  if (hotTake) {
    y = drawHotTake(env, M, y, W - M * 2);
  }

  // Remaining items
  const rest = items.slice(3);
  const ctaSpace = isStory ? 170 : 112;
  const listRoom = H - y - ctaSpace;
  const maxRowsByFormat = isStory ? 8 : 4;
  if (rest.length && listRoom > 70) {
    drawList(env, M, y, W - M * 2, rest, listRoom, maxRowsByFormat);
  }

  // CTA bottom-centre
  drawCTA(env, W / 2, H - M - 8);
}

// ---------- Side layout (landscape) ----------
function drawSideLayout(env) {
  const { ctx, W, H, title, aggregate, hotTake, items } = env;
  const M = 48;
  const leftW = Math.round(W * 0.48);
  const gapX = 28;
  const rightX = M + leftW + gapX;
  const rightW = W - rightX - M;

  // Wordmark top-left
  drawWordmark(ctx, M, M + 4, 190);

  // Title (left column)
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `900 52px ${FONT}`;
  const titleLines = wrapLines(ctx, title, leftW, 2);
  const titleLineH = 56;
  let ty = M + 78;
  titleLines.forEach((ln, i) => ctx.fillText(ln, M, ty + i * titleLineH));
  let yLeft = ty + titleLines.length * titleLineH + 8;

  // Subtitle
  if (aggregate && aggregate.totalRankers) {
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    const rankers = aggregate.totalRankers;
    ctx.fillText(
      `My take vs ${rankers} ranker${rankers === 1 ? '' : 's'}`,
      M,
      yLeft,
    );
    yLeft += 32;
  }

  // Podium (left column, below title)
  const podiumBottomGap = 74; // leaves room for wordmark-row baseline
  const podiumH = H - yLeft - podiumBottomGap;
  drawPodium(env, M, yLeft, leftW, podiumH);

  // Right column: hot take + list
  let yRight = M + 12;
  if (hotTake) {
    yRight = drawHotTake(env, rightX, yRight, rightW);
  }
  const rest = items.slice(3);
  const ctaSpace = 90;
  const listRoom = H - yRight - ctaSpace;
  if (rest.length && listRoom > 60) {
    drawList(env, rightX, yRight, rightW, rest, listRoom, 6);
  }

  // CTA bottom-right
  drawCTA(env, rightX + rightW / 2, H - M + 2);
}

// ---------- Podium ----------
function drawPodium(env, x, y, width, height) {
  const { ctx, items, hotTake, format } = env;
  const top3 = items.slice(0, 3);
  if (!top3[0]) return;

  // 38% of vertical for brand names above the tiles, rest for the step tiles
  const nameZoneH = Math.round(height * 0.38);
  const stepZoneH = height - nameZoneH;

  const gap = 16;
  const stepW = (width - gap * 2) / 3;
  const baseY = y + height;

  const h1 = stepZoneH;
  const h2 = Math.round(stepZoneH * 0.78);
  const h3 = Math.round(stepZoneH * 0.58);

  // Podium order left-to-right: #2, #1, #3
  const steps = [
    { rank: 2, label: top3[1]?.label, x, w: stepW, h: h2, color: '#c9d1e0' },
    { rank: 1, label: top3[0]?.label, x: x + stepW + gap, w: stepW, h: h1, color: '#ffd864' },
    { rank: 3, label: top3[2]?.label, x: x + (stepW + gap) * 2, w: stepW, h: h3, color: '#e49b64' },
  ];

  const isLandscape = format === 'landscape';
  const baseNameSize = isLandscape ? 32 : 42;

  for (const s of steps) {
    if (!s.label) continue;
    const sy = baseY - s.h;

    // ---- Brand name above the step (HERO element) ----
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const nameSize = s.rank === 1 ? baseNameSize + 6 : baseNameSize;
    ctx.font = `900 ${nameSize}px ${FONT}`;
    // Allow the name to use slightly more width than the step itself
    const nameMaxW = s.w + gap * 0.6;
    const lines = wrapLines(ctx, s.label, nameMaxW, 2);
    const lineH = Math.round(nameSize * 1.05);
    for (let i = 0; i < lines.length; i++) {
      const textY = sy - 18 - (lines.length - 1 - i) * lineH;
      ctx.fillText(lines[i], s.x + s.w / 2, textY);
    }

    // Hot-take pill sits above the name with a comfortable gap
    const isHot = hotTake && hotTake.label === s.label;
    if (isHot) {
      const pillY = sy - 18 - lines.length * lineH - 28;
      drawHotTakePill(ctx, s.x + s.w / 2, pillY);
    }

    // ---- Step tile ----
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    roundRect(ctx, s.x, sy, s.w, s.h, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    roundRect(ctx, s.x, sy, s.w, s.h, 20);
    ctx.stroke();

    // Top coloured stripe (clipped to rounded top)
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, s.x, sy, s.w, s.h, 20);
    ctx.clip();
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x, sy, s.w, 8);
    ctx.restore();

    // Rank number inside the tile — smaller than the brand name
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rankSize = isLandscape ? 34 : 42;
    ctx.font = `900 ${rankSize}px ${FONT}`;
    ctx.fillText('#' + s.rank, s.x + s.w / 2, sy + s.h / 2);
  }
}

// ---------- Hot-take pieces ----------
function drawHotTakePill(ctx, cx, cy) {
  const text = '🔥 HOT TAKE';
  ctx.font = `900 22px ${FONT}`;
  const w = Math.max(170, ctx.measureText(text).width + 26);
  const h = 38;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#ff4d8f');
  g.addColorStop(1, '#ff7a2d');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
}

function drawHotTake(env, x, y, width) {
  const { ctx, hotTake, format } = env;
  if (!hotTake) return y;

  const isLandscape = format === 'landscape';
  const sizeBig = isLandscape ? 22 : 30;
  const sizeSmall = isLandscape ? 17 : 22;
  const pad = isLandscape ? 20 : 26;

  // Background + border
  const line1 = `🔥  You have ${hotTake.label} at #${hotTake.myRank}`;
  const line2 = `The crowd ranks it #${hotTake.crowdRank}. Fight me.`;

  const lineGap = 8;
  const boxH = pad + sizeBig + lineGap + sizeSmall + pad;

  const grad = ctx.createLinearGradient(x, y, x + width, y + boxH);
  grad.addColorStop(0, 'rgba(255, 77, 143, 0.22)');
  grad.addColorStop(1, 'rgba(255, 122, 45, 0.22)');
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, width, boxH, 20);
  ctx.fill();

  const borderGrad = ctx.createLinearGradient(x, y, x + width, y);
  borderGrad.addColorStop(0, '#ff4d8f');
  borderGrad.addColorStop(1, '#ff7a2d');
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, width, boxH, 20);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${sizeBig}px ${FONT}`;
  const line1T = truncate(ctx, line1, width - pad * 2);
  ctx.fillText(line1T, x + pad, y + pad);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.font = `500 ${sizeSmall}px ${FONT}`;
  ctx.fillText(line2, x + pad, y + pad + sizeBig + lineGap);

  return y + boxH + (isLandscape ? 18 : 28);
}

// ---------- List (items 4+) ----------
function drawList(env, x, y, width, rest, availableH, maxRows) {
  const { ctx, aggMap, format } = env;
  const isLandscape = format === 'landscape';
  const isStory = format === 'story';

  const rowH = isLandscape ? 48 : isStory ? 72 : 68;
  const gap = isLandscape ? 8 : 12;

  const fit = Math.floor((availableH + gap) / (rowH + gap));
  const rows = rest.slice(0, Math.min(maxRows, fit));

  const rankSize = isLandscape ? 20 : isStory ? 26 : 24;
  const labelSize = isLandscape ? 24 : isStory ? 36 : 32;
  const chipSize = isLandscape ? 16 : 22;

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const ry = y + i * (rowH + gap);
    const rank = i + 4;

    // Tile
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    roundRect(ctx, x, ry, width, rowH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, ry, width, rowH, 14);
    ctx.stroke();

    // Rank
    ctx.fillStyle = 'rgba(168, 168, 255, 0.95)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${rankSize}px ${FONT}`;
    const rankTxt = '#' + rank;
    const rankTxtW = ctx.measureText(rankTxt).width;
    ctx.fillText(rankTxt, x + 18, ry + rowH / 2);

    // Reserve chip area
    let chipW = 0;
    let chipX = 0;
    let chipY = 0;
    let chipH = 0;
    let chipTxt = null;
    if (aggMap && aggMap.has(item.label)) {
      const avgRank = aggMap.get(item.label);
      chipTxt = `avg #${avgRank}`;
      ctx.font = `700 ${chipSize}px ${FONT}`;
      const chipTW = ctx.measureText(chipTxt).width;
      const chipPadX = 12;
      chipH = chipSize + 14;
      chipW = chipTW + chipPadX * 2;
      chipX = x + width - chipW - 14;
      chipY = ry + (rowH - chipH) / 2;
    }

    // Label (brand name — bigger than rank #)
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${labelSize}px ${FONT}`;
    const labelMax = width - 18 - rankTxtW - 14 - 18 - (chipW ? chipW + 18 : 0);
    const labelTxt = truncate(ctx, item.label, labelMax);
    ctx.fillText(labelTxt, x + 18 + rankTxtW + 14, ry + rowH / 2);

    // Chip
    if (chipTxt) {
      ctx.fillStyle = 'rgba(168, 168, 255, 0.18)';
      roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(168, 168, 255, 0.45)';
      ctx.lineWidth = 1;
      roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(168, 168, 255, 0.95)';
      ctx.textAlign = 'center';
      ctx.font = `700 ${chipSize}px ${FONT}`;
      ctx.fillText(chipTxt, chipX + chipW / 2, ry + rowH / 2);
    }
  }
}

// ---------- CTA ----------
function drawCTA(env, cx, yBottom) {
  const { ctx, format } = env;
  const isLandscape = format === 'landscape';
  const hSize = isLandscape ? 22 : 30;
  const sSize = isLandscape ? 18 : 24;
  const gap = 10;

  const headline = 'Think you can do better?';
  const sub = 'Rank yours → stack-rank.click';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // Sub first (it's the bottom line)
  ctx.font = `800 ${sSize}px ${FONT}`;
  const subW = ctx.measureText(sub).width;
  const g = ctx.createLinearGradient(cx - subW / 2, yBottom, cx + subW / 2, yBottom);
  g.addColorStop(0, '#a8a8ff');
  g.addColorStop(0.5, '#ff4d8f');
  g.addColorStop(1, '#ff7a2d');
  ctx.fillStyle = g;
  ctx.fillText(sub, cx, yBottom);

  // Headline above sub
  ctx.font = `900 ${hSize}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(headline, cx, yBottom - sSize - gap);
}

// ---------- Wordmark ----------
function drawWordmark(ctx, x, y, width) {
  const size = Math.max(28, Math.round(width / 4.2));
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const stackW = ctx.measureText('Stack').width;
  const grad = ctx.createLinearGradient(x, y, x + stackW, y);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#a8a8ff');
  ctx.fillStyle = grad;
  ctx.fillText('Stack', x, y);
  ctx.fillStyle = '#ff4d8f';
  ctx.fillText('Rank', x + stackW, y);
}

// ---------- Data helpers ----------
function buildAggRankMap(aggregate) {
  const m = new Map();
  if (!aggregate || !aggregate.items) return m;
  aggregate.items.forEach((it, i) => m.set(it.label, i + 1));
  return m;
}

function findHotTake(items, aggMap) {
  // The "hot take" is the top-half item where the user is most out of step
  // with the crowd — biggest positive gap between crowd rank and user rank.
  const halfCutoff = Math.max(3, Math.ceil(items.length / 2));
  let best = null;
  for (let i = 0; i < Math.min(items.length, halfCutoff); i++) {
    const myRank = i + 1;
    const label = items[i].label;
    const crowdRank = aggMap.get(label);
    if (!crowdRank) continue;
    const gap = crowdRank - myRank;
    if (gap < 3) continue;
    if (!best || gap > best.gap) {
      best = { label, myRank, crowdRank, gap };
    }
  }
  return best;
}

// ---------- Canvas utilities ----------
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    const tail = lines.slice(maxLines - 1).join(' ');
    head.push(tail);
    lines.length = 0;
    lines.push(...head);
  }
  for (let i = 0; i < lines.length; i++) {
    lines[i] = truncate(ctx, lines[i], maxWidth);
  }
  return lines;
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + '…';
}

// ---------- Public helpers ----------
export async function downloadPodium({
  title,
  items,
  aggregate = null,
  format = 'square',
  filename,
}) {
  const blob = await renderPodium({ title, items, aggregate, format });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `stack-rank-${format}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sharePodium({ title, items, aggregate = null, format = 'square' }) {
  const blob = await renderPodium({ title, items, aggregate, format });
  const file = new File([blob], `stack-rank-${format}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: title || 'Stack Rank',
        text: 'My ranking — made with Stack Rank',
      });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  await downloadPodium({ title, items, aggregate, format });
  return 'downloaded';
}
