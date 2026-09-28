#!/usr/bin/env node
// Local client against the operator's Railway tm-server, in one command:
//   1. applies the OpenWyd patches (pinned SHA) and rebuilds the WASM runtime
//      only when the patched sources changed or no dialect-enabled build exists;
//   2. assembles the site (.cache/local-scene) from the packaged local assets;
//   3. builds the gateway and writes gateway.local.json if it does not exist;
//   4. starts the gateway and opens Chrome on client.html.
// Ctrl+C stops the gateway. Login happens in the game UI; no credentials here.
//
// Env overrides: W2PP_RAILWAY_TARGET (host:port), W2PP_CLIENT_VERSION,
// W2PP_GATEWAY_CONFIG (config path), CHROME (browser executable).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const WIN = process.platform === 'win32';
const GO = join(CACHE, 'toolchains/go/bin', WIN ? 'go.exe' : 'go');
const GATEWAY_BIN = join(CACHE, 'bin', WIN ? 'wydgateway.exe' : 'wydgateway');
const LINK_DIR = join(ROOT, 'external/OpenWyd/webclient/client-wasm/build/link');
const SITE = join(CACHE, 'local-scene');
const CONFIG = resolve(ROOT, process.env.W2PP_GATEWAY_CONFIG ?? 'gateway.local.json');

function step(msg) { console.log(`\n==> ${msg}`); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`falhou: ${cmd} ${args.join(' ')}`);
}

function need(path, hint) {
  if (!existsSync(path)) throw new Error(`${path} não encontrado. ${hint}`);
}

function newestMtime(dir, filter) {
  let t = 0;
  for (const name of readdirSync(dir)) {
    if (filter(name)) t = Math.max(t, statSync(join(dir, name)).mtimeMs);
  }
  return t;
}

// Current runtime from the upstream bootstrap (tmproject_startup.<id>.js).
function currentRuntime() {
  const boot = join(LINK_DIR, 'tmproject_startup.js');
  if (!existsSync(boot)) return null;
  const m = /tmproject_startup\.\d+\.js/.exec(readFileSync(boot, 'utf8'));
  return m ? join(LINK_DIR, m[0]) : null;
}

function ensurePatchesAndRuntime() {
  step('Patches do OpenWyd');
  need(join(ROOT, 'external/OpenWyd/.git'), 'Clone o upstream conforme docs/setup.md.');
  run('python', ['tools/apply_openwyd_patches.py']);

  const runtime = currentRuntime();
  const hasDialect = runtime && readFileSync(runtime, 'utf8').includes('_wyd_net_set_client_version');
  const srcDir = join(ROOT, 'external/OpenWyd/Projects/TMProject');
  const sourcesNewer = runtime && newestMtime(srcDir, n => /\.(cpp|h)$/.test(n)) > statSync(runtime).mtimeMs;
  if (hasDialect && !sourcesNewer) {
    step('Runtime WASM já atualizado');
    return;
  }
  step('Compilando o runtime WASM (alguns minutos)');
  const emsdk = join(CACHE, 'toolchains/emsdk');
  need(emsdk, 'Instale o emsdk 6.0.0 conforme docs/setup.md.');
  const env = { ...process.env, EMSDK: emsdk };
  const tools = 'external/OpenWyd/webclient/client-wasm/tools';
  run('python', [`${tools}/build_tmproject_wasm_objects.py`, '--repo-root', 'external/OpenWyd', '--jobs', '6'], { env });
  run('python', [`${tools}/link_tmproject_wasm_startup.py`, '--repo-root', 'external/OpenWyd', '--dev',
    '--jobs', '6', '--link-opt-level', 'O2'], { env });
}

function ensureSite() {
  step('Montando o site local');
  need(join(SITE, 'openwyd_assets.data'),
    'Importe e empacote os assets: python tools/import_local_assets.py ... e npm run scene:package (docs/evidence/02-build).');
  run('python', ['tools/build_local_scene.py', '--page-only']);
}

function ensureGateway() {
  step('Compilando o gateway');
  need(GO, 'Instale o Go 1.25.13 em .cache/toolchains/go conforme docs/setup.md.');
  run(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], {
    cwd: join(ROOT, 'gateway'),
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: join(CACHE, 'gopath'), GOMODCACHE: join(CACHE, 'gomod') },
  });
  if (!existsSync(CONFIG)) {
    const target = process.env.W2PP_RAILWAY_TARGET ?? 'reseau.proxy.rlwy.net:56950';
    const clientVersion = Number.parseInt(process.env.W2PP_CLIENT_VERSION ?? '12000', 10);
    const cfg = {
      listen: '127.0.0.1:8290', allowInsecure: true, allowedOrigins: ['http://127.0.0.1:8290'],
      staticDir: '.cache/local-scene', defaultChannel: 'railway',
      channels: [{ name: 'railway', target, publicWsUrl: 'ws://127.0.0.1:8290/ws/railway', clientVersion }],
      limits: { maxConns: 8, maxConnsPerIP: 4 },
    };
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`${CONFIG} criado (alvo ${target}, ClientVersion ${clientVersion})`);
  }
}

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = WIN
    ? [join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
       join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
       join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(existsSync) ?? null;
}

function openBrowser(url) {
  const chrome = chromePath();
  if (chrome) {
    spawn(chrome, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (WIN) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
  console.log(`Aberto: ${url}${chrome ? '' : ' (Chrome não encontrado; navegador padrão)'}`);
}

async function startGateway() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const origin = cfg.allowedOrigins?.[0] ?? `http://${cfg.listen}`;
  try {
    await fetch(`${origin}/config.json`);
    throw new Error(`${cfg.listen} já está em uso (outro gateway rodando?). Encerre-o e tente de novo.`);
  } catch (e) {
    if (e.message.includes('já está em uso')) throw e;
  }
  step(`Subindo o gateway (${cfg.channels.map(c => `${c.name} → ${c.target}`).join(', ')})`);
  const gw = spawn(GATEWAY_BIN, ['-config', CONFIG], { cwd: ROOT, stdio: 'inherit' });
  gw.on('exit', code => { console.log(`gateway encerrado (${code})`); process.exit(code ?? 0); });
  const stop = () => gw.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/config.json`)).ok) {
        openBrowser(`${origin}/client.html`);
        console.log('\nFaça o login na interface do jogo. Ctrl+C encerra o gateway.');
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  gw.kill();
  throw new Error('o gateway não respondeu');
}

try {
  const only = process.argv[2];
  if (!only || only === 'runtime') ensurePatchesAndRuntime();
  if (!only || only === 'site') ensureSite();
  if (!only || only === 'gateway') ensureGateway();
  if (!only) await startGateway();
} catch (e) {
  console.error(`\nERRO: ${e.message}`);
  process.exit(1);
}
