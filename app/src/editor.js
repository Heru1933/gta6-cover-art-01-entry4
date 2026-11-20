// Neon Vice editor.
//
// Wires the page controls to the renderer in engine.js. Photos are decoded
// locally from object URLs and drawn on this machine only; nothing about
// them leaves the browser. The stage canvas is always kept at the exact
// pixel size of the chosen export, so the preview is the file itself.
import { paintCover, panelPixels, openingPanels, blankPanel, PANEL_LAYOUTS, COLOUR_LOOKS } from './engine.js';
import { playScene } from './scenes.js';

const EXPORT_SIZES = { '1080x1080': [1080, 1080], '1080x1350': [1080, 1350], '1920x1080': [1920, 1080] };
const BUILT_IN = [
  { src: 'samples/boulevard.jpg', label: 'Boulevard' },
  { src: 'samples/neon.jpg', label: 'Neon' },
  { src: 'samples/pier.jpg', label: 'Pier' },
  { src: 'samples/boat.jpg', label: 'Boat' },
];

const stage = document.getElementById('stage');
const statusLine = document.getElementById('status');
const shotKind = new URLSearchParams(location.search).get('shot');

export const state = {
  layout: 'mosaic',
  grade: 'sunset',
  spread: 'each',
  sharedPhoto: 0,
  title: 'NEON VICE',
  tagline: 'SUNSET · NEON · TROUBLE',
  foot: 'NEON SHORES · EST. 2026',
  font: 'anton',
  fill: 'sunset',
  place: 'top',
  sun: false,
  grain: true,
  photos: [],
  panels: openingPanels('mosaic', 0),
  selected: 0,
  size: '1080x1350',
};

let liveRects = panelPixels(state.layout, stage.width, stage.height);
let repaintQueued = false;

// Redraws are coalesced onto the next animation frame; the selection ring
// is editor-only and suppressed while a cover scene is being photographed.
export function repaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    liveRects = paintCover(stage, state, { highlight: shotKind === 'cover' ? -1 : state.selected });
    refreshPanelCard();
  });
}

export function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to decode'));
    img.src = url;
  });
}

export async function addPhotoEntry(url, label) {
  const img = await decodeImage(url);
  state.photos.push({ img, label });
  return state.photos.length - 1;
}

// Re-seats the current layout's opening photo order while preserving the
// framing (zoom, focal point, fit) the user already dialled in per panel.
function reseatPhotos() {
  const fresh = openingPanels(state.layout, state.photos.length);
  state.panels = fresh.map((panel, i) => (state.panels[i]
    ? Object.assign({}, state.panels[i], { photo: panel.photo })
    : panel));
  if (state.selected >= state.panels.length) state.selected = 0;
}

function chooseLayout(id) {
  state.layout = id;
  reseatPhotos();
  document.querySelectorAll('#layoutRow .layout-choice')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.layout === id));
  repaint();
}

function chooseGrade(id) {
  state.grade = id;
  document.querySelectorAll('#gradeRow .grade-choice')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.grade === id));
  repaint();
}

function chooseSpread(mode) {
  state.spread = mode;
  document.getElementById('spreadEach').classList.toggle('active', mode === 'each');
  document.getElementById('spreadOne').classList.toggle('active', mode === 'one');
  if (mode === 'one') {
    state.panels.forEach((panel) => { panel.photo = state.sharedPhoto; });
  } else {
    reseatPhotos();
  }
  rebuildTray();
  repaint();
}

function placePhoto(index) {
  if (state.spread === 'one') {
    state.sharedPhoto = index;
    state.panels.forEach((panel) => { panel.photo = index; });
  } else if (state.panels[state.selected]) {
    state.panels[state.selected].photo = index;
  }
  rebuildTray();
  repaint();
}

function dropPhoto(index) {
  state.photos.splice(index, 1);
  for (const panel of state.panels) {
    if (panel.photo === index) panel.photo = -1;
    else if (panel.photo > index) panel.photo -= 1;
  }
  if (state.sharedPhoto >= state.photos.length) {
    state.sharedPhoto = Math.max(0, state.photos.length - 1);
  }
  rebuildTray();
  repaint();
}

