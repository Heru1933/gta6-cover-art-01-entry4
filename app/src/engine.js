// Neon Vice cover renderer.
//
// This module owns everything that ends up inside the cover rectangle:
// the six panel layouts, the five colour looks, the drawn dusk scene used
// when a panel has no photograph, the poster lettering, and paintCover(),
// which renders a whole cover onto a canvas at whatever size that canvas
// already has. The editor keeps a single state object and calls paintCover
// for the on-screen preview and for the exported file alike, so what the
// user sees is exactly what gets saved.

/* ------------------------------ panel layouts ----------------------------- */

// Each layout is a list of unit-space rectangles [x, y, width, height]
// in reading order; paintCover scales them to the canvas with a cream
// frame around the outside and a gutter between neighbouring panels.
export const PANEL_LAYOUTS = {
  mosaic: {
    name: 'Mosaic',
    boxes: [
      [0, 0, 0.34, 0.44], [0.34, 0, 0.32, 0.32], [0.66, 0, 0.34, 0.44],
      [0.34, 0.32, 0.32, 0.30],
      [0, 0.44, 0.34, 0.56], [0.34, 0.62, 0.32, 0.38], [0.66, 0.44, 0.34, 0.56],
    ],
  },
  poster: {
    name: 'Poster',
    boxes: [
      [0, 0, 0.57, 1],
      [0.57, 0, 0.43, 0.36], [0.57, 0.36, 0.43, 0.31], [0.57, 0.67, 0.43, 0.33],
    ],
  },
  quad: {
    name: 'Quad',
    boxes: [
      [0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5],
    ],
  },
  trio: {
    name: 'Trio',
    boxes: [
      [0, 0, 0.34, 1], [0.34, 0, 0.33, 1], [0.67, 0, 0.33, 1],
    ],
  },
  duo: {
    name: 'Duo',
    boxes: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  },
  solo: {
    name: 'Solo',
    boxes: [[0, 0, 1, 1]],
  },
};

/* ------------------------------- colour looks ----------------------------- */

