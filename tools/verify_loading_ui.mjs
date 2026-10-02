#!/usr/bin/env node
// Teste isolado da tela de carregamento (web/client.html + web/client.js) com
// runtime e openwyd_assets.js FALSOS. O pacote falso repete a sequência de
// chamadas do tools/file_packager.py do Emscripten 6.0.0 fixado
// (fetchRemotePackage: setStatus "Downloading data..." e depois
// "Downloading data... (recebidos/total)" por bloco; preloadResults.fromCache
// definido antes de ler o IndexedDB; falha de rede como promise rejeitada sem
// tratamento). Não é evidência do pacote real, de gameplay nem de rede.
// Uso: npm run loading:ui
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const WEB = join(ROOT, 'web');
const OUT = join(ROOT, '.cache/loading-ui');
await mkdir(OUT, { recursive: true });

const TOTAL = 320 * 1048576;
const STEPS = 25;

// Pacote falso: o cenário vem do servidor (um por vez, em série).
const fakePackage = scenario => `
(() => {
  const snap = () => ({
    stage: document.getElementById('loader-stage').textContent,
    detail: document.getElementById('loader-detail').textContent,
    now: document.getElementById('loader-bar').getAttribute('aria-valuenow'),
    note: document.getElementById('loader-note').hidden ? null : document.getElementById('loader-note').textContent,
  });
  window.fake = { snapshots: [], mouse: [] };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  Module.preRun = Module.preRun || [];
  Module.preRun.push(async () => {
    Module.preloadResults = Module.preloadResults || {};
    const name = 'openwyd_assets.data';
    if (${JSON.stringify(scenario)} === 'warm') {
      Module.preloadResults[name] = { fromCache: true };
      await wait(700);
      fake.snapshots.push(snap());
      Module.setStatus('Downloading...');
      return;
    }
    Module.preloadResults[name] = { fromCache: false };
    Module.setStatus('Downloading data...');
    fake.snapshots.push(snap());
    if (${JSON.stringify(scenario)} === 'datafail') {
      await wait(200);
      // Igual ao fetchRemotePackage: "status: url", sem catch no build não-ES6.
      Promise.reject(new Error('401: http://127.0.0.1/openwyd_assets.data'));
      await new Promise(() => {});
    }
    for (let i = 1; i <= ${STEPS}; i++) {
      await wait(120);
      Module.setStatus('Downloading data... (' + Math.round(${TOTAL} * i / ${STEPS}) + '/' + ${TOTAL} + ')');
      fake.snapshots.push(snap());
    }
    await wait(300);
    Module.setStatus('Downloading...');
  });
})();
`;

const fakeRuntime = scenario => `
(async () => {
  Object.assign(Module, {
    UTF8ToString: () => '',
    _wyd_boot_client: () => 1,
    _wyd_set_game_state() {},
    _wyd_tick_client: () => 0,
    _wyd_field_has_my_human: () => 0,
    _wyd_mouse_event: (msg, f, x, y) => { fake.mouse.push([msg, x, y]); return 1; },
    _wyd_key_event: () => 1,
  });
  if (${JSON.stringify(scenario)} === 'abort') { setTimeout(() => Module.onAbort('x'), 300); return; }
  for (const fn of Module.preRun || []) await fn();
  Module.onRuntimeInitialized();
})();
`;

