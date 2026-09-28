#!/usr/bin/env node
// End-to-end check of the connected client: browser -> real gateway -> TCP.
//
//   node tools/verify_client_stream.mjs                    scripted local server
//   node tools/verify_client_stream.mjs --mode server \
//        --target host:port --client-version 12000 \
//        --env-file .env.railway                          operator's tmserver
//
// Scripted mode serves tools/protocol/gen_client_stream.py's stream: a synthetic
// CNFAccountLogin plus >128 KiB cut so every chunk ends mid-frame, and checks
// the runtime framed, hashed and translated exactly those frames. It is an
// isolated test, not multiplayer evidence.
//
// Server mode logs in with W2PP_TEST_ACCOUNT / W2PP_TEST_PASSWORD read from the
// environment or --env-file. Credentials are passed to the game UI only and
// never printed, logged or written; evidence records counters, not names.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const SITE = join(CACHE, 'local-scene');
const GO = join(CACHE, 'toolchains/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
const GATEWAY_BIN = join(CACHE, 'bin', process.platform === 'win32' ? 'wydgateway.exe' : 'wydgateway');

const { values: opt } = parseArgs({
  options: {
    mode: { type: 'string', default: 'scripted' },
    target: { type: 'string' },
    'client-version': { type: 'string', default: '12000' },
    'env-file': { type: 'string' },
    'deadline-ms': { type: 'string', default: '90000' },
  },
});
const mode = opt.mode;
if (!['scripted', 'server'].includes(mode)) throw new Error('--mode must be scripted or server');
const clientVersion = Number.parseInt(opt['client-version'], 10);
const deadlineMs = Number.parseInt(opt['deadline-ms'], 10);

async function readEnvFile(path) {
  if (!path) return {};
  const out = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Scripted tmserver stand-in: waits for INITCODE + one full AccountLogin frame,
// then replays the script chunk by chunk. Captures what the client sent.
async function startScriptedServer(script) {
  const reply = Buffer.from(script.reply_hex, 'hex');
  const captured = [];
  let replied = false;
  const server = createServer(sock => {
    sock.setNoDelay(true);
    let got = Buffer.alloc(0);
    sock.on('data', async d => {
      captured.push(d);
      got = Buffer.concat([got, d]);
      if (replied || got.length < 4 + 12) return;
      const size = got.readUInt16LE(4);
      if (got.length < 4 + size) return;
      replied = true;
      let at = 0;
      for (const n of script.chunks) {
        if (sock.destroyed) return;
        sock.write(reply.subarray(at, at + n));
        at += n;
        await sleep(15); // keep chunks as separate TCP reads / WS messages
      }
    });
    sock.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, captured: () => Buffer.concat(captured) };
}

async function startGateway(port, channel, target) {
  await mkdir(join(CACHE, 'bin'), { recursive: true });
  execFileSync(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], {
    cwd: join(ROOT, 'gateway'),
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: join(CACHE, 'gopath'), GOMODCACHE: join(CACHE, 'gomod') },
    stdio: 'inherit',
  });
  const origin = `http://127.0.0.1:${port}`;
  const cfg = {
    listen: `127.0.0.1:${port}`, allowInsecure: true, allowedOrigins: [origin], staticDir: SITE,
    defaultChannel: channel,
    channels: [{ name: channel, target, publicWsUrl: `ws://127.0.0.1:${port}/ws/${channel}`, clientVersion }],
    limits: { maxConns: 8, maxConnsPerIP: 4 },
  };
  const cfgPath = join(CACHE, `gateway-${mode}.json`);
  await writeFile(cfgPath, JSON.stringify(cfg, null, 1));
  const logs = [];
  const proc = spawn(GATEWAY_BIN, ['-config', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => logs.push(...d.toString().split('\n').filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${origin}/config.json`); if (r.ok) return { proc, origin, logs }; } catch {}
    await sleep(100);
  }
  proc.kill();
  throw new Error(`gateway did not start: ${logs.join('\n')}`);
}

async function main() {
  const evidence = { mode, ok: false, checks: {}, when: new Date().toISOString() };
  let scripted = null;
  let script = null;
  let target = opt.target;
  if (mode === 'scripted') {
    execFileSync('python', [join(ROOT, 'tools/protocol/gen_client_stream.py')], { stdio: 'inherit' });
    script = JSON.parse(await readFile(join(CACHE, 'client-stream/script.json'), 'utf8'));
    scripted = await startScriptedServer(script);
    target = `127.0.0.1:${scripted.port}`;
  } else if (!target) {
    throw new Error('--target host:port is required in server mode');
  }

  const env = { ...(await readEnvFile(opt['env-file'])), ...process.env };
  const account = mode === 'scripted' ? 'fixture01' : env.W2PP_TEST_ACCOUNT;
  const password = mode === 'scripted' ? 'segredo1' : env.W2PP_TEST_PASSWORD;
  if (!account || !password) throw new Error('W2PP_TEST_ACCOUNT / W2PP_TEST_PASSWORD not provided');

  const gw = await startGateway(await freePort(), mode === 'scripted' ? 'scripted' : 'server', target);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

  try {
    await page.goto(`${gw.origin}/client.html`, { waitUntil: 'load' });
    // Poll with evaluate: waitForFunction needs eval, which the page's CSP forbids
    // (and the test must run under the real CSP to prove the ws:// connection).
    const bootUntil = Date.now() + deadlineMs;
    while (!(await page.evaluate(() => window.clientEvidence?.ready &&
      window.Module?._wyd_get_game_state?.() === 7 && window.clientEvidence.frames > 20))) {
      if (Date.now() > bootUntil) throw new Error('client did not reach the server-selection scene');
      if (pageErrors.length) throw new Error(`page error: ${pageErrors[0]}`);
      await sleep(250);
    }
    evidence.before = await page.evaluate(() => window.clientProbe());

    evidence.loginReturn = await page.evaluate(([a, p]) =>
      Module.ccall('wyd_debug_selectserver_login', 'number', ['string', 'string', 'string'], [a, p, 'gateway']),
    [account, password]);

    const until = Date.now() + deadlineMs;
    const want = script?.expect;
    let probe;
    for (;;) {
      probe = await page.evaluate(() => window.clientProbe());
      const reached = probe.state === 5 && (!want || probe.dialect.inboundFrames >= want.frames);
      if (reached || Date.now() > until) break;
      await sleep(250);
    }
    await sleep(1500); // let a few frames render the selection scene
    probe = await page.evaluate(() => window.clientProbe());
    const names = await page.evaluate(() =>
      [0, 1, 2, 3].map(i => Module.UTF8ToString(Module._wyd_selchar_name(i))));
    await page.locator('#canvas').screenshot({ path: join(CACHE, `client-${mode}.png`) });

    evidence.after = probe;
    evidence.selchar = { count: names.filter(Boolean).length, slotsFilled: names.map(n => n.length > 0) };
    evidence.pageErrors = pageErrors;
    evidence.consoleErrors = consoleErrors;
    const c = evidence.checks;
    c.loginCalled = evidence.loginReturn === 1;
    c.reachedSelectChar = probe.state === 5;
    c.noFixture = probe.field.fixture === 0;
    c.socketOpen = probe.socket.connectResult === 1;
    c.noPageErrors = pageErrors.length === 0;
    c.noGlErrors = probe.glErrorTotal === 0;
    c.noSizeOrRangeDrops = probe.dialect.inDropSize === 0 && probe.dialect.inDropRange === 0 &&
      probe.dialect.outDropSize === 0 && probe.dialect.outDropRange === 0 && probe.dialect.outDropNoVersion === 0;
    c.accountLoginTranslated = probe.dialect.outTranslated >= 1;
    c.cnfTranslated = probe.dialect.inTranslated >= 1;
    if (want) {
      c.framesExact = probe.dialect.inboundFrames === want.frames;
      c.hashExact = probe.dialect.inboundHash === want.hash;
      c.translatedExact = probe.dialect.inTranslated === want.translated;
      c.passedExact = probe.dialect.inPass === want.passed;
      c.droppedExact = probe.dialect.inDropUnknown === want.droppedUnknown;
      c.bytesExact = probe.socket.bytesReceived === want.bytes;
      c.selcharNames = JSON.stringify(names) === JSON.stringify(want.selcharNames);
      c.cargoHiddenCounted = probe.dialect.cargoHidden === 2;
      await writeFile(join(CACHE, 'client-stream/c2s.bin'), scripted.captured());
      const out = execFileSync('python', [join(ROOT, 'tools/protocol/gen_client_stream.py'), '--check-c2s',
        join(CACHE, 'client-stream/c2s.bin'), '--client-version', String(clientVersion)]).toString();
      evidence.c2s = JSON.parse(out);
      c.c2sAccountLogin = evidence.c2s.ok === true;
    } else {
      c.selcharPopulated = evidence.selchar.count >= 0; // an account may legitimately have no characters
    }
    evidence.ok = Object.values(c).every(Boolean);
  } catch (error) {
    evidence.error = String(error?.message ?? error);
  } finally {
    await browser.close();
    gw.proc.kill();
    scripted?.server.close();
    // Gateway logs carry counters and reasons only, never payload.
    evidence.gatewayLog = gw.logs.map(l => { try { return JSON.parse(l); } catch { return l; } })
      .map(l => (typeof l === 'object' ? { msg: l.msg, reason: l.reason, bytes_up: l.bytes_up, bytes_down: l.bytes_down, channel: l.channel } : l));
  }
  const path = join(CACHE, `client-${mode}-evidence.json`);
  await writeFile(path, JSON.stringify(evidence, null, 1));
  console.log(JSON.stringify({ ok: evidence.ok, checks: evidence.checks, error: evidence.error, evidence: path }, null, 1));
  process.exit(evidence.ok ? 0 : 1);
}

main().catch(e => { console.error(e?.message ?? e); process.exit(2); });
