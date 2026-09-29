#!/usr/bin/env node
// Etapa 4: online slice against the operator's real tmserver, two accounts.
//
//   node tools/verify_world.mjs --target host:port --client-version 12000 --env-file .env
//
// Phases (all through the real gateway, the real page and its CSP):
//   badpass   wrong password -> the server's 0x102 notice is translated and shown
//   login     A logs in, PIN verified (the first verify on an account defines it)
//   create    A creates a character when its slot 0 is empty; preview is read
//   enter     A enters the Field with the server's CNFCharacterLogin
//   second    B does the same in a separate browser context
//   move      A walks (mouse click on the canvas) and B sees it; then B walks and A sees it
//   logout    A closes; B loses A. A logs in again and B sees A again
//   mapchange A walks onto the Armia -> Armia Field portal and confirms; B loses A
//   concurrent A's account logs in a second time while A is in the Field
//
// Credentials come from W2PP_TEST_{ACCOUNT,PASSWORD,PIN,CHAR}[2] (env or --env-file)
// and are handed to the game UI only. Evidence holds counters, opcodes, states,
// positions and masked names; screenshots stay in .cache (they contain assets).
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(CACHE, 'world');
const SITE = join(CACHE, 'local-scene');
const GO = join(CACHE, 'toolchains/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
const GATEWAY_BIN = join(CACHE, 'bin', process.platform === 'win32' ? 'wydgateway.exe' : 'wydgateway');

const STATE = { FIELD: 0, SELECT_CHAR: 5, SELECT_SERVER: 7 };

const { values: opt } = parseArgs({
  options: {
    target: { type: 'string' },
    'client-version': { type: 'string', default: '12000' },
    'env-file': { type: 'string' },
    phases: { type: 'string', default: 'badpass,login,create,enter,second,move,logout,mapchange,concurrent' },
    'class': { type: 'string', default: '0' },
    headed: { type: 'boolean', default: false },
  },
});
if (!opt.target) throw new Error('--target host:port is required');
const clientVersion = Number.parseInt(opt['client-version'], 10);
const phases = new Set(opt.phases.split(',').map(s => s.trim()).filter(Boolean));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mask = s => (s ? s.slice(0, 3) + '*'.repeat(Math.max(0, s.length - 3)) : s);

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

async function startGateway(port, target) {
  await mkdir(join(CACHE, 'bin'), { recursive: true });
  execFileSync(GO, ['build', '-o', GATEWAY_BIN, './cmd/wydgateway'], {
    cwd: join(ROOT, 'gateway'),
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: join(CACHE, 'gopath'), GOMODCACHE: join(CACHE, 'gomod') },
    stdio: 'inherit',
  });
  const origin = `http://127.0.0.1:${port}`;
  const cfg = {
    listen: `127.0.0.1:${port}`, allowInsecure: true, allowedOrigins: [origin], staticDir: SITE,
    defaultChannel: 'server',
    channels: [{ name: 'server', target, publicWsUrl: `ws://127.0.0.1:${port}/ws/server`, clientVersion }],
    limits: { maxConns: 8, maxConnsPerIP: 8 },
  };
  const cfgPath = join(CACHE, 'gateway-world.json');
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

// One browser context = one game client.
class Session {
  constructor(browser, origin, label, creds) {
    this.browser = browser; this.origin = origin; this.label = label; this.creds = creds;
    this.pageErrors = []; this.shots = [];
  }

  async open() {
    this.context = await this.browser.newContext({ viewport: { width: 1024, height: 768 } });
    this.page = await this.context.newPage();
    this.page.on('pageerror', e => this.pageErrors.push(e.message.slice(0, 300)));
    await this.page.goto(`${this.origin}/client.html`, { waitUntil: 'load' });
    await this.until('server selection', () => window.clientEvidence?.ready &&
      window.Module?._wyd_get_game_state?.() === 7 && window.clientEvidence.frames > 20, 120000);
  }

  async close() { await this.context?.close(); this.context = null; }

  eval(fn, arg) { return this.page.evaluate(fn, arg); }

  // Polls with evaluate: waitForFunction needs eval, which the page CSP forbids.
  async until(what, fn, ms = 60000, arg) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await this.page.evaluate(fn, arg);
      if (v) return v;
      if (this.pageErrors.length) throw new Error(`${this.label}: page error: ${this.pageErrors[0]}`);
      if (Date.now() > end) throw new Error(`${this.label}: timeout waiting for ${what}`);
      await sleep(250);
    }
  }

  probe() { return this.eval(() => window.clientProbe()); }
  state() { return this.eval(() => Module._wyd_get_game_state()); }

  async shot(name) {
    const path = join(OUT, `${this.label}-${name}.png`);
    await this.page.locator('#canvas').screenshot({ path });
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    this.shots.push({ name, file: `.cache/world/${this.label}-${name}.png`, sha256 });
  }

  login(password = this.creds.password) {
    return this.eval(([a, p]) =>
      Module.ccall('wyd_debug_selectserver_login', 'number', ['string', 'string', 'string'], [a, p, 'gateway']),
    [this.creds.account, password]);
  }

  async loginToSelect() {
    if ((await this.login()) !== 1) throw new Error(`${this.label}: login control refused`);
    await this.until('character selection', () => Module._wyd_get_game_state() === 5, 60000);
    // The selection scene builds its keypad and 3D samples over a few frames.
    await this.until('selection scene ready', () => Module._wyd_selchar_initialized() === 1 &&
      window.clientEvidence.frames > 0, 30000);
    await sleep(3000);
  }

  async pin() {
    const lock = await this.eval(() => Module._wyd_selchar_account_lock());
    if (lock === 1) return { already: true };
    const sent = await this.eval(p =>
      Module.ccall('wyd_debug_selchar_pin', 'number', ['string'], [p]), this.creds.pin);
    if (sent !== 1) throw new Error(`${this.label}: PIN control refused (lock=${lock})`);
    // 0xFDE sets the lock to 1; 0xFDF returns it to 0.
    const result = await this.until('PIN reply', () => {
      const l = Module._wyd_selchar_account_lock();
      return l === 1 || l === 0 ? `lock${l}` : null;
    }, 30000);
    return { sent: true, result };
  }

  slots() {
    return this.eval(() => [0, 1, 2, 3].map(i => ({
      name: Module.UTF8ToString(Module._wyd_selchar_name(i)),
      level: Module._wyd_selchar_level(i),
      maxHp: Module._wyd_selchar_score(i, 0), hp: Module._wyd_selchar_score(i, 1),
      str: Module._wyd_selchar_score(i, 4), int: Module._wyd_selchar_score(i, 5),
      dex: Module._wyd_selchar_score(i, 6), con: Module._wyd_selchar_score(i, 7),
      equip: Array.from({ length: 18 }, (_, k) => Module._wyd_selchar_equip(i, k)),
      human: Module._wyd_selchar_human_present(i),
    })));
  }

  async create(name, cls) {
    const before = await this.eval(() => Module._wyd_selchar_char_count());
    if ((await this.eval(() => Module._wyd_debug_selchar_open_create())) !== 1)
      throw new Error(`${this.label}: create view refused`);
    await sleep(4000); // camera moves to the class samples
    await this.until('class samples', c => Module._wyd_selchar_sample_present(c) === 1, 30000, cls);
    const sent = await this.eval(([n, c]) =>
      Module.ccall('wyd_debug_selchar_create', 'number', ['string', 'number'], [n, c]), [name, cls]);
    if (sent !== 1) throw new Error(`${this.label}: create control refused`);
    await this.until('CNFNewCharacter', b => Module._wyd_selchar_char_count() > b, 30000, before);
    await sleep(4000); // camera returns to the selection view
  }

  async enter(slot) {
    await this.until('slot human', s => Module._wyd_selchar_human_present(s) === 1, 30000, slot);
    if ((await this.eval(s => Module._wyd_debug_selchar_enter(s), slot)) !== 1)
      throw new Error(`${this.label}: enter control refused`);
    await this.until('Field with own character', () => Module._wyd_get_game_state() === 0 &&
      Module._wyd_field_initialized() === 1 && Module._wyd_field_has_my_human() === 1, 120000);
    await sleep(3000);
    const me = await this.me();
    this.id = me.id;
    return me;
  }

  me() {
    return this.eval(() => ({
      id: Module._wyd_field_myhuman_id(),
      name: Module.UTF8ToString(Module._wyd_field_myhuman_name()),
      x: Module._wyd_field_myhuman_x(), y: Module._wyd_field_myhuman_y(),
      hp: Module._wyd_field_myhuman_hp(), maxHp: Module._wyd_field_myhuman_max_hp(),
      cls: Module._wyd_field_myhuman_class_id(),
      look: Array.from({ length: 8 }, (_, p) => Module._wyd_field_human_look_mesh(Module._wyd_field_myhuman_id(), p)),
    }));
  }

  other(id) {
    return this.eval(i => ({
      present: Module._wyd_field_human_present(i),
      name: Module.UTF8ToString(Module._wyd_field_human_name(i)),
      x: Module._wyd_field_human_x(i), y: Module._wyd_field_human_y(i),
      tx: Module._wyd_field_human_target_x(i), ty: Module._wyd_field_human_target_y(i),
      angle: Module._wyd_field_human_angle(i),
      look: Array.from({ length: 8 }, (_, p) => Module._wyd_field_human_look_mesh(i, p)),
    }), id);
  }

  // A real click on the canvas: the Field scene picks the ground and sends Action.
  // Rendering runs at ~1 frame/s headless: hover first, then hold the button
  // across a frame so the scene sees the press.
  async clickGround(dx, dy) {
    const box = await this.page.locator('#canvas').boundingBox();
    const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
    await this.page.mouse.move(x, y, { steps: 4 });
    await sleep(1200);
    await this.page.mouse.down();
    await sleep(1200);
    await this.page.mouse.up();
  }

  input() {
    return this.eval(() => ({ mouse: Module._wyd_input_mouse_event_count(),
      moveTo: [Module._wyd_field_myhuman_move_to_x(), Module._wyd_field_myhuman_move_to_y()] }));
  }

  // Walks toward a world tile with real clicks: the runtime's own ground pick
  // (GroundGetPickPos: x = world x, z = world y) finds the screen point whose
  // ground is nearest the target; the scene then routes and sends Action.
  async walkTo(tx, ty, { maxClicks = 25, stopWhen } = {}) {
    const trail = [];
    for (let i = 0; i < maxClicks; i++) {
      const me = await this.me();
      trail.push([me.x, me.y]);
      if (stopWhen && (await stopWhen())) break;
      if (Math.hypot(me.x - tx, me.y - ty) < 1) break;
      const best = await this.eval(([tx, ty]) => {
        const c = document.getElementById('canvas');
        let best = null;
        for (let ly = 90; ly <= c.height - 110; ly += 30) {
          for (let lx = 40; lx <= c.width - 40; lx += 30) {
            if (!Module._wyd_field_pick_at(lx, ly)) continue;
            const wx = Module._wyd_field_last_pick_x(), wy = Module._wyd_field_last_pick_z();
            const d = Math.hypot(wx - tx, wy - ty);
            if (!best || d < best.d) best = { lx, ly, wx, wy, d, cw: c.width, ch: c.height };
          }
        }
        return best;
      }, [tx, ty]);
      if (!best) throw new Error(`${this.label}: no ground under the cursor`);
      const box = await this.page.locator('#canvas').boundingBox();
      const dx = best.lx * box.width / best.cw - box.width / 2;
      const dy = best.ly * box.height / best.ch - box.height / 2;
      await this.clickGround(dx, dy);
      // Wait until the character stops (or the stop condition holds).
      let last = me, still = 0;
      const end = Date.now() + 40000;
      while (Date.now() < end) {
        await sleep(700);
        if (stopWhen && (await stopWhen())) break;
        const now = await this.me();
        still = now.x === last.x && now.y === last.y ? still + 1 : 0;
        last = now;
        if (still >= 3) break;
      }
    }
    return trail;
  }

  async walk(dx, dy) {
    const start = await this.me();
    const sentBefore = (await this.probe()).dialect.outPass;
    const inBefore = await this.input();
    await this.clickGround(dx, dy);
    this.lastInput = { before: inBefore, after: await this.input() };
    // Wait until the own character stops at a new tile.
    let last = start, still = 0;
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      await sleep(500);
      const now = await this.me();
      const moved = Math.hypot(now.x - start.x, now.y - start.y) >= 1;
      still = now.x === last.x && now.y === last.y ? still + 1 : 0;
      last = now;
      if (moved && still >= 4) break;
    }
    const sentAfter = (await this.probe()).dialect.outPass;
    return { from: [start.x, start.y], to: [last.x, last.y], actionsSent: sentAfter - sentBefore,
      input: this.lastInput };
  }
}

