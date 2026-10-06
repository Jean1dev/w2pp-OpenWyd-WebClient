// Serial, localhost-only cache checks. Fixtures exercise the actual Emscripten
// loader; --real also boots client.html with operator assets, without login,
// and records the loading screen (stage, bar, detail) against the real package.
// --slow adds a Chromium first visit throttled to DevTools "Fast 4G" for a
// window, then unthrottled, to read the speed and time left the screen shows.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep, join } from 'node:path';
import { chromium, firefox } from 'playwright';

const out = resolve('.cache/asset-cache');
await mkdir(out, { recursive: true });
const runDir = await mkdtemp(join(out, 'run-'));
const fixture = join(runDir, 'fixture');
await mkdir(fixture);
const packager = resolve('.cache/toolchains/emsdk/upstream/emscripten/tools/file_packager.py');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.mp3': 'audio/mpeg' };

// Minimal isolated FS consumer, deliberately not evidence of gameplay.
await writeFile(join(fixture, 'index.html'), `<script>
window.result = null;
var Module = {calledRun:true, FS_createPath(){}, addRunDependency(){},
 FS_createDataFile(name, unused, bytes){window.payload = new TextDecoder().decode(bytes)},
 removeRunDependency(name){if(name === 'datafile_openwyd_assets.data')
   window.result = {payload: window.payload, preload: Module.preloadResults}}
};
</script><script src="openwyd_assets.js"></script>`);

