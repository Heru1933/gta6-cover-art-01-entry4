// Verification and screenshot capture for the Neon Vice entry.
//
//   node tools/capture.mjs            run export checks, then take the shots
//   node tools/capture.mjs --verify   export checks only
//   node tools/capture.mjs --shots    screenshots only
//
// The tool starts the app's own static server, drives headless Chrome over
// the DevTools protocol (Node's built-in WebSocket, nothing to install),
// and talks to the app exactly the way a user would: it waits for the four
// built-in photos, clicks the real export buttons and inspects the PNG
// files that land in the download folder, then pushes one more photo
// through the real file input. Screenshots are read from shots.json and
// written into screenshots/; every file must respect the gate limits of
// 262144 bytes, a long side of at most 1280 and a short side of at least
// 480. Browser scratch lives under ~/.nv-scratch on the home filesystem
// because the small /tmp tmpfs cannot hold a Chrome profile.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_PORT = 8141;
const DEBUG_PORT = 9347;
const SCRATCH = join(process.env.HOME, '.nv-scratch');
const CHROME_CANDIDATE = join(SCRATCH, 'chrome-linux64', 'chrome');
const CHROME = process.env.CHROME_BIN || (existsSync(CHROME_CANDIDATE) ? CHROME_CANDIDATE : '/opt/meta-chromium/chrome');
const DOWNLOAD_DIR = join(SCRATCH, 'rec4-downloads');
const PROFILE_DIR = join(SCRATCH, 'rec4-profile');
const BYTE_CAP = 262144;
const specs = JSON.parse(readFileSync(join(entryRoot, 'shots.json'), 'utf8'));
const problems = [];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, probe, budgetMs) {
  const limit = budgetMs || 20000;
  const began = Date.now();
  for (;;) {
    try {
      if (await probe()) return;
    } catch (err) { /* not ready yet */ }
    if (Date.now() - began > limit) throw new Error('timed out waiting for ' + label);
    await pause(200);
  }
}

const webServer = spawn('node', ['serve.ts', '--port', String(WEB_PORT)], { cwd: entryRoot, stdio: 'ignore' });
const browser = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + PROFILE_DIR, 'about:blank',
], { stdio: 'ignore' });

let socket = null;
let callSeq = 0;
const pending = new Map();

function send(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    callSeq += 1;
    pending.set(callSeq, { resolve, reject });
    const message = { id: callSeq, method, params: params || {} };
    if (sessionId) message.sessionId = sessionId;
    socket.send(JSON.stringify(message));
  });
}

async function connectBrowser() {
  const versionDoc = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version')).json();
  socket = new WebSocket(versionDoc.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails;
      problems.push('exception: ' + (detail.exception && detail.exception.description ? detail.exception.description : detail.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push('console: ' + msg.params.args.map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' '));
    }
  };
}

async function newPage(url, width, height) {
  const created = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  return { targetId: created.targetId, sessionId };
}

async function runInPage(sessionId, expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (reply.exceptionDetails) {
    const detail = reply.exceptionDetails;
    throw new Error('page evaluation failed: ' + (detail.exception && detail.exception.description ? detail.exception.description : detail.text));
  }
  return reply.result.value;
}

function pngSize(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) throw new Error('downloaded file is not a PNG');
  }
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('screenshot is not a JPEG');
  let at = 2;
  while (at + 9 < buffer.length) {
    if (buffer[at] !== 0xff) { at += 1; continue; }
    const marker = buffer[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buffer.readUInt16BE(at + 5), w: buffer.readUInt16BE(at + 7) };
    }
    at += 2 + buffer.readUInt16BE(at + 2);
  }
  throw new Error('no JPEG size frame found');
}