function sanitizeGatewayLog(logs) {
  return logs.map(l => { try { return JSON.parse(l); } catch { return { raw: String(l).slice(0, 200) }; } })
    .map(l => ({ time: l.time, msg: l.msg, reason: l.reason, bytes_up: l.bytes_up, bytes_down: l.bytes_down }));
}

function dialectSummary(p) {
  const d = p.dialect;
  return {
    inTranslated: d.inTranslated, inPass: d.inPass, inDropUnknown: d.inDropUnknown, inDropSize: d.inDropSize,
    inDropRange: d.inDropRange, outTranslated: d.outTranslated, outPass: d.outPass,
    outDropUnknown: d.outDropUnknown, fieldZeroed: d.fieldZeroed, unmappedNonZero: d.unmappedNonZero,
    inboundFrames: d.inboundFrames, droppedIn: d.droppedIn, droppedOut: d.droppedOut,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const env = { ...(await readEnvFile(opt['env-file'])), ...process.env };
  const credsOf = sfx => ({
    account: env[`W2PP_TEST_ACCOUNT${sfx}`], password: env[`W2PP_TEST_PASSWORD${sfx}`],
    pin: env[`W2PP_TEST_PIN${sfx}`], char: env[`W2PP_TEST_CHAR${sfx}`],
  });
  const A = credsOf(''), B = credsOf('2');
  for (const [k, c] of [['A', A], ['B', B]])
    if (!c.account || !c.password || !c.pin || !c.char) throw new Error(`credentials for ${k} incomplete in env`);
  const cls = Number.parseInt(opt.class, 10);

  const ev = { when: new Date().toISOString(), target: opt.target, clientVersion, phases: [...phases],
    accounts: { A: mask(A.account), B: mask(B.account) }, results: {}, ok: false };
  const gw = await startGateway(await freePort(), opt.target);
  const browser = await chromium.launch({ headless: !opt.headed });
  const sessions = [];
  const newSession = async (label, creds) => {
    const s = new Session(browser, gw.origin, label, creds);
    sessions.push(s);
    await s.open();
    return s;
  };
  const r = ev.results;
  const step = async (name, fn) => {
    if (!phases.has(name)) return;
    const t0 = Date.now();
    console.log(`==> ${name}`);
    try {
      r[name] = { ok: true, ...(await fn()) };
    } catch (e) {
      r[name] = { ok: false, error: String(e?.message ?? e) };
      throw e;
    } finally {
      r[name].ms = Date.now() - t0;
      r[name].at = new Date().toISOString();
      console.log(`    ${r[name].ok ? 'ok' : 'FAIL ' + r[name].error}`);
    }
  };

  let a, b;
  try {
    await step('badpass', async () => {
      const s = await newSession('A-badpass', A);
      const before = await s.probe();
      if ((await s.login(`x${A.password}`.slice(0, 12))) !== 1) throw new Error('login control refused');
      // Wait for the notice (0x102 -> MessagePanel) or a state change.
      await s.until('login reply', () => window.clientProbe().socket.lastRecvOpcode === 0x102 ||
        Module._wyd_get_game_state() !== 7, 30000);
      const panel = await s.until('notice on the panel', () => Module._wyd_scene_message_visible() === 1 &&
        { text: Module.UTF8ToString(Module._wyd_scene_message_text()) }, 5000);
      await s.shot('badpass');
      const p = await s.probe();
      await s.close();
      if (p.state !== STATE.SELECT_SERVER) throw new Error(`unexpected state ${p.state}`);
      if (p.socket.lastRecvOpcode !== 0x102) throw new Error(`last opcode 0x${p.socket.lastRecvOpcode.toString(16)}`);
      if (panel.text !== 'Senha incorreta.') throw new Error(`panel shows "${panel.text}"`);
      return { state: p.state, lastRecvOpcode: '0x102', panelText: panel.text,
        noticeTranslated: p.dialect.inTranslated - before.dialect.inTranslated };
    });

    await step('login', async () => {
      a = await newSession('A', A);
      await a.loginToSelect();
      const pin = await a.pin();
      if (!pin.already && pin.result !== 'lock1') throw new Error(`PIN rejected (${pin.result})`);
      return { pin, slots: (await a.slots()).map(x => ({ filled: !!x.name, level: x.level })) };
    });

    await step('create', async () => {
      let slots = await a.slots();
      let created = false;
      if (!slots[0].name) {
        await a.create(A.char, cls);
        created = true;
        slots = await a.slots();
      }
      await a.shot('selchar');
      const s0 = slots[0];
      if (!s0.name) throw new Error('slot 0 still empty');
      return { created, preview: { nameMatches: s0.name === A.char, level: s0.level, maxHp: s0.maxHp, hp: s0.hp,
        str: s0.str, int: s0.int, dex: s0.dex, con: s0.con, equip: s0.equip, human: s0.human } };
    });

    await step('enter', async () => {
      const me = await a.enter(0);
      await a.shot('field');
      const p = await a.probe();
      if (p.field.fixture !== 0) throw new Error('offline fixture used');
      if (me.name !== A.char) throw new Error('own name differs from the created character');
      return { me: { ...me, name: mask(me.name) }, dialect: dialectSummary(p), glErrors: p.glErrorTotal };
    });

    // Visual check of item data: the inventory icons come from ItemList/itemicon
    // and the character's armor from ItemList mesh/texture indices.
    await step('inventory', async () => {
      const box = await a.page.locator('#canvas').boundingBox();
      await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60);
      for (let i = 0; i < 6; i++) { await a.page.mouse.wheel(0, -240); await sleep(700); }
      await sleep(3000);
      await a.shot('zoom');
      await a.page.screenshot({ path: join(OUT, 'A-character.png'),
        clip: { x: box.x + box.width / 2 - 110, y: box.y + box.height / 2 - 150, width: 220, height: 240 } });
      await a.page.locator('#canvas').press('KeyI');
      await sleep(4000);
      await a.shot('inventory');
      await a.page.locator('#canvas').press('KeyI');
      const diag = await a.eval(() => {
        const item = i => ({ index: i, icon: Module._wyd_debug_item_field(i, 0), grade: Module._wyd_debug_item_field(i, 1),
          mesh: Module._wyd_debug_item_field(i, 2), texture: Module._wyd_debug_item_field(i, 3),
          pos: Module._wyd_debug_item_field(i, 4) });
        const equip = [...Array(16).keys()].map(s => Module._wyd_debug_my_item(0, s)).filter(Boolean);
        const carry = [...Array(64).keys()].map(s => Module._wyd_debug_my_item(1, s)).filter(Boolean);
        const tex = [326, 329, 338, 322, 327].map(t => ({ t, w: Module._wyd_debug_ui_texture_size(t, 0),
          h: Module._wyd_debug_ui_texture_size(t, 1) }));
        const meshes = [];
        for (let i = 0; i < 16; i++) {
          const s = Module.UTF8ToString(Module._wyd_debug_myhuman_mesh_texture(i));
          if (!s) break;
          meshes.push(s);
        }
        return { equip: equip.map(item), carry: carry.map(item), uiTextures: tex, meshes };
      });
      return { shots: ['A-character.png', 'A-inventory.png'], diag };
    });

    await step('second', async () => {
      b = await newSession('B', B);
      await b.loginToSelect();
      const pin = await b.pin();
      if (!pin.already && pin.result !== 'lock1') throw new Error(`PIN rejected (${pin.result})`);
      let slots = await b.slots();
      if (!slots[0].name) { await b.create(B.char, cls); slots = await b.slots(); }
      const me = await b.enter(0);
      await b.shot('field');
      const p = await b.probe();
      return { pin, me: { ...me, name: mask(me.name) }, dialect: dialectSummary(p) };
    });

    await step('move', async () => {
      // Both in the same city spawn; each must see the other through the server.
      const aSeesB0 = await a.until('A sees B', id => Module._wyd_field_human_present(id) === 1, 30000, b.id);
      const bSeesA0 = await b.until('B sees A', id => Module._wyd_field_human_present(id) === 1, 30000, a.id);
      const aMe0 = await a.me();
      const bView0 = await b.other(a.id);
      const aWalk = await a.walk(140, 60);
      await sleep(3000);
      const aMe1 = await a.me();
      const bView1 = await b.other(a.id);
      const bWalk = await b.walk(-140, -60);
      await sleep(3000);
      const bMe1 = await b.me();
      const aView1 = await a.other(b.id);
      await a.shot('after-move');
      await b.shot('after-move');
      const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= 1.5;
      const res = {
        aSeesB: aSeesB0 === true, bSeesA: bSeesA0 === true,
        aWalk, bWalk,
        bSawAFrom: [bView0.x, bView0.y], bSawATo: [bView1.x, bView1.y], aActual: [aMe1.x, aMe1.y],
        aSawBTo: [aView1.x, aView1.y], bActual: [bMe1.x, bMe1.y],
        nameAinB: bView1.name === A.char, nameBinA: aView1.name === B.char,
        angleAinB: bView1.angle, lookAinB: bView1.look, lookAself: aMe1.look,
        lookMatches: JSON.stringify(bView1.look) === JSON.stringify(aMe1.look),
      };
      res.bSawAMove = near(bView1, aMe1) && Math.hypot(aMe1.x - aMe0.x, aMe1.y - aMe0.y) >= 1;
      res.aSawBMove = near(aView1, bMe1) && Math.hypot(bMe1.x - bWalk.from[0], bMe1.y - bWalk.from[1]) >= 1;
      if (!res.bSawAMove || !res.aSawBMove) throw Object.assign(new Error('movement not mirrored'), { res });
      return res;
    });

    await step('logout', async () => {
      const lastA = await a.me();
      await a.close();
      const gone = await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      a = await newSession('A2', A);
      await a.loginToSelect();
      const pin = await a.pin();
      const me = await a.enter(0);
      const back = await b.until('B sees A again', id => Module._wyd_field_human_present(id) === 1, 30000, a.id);
      await a.shot('relogin');
      return { despawnSeenByB: gone === true, pin, lastPosition: [lastA.x, lastA.y],
        reloginPosition: [me.x, me.y], respawnSeenByB: back === true, newId: me.id };
    });

    // Armia -> Armia Field portal (server world/teleport.go: tile block
    // 2140..2143 x 2068..2071 -> 2588,2096, free). The client shows its own
    // confirm box (message 16) on the portal; OK sends ReqTeleport.
    await step('mapchange', async () => {
      const onBox = () => a.eval(() => Module._wyd_scene_msgbox_message() === 16);
      const trail = await a.walkTo(2141.5, 2069.5, { stopWhen: onBox });
      const box = await a.until('portal confirm box', () => Module._wyd_scene_msgbox_message() === 16, 20000);
      const before = await a.me();
      const bSawBefore = await b.other(a.id);
      await a.shot('portal');
      if ((await a.eval(() => Module._wyd_debug_scene_msgbox_ok())) !== 1) throw new Error('OK refused');
      const after = await a.until('teleported', ([x, y]) => {
        const nx = Module._wyd_field_myhuman_x(), ny = Module._wyd_field_myhuman_y();
        return Math.hypot(nx - x, ny - y) > 50 && { x: nx, y: ny, mapX: Module._wyd_field_map_x(), mapY: Module._wyd_field_map_y() };
      }, 60000, [before.x, before.y]);
      await sleep(4000);
      await a.shot('armia-field');
      const bLost = await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      const p = await a.probe();
      return { clicks: trail.length, portalTile: [before.x, before.y], confirmBox: box === true,
        bSawABeforeTeleport: bSawBefore.present === 1, arrived: after,
        nearArmiaField: Math.hypot(after.x - 2588, after.y - 2096) <= 4, bLostA: bLost === true,
        dialect: dialectSummary(p) };
    });

    await step('concurrent', async () => {
      const c = await newSession('A-concurrent', A);
      await c.login();
      await c.until('reply', () => Module._wyd_get_game_state() !== 7 || window.clientProbe().socket.lastRecvOpcode !== 0, 30000);
      await sleep(3000);
      const second = await c.probe();
      const first = await a.probe();
      await c.shot('concurrent');
      await c.close();
      await sleep(2000);
      const firstAfter = await a.probe();
      return { secondState: second.state, secondLastRecv: '0x' + second.socket.lastRecvOpcode.toString(16),
        firstStateDuring: first.state, firstStateAfter: firstAfter.state };
    });
    ev.ok = Object.values(r).every(x => x.ok);
  } catch (e) {
    ev.error = String(e?.message ?? e);
    if (e?.res) ev.partial = e.res;
  } finally {
    for (const s of sessions) {
      try { if (s.context) ev[`final_${s.label}`] = dialectSummary(await s.probe()); } catch {}
    }
    ev.pageErrors = Object.fromEntries(sessions.map(s => [s.label, s.pageErrors]));
    ev.screenshots = sessions.flatMap(s => s.shots);
    await browser.close();
    gw.proc.kill();
    ev.gatewayLog = sanitizeGatewayLog(gw.logs);
  }
  // Never let a credential reach the evidence file.
  let text = JSON.stringify(ev, null, 1);
  for (const c of [A, B]) for (const v of [c.account, c.password, c.pin, c.char])
    if (v && text.includes(v)) text = text.split(v).join('<redacted>');
  // One file per run: a later run must not overwrite an earlier result.
  const path = join(OUT, `evidence-${ev.when.replace(/[:.]/g, '-')}.json`);
  await writeFile(path, text);
  console.log(JSON.stringify({ ok: ev.ok, error: ev.error, evidence: path }, null, 1));
  process.exit(ev.ok ? 0 : 1);
}

main().catch(e => { console.error(e?.message ?? e); process.exit(2); });
