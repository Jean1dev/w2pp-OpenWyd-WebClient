#!/usr/bin/env node
// Login automático pelo portal (ADR 017), de ponta a ponta e só com stack LOCAL:
//   servidor (docker compose do w2pp-OpenWYD com W2PP_PLAY_CODE_SECRET),
//   portal (next dev do wyd-plataforma), gateway e página deste repositório,
//   runtime real. A conta de teste é criada no banco local pelo /api/signup
//   do portal local; nada toca o Railway ou o Vercel.
//
// Fases:
//   auto     cadastro → /jogar → a página pula a lista e loga sozinha → seleção
//            de personagem (0x010A); o handoff não pode ser lido de novo.
//   manual   portal sem PLAY_CODE_SECRET → mesma entrada, login manual (a página
//            só pula a lista).
//
// Pré-requisitos: stack do servidor no ar (porta 7600 do webserver e 8281 do
// tmserver), runtime linkado e `python tools/build_local_scene.py`, Go em
// .cache/toolchains/go e `pnpm install` no portal.
// Uso: W2PP_PLAY_CODE_SECRET=<mesmo do compose> node tools/verify_auto_login.mjs \
//        --portal-dir ../../wyd-plataforma/play-code [--tm 127.0.0.1:8281] [--headed]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const SITE = join(CACHE, 'local-scene');
const OUT = join(CACHE, 'auto-login');
const WIN = process.platform === 'win32';
const GO = join(CACHE, 'toolchains/go/bin', WIN ? 'go.exe' : 'go');
const GATEWAY_BIN = join(CACHE, 'bin', WIN ? 'wydgateway.exe' : 'wydgateway');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const portalDir = resolve(arg('--portal-dir', ''));
const tmTarget = arg('--tm', '127.0.0.1:8281');
const clientVersion = Number.parseInt(arg('--client-version', '12000'), 10);
const playCodeSecret = process.env.W2PP_PLAY_CODE_SECRET ?? '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

assert.ok(playCodeSecret.length >= 32, 'W2PP_PLAY_CODE_SECRET (o mesmo do docker compose) com 32+ caracteres');
assert.ok(existsSync(join(portalDir, 'package.json')), '--portal-dir aponta para o checkout do wyd-plataforma');
for (const p of [join(SITE, 'client.html'), join(SITE, 'openwyd_assets.data'), GO]) {
  assert.ok(existsSync(p), `${p} não encontrado`);
}
await mkdir(OUT, { recursive: true });

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

async function waitHttp(url, ms, label) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status < 500) return; } catch {}
    await sleep(500);
  }
  throw new Error(`${label} não respondeu em ${ms} ms`);
}

// Segredos só deste teste; nunca impressos.
const ticketSecret = randomBytes(24).toString('hex');
const gwPort = await freePort();
const portalPort = await freePort();
const gwOrigin = `http://127.0.0.1:${gwPort}`;
// "localhost" e "127.0.0.1" são sites diferentes, como o Vercel e o Railway.
const portalOrigin = `http://localhost:${portalPort}`;

async function startGateway() {
  await mkdir(join(CACHE, 'bin'), { recursive: true });
  execFileSync(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], {
    cwd: join(ROOT, 'gateway'), stdio: 'inherit',
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: join(CACHE, 'gopath'), GOMODCACHE: join(CACHE, 'gomod') },
  });
  const cfgPath = join(OUT, 'gateway.json');
  await writeFile(cfgPath, JSON.stringify({
    listen: `127.0.0.1:${gwPort}`, allowInsecure: true, allowedOrigins: [gwOrigin], staticDir: SITE,
    defaultChannel: 'local',
    channels: [{ name: 'local', target: tmTarget, publicWsUrl: `ws://127.0.0.1:${gwPort}/ws/local`, clientVersion }],
    limits: { maxConns: 4, maxConnsPerIP: 4 },
    portalAuth: { url: portalOrigin, ticketSecret },
  }, null, 1));
  const logs = [];
  const proc = spawn(GATEWAY_BIN, ['-config', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => logs.push(...d.toString().split('\n').filter(Boolean)));
  await waitHttp(`${gwOrigin}/healthz`, 20000, 'gateway');
  return { proc, logs };
}

function startPortal(withPlayCode) {
  const env = {
    ...process.env,
    PORT: String(portalPort),
    WEB_API_ADDR: 'localhost:7600',
    WEB_API_INSECURE: '1',
    PLAY_TICKET_SECRET: ticketSecret,
    WEBCLIENT_URL: gwOrigin,
    PLAY_CODE_SECRET: withPlayCode ? playCodeSecret : '',
  };
  const proc = spawn(WIN ? 'pnpm.cmd' : 'pnpm', ['exec', 'next', 'dev', '-p', String(portalPort)],
    { cwd: portalDir, env, stdio: ['ignore', 'ignore', 'ignore'], shell: WIN });
  return proc;
}

