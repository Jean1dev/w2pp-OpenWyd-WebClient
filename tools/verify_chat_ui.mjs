#!/usr/bin/env node
// Chat da página (ADR 018) com o gateway REAL compilado deste repositório e o
// web/ real; só o runtime WASM e o pacote de dados são falsos (o chat não
// depende deles). Duas sessões do portal, assinadas aqui com o mesmo formato
// HMAC do portal (ADR 015), conversam pelo /chat/ws. Não é evidência de
// gameplay nem do protocolo do jogo.
// Uso: npm run chat:ui
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(CACHE, 'chat-ui');
const SITE = join(OUT, 'site');
const WIN = process.platform === 'win32';
const LOCAL_GO = join(CACHE, 'toolchains/go/bin', WIN ? 'go.exe' : 'go');
const GO = existsSync(LOCAL_GO) ? LOCAL_GO : 'go';
const GATEWAY_BIN = join(CACHE, 'bin', WIN ? 'wydgateway.exe' : 'wydgateway');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const wait = ms => new Promise(r => setTimeout(r, ms));
// waitForFunction usa eval, proibido pela CSP da página.
async function until(page, fn, arg, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await wait(50);
  }
  return false;
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    }).on('error', fail);
  });
}

// Site: web/ real + runtime e pacote falsos.
await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });
for (const f of await readdir(join(ROOT, 'web'))) {
  if (f.includes('.')) await cp(join(ROOT, 'web', f), join(SITE, f));
}
await writeFile(join(SITE, 'openwyd_assets.js'), 'window.fake = { keys: 0 };\n');
await writeFile(join(SITE, 'runtime.js'), `
Object.assign(Module, {
  UTF8ToString: () => '',
  _wyd_boot_client: () => 1,
  _wyd_set_game_state() {},
  _wyd_tick_client: () => 0,
  _wyd_field_has_my_human: () => 0,
  _wyd_mouse_event: () => 1,
  _wyd_key_event: () => { fake.keys++; return 1; },
  _wyd_selectserver_auto: () => -1,
});
Module.onRuntimeInitialized();
`);

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(24).toString('hex');
await mkdir(join(CACHE, 'bin'), { recursive: true });
execFileSync(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], { cwd: join(ROOT, 'gateway'), stdio: 'inherit' });
const cfgPath = join(OUT, 'gateway.json');
await writeFile(cfgPath, JSON.stringify({
  listen: `127.0.0.1:${port}`,
  allowInsecure: true,
  allowedOrigins: [origin],
  staticDir: SITE,
  // O jogo não conecta (runtime falso); o destino só precisa ser válido.
  channels: [{ name: 'local', target: '127.0.0.1:9', publicWsUrl: `ws://127.0.0.1:${port}/ws/local`, clientVersion: 7662 }],
  portalAuth: { url: 'http://127.0.0.1:9', ticketSecret: secret },
}, null, 2));

const gwLogs = [];
let gateway = null;
async function startGateway() {
  const proc = spawn(GATEWAY_BIN, ['-config', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => gwLogs.push(...String(d).split('\n').filter(Boolean)));
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) return proc;
    } catch { /* ainda subindo */ }
    await wait(50);
  }
  throw new Error('gateway não subiu');
}
async function stopGateway() {
  if (!gateway) return;
  const done = new Promise(r => gateway.once('exit', r));
  gateway.kill();
  await done;
  gateway = null;
}

