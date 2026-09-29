import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOptions, checkHealth, checkPreview, checkArmiaSpawn, checkTeleport, checkCombat, checkCombatRelogin, redactEvidence } from './world_checks.mjs';

test('redaction removes nested diagnostic strings without corrupting JSON numbers', () => {
  const value = { error: 'fixture-secret', nested: ['prefix fixture-secret suffix'], x: 123456 };
  const clean = redactEvidence(value, ['fixture-secret', '123456']);
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), {
    error: '<redacted>', nested: ['prefix <redacted> suffix'], x: 123456,
  });
});

const options = phases => ({ target: 'localhost:8281', 'client-version': '12000', class: '0', phases });
test('rejects incomplete, unknown and duplicate scenarios before connecting', () => {
  for (const phases of ['', 'logout', 'login,enter,mapchange', 'login,enter,attack', 'login,enter,typo', 'login,login'])
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