async function packageFixture(content) {
  await writeFile(join(fixture, 'payload.txt'), content);
  const child = spawnSync('python', [packager, 'openwyd_assets.data', '--preload',
    'payload.txt@/payload.txt', '--js-output=openwyd_assets.js', '--use-preload-cache',
    '--indexedDB-name=WYD_PRELOAD_CACHE', '--no-node', '--quiet'], { cwd: fixture, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
}

let served = { dataRequests: 0, dataBytes: 0, totalBytes: 0 };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/real/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ channel: 'cache-test', clientVersion: 12000,
      wsUrl: `ws://127.0.0.1:${server.address().port}/unused` }));
    return;
  }
  const real = pathname.startsWith('/real/');
  const base = real ? resolve('.cache/local-scene') : fixture;
  const relative = pathname.replace(/^\/(real|fixture)\//, '') || 'index.html';
  const file = resolve(base, relative);
  if (!file.startsWith(base + sep)) { res.writeHead(403).end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    if (file.endsWith('.data')) { served.dataRequests++; served.dataBytes += info.size; }
    served.totalBytes += info.size;
    // Disable HTTP cache: a warm success must come from IndexedDB.
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
const MiB = 1024 * 1024;
// DevTools "Fast 4G": 9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency.
const FAST_4G = { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };
const SLOW_WINDOW_MS = 30000;

// Loading screen trace: every change of #loader, timed from navigation.
function traceLoader() {
  window.__loaderTrace = [];
  const t0 = performance.now();
  const sample = () => {
    const root = document.getElementById('loader');
    if (!root) return;
    const bar = document.getElementById('loader-bar');
    const row = { t: Math.round(performance.now() - t0),
      stage: document.getElementById('loader-stage')?.textContent ?? '',
      value: bar?.hasAttribute('aria-valuenow') ? Number(bar.getAttribute('aria-valuenow')) : null,
      detail: document.getElementById('loader-detail')?.textContent ?? '',
      hidden: root.hidden, leaving: root.classList.contains('leaving') };
    const last = window.__loaderTrace.at(-1);
    if (!last || last.stage !== row.stage || last.value !== row.value || last.detail !== row.detail || last.hidden !== row.hidden)
      window.__loaderTrace.push(row);
  };
  new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

// Checks the trace of a real visit and keeps a short summary for the evidence.
function checkLoader(trace, { cached, dataSize }) {
  const stages = [...new Set(trace.map(r => r.stage))];
  const values = trace.map(r => r.value).filter(v => v !== null);
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `bar went back: ${values[i - 1]} -> ${values[i]}`);
  assert.ok(trace.at(-1).hidden, 'loader still visible after the first frames');
  const firstFrameAt = trace.find(r => r.hidden)?.t ?? null;
  const summary = { stages, maxValue: values.length ? Math.max(...values) : null, rows: trace.length, hiddenAt: firstFrameAt };
  if (cached) {
    assert.ok(stages.includes('Abrindo os dados guardados no navegador…'), `warm stages: ${stages}`);
    assert.ok(!stages.includes('Baixando dados do jogo…'), 'warm visit showed the download stage');
    const open = trace.find(r => r.stage === 'Abrindo os dados guardados no navegador…');
    summary.cacheReadMs = firstFrameAt !== null ? firstFrameAt - open.t : null;
  } else {
    assert.ok(stages.includes('Baixando dados do jogo…'), `cold stages: ${stages}`);
    assert.equal(summary.maxValue, 100);
    // "X / Y MB · r MB/s · ~t": MB is MiB, pt-BR grouping, no decimals.
    const totals = trace.map(r => r.detail.match(/\/ ([\d.]+) MB/)?.[1]).filter(Boolean);
    assert.ok(totals.length, 'no byte total shown');
    summary.shownTotalMB = Number(totals.at(-1).replace(/\./g, ''));
    summary.realTotalMiB = Math.round(dataSize / MiB * 10) / 10;
    assert.ok(Math.abs(summary.realTotalMiB - summary.shownTotalMB) <= 1,
      `shown total ${summary.shownTotalMB} MB does not match ${dataSize} bytes`);
    assert.ok(stages.includes('Guardando os dados no navegador…'), 'no storing stage at 100%');
    const dl = trace.filter(r => r.stage === 'Baixando dados do jogo…');
    summary.downloadMs = dl.length ? dl.at(-1).t - dl[0].t : null;
    summary.sampleDetail = dl[Math.floor(dl.length / 2)]?.detail ?? null;
  }
  return summary;
}

async function visit(context, name, { real = false, cached = false, fault = null, payload, slow = false } = {}) {
  served = { dataRequests: 0, dataBytes: 0, totalBytes: 0 };
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (real) await page.addInitScript(traceLoader);
  let throttle = null;
  if (slow) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', FAST_4G);
    throttle = { cdp, details: [] };
  }
  if (fault) await page.addInitScript(mode => {
    if (mode === 'unavailable') Object.defineProperty(window, 'indexedDB', { value: undefined });
    if (mode === 'write') IDBObjectStore.prototype.put = function () {
      throw new DOMException('simulated quota exceeded', 'QuotaExceededError');
    };
  }, fault);
  const start = performance.now();
  try {
    await page.goto(`${origin}/${real ? 'real/client.html' : 'fixture/index.html'}`, { timeout: 180000 });
    // Playwright's waitForFunction uses eval, forbidden by the real page's CSP.
    while (!await page.evaluate(isReal => isReal ? window.clientEvidence?.frames >= 15 &&
        document.getElementById('loader')?.hidden : !!window.result, real)) {
      assert.deepEqual(errors, []);
      assert.ok(performance.now() - start < 180000 + (slow ? SLOW_WINDOW_MS : 0), 'client did not initialize within 180 s');
      // Fast 4G for a window, read what the screen says, then full speed.
      if (throttle && !throttle.lifted && performance.now() - start > SLOW_WINDOW_MS) {
        throttle.details = (await page.evaluate(() => window.__loaderTrace))
          .filter(r => r.stage === 'Baixando dados do jogo…').map(r => ({ t: r.t, detail: r.detail }));
        await throttle.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        throttle.lifted = true;
      }
      await new Promise(done => setTimeout(done, 100));
    }
    const result = await page.evaluate(isReal => isReal ? {
      preload: Module.preloadResults, evidence: window.clientEvidence,
    } : window.result, real);
    assert.deepEqual(errors, []);
    assert.equal(result.preload['openwyd_assets.data']?.fromCache ?? false, cached);
    assert.equal(served.dataRequests, cached ? 0 : 1);
    if (payload !== undefined) assert.equal(result.payload, payload);
    if (real) {
      assert.deepEqual(result.evidence.errors, []);
      assert.equal(result.evidence.probe.state, 7);
      assert.equal(result.evidence.probe.placeholder, 0);
      assert.equal(result.evidence.probe.webgl2, 1);
      assert.equal(result.evidence.probe.glErrorTotal, 0);
      assert.equal(result.evidence.assetPreload.fromCache, cached);
      await page.screenshot({ path: join(runDir, `${context.browser()?.browserType().name() ?? 'browser'}-${name}.png`) });
    }
    const summary = { name, ms: Math.round(performance.now() - start), ...served, fromCache: cached };
    if (real) {
      const dataSize = (await stat(resolve('.cache/local-scene/openwyd_assets.data'))).size;
      summary.loader = checkLoader(await page.evaluate(() => window.__loaderTrace), { cached, dataSize });
    }
    if (throttle) {
      // Speed shown under Fast 4G (1.07 MiB/s nominal) and the time left it implied.
      assert.ok(throttle.lifted, 'download ended before the throttled window');
      const shown = throttle.details.map(r => r.detail.match(/([\d,]+) MB\/s · ~(.+)$/)).filter(Boolean)
        .map(m => ({ rate: Number(m[1].replace(',', '.')), eta: m[2] }));
      assert.ok(shown.length, 'no speed shown under Fast 4G');
      const last = shown.at(-1);
      assert.ok(last.rate > 0.5 && last.rate < 1.6, `Fast 4G shown as ${last.rate} MB/s`);
      summary.throttled = { windowMs: SLOW_WINDOW_MS, samples: shown.length, lastRate: last.rate, lastEta: last.eta,
        lastDetail: throttle.details.at(-1)?.detail };
    }
    console.log(JSON.stringify(summary));
    return summary;
  } finally { await page.close(); }
}

try {
  for (const engine of [chromium, firefox]) {
    const profile = join(runDir, engine.name());
    const launch = () => engine.launchPersistentContext(profile, { headless: true,
      viewport: { width: 1100, height: 900 } });
    let context = await launch();
    const report = { browser: engine.name(), version: context.browser()?.version(), cases: [] };
    results.push(report);
    try {
      await packageFixture('version A');
      report.cases.push(await visit(context, 'cold', { payload: 'version A' }));
      report.cases.push(await visit(context, 'warm', { cached: true, payload: 'version A' }));
      await context.close();
      context = await launch();
      report.cases.push(await visit(context, 'restart', { cached: true, payload: 'version A' }));
      await packageFixture('version A');
      report.cases.push(await visit(context, 'unchanged-rebuild', { cached: true, payload: 'version A' }));
      await packageFixture('version B');
      report.cases.push(await visit(context, 'changed', { payload: 'version B' }));
      report.cases.push(await visit(context, 'updated-warm', { cached: true, payload: 'version B' }));
      report.cases.push(await visit(context, 'unavailable', { fault: 'unavailable', payload: 'version B' }));
      await packageFixture('version C');
      report.cases.push(await visit(context, 'write-failure', { fault: 'write', payload: 'version C' }));
      report.cases.push(await visit(context, 'write-recovery', { payload: 'version C' }));
      if (process.argv.includes('--real')) {
        report.cases.push(await visit(context, 'real-cold', { real: true }));
        report.cases.push(await visit(context, 'real-warm', { real: true, cached: true }));
        await context.close();
        context = await launch();
        report.cases.push(await visit(context, 'real-restart', { real: true, cached: true }));
        if (process.argv.includes('--slow') && engine === chromium) {
          // A fresh profile: the package must come from the (throttled) network.
          await context.close();
          await rm(profile, { recursive: true, force: true });
          context = await launch();
          report.cases.push(await visit(context, 'real-fast4g', { real: true, slow: true }));
        }
      }
    } finally { await context.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await writeFile(join(runDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`Evidence: ${join(runDir, 'results.json')}`);
}
