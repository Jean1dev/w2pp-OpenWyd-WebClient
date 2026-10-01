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
//   castarea  TK hits two Gremlins in one result, B observes, then A relogs
//   cast      the --class character assigns its learned skill (hover + Shift+1) and casts it on a Gremlin
//   death     A dies to the Armia Field Trolls, returns to town (box 11, 0x03AE/0x0289); B at the spawn sees it
//   trade     A trades an item and gold to B by the original window; refusal, check reset, cancel, relogin, return
//   delete    B creates a throwaway character, a wrong password is refused, the right one deletes it; relogin
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
import { areaPair, checkAreaAttempt } from './area_checks.mjs';
import { checkParty, checkPartyEvidence } from './party_checks.mjs';
import { checkTradeSwap, checkTradeReset, checkTradeEvidence, checkTradeEdge, sellPrice, checkDelete } from './trade_checks.mjs';
import { validateOptions, checkHealth, checkPreview, checkArmiaSpawn, checkTeleport, checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast, redactEvidence,
  checkEquip, checkPotion, checkLoot, checkShop, checkBank, checkPaidTeleport, checkChat, itemAmount } from './world_checks.mjs';

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
    // The server teleports from the tile A stands on when 0x0290 arrives
    // (movement.go reqTeleport) and ignores the request silently elsewhere.
    // A walk that overshoots the portal after the box opened is retried.
    const trail = [];
    this.portalAttempts = [];
    for (let attempt = 0; ; attempt++) {
      trail.push(...await this.walkToPortal());
      await this.until('portal confirm box', () => Module._wyd_scene_msgbox_message() === 16, 20000);
      const before = await this.me();
      if ((await this.eval(() => Module._wyd_debug_scene_msgbox_ok())) !== 1) throw new Error(`${this.label}: OK refused`);
      const moved = await this.until('teleported', ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x,
        Module._wyd_field_myhuman_y() - y) > 50, attempt < 2 ? 20000 : 60000, [before.x, before.y]).catch(e => {
        if (attempt >= 2) throw e;
        return false;
      });
      this.portalAttempts.push({ at: [before.x, before.y], teleported: !!moved });
      if (moved) break;
      console.log(`    ${this.label}: no teleport from ${before.x},${before.y}; back to the portal`);
    }
    await sleep(4000);
    const at = await this.me();
    checkTeleport({ ...at, ...Object.fromEntries((await this.ground()).map((v, i) => [i ? 'groundY' : 'groundX', v])) });
    return { clicks: trail.length, at, portalAttempts: this.portalAttempts };
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
  async clickHuman(id, button = 'left', beforePress) {
    await this.closePanels();
    const box = await this.page.locator('#canvas').boundingBox();
    for (let attempt = 0; attempt < 4; attempt++) {
      const [sx, sy, cw, ch] = await this.eval(i => {
        const c = document.getElementById('canvas');
        return [Module._wyd_field_human_screen(i, 0), Module._wyd_field_human_screen(i, 1), c.width, c.height];
      }, id);
      if (sx < 0) return false;
      // The chest projection sits above the pick volume's center: aim lower,
      // then sideways (a neighbouring NPC or player can cover the center).
      for (const [ox, oy] of [[0, 0], [0, 20], [0, 40], [-14, 20], [14, 20], [-14, 40], [14, 40]]) {
        await this.page.mouse.move(box.x + (sx + ox) * box.width / cw, box.y + (sy + oy) * box.height / ch, { steps: 3 });
        await this.frames(2);
        if ((await this.eval(() => Module._wyd_field_hover_human_id())) !== id) continue;
        if (beforePress && !(await beforePress())) return false;
        await this.page.mouse.down({ button });
        try { await this.frames(2); } finally { await this.page.mouse.up({ button }); }
        await this.frames(1);
        return true;
      }
    }
    return false;
  }

  async assignSkill(plan) {
    const res = {};
    // Assign: open the skill window with the real "s" key, hover the cell.
    await this.closePanels();
    await this.page.focus('#canvas');
    await this.page.keyboard.press('s');
    await this.until('skill window', () => Module._wyd_field_skill_panel_visible() === 1, 10000);
    await this.frames(3);
    const [cx, cy, cw, ch, cell] = await this.eval(i => {
      const c = document.getElementById('canvas');
      return [Module._wyd_field_skill_cell_screen(i, 0), Module._wyd_field_skill_cell_screen(i, 1), c.width, c.height,
        Module._wyd_field_skill_cell_item(i)];
    }, plan.pos);
    res.cell = cell;
    assert(cx >= 0 && cy >= 0, 'skill cell not laid out');
    const cb = await this.page.locator('#canvas').boundingBox();
    await this.page.mouse.move(cb.x + cx * cb.width / cw, cb.y + cy * cb.height / ch, { steps: 3 });
    await this.frames(2);
    await this.page.keyboard.press('Shift+Digit1');
    await this.frames(3);
    res.belt = await this.eval(() => Module._wyd_field_short_skill(0));
    res.lastSentAfterAssign = await this.eval(() => window.clientProbe().socket.lastSentOpcode);
    await this.shot('skill-assigned');
    await this.page.keyboard.press('s');
    await this.frames(2);
    await this.page.keyboard.press('Digit1');
    await this.frames(2);
    res.selected = await this.eval(() => Module._wyd_field_selected_short_skill());
    console.log(`    cell ${cell}, belt[0] ${res.belt}, selected ${res.selected}, last sent 0x${res.lastSentAfterAssign.toString(16)}`);
    return res;
  }

  combatLog() {
    return this.eval(() => {
      const read = dir => Array.from({ length: Module._wyd_combat_count(dir) }, (_, i) => {
        const v = f => Module._wyd_combat_value(dir, i, f);
        return { sequence: v(0), attacker: v(1), skill: v(2), progress: v(3), hp: v(4), mp: v(5),
          exp: ((BigInt(v(7) >>> 0) << 32n) + BigInt(v(6) >>> 0)).toString(), x: v(8), y: v(9),
          targets: Array.from({ length: v(10) }, (_, j) => ({ id: v(11 + 2*j), damage: v(12 + 2*j) })) };
      });
      return { in: read(0), out: read(1), lost: Module._wyd_combat_lost(0) + Module._wyd_combat_lost(1) };
    });
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

  // Own slots as the client holds them: the 0x0114 snapshot corrected by the
  // server's 0x0376 echoes and 0x0182 slot updates; coin from 0x0337, score
  // (HP/MP, Damage/Ac) from 0x0336/0x0181. Index + effect pairs per slot.
  bag() {
    return this.eval(() => {
      const slot = (place, s) => ({ index: Module._wyd_debug_my_item(place, s),
        ef: [0, 1, 2].map(k => [Module._wyd_debug_my_item_ef(place, s, k, 0), Module._wyd_debug_my_item_ef(place, s, k, 1)]) });
      return { equip: Array.from({ length: 16 }, (_, s) => slot(0, s)),
        carry: Array.from({ length: 64 }, (_, s) => slot(1, s)),
        coin: Module._wyd_field_my_score(5), level: Module._wyd_field_my_score(4), exp: Module._wyd_field_my_exp(),
        hp: Module._wyd_field_my_score(0), maxHp: Module._wyd_field_my_score(1),
        mp: Module._wyd_field_my_score(2), maxMp: Module._wyd_field_my_score(3),
        damage: Module._wyd_field_my_attack(0), ac: Module._wyd_field_my_attack(1) };
    });
  }

  party() {
    return this.eval(() => Array.from({ length: Module._wyd_field_party_count() }, (_, row) => {
      const id = Module._wyd_field_party_value(row, 0);
      return { id, state: Module._wyd_field_party_value(row, 1), level: Module._wyd_field_party_value(row, 2),
        member: Module._wyd_field_party_member(id), x: Module._wyd_field_party_value(row, 4), y: Module._wyd_field_party_value(row, 5) };
    }));
  }

  async uiButton(id) {
    await this.frames(2);
    const p = await this.eval(id => [Module._wyd_field_button_screen(id, 0), Module._wyd_field_button_screen(id, 1)], id);
    assert(p.every(n => n >= 0), `${this.label}: control ${id} not visible`);
    await this.clickCanvas(...p);
  }

  // Hover B and open its player menu (Ctrl + right click), as a player would.
  async openPlayerMenu(other, tag) {
    await this.closePanels();
    await this.until(`${tag} target visible`, id => Module._wyd_field_human_present(id) === 1, 30000, other.id);
    // NPCs crowd the spawn; approach B so its pick volume is on screen and unobstructed.
    const seen = await this.other(other.id), me = await this.me();
    if (Math.hypot(seen.x - me.x, seen.y - me.y) > 3)
      await this.walkTo(seen.x, seen.y, { near: 2, maxClicks: 8, stallOk: true });
    // Ctrl only once hover confirms B: closePanels/hover must not run with Ctrl held.
    // If B's pick volume stays covered (NPC crowd, A on top of it), step around B.
    let ctrl = false;
    try {
      let picked = false;
      for (const [dx, dy] of [[0, 0], [-3, 2], [3, 2], [0, -3]]) {
        if (dx || dy) {
          const at = await this.other(other.id);
          await this.walkTo(at.x + dx, at.y + dy, { near: 1, maxClicks: 6, stallOk: true });
        }
        picked = await this.clickHuman(other.id, 'right', async () => {
          await this.page.keyboard.down('Control'); ctrl = true; await this.frames(1); return true;
        });
        if (picked) break;
      }
      if (!picked) {
        await this.shot(`${tag}-pick-failed`);
        throw new Error(`${tag} target not picked: ${JSON.stringify({ me: await this.me(), other: await this.other(other.id),
          screen: await this.eval(i => [Module._wyd_field_human_screen(i, 0), Module._wyd_field_human_screen(i, 1)], other.id),
          hover: await this.eval(() => Module._wyd_field_hover_human_id()) })}`);
      }
    } finally { if (ctrl) await this.page.keyboard.up('Control'); }
    await this.until('player menu', id => Module._wyd_field_party_menu_target() === id, 15000, other.id);
  }
  async inviteParty(other) {
    await this.openPlayerMenu(other, 'party');
    await this.uiButton(641);
    await other.until('party invitation', id => Module._wyd_field_party_count() === 1 &&
      Module._wyd_field_party_value(0, 0) === id && Module._wyd_field_party_value(0, 1) === 1, 30000, this.id);
  }

  async partyRow(id, ctrl = false) {
    const row = (await this.party()).find(r => r.id === id);
    assert(row, 'party row missing');
    if (ctrl) await this.page.keyboard.down('Control');
    try { await this.clickCanvas(row.x, row.y); }
    finally { if (ctrl) await this.page.keyboard.up('Control'); }
  }

  async waitParty(ids, leader) {
    await this.until('confirmed party rows', ({ ids, leader }) => {
      if (Module._wyd_field_party_count() !== ids.length) return false;
      const seen = new Set();
      for (let k = 0; k < ids.length; ++k) {
        const id = Module._wyd_field_party_value(k, 0);
        if (!ids.includes(id) || seen.has(id) || Module._wyd_field_party_value(k, 1) !== (id === leader ? 2 : 0)) return false;
        seen.add(id);
      }
      return true;
    }, 30000, { ids, leader });
    const rows = await this.party();
    checkParty(rows, ids, leader);
    return rows;
  }

  // The original trade window as drawn: fields of patch 0020.
  trade() {
    return this.eval(() => ({
      visible: Module._wyd_field_trade_value(0), opponent: Module._wyd_field_trade_value(1),
      myCheck: Module._wyd_field_trade_value(2), opCheck: Module._wyd_field_trade_value(3),
      myMoney: Module._wyd_field_trade_value(4), opMoney: Module._wyd_field_trade_value(5),
      my: Array.from({ length: 15 }, (_, k) => Module._wyd_field_trade_item(0, k)),
      op: Array.from({ length: 15 }, (_, k) => Module._wyd_field_trade_item(1, k)),
      carryPos: Array.from({ length: 15 }, (_, k) => Module._wyd_field_trade_item(2, k)),
    }));
  }
  // Player menu -> Trade (643). The partner gets box 601 from the forwarded 0x0383.
  async requestTrade(other) {
    await this.openPlayerMenu(other, 'trade');
    await this.uiButton(643);
    await other.until('trade request box', () => Module._wyd_scene_msgbox_message() === 601, 30000);
  }

  // The inventory window with the real "i" key (OnKeyVisibleInven), page 0.
  async openInventory() {
    await this.closePanels();
    await this.page.focus('#canvas');
    await this.page.keyboard.press('i');
    await this.until('inventory open', () => (Module._wyd_field_open_panels() & 128) !== 0, 10000);
    await this.frames(3);
    assert.equal(await this.eval(() => Module._wyd_field_inv_page()), 0, 'inventory not on page 0');
  }

  // Canvas center of an equip slot (place 0) or a carry cell (place 1) on the
  // visible page, in page coordinates.
  async cellPoint({ place, slot }) {
    const [x, y, cw, ch] = await this.eval(([p, s]) => {
      const c = document.getElementById('canvas');
      const at = w => p === 0 ? Module._wyd_field_equip_cell_screen(s, w)
        : p === 2 ? Module._wyd_field_cargo_cell_screen(Math.floor(s / 40), s % 40 % 5, Math.floor(s % 40 / 5), w)
        : Module._wyd_field_inv_cell_screen(Math.floor(s / 15), s % 15 % 5, Math.floor(s % 15 / 5), w);
      return [at(0), at(1), c.width, c.height];
    }, [place, slot]);
    assert(x >= 0 && y >= 0, `${this.label}: cell ${place}/${slot} not on screen`);
    const box = await this.page.locator('#canvas').boundingBox();
    return [box.x + x * box.width / cw, box.y + y * box.height / ch];
  }

  async clickCell(where, button = 'left') {
    const [x, y] = await this.cellPoint(where);
    await this.page.mouse.move(x, y, { steps: 3 });
    await this.frames(2);
    await this.page.mouse.down({ button });
    try { await this.frames(2); } finally { await this.page.mouse.up({ button }); }
    await this.frames(2);
  }

  cursorItem() { return this.eval(() => Module._wyd_field_cursor_item()); }
  outTranslated() { return this.eval(() => window.clientProbe().dialect.outTranslated); }

  // The original gesture (SGrid.cpp): a click picks the item up onto the
  // cursor, a click on the destination sends 0x0376. The runtime moves
  // nothing itself; OnPacketSwapItem applies the server's echo.
  async moveItem(from, to) {
    const bag = await this.bag();
    const expect = from.place === 2 ? await this.eval(s => Module._wyd_debug_cargo_item(s), from.slot)
      : bag[from.place === 0 ? 'equip' : 'carry'][from.slot].index;
    const sent0 = await this.outTranslated();
    await this.clickCell(from);
    const picked = await this.cursorItem();
    if (picked === expect) await this.clickCell(to);
    return { from, to, expect, picked, cursorAfter: await this.cursorItem(), swapsSent: (await this.outTranslated()) - sent0,
      lastSent: '0x' + (await this.eval(() => window.clientProbe().socket.lastSentOpcode)).toString(16) };
  }
  // A left click at a canvas point (canvas pixels), held across frames.
  async clickCanvas(x, y, button = 'left') {
    const box = await this.page.locator('#canvas').boundingBox();
    const cw = await this.eval(() => [document.getElementById('canvas').width, document.getElementById('canvas').height]);
    await this.page.mouse.move(box.x + x * box.width / cw[0], box.y + y * box.height / cw[1], { steps: 3 });
    await this.frames(2);
    await this.page.mouse.down({ button });
    try { await this.frames(2); } finally { await this.page.mouse.up({ button }); }
    await this.frames(2);
  }

  // A short press: down and up inside one rendered frame. EventTranslator
  // raises 513 on every DirectInput poll while the button is held (level, not
  // edge), and SGrid only spaces shop buys by 500 ms: at ~1 frame/s headless a
  // button held across frames buys once per frame. A player's click at 60
  // frames/s lasts less than the 500 ms guard.
  async tapCanvas(x, y) {
    const box = await this.page.locator('#canvas').boundingBox();
    const cw = await this.eval(() => [document.getElementById('canvas').width, document.getElementById('canvas').height]);
    await this.page.mouse.move(box.x + x * box.width / cw[0], box.y + y * box.height / cw[1], { steps: 3 });
    await this.frames(2);
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.frames(3);
  }

  // Hold the left button on a canvas point until done() or ms elapse (the
  // original shop buys again every frame the button stays down, 500 ms lock).
  async holdCanvas(x, y, done, ms) {
    const box = await this.page.locator('#canvas').boundingBox();
    const cw = await this.eval(() => [document.getElementById('canvas').width, document.getElementById('canvas').height]);
    await this.page.mouse.move(box.x + x * box.width / cw[0], box.y + y * box.height / cw[1], { steps: 3 });
    await this.frames(2);
    await this.page.mouse.down();
    try {
      const end = Date.now() + ms;
      while (Date.now() < end && !(await done())) await sleep(500);
    } finally { await this.page.mouse.up(); }
    await this.frames(3);
  }

  lastSent() { return this.eval(() => window.clientProbe().socket.lastSentOpcode); }
  outCount() { return this.eval(() => { const d = window.clientProbe().dialect; return d.outPass + d.outTranslated; }); }

  // Walk a route, find a named NPC in view and click it until isOpen holds.
  // A portal box opened on the way is cancelled with ESC, never confirmed.
  async openNpc(name, route, what, isOpen) {
    const walk = [];
    const noPortal = async () => {
      if ((await this.eval(() => Module._wyd_scene_msgbox_message())) !== 16) return;
      await this.page.locator('#canvas').press('Escape');
      await this.frames(2);
    };
    for (const [x, y] of route) {
      await noPortal();
      walk.push(...await this.walkTo(x, y, { near: 2, stallOk: true }));
    }
    await noPortal();
    const at = await this.me();
    const near = (await this.mobs()).filter(q => Math.hypot(q.x - at.x, q.y - at.y) <= 20);
    const npc = near.find(q => name.test(q.name.trim()));
    assert(npc, `${this.label}: ${what} NPC not in view at ${at.x},${at.y}: ${near.map(q => q.name.trim()).join(', ')}`);
    if (npc.d > 4 || !npc.onScreen) walk.push(...await this.walkTo(npc.x, npc.y, { near: 3, maxClicks: 6, stallOk: true }));
    await noPortal();
    const clicks = [];
    for (let i = 0; i < 4; i++) {
      const hit = await this.clickHuman(npc.id);
      clicks.push({ hit, lastSent: await this.lastSent() });
      if (!hit) continue;
      if (await this.until(what, isOpen, 15000).catch(() => false)) return { npc: npc.id, npcAt: [npc.x, npc.y], walk: walk.length, clicks };
    }
    await this.shot(`npc-${what.replace(/\W+/g, '-')}`);
    throw new Error(`${this.label}: ${what} did not open after ${clicks.length} clicks: ${JSON.stringify(clicks)}`);
  }

  // The inventory next to a shop/cargo window: open it with "i" only when
  // closed (openInventory's ESC would close the NPC window too).
  async ensureInventory() {
    if (((await this.eval(() => Module._wyd_field_open_panels())) & 128) === 0) {
      await this.page.focus('#canvas');
      await this.page.keyboard.press('i');
      await this.until('inventory open', () => (Module._wyd_field_open_panels() & 128) !== 0, 10000);
      await this.frames(3);
    }
    assert.equal(await this.eval(() => Module._wyd_field_inv_page()), 0, 'inventory not on page 0');
  }

  shopCells() {
    return this.eval(() => {
      const out = [];
      const cols = Module._wyd_field_shop_grid_size(0), rows = Module._wyd_field_shop_grid_size(1);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const item = Module._wyd_field_shop_cell_item(x, y);
        if (item > 0) out.push({ x, y, item, price: Module._wyd_item_price(item),
          sx: Module._wyd_field_shop_cell_screen(x, y, 0), sy: Module._wyd_field_shop_cell_screen(x, y, 1) });
      }
      return out;
    });
  }

  countItem(bag, index) { return bag.carry.filter(it => it.index === index).length; }

  // Gold amount box (B_MONEY deposit / B_CARGO_MONEY withdraw): real click on
  // the button, digits typed on the keyboard, real click on OK (B_IG_OK).
  async goldBox(button, amount) {
    const at = await this.eval(id => [Module._wyd_field_button_screen(id, 0), Module._wyd_field_button_screen(id, 1)], button);
    assert(at[0] >= 0, `${this.label}: gold button ${button} not on screen`);
    await this.clickCanvas(at[0], at[1]);
    await this.until('gold amount box', () => Module._wyd_field_gold_input_visible() === 1, 10000);
    await this.page.keyboard.type(String(amount), { delay: 120 });
    await this.frames(2);
    const ok = await this.eval(() => [Module._wyd_field_button_screen(65886, 0), Module._wyd_field_button_screen(65886, 1)]);
    assert(ok[0] >= 0, 'gold OK button not on screen');
    const sent0 = await this.outCount();
    await this.clickCanvas(ok[0], ok[1]);
    await sleep(3000);
    const sent = (await this.outCount()) - sent0;
    // A refusal by the client (message panel) leaves the box open: close it.
    if ((await this.eval(() => Module._wyd_field_gold_input_visible())) === 1) {
      await this.page.keyboard.press('Escape');
      await this.frames(2);
    }
    return sent;
  }

  cargo() {
    return this.eval(() => ({ coin: Module._wyd_field_my_score(5), cargo: Module._wyd_field_cargo_coin(),
      items: Array.from({ length: 128 }, (_, s) => Module._wyd_debug_cargo_item(s)) }));
  }

  chatLines(n = 8) {
    return this.eval(n => Array.from({ length: Math.min(n, Math.max(0, Module._wyd_field_chat_count())) },
      (_, k) => Module.UTF8ToString(Module._wyd_field_chat_line(k))), n);
  }

  // The chat box as a player uses it: Enter opens it, the text is typed,
  // Enter sends (TMFieldScene OnKeyDown / OnCharEvent).
  async say(text) {
    await this.closePanels();
    await this.page.focus('#canvas');
    await this.page.keyboard.press('Enter');
    await this.until('chat box', () => Module._wyd_field_chat_editing() === 1, 10000);
    await this.page.keyboard.type(text, { delay: 120 });
    await this.frames(2);
    const sent0 = await this.outCount();
    await this.page.keyboard.press('Enter');
    await this.frames(3);
    return { sent: (await this.outCount()) > sent0, lastSent: '0x' + (await this.lastSent()).toString(16) };
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
  // The other classes live on A as <name>c<class>. Names have at most 12
  // characters: the selection scene refuses longer ones locally, without a packet.
  const classChar = c => c === 0 ? A.char : `${A.char.slice(0, 10)}c${c}`;
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
  const minutes = ['attack', 'death', 'grind', 'learn', 'cast', 'castarea', 'potion', 'loot', 'shop', 'bank', 'chat', 'party', 'trade', 'paidteleport'].some(x => phases.has(x)) ? 25 : phases.has('tradeedge') ? 60 : 15;
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
    for (const two of ['party', 'trade'])
      if (phases.has(two)) assert(freemem() >= 2 * 1024 ** 3, `${two} requires 2 GiB free before opening A/B`);
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
      const name = classChar(cls);
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

    // Stage 3: DeleteCharacter end to end. Only a throwaway character created
    // here is deleted; B's configured character is never touched.
    await step('delete', async () => {
      const res = {};
      const name = `${B.char.slice(0, 8)}del${Date.now() % 1000}`.slice(0, 12);
      const wrong = (B.password[0] === 'x' ? 'y' : 'x') + B.password.slice(1);
      privateValues.push(name, wrong);
      const select = async label => {
        const s = await newSession(label, B);
        await s.loginToSelect();
        const pin = await s.pin();
        assert(pin.already || pin.result === 'lock1', `${label}: PIN rejected`);
        return s;
      };
      const listed = async s => (await s.slots()).map(x => ({ name: x.name, level: x.level }));
      const del = async (s, slot, password) => {
        assert.equal(await s.eval(k => Module._wyd_debug_selchar_open_delete(k), slot), 1, 'delete box refused');
        await s.shot('delete-box');
        assert.equal(await s.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'delete box OK refused');
        await s.until('password panel', () => Module._wyd_selchar_delete_panel_visible() === 1, 10000);
        const frames0 = (await s.probe()).dialect.inboundFrames;
        assert.equal(await s.eval(p => Module.ccall('wyd_debug_selchar_delete', 'number', ['string'], [p]), password), 1,
          'delete control refused');
        assert.equal(await s.lastSent(), 0x211, 'DeleteCharacter not sent');
        const op = await s.until('delete reply', f0 => {
          const p = window.clientProbe(), o = p.socket.lastRecvOpcode;
          return p.dialect.inboundFrames > f0 && (o === 0x112 || o === 0x11a || o === 0x11b) ? o : 0;
        }, 30000, frames0);
        // The runtime shows the refusal message for 2000 ms only (SetMessage(..., 2000)).
        const panel = await s.until('delete reply message', () => Module._wyd_scene_message_visible() === 1 ?
          Module.UTF8ToString(Module._wyd_scene_message_text()) : '', 1500).catch(() => '');
        if (panel) await s.shot('delete-reply');
        await sleep(3000);
        return { lastRecvOpcode: op, panelText: panel };
      };
      let s = await select('B-delete');
      let slots = await listed(s);
      let slot = slots.findIndex(x => x.name === name);
      if (slot < 0) {
        assert(slots.some(x => !x.name), 'no empty slot on B; nothing is deleted to make room');
        await s.create(name, 0);
        slots = await listed(s);
        slot = slots.findIndex(x => x.name === name);
        res.created = true;
      }
      assert(slot >= 0 && slots[slot].name !== B.char, 'throwaway character missing');
      await s.healthy(); await s.close();
      // Persisted before it is deleted.
      s = await select('B-delete-relogin');
      res.before = await listed(s);
      assert.equal(res.before[slot].name, name, 'throwaway character not persisted');
      res.slot = slot;
      const refused = await del(s, slot, wrong);
      await s.shot('delete-refused');
      res.refused = { ...refused, slots: await listed(s) };
      const deleted = await del(s, slot, B.password);
      await s.shot('delete-done');
      res.deleted = { ...deleted, slots: await listed(s) };
      await s.healthy(); await s.close();
      s = await select('B-delete-final');
      res.relogin = await listed(s);
      await s.shot('delete-final');
      await s.healthy(); await s.close();
      checkDelete(res);
      const hide = l => l.map(x => ({ filled: !!x.name, target: x.name === name, level: x.level }));
      const hex = o => '0x' + o.toString(16);
      return { created: !!res.created, slot, before: hide(res.before),
        refused: { lastRecvOpcode: hex(res.refused.lastRecvOpcode), panelText: res.refused.panelText, slots: hide(res.refused.slots) },
        deleted: { lastRecvOpcode: hex(res.deleted.lastRecvOpcode), slots: hide(res.deleted.slots) },
        relogin: hide(res.relogin) };
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
      if (phases.has('castarea'))
        assert(freemem() >= 1024 * 1024 * 1024, 'less than 1 GiB free before opening observer');
      b = await newSession('B', B);
      await b.loginToSelect();
      const pin = await b.pin();
      if (!pin.already && pin.result !== 'lock1') throw new Error(`PIN rejected (${pin.result})`);
      let slots = await b.slots();
      if (!slots[0].name) {
        assert(!phases.has('attack') && !phases.has('castarea') && !phases.has('party') && !phases.has('trade'), 'scenario requires an existing B character');
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
      const name = classChar(cls);
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
      // Cheapest skill per class (SkillData.csv SkillPoint; level*3 points).
      // Masters confirmed in source at the locked revision: the NPC files in
      // Release/TMsrv/run/npc with Merchant 19 and a class's 24 skills
      // (Foema_Ancian 1, Cap.Cavaleiros 0, Mestre_Archi 2, ForeLearner 3),
      // placed in Armia by NPCGener.txt. Routes from tools/route_armia.py
      // (HeightMap + AttributeMap baked like route.Bake) from the city spawn.
      // The ShopList the NPC actually sends is still what the check trusts.
      const MASTERS = {
        foema: { npcName: /foema|ancia/i, at: [2094, 2126], route: [[2088.5, 2111.5], [2088.5, 2116.5], [2090.5, 2122.5]] },
        archi: { npcName: /archi/i, at: [2077, 2123], route: [[2088.5, 2105.5], [2080.5, 2113.5], [2074.5, 2119.5]] },
        // South of the raised planter at x 2115..2120, y 2099..2104: the
        // shortest map path clips its rim and the runtime could not leave it.
        cavaleiros: { npcName: /cavaleiros/i, at: [2144, 2120], route: [[2106.5, 2093.5], [2112.5, 2098.5],
          [2112.5, 2106.5], [2122.5, 2108.5], [2131.5, 2114.5], [2139.5, 2119.5]] },
        forelearner: { npcName: /forelearner/i, at: [2130, 2125], route: [[2107.5, 2102.5], [2115.5, 2110.5],
          [2123.5, 2118.5], [2128.5, 2123.5]] },
      };
      const PLANS = {
        0: { skill: 5000, name: 'Giro_da_Furia', cost: 24, masters: ['cavaleiros'] },
        1: { skill: 5024, name: 'Flecha_Magica', cost: 12, masters: ['foema'] },
        2: { skill: 5048, name: 'Fera_Flamejante', cost: 24, masters: ['archi'] },
        3: { skill: 5080, name: 'Golpe_Felino', cost: 18, masters: ['forelearner'] },
      };
      const plan = PLANS[cls];
      assert(plan, `no learn plan for class ${cls}`);
      const inClass = i => i >= 5000 + cls * 24 && i < 5024 + cls * 24;
      const name = classChar(cls);
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
      const discovery = [];
      // Cancel the portal confirmation with ESC, as a player would; never OK.
      const portalBoxes = [];
      const noPortal = async () => {
        if ((await a.eval(() => Module._wyd_scene_msgbox_message())) !== 16) return;
        portalBoxes.push(await a.me());
        await a.page.locator('#canvas').press('Escape');
        await a.frames(2);
        assert.notEqual(await a.eval(() => Module._wyd_scene_msgbox_message()), 16, 'portal box stays open after ESC');
      };
      let npc, at, offered = [], merchant = 0;
      for (const key of plan.masters) {
        const m = MASTERS[key];
        for (const [x, y] of m.route) {
          await noPortal();
          walk.push(...await a.walkTo(x, y, { near: 2, stallOk: true, stopWhen: async () =>
            (await a.eval(() => Module._wyd_scene_msgbox_message())) === 16 }));
        }
        await noPortal();
        at = await a.me();
        // By name: a plain merchant stands next to the Foema master (first run
        // clicked it and got ShopType 1).
        const near = (await a.mobs()).filter(q => Math.hypot(q.x - at.x, q.y - at.y) <= 20);
        npc = near.find(q => m.npcName.test(q.name));
        if (!npc) {
          discovery.push({ master: key, at: [at.x, at.y], seen: near.map(q => `${q.name.trim()} ${q.x},${q.y}`) });
          continue;
        }
        // Close enough for the NPC to be on screen and clickable.
        if (npc.d > 5 || !npc.onScreen)
          walk.push(...await a.walkTo(npc.x, npc.y, { near: 4, maxClicks: 6, stallOk: true }));
        await noPortal();
        at = await a.me();
        let visible = false;
        const clicks = [];
        for (let i = 0; i < 3 && !visible; i++) {
          const hit = await a.clickHuman(npc.id);
          clicks.push({ hit, lastSent: await a.eval(() => window.clientProbe().socket.lastSentOpcode) });
          if (!hit) continue;
          try { visible = await a.until('skill master window', () => Module._wyd_field_skillmaster_visible() === 1, 15000); }
          catch { visible = false; }
        }
        await a.shot(`master-click-${key}`);
        if (!visible) {
          // Not a skill master (e.g. Mestre Haby is Merchant 31 and opens a
          // confirm box): cancel whatever box it opened with ESC, never OK.
          const box = await a.eval(() => Module._wyd_scene_msgbox_message());
          if (box) { await a.page.locator('#canvas').press('Escape'); await a.frames(2); }
          discovery.push({ master: key, npc: npc.id, npcAt: [npc.x, npc.y], at: [at.x, at.y], clicks, window: false, box });
          npc = undefined;
          continue;
        }
        await a.frames(3);
        offered = await a.eval(() => {
          const o = [];
          for (let k = 0; k < 128; k++) { const i = Module._wyd_field_skillmaster_item(k); if (i) o.push(i); }
          return o;
        });
        merchant = await a.eval(() => Module._wyd_field_skillmaster_merchant());
        discovery.push({ master: key, npc: npc.id, npcAt: [npc.x, npc.y], offered: [Math.min(...offered), Math.max(...offered)] });
        console.log(`    master ${key} (${npc.id}) offers ${Math.min(...offered)}..${Math.max(...offered)}`);
        if (offered.length && offered.every(inClass)) break;
        // Another class's master: close its window and try the next candidate.
        await a.page.locator('#canvas').press('Escape');
        await a.frames(2);
        npc = undefined;
        offered = [];
      }
      // Partial state: step() keeps it next to the error if a later check fails.
      r.learn = { discovery, portalBoxes };
      assert(npc, `no master offered class ${cls} skills: ${JSON.stringify(discovery)}`);
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
        walkClicks: walk.length, merchant, offered, box, before, after, relogin, discovery, portalBoxes };
      r.learn = res;
      checkLearn(res);
      return res;
    });

    await step('castarea', async () => {
      const res = { attempts: [], relogin: null };
      r.castarea = res;
      assert.equal((await a.me()).characterClass, 0, 'castarea needs the existing TK');
      assert((await a.combat(0)).learnedSkill & 1, 'Giro da Furia not learned');
      res.aTrip = await a.toGremlinField();
      res.bTrip = await b.toGremlinField();
      await sample('castarea: both in Gremlin field');
      res.assignment = await a.assignSkill({ pos: 0 });
      assert.equal(res.assignment.cell, 5000);
      assert.equal(res.assignment.belt, 0);
      assert.equal(res.assignment.selected, 0);
      for (const s of [a, b]) await s.eval(() => Module._wyd_combat_enable(1));
      const end = Date.now() + 12 * 60 * 1000;
      let searches = 0;
      while (Date.now() < end && res.attempts.length < 6) {
        const state = await a.combat(0);
        assert(state.myHp > 0 && state.myDie !== 1, 'caster died while searching');
        assert(state.myMp >= 15, 'insufficient MP for another Giro da Furia');
        const mobs = await a.mobs();
        res.lastSearch = mobs.filter(m => m.name.trim() === 'Gremlin').map(({ id, hp, x, y, onScreen }) => ({ id, hp, x, y, onScreen }));
        let pair = areaPair(await a.me(), mobs);
        if (!pair) {
          // Search only the known Gremlin generators, via ordinary movement.
          const y = [2102, 2110, 2118, 2094, 2086][searches++ % 5];
          res.searches = searches;
          await a.walkTo(2184.5, y + 0.5, { near: 3, maxClicks: 3, stallOk: true });
          await sleep(2000);
          continue;
        }
        const me = await a.me(), observer = await b.me();
        if (Math.hypot(me.x - observer.x, me.y - observer.y) > 8)
          await b.walkTo(me.x, me.y, { near: 5, maxClicks: 4, stallOk: true });
        // Recheck after B's walk; mobs can wander while rendering input.
        pair = areaPair(await a.me(), await a.mobs());
        if (!pair) continue;
        let before;
        const attempt = { attacker: a.id, target: pair[0].id };
        attempt.clicked = await a.clickHuman(pair[0].id, 'right', async () => {
          before = (await a.mobs()).filter(m => m.name.trim() === 'Gremlin' && m.hp > 0);
          const primary = before.find(m => m.id === attempt.target);
          if (!primary) return false;
          const fresh = areaPair(await a.me(), [primary, ...before.filter(m => m.id !== primary.id)]);
          if (!fresh || fresh[0].id !== primary.id) return false;
          const seen = await b.mobs();
          if (!fresh.every(m => seen.some(o => o.id === m.id && o.hp === m.hp))) return false;
          attempt.pair = fresh.map(({ id, x, y }) => ({ id, x, y }));
          attempt.before = before.map(({ id, hp, x, y }) => ({ id, hp, x, y }));
          attempt.beforeB = seen.map(({ id, hp }) => ({ id, hp }));
          attempt.mpBefore = (await a.combat(0)).myMp;
          for (const s of [a, b]) await s.eval(() => Module._wyd_combat_clear());
          return true;
        });
        if (!attempt.clicked) { await sleep(1000); continue; }
        res.attempts.push(attempt);
        await sleep(2500);
        attempt.logsA = await a.combatLog();
        attempt.logsB = await b.combatLog();
        const hp = async s => Promise.all(before.map(async m => ({ id: m.id, ...await s.combat(m.id) })));
        attempt.afterA = await hp(a);
        attempt.afterB = await hp(b);
        const after = await a.combat(0);
        attempt.died = after.myHp <= 0 || after.myDie === 1;
        try {
          attempt.result = checkAreaAttempt(attempt);
          attempt.ok = true;
        } catch (e) { attempt.ok = false; attempt.error = e.message; }
        console.log(`    area attempt ${res.attempts.length}: ${attempt.ok ? 'two-target result confirmed by A/B' : attempt.error}`);
        await a.shot(`area-${res.attempts.length}`);
        await b.shot(`area-${res.attempts.length}`);
        await a.healthy(); await b.healthy();
        assert(!attempt.died, 'caster died');
        assert(!attempt.logsA.lost && !attempt.logsB.lost, 'combat diagnostics lost');
        assert(attempt.logsA.out.filter(e => e.attacker === a.id).length <= 1,
          'multiple attacks during one click; observation window ambiguous');
        if (attempt.ok) break;
        // Cancel any ongoing attack before the next observation window.
        await a.walk(0, 100);
      }
      assert(res.attempts.some(t => t.ok), 'no proven two-target cast within attempt/time budget');
      await a.walk(0, 100);
      const me = await a.me(), score = await a.combat(0);
      assert(score.myHp > 0 && score.myDie !== 1, 'caster died before relogin');
      const before = { ...me, level: score.myLevel, exp: score.exp, learnedSkill: score.learnedSkill };
      await a.healthy(); await b.healthy();
      ev.final_B = dialectSummary(await b.probe());
      await a.close();
      await b.until('B loses A after area cast', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
      await b.close();
      await sample('castarea: B closed, before relogin');
      a = await newSession('A-area-relogin', A);
      await a.loginToSelect();
      assert.equal((await a.pin()).result, 'lock1', 'post-area PIN rejected');
      const again = await a.enter(0), againScore = await a.combat(0);
      const after = { ...again, level: againScore.myLevel, exp: againScore.exp, learnedSkill: againScore.learnedSkill };
      checkCombatRelogin(before, after);
      assert.equal(after.learnedSkill, before.learnedSkill, 'learned skill did not persist');
      res.relogin = { before, after, persisted: true };
      await a.shot('area-relogin');
      return res;
    });

    // Stage 5, skills: use the learned skill. Assignment is the original
    // gesture (skill window "S", hover the skill, Shift+1 -> 0x0378), the slot
    // is selected with the real "1" key and the cast is a real right click on a
    // Gremlin (TMFieldScene SkillUse). MP and damage are the server's.
    await step('cast', async () => {
      // SkillData.csv: Range in tiles (the server drops targets past it,
      // combat.go validateSkillTarget); TargetType 3 gathers nearby targets
      // into one MSG_Attack (TMFieldScene SkillUse).
      const PLANS = {
        0: { skill: 0, pos: 0, name: 'Giro_da_Furia', range: 5, area: true },
        1: { skill: 24, pos: 0, name: 'Flecha_Magica', range: 6 },
        2: { skill: 48, pos: 0, name: 'Fera_Flamejante', range: 6 },
        3: { skill: 80, pos: 8, name: 'Golpe_Felino', range: 2 },
      };
      const plan = PLANS[cls];
      assert(plan, `no cast plan for class ${cls}`);
      const name = classChar(cls);
      privateValues.push(name);
      if ((await a.eval(() => Module._wyd_get_game_state())) !== 0) {
        const slot = (await a.slots()).findIndex(x => x.name === name);
        assert(slot >= 0, `class ${cls} character missing`);
        await a.enter(slot);
      }
      const learned = await a.eval(() => Module._wyd_field_my_score(6) >>> 0);
      assert(((learned >>> plan.pos) & 1) === 1, `skill ${plan.skill} not learned (run learn first)`);
      const trip = await a.toGremlinField();
      const res = { cls, pos: plan.pos, skill: plan.skill, name: plan.name, slot: 0, trip, attempts: 0, area: !!plan.area };
      r.cast = res;
      Object.assign(res, await a.assignSkill(plan));
      // Cast on the nearest live Gremlin with real right clicks.
      const gremlins = async () => (await a.mobs()).filter(m => m.name.trim() === 'Gremlin' && m.hp > 0);
      let mob;
      for (let i = 0; i < 6 && !mob; i++) {
        const live = (await gremlins()).filter(m => m.onScreen);
        // Area: prefer a Gremlin with another one close by, so the packet can
        // carry more than one target; a lone one is recorded as a limitation.
        mob = plan.area ? live.find(m => live.some(o => o.id !== m.id && Math.hypot(o.x - m.x, o.y - m.y) <= 3))
          ?? (i >= 3 ? live[0] : undefined) : live[0];
        if (!mob) await a.walk(i % 2 ? -160 : 160, 80);
      }
      assert(mob, 'no live Gremlin on screen');
      // Within the skill range (the server drops farther targets silently).
      if (mob.d > plan.range - 1) {
        res.approach = await a.walkTo(mob.x, mob.y, { near: Math.max(1.5, plan.range - 1.5), maxClicks: 4, stallOk: true });
        mob = (await gremlins()).find(m => m.id === mob.id) ?? mob;
      }
      const c0 = await a.combat(mob.id);
      res.target = { id: mob.id, distance: Math.round(mob.d) };
      const hp0 = new Map((await gremlins()).filter(m => m.d <= plan.range + 2).map(m => [m.id, m.hp]));
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
      // Mobs near the target whose HP the server lowered (area fan-out).
      // A mob that only walked out of view is not counted.
      res.nearby = hp0.size;
      res.hitMobs = [];
      for (const [id, hp] of hp0) {
        const m = await a.combat(id);
        if (m.present && (m.die === 1 || m.hp < hp)) res.hitMobs.push(id);
      }
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
    // First potion use, right after the death phase's recall: the server
    // revives with 1..50% of MaxHp and regenerates Level+30 every 10 s, so the
    // inventory is opened while A waits for the recall and the use follows it.
    let potionPre;
    const potionFirstUse = async () => {
      const res = { damage: 'death phase: revived by the server with part of MaxHp at the Armia spawn' };
      const bag0 = await a.bag();
      res.slot = bag0.carry.slice(0, 15).findIndex(it => it.index === 401);
      assert(res.slot >= 0, 'no HP potion (401) on carry page 0');
      res.amount0 = itemAmount(bag0.carry[res.slot]);
      await a.ensureInventory();
      // Read HP only now, right before the use: regeneration keeps running.
      const pre = await a.bag();
      res.maxHp = pre.maxHp;
      res.hpBefore = pre.hp;
      assert(pre.hp < pre.maxHp, `no HP missing (${pre.hp}/${pre.maxHp}) after the respawn`);
      res.startedAt = new Date().toISOString();
      const sent0 = await a.outTranslated();
      await a.clickCell({ place: 1, slot: res.slot }, 'right');
      await a.until('server consumed one unit', ([s, n]) => {
        const v = [0, 1, 2].map(k => [Module._wyd_debug_my_item_ef(1, s, k, 0), Module._wyd_debug_my_item_ef(1, s, k, 1)]);
        return (v.find(([e]) => e === 61)?.[1] ?? 1) < n;
      }, 15000, [res.slot, res.amount0]).catch(() => false);
      await a.until('HP rises', h => Module._wyd_field_my_score(0) > h, 15000, pre.hp).catch(() => false);
      // The server tick moves HP to the potion's ReqHp (up to 2000 per 1 s tick).
      await a.until('HP full', () => Module._wyd_field_my_score(0) >= Module._wyd_field_my_score(1), 5000).catch(() => false);
      const bagUse = await a.bag();
      res.use = { usesSent: (await a.outTranslated()) - sent0, amount: itemAmount(bagUse.carry[res.slot]), hp: bagUse.hp };
      // B, at the spawn, sees A's HP from the server's 0x0336 multicast.
      const bHp1 = await b.until('B sees A healed', ([id, h]) => {
        const v = Module._wyd_field_human_present(id) === 1 ? Module._wyd_field_human_hp(id) : 0;
        return v > h && v;
      }, 20000, [a.id, pre.hp]).catch(() => b.eval(id => Module._wyd_field_human_hp(id), a.id));
      res.observer = { hpAfter: bHp1 };
      return res;
    };

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
      const potionNext = phases.has('potion');
      if (potionNext) {
        // Open the inventory with the real "i" key while the recall is pending.
        await a.page.focus('#canvas');
        await a.page.keyboard.press('i');
      }
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
      // The server revives with 1..50% of MaxHp and natural regeneration adds
      // Level+30 every 10 s: with a potion phase next, the first use happens
      // here, before HP fills, and the potion phase takes the screenshots.
      let c1, after;
      if (potionNext) {
        c1 = await a.combat(0);
        after = { ...(await a.me()), hp: c1.myHp, maxHp: c1.myMaxHp, die: c1.myDie, level: c1.myLevel, exp: c1.exp };
        potionPre = await potionFirstUse();
      } else {
        await sleep(3000);
        c1 = await a.combat(0);
        after = { ...(await a.me()), hp: c1.myHp, maxHp: c1.myMaxHp, die: c1.myDie, level: c1.myLevel, exp: c1.exp };
      }
      const sawRespawn = (await b.until('B sees A back in town', id => Module._wyd_field_human_present(id) === 1,
        30000, a.id)) === true;
      if (!potionNext) {
        await a.shot('respawned');
        await b.shot('respawn-observer');
      }
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

    // Closes A (and B, after it saw A leave) and enters A's slot again: the
    // server saved on disconnect; the new snapshot is what it persisted.
    const reloginA = async (label, slot) => {
      await a.healthy();
      await a.close();
      if (b?.context) {
        await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id);
        await b.healthy();
        ev.final_B = dialectSummary(await b.probe());
        await b.close();
      }
      await sample('item relogin: before login');
      a = await newSession(label, A);
      await a.loginToSelect();
      assert.equal((await a.pin()).result, 'lock1', 'relogin PIN rejected');
      await a.enter(slot);
      return a.bag();
    };
    const stripBag = bag => ({ equip: bag.equip, carry: bag.carry });

    // Stage 5, slice 2: unequip and re-equip with the original click-to-pick
    // gesture while B watches (0x036B), then a move the item cannot make.
    // handler/item.go tradingItem decides; the client only shows its echo.
    await step('equip', async () => {
      await b.until('B sees A', id => Module._wyd_field_human_present(id) === 1, 30000, a.id);
      const before = await a.bag();
      const slot = [6, 7, 1, 2, 3, 4, 5].find(i => before.equip[i].index > 0);
      assert(slot !== undefined, 'nothing equipped to move');
      const free = before.carry.slice(0, 15).findIndex(it => it.index === 0);
      assert(free >= 0, 'no free cell on carry page 0');
      const other = before.carry.slice(0, 15).findIndex(it => it.index > 0);
      const res = { slot, free, item: before.equip[slot].index, before };
      r.equip = res;
      const look0 = (await b.other(a.id)).look;
      const lookOf = ([id, l, same]) => {
        const now = Array.from({ length: 8 }, (_, p) => Module._wyd_field_human_look_mesh(id, p));
        return (same ? now.every((v, i) => v === l[i]) : now.some((v, i) => v !== l[i])) && now;
      };
      await a.openInventory();
      await a.shot('equip-open');
      // 1. Unequip to the free cell.
      res.unequip = await a.moveItem({ place: 0, slot }, { place: 1, slot: free });
      await a.until('server echo of the unequip', ([s, f, i]) => Module._wyd_debug_my_item(0, s) === 0 &&
        Module._wyd_debug_my_item(1, f) === i, 20000, [slot, free, res.item]);
      await a.until('score recomputed', ([d, c]) => Module._wyd_field_my_attack(0) !== d ||
        Module._wyd_field_my_attack(1) !== c, 15000, [before.damage, before.ac]).catch(() => false);
      res.off = await a.bag();
      const offLook = await b.until('B sees the unequip', lookOf, 20000, [a.id, look0, false]).catch(() => null);
      await a.shot('equip-off');
      await b.shot('equip-off');
      // 2. Back to the same equip slot.
      res.equip = await a.moveItem({ place: 1, slot: free }, { place: 0, slot });
      await a.until('server echo of the re-equip', ([s, f, i]) => Module._wyd_debug_my_item(0, s) === i &&
        Module._wyd_debug_my_item(1, f) === 0, 20000, [slot, free, res.item]);
      await a.until('score recomputed with the item', ([d, c]) => Module._wyd_field_my_attack(0) !== d ||
        Module._wyd_field_my_attack(1) !== c, 15000, [res.off.damage, res.off.ac]).catch(() => false);
      res.on = await a.bag();
      const onLook = await b.until('B sees the re-equip', lookOf, 20000, [a.id, look0, true]).catch(() => null);
      res.observer = { look0, offLook, onLook, sawOff: !!offLook, sawOn: !!onLook };
      await a.shot('equip-on');
      // 3. A carry item that does not fit the slot (a starter potion).
      assert(other >= 0, 'no carry item for the refused move');
      const sent0 = await a.outTranslated();
      const move = await a.moveItem({ place: 1, slot: other }, { place: 0, slot });
      await sleep(3000);
      // Put back what the cursor still holds, as a player would: click the
      // origin cell (same slot: no packet), then ESC if it is still attached.
      if (await a.cursorItem()) await a.clickCell({ place: 1, slot: other });
      if (await a.cursorItem()) { await a.page.keyboard.press('Escape'); await a.frames(2); }
      res.refused = { item: before.carry[other].index, move, swapsSent: (await a.outTranslated()) - sent0,
        notice: await a.eval(() => Module._wyd_scene_message_visible() === 1 ?
          Module.UTF8ToString(Module._wyd_scene_message_text()) : null),
        cursor: await a.cursorItem(), bag: stripBag(await a.bag()) };
      console.log(`    slot ${slot} item ${res.item}: damage ${before.damage}->${res.off.damage}->${res.on.damage}, ` +
        `ac ${before.ac}->${res.off.ac}->${res.on.ac}; B saw off ${res.observer.sawOff} on ${res.observer.sawOn}; ` +
        `refused move sent ${res.refused.swapsSent}`);
      await a.shot('equip-refused');
      await a.closePanels();
      res.relogin = await reloginA('A-equip-relogin', 0);
      checkEquip(res);
      return res;
    });

    // Stage 5, slice 2: an HP potion by right click, with B watching A's HP.
    // Gremlins barely scratch a leveled character (no grind ever rested below
    // 50% HP) and regeneration refills it, so the damage comes from the proven
    // death phase: the server revives A at the Armia spawn with HP 2, next to
    // B. The server consumes and heals (item.go useHealPotion, hpmp.go tick);
    // the runtime's local stack decrement is overwritten by the server's 0x0182.
    await step('potion', async () => {
      const res = potionPre ?? await potionFirstUse();
      r.potion = res;
      const amountAt = ([s]) => {
        const v = [0, 1, 2].map(k => [Module._wyd_debug_my_item_ef(1, s, k, 0), Module._wyd_debug_my_item_ef(1, s, k, 1)]);
        return v.find(([e]) => e === 61)?.[1] ?? (Module._wyd_debug_my_item(1, s) ? 1 : 0);
      };
      await a.shot('potion-used');
      await b.shot('potion-observed');
      // 2. Rapid double use: two right clicks inside one rendered frame.
      let sent0 = await a.outTranslated();
      const [px, py] = await a.cellPoint({ place: 1, slot: res.slot });
      await a.page.mouse.move(px, py, { steps: 3 });
      await a.frames(2);
      for (let i = 0; i < 2; i++) { await a.page.mouse.down({ button: 'right' }); await a.page.mouse.up({ button: 'right' }); }
      await a.frames(3);
      await sleep(4000);
      const bagDouble = await a.bag();
      res.double = { usesSent: (await a.outTranslated()) - sent0, amount: itemAmount(bagDouble.carry[res.slot]),
        clientAmount: await a.eval(amountAt, [res.slot]), bag: stripBag(bagDouble) };
      // 3. Right click on an empty cell: nothing to use. Loot can fill carry
      // page 0; an empty equip cell (1..15) is then the empty cell on screen.
      const carryFree = bagDouble.carry.slice(0, 15).findIndex(it => it.index === 0);
      const equipFree = bagDouble.equip.findIndex((it, k) => k >= 1 && it.index === 0);
      const emptyCell = carryFree >= 0 ? { place: 1, slot: carryFree } : { place: 0, slot: equipFree };
      assert(emptyCell.slot >= 0, 'no empty cell on screen');
      sent0 = await a.outTranslated();
      await a.clickCell(emptyCell, 'right');
      await sleep(3000);
      res.empty = { cell: emptyCell, usesSent: (await a.outTranslated()) - sent0, bag: stripBag(await a.bag()) };
      console.log(`    potion slot ${res.slot}: ${res.amount0}->${res.use.amount}->${res.double.amount}, ` +
        `HP ${res.hpBefore}->${res.use.hp}, B saw ${res.observer.hpAfter}, double sent ${res.double.usesSent}, empty sent ${res.empty.usesSent}`);
      await a.closePanels();
      await a.walk(0, 100);
      res.beforeRelogin = await a.bag();
      res.relogin = await reloginA('A-potion-relogin', 0);
      checkPotion(res);
      return res;
    });

    // Stage 5, slice 2: loot from real kills. At the locked revision drops go
    // straight to the killer's carry (0x0182) and gold to Coin (0x0337)
    // (mobkilled.go); ground items have no client broadcast (ADR 007).
    await step('loot', async () => {
      const name = classChar(cls);
      privateValues.push(name);
      const slot = (await a.slots()).findIndex(x => x.name === name);
      assert(slot >= 0, `class ${cls} character missing`);
      await a.enter(slot);
      const start = await a.bag();
      const res = { class: cls, slot, start: { coin: start.coin, level: start.level, exp: start.exp }, kills: [] };
      r.loot = res;
      res.trip = await a.toGremlinField();
      const end = Date.now() + 17 * 60000;
      const tried = new Set();
      let last = start;
      const itemGain = bag => bag.carry.some((it, i) => itemAmount(it) > itemAmount(start.carry[i]));
      while (Date.now() < end && res.kills.length < 25 && !(last.coin > start.coin && itemGain(last))) {
        const s = await a.combat(0);
        if (s.myDie === 1 || s.myHp <= 0) throw new Error('looting character died');
        if (s.myHp < s.myMaxHp * 0.5) { await sleep(6000); continue; }
        const mob = (await a.mobs()).find(m => m.name.trim() === 'Gremlin' && m.onScreen && m.hp > 0 && !tried.has(m.id));
        if (!mob) { await a.walk(res.kills.length % 2 ? -160 : 160, 80); tried.clear(); continue; }
        tried.add(mob.id);
        const c0 = await a.combat(mob.id);
        const bag0 = await a.bag();
        let lastClick = 0;
        const fightEnd = Date.now() + 60000;
        while (Date.now() < fightEnd) {
          const c = await a.combat(mob.id);
          if (c.myDie === 1 || c.myHp <= 0 || !c.present || c.die === 1 || c.hp <= 0) break;
          if (Date.now() - lastClick > 6000) { await a.clickHuman(mob.id); lastClick = Date.now(); }
          await sleep(1000);
        }
        await sleep(2500);
        const c1 = await a.combat(mob.id);
        last = await a.bag();
        if (c1.exp <= c0.exp) continue; // not a server-paid kill
        const items = last.carry.map((it, i) => ({ slot: i, index: it.index, before: itemAmount(bag0.carry[i]), after: itemAmount(it) }))
          .filter(g => g.before !== g.after);
        res.kills.push({ id: mob.id, exp: [c0.exp, c1.exp], coin: [bag0.coin, last.coin], items });
        console.log(`    kill ${res.kills.length}: coin ${bag0.coin}->${last.coin}, items ${JSON.stringify(items)}`);
        await writeFile(join(OUT, 'evidence.json'), evidenceJson(ev));
      }
      res.coinGain = last.coin - start.coin;
      res.itemGain = last.carry.map((it, i) => ({ slot: i, index: it.index, before: itemAmount(start.carry[i]), after: itemAmount(it) }))
        .filter(g => g.after > g.before);
      res.lost = last.carry.map((it, i) => ({ slot: i, index: it.index, was: start.carry[i].index,
        before: itemAmount(start.carry[i]), after: itemAmount(it) }))
        .filter(g => g.after < g.before || (g.was && g.index !== g.was));
      await a.openInventory();
      await a.shot('loot-inventory');
      await a.closePanels();
      await a.walk(0, 100);
      res.end = await a.bag();
      res.relogin = await reloginA('A-loot-relogin', slot);
      checkLoot(res);
      return res;
    });

    // Stage 5, slice 3: the Armia merchant Aki (Merchant 1, NPCGener #3406 at
    // 2144,2088) and the cargo guard (Guarda_Carga, Merchant 2, #3408 at
    // 2144,2082) stand next to the proven portal route.
    const ARMIA_EAST = [[2117.5, 2095.5], [2130.5, 2091.5], [2140.5, 2086.5]];
    const inChat = (s, text) => s.until(`chat line "${text}"`, t => {
      const n = Module._wyd_field_chat_count();
      for (let k = 0; k < Math.min(n, 10); k++) if (Module.UTF8ToString(Module._wyd_field_chat_line(k)).includes(t)) return true;
      return false;
    }, 20000, text).catch(() => false);

    await step('shop', async () => {
      const res = {};
      r.shop = res;
      res.open = await a.openNpc(/^aki$/i, ARMIA_EAST, 'shop window', () => Module._wyd_field_shop_visible() === 1);
      res.merchant = await a.eval(() => Module._wyd_field_shop_merchant());
      await a.ensureInventory();
      await a.frames(3);
      res.cells = await a.shopCells();
      await a.shot('shop');
      console.log(`    shop ${res.merchant}: ${res.cells.map(c => `${c.item}@${c.price}`).join(' ')}`);
      assert(res.cells.length > 0, 'the shop lists no item');
      // 1. Sell a looted item from carry page 0 (not the potions): pick it
      // up, drop it on the shop grid, confirm box 890 (SGrid SellItem).
      const bag0 = await a.bag();
      // Only items worth gold: the server pays Price/4 (shop.go sell), so an item
      // priced under 4 (e.g. 4144, Price 0) sells for nothing.
      const priced = await a.eval(ids => ids.map(i => Module._wyd_item_price(i)), bag0.carry.slice(0, 15).map(it => it.index));
      const candidates = bag0.carry.slice(0, 15).map((it, k) => ({ ...it, k }))
        .filter(it => it.index > 0 && it.index !== 401 && priced[it.k] >= 4);
      assert(candidates.length > 0, 'nothing worth gold to sell on carry page 0');
      const sold = candidates.at(-1);
      res.sell = { slot: sold.k, item: sold.index, clientPrice: await a.eval(i => Module._wyd_item_price(i), sold.index),
        coinBefore: bag0.coin };
      let sent0 = await a.outCount();
      await a.clickCell({ place: 1, slot: sold.k });
      res.sell.cursor = await a.cursorItem();
      const drop = res.cells[0];
      await a.clickCanvas(drop.sx, drop.sy);
      res.sell.box = await a.eval(() => Module._wyd_scene_msgbox_message());
      if (res.sell.box === 890) assert.equal(await a.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'OK refused');
      await a.until('sold slot cleared', s => Module._wyd_debug_my_item(1, s) === 0, 15000, sold.k).catch(() => false);
      await sleep(2000);
      const bag1 = await a.bag();
      Object.assign(res.sell, { sent: (await a.outCount()) - sent0, after: bag1.carry[sold.k], coinAfter: bag1.coin,
        lastSent: '0x' + (await a.lastSent()).toString(16) });
      console.log(`    sell slot ${sold.k} item ${sold.index}: box ${res.sell.box}, gold ${res.sell.coinBefore}->${res.sell.coinAfter}`);
      // 2. Buy the cheapest item the gold covers (left click on the cell).
      const cheap = res.cells.filter(c => c.price > 0 && c.price <= bag1.coin).sort((p, q) => p.price - q.price)[0];
      assert(cheap, `no shop item within ${bag1.coin} gold`);
      const countIn = ([i]) => { let c = 0; for (let s = 0; s < 64; s++) if (Module._wyd_debug_my_item(1, s) === i) c++; return c; };
      sent0 = await a.outCount();
      await a.tapCanvas(cheap.sx, cheap.sy);
      await a.until('bought item', ([i, n]) => {
        let c = 0; for (let s = 0; s < 64; s++) if (Module._wyd_debug_my_item(1, s) === i) c++;
        return c > n;
      }, 15000, [cheap.item, a.countItem(bag1, cheap.item)]).catch(() => false);
      await sleep(2000);
      const bag2 = await a.bag();
      res.buy = { item: cheap.item, clientPrice: cheap.price, sent: (await a.outCount()) - sent0, coinBefore: bag1.coin,
        coinAfter: bag2.coin, gained: a.countItem(bag2, cheap.item) - a.countItem(bag1, cheap.item),
        clientCount: await a.eval(countIn, [cheap.item]) };
      console.log(`    buy ${cheap.item}: gold ${res.buy.coinBefore}->${res.buy.coinAfter}, gained ${res.buy.gained}`);
      // 3. An item the gold does not cover: the server refuses in silence.
      const dear = res.cells.filter(c => c.price > bag2.coin).sort((p, q) => q.price - p.price)[0];
      if (dear) {
        sent0 = await a.outCount();
        await a.tapCanvas(dear.sx, dear.sy);
        await sleep(4000);
        const bag3 = await a.bag();
        res.poor = { item: dear.item, clientPrice: dear.price, sent: (await a.outCount()) - sent0, coinBefore: bag2.coin,
          coinAfter: bag3.coin, gained: a.countItem(bag3, dear.item) - a.countItem(bag2, dear.item) };
      }
      // 4. Two clicks inside one rendered frame on the cheap item.
      const bag4 = await a.bag();
      sent0 = await a.outCount();
      const box = await a.page.locator('#canvas').boundingBox();
      const cw = await a.eval(() => [document.getElementById('canvas').width, document.getElementById('canvas').height]);
      await a.page.mouse.move(box.x + cheap.sx * box.width / cw[0], box.y + cheap.sy * box.height / cw[1], { steps: 3 });
      await a.frames(2);
      for (let i = 0; i < 2; i++) { await a.page.mouse.down(); await a.page.mouse.up(); }
      await a.frames(3);
      await sleep(4000);
      const bag5 = await a.bag();
      res.repeat = { sent: (await a.outCount()) - sent0, coinBefore: bag4.coin, coinAfter: bag5.coin,
        gained: a.countItem(bag5, cheap.item) - a.countItem(bag4, cheap.item) };
      console.log(`    repeat: sent ${res.repeat.sent}, gained ${res.repeat.gained}, gold ${bag4.coin}->${bag5.coin}`);
      await a.shot('shop-done');
      await a.page.locator('#canvas').press('Escape');
      await a.frames(2);
      res.beforeRelogin = await a.bag();
      res.relogin = await reloginA('A-shop-relogin', 0);
      checkShop(res);
      return res;
    });

    await step('bank', async () => {
      const res = {};
      r.bank = res;
      res.open = await a.openNpc(/^guarda[ _]carga$/i, ARMIA_EAST, 'cargo window', () => Module._wyd_field_cargo_visible() === 1);
      await sleep(2000); // 0x0339 and the 0x0182 of each stored slot
      res.opened = true;
      await a.ensureInventory();
      const c0 = await a.cargo();
      res.atOpen = { coin: c0.coin, cargo: c0.cargo, stored: c0.items.filter(Boolean).length };
      await a.shot('cargo');
      console.log(`    cargo open: carry gold ${c0.coin}, cargo gold ${c0.cargo}, ${res.atOpen.stored} stored`);
      // 1. An item into the first free cargo cell of page 0 and back (before the
      // gold box: a refused amount keeps that modal box open, as in the original).
      const bag = await a.bag();
      const from = bag.carry.slice(0, 15).map((it, k) => ({ ...it, k })).filter(it => it.index > 0).at(-1);
      assert(from, 'no item on carry page 0');
      const free = c0.items.slice(0, 40).findIndex(i => i === 0);
      assert(free >= 0, 'no free cargo cell on page 0');
      res.store = { item: from.index, carrySlot: from.k, cargoSlot: free,
        move: await a.moveItem({ place: 1, slot: from.k }, { place: 2, slot: free }) };
      await a.until('stored', ([s, i]) => Module._wyd_debug_cargo_item(s) === i, 15000, [free, from.index]).catch(() => false);
      await sleep(1500);
      res.store.cargoItem = await a.eval(s => Module._wyd_debug_cargo_item(s), free);
      res.store.carryItem = await a.eval(s => Module._wyd_debug_my_item(1, s), from.k);
      res.fetch = { move: await a.moveItem({ place: 2, slot: free }, { place: 1, slot: from.k }) };
      await a.until('fetched', ([s, i]) => Module._wyd_debug_my_item(1, s) === i, 15000, [from.k, from.index]).catch(() => false);
      await sleep(1500);
      res.fetch.carryItem = await a.eval(s => Module._wyd_debug_my_item(1, s), from.k);
      res.fetch.cargoItem = await a.eval(s => Module._wyd_debug_cargo_item(s), free);
      assert(c0.coin > 0, 'no gold to deposit (run the shop phase first)');
      res.amount = Math.max(1, Math.min(100, Math.floor(c0.coin / 2)));
      // 2. Deposit, 3. withdraw the same amount.
      let sent = await a.goldBox(65563, res.amount);
      await a.until('deposit applied', c => Module._wyd_field_my_score(5) !== c, 10000, c0.coin).catch(() => false);
      await sleep(1500);
      const c1 = await a.cargo();
      res.deposit = { sent, coinBefore: c0.coin, cargoBefore: c0.cargo, coin: c1.coin, cargo: c1.cargo };
      sent = await a.goldBox(65688, res.amount);
      await a.until('withdraw applied', c => Module._wyd_field_my_score(5) !== c, 10000, c1.coin).catch(() => false);
      await sleep(1500);
      const c2 = await a.cargo();
      res.withdraw = { sent, coin: c2.coin, cargo: c2.cargo };
      console.log(`    gold ${c0.coin}/${c0.cargo} -> deposit ${c1.coin}/${c1.cargo} -> withdraw ${c2.coin}/${c2.cargo}`);
      // 4. Withdraw more than the cargo holds: sent, refused by the server.
      sent = await a.goldBox(65688, c2.cargo + 1000);
      const c3 = await a.cargo();
      res.overdraw = { sent, coin: c3.coin, cargo: c3.cargo };
      // 5. Deposit more than the carry holds: the client refuses (message 34)
      // and keeps the box open; the relogin below discards it.
      sent = await a.goldBox(65563, c3.coin + 1000);
      const c4 = await a.cargo();
      res.overdeposit = { sent, coin: c4.coin, cargo: c4.cargo };
      await a.shot('cargo-done');
      await a.page.locator('#canvas').press('Escape');
      await a.frames(2);
      const openCargo = () => a.openNpc(/^guarda[ _]carga$/i, ARMIA_EAST, 'cargo window', () => Module._wyd_field_cargo_visible() === 1);
      if ((await a.eval(() => Module._wyd_field_cargo_visible())) !== 1) { await openCargo(); await sleep(2000); }
      // 6. Gold kept in the cargo across the relogin (0x0339 @12 with a non-zero
      // balance), then withdrawn again so the account ends as it started.
      res.keep = { amount: Math.max(1, Math.min(37, c4.coin)) };
      res.keep.sent = await a.goldBox(65563, res.keep.amount);
      await a.until('kept deposit applied', c => Module._wyd_field_my_score(5) !== c, 10000, c4.coin).catch(() => false);
      await sleep(1500);
      Object.assign(res.keep, await a.cargo().then(c => ({ coin: c.coin, cargo: c.cargo })));
      await a.page.locator('#canvas').press('Escape');
      await a.frames(2);
      // Relogin, then open the cargo again: both gold pools as the server keeps them.
      res.beforeRelogin = await a.bag();
      await reloginA('A-bank-relogin', 0);
      res.reopen = await openCargo();
      await sleep(2000);
      const c5 = await a.cargo();
      res.relogin = { coin: c5.coin, cargo: c5.cargo, item: c5.items[free] };
      console.log(`    kept ${res.keep.amount}: ${res.keep.coin}/${res.keep.cargo} -> relogin ${c5.coin}/${c5.cargo}`);
      res.restore = { sent: await a.goldBox(65688, res.keep.amount) };
      await a.until('kept gold withdrawn', c => Module._wyd_field_my_score(5) !== c, 10000, c5.coin).catch(() => false);
      await sleep(1500);
      Object.assign(res.restore, await a.cargo().then(c => ({ coin: c.coin, cargo: c.cargo })));
      checkBank(res);
      return res;
    });

    // Stage 5, slice A: the paid city portal (teleport.go, Armia -> Noatum for
    // 700). The client shows box 16 with the price and sends 0x0290 on OK
    // without checking gold; the server charges or refuses in silence.
    await step('paidteleport', async () => {
      const res = {}; r.paidteleport = res;
      const PRICE = 700, NOATUM = [1045, 1725];
      // Inside the 4x4 origin block 2116..2119 x 2100..2103 (teleport.go).
      const tile = async () => {
        await a.closePanels();
        return a.walkTo(2117.5, 2101.5, { near: 0.8, maxClicks: 12, stallOk: true,
          stopWhen: () => a.eval(() => Module._wyd_scene_msgbox_message() === 16) });
      };
      const attempt = async label => {
        const coinBefore = (await a.bag()).coin;
        await tile();
        await a.until(`${label} portal box`, () => Module._wyd_scene_msgbox_message() === 16, 20000);
        const at = await a.me();
        await a.shot(`paid-${label}`);
        assert.equal(await a.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'portal OK refused');
        await a.frames(2);
        const lastSent = await a.lastSent();
        await a.until(`${label} teleport`, ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x,
          Module._wyd_field_myhuman_y() - y) > 50, 20000, [at.x, at.y]).catch(() => false);
        await sleep(3000);
        const to = await a.me();
        return { at: [at.x, at.y], lastSent, to: [to.x, to.y], moved: Math.hypot(to.x - at.x, to.y - at.y),
          coinBefore, coinAfter: (await a.bag()).coin };
      };
      // 1. Paid: A has the 700.
      res.paid = await attempt('paid');
      res.paid.nearNoatum = Math.hypot(res.paid.to[0] - NOATUM[0], res.paid.to[1] - NOATUM[1]) <= 4;
      console.log(`    paid: ${res.paid.at} -> ${res.paid.to}, gold ${res.paid.coinBefore}->${res.paid.coinAfter}`);
      // 2. Back to Armia by the free city command.
      const p0 = await a.me();
      res.back = await a.say('/armia');
      await a.until('back in Armia', ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x,
        Module._wyd_field_myhuman_y() - y) > 50, 30000, [p0.x, p0.y]);
      await sleep(3000);
      // 3. Refused: keep only 500 on A (the rest in the cargo), then try again.
      const cargoOpen = () => a.openNpc(/^guarda[ _]carga$/i, ARMIA_EAST, 'cargo window', () => Module._wyd_field_cargo_visible() === 1);
      await cargoOpen(); await sleep(2000); await a.ensureInventory();
      const c0 = await a.cargo();
      res.parked = { amount: c0.coin - 500 };
      assert(res.parked.amount > 0, 'A has 500 gold or less');
      res.parked.sent = await a.goldBox(65563, res.parked.amount);
      await a.until('parked', c => Module._wyd_field_my_score(5) !== c, 10000, c0.coin).catch(() => false);
      await sleep(1500);
      res.parked.coin = (await a.cargo()).coin;
      await a.page.locator('#canvas').press('Escape'); await a.frames(2);
      res.refused = await attempt('refused');
      console.log(`    refused: ${res.refused.at} -> ${res.refused.to}, gold ${res.refused.coinBefore}->${res.refused.coinAfter}`);
      // 4. Take the gold back, then relogin: the 700 stays spent, nothing else.
      await cargoOpen(); await sleep(2000); await a.ensureInventory();
      const c1 = await a.cargo();
      res.restore = { sent: await a.goldBox(65688, res.parked.amount) };
      await a.until('restored', c => Module._wyd_field_my_score(5) !== c, 10000, c1.coin).catch(() => false);
      await sleep(1500);
      res.restore.coin = (await a.cargo()).coin;
      await a.page.locator('#canvas').press('Escape'); await a.frames(2);
      await reloginA('A-paid-relogin', 0);
      res.relogin = { coin: (await a.bag()).coin };
      await a.healthy();
      checkPaidTeleport(res, PRICE);
      return res;
    });

    await step('party', async () => {
      const res = {}; r.party = res;
      const inventory = async s => {
        const v = await s.bag(); return { equip: v.equip, carry: v.carry, coin: v.coin, level: v.level, exp: v.exp };
      };
      const beforeA = await inventory(a), beforeB = await inventory(b);
      const pair = async () => ({ aId: a.id, bId: b.id,
        a: await a.waitParty([a.id, b.id], a.id), b: await b.waitParty([a.id, b.id], a.id) });
      const empty = async () => ({ a: await a.waitParty([], 0), b: await b.waitParty([], 0) });
      const joinParty = async () => {
        await a.inviteParty(b); await b.partyRow(a.id); return pair();
      };
      const reconnect = async (label, creds) => {
        const s = await newSession(label, creds);
        await s.loginToSelect(); const pin = await s.pin();
        assert(pin.already || pin.result === 'lock1', 'party relogin PIN rejected');
        await s.enter(0); return s;
      };
      await a.waitParty([], 0); await b.waitParty([], 0);
      await a.inviteParty(b);
      await b.shot('party-invitation');
      assert.equal(await b.eval(id => Module._wyd_field_party_member(id), a.id), 0, 'invitation prematurely joined');
      await b.uiButton(475139);
      res.refused = await empty();
      res.accepted = await joinParty();
      await a.shot('party-accepted'); await b.shot('party-accepted');
      await b.partyRow(a.id); await b.partyRow(a.id);
      res.repeated = await pair();
      await b.uiButton(475139);
      res.left = await empty();
      await joinParty();
      await a.partyRow(b.id, true);
      await a.until('kick confirmation', () => Module._wyd_scene_msgbox_message() === 50001, 15000);
      await a.page.locator('#canvas').press('Enter'); await a.frames(2);
      res.kicked = await empty();
      await joinParty();
      await b.healthy(); await b.close();
      res.memberDisconnected = { a: await a.waitParty([], 0) };
      b = await reconnect('B-party-relogin', B);
      assert.deepEqual(await inventory(b), beforeB, 'B changed after relogin');
      await b.waitParty([], 0);
      res.rejoined = await joinParty();
      await a.healthy(); await a.close();
      res.leaderDisconnected = { b: await b.waitParty([], 0) };
      a = await reconnect('A-party-relogin', A);
      await a.waitParty([], 0);
      await joinParty();
      await b.uiButton(475139); await empty();
      assert.deepEqual(await inventory(a), beforeA, 'A changed after relogin');
      assert.deepEqual(await inventory(b), beforeB, 'B changed during party tests');
      res.inventoryPreserved = true;
      await a.shot('party-final'); await b.shot('party-final');
      checkPartyEvidence(res);
      return res;
    });

    // Trade helpers shared by the trade and tradeedge phases.
    const snap = async s => { const v = await s.bag(); return { equip: v.equip, carry: v.carry, coin: v.coin }; };
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const reconnect = async (label, creds) => {
      const s = await newSession(label, creds);
      await s.loginToSelect(); const pin = await s.pin();
      assert(pin.already || pin.result === 'lock1', 'trade relogin PIN rejected');
      await s.enter(0); return s;
    };
    const closed = s => s.until('trade window closed', () => Module._wyd_field_trade_value(0) === 0, 30000);
    const open = async (from, to) => {
      await from.requestTrade(to);
      // The original swallows Enter on box 601 (TMFieldScene::OnCharEvent), so a
      // player accepts with a click on OK; the automation export does what that click does.
      assert.equal(await to.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'trade box OK refused');
      await to.frames(2);
      await from.until('trade window', id => Module._wyd_field_trade_value(0) === 1 && Module._wyd_field_trade_value(1) === id, 30000, to.id);
      await to.until('trade window', id => Module._wyd_field_trade_value(0) === 1 && Module._wyd_field_trade_value(1) === id, 30000, from.id);
    };
    const pickSlot = async s => {
      const v = await s.bag();
      const k = [13, 14, ...Array.from({ length: 13 }, (_, i) => i)].find(i => v.carry[i].index > 0);
      assert(k !== undefined, `${s.label}: no item on inventory page 0 to trade`);
      return k;
    };
    const offer = async (from, to, slot) => {
      const index = (await from.bag()).carry[slot].index;
      await from.clickCell({ place: 1, slot });
      await from.until('own offer', i => Module._wyd_field_trade_item(0, 0) === i, 15000, index);
      const takerSees = await to.until('forwarded offer', i => Module._wyd_field_trade_item(1, 0) === i && i, 30000, index);
      return { item: index, takerSees, carryPos: (await from.trade()).carryPos[0] };
    };
    // A check is shown to the partner, unless it was the second one: then the
    // server swaps at once and closes both windows.
    const check = async (s, other) => {
      await sleep(2100); // the window refuses a check within 2 s of the last change
      await s.uiButton(617);
      await other.until('partner check or swap', () => Module._wyd_field_trade_value(3) === 1 ||
        Module._wyd_field_trade_value(0) === 0, 30000);
    };
    // Both checks: the server swaps, sends 0x0185 to both and closes both windows.
    const complete = async (first, second) => {
      await check(first, second);
      if ((await second.trade()).visible === 1) { await sleep(2100); await second.uiButton(617); }
      await closed(first); await closed(second);
      await sleep(2000);
    };

    // Stage 5 slice 4: P2P trade by the original window (needs the server PR
    // that forwards 0x0383; ADR 010). Every result is read from the server's
    // 0x0185/0x0384, never from the local offer.
    await step('trade', async () => {
      const res = {}; r.trade = res;
      await a.closePanels(); await b.closePanels();
      const a0 = await snap(a), b0 = await snap(b);
      // 1. Refusal: B cancels box 601 with ESC. Nothing is sent, nothing opens.
      await a.requestTrade(b);
      await b.shot('trade-request');
      await b.page.locator('#canvas').press('Escape'); await b.frames(2);
      await sleep(3000);
      res.refused = { aWindow: (await a.trade()).visible, bWindow: (await b.trade()).visible };
      res.refused.unchanged = res.refused.aWindow === 0 && res.refused.bWindow === 0 &&
        same(await snap(a), a0) && same(await snap(b), b0);
      // 2. Accepted: A offers an item and gold; B's check is reset by the gold.
      const slot = await pickSlot(a);
      res.gold = Math.min(a0.coin, 10);
      await open(a, b);
      res.forward = await offer(a, b, slot);
      await a.shot('trade-offer'); await b.shot('trade-offer');
      await check(b, a);
      assert.equal((await a.trade()).opCheck, 1, 'B check not shown to A');
      if (res.gold > 0) {
        res.goldSent = await a.goldBox(65563, res.gold);
        await b.until('forwarded gold', g => Module._wyd_field_trade_value(5) === g, 30000, res.gold);
        await a.until('check reset', () => Module._wyd_field_trade_value(3) === 0, 15000);
        res.reset = { a: await a.trade(), b: await b.trade() };
        checkTradeReset(res.reset.a, res.reset.b);
      }
      await complete(a, b);
      const a1 = await snap(a), b1 = await snap(b);
      res.swap = checkTradeSwap({ giverBefore: a0, giverAfter: a1, takerBefore: b0, takerAfter: b1, slot, gold: res.gold });
      await a.shot('trade-done'); await b.shot('trade-done');
      // 3. Relogin: both sides as the server saved them.
      await a.healthy(); await a.close(); await b.healthy(); await b.close();
      a = await reconnect('A-trade-relogin', A);
      b = await reconnect('B-trade-relogin', B);
      assert.deepEqual(await snap(a), a1, 'A changed after relogin');
      assert.deepEqual(await snap(b), b1, 'B changed after relogin');
      res.relogin = true;
      // 4. Cancel: an open trade with an offer, closed by A with ESC -> 0x0384 to both.
      await open(a, b);
      await offer(a, b, await pickSlot(a));
      await a.page.locator('#canvas').press('Escape'); await a.frames(2);
      await closed(a); await closed(b);
      await sleep(2000);
      res.cancelled = { unchanged: same(await snap(a), a1) && same(await snap(b), b1) };
      // 5. Return trade: B gives the item back, no gold (restores the accounts).
      assert(res.swap.takerSlot < 15, 'received item not on inventory page 0');
      await open(b, a);
      await offer(b, a, res.swap.takerSlot);
      await complete(b, a);
      const a2 = await snap(a), b2 = await snap(b);
      res.back = checkTradeSwap({ giverBefore: b1, giverAfter: b2, takerBefore: a1, takerAfter: a2, slot: res.swap.takerSlot });
      await a.shot('trade-final'); await b.shot('trade-final');
      checkTradeEvidence(res);
      return res;
    });

    // Stage 5, slice A: trade edge cases. A full carry on the taker makes the
    // server roll the swap back (executeSwap, NoticeNoEmptySlot); a side that
    // disconnects mid-trade cancels it for the other (CloseUser -> RemoveTrade).
    await step('tradeedge', async () => {
      const res = {}; r.tradeedge = res;
      const invPage = async (s, n) => {
        await s.ensureInventory().catch(() => {});
        if ((await s.eval(() => Module._wyd_field_inv_page())) === n) return;
        await s.uiButton(67076 + n);
        await s.until(`inventory page ${n}`, k => Module._wyd_field_inv_page() === k, 10000, n);
        await s.frames(3);
      };
      const shopOpen = s => s.openNpc(/^aki$/i, ARMIA_EAST, 'shop window', () => Module._wyd_field_shop_visible() === 1);
      const a0 = await snap(a), b0 = await snap(b);
      // 1. Fill B's 30 carry slots with the cheapest shop item.
      await shopOpen(b); await b.ensureInventory(); await b.frames(3);
      const cells = await b.shopCells();
      const cheap = cells.filter(c => c.price > 0).sort((p, q) => p.price - q.price)[0];
      assert(cheap, 'the shop lists no priced item');
      const freeB = b0.carry.slice(0, 30).filter(it => it.index === 0).length;
      res.fill = { item: cheap.item, price: cheap.price, freeBefore: freeB, bought: [] };
      // The client buys into a free cell of the page on screen (myPos), so each
      // page is filled with the button held on the shop cell.
      const freeOn = page => b.eval(pg => { let n = 0; for (let x = pg * 15; x < pg * 15 + 15; x++)
        if (Module._wyd_debug_my_item(1, x) === 0) n++; return n; }, page);
      for (const page of [0, 1]) {
        await invPage(b, page);
        if ((await freeOn(page)) === 0) continue;
        await b.holdCanvas(cheap.sx, cheap.sy, async () => (await freeOn(page)) === 0, 90000);
        await sleep(2000);
      }
      await invPage(b, 0);
      const filled = await snap(b);
      res.fill.bought = filled.carry.map((it, x) => it.index === cheap.item && b0.carry[x].index === 0 ? x : -1).filter(x => x >= 0);
      // Filler left by an interrupted earlier run is sold back too.
      res.fill.preexisting = b0.carry.map((it, x) => it.index === cheap.item ? x : -1).filter(x => x >= 0);
      const bFull = await snap(b); res.bFull = bFull;
      res.fill.freeAfter = bFull.carry.slice(0, 30).filter(it => it.index === 0).length;
      console.log(`    B bought ${res.fill.bought.length} x ${cheap.item}; free ${freeB} -> ${res.fill.freeAfter}`);
      await b.page.locator('#canvas').press('Escape'); await b.frames(2);
      // 2. A offers an item; both check; the server has no room on B and rolls back.
      await a.closePanels(); await b.closePanels();
      const bAt = await b.me();
      await a.walkTo(bAt.x, bAt.y, { near: 3, maxClicks: 15, stallOk: true });
      const slot = await pickSlot(a);
      await open(a, b);
      res.full = { offer: await offer(a, b, slot) };
      await check(a, b);
      if ((await b.trade()).visible === 1) { await sleep(2100); await b.uiButton(617); }
      await closed(a); await closed(b);
      res.full.bMessage = await b.until('no-room notice', () => Module._wyd_scene_message_visible() === 1 ?
        Module.UTF8ToString(Module._wyd_scene_message_text()) : '', 4000).catch(() => '');
      await sleep(2000);
      res.full.a = await snap(a); res.full.b = await snap(b);
      await b.shot('trade-full');
      // 3. Disconnect mid-trade: A offers, B checks, A's page goes away.
      await open(a, b);
      res.drop = { offer: await offer(a, b, slot) };
      await check(b, a);
      res.drop.aSawCheck = (await a.trade()).opCheck === 1;
      await a.close();
      res.drop.bClosed = (await closed(b).catch(() => false)) === true;
      await sleep(2000);
      res.drop.b = await snap(b);
      a = await reconnect('A-tradeedge-relogin', A);
      res.drop.a = await snap(a);
      // The cleanup is B's alone (~45 s per sale at software-rendered frame
      // rates): A leaves now to spare the host's memory.
      await a.healthy(); await a.close();
      // 4. B sells the filler back (both pages), so the account ends as it began.
      await shopOpen(b); await sleep(1500);
      const drop = (await b.shopCells())[0];
      res.cleanup = { sold: 0 };
      for (const x of [...res.fill.bought, ...res.fill.preexisting].sort((p, q) => p - q)) {
        await invPage(b, Math.floor(x / 15));
        await b.clickCell({ place: 1, slot: x });
        await b.clickCanvas(drop.sx, drop.sy);
        if ((await b.eval(() => Module._wyd_scene_msgbox_message())) === 890)
          assert.equal(await b.eval(() => Module._wyd_debug_scene_msgbox_ok()), 1, 'sell OK refused');
        if (await b.until('sold', k => Module._wyd_debug_my_item(1, k) === 0, 10000, x).catch(() => false)) res.cleanup.sold++;
        await sleep(600);
      }
      await invPage(b, 0);
      await b.page.locator('#canvas').press('Escape'); await b.frames(2);
      await sleep(1500);
      res.cleanup.b = await snap(b);
      await b.healthy();
      checkTradeEdge({ a0, b0, ...res, sellPrice: sellPrice(cheap.price) });
      const hide = v => ({ coin: v.coin, items: v.carry.filter(it => it.index).length });
      return { fill: res.fill, full: { offer: res.full.offer, bMessage: res.full.bMessage, a: hide(res.full.a), b: hide(res.full.b) },
        drop: { offer: res.drop.offer, aSawCheck: res.drop.aSawCheck, bClosed: res.drop.bClosed, a: hide(res.drop.a), b: hide(res.drop.b) },
        cleanup: { sold: res.cleanup.sold, b: hide(res.cleanup.b) }, before: { a: hide(a0), b: hide(b0) },
        unchanged: { fullA: JSON.stringify(res.full.a) === JSON.stringify(a0), fullB: JSON.stringify(res.full.b) === JSON.stringify(res.bFull),
          dropA: JSON.stringify(res.drop.a) === JSON.stringify(a0), dropB: JSON.stringify(res.drop.b) === JSON.stringify(res.bFull) } };
    });

    await step('chat', async () => {
      const res = {};
      r.chat = res;
      const tag = `wyd${Date.now() % 100000}`;
      // 1. Public line: B shows it under A's name; the server does not echo it to A.
      res.say = await a.say(`ola ${tag}`);
      res.say.heard = await inChat(b, `ola ${tag}`);
      res.say.bLines = await b.chatLines(4);
      res.say.aLines = await a.chatLines(4);
      await b.shot('chat-heard');
      // 2. Whisper A -> B ("/name text"): record what B shows as the sender.
      // The receiver's private memo shows &String[1] (OnPacketMessageWhisper):
      // the first character is cut, so the check looks for the tag only.
      const bCount0 = await b.eval(() => Module._wyd_field_chat_count());
      res.whisper = await a.say(`/${B.char} psiu ${tag}`);
      res.whisper.heard = await inChat(b, tag);
      res.whisper.bLines = await b.chatLines(4);
      // Which name B shows as the sender (names stay out of the evidence).
      res.whisper.senderShown = await b.eval(([self, other, n0]) => {
        const lines = [];
        for (let k = 0; k < Module._wyd_field_chat_count() - n0; k++) lines.push(Module.UTF8ToString(Module._wyd_field_chat_line(k)));
        return lines.some(l => l.includes(other)) ? 'sender' : lines.some(l => l.includes(self)) ? 'receiver' : 'none';
      }, [B.char, A.char, bCount0]);
      // 3. Whisper to nobody online: the server answers with a notice.
      const in0 = await a.eval(() => window.clientProbe().dialect.inTranslated);
      res.offline = await a.say(`/zz${tag} ninguem`);
      await sleep(3000);
      res.offline.inTranslated = (await a.eval(() => window.clientProbe().dialect.inTranslated)) - in0;
      res.offline.lastRecv = '0x' + (await a.eval(() => window.clientProbe().socket.lastRecvOpcode)).toString(16);
      // 4. Teleport command (/azran, handler/chat.go teleportCmds): the server
      // moves A (0x036C Effect 1) and B, in Armia, loses it; /armia returns.
      const p0 = await a.me();
      res.teleport = await a.say('/azran');
      await a.until('A teleported', ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x, Module._wyd_field_myhuman_y() - y) > 50,
        30000, [p0.x, p0.y]).catch(() => false);
      await sleep(3000);
      const p1 = await a.me();
      res.teleport.to = [p1.x, p1.y];
      res.teleport.moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      res.teleport.bLost = (await b.until('B loses A', id => Module._wyd_field_human_present(id) === 0, 30000, a.id)
        .catch(() => false)) === true;
      await a.shot('teleported');
      res.back = await a.say('/armia');
      await a.until('A back', ([x, y]) => Math.hypot(Module._wyd_field_myhuman_x() - x, Module._wyd_field_myhuman_y() - y) > 50,
        30000, [p1.x, p1.y]).catch(() => false);
      await sleep(3000);
      const p2 = await a.me();
      res.back.to = [p2.x, p2.y];
      res.back.moved = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      res.back.bSees = (await b.until('B sees A again', id => Module._wyd_field_human_present(id) === 1, 30000, a.id)
        .catch(() => false)) === true;
      console.log(`    say heard ${res.say.heard}, whisper heard ${res.whisper.heard}, ` +
        `teleport ${res.teleport.moved.toFixed(0)} tiles, back ${res.back.moved.toFixed(0)}`);
      await a.healthy();
      await b.healthy();
      checkChat(res);
      return res;
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
