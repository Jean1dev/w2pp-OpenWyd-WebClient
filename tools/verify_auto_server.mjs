#!/usr/bin/env node
// Seleção automática do servidor (patch 0025) com o runtime REAL, a página real
// (com a CSP), o gateway real e o tm-server do operador. Sem conta real: depois
// que a página pula a lista, o teste digita no painel original, pelo teclado,
// uma conta inexistente gerada na hora. A resposta do servidor prova que o
// login saiu pelo servidor escolhido. Não usa nenhuma exportação wyd_debug_*,
// então vale também para o build público.
//
// Pré-requisitos: runtime linkado, `python tools/build_local_scene.py` (site em
// .cache/local-scene) e Go em .cache/toolchains/go.
// Uso: node tools/verify_auto_server.mjs [--target host:port] [--client-version N] [--headed]
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const SITE = join(CACHE, 'local-scene');
const OUT = join(CACHE, 'auto-server');
const WIN = process.platform === 'win32';
const GO = join(CACHE, 'toolchains/go/bin', WIN ? 'go.exe' : 'go');
const GATEWAY_BIN = join(CACHE, 'bin', WIN ? 'wydgateway.exe' : 'wydgateway');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
// Destino conferido com a CLI do Railway (tm-server: RAILWAY_TCP_PROXY_*).
const target = arg('--target', process.env.W2PP_RAILWAY_TARGET ?? 'reseau.proxy.rlwy.net:56950');
const clientVersion = Number.parseInt(arg('--client-version', process.env.W2PP_CLIENT_VERSION ?? '12000'), 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const [path, hint] of [[join(SITE, 'client.html'), 'python tools/build_local_scene.py'],
  [join(SITE, 'openwyd_assets.data'), 'python tools/build_local_scene.py'], [GO, 'docs/setup.md (Go)']]) {
  if (!existsSync(path)) throw new Error(`${path} não encontrado: ${hint}`);
}
await mkdir(OUT, { recursive: true });

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

async function startGateway(port) {
  await mkdir(join(CACHE, 'bin'), { recursive: true });
  execFileSync(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], {
    cwd: join(ROOT, 'gateway'), stdio: 'inherit',
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: join(CACHE, 'gopath'), GOMODCACHE: join(CACHE, 'gomod') },
  });
  const origin = `http://127.0.0.1:${port}`;
  const cfgPath = join(OUT, 'gateway.json');
  await writeFile(cfgPath, JSON.stringify({
    listen: `127.0.0.1:${port}`, allowInsecure: true, allowedOrigins: [origin], staticDir: SITE,
    defaultChannel: 'server',
    channels: [{ name: 'server', target, publicWsUrl: `ws://127.0.0.1:${port}/ws/server`, clientVersion }],
    limits: { maxConns: 4, maxConnsPerIP: 4 },
  }, null, 1));
  const logs = [];
  const proc = spawn(GATEWAY_BIN, ['-config', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => logs.push(...d.toString().split('\n').filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    try { if ((await fetch(`${origin}/config.json`)).ok) return { proc, origin, logs }; } catch {}
    await sleep(100);
  }
  proc.kill();
  throw new Error(`gateway não subiu: ${logs.join('\n')}`);
}

// waitForFunction usa eval, proibido pela CSP da página.
async function until(page, label, fn, ms, arg) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await page.evaluate(fn, arg);
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
const random = n => Array.from({ length: n }, () => ALNUM[randomInt(ALNUM.length)]).join('');
// Conta que não existe: o servidor responde "conta inexistente" sem contar
// tentativa errada para nenhuma conta real.
const ghostAccount = `zz${random(8)}`;
const ghostPassword = random(8);

const gw = await startGateway(await freePort());
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const summary = { target, clientVersion, when: new Date().toISOString() };
try {
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`${gw.origin}/client.html`);
  await until(page, 'runtime pronto', () => window.clientEvidence?.frames > 0, 240000);

  // A lista do jogo: vários canais, um só destino.
  const list = await page.evaluate(() => {
    const out = [];
    for (let g = 0; g < 10; g++)
      for (let c = 1; c < 16; c++) {
        const a = Module.UTF8ToString(Module._wyd_serverlist_entry(g, c));
        if (a) out.push([g, c, a]);
      }
    return out;
  });
  const groups = new Set(list.map(e => e[0])).size;
  const addresses = [...new Set(list.map(e => e[2]))];
  summary.serverList = { channels: list.length, groups, addresses };
  check('lista: mais de um canal', list.length > 1, `${list.length} canais em ${groups} grupo(s)`);
  check('lista: um só destino', addresses.length === 1, addresses.join(', '));

  // A página pula a lista sozinha: nenhum clique ou tecla até aqui.
  const t0 = Date.now();
  await until(page, 'seleção automática', () => (window.clientEvidence.autoServer ?? 0) >= 1, 120000);
  summary.autoServerMs = Date.now() - t0;
  const afterAuto = await page.evaluate(() => window.clientProbe());
  check('auto: login aberto sem tocar na lista', afterAuto.state === 7, `estado ${afterAuto.stateName}, ${summary.autoServerMs} ms`);
  check('auto: tela de carregamento fechada', await page.evaluate(() => document.getElementById('loader').hidden));
  await sleep(1500);
  await page.screenshot({ path: join(OUT, 'login-panel.png') });

  // O jogador digita no painel original: o foco já está na conta.
  await page.focus('#canvas');
  await page.keyboard.type(ghostAccount, { delay: 60 });
  await page.keyboard.press('Tab');
  await page.keyboard.type(ghostPassword, { delay: 60 });
  await page.keyboard.press('Enter');

  const reply = await until(page, 'resposta do servidor', () => {
    const p = window.clientProbe();
    // Conta inexistente: o tm-server manda MsgMessageBoxOk (0x0102, cabeçalho de
    // 12 bytes + 4). "Conectando no servidor." é texto do próprio cliente.
    return p.socket.lastSentOpcode === 0x20d && p.socket.lastRecvOpcode === 0x102 &&
      { probe: p, message: Module._wyd_scene_message_visible() === 1 ? Module.UTF8ToString(Module._wyd_scene_message_text()) : '' };
  }, 60000);
  await page.screenshot({ path: join(OUT, 'server-reply.png') });
  const s = reply.probe.socket;
  summary.reply = { state: reply.probe.stateName, connectResult: s.connectResult, lastSentOpcode: s.lastSentOpcode,
    lastRecvOpcode: s.lastRecvOpcode, bytesSent: s.bytesSent, bytesReceived: s.bytesReceived, message: reply.message };
  check('login: 0x020D enviado pelo servidor escolhido', s.lastSentOpcode === 0x20d, `connect=${s.connectResult}, enviados ${s.bytesSent} B`);
  check('login: tm-server recusou a conta (0x0102)', s.lastRecvOpcode === 0x102 && s.bytesReceived >= 16,
    `recebidos ${s.bytesReceived} B, painel "${reply.message}"`);
  check('login: conta inexistente não entra', reply.probe.state === 7, reply.probe.stateName);
  const errors = await page.evaluate(() => window.clientEvidence.errors);
  check('sem erros', pageErrors.length === 0 && errors.length === 0, [...pageErrors, ...errors].join('; '));
} finally {
  await browser.close();
  gw.proc.kill();
  // Sem a conta e a senha descartáveis no arquivo de evidência.
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ ...summary, results }, null, 2) + '\n');
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok; evidência em ${OUT}`);
assert.equal(failed.length, 0);