const b64 = b => Buffer.from(b).toString('base64url');
function ticket(name) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: `acc-${name || 'anon'}`, iat: now, exp: now + 60, jti: randomBytes(16).toString('hex') };
  if (name) claims.name = name;
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(createHmac('sha256', secret).update('wyd-play-ticket.v1.' + payload).digest())}`;
}

const SECRET_TEXT = 'mensagem-que-nao-pode-ir-para-o-log';
const XSS = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
const issued = [];

// Abre o jogo como o jogador que veio do portal.
async function player(browser, name, viewport = { width: 1400, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const tk = ticket(name);
  issued.push(tk);
  const resp = await context.request.post(`${origin}/auth/portal`, { form: { ticket: tk }, maxRedirects: 0 });
  assert.equal(resp.status(), 303, `ticket de ${name}`);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (/Content.Security.Policy|Refused to/i.test(m.text())) page.errors.push(m.text()); });
  await page.goto(`${origin}/client.html`);
  return page;
}

const lines = page => page.evaluate(() => [...document.querySelectorAll('#chat-log li:not(.wyd-chat-sys)')].map(li => ({
  nick: li.querySelector('b')?.textContent, text: li.querySelector('span')?.textContent, mine: li.classList.contains('wyd-chat-mine'),
})));
const online = (page, n, ms) => until(page, n => document.getElementById('chat-status').textContent === `${n} online`, n, ms);
async function say(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-input').press('Enter');
}
const hasLine = (page, l) => until(page, l => [...document.querySelectorAll('#chat-log li span')].some(s => s.textContent === l), l);

try {
  gateway = await startGateway();
  for (const [bname, type] of [['chromium', chromium], ['firefox', firefox]]) {
    console.log(`\n# ${bname}`);
    const browser = await type.launch({ headless: true });
    try {
      const alfa = await player(browser, 'alfa01');
      const beta = await player(browser, 'beta02');
      check('painel visível com config.chat', await until(alfa, () => !document.getElementById('chat').hidden));
      check('duas sessões: 2 online', (await online(alfa, 2)) && (await online(beta, 2)));
      check('nick do portal no campo', (await alfa.getAttribute('#chat-input', 'placeholder')) === 'Falar como alfa01');

      const canvas = await alfa.locator('#canvas').boundingBox();
      const chat = await alfa.locator('#chat').boundingBox();
      check('janela larga: chat à direita do jogo, mesma altura',
        chat.x >= canvas.x + canvas.width && Math.abs(chat.height - canvas.height) <= 2 && Math.abs(chat.y - canvas.y) <= 2,
        `canvas ${canvas.x},${canvas.y} ${canvas.width}x${canvas.height}; chat ${chat.x},${chat.y} ${chat.width}x${chat.height}`);
      await alfa.screenshot({ path: join(OUT, `${bname}-wide.png`) });

      const keys0 = await alfa.evaluate(() => fake.keys);
      await say(alfa, `olá beta, ${SECRET_TEXT}`);
      check('alfa → beta com o nick alfa01', await hasLine(beta, `olá beta, ${SECRET_TEXT}`));
      const bl = (await lines(beta)).at(-1);
      check('beta vê alfa01, não como própria', bl?.nick === 'alfa01' && !bl.mine, JSON.stringify(bl));
      check('alfa recebe o eco como própria', (await hasLine(alfa, `olá beta, ${SECRET_TEXT}`)) && (await lines(alfa)).at(-1)?.mine);
      check('digitar no chat não chega ao jogo', (await alfa.evaluate(() => fake.keys)) === keys0);
      check('campo limpo depois do envio', (await alfa.inputValue('#chat-input')) === '');

      await say(beta, XSS);
      check('beta → alfa', await hasLine(alfa, XSS));
      check('HTML exibido como texto', await alfa.evaluate(() =>
        document.querySelectorAll('#chat-log img, #chat-log script').length === 0 && window.pwned === undefined));

      await alfa.locator('#chat-input').press('Escape');
      check('Esc devolve o foco ao jogo', await alfa.evaluate(() => document.activeElement?.id === 'canvas'));

      // Rajada: o gateway recusa a partir da 6ª e o painel avisa.
      for (let i = 0; i < 7; i++) await say(beta, `rajada ${i}`);
      check('rate limit avisado', await until(beta, () => /Aguarde/.test(document.getElementById('chat-note').textContent)));

      const anon = await player(browser, '');
      check('sessão sem nome: somente leitura', await until(anon, () =>
        document.getElementById('chat-input').disabled && /portal/.test(document.getElementById('chat-note').textContent)));
      check('sessão sem nome conta como online', await online(alfa, 3));
      await say(alfa, 'para todos');
      check('somente leitura recebe', await hasLine(anon, 'para todos'));
      await anon.context().close();
      await beta.context().close();
      check('saída: 1 online', await online(alfa, 1));

      // Janela estreita: o chat vai para baixo do jogo.
      const narrow = await player(browser, 'gama03', { width: 900, height: 1000 });
      await until(narrow, () => !document.getElementById('chat').hidden);
      const nc = await narrow.locator('#canvas').boundingBox();
      const nh = await narrow.locator('#chat').boundingBox();
      check('janela estreita: chat abaixo do jogo', nh.y >= nc.y + nc.height, `canvas y=${nc.y} h=${nc.height}; chat y=${nh.y}`);
      const scrollW = await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check('janela estreita: sem rolagem horizontal', scrollW);
      await narrow.screenshot({ path: join(OUT, `${bname}-narrow.png`) });
      await narrow.context().close();

      // Gateway reiniciado: o painel reconecta sozinho com a mesma sessão.
      await stopGateway();
      check('queda percebida', await until(alfa, () => document.getElementById('chat').dataset.state === 'closed'));
      gateway = await startGateway();
      // O backoff já pode estar em 2–4 s; 40 s cobre o teto de 30 s.
      check('reconecta depois do reinício', await online(alfa, 1, 40000));
      await say(alfa, 'de volta');
      check('fala depois de reconectar', await hasLine(alfa, 'de volta'));

      check('sem erros nem violações de CSP', alfa.errors.length === 0, alfa.errors.join('; '));
      check('clientEvidence só com contadores', await alfa.evaluate(s => {
        const e = JSON.stringify(window.clientEvidence.chat);
        return !e.includes(s) && !e.includes('alfa01');
      }, SECRET_TEXT));
      await alfa.context().close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await stopGateway();
}

const log = gwLogs.join('\n');
check('gateway: chat aberto e fechado no log', /chat open/.test(log) && /chat closed/.test(log));
check('gateway: nenhum texto, nick ou ticket no log',
  !log.includes(SECRET_TEXT) && !/alfa01|beta02|gama03/.test(log) && !issued.some(t => log.includes(t.split('.')[1])));
await writeFile(join(OUT, 'gateway.log'), log + '\n');
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n');
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações`);
process.exit(failed.length ? 1 : 0);