// A look pairs a canvas filter string (applied while a photo is drawn)
// with a stack of vertical gradient washes laid over the result. The
// wash blend mode is stored per wash because the neon look needs light
// added while the sunset look mostly needs colour laid on top.
export const COLOUR_LOOKS = {
  sunset: {
    name: 'Vice Sunset',
    filter: 'saturate(1.3) contrast(1.08) brightness(1.03)',
    washes: [
      { mode: 'source-over', stops: [[0, 'rgba(26,7,58,0.15)'], [0.45, 'rgba(26,7,58,0)'], [0.8, 'rgba(255,99,56,0.15)'], [1, 'rgba(219,33,119,0.32)']] },
      { mode: 'screen', stops: [[0, 'rgba(255,178,84,0.12)'], [0.55, 'rgba(255,178,84,0)']] },
    ],
  },
  neon: {
    name: 'Neon Night',
    filter: 'saturate(1.5) contrast(1.15) brightness(0.95) hue-rotate(-7deg)',
    washes: [
      { mode: 'multiply', stops: [[0, 'rgba(9,15,46,0)'], [1, 'rgba(3,30,52,0.4)']] },
      { mode: 'screen', stops: [[0, 'rgba(255,44,138,0.16)'], [0.5, 'rgba(255,44,138,0)']] },
      { mode: 'screen', stops: [[0.62, 'rgba(36,211,238,0)'], [1, 'rgba(36,211,238,0.12)']] },
    ],
  },
  golden: {
    name: 'Golden Hour',
    filter: 'saturate(1.16) contrast(1.04) brightness(1.06) sepia(0.24)',
    washes: [
      { mode: 'screen', stops: [[0, 'rgba(255,172,60,0.19)'], [0.6, 'rgba(255,172,60,0)']] },
      { mode: 'multiply', stops: [[0.55, 'rgba(122,54,16,0)'], [1, 'rgba(122,54,16,0.17)']] },
    ],
  },
  noir: {
    name: 'Noir',
    filter: 'grayscale(1) contrast(1.24) brightness(1.01)',
    washes: [
      { mode: 'source-over', stops: [[0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.3)']] },
    ],
  },
  clean: {
    name: 'Clean',
    filter: 'saturate(1.05) contrast(1.02)',
    washes: [],
  },
};

// Title ink: an ordered list of gradient stops, or a single flat colour.
export const TITLE_INKS = {
  sunset: ['#ffe259', '#ffa751', '#ff5e3a', '#ff2e88'],
  gold: ['#fff3ae', '#f6c453', '#dd8f1d', '#9a5b12'],
  pink: ['#ff7ac0'],
  white: ['#ffffff'],
};

/* --------------------------------- geometry ------------------------------- */

// Pixel rectangles for one layout on a W by H canvas.
export function panelPixels(layoutId, W, H) {
  const frame = Math.max(10, Math.round(Math.min(W, H) * 0.017));
  const gap = Math.max(6, Math.round(frame * 0.75));
  const innerW = W - frame * 2;
  const innerH = H - frame * 2;
  return PANEL_LAYOUTS[layoutId].boxes.map(([ux, uy, uw, uh]) => ({
    x: frame + ux * innerW + gap / 2,
    y: frame + uy * innerH + gap / 2,
    w: uw * innerW - gap,
    h: uh * innerH - gap,
  }));
}

// One panel's assignment: photo index (-1 means the drawn scene),
// a zoom multiplier, a focal point in 0..1, and the fit flag.
export function blankPanel(photoIndex) {
  return { photo: photoIndex, zoom: 1, fx: 0.5, fy: 0.5, contain: false };
}

// The photo order each layout opens with, so a fresh cover already
// looks composed before the user touches anything.
export function openingPanels(layoutId, photoTotal) {
  const preferred = {
    mosaic: [1, 3, 0, 2, 0, 3, 1],
    poster: [0, 1, 3, 2],
    quad: [0, 1, 3, 2],
    trio: [1, 0, 3],
    duo: [0, 3],
    solo: [0],
  }[layoutId] || [0];
  return PANEL_LAYOUTS[layoutId].boxes.map((box, i) => {
    const panel = blankPanel(photoTotal > 0 ? preferred[i % preferred.length] % photoTotal : -1);
    if (i % 3 === 2) panel.fy = 0.3;
    if (i % 4 === 3) panel.fx = 0.36;
    return panel;
  });
}

/* --------------------------- deterministic random -------------------------- */

// Tiny mulberry-style generator. The drawn scene and the film grain must
// be identical on every repaint, otherwise the preview would shimmer.
function seededRandom(seed) {
  let state = (seed >>> 0) || 7;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- striped sun ------------------------------ */

const sunCache = new Map();

// The retro sun is rendered once per radius into its own canvas: the
// horizontal cut stripes have to stay transparent, which is easiest to
// guarantee by punching them out of a finished disc.
function stripedSun(radius) {
  const key = Math.round(radius);
  const cached = sunCache.get(key);
  if (cached) return cached;
  const disc = document.createElement('canvas');
  disc.width = disc.height = Math.max(2, key * 2);
  const ctx = disc.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, key * 2);
  grad.addColorStop(0, '#ffe259');
  grad.addColorStop(0.55, '#ffa751');
  grad.addColorStop(1, '#ff2e88');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(key, key, key, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  let y = key * 1.08;
  let stripe = key * 0.04;
  while (y < key * 2) {
    ctx.fillRect(0, y, key * 2, stripe);
    y += stripe + key * 0.11;
    stripe *= 1.5;
  }
  sunCache.set(key, disc);
  return disc;
}

/* ------------------------------- drawn scene ------------------------------ */

// A palm drawn around a local origin at the foot of its trunk.
function drawPalm(ctx, x, y, height, lean, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((lean * height) / 100, height / 100);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.quadraticCurveTo(-2, -55, 14, -100);
  ctx.lineTo(23, -98);
  ctx.quadraticCurveTo(8, -54, 8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const fronds = [[-58, -24], [-44, -40], [-16, -52], [15, -55], [40, -45], [58, -28]];
  for (const [dx, dy] of fronds) {
    ctx.beginPath();
    ctx.moveTo(18, -99);
    ctx.quadraticCurveTo(18 + dx * 0.5, -99 + dy - 12, 18 + dx, -99 + dy + 14);
    ctx.stroke();
  }
  ctx.restore();
}

// Fallback art for panels without a photo: dusk sky, striped sun,
// a low skyline, light glittering on water, and two palm silhouettes.
function drawDuskScene(ctx, x, y, w, h) {
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#2b1055');
  sky.addColorStop(0.34, '#7b2d8b');
  sky.addColorStop(0.55, '#d6336c');
  sky.addColorStop(0.68, '#ff7e47');
  sky.addColorStop(0.78, '#ffd23f');
  sky.addColorStop(0.8, '#3d1a63');
  sky.addColorStop(1, '#170a33');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  const rand = seededRandom(20261119);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 24; i += 1) {
    ctx.fillRect(x + rand() * w, y + rand() * h * 0.3, 1.6, 1.6);
  }

  const horizon = y + h * 0.79;
  const radius = Math.min(w, h) * 0.27;
  ctx.drawImage(stripedSun(radius), x + w / 2 - radius, horizon - radius * 1.55);

  ctx.fillStyle = '#1c0b38';
  let cursor = x - 4;
  while (cursor < x + w) {
    const bw = w * (0.05 + rand() * 0.09);
    const bh = h * (0.03 + rand() * 0.08);
    ctx.fillRect(cursor, horizon - bh, bw, bh);
    cursor += bw + w * 0.012;
  }
  ctx.fillStyle = 'rgba(255,210,63,0.45)';
  for (let i = 0; i < 7; i += 1) {
    const gw = radius * (0.4 + rand() * 0.9);
    ctx.fillRect(x + w / 2 - gw / 2, horizon + 4 + i * h * 0.024, gw, Math.max(1.5, h * 0.006));
  }
  drawPalm(ctx, x + w * 0.07, y + h * 0.995, h * 0.33, 1, '#12061f');
  drawPalm(ctx, x + w * 0.95, y + h * 0.995, h * 0.26, -1, '#12061f');
}

/* ------------------------------- photo panels ----------------------------- */

// Renders one photo into a tile of exactly w by h with its look applied.
// Fill mode covers the tile and uses the focal point to choose which part
// of the overflow stays visible; contain mode shows the whole photo over
// a blurred blow-up of itself so the panel never shows empty bars.
function gradedTile(img, panel, lookId, w, h) {
  const tile = document.createElement('canvas');
  tile.width = Math.max(1, Math.round(w));
  tile.height = Math.max(1, Math.round(h));
  const ctx = tile.getContext('2d');
  const look = COLOUR_LOOKS[lookId] || COLOUR_LOOKS.sunset;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  ctx.fillStyle = '#170a33';
  ctx.fillRect(0, 0, tile.width, tile.height);

  if (panel.contain) {
    const backdropScale = Math.max(tile.width / iw, tile.height / ih) * 1.15;
    ctx.filter = look.filter + ' blur(18px) brightness(0.6)';
    ctx.drawImage(img, (tile.width - iw * backdropScale) / 2, (tile.height - ih * backdropScale) / 2, iw * backdropScale, ih * backdropScale);
    ctx.filter = look.filter;
    const scale = Math.min(tile.width / iw, tile.height / ih) * panel.zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(
      img,
      (tile.width - dw) / 2 + (panel.fx - 0.5) * tile.width * 0.2,
      (tile.height - dh) / 2 + (panel.fy - 0.5) * tile.height * 0.2,
      dw, dh,
    );
  } else {
    const scale = Math.max(tile.width / iw, tile.height / ih) * panel.zoom;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.filter = look.filter;
    ctx.drawImage(img, (tile.width - dw) * panel.fx, (tile.height - dh) * panel.fy, dw, dh);
  }
  ctx.filter = 'none';
  for (const wash of look.washes) {
    const grad = ctx.createLinearGradient(0, 0, 0, tile.height);
    for (const [at, colour] of wash.stops) grad.addColorStop(at, colour);
    ctx.globalCompositeOperation = wash.mode;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tile.width, tile.height);
  }
  ctx.globalCompositeOperation = 'source-over';
  return tile;
}

let grainCanvas = null;

// A single 256px noise tile, generated once and tiled as a pattern.
function grainPatternSource() {
  if (grainCanvas) return grainCanvas;
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = grainCanvas.height = 256;
  const ctx = grainCanvas.getContext('2d');
  const pixels = ctx.createImageData(256, 256);
  const rand = seededRandom(977);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = 96 + Math.floor(rand() * 96);
    pixels.data[i] = v;
    pixels.data[i + 1] = v;
    pixels.data[i + 2] = v;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return grainCanvas;
}

/* -------------------------------- lettering ------------------------------- */

// Shrinks a type size until the measured line fits; returns the size used.
function fitTypeSize(ctx, text, family, maxWidth, startSize, spacingEm) {
  let size = startSize;
  while (size > 10) {
    ctx.font = size + 'px ' + family;
    try { ctx.letterSpacing = (size * spacingEm).toFixed(1) + 'px'; } catch (err) { /* older engines */ }
    if (ctx.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  }
  return size;
}

// Title block: tagline, big outlined title, and the foot line at the far
// edge. With place set to bottom the whole block mirrors to the foot of
// the cover and the foot line moves to the top instead.
function paintLettering(ctx, W, H, st) {
  const title = (st.title || '').trim().toUpperCase();
  const tagline = (st.tagline || '').trim().toUpperCase();
  const foot = (st.foot || '').trim().toUpperCase();
  if (!title && !tagline && !foot) return;
  const centreX = W / 2;
  const margin = H * 0.032;
  const atTop = st.place !== 'bottom';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const titleFamily = st.font === 'bebas' ? '"Bebas Neue", sans-serif' : '"Anton", sans-serif';
  const titleSize = title
    ? fitTypeSize(ctx, title, titleFamily, W * 0.93, Math.min(W * 0.185, H * 0.17), 0.015)
    : 0;
  const tagSize = Math.max(11, Math.min(W, H) * 0.021);
  const footSize = Math.max(10, Math.min(W, H) * 0.017);

  function shadowOn(blur, drop, alpha) {
    ctx.shadowColor = 'rgba(10,2,24,' + alpha + ')';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = drop;
  }
  function shadowOff() {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  function paintTagline(baseline) {
    if (!tagline) return;
    ctx.font = tagSize + 'px "Bebas Neue", sans-serif';
    try { ctx.letterSpacing = (tagSize * 0.34).toFixed(1) + 'px'; } catch (err) { /* older engines */ }
    shadowOn(tagSize * 0.35, tagSize * 0.08, 0.65);
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText(tagline, centreX, baseline);
    shadowOff();
  }
  function paintTitle(baseline) {
    if (!title) return;
    ctx.font = titleSize + 'px ' + titleFamily;
    try { ctx.letterSpacing = (titleSize * 0.015).toFixed(1) + 'px'; } catch (err) { /* older engines */ }
    const stops = TITLE_INKS[st.fill] || TITLE_INKS.sunset;
    let fillStyle = stops[0];
    if (stops.length > 1) {
      const grad = ctx.createLinearGradient(0, baseline - titleSize, 0, baseline + titleSize * 0.12);
      stops.forEach((colour, i) => grad.addColorStop(i / (stops.length - 1), colour));
      fillStyle = grad;
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#170b31';
    ctx.lineWidth = titleSize * 0.15;
    shadowOn(titleSize * 0.13, titleSize * 0.05, 0.55);
    ctx.strokeText(title, centreX, baseline);
    shadowOff();
    ctx.fillStyle = fillStyle;
    ctx.fillText(title, centreX, baseline);
  }
  function paintFoot(baseline) {
    if (!foot) return;
    ctx.font = footSize + 'px "Bebas Neue", sans-serif';
    try { ctx.letterSpacing = (footSize * 0.3).toFixed(1) + 'px'; } catch (err) { /* older engines */ }
    shadowOn(footSize * 0.4, 0, 0.6);
    ctx.fillStyle = 'rgba(255,240,214,0.92)';
    ctx.fillText(foot, centreX, baseline);
    shadowOff();
  }

  if (atTop) {
    let y = margin + tagSize;
    paintTagline(y);
    if (tagline) y += tagSize * 0.55;
    paintTitle(y + titleSize * 0.92);
    paintFoot(H - margin * 0.72);
  } else {
    paintFoot(margin + footSize);
    const base = H - margin * 0.72;
    paintTitle(base);
    paintTagline(base - titleSize * 1.04);
  }
  try { ctx.letterSpacing = '0px'; } catch (err) { /* older engines */ }
}

/* ------------------------------- whole cover ------------------------------ */

// Paints the cover described by coverState onto canvas at the canvas's
// own pixel size and returns the panel rectangles it used. Pass
// options.highlight as a panel index to ring it (editor only); the
// export path passes -1 so saved files carry no editor chrome.
export function paintCover(canvas, coverState, options) {
  const opts = options || {};
  const highlight = typeof opts.highlight === 'number' ? opts.highlight : -1;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#f7ecd9';
  ctx.fillRect(0, 0, W, H);

  const rects = panelPixels(coverState.layout, W, H);
  rects.forEach((rect, index) => {
    const panel = coverState.panels[index] || blankPanel(-1);
    ctx.save();
    ctx.shadowColor = 'rgba(23,6,43,0.35)';
    ctx.shadowBlur = Math.max(6, W * 0.008);
    ctx.shadowOffsetY = Math.max(2, H * 0.004);
    ctx.fillStyle = '#1c0f33';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const entry = panel.photo >= 0 ? coverState.photos[panel.photo] : null;
    if (entry) {
      ctx.drawImage(gradedTile(entry.img, panel, coverState.grade, rect.w, rect.h), rect.x, rect.y, rect.w, rect.h);
    } else {
      drawDuskScene(ctx, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(18,6,36,0.35)';
    ctx.lineWidth = Math.max(1, W * 0.0012);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  });

  if (coverState.sun) {
    let biggest = rects[0];
    for (const rect of rects) {
      if (rect.w * rect.h >= biggest.w * biggest.h) biggest = rect;
    }
    const radius = Math.min(biggest.w, biggest.h) * 0.24;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.drawImage(stripedSun(radius), biggest.x + biggest.w / 2 - radius, biggest.y + biggest.h * 0.06);
    ctx.restore();
  }

  if (coverState.grain) {
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(grainPatternSource(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
  vignette.addColorStop(0, 'rgba(8,2,18,0)');
  vignette.addColorStop(1, 'rgba(8,2,18,0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  paintLettering(ctx, W, H, coverState);

  ctx.strokeStyle = 'rgba(23,6,43,0.85)';
  ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.004);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

  if (highlight >= 0 && rects[highlight]) {
    const rect = rects[highlight];
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = Math.max(3, W * 0.004);
    ctx.shadowColor = 'rgba(34,211,238,0.8)';
    ctx.shadowBlur = 14;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
  return rects;
}