function rebuildTray() {
  const tray = document.getElementById('photoTray');
  tray.replaceChildren();
  if (state.photos.length === 0) {
    const note = document.createElement('p');
    note.className = 'tray-note';
    note.textContent = 'The pool is empty — every panel is showing the drawn dusk scene for now.';
    tray.append(note);
    return;
  }
  const current = state.spread === 'one'
    ? state.sharedPhoto
    : (state.panels[state.selected] || {}).photo;
  state.photos.forEach((entry, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb' + (current === i ? ' active' : '');
    btn.title = entry.label + ' — place in the selected panel';
    const thumb = document.createElement('img');
    thumb.src = entry.img.src;
    thumb.alt = entry.label;
    const remove = document.createElement('span');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove from the pool';
    remove.addEventListener('click', (event) => { event.stopPropagation(); dropPhoto(i); });
    btn.append(thumb, remove);
    btn.addEventListener('click', () => placePhoto(i));
    tray.append(btn);
  });
}

function refreshPanelCard() {
  const panel = state.panels[state.selected];
  document.getElementById('panelName').textContent =
    (state.selected + 1) + ' of ' + state.panels.length;
  if (!panel) return;
  const slider = document.getElementById('zoomRange');
  if (document.activeElement !== slider) slider.value = Math.round(panel.zoom * 100);
  document.getElementById('modeBtn').textContent = panel.contain ? 'Fit: Fit whole photo' : 'Fit: Fill panel';
}

function buildLayoutChoices() {
  const row = document.getElementById('layoutRow');
  for (const [id, layout] of Object.entries(PANEL_LAYOUTS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layout-choice' + (id === state.layout ? ' active' : '');
    btn.dataset.layout = id;
    const shapes = layout.boxes.map(([bx, by, bw, bh]) =>
      '<rect x="' + (bx * 40 + 1).toFixed(1) + '" y="' + (by * 40 + 1).toFixed(1) +
      '" width="' + (bw * 40 - 2).toFixed(1) + '" height="' + (bh * 40 - 2).toFixed(1) + '" rx="1.5"/>').join('');
    btn.innerHTML = '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">' + shapes + '</svg><span>' + layout.name + '</span>';
    btn.addEventListener('click', () => chooseLayout(id));
    row.append(btn);
  }
}

function buildGradeChoices() {
  const row = document.getElementById('gradeRow');
  const shortLabels = { sunset: 'SUNSET', neon: 'NEON', golden: 'GOLDEN', noir: 'NOIR', clean: 'CLEAN' };
  for (const id of Object.keys(COLOUR_LOOKS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grade-choice look-' + id + (id === state.grade ? ' active' : '');
    btn.dataset.grade = id;
    btn.textContent = shortLabels[id];
    btn.title = COLOUR_LOOKS[id].name;
    btn.addEventListener('click', () => chooseGrade(id));
    row.append(btn);
  }
}

function chooseSize(key) {
  const dims = EXPORT_SIZES[key];
  if (!dims) return;
  state.size = key;
  stage.width = dims[0];
  stage.height = dims[1];
  document.querySelectorAll('.size-bar button')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.size === key));
  document.getElementById('exportBtn').textContent = 'Download PNG · ' + dims[0] + ' × ' + dims[1];
  repaint();
}

// Renders the clean cover (no selection ring) at an exact size.
export function renderSized(w, h) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  paintCover(out, state, { highlight: -1 });
  return out;
}

export function savePNG(w, h) {
  renderSized(w, h).toBlob((blob) => {
    if (!blob) return;
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'neon-vice-' + w + 'x' + h + '.png';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 4000);
    statusLine.textContent = 'Saved neon-vice-' + w + 'x' + h + '.png — ready to post.';
  }, 'image/png');
}

async function ingestFiles(fileList) {
  const images = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
  if (images.length === 0) return;
  let target = state.selected;
  for (const file of images) {
    const index = await addPhotoEntry(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''));
    if (state.spread === 'one') {
      state.sharedPhoto = index;
    } else if (state.panels[target]) {
      state.panels[target].photo = index;
      target = (target + 1) % state.panels.length;
    }
  }
  if (state.spread === 'one') {
    state.panels.forEach((panel) => { panel.photo = state.sharedPhoto; });
  }
  statusLine.textContent = images.length + (images.length > 1 ? ' photos' : ' photo') +
    ' added — drag inside a panel to compose it, then export.';
  rebuildTray();
  repaint();
}

