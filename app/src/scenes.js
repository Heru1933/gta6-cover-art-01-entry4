// Pre-composed scenes for screenshots and link-sharing previews.
//
// A URL like ?shot=cover&layout=poster&grade=neon&photos=boat,pier asks
// the editor to load that exact composition on startup instead of the
// default one. Two kinds exist: "cover" hides every control so the canvas
// fills the window (a clean export to photograph), and "editor" keeps the
// full workspace visible with the composition loaded. When the frame is
// final — photos decoded, typefaces ready, cover repainted — the page
// sets window.__shotReady so an outside driver knows it can capture.

export async function playScene(kind, params, applyComposition) {
  if (kind === 'cover') document.body.classList.add('frame-cover');

  const composition = {
    size: params.get('size') || '1080x1350',
    layout: params.get('layout') || 'mosaic',
    grade: params.get('grade') || 'sunset',
    photos: (params.get('photos') || 'boulevard,neon,pier,boat')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    title: params.get('title') || 'NEON VICE',
    tagline: params.get('tagline') || 'SUNSET · NEON · TROUBLE',
    foot: params.get('foot') || 'NEON SHORES · EST. 2026',
    font: params.get('font') || 'anton',
    fill: params.get('fill') || 'sunset',
    place: params.get('pos') || 'top',
    sun: params.get('sun') === '1',
    grain: params.get('grain') !== '0',
    selected: Number(params.get('selected') || 0),
  };
  const assignRaw = params.get('assign');
  if (assignRaw) composition.assign = assignRaw.split(',').map((v) => Number(v));
  const oyRaw = params.get('oy');
  if (oyRaw) composition.fyList = oyRaw.split(',').map((v) => Number(v));

  await applyComposition(composition);

  if (document.fonts && document.fonts.load) {
    try {
      await document.fonts.load('80px Anton');
      await document.fonts.load('40px "Bebas Neue"');
    } catch (err) { /* a failed preload still leaves the fallbacks usable */ }
  }
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const editor = await import('./editor.js');
  editor.repaint();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { window.__shotReady = true; });
  });
}
