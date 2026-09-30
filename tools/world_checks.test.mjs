import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOptions, checkHealth, checkPreview, checkArmiaSpawn, checkTeleport, checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast, redactEvidence } from './world_checks.mjs';

test('redaction removes nested diagnostic strings without corrupting JSON numbers', () => {
  const value = { error: 'fixture-secret', nested: ['prefix fixture-secret suffix'], x: 123456 };
  const clean = redactEvidence(value, ['fixture-secret', '123456']);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), {
    error: '<redacted>', nested: ['prefix <redacted> suffix'], x: 123456,
  });
});

const options = phases => ({ target: 'localhost:8281', 'client-version': '12000', class: '0', phases });
test('rejects incomplete, unknown and duplicate scenarios before connecting', () => {
  for (const phases of ['', 'logout', 'login,enter,mapchange', 'login,enter,attack', 'login,enter,typo', 'login,login', 'login,enter,death',
    'login,enter,second,attack,death', 'login,enter,second,mapchange,death'])
    assert.throws(() => validateOptions(options(phases)));
  assert.doesNotThrow(() => validateOptions(options('login,enter,second,logout')));
  assert.doesNotThrow(() => validateOptions(options('badpin,classes')));
  assert.throws(() => validateOptions({ ...options('login'), class: '4' }));
  assert.throws(() => validateOptions({ ...options('login'), 'client-version': '12000junk' }));
});
test('health fails on rejected packets, graphics errors and offline scenes', () => {
  const p = { glErrorTotal: 0, placeholder: 0, state: 0, field: { fixture: 0 }, dialect: {
    inDropUnknown: 0, inDropSize: 0, inDropRange: 0, outDropUnknown: 0,
    outDropSize: 0, outDropRange: 0, outDropNoVersion: 0 } };
  checkHealth(p);
  for (const k of Object.keys(p.dialect))
    assert.throws(() => checkHealth({ ...p, dialect: { ...p.dialect, [k]: 1 } }));
  assert.throws(() => checkHealth({ ...p, glErrorTotal: 1 }));
  assert.throws(() => checkHealth({ ...p, field: { fixture: 1 } }));
  assert.throws(() => checkHealth(p, ['runtime error']));
});
test('only listed deferred gameplay opcodes may be dropped, and only as unknown', () => {
  const dialect = { inDropUnknown: 1, inDropSize: 0, inDropRange: 0, outDropUnknown: 0,
    outDropSize: 0, outDropRange: 0, outDropNoVersion: 0 };
  const p = d => ({ glErrorTotal: 0, placeholder: 0, state: 0, field: { fixture: 0 }, dialect: { ...dialect, ...d } });
  const deferred = new Set(['0x0999']);
  checkHealth(p({ droppedIn: [{ opcode: '0x0999', times: 1 }] }), [], deferred);
  assert.throws(() => checkHealth(p({ droppedIn: [{ opcode: '0x0333', times: 1 }] }), [], deferred));
  assert.throws(() => checkHealth(p({ droppedIn: [] }), [], deferred));
  assert.throws(() => checkHealth(p({ inDropUnknown: 2, droppedIn: [{ opcode: '0x0999', times: 1 }] }), [], deferred));
  assert.throws(() => checkHealth(p({ inDropSize: 1, droppedIn: [{ opcode: '0x0999', times: 2 }] }), [], deferred));
  assert.throws(() => checkHealth(p({ outDropUnknown: 1, droppedIn: [{ opcode: '0x0999', times: 1 }] }), [], deferred));
  // Combat is translated now: a dropped 0x0367 is a failure by default.
  assert.throws(() => checkHealth(p({ droppedIn: [{ opcode: '0x0367', times: 1 }] })));
});
test('combat accepts only server-confirmed damage and experience', () => {
  const observer = { sawTarget: true, hpTrail: [100, 80, 55], echoes: 3 };
  const ok = { attacksSent: 3, echoes: 3, hpTrail: [100, 80, 55], killed: false, exp0: 0, exp1: 0, observer };
  checkCombat(ok);
  checkCombat({ ...ok, hpTrail: [100, 40], killed: true, exp0: 10, exp1: 25 });
  assert.throws(() => checkCombat({ ...ok, attacksSent: 0 }));
  assert.throws(() => checkCombat({ ...ok, echoes: 0 }));
  assert.throws(() => checkCombat({ ...ok, hpTrail: [100, 100] }));
  assert.throws(() => checkCombat({ ...ok, hpTrail: [100, 40], killed: true, exp0: 10, exp1: 10 }));
  assert.throws(() => checkCombat({ ...ok, hpTrail: [100, 60, 90] }));
  checkCombat({ ...ok, observer: { ...observer, hpTrail: [100, 70] } });
  assert.throws(() => checkCombat({ ...ok, observer: { ...observer, hpTrail: [100, 100] } }));
  for (const bad of [undefined, { ...observer, sawTarget: false }, { ...observer, echoes: 0 },
    { ...observer, hpTrail: [100], sawKill: false }])
    assert.throws(() => checkCombat({ ...ok, observer: bad }));
  assert.throws(() => checkCombat({ ...ok, died: true }));
  assert.throws(() => checkCombat({ ...ok, lost: true }));
  assert.throws(() => checkCombat({ ...ok, hpTrail: [100] }));
});

