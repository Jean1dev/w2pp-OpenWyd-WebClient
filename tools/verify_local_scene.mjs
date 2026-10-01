// Smoke test da cena local: detecta falha de runtime, asset ausente, erro WebGL
// e cena não identificada. Nunca fornece credenciais nem permite rede externa.
import { chromium, firefox } from 'playwright';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const browserName = process.env.SCENE_BROWSER ?? 'chromium';
if (!['chromium', 'firefox'].includes(browserName)) throw new Error('SCENE_BROWSER must be chromium or firefox');
const SITE = resolve('.cache/local-scene');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.data': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.png': 'image/png' };

// O próprio teste serve o site montado, para que a verificação não dependa de
// um servidor externo nem possa medir uma cópia velha da página.
async function serveSite() {
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // normalize devolve separador do Windows; tire qualquer um dos dois da frente.
    const relative = normalize(requested === '/' ? 'index.html' : requested).replace(/^[\\/]+/, '');
    const file = join(SITE, relative);
    if (!file.startsWith(SITE)) { response.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
                                'content-length': info.size });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const hosted = process.env.SCENE_ORIGIN ? null : await serveSite();
const ORIGIN = process.env.SCENE_ORIGIN ?? hosted.origin;
const FRAME_TARGET = Number(process.env.SCENE_FRAMES ?? 120);
const DEADLINE_MS = Number(process.env.SCENE_DEADLINE_MS ?? 180000);
const OUT = `.cache/scene-${browserName}`;
const MANIFEST = 'assets-local/manifest.json';

// O cliente 7662 do operador não fornece tudo que o runtime 769 abre, e a lista
// varia por cena. A regra verificável não é "quais faltam", e sim: um arquivo
// que o dataset entregou nunca pode falhar ao abrir. O resto é lacuna de
// conteúdo, registrada na evidência e jamais fabricada.
const dataset = new Set(
  JSON.parse(await readFile(MANIFEST, 'utf8')).files
    .map(entry => entry.path.toLowerCase().replace(/^\/+/, '')));
const shipped = path => dataset.has(path.replace(/\/{2,}/g, '/').replace(/^\/+/, ''));

const failures = [];
const fail = (scene, message) => failures.push(`${scene}: ${message}`);