async function verifyExports() {
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR, eventsEnabled: true });
  const page = await newPage('http://127.0.0.1:' + WEB_PORT + '/', 1280, 900);
  await waitFor('built-in photos composed', async () =>
    (await runInPage(page.sessionId, 'window.__neonVice && window.__neonVice.state.photos.length')) === 4);
  console.log('verify: editor loaded with 4 built-in photos, no errors so far');

  await runInPage(page.sessionId, 'document.querySelector(\'[data-export="1080x1080"]\').click()');
  await waitFor('square PNG download', () => existsSync(join(DOWNLOAD_DIR, 'neon-vice-1080x1080.png')), 15000);
  const square = readFileSync(join(DOWNLOAD_DIR, 'neon-vice-1080x1080.png'));
  const squareDims = pngSize(square);
  console.log('verify: neon-vice-1080x1080.png is ' + square.length + ' bytes at ' + squareDims.w + 'x' + squareDims.h);
  if (squareDims.w !== 1080 || squareDims.h !== 1080) throw new Error('square export has the wrong size');

  await runInPage(page.sessionId, `(async () => {
    const source = window.__neonVice.state.photos[3].img;
    const helper = document.createElement('canvas');
    helper.width = source.naturalWidth; helper.height = source.naturalHeight;
    helper.getContext('2d').drawImage(source, 0, 0);
    const blob = await new Promise((done) => helper.toBlob(done, 'image/jpeg', 0.9));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'harbour-evening.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('fileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor('user photo accepted', async () =>
    (await runInPage(page.sessionId, 'window.__neonVice.state.photos.length')) === 5);
  console.log('verify: a photo sent through the file input joined the pool');

  await runInPage(page.sessionId, 'document.querySelector(\'[data-export="1920x1080"]\').click()');
  await waitFor('wide PNG download', () => existsSync(join(DOWNLOAD_DIR, 'neon-vice-1920x1080.png')), 15000);
  const wide = readFileSync(join(DOWNLOAD_DIR, 'neon-vice-1920x1080.png'));
  const wideDims = pngSize(wide);
  console.log('verify: neon-vice-1920x1080.png is ' + wide.length + ' bytes at ' + wideDims.w + 'x' + wideDims.h);
  if (wideDims.w !== 1920 || wideDims.h !== 1080) throw new Error('wide export has the wrong size');
  await send('Target.closeTarget', { targetId: page.targetId });
}

async function takeShot(spec) {
  const page = await newPage('http://127.0.0.1:' + WEB_PORT + '/' + spec.query, spec.w, spec.h);
  await waitFor('scene ' + spec.name + ' ready', async () =>
    (await runInPage(page.sessionId, 'window.__shotReady === true')) === true, 30000);
  await pause(250);
  let buffer = null;
  if (spec.kind === 'cover') {
    for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56]) {
      const dataUrl = await runInPage(page.sessionId, `(() => {
        const stageEl = document.getElementById('stage');
        const out = document.createElement('canvas');
        out.width = ${spec.outW}; out.height = ${spec.outH};
        out.getContext('2d').drawImage(stageEl, 0, 0, out.width, out.height);
        return out.toDataURL('image/jpeg', ${quality});
      })()`);
      buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
      if (buffer.length <= BYTE_CAP) break;
    }
  } else {
    for (const quality of [88, 78, 68, 58, 48]) {
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality }, page.sessionId);
      buffer = Buffer.from(shot.data, 'base64');
      if (buffer.length <= BYTE_CAP) break;
    }
  }
  await send('Target.closeTarget', { targetId: page.targetId });
  const dims = jpegSize(buffer);
  console.log('shot: ' + spec.name + ' — ' + buffer.length + ' bytes at ' + dims.w + 'x' + dims.h);
  if (buffer.length > BYTE_CAP) throw new Error(spec.name + ' is over the 262144-byte cap');
  if (Math.max(dims.w, dims.h) > 1280) throw new Error(spec.name + ' has a long side over 1280');
  if (Math.min(dims.w, dims.h) < 480) throw new Error(spec.name + ' has a short side under 480');
  writeFileSync(join(entryRoot, 'screenshots', spec.name), buffer);
}

async function main() {
  const mode = process.argv[2] || 'all';
  try {
    await waitFor('static server answering', async () => (await fetch('http://127.0.0.1:' + WEB_PORT + '/')).ok, 10000);
    await waitFor('chrome devtools answering', async () => (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version')).ok, 15000);
    await connectBrowser();
    if (mode === 'all' || mode === '--verify') await verifyExports();
    if (mode === 'all' || mode === '--shots') {
      mkdirSync(join(entryRoot, 'screenshots'), { recursive: true });
      for (const spec of specs) await takeShot(spec);
    }
    if (problems.length > 0) {
      console.error('PAGE PROBLEMS (' + problems.length + '):\n' + problems.join('\n'));
      process.exitCode = 2;
    } else {
      console.log('no page errors recorded');
    }
  } finally {
    try { if (socket) socket.close(); } catch (err) { /* already closed */ }
    webServer.kill();
    browser.kill();
  }
}

main().catch((err) => {
  console.error('FAILED: ' + err.message);
  webServer.kill();
  browser.kill();
  process.exit(1);
});