test('post-combat relogin preserves progression and equipment, allowing city spawn and regenerated HP', () => {
  const before = { name: 'fixture', characterClass: 0, equip: [1, 1103], look: [1, 2],
    level: 2, exp: 125, hp: 40, x: 2588.5, y: 2096.5 };
  const after = { ...before, hp: 100, x: 2090.5, y: 2095.5 };
  checkCombatRelogin(before, after);
  for (const change of [{ name: 'other' }, { characterClass: 1 }, { equip: [1] },
    { look: [2] }, { level: 1 }, { exp: 124 }, { x: 2588.5 }])
    assert.throws(() => checkCombatRelogin(before, { ...after, ...change }));
});
test('persistence compares stable data and permits regenerated HP', () => {
  const before = { name: 'fixture', level: 1, maxHp: 100, maxMp: 50,
    str: 12, int: 12, dex: 12, con: 12, hp: 30, equip: [1, 1103] };
  checkPreview({ ...before, hp: 100 }, before);
  assert.throws(() => checkPreview({ ...before, equip: [1, 0] }, before));
  assert.throws(() => checkPreview({ ...before, str: 0 }, before));
});
test('spawn and teleport use server bounds, not proximity to an arbitrary previous point', () => {
  checkArmiaSpawn({ x: 2086.5, y: 2107.5 });
  checkArmiaSpawn({ x: 2083.5, y: 2090.5 });
  assert.throws(() => checkArmiaSpawn({ x: 2104.5, y: 2100.5 }));
  checkTeleport({ x: 2590.5, y: 2098.5, groundX: 20, groundY: 16 });
  assert.throws(() => checkTeleport({ x: 2600, y: 2096, groundX: 20, groundY: 16 }));
  assert.throws(() => checkTeleport({ x: 2588.5, y: 2096.5, groundX: 16, groundY: 16 }));
});

test('death and respawn require server death, recall packets, city spawn and an observer', () => {
  const ok = { died: true, hpAtDeath: 0, mobHits: 3, box: 11, sent: ['0x03a0', '0x03ae', '0x0289'],
    before: { level: 1, exp: 548 },
    after: { x: 2090.5, y: 2100.5, hp: 2, maxHp: 105, die: 0, level: 1, exp: 548 },
    observer: { sawRespawn: true } };
  checkRespawn(ok);
  assert.doesNotThrow(() => validateOptions(options('login,enter,second,death')));
  for (const bad of [{ died: false }, { hpAtDeath: 5 }, { mobHits: 0 }, { box: 16 },
    { sent: ['0x0289'] }, { sent: ['0x03ae'] }, { observer: { sawRespawn: false } }, { observer: undefined }])
    assert.throws(() => checkRespawn({ ...ok, ...bad }));
  for (const after of [{ x: 2588.5, y: 2096.5 }, { hp: 0 }, { die: 1 }, { level: 2 }, { exp: 500 }])
    assert.throws(() => checkRespawn({ ...ok, after: { ...ok.after, ...after } }));
  // Above the gate the server may subtract EXP, never add it.
  checkRespawn({ ...ok, before: { level: 40, exp: 1000 }, after: { ...ok.after, level: 40, exp: 900 } });
  assert.throws(() => checkRespawn({ ...ok, before: { level: 40, exp: 1000 }, after: { ...ok.after, level: 40, exp: 1001 } }));
});