async function runScene(browser, { name, state, requireField }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [], consoleErrors = [], requestFailures = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => requestFailures.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) requestFailures.push({ url: r.url(), error: `HTTP ${r.status()}` }); });
  // A verificação não abre nenhum destino fora do site local.
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort());

  await page.goto(`${ORIGIN}/?state=${state}`, { waitUntil: 'load', timeout: 120000 });
  const deadline = Date.now() + DEADLINE_MS;
  let reached = false;
  while (Date.now() < deadline) {
    reached = await page.evaluate(target =>
      window.sceneEvidence?.frames >= target || window.sceneEvidence?.errors.length > 0, FRAME_TARGET);
    if (reached) break;
    await new Promise(done => setTimeout(done, 500));
  }

  const runtime = await page.evaluate(() => window.sceneEvidence);
  const input = requireField ? await exerciseInput(page) : null;
  const screenshot = `${OUT}/local-scene-${name}.png`;
  await page.screenshot({ path: screenshot });
  await page.close();

  const probe = runtime?.probe ?? {};
  if (!reached) fail(name, `apenas ${runtime?.frames} de ${FRAME_TARGET} quadros em ${DEADLINE_MS} ms`);
  if (errors.length) fail(name, `erros de página: ${errors.join(' | ')}`);
  if (consoleErrors.length) fail(name, `erros de console: ${consoleErrors.join(' | ')}`);
  if (requestFailures.length) fail(name, `assets ausentes: ${JSON.stringify(requestFailures)}`);
  if (runtime?.errors?.length) fail(name, `erros de runtime: ${runtime.errors.join(' | ')}`);
  if (runtime?.boot !== 1) fail(name, 'boot do cliente não retornou 1');
  if (probe.state !== state) fail(name, `estado ${probe.state}, esperado ${state}`);
  if (probe.placeholder) fail(name, 'cena marcada como placeholder pelo runtime');
  if (probe.webgl2 !== 1) fail(name, 'contexto WebGL2 indisponível');
  if (probe.glErrorTotal) fail(name, `erros GL: total=${probe.glErrorTotal} último=${probe.glErrorLast}`);
  if (!(probe.presentCalls > 0)) fail(name, 'nenhum present no backbuffer');
  if (!(probe.drawCalls > 0)) fail(name, 'nenhuma chamada de desenho');
  if (!(probe.texturedDraws > 0)) fail(name, 'nenhum desenho com textura dos assets');
  const misses = probe.assetOpenFailureSamples ?? [];
  const broken = misses.filter(shipped);
  if (broken.length) fail(name, `assets presentes no dataset falharam ao abrir: ${broken.join(', ')}`);
  if (probe.assetOpenFailures > 0 && misses.length === 0) fail(name, 'falhas de abertura sem amostra de caminho');
  if (requireField) {
    if (probe.fieldFixture !== 1 || probe.mapX !== 16 || probe.mapY !== 16 || probe.humanName !== 'OpenWYD') {
      fail(name, 'identidade da fixture offline inesperada');
    }
    if (probe.fieldInitialized !== 1) fail(name, 'cena Field não inicializou');
    if (probe.fieldCriticalError) fail(name, `erro crítico de Field: ${probe.fieldCriticalError}`);
    if (probe.hasGround !== 1) fail(name, 'terreno ausente');
    if (probe.hasMyHuman !== 1) fail(name, 'personagem ausente');
    if (!Number.isFinite(probe.humanX) || probe.humanX <= 0) fail(name, `coordenada X inválida: ${probe.humanX}`);
    if (!Number.isFinite(probe.humanY) || probe.humanY <= 0) fail(name, `coordenada Y inválida: ${probe.humanY}`);
    if (!(probe.humanMaxHp > 0)) fail(name, 'HP máximo não carregado');
    if (probe.cameraValid !== 1) fail(name, 'câmera sem estado válido');
    if (!input?.mouseAccepted) fail(name, 'runtime não registrou eventos de mouse');
    if (!input?.keyAccepted) fail(name, 'runtime não registrou eventos de teclado');
    if (!input?.moved) fail(name, 'clique no terreno não moveu o personagem');
    if (!input?.picked) fail(name, 'consulta de coordenada no terreno não retornou ponto válido');
  }
  return { name, state, reached, frames: runtime?.frames, errors, consoleErrors, requestFailures,
           contentGaps: misses.filter(path => !shipped(path)), probe, input, screenshot };
}

// Mouse e teclado reais do navegador, verificados pelos contadores do runtime.
async function exerciseInput(page) {
  const before = await page.evaluate(() => window.sceneProbe());
  const box = await page.locator('#canvas').boundingBox();
  // Clique à frente do personagem: o cliente original responde com uma rota.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('#canvas').press('KeyI');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => window.sceneProbe());
  // O pick de terreno é uma consulta explícita do runtime, não efeito do clique.
  const pick = await page.evaluate(() => {
    const ok = Module._wyd_field_pick_at(400, 380);
    return { ok, x: Module._wyd_field_last_pick_x(), y: Module._wyd_field_last_pick_y(),
             z: Module._wyd_field_last_pick_z() };
  });
  return {
    mouseAccepted: after.mouseEvents > before.mouseEvents,
    keyAccepted: after.keyEvents > before.keyEvents,
    moved: after.humanMoveToX !== before.humanMoveToX || after.humanMoveToY !== before.humanMoveToY,
    picked: pick.ok === 1,
    pick,
    moveTarget: { from: { x: before.humanMoveToX, y: before.humanMoveToY },
                  to: { x: after.humanMoveToX, y: after.humanMoveToY } },
    mouseEvents: [before.mouseEvents, after.mouseEvents],
    keyEvents: [before.keyEvents, after.keyEvents]
  };
}

let browser;
let report;
try {
  await mkdir(OUT, { recursive: true });
  browser = await ({ chromium, firefox }[browserName]).launch({ headless: true });
  const scenes = [];
  scenes.push(await runScene(browser, { name: 'field', state: 0, requireField: true }));
  scenes.push(await runScene(browser, { name: 'selectserver', state: 7, requireField: false }));
  report = { browserName, browser: browser.version(), origin: ORIGIN, frameTarget: FRAME_TARGET, scenes, failures };
} finally {
  await browser?.close();
  if (hosted) await new Promise(done => hosted.server.close(done));
}

await writeFile(`${OUT}/local-scene-evidence.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`\n${failures.length} verificação(ões) falharam:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