// Applies a complete composition in one go (screenshot scenes use this).
export async function applyComposition(comp) {
  if (comp.size && EXPORT_SIZES[comp.size]) chooseSize(comp.size);
  if (comp.layout && PANEL_LAYOUTS[comp.layout]) state.layout = comp.layout;
  if (comp.grade && COLOUR_LOOKS[comp.grade]) state.grade = comp.grade;
  if (comp.photos) {
    state.photos = [];
    for (const wanted of comp.photos) {
      const sample = BUILT_IN.find((s) => s.src.endsWith('/' + wanted + '.jpg'));
      if (sample) await addPhotoEntry(sample.src, sample.label);
    }
  }
  reseatPhotos();
  if (comp.assign) {
    comp.assign.forEach((photoIndex, i) => {
      if (state.panels[i]) state.panels[i].photo = photoIndex;
    });
  }
  if (comp.fyList) {
    comp.fyList.forEach((fy, i) => {
      if (state.panels[i] && Number.isFinite(fy)) state.panels[i].fy = fy;
    });
  }
  const wordFields = [['title', 'titleInput'], ['tagline', 'taglineInput'], ['foot', 'bottomInput']];
  for (const [key, id] of wordFields) {
    if (comp[key] !== undefined) {
      state[key] = comp[key];
      document.getElementById(id).value = comp[key];
    }
  }
  if (comp.font) { state.font = comp.font; document.getElementById('fontSelect').value = comp.font; }
  if (comp.fill) { state.fill = comp.fill; document.getElementById('fillSelect').value = comp.fill; }
  if (comp.place) { state.place = comp.place; document.getElementById('posSelect').value = comp.place; }
  if (comp.sun !== undefined) { state.sun = comp.sun; document.getElementById('sunToggle').checked = comp.sun; }
  if (comp.grain !== undefined) { state.grain = comp.grain; document.getElementById('grainToggle').checked = comp.grain; }
  if (comp.selected !== undefined) {
    state.selected = Math.max(0, Math.min(comp.selected, state.panels.length - 1));
  }
  document.querySelectorAll('#layoutRow .layout-choice')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.layout === state.layout));
  document.querySelectorAll('#gradeRow .grade-choice')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.grade === state.grade));
  rebuildTray();
  repaint();
}

