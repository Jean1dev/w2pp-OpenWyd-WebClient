#!/usr/bin/env node
// Etapa 4: online slice against the operator's real tmserver, two accounts.
//
//   node tools/verify_world.mjs --target host:port --client-version 12000 --env-file .env
//   node tools/verify_world_suite.mjs --target host:port --env-file .env
//
// Phases (all through the real gateway, the real page and its CSP):
//   badpass   wrong password -> the server's 0x102 notice is translated and shown
//   badpin    establish the configured PIN, reconnect, reject a different PIN, recover
//   classes   validate --class in its own process, create only if absent, then relogin
//   login     A logs in, PIN verified (the first verify on an account defines it)
//   create    A creates a character when its slot 0 is empty; preview is read
//   enter     A enters the Field with the server's CNFCharacterLogin
//   second    B does the same in a separate browser context
//   move      A walks (mouse click on the canvas) and B sees it; then B walks and A sees it
//   logout    A closes; B loses A. A logs in again and B sees A again
//   mapchange A walks onto the Armia -> Armia Field portal and confirms; B loses A
//   attack    A and B walk to Armia's Gremlins; A attacks, B watches, then A relogs
//   grind     the --class character of A kills Gremlins until --grind-level (server EXP)
//   learn     the --class character learns its cheapest skill from the class master
//   cast      the --class character assigns its learned skill (hover + Shift+1) and casts it on a Gremlin
//   death     A dies to the Armia Field Trolls, returns to town (box 11, 0x03AE/0x0289); B at the spawn sees it
//   concurrent A's account logs in a second time while A is in the Field
//
// Credentials come from W2PP_TEST_{ACCOUNT,PASSWORD,PIN,CHAR}[2] (env or --env-file)
// and are handed to the game UI only. Evidence holds counters, opcodes, states,
// positions and masked names; screenshots stay in .cache (they contain assets).
import { chromium } from 'playwright';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { parseArgs, promisify } from 'node:util';
import assert from 'node:assert/strict';
import { validateOptions, checkHealth, checkPreview, checkArmiaSpawn, checkTeleport, checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast, redactEvidence } from './world_checks.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join(CACHE, 'world', RUN_ID);
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
    'grind-level': { type: 'string', default: '4' },
    headed: { type: 'boolean', default: false },
  },
});
const phases = validateOptions(opt);
const clientVersion = Number.parseInt(opt['client-version'], 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MiB = n => (n == null ? null : Math.round(n / 1048576));

// Sum of the working sets of Playwright's own Chromium processes (never the
// user's browser: matched by the ms-playwright install path). Shared pages are
// counted once per process, so this overestimates; it is a trend, not a budget.
async function browserWorkingSet() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*ms-playwright*' } | " +
        'Measure-Object WorkingSetSize -Sum).Sum'], { timeout: 20000 });
      return Number(stdout.trim()) || null;
    }
    const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'rss=,command='], { timeout: 20000 });
    return stdout.split('\n').filter(l => l.includes('ms-playwright'))
      .reduce((n, l) => n + Number(l.trim().split(/\s+/)[0]) * 1024, 0) || null;
  } catch { return null; }
}
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
  const cfgPath = join(OUT, 'gateway.json');
  await writeFile(cfgPath, JSON.stringify(cfg, null, 1));
  const logs = [];
  const proc = spawn(GATEWAY_BIN, ['-config', cfgPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  let startError;
  proc.on('error', e => { startError = e; });
  proc.stderr.on('data', d => logs.push(...d.toString().split('\n').filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    if (startError || proc.exitCode !== null) break;
    try { const r = await fetch(`${origin}/config.json`); if (r.ok) return { proc, origin, logs }; } catch {}
    await sleep(100);
  }
  proc.kill();
  throw new Error(`gateway did not start: ${startError?.message ?? logs.join('\n')}`);
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
    this.connected = false;
    this.page.on('websocket', ws => {
      this.connected = true;
      ws.on('close', () => { this.connected = false; });
    });
    this.page.on('pageerror', e => this.pageErrors.push(e.message.slice(0, 300)));
    await this.page.goto(`${this.origin}/client.html`, { waitUntil: 'load' });
    await this.until('server selection', () => window.clientEvidence?.ready &&
      window.Module?._wyd_get_game_state?.() === 7 && window.clientEvidence.frames > 20, 120000);
  }

  async close() { await this.context?.close(); this.context = null; }

  // WASM linear memory (grows, never shrinks) and live JS heap of this page.
  memory() {
    return this.eval(() => ({ wasm: window.Module?.HEAPU8?.length ?? null,
      js: performance.memory?.usedJSHeapSize ?? null }));
  }

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
    // page.screenshot with a clip skips the locator "stable element" wait, which
    // flakes on a canvas redrawn every frame on a loaded machine.
    const clip = await this.page.locator('#canvas').boundingBox();
    await this.page.screenshot({ path, clip, timeout: 45000 });
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
    this.shots.push({ name, file: `.cache/world/${RUN_ID}/${this.label}-${name}.png`, sha256 });
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

  async pin(value = this.creds.pin) {
    const lock = await this.eval(() => Module._wyd_selchar_account_lock());
    if (lock === 1) return { already: true };
    const sent = await this.eval(p =>
      Module.ccall('wyd_debug_selchar_pin', 'number', ['string'], [p]), value);
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
      maxMp: Module._wyd_selchar_score(i, 2), mp: Module._wyd_selchar_score(i, 3),
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
    checkHealth(await this.probe(), this.pageErrors);
    return me;
  }

  async healthy() {
    checkHealth(await this.probe(), this.pageErrors);
    assert(this.connected, `${this.label}: socket disconnected`);
  }

  me() {
    return this.eval(() => ({
      id: Module._wyd_field_myhuman_id(),
      name: Module.UTF8ToString(Module._wyd_field_myhuman_name()),
      x: Module._wyd_field_myhuman_x(), y: Module._wyd_field_myhuman_y(),
      hp: Module._wyd_field_myhuman_hp(), maxHp: Module._wyd_field_myhuman_max_hp(),
      cls: Module._wyd_field_myhuman_class_id(),
      characterClass: typeof Module._wyd_field_character_class === 'function' ? Module._wyd_field_character_class() : null,
      equip: Array.from({ length: 16 }, (_, slot) => Module._wyd_debug_my_item(0, slot)),
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
  // A stray click can open a local panel (e.g. the quest log) that then eats
  // every world click. Close it with ESC, as a player would, and record it.
  // Never with a message box up: ESC would cancel the portal confirmation.
  async closePanels() {
    for (let i = 0; i < 4; i++) {
      const [mask, box] = await this.eval(() => [Module._wyd_field_open_panels?.() ?? 0, Module._wyd_scene_msgbox_message()]);
      if (!mask || box) return;
      (this.panelsClosed ??= []).push(mask);
      await this.page.locator('#canvas').press('Escape');
      await this.frames(2);
    }
    throw new Error(`${this.label}: panels stay open after ESC`);
  }

  async clickGround(dx, dy) {
    await this.closePanels();
    const box = await this.page.locator('#canvas').boundingBox();
    const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
    await this.page.mouse.move(x, y, { steps: 4 });
    await this.frames(2);
    assert.equal(await this.eval(() => Module._wyd_field_hover_entity()), 0, 'ground click overlaps entity');
    // NPCs wander: at ~1 frame/s one can step under the cursor between the
    // check and the press (a shop request 0x027B was sent that way). Require a
    // second clean frame right before pressing.
    await this.frames(1);
    assert.equal(await this.eval(() => Module._wyd_field_hover_entity()), 0, 'ground click overlaps entity');
    await this.page.mouse.down();
    try { await this.frames(2); } finally { await this.page.mouse.up(); }
    await this.frames(1);
  }

  async frames(count) {
    const before = await this.eval(() => window.clientEvidence.frames);
    await this.until('rendered input frames', n => window.clientEvidence.frames >= n, 60000, before + count);
  }

  input() {
    return this.eval(() => ({ mouse: Module._wyd_input_mouse_event_count(),
      moveTo: [Module._wyd_field_myhuman_move_to_x(), Module._wyd_field_myhuman_move_to_y()] }));
  }

  // Walks toward a world tile with real clicks: the runtime's own ground pick
  // (GroundGetPickPos: x = world x, z = world y) finds the screen point whose
  // ground is nearest the target; the scene then routes and sends Action.
  async walkTo(tx, ty, { maxClicks = 25, stopWhen, maxStalls = 4, near = 1, stallOk = false } = {}) {
    const trail = [];
    // Screen points whose click did not really move the character (the
    // runtime found no route from here): the next click picks a different one.
    const avoid = [];
    let bestDist = Infinity, stalls = 0, lastPick = null;
    for (let i = 0; i < maxClicks; i++) {
      const me = await this.me();
      trail.push([me.x, me.y]);
      const dist = Math.hypot(me.x - tx, me.y - ty);
      console.log(`    ${this.label} walk ${i}: ${me.x},${me.y} d=${dist.toFixed(1)}`);
      if (stopWhen && (await stopWhen())) break;
      if (dist < near) break;
      // Fail fast with the trail instead of burning the scenario deadline.
      stalls = dist < bestDist - 1 ? 0 : stalls + 1;
      bestDist = Math.min(bestDist, dist);
      // A route blocked by a wall moves one step at most: avoid that point too.
      if (lastPick && trail.length >= 2 && Math.hypot(trail.at(-1)[0] - trail.at(-2)[0], trail.at(-1)[1] - trail.at(-2)[1]) < 2)
        avoid.push(lastPick);
      if (stalls >= maxStalls && stallOk) break;
      if (stalls >= maxStalls) {
        const err = new Error(`${this.label}: no progress towards ${tx},${ty} after ${stalls} clicks (d=${dist.toFixed(1)})`);
        err.trail = trail;
        // Why the runtime did not move: input reached it? route target? packets?
        try {
          await this.shot('stall');
          err.stall = { input: await this.input(), outPass: (await this.probe()).dialect.outPass,
            msgbox: await this.eval(() => Module._wyd_scene_msgbox_message()),
            hover: await this.eval(() => Module._wyd_field_hover_human_id()), avoid };
        } catch {}
        throw err;
      }
      const best = await this.eval(([tx, ty, avoid]) => {
        const c = document.getElementById('canvas');
        let best = null;
        // Keep off the screen edges: entities enter the frame there and the
        // bottom rows sit next to the HUD.
        for (let ly = 90; ly <= c.height - 150; ly += 30) {
          for (let lx = 70; lx <= c.width - 70; lx += 30) {
            if (avoid.some(([ax, ay]) => Math.hypot(ax - lx, ay - ly) < 45)) continue;
            if (!Module._wyd_field_pick_at(lx, ly)) continue;
            const wx = Module._wyd_field_last_pick_x(), wy = Module._wyd_field_last_pick_z();
            const d = Math.hypot(wx - tx, wy - ty);
            if (!best || d < best.d) best = { lx, ly, wx, wy, d, cw: c.width, ch: c.height };
          }
        }
        return best;
      }, [tx, ty, avoid]);
      if (!best) throw new Error(`${this.label}: no ground under the cursor`);
      lastPick = [best.lx, best.ly];
      console.log(`      pick ${best.wx.toFixed(1)},${best.wy.toFixed(1)} at ${best.lx},${best.ly}`);
      const box = await this.page.locator('#canvas').boundingBox();
      const dx = best.lx * box.width / best.cw - box.width / 2;
      const dy = best.ly * box.height / best.ch - box.height / 2;
      // Try nearby screen points if an NPC covers the best ground projection.
      let clicked = false;
      for (const [ox, oy] of [[0, 0], [-30, 0], [30, 0], [0, -30], [0, 30]]) {
        try { await this.clickGround(dx + ox, dy + oy); clicked = true; break; }
        catch (e) { if (!String(e.message).includes('ground click overlaps entity')) throw e; }
      }
      // An entity standing on the best projection is transient: pick another
      // screen point on the next iteration (still bounded by maxClicks).
      if (!clicked) {
        console.log(`      ${this.label}: entity covers ${best.lx},${best.ly}; picking again`);
        avoid.push(lastPick);
        lastPick = null;
        await sleep(700);
        continue;
      }
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
    let clicked = false;
    for (const [cx, cy] of [[dx, dy], [-dx, dy], [dx, -dy], [-dx, -dy], [0, 160], [200, 0]]) {
      try { await this.clickGround(cx, cy); clicked = true; break; }
      catch (e) { if (!String(e.message).includes('ground click overlaps entity')) throw e; }
    }
    assert(clicked, 'no entity-free ground for movement');
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

  ground() {
    return this.eval(() => [Module._wyd_field_ground_index_x(), Module._wyd_field_ground_index_y()]);
  }

  // Onto the Armia -> Armia Field portal tile until the client's confirm box
  // (message 16) opens. The straight line from the city spawn crosses a walled
  // planter around 2117,2088 where the runtime's route gets stuck, so follow
  // the street south of it (waypoints from a successful trail).
  async walkToPortal() {
    const onBox = () => this.eval(() => Module._wyd_scene_msgbox_message() === 16);
    const trail = [];
    for (const [wx, wy] of [[2117.5, 2095.5], [2130.5, 2091.5], [2140.5, 2082.5]]) {
      const me = await this.me();
      if (me.x > wx - 2) continue; // already past this waypoint
      trail.push(...await this.walkTo(wx, wy, { near: 3, stallOk: true }));
    }
    trail.push(...await this.walkTo(2141.5, 2069.5, { stopWhen: onBox }));
    return trail;
  }

  // Armia -> Armia Field through the server's portal (same path as mapchange).
  async toArmiaField() {
    const [gx, gy] = await this.ground();
    if (gx === 20 && gy === 16) return { already: true, at: await this.me() };
    const trail = await this.walkToPortal();
    await this.until('portal confirm box', () => Module._wyd_scene_msgbox_message() === 16, 20000);
    const before = await this.me();
    if ((await this.eval(() => Module._wyd_debug_scene_msgbox_ok())) !== 1) throw new Error(`${this.label}: OK refused`);
    await this.until('teleported', ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x,
      Module._wyd_field_myhuman_y() - y) > 50, 60000, [before.x, before.y]);
    await sleep(4000);
    const at = await this.me();
    checkTeleport({ ...at, ...Object.fromEntries((await this.ground()).map((v, i) => [i ? 'groundY' : 'groundX', v])) });
    return { clicks: trail.length, at };
  }

  async toGremlinField() {
    // NPCGener.txt at the locked server revision: generators 27..30 put
    // Gremlins at x=2184, y=2086..2118. The portal to 2588,2096 instead
    // landed our initial characters among Trolls and killed A before input.
    const trail = [];
    // HeightMap + baked AttributeMap put the east gate corridor at y=2102;
    // a direct click toward 2146,2096 runs into the gatehouse fence.
    for (const [x, y] of [[2117.5, 2095.5], [2130.5, 2091.5],
      [2138.5, 2102.5], [2152.5, 2102.5], [2166.5, 2102.5], [2184.5, 2106.5]]) {
      trail.push(...await this.walkTo(x, y, { near: 2 }));
      const score = await this.combat(0);
      assert(score.myHp > 0 && score.myDie !== 1, `${this.label}: died on the way to Gremlins`);
    }
    return { route: 'Armia east / generators 27..30', clicks: trail.length, at: await this.me() };
  }

  // Live non-player entities (server ids >= MaxUser = 1000) the runtime has on
  // screen, nearest first. Nothing here decides what is hostile: the server
  // writes 0 damage for non-combat NPCs, which the scenario then reports.
  mobs() {
    return this.eval(() => {
      const c = document.getElementById('canvas');
      const me = { x: Module._wyd_field_myhuman_x(), y: Module._wyd_field_myhuman_y() };
      const out = [];
      for (let id = Module._wyd_field_human_next(999); id; id = Module._wyd_field_human_next(id)) {
        if (Module._wyd_field_human_die(id) !== 0) continue;
        const hp = Module._wyd_field_human_hp(id), maxHp = Module._wyd_field_human_max_hp(id);
        const sx = Module._wyd_field_human_screen(id, 0), sy = Module._wyd_field_human_screen(id, 1);
        const onScreen = sx >= 70 && sx <= c.width - 70 && sy >= 90 && sy <= c.height - 150;
        const x = Module._wyd_field_human_x(id), y = Module._wyd_field_human_y(id);
        out.push({ id, name: Module.UTF8ToString(Module._wyd_field_human_name(id)), hp, maxHp, x, y, sx, sy,
          onScreen, cw: c.width, ch: c.height, d: Math.hypot(x - me.x, y - me.y) });
      }
      return out.sort((p, q) => p.d - q.d);
    });
  }

  // A real click on an entity: hover until the runtime's own pick reports it
  // under the cursor, then press. The scene builds and sends the attack.
  async clickHuman(id, button = 'left') {
    await this.closePanels();
    const box = await this.page.locator('#canvas').boundingBox();
    for (let attempt = 0; attempt < 4; attempt++) {
      const [sx, sy, cw, ch] = await this.eval(i => {
        const c = document.getElementById('canvas');
        return [Module._wyd_field_human_screen(i, 0), Module._wyd_field_human_screen(i, 1), c.width, c.height];
      }, id);
      if (sx < 0) return false;
      // The chest projection sits above the pick volume's center: aim lower.
      for (const oy of [0, 20, 40]) {
        await this.page.mouse.move(box.x + sx * box.width / cw, box.y + (sy + oy) * box.height / ch, { steps: 3 });
        await this.frames(2);
        if ((await this.eval(() => Module._wyd_field_hover_human_id())) !== id) continue;
        await this.page.mouse.down({ button });
        try { await this.frames(2); } finally { await this.page.mouse.up({ button }); }
        await this.frames(1);
        return true;
      }
    }
    return false;
  }

  combat(id) {
    return this.eval(i => ({
      present: Module._wyd_field_human_present(i), die: Module._wyd_field_human_die(i),
      hp: Module._wyd_field_human_hp(i), maxHp: Module._wyd_field_human_max_hp(i),
      myHp: Module._wyd_field_my_score(0), myMaxHp: Module._wyd_field_my_score(1),
      myMp: Module._wyd_field_my_score(2), myLevel: Module._wyd_field_my_score(4),
      coin: Module._wyd_field_my_score(5), exp: Module._wyd_field_my_exp(),
      myDie: Module._wyd_field_human_die(Module._wyd_field_myhuman_id()),
      learnedSkill: Module._wyd_field_my_score(6) >>> 0, myClass: Module._wyd_field_my_score(7),
      inAttack: window.clientProbe().dialect.inAttack, outAttack: window.clientProbe().dialect.outAttack,
    }), id);
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
  const privateValues = [A, B].flatMap(c => [c.account, c.password, c.pin, c.char]);
  const redact = value => {
    let text = String(value);
    for (const secret of privateValues.filter(Boolean).sort((a, b) => b.length - a.length))
      text = text.split(secret).join('<redacted>');
    return text;
  };
  const evidenceJson = value => JSON.stringify(redactEvidence(value, privateValues), null, 1);

  const ev = { when: new Date().toISOString(), target: opt.target, clientVersion, phases: [...phases],
    accounts: { A: mask(A.account), B: mask(B.account) }, results: {}, ok: false,
    node: process.version, lock: JSON.parse(await readFile(join(ROOT, 'dependencies.lock.json'), 'utf8')),
    revisions: Object.fromEntries(['.', 'external/server', 'external/OpenWyd'].map(dir =>
      [dir, execFileSync('git', ['-C', join(ROOT, dir), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()])) };
  let gw, browser;
  let interrupted;
  const stop = signal => {
    interrupted = signal;
    // Closing the transport/page unblocks pending Playwright operations so the
    // normal catch/finally can preserve evidence and release every resource.
    gw?.proc.kill();
    void browser?.close().catch(() => {});
  };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  // Combat adds two walks to the portal and the fight itself.
  const minutes = ['attack', 'death', 'grind', 'learn', 'cast'].some(x => phases.has(x)) ? 25 : 15;
  const deadline = setTimeout(() => stop(`scenario deadline (${minutes} minutes)`), minutes * 60 * 1000);
  const sessions = [];
  const newSession = async (label, creds) => {
    const s = new Session(browser, gw.origin, label, creds);
    sessions.push(s);
    await s.open();
    return s;
  };
  const r = ev.results;
  // Memory trend for issue #6: system free RAM, Playwright Chromium working
  // set and, per open page, WASM/JS heap. Sampling never fails a scenario.
  ev.memory = [];
  const sample = async point => {
    const pages = {};
    for (const s of sessions) {
      if (!s.context) continue;
      try { const m = await s.memory(); pages[s.label] = { wasmMiB: MiB(m.wasm), jsMiB: MiB(m.js) }; } catch {}
    }
    const m = { point, at: new Date().toISOString(), freeMiB: MiB(freemem()), totalMiB: MiB(totalmem()),
      browserMiB: MiB(await browserWorkingSet()), pages };
    ev.memory.push(m);
    console.log(`    mem ${point}: free ${m.freeMiB}/${m.totalMiB} MiB, browser ${m.browserMiB ?? '?'} MiB, ` +
      Object.entries(pages).map(([k, v]) => `${k} wasm ${v.wasmMiB} js ${v.jsMiB}`).join(', '));
  };
  const step = async (name, fn) => {
    if (!phases.has(name)) return;
    const t0 = Date.now();
    console.log(`==> ${name}`);
    ev.activePhase = name;
    await writeFile(join(OUT, 'evidence.json'), evidenceJson(ev));
    try {
      r[name] = { ok: true, ...(await fn()) };
      for (const s of sessions) if (s.context) await s.healthy();
    } catch (e) {
      r[name] = { ...r[name], ok: false, error: redact(e?.message ?? e), ...(e?.trail && { trail: e.trail }),
        ...(e?.stall && { stall: e.stall }), ...(e?.combat && { combat: e.combat }) };
      throw e;
    } finally {
      r[name].ms = Date.now() - t0;
      r[name].at = new Date().toISOString();
      await sample(`end ${name}`);
      ev.screenshots = sessions.flatMap(s => s.shots);
      ev.activePhase = null;
      await writeFile(join(OUT, 'evidence.json'), evidenceJson(ev));
      console.log(`    ${r[name].ok ? 'ok' : 'FAIL ' + r[name].error}`);
    }
  };

  let a, b;
  try {
    gw = await startGateway(await freePort(), opt.target);
    browser = await chromium.launch({ headless: !opt.headed });
    await step('badpass', async () => {
      const s = await newSession('A-badpass', A);
      const before = await s.probe();
      const wrong = (A.password[0] === 'x' ? 'y' : 'x') + A.password.slice(1);
      privateValues.push(wrong);
      if ((await s.login(wrong)) !== 1) throw new Error('login control refused');
      // Wait for the notice (0x102 -> MessagePanel) or a state change.
      await s.until('login reply', () => window.clientProbe().socket.lastRecvOpcode === 0x102 ||
        Module._wyd_get_game_state() !== 7, 30000);
      const panel = await s.until('notice on the panel', () => Module._wyd_scene_message_visible() === 1 &&
        { text: Module.UTF8ToString(Module._wyd_scene_message_text()) }, 5000);
      await s.shot('badpass');
      const p = await s.probe();
      await s.healthy();
      await s.close();
      if (p.state !== STATE.SELECT_SERVER) throw new Error(`unexpected state ${p.state}`);
      if (p.socket.lastRecvOpcode !== 0x102) throw new Error(`last opcode 0x${p.socket.lastRecvOpcode.toString(16)}`);
      if (panel.text !== 'Senha incorreta.') throw new Error(`panel shows "${panel.text}"`);
      return { state: p.state, lastRecvOpcode: '0x102', panelText: panel.text,
        noticeTranslated: p.dialect.inTranslated - before.dialect.inTranslated };
    });

    await step('badpin', async () => {
      // First establish the configured PIN. A wrong first PIN would set it.
      let s = await newSession('PIN-setup', A);
      await s.loginToSelect();
      assert.equal((await s.pin()).result, 'lock1', 'configured PIN rejected');
      await s.healthy();
      await s.close();
      s = await newSession('PIN-negative', A);
      await s.loginToSelect();
      const wrong = (A.pin[0] === '0' ? '1' : '0') + A.pin.slice(1);
      privateValues.push(wrong);
      assert.equal((await s.pin(wrong)).result, 'lock0', 'wrong PIN unlocked account');
      assert.equal((await s.probe()).socket.lastRecvOpcode, 0xFDF, 'missing PIN rejection');
      assert.equal(await s.eval(() => Module._wyd_debug_selchar_enter(0)), 0, 'locked UI allowed entry');
      await s.shot('rejected');
      assert.equal((await s.pin()).result, 'lock1', 'correct PIN did not recover');
      await s.healthy();
      await s.close();
      return { rejected: true, lockedEntryRefused: true, correctPinRecovered: true };
    });

    await step('classes', async () => {
      const results = [];
      // One class per invocation (--class), preserving the other characters.
      const name = cls === 0 ? A.char : `${A.char.slice(0, 12)}c${cls}`;
      privateValues.push(name);
      let s = await newSession(`class${cls}`, A);
      await s.loginToSelect();
      assert.equal((await s.pin()).result, 'lock1', 'class PIN rejected');
      let slots = await s.slots();
      let slot = slots.findIndex(x => x.name === name);
      let created = false;
      if (slot < 0) {
        assert(slots.some(x => !x.name), 'no empty slot; existing characters preserved');
        await s.create(name, cls);
        created = true;
        slots = await s.slots();
        slot = slots.findIndex(x => x.name === name);
      }
      assert(slot >= 0, 'created character missing');
      const preview = slots[slot];
      assert(preview.human === 1 && preview.maxHp > 0 && preview.equip[0] > 0, 'invalid class preview');
      const me = await s.enter(slot);
      assert.equal(me.name, name, 'wrong class character entered');
      assert.equal(me.characterClass, cls, 'protocol class differs from requested class (requires patch 0007)');
      // CharacterSaveFor deliberately subtracts EquipmentAttributeHP/MP.
      // Selection shows that flat saved score; Field includes equipment. Compare
      // each representation with itself after relogin, not flat vs total HP.
      assert.deepEqual(me.equip, preview.equip.slice(0, 16), 'preview/Field equipment differs');
      await s.shot('field');
      await s.healthy();
      await s.close();
      s = await newSession(`class${cls}-relogin`, A);
      await s.loginToSelect();
      assert.equal((await s.pin()).result, 'lock1', 'relogin PIN rejected');
      const again = (await s.slots())[slot];
      checkPreview(again, preview);
      const relogin = await s.enter(slot);
      assert.equal(relogin.name, name);
      assert.equal(relogin.characterClass, cls);
      assert.equal(relogin.maxHp, me.maxHp, 'Field max HP changed after relogin');
      assert.deepEqual(relogin.equip, me.equip, 'class equipment changed after relogin');
      assert.deepEqual(relogin.look, me.look, 'class appearance changed after relogin');
      checkArmiaSpawn(relogin);
      await s.shot('field');
      await s.healthy();
      await s.close();
      results.push({ requestedClass: cls, slot, created, preview: { ...preview, name: mask(name) },
        me: { ...me, name: mask(name) }, relogin: { ...relogin, name: mask(name) }, persisted: true,
        previewResources: 'flat saved score; excludes equipment attribute HP/MP (CharacterSaveFor)' });
      return { classes: results };
    });

    await step('login', async () => {
      a = await newSession('A', A);
      await a.loginToSelect();
      const pin = await a.pin();
      if (!pin.already && pin.result !== 'lock1') throw new Error(`PIN rejected (${pin.result})`);
      a.preview = (await a.slots())[0];
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
      assert.equal(s0.name, A.char, 'slot 0 belongs to another character');
      assert(s0.human === 1 && s0.maxHp > 0 && s0.equip[0] > 0, 'invalid preview');
      a.preview = s0;
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
      if (!slots[0].name) {
        assert(!phases.has('attack'), 'combat requires an existing B character');
        await b.create(B.char, cls); slots = await b.slots();
      }
      const me = await b.enter(0);
      assert.equal(me.name, B.char, 'B entered the wrong character');
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
      assert(res.nameAinB && res.nameBinA && res.lookMatches, 'remote identity/equipment mismatch');
      assert.deepEqual(aView1.look, bMe1.look, 'B equipment differs in A');
      return res;
    });

    await step('logout', async () => {
      const lastA = await a.me();
      const preview = a.preview;
      await a.healthy();
      await a.close();
      const gone = await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      a = await newSession('A2', A);
      await a.loginToSelect();
      const pin = await a.pin();
      assert.equal(pin.result, 'lock1', 'relogin PIN rejected');
      checkPreview((await a.slots())[0], preview);
      const me = await a.enter(0);
      assert.equal(me.name, lastA.name, 'relogin identity changed');
      assert.deepEqual(me.look, lastA.look, 'relogin equipment changed');
      assert.deepEqual(me.equip, lastA.equip, 'relogin equipment indices changed');
      checkArmiaSpawn(me);
      const back = await b.until('B sees A again', id => Module._wyd_field_human_present(id) === 1, 30000, a.id);
      await a.shot('relogin');
      return { despawnSeenByB: gone === true, pin, lastPosition: [lastA.x, lastA.y],
        reloginPosition: [me.x, me.y], respawnSeenByB: back === true, newId: me.id,
        persistedPreview: true, persistedLook: true, citySpawn: true };
    });

    // Armia -> Armia Field portal (server world/teleport.go: tile block
    // 2140..2143 x 2068..2071 -> 2588,2096, free). The client shows its own
    // confirm box (message 16) on the portal; OK sends ReqTeleport.
    await step('mapchange', async () => {
      // B walks next to the portal (outside its tile block) so its view covers
      // A at the moment of the teleport; otherwise "B loses A" proves nothing.
      const [trail, bTrail] = await Promise.all([
        a.walkToPortal(),
        // Position is secondary; the visibility assertion below decides.
        b.walkTo(2136.5, 2075.5, { near: 4, stallOk: true }),
      ]);
      const box = await a.until('portal confirm box', () => Module._wyd_scene_msgbox_message() === 16, 20000);
      const before = await a.me();
      await b.until('B sees A at the portal', id => Module._wyd_field_human_present(id) === 1, 30000, a.id);
      const bSawBefore = await b.other(a.id);
      assert.equal(bSawBefore.present, 1, 'B does not see A before the teleport');
      await a.shot('portal');
      if ((await a.eval(() => Module._wyd_debug_scene_msgbox_ok())) !== 1) throw new Error('OK refused');
      const after = await a.until('teleported', ([x, y]) => {
        const nx = Module._wyd_field_myhuman_x(), ny = Module._wyd_field_myhuman_y();
        return Math.hypot(nx - x, ny - y) > 50 && { x: nx, y: ny };
      }, 60000, [before.x, before.y]);
      await sleep(4000);
      // Terrain block the client actually loaded (patch 0009). HomeTownX/Y
      // (_wyd_field_map_x/y) is the character's city and survives a teleport.
      Object.assign(after, await a.eval(() => ({
        groundX: Module._wyd_field_ground_index_x(), groundY: Module._wyd_field_ground_index_y(),
        homeBlockX: Module._wyd_field_map_x(), homeBlockY: Module._wyd_field_map_y() })));
      await a.shot('armia-field');
      const bLost = await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      const p = await a.probe();
      checkTeleport(after);
      return { clicks: trail.length, observerClicks: bTrail.length, observerAt: bTrail.at(-1), portalTile: [before.x, before.y], confirmBox: box === true,
        bSawABeforeTeleport: bSawBefore.present === 1, arrived: after,
        nearArmiaField: Math.hypot(after.x - 2588, after.y - 2096) <= 4, bLostA: bLost === true,
        dialect: dialectSummary(p) };
    });

    // Stage 5, skills: level the --class character of account A by real combat
    // until it has the points its cheapest skill costs (skill.go
    // deriveSkillBonus: level*3). Level-ups are the server's (mobkilled.go);
    // progress persists, so a phase cut by the deadline resumes on the next run.
    await step('grind', async () => {
      const name = cls === 0 ? A.char : `${A.char.slice(0, 12)}c${cls}`;
      privateValues.push(name);
      const slot = (await a.slots()).findIndex(x => x.name === name);
      assert(slot >= 0, `class ${cls} character missing`);
      await a.enter(slot);
      const want = Number(opt['grind-level']);
      const s0 = await a.combat(0);
      const res = { class: cls, slot, want, start: { level: s0.myLevel, exp: s0.exp }, kills: [], rests: 0, died: false };
      r.grind = res;
      console.log(`    class ${cls} level ${s0.myLevel} exp ${s0.exp} -> want level ${want}`);
      if (s0.myLevel < want) res.trip = await a.toGremlinField();
      // Leave time for the evidence and a clean logout inside the deadline.
      const end = Date.now() + 19 * 60000;
      const tried = new Set();
      while (Date.now() < end) {
        const s = await a.combat(0);
        if (s.myLevel >= want) break;
        if (s.myDie === 1 || s.myHp <= 0) { res.died = true; break; }
        // Regenerate between fights instead of dying to the next Gremlin.
        if (s.myHp < s.myMaxHp * 0.5) { res.rests++; await sleep(6000); continue; }
        const mob = (await a.mobs()).find(m => m.name.trim() === 'Gremlin' && m.onScreen && m.hp > 0 && !tried.has(m.id));
        if (!mob) { await a.walk(res.kills.length % 2 ? -160 : 160, 80); tried.clear(); continue; }
        tried.add(mob.id);
        const c0 = await a.combat(mob.id);
        const k = { id: mob.id, hpTrail: [c0.hp], exp0: c0.exp, clicks: 0, gone: false };
        let lastClick = 0;
        const fightEnd = Date.now() + 60000;
        while (Date.now() < fightEnd) {
          const c = await a.combat(mob.id);
          if (c.myDie === 1 || c.myHp <= 0) { res.died = true; break; }
          if (!c.present) { k.gone = true; break; }
          if (c.hp !== k.hpTrail.at(-1)) k.hpTrail.push(c.hp);
          if (c.die === 1 || c.hp <= 0) break;
          if (Date.now() - lastClick > 6000) { if (await a.clickHuman(mob.id)) k.clicks++; lastClick = Date.now(); }
          await sleep(1000);
        }
        await sleep(2000);
        const c1 = await a.combat(mob.id);
        k.exp1 = c1.exp;
        k.level = c1.myLevel;
        if (res.died) break;
        // Only server-paid kills count; a Gremlin that walked away is skipped.
        if (k.exp1 > k.exp0) {
          res.kills.push(k);
          console.log(`    kill ${res.kills.length}: Gremlin ${k.id} HP ${k.hpTrail.join(',')} exp ${k.exp0}->${k.exp1} level ${k.level}`);
          await writeFile(join(OUT, 'evidence.json'), evidenceJson(ev));
        }
      }
      const s1 = await a.combat(0);
      res.end = { level: s1.myLevel, exp: s1.exp, hp: s1.myHp, maxHp: s1.myMaxHp };
      res.reached = s1.myLevel >= want;
      res.skillPoints = s1.myLevel * 3; // server-derived rule; spent points not visible here
      await a.shot('grind-end');
      if (res.start.level < want) checkGrind(res);
      assert(res.reached, `level ${s1.myLevel} of ${want} after ${res.kills.length} kills (run again to continue)`);
      return res;
    });

    // Stage 5, skills: the --class character learns its cheapest skill from the
    // class master with real clicks (the NPC, then the skill in the master's
    // grid). The server decides and charges (skill.go learnSkill); the client
    // only sends 0x027B and ApplyBonus. Masters from NPCGener.txt at the locked
    // revision; the list the NPC actually sends is what the check trusts.
    await step('learn', async () => {
      // route: HeightMap + AttributeMap of the locked revision (same search as
      // the east gate); the straight line north of the spawn is blocked.
      const PLANS = { 1: { skill: 5024, name: 'Flecha_Magica', cost: 12, master: [2094, 2126], npcName: /foema|ancia/i,
        route: [[2088.5, 2111.5], [2088.5, 2116.5], [2090.5, 2122.5]] } };
      const plan = PLANS[cls];
      assert(plan, `no learn plan for class ${cls}`);
      const name = cls === 0 ? A.char : `${A.char.slice(0, 12)}c${cls}`;
      privateValues.push(name);
      const enterOwn = async s => {
        const slot = (await s.slots()).findIndex(x => x.name === name);
        assert(slot >= 0, `class ${cls} character missing`);
        return s.enter(slot);
      };
      if ((await a.eval(() => Module._wyd_get_game_state())) !== 0) await enterOwn(a);
      const read = s => s.eval(() => ({ learned: Module._wyd_field_my_score(6) >>> 0,
        bonus: Module._wyd_field_my_skill_bonus(), level: Module._wyd_field_my_score(4) }));
      const before = await read(a);
      console.log(`    level ${before.level}, ${before.bonus} skill points, learned 0x${before.learned.toString(16)}`);
      assert(before.bonus >= plan.cost, `${before.bonus} skill points at level ${before.level}; ${plan.name} costs ${plan.cost}`);
      const walk = [];
      for (const [x, y] of plan.route) walk.push(...await a.walkTo(x, y, { near: 2, stallOk: true }));
      const at = await a.me();
      // By name: a plain merchant stands next to the master (first run clicked
      // it and got ShopType 1). The generator name is Foema_Ancian.
      const near = (await a.mobs()).filter(m => Math.hypot(m.x - at.x, m.y - at.y) <= 15);
      const npc = near.find(m => plan.npcName.test(m.name));
      assert(npc, `class master not in view from ${at.x},${at.y}: ${near.map(m => `${m.id} ${m.name.trim()} ${m.x},${m.y}`).join('; ')}`);
      let visible = false;
      const clicks = [];
      for (let i = 0; i < 3 && !visible; i++) {
        const hit = await a.clickHuman(npc.id);
        clicks.push({ hit, lastSent: await a.eval(() => window.clientProbe().socket.lastSentOpcode) });
        if (!hit) continue;
        try { visible = await a.until('skill master window', () => Module._wyd_field_skillmaster_visible() === 1, 15000); }
        catch { visible = false; }
      }
      await a.shot('master-click');
      assert(visible, `skill master window did not open (at ${at.x},${at.y}, npc ${npc.id} at ${npc.x},${npc.y}, clicks ${JSON.stringify(clicks)})`);
      await a.frames(3);
      const offered = await a.eval(() => {
        const o = [];
        for (let k = 0; k < 128; k++) { const i = Module._wyd_field_skillmaster_item(k); if (i) o.push(i); }
        return o;
      });
      const merchant = await a.eval(() => Module._wyd_field_skillmaster_merchant());
      await a.shot('skill-master');
      const k = offered.length ? await a.eval(sk => {
        for (let k = 0; k < 128; k++) if (Module._wyd_field_skillmaster_item(k) === sk) return k;
        return -1;
      }, plan.skill) : -1;
      assert(k >= 0, `master did not offer ${plan.skill} (offered ${offered.join(',')})`);
      const [sx, sy, cw, ch] = await a.eval(k => {
        const c = document.getElementById('canvas');
        return [Module._wyd_field_skillmaster_item_screen(k, 0), Module._wyd_field_skillmaster_item_screen(k, 1), c.width, c.height];
      }, k);
      assert(sx >= 0 && sy >= 0, 'skill cell not laid out');
      // Real left click on the drawn cell (SGridControl GRID_SKILLM -> box 4).
      const cb = await a.page.locator('#canvas').boundingBox();
      await a.page.mouse.move(cb.x + sx * cb.width / cw, cb.y + sy * cb.height / ch, { steps: 3 });
      await a.frames(2);
      await a.page.mouse.down();
      try { await a.frames(2); } finally { await a.page.mouse.up(); }
      await a.frames(2);
      const box = await a.eval(() => Module._wyd_scene_msgbox_message());
      await a.shot('learn-box');
      assert.equal(box, 4, `learn box did not open (box ${box}, cursor cell ${sx},${sy})`);
      assert.equal(await a.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'OK refused');
      const bit = (plan.skill - 5000) % 24;
      await a.until('learned bit from the server', b => ((Module._wyd_field_my_score(6) >>> b) & 1) === 1, 20000, bit);
      await sleep(2000);
      const after = await read(a);
      console.log(`    learned 0x${after.learned.toString(16)}, ${after.bonus} skill points left`);
      await a.page.keyboard.press('Escape');
      await a.healthy();
      await a.close();
      a = await newSession('A-learn-relogin', A);
      await a.loginToSelect();
      assert.equal((await a.pin()).result, 'lock1', 'relogin PIN rejected');
      await enterOwn(a);
      const relogin = await read(a);
      const res = { skill: plan.skill, name: plan.name, cost: plan.cost, npc: npc.id, npcAt: [npc.x, npc.y],
        walkClicks: walk.length, merchant, offered, box, before, after, relogin };
      r.learn = res;
      checkLearn(res);
      return res;
    });

    // Stage 5, skills: use the learned skill. Assignment is the original
    // gesture (skill window "S", hover the skill, Shift+1 -> 0x0378), the slot
    // is selected with the real "1" key and the cast is a real right click on a
    // Gremlin (TMFieldScene SkillUse). MP and damage are the server's.
    await step('cast', async () => {
      const PLANS = { 1: { skill: 24, pos: 0, name: 'Flecha_Magica' } };
      const plan = PLANS[cls];
      assert(plan, `no cast plan for class ${cls}`);
      const name = cls === 0 ? A.char : `${A.char.slice(0, 12)}c${cls}`;
      privateValues.push(name);
      if ((await a.eval(() => Module._wyd_get_game_state())) !== 0) {
        const slot = (await a.slots()).findIndex(x => x.name === name);
        assert(slot >= 0, `class ${cls} character missing`);
        await a.enter(slot);
      }
      const learned = await a.eval(() => Module._wyd_field_my_score(6) >>> 0);
      assert(((learned >>> plan.pos) & 1) === 1, `skill ${plan.skill} not learned (run learn first)`);
      const trip = await a.toGremlinField();
      const res = { cls, pos: plan.pos, skill: plan.skill, name: plan.name, slot: 0, trip, attempts: 0 };
      r.cast = res;
      // Assign: open the skill window with the real "s" key, hover the cell.
      await a.closePanels();
      await a.page.focus('#canvas');
      await a.page.keyboard.press('s');
      await a.until('skill window', () => Module._wyd_field_skill_panel_visible() === 1, 10000);
      await a.frames(3);
      const [cx, cy, cw, ch, cell] = await a.eval(i => {
        const c = document.getElementById('canvas');
        return [Module._wyd_field_skill_cell_screen(i, 0), Module._wyd_field_skill_cell_screen(i, 1), c.width, c.height,
          Module._wyd_field_skill_cell_item(i)];
      }, plan.pos);
      res.cell = cell;
      assert(cx >= 0 && cy >= 0, 'skill cell not laid out');
      const cb = await a.page.locator('#canvas').boundingBox();
      await a.page.mouse.move(cb.x + cx * cb.width / cw, cb.y + cy * cb.height / ch, { steps: 3 });
      await a.frames(2);
      await a.page.keyboard.press('Shift+Digit1');
      await a.frames(3);
      res.belt = await a.eval(() => Module._wyd_field_short_skill(0));
      res.lastSentAfterAssign = await a.eval(() => window.clientProbe().socket.lastSentOpcode);
      await a.shot('skill-assigned');
      await a.page.keyboard.press('s');
      await a.frames(2);
      await a.page.keyboard.press('Digit1');
      await a.frames(2);
      res.selected = await a.eval(() => Module._wyd_field_selected_short_skill());
      console.log(`    cell ${cell}, belt[0] ${res.belt}, selected ${res.selected}, last sent 0x${res.lastSentAfterAssign.toString(16)}`);
      // Cast on the nearest live Gremlin with real right clicks.
      let mob;
      for (let i = 0; i < 4 && !mob; i++) {
        mob = (await a.mobs()).find(m => m.name.trim() === 'Gremlin' && m.onScreen && m.hp > 0);
        if (!mob) await a.walk(i % 2 ? -160 : 160, 80);
      }
      assert(mob, 'no live Gremlin on screen');
      const c0 = await a.combat(mob.id);
      res.target = { id: mob.id, distance: Math.round(mob.d) };
      res.mpTrail = [c0.myMp];
      res.hpTrail = [c0.hp];
      res.died = false;
      const end = Date.now() + 60000;
      let lastCast = 0;
      while (Date.now() < end) {
        const c = await a.combat(mob.id);
        if (c.myMp !== res.mpTrail.at(-1)) res.mpTrail.push(c.myMp);
        if (c.present && c.hp !== res.hpTrail.at(-1)) res.hpTrail.push(c.hp);
        if (c.myDie === 1 || c.myHp <= 0) { res.died = true; break; }
        if (!c.present || c.die === 1 || c.hp <= 0) break;
        if (Math.min(...res.mpTrail) < res.mpTrail[0] && res.hpTrail.at(-1) < res.hpTrail[0]) break;
        if (Date.now() - lastCast > 4000 && res.attempts < 6) {
          if (await a.clickHuman(mob.id, 'right')) res.attempts++;
          lastCast = Date.now();
        }
        await sleep(500);
      }
      await sleep(2000);
      const c1 = await a.combat(mob.id);
      if (c1.myMp !== res.mpTrail.at(-1)) res.mpTrail.push(c1.myMp);
      res.attacksSent = c1.outAttack - c0.outAttack;
      res.echoes = c1.inAttack - c0.inAttack;
      await a.shot('cast');
      console.log(`    cast x${res.attempts}: MP ${res.mpTrail.join(',')} target HP ${res.hpTrail.join(',')} sent ${res.attacksSent} echoes ${res.echoes}`);
      checkCast(res);
      return res;
    });

    // Stage 5, slice 2: A dies to the Armia Field Trolls (the portal route that
    // killed the starter character in the first combat run) and returns to town
    // through the runtime's own box 11 -> 0x03AE -> 0x0289. B waits at the
    // Armia spawn and must see A come back. Death, revival HP and the city
    // spawn are all decided by the server (mobai.go, character.go restart).
    await step('death', async () => {
      const c0 = await a.combat(0);
      const before = { level: c0.myLevel, exp: c0.exp, hp: c0.myHp, maxHp: c0.myMaxHp };
      // Baseline before the portal: the Trolls can kill a starter character
      // during toArmiaField's post-teleport wait (first death run: mobHits 0).
      const hits0 = c0.inAttack;
      const trip = await a.toArmiaField();
      await sample('death: A in Armia Field');
      const hpTrail = [c0.myHp];
      let dead, approaches = 0, lastApproach = Date.now();
      const end = Date.now() + 180000;
      while (Date.now() < end) {
        const c = await a.combat(0);
        if (c.myHp !== hpTrail.at(-1)) hpTrail.push(c.myHp);
        if (c.myHp <= 0 || c.myDie === 1) { dead = c; break; }
        // Trolls aggro on sight; if none has after a while, step next to the
        // nearest live mob with a real ground click. A never attacks.
        if (Date.now() - lastApproach > 20000) {
          const mob = (await a.mobs()).find(m => m.hp > 0);
          if (mob) { approaches++; await a.walkTo(mob.x, mob.y, { near: 2, maxClicks: 3, stallOk: true }); }
          lastApproach = Date.now();
        }
        await sleep(1000);
      }
      assert(dead, `A did not die within 3 minutes (HP ${hpTrail.join(',')})`);
      console.log(`    A died: HP ${hpTrail.join(',')}`);
      await sleep(2000);
      await a.shot('dead');
      // A left click on the field while dead opens box 11 (TMFieldScene
      // OnMouseEvent); a Troll under the cursor is skipped, not clicked.
      let box = 0;
      for (const [dx, dy] of [[0, 120], [-160, 60], [160, 60], [0, -120], [120, 120], [-120, 120]]) {
        try { await a.clickGround(dx, dy); }
        catch (e) { if (String(e.message).includes('overlaps entity')) continue; throw e; }
        box = await a.eval(() => Module._wyd_scene_msgbox_message());
        if (box === 11) break;
      }
      await a.shot('return-box');
      const at0 = await a.me();
      assert.equal(await a.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'OK refused');
      // The runtime sends 0x03AE now and 0x0289 about 5 s later; record the
      // sequence of last-sent opcodes until the server's recall moves A.
      const sent = [];
      let moved;
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const op = '0x' + (await a.eval(() => window.clientProbe().socket.lastSentOpcode)).toString(16).padStart(4, '0');
        if (sent.at(-1) !== op) sent.push(op);
        const me = await a.me();
        if (Math.hypot(me.x - at0.x, me.y - at0.y) > 50) { moved = me; break; }
        await sleep(100);
      }
      assert(moved, `no recall within 30 s (sent ${sent.join(',')})`);
      await sleep(3000);
      const c1 = await a.combat(0);
      const after = { ...(await a.me()), hp: c1.myHp, maxHp: c1.myMaxHp, die: c1.myDie, level: c1.myLevel, exp: c1.exp };
      const sawRespawn = (await b.until('B sees A back in town', id => Module._wyd_field_human_present(id) === 1,
        30000, a.id)) === true;
      await a.shot('respawned');
      await b.shot('respawn-observer');
      const res = { before, trip, hpTrail, hpAtDeath: dead.myHp, mobHits: dead.inAttack - hits0, approaches,
        died: true, box, sent, firstHpAfterRecall: moved.hp, after, observer: { sawRespawn, at: await b.me() } };
      r.death = res;
      checkRespawn(res);
      return res;
    });

    // Stage 5, slice 1: A attacks a Gremlin with real clicks; B, in
    // the same field, watches. Every number comes from the server: damage via
    // the 0x0367 broadcast, experience/gold via the echo and UpdateEtc.
    await step('attack', async () => {
      const [aTrip, bTrip] = await Promise.all([a.toGremlinField(), b.toGremlinField()]);
      await sample('attack: both at Gremlins');
      r.attack = { aTrip, bTrip, attempts: [] };
      const tried = [];
      let res;
      for (let pick = 0; pick < 3 && !res; pick++) {
        let mob;
        for (let i = 0; i < 4 && !mob; i++) {
          mob = (await a.mobs()).find(m => m.name.trim() === 'Gremlin' && m.onScreen &&
            m.hp > 0 && m.maxHp > 0 && !tried.some(t => t.target.id === m.id));
          if (!mob) await a.walk(i % 2 ? -160 : 160, 80);
        }
        assert(mob, `no live Gremlin on screen (tried ${tried.length})`);
        if ((await b.combat(mob.id)).present !== 1) {
          const at = await a.me();
          await b.walkTo(at.x, at.y, { near: 3 });
        }
        await b.until('B sees combat target', id => Module._wyd_field_human_present(id) === 1, 30000, mob.id);
        const c0 = await a.combat(mob.id);
        const b0 = await b.combat(mob.id);
        assert(c0.myHp > 0 && c0.myDie !== 1, 'attacker dead before first input');
        assert(c0.present === 1 && c0.hp > 0 && b0.present === 1 && b0.hp > 0, 'target unavailable before attack');
        const bSees = (await b.eval(i => Module._wyd_field_human_present(i), mob.id)) === 1;
        const bTrail = [b0.hp];
        const hpTrail = [c0.hp];
        console.log(`    target ${mob.id} Gremlin: HP ${c0.hp}, observer HP ${b0.hp}`);
        let clicks = 0, lastClick = 0, killed = false, lost = false, died = false, bKill = false;
        const end = Date.now() + 150000;
        while (Date.now() < end) {
          const c = await a.combat(mob.id);
          const v = await b.combat(mob.id);
          if (v.present) {
            if (v.hp !== bTrail.at(-1)) bTrail.push(v.hp);
            if (v.die === 1 || v.hp <= 0) bKill = true;
          }
          if (c.myDie === 1 || c.myHp <= 0) { died = true; break; }
          if (!c.present) { lost = hpTrail.at(-1) > 0; killed = !lost; break; }
          if (c.hp !== hpTrail.at(-1)) hpTrail.push(c.hp);
          if (c.die === 1 || c.hp <= 0) { killed = true; break; }
          if (c.hp < c0.hp && bTrail.at(-1) < b0.hp &&
              c.outAttack > c0.outAttack && c.inAttack > c0.inAttack && v.inAttack > b0.inAttack) break;
          // One click per intent; the runtime paces its own swings. Re-click
          // only when the target is still alive after a while (auto-attack
          // stops when the target leaves reach).
          if (Date.now() - lastClick > 6000) {
            if (await a.clickHuman(mob.id)) clicks++;
            lastClick = Date.now();
          }
          // Target never loses HP after several server echoes: not attackable
          // (NonCombatNPC gets 0 damage). Try another one.
          const now = await a.combat(mob.id);
          if (clicks >= 3 && now.inAttack - c0.inAttack >= 3 && hpTrail.length === 1 && now.outAttack > c0.outAttack) break;
          await sleep(1000);
        }
        await sleep(3000);
        const c1 = await a.combat(mob.id);
        if (bSees && !bKill) {
          const v = await b.combat(mob.id);
          if (v.present) {
            if (v.hp !== bTrail.at(-1)) bTrail.push(v.hp);
            if (v.die === 1 || v.hp <= 0) bKill = true;
          }
        }
        if (c1.myDie === 1 || c1.myHp <= 0) died = true;
        if (c1.present) {
          if (c1.hp !== hpTrail.at(-1)) hpTrail.push(c1.hp);
          if (c1.die === 1 || c1.hp <= 0) killed = true;
        } else if (!killed) lost = true;
        const r1 = {
          target: { id: mob.id, name: mob.name, maxHp: mob.maxHp, distance: Math.round(mob.d) },
          clicks, attacksSent: c1.outAttack - c0.outAttack, echoes: c1.inAttack - c0.inAttack,
          hpTrail, killed, lost, died, exp0: c0.exp, exp1: c1.exp, coin0: c0.coin, coin1: c1.coin,
          learnedSkill: c0.learnedSkill.toString(16), myClass: c0.myClass,
          level: [c0.myLevel, c1.myLevel], myHp: [c0.myHp, c1.myHp], myMp: [c0.myMp, c1.myMp],
          observer: { sawTarget: bSees, hpTrail: bTrail, sawKill: bKill,
            echoes: (await b.combat(mob.id)).inAttack - b0.inAttack },
        };
        tried.push(r1);
        r.attack.attempts = tried;
        await writeFile(join(OUT, 'evidence.json'), evidenceJson(ev));
        await a.shot(`attack-${pick}`);
        if (bSees) await b.shot(`attack-${pick}`);
        if (died || killed || hpTrail.length > 1) res = r1;
      }
      assert(res, `no target took damage: ${JSON.stringify(tried.map(t => ({ n: t.target.name, e: t.echoes, s: t.attacksSent })))}`);
      await sample('attack: after combat');
      try { checkCombat(res); } catch (error) { throw Object.assign(error, { combat: { result: res, tried } }); }
      // A ground click cancels auto-attack; only server-confirmed state is saved.
      await a.walk(0, 100);
      const last = await a.me();
      const score = await a.combat(res.target.id);
      assert(score.myDie !== 1 && score.myHp > 0, 'attacker died before relogin');
      const before = { ...last, level: score.myLevel, exp: score.exp };
      await a.healthy();
      await a.close();
      await b.until('B loses A after combat', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      // B's part (observer, A's departure) is over: close it so the relogin
      // runs with a single game page, the scenario's memory peak otherwise.
      // Its final dialect summary is kept before the page goes away.
      await b.healthy();
      ev.final_B = dialectSummary(await b.probe());
      await b.close();
      await sample('attack: B closed, before relogin');
      a = await newSession('A-combat-relogin', A);
      await a.loginToSelect();
      assert.equal((await a.pin()).result, 'lock1', 'post-combat PIN rejected');
      const again = await a.enter(0);
      const againScore = await a.combat(0);
      const after = { ...again, level: againScore.myLevel, exp: againScore.exp };
      checkCombatRelogin(before, after);
      await a.shot('post-combat-relogin');
      return { aTrip, bTrip, result: res, tried: tried.length,
        relogin: { before, after, persisted: true },
        panelsClosed: { A: a.panelsClosed ?? [], B: b.panelsClosed ?? [] } };
    });

    await step('concurrent', async () => {
      // B is unnecessary here; keep only the two connections under test alive.
      if (b?.context) { await b.healthy(); await b.close(); }
      const c = await newSession('A-concurrent', A);
      // dbserver AccountLogin at the pinned SHA has no duplicate-session guard.
      await c.loginToSelect();
      const second = await c.probe();
      const first = await a.probe();
      assert.equal(second.state, STATE.SELECT_CHAR, 'duplicate login behavior differs from pinned backend');
      assert.equal(first.state, STATE.FIELD, 'first session left Field during duplicate login');
      await a.healthy();
      await c.healthy();
      await c.shot('concurrent');
      await c.close();
      await sleep(2000);
      const firstAfter = await a.probe();
      assert.equal(firstAfter.state, STATE.FIELD, 'closing duplicate removed original Field');
      // Require a new server entity after duplicate close, not a stale Field
      // image or an assumption that an idle server emits periodic packets.
      const observer = await newSession('B-after-concurrent', B);
      await observer.loginToSelect();
      assert.equal((await observer.pin()).result, 'lock1', 'observer PIN rejected');
      const observerMe = await observer.enter(0);
      assert.equal(observerMe.name, B.char, 'wrong observer character');
      await a.until('original sees observer after duplicate close', id => Module._wyd_field_human_present(id) === 1,
        30000, observer.id);
      assert.equal((await a.other(observer.id)).name, B.char, 'stale entity after duplicate close');
      await a.healthy();
      await observer.healthy();
      await observer.close();
      return { secondState: second.state, secondLastRecv: '0x' + second.socket.lastRecvOpcode.toString(16),
        firstStateDuring: first.state, firstStateAfter: firstAfter.state,
        duplicateAccepted: true, originalStillReceives: true,
        backendLimitation: 'Duplicate account login accepted; shared cargo replaced/released. No inventory mutations tested.' };
    });
    ev.ok = Object.values(r).every(x => x.ok);
  } catch (e) {
    ev.error = redact(interrupted ?? e?.message ?? e);
    if (e?.res) ev.partial = e.res;
  } finally {
    for (const s of sessions) {
      try { if (s.context) ev[`final_${s.label}`] = dialectSummary(await s.probe()); } catch {}
    }
    ev.pageErrors = Object.fromEntries(sessions.map(s => [s.label, s.pageErrors]));
    ev.screenshots = sessions.flatMap(s => s.shots);
    for (const s of sessions) { try { await s.close(); } catch {} }
    try { await browser?.close(); } catch (e) {
      ev.ok = false;
      ev.cleanupError = redact(e?.message ?? e);
    } finally { gw?.proc.kill(); }
    clearTimeout(deadline);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    ev.gatewayLog = sanitizeGatewayLog(gw?.logs ?? []);
  }
  // Never let a credential reach the evidence file.
  const text = evidenceJson(ev);
  // One file per run: a later run must not overwrite an earlier result.
  const path = join(OUT, 'evidence.json');
  await writeFile(path, text);
  console.log(JSON.stringify({ ok: ev.ok, error: ev.error, evidence: path }, null, 1));
  process.exit(ev.ok ? 0 : 1);
}

main().catch(e => { console.error(e?.message ?? e); process.exit(2); });