let scenario = 'cold';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (type, body, status = 200) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
  if (path === '/config.json') {
    if (scenario === 'config401') return send('text/plain', 'unauthorized', 401);
    return send('application/json', JSON.stringify({ channel: 'fake', wsUrl: 'ws://127.0.0.1:1/x', clientVersion: 7662 }));
  }
  if (path === '/openwyd_assets.js') return send('text/javascript', scenario === 'abort' ? 'window.fake = { snapshots: [], mouse: [] };' : fakePackage(scenario));
  if (path === '/runtime.js') return send('text/javascript', fakeRuntime(scenario));
  try {
    const body = await readFile(join(WEB, path === '/' ? 'client.html' : path.slice(1)));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    send(types[extname(path)] ?? 'application/octet-stream', body);
  } catch { send('text/plain', '', 404); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/client.html`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// waitForFunction usa eval, proibido pela CSP da página.
async function until(page, fn, arg, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

const loaderState = () => {
  const el = document.getElementById('loader');
  return { hidden: el.hidden, failed: el.classList.contains('failed'),
    stage: document.getElementById('loader-stage').textContent,
    retry: !document.getElementById('loader-retry').hidden };
};

try {
  for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
    console.log(`\n# ${name}`);
    const browser = await type.launch({ headless: true });
    try {
      const visit = async (s, viewport = { width: 1280, height: 900 }) => {
        scenario = s;
        const page = await (await browser.newContext({ viewport })).newPage();
        page.errors = [];
        page.on('pageerror', e => page.errors.push(String(e)));
        await page.goto(base);
        return page;
      };

      // Primeiro acesso: progresso real, nota de tamanho, saída e clique no canvas.
      {
        const page = await visit('cold');
        await until(page, () => (window.fake?.snapshots.length ?? 0) >= 12);
        await page.screenshot({ path: join(OUT, `${name}-cold-download.png`) });
        const gone = await until(page, () => document.getElementById('loader').hidden);
        const snaps = await page.evaluate(() => fake.snapshots);
        const values = snaps.map(s => Number(s.now)).filter(n => n > 0);
        check('cold: etapa de download', snaps.some(s => s.stage === 'Baixando dados do jogo…'));
        check('cold: bytes e total', snaps.some(s => /^\d+ \/ 320 MB/.test(s.detail)), snaps.at(-2)?.detail);
        check('cold: velocidade e tempo restante', snaps.some(s => /MB\/s · ~\d+ s$/.test(s.detail)));
        check('cold: barra cresce até 100', values.length > 5 && values.every((v, i) => !i || v >= values[i - 1]) && values.at(-1) === 100,
          values.join(','));
        check('cold: nota de primeiro acesso', snaps.some(s => s.note?.includes('cerca de 320 MB')));
        check('cold: some após o primeiro quadro', gone);
        const box = await page.locator('#canvas').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        check('cold: clique chega ao canvas', (await page.evaluate(() => fake.mouse.some(m => m[0] === 0x0201))));
        check('cold: sem erros', page.errors.length === 0 && (await page.evaluate(() => clientEvidence.errors.length)) === 0,
          page.errors.join('; '));
        await page.context().close();
      }

      // Acesso com cache: etapa própria, sem nota de download.
      {
        const page = await visit('warm');
        await until(page, () => (window.fake?.snapshots.length ?? 0) >= 1);
        const [snap] = await page.evaluate(() => fake.snapshots);
        check('warm: etapa de cache', snap.stage === 'Abrindo os dados guardados no navegador…', snap.stage);
        check('warm: sem nota de download', snap.note === null);
        check('warm: some após o primeiro quadro', await until(page, () => document.getElementById('loader').hidden));
        await page.context().close();
      }

      // Falhas: mensagem clara e botão de tentar de novo.
      for (const [s, expected] of [['config401', 'Sua sessão expirou'], ['datafail', 'Sua sessão expirou'],
        ['abort', 'erro interno']]) {
        const page = await visit(s);
        await until(page, () => document.getElementById('loader').classList.contains('failed'));
        const st = await page.evaluate(loaderState);
        check(`${s}: falha visível`, st.failed && !st.hidden && st.stage.includes(expected), st.stage);
        check(`${s}: botão tentar novamente`, st.retry);
        if (s === 'datafail') await page.screenshot({ path: join(OUT, `${name}-failure.png`) });
        await page.context().close();
      }

      // Celular: sem rolagem horizontal durante o carregamento.
      {
        const page = await visit('cold', { width: 375, height: 740 });
        await until(page, () => (window.fake?.snapshots.length ?? 0) >= 8);
        await page.screenshot({ path: join(OUT, `${name}-mobile.png`) });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check('mobile: sem rolagem horizontal', overflow <= 0, `excesso ${overflow}px`);
        await page.context().close();
      }
    } finally { await browser.close(); }
  }
} finally {
  server.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok; capturas em ${OUT}`);
assert.equal(failed.length, 0);