function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (WIN) { try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  else proc.kill();
}

// waitForFunction usa eval, proibido pela CSP da página.
async function until(page, label, fn, ms, a) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await page.evaluate(fn, a).catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  throw new Error(`tempo esgotado: ${label}`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const ALNUM = 'abcdefghijkmnpqrstuvwxyz23456789';
const account = `e2e${Array.from({ length: 7 }, () => ALNUM[randomInt(ALNUM.length)]).join('')}`;
const password = randomBytes(6).toString('hex').slice(0, 10);

// Abre o jogo como o jogador: sessão do portal → /jogar → form → gateway → página.
async function enterGame(browser, label, signup) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  // O código só fica na memória do teste, para provar que não vaza.
  const seen = { codes: [] };
  page.on('response', async res => {
    if (res.url().endsWith('/auth/game-login') && res.status() === 200) {
      try { seen.codes.push((await res.json()).code); } catch {}
    }
  });
  const route = signup ? '/api/signup' : '/api/login';
  const r = await page.request.post(`${portalOrigin}${route}`, { data: { name: account, password } });
  assert.ok(r.ok(), `${route}: HTTP ${r.status()}`);
  await page.goto(`${portalOrigin}/jogar`);
  await page.waitForURL(u => u.origin === gwOrigin, { timeout: 30000 });
  await until(page, `${label}: runtime`, () => window.clientEvidence?.frames > 0, 240000);
  await until(page, `${label}: lista pulada`, () => (window.clientEvidence.autoServer ?? 0) >= 1, 120000);
  return { context, page, pageErrors, seen };
}

const allCodes = [];
const gw = await startGateway();
let portal = startPortal(true);
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const summary = { tmTarget, clientVersion, when: new Date().toISOString() };
try {
  await waitHttp(`${portalOrigin}/`, 180000, 'portal');

  // Fase auto.
  {
    const { context, page, pageErrors, seen } = await enterGame(browser, 'auto', true);
    const state = await until(page, 'login automático', () => {
      const e = window.clientEvidence;
      if (e.autoLogin === 'none' || e.autoLogin === 'failed') return { autoLogin: e.autoLogin };
      const p = window.clientProbe();
      return p.state === 5 && { autoLogin: e.autoLogin, state: p.stateName, recv: p.socket.lastRecvOpcode, sent: p.socket.lastSentOpcode };
    }, 60000);
    await sleep(1500);
    await page.screenshot({ path: join(OUT, 'auto-selchar.png') });
    summary.auto = state;
    check('auto: login enviado pela página', state.autoLogin === 'sent', state.autoLogin);
    check('auto: seleção de personagem sem digitar nada', state.state !== undefined, `${state.state}, recv 0x${(state.recv >>> 0).toString(16)}`);
    const again = await page.evaluate(() => fetch('auth/game-login', { method: 'POST' }).then(r => r.status));
    check('auto: handoff não pode ser lido de novo', again === 204, `HTTP ${again}`);
    const evidence = JSON.stringify(await page.evaluate(() => window.clientEvidence));
    const code = seen.codes[0] ?? '';
    check('auto: handoff entregue uma vez', seen.codes.length === 1 && /^[a-km-np-z2-9]{10}$/.test(code), `${seen.codes.length} resposta(s)`);
    check('auto: código fora do clientEvidence', code !== '' && !evidence.includes(code));
    summary.codeSeen = seen.codes.length;
    allCodes.push(...seen.codes);
    check('auto: sem erros', pageErrors.length === 0, pageErrors.join('; '));
    await context.close();
  }

  // Fase manual: portal sem segredo → sem código → o jogador digitaria a senha.
  stop(portal);
  await sleep(2000);
  portal = startPortal(false);
  await waitHttp(`${portalOrigin}/`, 180000, 'portal sem código');
  {
    const { context, page, pageErrors } = await enterGame(browser, 'manual', false);
    const autoLogin = await until(page, 'login manual', () => window.clientEvidence.autoLogin !== 'pending' && window.clientEvidence.autoLogin, 30000);
    await sleep(3000);
    const p = await page.evaluate(() => window.clientProbe());
    summary.manual = { autoLogin, state: p.stateName };
    check('manual: sem código o login fica manual', autoLogin === 'none' && p.state === 7, `${autoLogin}, ${p.stateName}`);
    check('manual: sem erros', pageErrors.length === 0, pageErrors.join('; '));
    await context.close();
  }

  const leaked = gw.logs.filter(l => l.includes(password) || allCodes.some(c => l.includes(c)));
  check('gateway: nenhuma credencial no log', leaked.length === 0, `${gw.logs.length} linhas`);
} finally {
  await browser.close();
  stop(portal);
  gw.proc.kill();
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ ...summary, results }, null, 2) + '\n');
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok; evidência em ${OUT}`);
assert.equal(failed.length, 0);
