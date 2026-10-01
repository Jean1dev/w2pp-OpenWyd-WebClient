// Stage 6 baseline on the offline Field scene (no server, no credentials):
// cold/warm startup, bytes, JS/WASM heap, frame time p50/p95/p99 and the
// package files the runtime actually opens, against the preloaded package.
//
//   node tools/measure_scene.mjs [--seconds 60] [--browser chromium|firefox]
//
// The page is instrumented from outside: an init script wraps Module.FS.open
// and Module._wyd_tick_client once the runtime initializes. Nothing in the
// runtime or the page changes.
import { chromium, firefox } from 'playwright';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: {
  seconds: { type: 'string', default: '60' },
  browser: { type: 'string', default: 'chromium' },
  out: { type: 'string', default: '.cache/measure' },
} });
const SECONDS = Number(opt.seconds);
if (!(SECONDS >= 5 && SECONDS <= 3600)) throw new Error('--seconds must be 5..3600');
if (!['chromium', 'firefox'].includes(opt.browser)) throw new Error('--browser must be chromium or firefox');
const SITE = resolve('.cache/local-scene');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.mp3': 'audio/mpeg', '.png': 'image/png' };

async function serveSite() {
  let bytes = 0;
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = normalize(requested === '/' ? 'index.html' : requested).replace(/^[\\/]+/, '');
    const file = join(SITE, relative);
    if (!file.startsWith(SITE)) { response.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': info.size, 'cache-control': 'no-cache' });
      bytes += info.size;
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, served: () => bytes, reset: () => { bytes = 0; } };
}

// Package index (file_packager metadata): path -> size.
async function packageIndex() {
  const js = await readFile(join(SITE, 'openwyd_assets.js'), 'utf8');
  const m = js.match(/loadPackage\((\{[\s\S]*?\})\);/);
  if (!m) throw new Error('package metadata not found in openwyd_assets.js');
  const files = JSON.parse(m[1]).files;
  return new Map(files.map(f => [f.filename.toLowerCase().replace(/\/{2,}/g, '/'), f.end - f.start]));
}

const INIT = () => {
  window.__measure = { t0: performance.now(), opens: new Map(), ticks: [], rafs: [], ready: null, firstFrame: null };
  let mod;
  Object.defineProperty(window, 'Module', {
    configurable: true,
    get() { return mod; },
    set(value) {
      mod = value;
      // The runtime reassigns Module to itself; wrap the page's object once.
      if (!value || value.__measured || typeof value.onRuntimeInitialized !== 'function') return;
      value.__measured = true;
      const init = value.onRuntimeInitialized;
      value.onRuntimeInitialized = function () {
        const m = window.__measure;
        m.ready = performance.now() - m.t0;
        const fs = value.FS;
        const open = fs.open;
        fs.open = function (path, ...rest) {
          if (typeof path === 'string') {
            const key = path.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
            m.opens.set(key, (m.opens.get(key) ?? 0) + 1);
          }
          return open.call(this, path, ...rest);
        };
        const result = init.apply(this, arguments);
        const tick = value._wyd_tick_client;
        value._wyd_tick_client = function () {
          const a = performance.now();
          const r = tick.apply(this, arguments);
          const b = performance.now();
          if (m.firstFrame === null) m.firstFrame = b - m.t0;
          if (m.ticks.length < 200000) { m.ticks.push(b - a); m.rafs.push(b); }
          return r;
        };
        return result;
      };
    },
  });
};

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2);
};