test('grinding needs server-paid kills and runs alone with login', () => {
  const g = { kills: [{ id: 1040, hpTrail: [70, 3, 0], exp0: 0, exp1: 274 }],
    start: { level: 1, exp: 0 }, end: { level: 1, exp: 274 }, died: false };
  checkGrind(g);
  for (const bad of [{ kills: [] }, { died: true }, { end: { level: 1, exp: 0 } }, { end: { level: 0, exp: 274 } }])
    assert.throws(() => checkGrind({ ...g, ...bad }));
  for (const k of [{ hpTrail: [70, 70] }, { hpTrail: [70, 20] }, { exp1: 0 }])
    assert.throws(() => checkGrind({ ...g, kills: [{ ...g.kills[0], ...k }] }));
  const opts = p => ({ ...options(p), class: '1', 'grind-level': '4' });
  assert.doesNotThrow(() => validateOptions(opts('login,grind')));
  for (const p of ['grind', 'login,enter,grind', 'login,enter,second,grind'])
    assert.throws(() => validateOptions(opts(p)));
  for (const lvl of ['1', '21', 'x', undefined])
    assert.throws(() => validateOptions({ ...opts('login,grind'), 'grind-level': lvl }));
});

test('learning needs the master list, box 4, the server bit and charged points that persist', () => {
  const l = { skill: 5024, cost: 12, npc: 1100, merchant: 1100, box: 4,
    offered: [5024, 5025, 5026, 5047],
    before: { learned: 0, bonus: 12 }, after: { learned: 1, bonus: 0 }, relogin: { learned: 1, bonus: 0 } };
  checkLearn(l);
  for (const bad of [{ offered: [5025] }, { offered: [5024, 5000] }, { merchant: 1101 }, { box: 11 },
    { before: { learned: 1, bonus: 12 } }, { after: { learned: 0, bonus: 0 } }, { after: { learned: 3, bonus: 0 } },
    { after: { learned: 1, bonus: 6 } }, { relogin: { learned: 0, bonus: 0 } }, { relogin: { learned: 1, bonus: 12 } }])
    assert.throws(() => checkLearn({ ...l, ...bad }));
  const opts = p => ({ ...options(p), class: '1', 'grind-level': '4' });
  assert.doesNotThrow(() => validateOptions(opts('login,learn')));
  assert.doesNotThrow(() => validateOptions(opts('login,grind,learn')));
  assert.throws(() => validateOptions(opts('login,enter,learn')));
});

test('casting needs the belt, the selected slot, server-charged MP and damage', () => {
  const c = { cls: 1, pos: 0, skill: 24, cell: 5024, belt: 24, slot: 0, selected: 0,
    attacksSent: 2, echoes: 3, mpTrail: [110, 104, 106], hpTrail: [70, 40], died: false };
  checkCast(c);
  for (const bad of [{ cell: 5025 }, { belt: 255 }, { selected: 1 }, { attacksSent: 0 }, { echoes: 0 },
    { mpTrail: [110, 110] }, { mpTrail: [110] }, { hpTrail: [70, 70] }, { died: true }])
    assert.throws(() => checkCast({ ...c, ...bad }));
  const opts = p => ({ ...options(p), class: '1', 'grind-level': '4' });
  assert.doesNotThrow(() => validateOptions(opts('login,cast')));
  assert.doesNotThrow(() => validateOptions(opts('login,learn,cast')));
  assert.throws(() => validateOptions(opts('login,enter,cast')));
});
