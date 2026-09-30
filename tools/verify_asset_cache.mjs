// Serial, localhost-only cache checks. Fixtures exercise the actual Emscripten
// loader; --real also boots client.html with operator assets, without login.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
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

async function visit(context, name, { real = false, cached = false, fault = null, payload } = {}) {
  served = { dataRequests: 0, dataBytes: 0, totalBytes: 0 };
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
    while (!await page.evaluate(isReal => isReal ? window.clientEvidence?.frames >= 15 : !!window.result, real)) {
      assert.deepEqual(errors, []);
      assert.ok(performance.now() - start < 180000, 'client did not initialize within 180 s');
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
      }
    } finally { await context.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await writeFile(join(runDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`Evidence: ${join(runDir, 'results.json')}`);
}
