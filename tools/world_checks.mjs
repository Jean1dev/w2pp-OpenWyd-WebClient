// Pure acceptance rules for the real-server harness (no mock multiplayer).
import assert from 'node:assert/strict';

export function redactEvidence(value, secrets) {
  if (typeof value === 'string') {
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
      value = value.split(secret).join('<redacted>');
    return value;
  }
  if (Array.isArray(value)) return value.map(v => redactEvidence(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactEvidence(v, secrets)]));
  return value;
}

export const PHASES = ['badpass', 'badpin', 'classes', 'login', 'create', 'enter',
  'inventory', 'second', 'move', 'logout', 'mapchange', 'concurrent'];

export function validateOptions(opt) {
  assert.match(opt.target ?? '', /^[a-zA-Z0-9.-]+:[0-9]+$/, '--target host:port is required');
  const port = Number(opt.target.split(':')[1]);
  assert(port > 0 && port <= 65535, 'invalid target port');
  assert(/^\d+$/.test(opt['client-version']) && Number(opt['client-version']) > 0 &&
    Number(opt['client-version']) <= 2147483647, 'invalid client version');
  assert(/^[0-3]$/.test(opt.class), '--class must be 0..3');
  const names = opt.phases.split(',').map(s => s.trim());
  assert(names.length && names.every(n => PHASES.includes(n)), 'unknown or empty phase');
  assert(new Set(names).size === names.length, 'duplicate phase');
  const phases = new Set(names);
  const deps = { create: ['login'], enter: ['login'], inventory: ['enter'], second: ['enter'],
    move: ['second'], logout: ['second'], mapchange: ['second'], concurrent: ['enter'] };
  for (const name of phases) for (const dep of deps[name] ?? [])
    assert(phases.has(dep), `${name} requires ${dep}`);
  return phases;
}

// Inbound gameplay the dialect deliberately drops until its layout is
// translated (ADR 003: unmapped packets are dropped and counted, never reach a
// scene). Only these, and only as "unknown" drops, may appear in a stage 4
// scenario; they are reported in the evidence. Any other drop still fails.
//   0x0367 MSG_Attack: mob/player combat broadcast in hostile fields (stage 5).
export const DEFERRED_INBOUND = new Set(['0x0367']);

export function checkHealth(p, errors = []) {
  assert.equal(errors.length, 0, 'page errors');
  assert.equal(p.glErrorTotal, 0, 'WebGL errors');
  assert.equal(p.placeholder, 0, 'placeholder scene');
  for (const k of ['inDropSize', 'inDropRange', 'outDropUnknown',
    'outDropSize', 'outDropRange', 'outDropNoVersion'])
    assert.equal(p.dialect[k], 0, `protocol rejection: ${k}`);
  const droppedIn = p.dialect.droppedIn ?? [];
  const unexpected = droppedIn.filter(d => !DEFERRED_INBOUND.has(d.opcode));
  assert.deepEqual(unexpected, [], 'protocol rejection: inbound opcode outside the deferred list');
  const deferred = droppedIn.reduce((n, d) => n + d.times, 0);
  assert(p.dialect.inDropUnknown <= deferred, `protocol rejection: inDropUnknown ${p.dialect.inDropUnknown} > deferred ${deferred}`);
  if (p.state === 0) assert.equal(p.field.fixture, 0, 'offline fixture');
}

export function checkPreview(actual, expected) {
  for (const key of ['name', 'level', 'maxHp', 'maxMp', 'str', 'int', 'dex', 'con', 'equip'])
    assert.deepEqual(actual[key], expected[key], `persisted preview differs: ${key}`);
}

export function checkArmiaSpawn(me) {
  // CitySpawn(0): (2086,2093) + rand%15; EmptyCellNear may shift by <=3 tiles.
  // Runtime centers tiles. Exact chosen cell is corroborated by server logs.
  assert(me.x >= 2083 && me.x < 2104 && me.y >= 2090 && me.y < 2111, 'relogin outside Armia spawn');
}

export function checkTeleport(after) {
  // world/teleport.go: destination (2588,2096) + rand%3, plus tile center.
  assert(after.x >= 2588 && after.x < 2591 && after.y >= 2096 && after.y < 2099,
    'teleport outside Armia Field destination');
  // Loaded terrain block, 128 cells per block: 2588>>7 = 20, 2096>>7 = 16.
  assert.equal(after.groundX, 20, 'destination terrain block X not loaded');
  assert.equal(after.groundY, 16, 'destination terrain block Y not loaded');
}