function bindControls() {
  const byId = (id) => document.getElementById(id);
  byId('fileInput').addEventListener('change', (event) => {
    ingestFiles(event.target.files);
    event.target.value = '';
  });
  byId('spreadEach').addEventListener('click', () => chooseSpread('each'));
  byId('spreadOne').addEventListener('click', () => chooseSpread('one'));
  byId('sunToggle').addEventListener('change', (event) => { state.sun = event.target.checked; repaint(); });
  byId('grainToggle').addEventListener('change', (event) => { state.grain = event.target.checked; repaint(); });
  const wordBindings = [['titleInput', 'title'], ['taglineInput', 'tagline'], ['bottomInput', 'foot']];
  for (const [id, key] of wordBindings) {
    byId(id).addEventListener('input', (event) => { state[key] = event.target.value; repaint(); });
  }
  byId('fontSelect').addEventListener('change', (event) => { state.font = event.target.value; repaint(); });
  byId('fillSelect').addEventListener('change', (event) => { state.fill = event.target.value; repaint(); });
  byId('posSelect').addEventListener('change', (event) => { state.place = event.target.value; repaint(); });
  document.querySelectorAll('.size-bar button')
    .forEach((btn) => btn.addEventListener('click', () => chooseSize(btn.dataset.size)));
  byId('exportBtn').addEventListener('click', () => {
    const dims = EXPORT_SIZES[state.size];
    savePNG(dims[0], dims[1]);
  });
  document.querySelectorAll('[data-export]')
    .forEach((btn) => btn.addEventListener('click', () => {
      const dims = EXPORT_SIZES[btn.dataset.export];
      if (dims) savePNG(dims[0], dims[1]);
    }));

  byId('zoomRange').addEventListener('input', (event) => {
    const panel = state.panels[state.selected];
    if (panel) { panel.zoom = Number(event.target.value) / 100; repaint(); }
  });
  byId('modeBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    if (panel) { panel.contain = !panel.contain; repaint(); }
  });
  byId('centerBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    if (panel) { panel.fx = 0.5; panel.fy = 0.5; repaint(); }
  });
  const stepPhoto = (direction) => {
    const panel = state.panels[state.selected];
    if (!panel || state.photos.length === 0) return;
    const total = state.photos.length;
    panel.photo = (((panel.photo + direction) % total) + total) % total;
    rebuildTray();
    repaint();
  };
  byId('prevPhotoBtn').addEventListener('click', () => stepPhoto(-1));
  byId('nextPhotoBtn').addEventListener('click', () => stepPhoto(1));
  byId('sceneBtn').addEventListener('click', () => {
    const panel = state.panels[state.selected];
    if (panel) { panel.photo = -1; rebuildTray(); repaint(); }
  });

  const zone = byId('dropZone');
  window.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragging'); });
  window.addEventListener('dragleave', (event) => { if (!event.relatedTarget) zone.classList.remove('dragging'); });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    ingestFiles(event.dataTransfer.files);
  });

  let dragState = null;
  const toCoverPoint = (event) => {
    const bounds = stage.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * stage.width / bounds.width,
      y: (event.clientY - bounds.top) * stage.height / bounds.height,
    };
  };
  stage.addEventListener('pointerdown', (event) => {
    const point = toCoverPoint(event);
    const hit = liveRects.findIndex((r) => point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h);
    if (hit === -1) return;
    state.selected = hit;
    const panel = state.panels[hit];
    dragState = { x: point.x, y: point.y, fx: panel.fx, fy: panel.fy };
    stage.setPointerCapture(event.pointerId);
    rebuildTray();
    repaint();
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const panel = state.panels[state.selected];
    const entry = panel && panel.photo >= 0 ? state.photos[panel.photo] : null;
    if (!entry) return;
    const point = toCoverPoint(event);
    const rect = liveRects[state.selected];
    const iw = entry.img.naturalWidth || entry.img.width;
    const ih = entry.img.naturalHeight || entry.img.height;
    const scale = Math.max(rect.w / iw, rect.h / ih) * panel.zoom;
    const overflowX = iw * scale - rect.w;
    const overflowY = ih * scale - rect.h;
    if (overflowX > 0) panel.fx = Math.min(1, Math.max(0, dragState.fx - (point.x - dragState.x) / overflowX));
    if (overflowY > 0) panel.fy = Math.min(1, Math.max(0, dragState.fy - (point.y - dragState.y) / overflowY));
    repaint();
  });
  stage.addEventListener('pointerup', () => { dragState = null; });
  stage.addEventListener('pointercancel', () => { dragState = null; });
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const panel = state.panels[state.selected];
    if (!panel) return;
    panel.zoom = Math.min(4, Math.max(0.4, panel.zoom * Math.exp(-event.deltaY * 0.0012)));
    repaint();
  }, { passive: false });

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    const panel = state.panels[state.selected];
    if (!panel) return;
    const nudge = 0.03;
    if (event.key === 'ArrowLeft') panel.fx = Math.max(0, panel.fx - nudge);
    else if (event.key === 'ArrowRight') panel.fx = Math.min(1, panel.fx + nudge);
    else if (event.key === 'ArrowUp') panel.fy = Math.max(0, panel.fy - nudge);
    else if (event.key === 'ArrowDown') panel.fy = Math.min(1, panel.fy + nudge);
    else if (event.key === '+' || event.key === '=') panel.zoom = Math.min(4, panel.zoom * 1.08);
    else if (event.key === '-') panel.zoom = Math.max(0.4, panel.zoom / 1.08);
    else return;
    event.preventDefault();
    repaint();
  });
}

buildLayoutChoices();
buildGradeChoices();
bindControls();
window.__neonVice = { state, paintCover, savePNG, renderSized, applyComposition, addPhotoEntry, repaint };

if (shotKind) {
  playScene(shotKind, new URLSearchParams(location.search), applyComposition);
} else {
  (async () => {
    for (const sample of BUILT_IN) {
      try {
        await addPhotoEntry(sample.src, sample.label);
      } catch (err) { /* one missing sample must never block the editor */ }
    }
    reseatPhotos();
    rebuildTray();
    repaint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => repaint());
  })();
}
