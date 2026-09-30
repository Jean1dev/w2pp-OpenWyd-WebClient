import test from 'node:test';
import assert from 'node:assert/strict';
import { areaPair, tileDistance, checkAreaAttempt } from './area_checks.mjs';
import { validateOptions } from './world_checks.mjs';

test('castarea requires two sessions, TK, and an isolated scenario', () => {
  const opt = { target: 'localhost:8281', 'client-version': '12000', class: '0', phases: 'login,enter,second,castarea' };
  validateOptions(opt);
  for (const bad of [{ class: '1' }, { phases: 'login,castarea' }, { phases: opt.phases + ',attack' }])
    assert.throws(() => validateOptions({ ...opt, ...bad }));
});

test('area selection uses integer tiles, one-tile area and server range', () => {
  const mob = (id, x, y) => ({ id, x, y, hp: 70, name: 'Gremlin', onScreen: true });
  const me = { x: 0.5, y: 0.5 };
  assert.equal(tileDistance(me, { x: 2.5, y: 2.5 }), 3);
  assert.equal(tileDistance(me, { x: 7.5, y: 0.5 }), 8);
  assert(areaPair(me, [mob(1000, 3.9, 2.9), mob(1001, 4.1, 3.1)]));
  assert.equal(areaPair(me, [mob(1000, 3, 0), mob(1001, 5, 0)]), null);
  assert.equal(areaPair(me, [mob(1000, 5, 0), mob(1001, 6, 0)]), null);
  assert.equal(areaPair(me, [mob(1000, 3, 0), mob(1000, 3, 0)]), null);
});

function fixture() {
  const sent = { sequence: 1, attacker: 5, skill: 0, progress: 3, hp: 0, mp: 0, exp: '0', x: 2184, y: 2102,
    targets: [{ id: 1000, damage: -1 }, { id: 1001, damage: -1 }] };
  const reply = { ...sent, sequence: 2, hp: 100, mp: 97, exp: '6726',
    targets: [{ id: 1000, damage: 40 }, { id: 1001, damage: 35 }] };
  return { attacker: 5, target: 1000, mpBefore: 112, died: false,
    before: [{ id: 1000, hp: 70 }, { id: 1001, hp: 70 }],
    beforeB: [{ id: 1000, hp: 70 }, { id: 1001, hp: 70 }],
    afterA: [{ id: 1000, hp: 30, present: 1 }, { id: 1001, hp: 35, present: 1 }],
    afterB: [{ id: 1000, hp: 30, present: 1 }, { id: 1001, hp: 35, present: 1 }],
    logsA: { lost: 0, out: [sent], in: [reply] },
    logsB: { lost: 0, out: [], in: [structuredClone({ ...reply, sequence: 5 })] } };
}
test('only a unique two-target authoritative result seen by both clients passes', () => {
  assert.deepEqual(checkAreaAttempt(fixture()).hitIds, [1000, 1001]);
  const mutations = [
    c => { c.died = true; },
    c => { c.logsB = null; },
    c => { c.logsA.lost = 1; },
    c => { c.logsB.lost = 1; },
    c => { c.logsA.out.push(structuredClone(c.logsA.out[0])); },
    c => { c.logsA.in.push(structuredClone(c.logsA.in[0])); },
    c => { c.logsB.in = []; },
    c => { c.logsB.out.push(structuredClone(c.logsA.out[0])); },
    c => { c.beforeB[1].hp = 69; },
    c => { c.logsA.in[0].attacker = 6; },
    c => { c.logsA.out[0].skill = 24; },
    c => { c.logsA.out[0].targets[1].damage = -2; },
    c => { c.logsA.in[0].progress++; },
    c => { c.afterA[1].present = 0; },
    c => { c.afterB[1].hp = 70; },
    c => { c.mpBefore = 97; },
    c => { c.target = 1500; },
    c => { c.logsA.in[0].targets[1].damage = 0; c.logsB.in = structuredClone(c.logsA.in); },
    c => { for (const e of [c.logsA.out[0], c.logsA.in[0], c.logsB.in[0]]) e.targets[1].id = 1000; },
    c => { c.logsB.in[0].targets[1].damage = 36; },
  ];
  for (const mutate of mutations) { const c = fixture(); mutate(c); assert.throws(() => checkAreaAttempt(c)); }
});