async function run(context, site, label, index) {
  site.reset();
  const page = await context.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === site.origin ? route.continue() : route.abort());
  const nav = Date.now();
  await page.goto(`${site.origin}/?state=0`, { waitUntil: 'load', timeout: 300000 });
  // Poll with evaluate: the page CSP forbids the eval behind waitForFunction.
  for (const end = Date.now() + 300000; ; await page.waitForTimeout(500)) {
    const state = await page.evaluate(() => ({ hooked: !!window.__measure, frame: window.__measure?.firstFrame ?? null,
      errors: window.sceneEvidence?.errors?.length ?? 0 }));
    if (!state.hooked) throw new Error('init script did not run');
    if (state.frame !== null || state.errors) break;
    if (Date.now() > end) throw new Error('no frame within 300 s');
  }
  const startup = await page.evaluate(() => ({ ready: window.__measure.ready, firstFrame: window.__measure.firstFrame }));
  // Steady state: drop what came before, then sample for SECONDS.
  await page.evaluate(() => { window.__measure.ticks.length = 0; window.__measure.rafs.length = 0; });
  await page.waitForTimeout(SECONDS * 1000);
  const m = await page.evaluate(() => {
    const w = window.__measure;
    return { ticks: w.ticks, rafs: w.rafs, opens: [...w.opens],
      js: performance.memory?.usedJSHeapSize ?? null, wasm: window.Module?.HEAPU8?.length ?? null,
      frames: window.sceneEvidence?.frames, errors: window.sceneEvidence?.errors ?? [], probe: window.sceneEvidence?.probe };
  });
  await page.screenshot({ path: join(opt.out, `measure-${label}.png`) });
  await page.close();
  const intervals = m.rafs.slice(1).map((t, k) => t - m.rafs[k]);
  const opened = m.opens.map(([p]) => p).filter(p => index.has(p));
  const openedBytes = opened.reduce((s, p) => s + index.get(p), 0);
  return {
    label, wallMs: Date.now() - nav, readyMs: +startup.ready.toFixed(0), firstFrameMs: +startup.firstFrame.toFixed(0),
    servedBytes: site.served(),
    memory: { jsHeapMiB: m.js && +(m.js / 2 ** 20).toFixed(1), wasmHeapMiB: m.wasm && +(m.wasm / 2 ** 20).toFixed(1) },
    frames: { sampledSeconds: SECONDS, count: m.ticks.length, fps: +(m.ticks.length / SECONDS).toFixed(2),
      tickMs: { p50: pct(m.ticks, 50), p95: pct(m.ticks, 95), p99: pct(m.ticks, 99) },
      intervalMs: { p50: pct(intervals, 50), p95: pct(intervals, 95), p99: pct(intervals, 99) } },
    files: { packageFiles: index.size, packageMiB: +([...index.values()].reduce((a, b) => a + b, 0) / 2 ** 20).toFixed(1),
      opened: opened.length, openedMiB: +(openedBytes / 2 ** 20).toFixed(1),
      openedOutsidePackage: m.opens.length - opened.length },
    openedPaths: opened.sort(),
    errors: [...errors, ...m.errors],
    probe: m.probe && { state: m.probe.state, fieldFixture: m.probe.fieldFixture, webgl2: m.probe.webgl2,
      glErrorTotal: m.probe.glErrorTotal, drawCalls: m.probe.drawCalls },
  };
}

await mkdir(opt.out, { recursive: true });
const site = await serveSite();
const index = await packageIndex();
// Persistent profile so the second run hits the IndexedDB package cache (warm).
const profile = await mkdtemp(join(tmpdir(), 'wyd-measure-'));
const engine = { chromium, firefox }[opt.browser];
let context;
const report = { when: new Date().toISOString(), browser: opt.browser, viewport: '1100x900 (canvas 800x600)', headless: true, runs: [] };
try {
  context = await engine.launchPersistentContext(profile, { headless: true });
  report.version = context.browser()?.version() ?? null;
  await context.addInitScript(INIT);
  for (const label of ['cold', 'warm']) {
    const r = await run(context, site, label, index);
    console.log(`${label}: ready ${r.readyMs} ms, first frame ${r.firstFrameMs} ms, served ${(r.servedBytes / 2 ** 20).toFixed(1)} MiB, ` +
      `js ${r.memory.jsHeapMiB} MiB, wasm ${r.memory.wasmHeapMiB} MiB, ${r.frames.fps} fps, tick p50/p95 ` +
      `${r.frames.tickMs.p50}/${r.frames.tickMs.p95} ms, opened ${r.files.opened} files (${r.files.openedMiB} of ${r.files.packageMiB} MiB)`);
    report.runs.push(r);
  }
} finally {
  await context?.close();
  await new Promise(done => site.server.close(done));
  await rm(profile, { recursive: true, force: true });
}
await writeFile(join(opt.out, `measure-${opt.browser}.json`), JSON.stringify(report, null, 1) + '\n');
console.log(`evidence: ${join(opt.out, `measure-${opt.browser}.json`)}`);
if (report.runs.some(r => r.errors.length)) process.exitCode = 1;
