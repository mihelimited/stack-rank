// Podium share-image renderer
// -----------------------------------------------------------------------------
// Renders a 1200×630 (OG-sized) PNG with:
//   * Title + StackRank wordmark
//   * Top 3 on a podium: #1 tall in the centre, #2 left, #3 right
//   * Remaining items "fallen" into a tilted pile below
//   * Wordmark and URL in the corner
//
// Only handles text items — images would blow past the 1 MB Firestore doc
// limit anyway, and v2 scopes image lists to local-only.
//
// Public API:
//   renderPodium({ title, items }) -> Promise<Blob>   // PNG blob
//   downloadPodium({ title, items, filename }) -> Promise<void>
//   sharePodium({ title, items }) -> Promise<'shared' | 'downloaded'>

const WIDTH = 1200;
const HEIGHT = 630;

export async function renderPodium({ title, items }) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  // Background — matches the app's gradient
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#0f0c29');
  bg.addColorStop(0.5, '#302b63');
  bg.addColorStop(1, '#24243e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft accent glow
  const glow = ctx.createRadialGradient(WIDTH / 2, 260, 50, WIDTH / 2, 260, 600);
  glow.addColorStop(0, 'rgba(124, 92, 255, 0.35)');
  glow.addColorStop(1, 'rgba(124, 92, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 52px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
  wrapText(ctx, title || 'Stack Rank', WIDTH / 2, 40, WIDTH - 120, 58, 2);

  // Wordmark bottom-left
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 28px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
  const mark = ctx.createLinearGradient(40, 0, 280, 0);
  mark.addColorStop(0, '#ffffff');
  mark.addColorStop(1, '#a8a8ff');
  ctx.fillStyle = mark;
  ctx.fillText('Stack', 40, HEIGHT - 40);
  ctx.fillStyle = '#ff4d8f';
  ctx.fillText('Rank', 40 + ctx.measureText('Stack').width, HEIGHT - 40);

  // CTA bottom-right
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '500 22px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
  ctx.fillText('Rank anything at stack-rank', WIDTH - 40, HEIGHT - 40);

  // Podium
  const top3 = items.slice(0, 3);
  const rest = items.slice(3);
  drawPodium(ctx, top3);

  // Pile of remaining items
  if (rest.length) drawPile(ctx, rest);

  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}

function drawPodium(ctx, top3) {
  // Podium base Y (top of the tallest step)
  const baseY = 470;
  const centreX = WIDTH / 2;
  const stepW = 220;

  // Heights: #1 tallest, then #2, then #3
  const heights = { 1: 170, 2: 120, 3: 80 };
  const order = [
    { rank: 2, label: top3[1]?.label, cx: centreX - stepW, color: '#c0c0c0' },
    { rank: 1, label: top3[0]?.label, cx: centreX,         color: '#ffd700' },
    { rank: 3, label: top3[2]?.label, cx: centreX + stepW, color: '#cd7f32' },
  ];

  for (const step of order) {
    if (!step.label) continue;
    const h = heights[step.rank];
    const x = step.cx - stepW / 2 + 10;
    const y = baseY - h;
    // Step block
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundRect(ctx, x, y, stepW - 20, h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, stepW - 20, h, 14);
    ctx.stroke();

    // Rank number
    ctx.fillStyle = step.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 56px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
    ctx.fillText('#' + step.rank, step.cx, y + h - 24);

    // Label above the step
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
    wrapText(ctx, step.label, step.cx, y - 68, stepW + 40, 34, 2);
  }
}

function drawPile(ctx, rest) {
  // "Fallen" items below the podium — tilted cards, staggered
  const baseY = 510;
  const centreX = WIDTH / 2;
  const maxShown = Math.min(rest.length, 8);
  for (let i = 0; i < maxShown; i++) {
    const item = rest[i];
    if (!item?.label) continue;
    const offset = (i - (maxShown - 1) / 2) * 130;
    const tilt = ((i % 2 === 0 ? 1 : -1) * (6 + (i * 1.5))) * (Math.PI / 180);
    const x = centreX + offset;
    const y = baseY + (i % 3) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    // Card
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    roundRect(ctx, -60, -18, 120, 36, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, -60, -18, 120, 36, 8);
    ctx.stroke();
    // Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 14px -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
    const short = truncate(ctx, '#' + (i + 4) + '  ' + item.label, 110);
    ctx.fillText(short, 0, 0);
    ctx.restore();
  }
}

// ---------- Canvas helpers ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // If still overflowing on last visible line, truncate with ellipsis
  if (lines.length === maxLines) {
    const last = truncate(ctx, lines[lines.length - 1], maxWidth);
    lines[lines.length - 1] = last;
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0, hi = text.length;
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
export async function downloadPodium({ title, items, filename }) {
  const blob = await renderPodium({ title, items });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'stack-rank.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sharePodium({ title, items }) {
  const blob = await renderPodium({ title, items });
  const file = new File([blob], 'stack-rank.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: title || 'Stack Rank',
        text: 'My ranking — made with Stack Rank',
      });
      return 'shared';
    } catch {
      // fall through to download
    }
  }
  await downloadPodium({ title, items });
  return 'downloaded';
}
