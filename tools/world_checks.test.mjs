import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOptions, checkHealth, checkPreview, checkArmiaSpawn, checkTeleport, checkCombat, checkCombatRelogin, checkRespawn, checkGrind, checkLearn, checkCast, redactEvidence,
  itemAmount, checkEquip, checkPotion, checkLoot, checkInventoryRelogin, checkShop, checkBank, checkPaidTeleport, checkChat,
  checkSettings, musicCentibels, musicElementVolume } from './world_checks.mjs';

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
  // Outbound: only the listed MoveStop (no server route) may be dropped.
  const out = d => p({ inDropUnknown: 0, droppedIn: [], ...d });
  checkHealth(out({ outDropUnknown: 1, droppedOut: [{ opcode: '0x02cb', times: 1 }] }));
  assert.throws(() => checkHealth(out({ outDropUnknown: 1, droppedOut: [{ opcode: '0x0333', times: 1 }] })));
  assert.throws(() => checkHealth(out({ outDropUnknown: 2, droppedOut: [{ opcode: '0x02cb', times: 1 }] })));
  assert.throws(() => checkHealth(out({ outDropUnknown: 1, droppedOut: [] })));
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
  // Huntress (class 3): bit 8 of the mask, list 5072..5095.
  const ht = { ...l, skill: 5080, cost: 18, offered: [5072, 5080, 5095],
    before: { learned: 0, bonus: 18 }, after: { learned: 1 << 8, bonus: 0 }, relogin: { learned: 1 << 8, bonus: 0 } };
  checkLearn(ht);
  for (const bad of [{ offered: [5024, 5080] }, { after: { learned: 1, bonus: 0 } }, { relogin: { learned: 1, bonus: 0 } }])
    assert.throws(() => checkLearn({ ...ht, ...bad }));
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
  // Huntress: skill 80 sits in cell 8 of the class window.
  checkCast({ ...c, cls: 3, pos: 8, skill: 80, cell: 5080, belt: 80 });
  assert.throws(() => checkCast({ ...c, cls: 3, pos: 8, skill: 80, cell: 5072, belt: 80 }));
  // Transknight area skill: the target must be among the mobs hit.
  const area = { ...c, cls: 0, pos: 0, skill: 0, cell: 5000, belt: 0, area: true, target: { id: 1036 },
    nearby: 3, hitMobs: [1036, 1040] };
  checkCast(area);
  for (const bad of [{ hitMobs: [] }, { hitMobs: [1040] }, { hitMobs: undefined }, { nearby: 1 }])
    assert.throws(() => checkCast({ ...area, ...bad }));
  const opts = p => ({ ...options(p), class: '1', 'grind-level': '4' });
  assert.doesNotThrow(() => validateOptions(opts('login,cast')));
  assert.doesNotThrow(() => validateOptions(opts('login,learn,cast')));
  assert.throws(() => validateOptions(opts('login,enter,cast')));
});

// ---- items (stage 5, slice 2) ----
const it = (index, ...ef) => ({ index, ef: [...ef, [0, 0], [0, 0], [0, 0]].slice(0, 3) });
const empty = () => it(0);
const bagOf = (equip, carry, extra = {}) => ({
  equip: Array.from({ length: 16 }, (_, i) => equip[i] ?? empty()),
  carry: Array.from({ length: 64 }, (_, i) => carry[i] ?? empty()),
  coin: 1000, level: 8, exp: 5000, damage: 40, ac: 20, hp: 300, maxHp: 400, ...extra,
});

test('item amount reads EF_AMOUNT and counts a plain item as one', () => {
  assert.equal(itemAmount(it(401, [61, 119])), 119);
  assert.equal(itemAmount(it(1805)), 1);
  assert.equal(itemAmount(empty()), 0);
  assert.equal(itemAmount(undefined), 0);
});

test('inventory relogin compares every slot, effects, coin and progression', () => {
  const a = bagOf({ 6: it(861) }, { 0: it(401, [61, 120]) });
  checkInventoryRelogin(a, structuredClone(a));
  for (const change of [b => { b.carry[0] = it(401, [61, 119]); }, b => { b.equip[6] = empty(); },
    b => { b.carry[20] = it(400); }, b => { b.coin++; }, b => { b.exp++; }, b => { b.level++; }]) {
    const b = structuredClone(a);
    change(b);
    assert.throws(() => checkInventoryRelogin(a, b));
  }
});

test('equip needs the picked item, the server echo, a recomputed score, B and an unchanged refusal', () => {
  const weapon = it(861, [2, 10]);
  const before = bagOf({ 6: weapon }, { 0: it(401, [61, 120]) });
  const off = bagOf({}, { 0: it(401, [61, 120]), 1: weapon }, { damage: 12 });
  const on = structuredClone(before);
  const e = { slot: 6, free: 1, item: 861, before, off, on,
    unequip: { expect: 861, picked: 861, swapsSent: 1 }, equip: { expect: 861, picked: 861, swapsSent: 1 },
    observer: { sawOff: true, sawOn: true },
    refused: { cursor: 0, bag: { equip: on.equip, carry: on.carry } }, relogin: structuredClone(on) };
  checkEquip(e);
  // Login snapshot = template score: before may equal the unequipped value.
  checkEquip({ ...e, before: { ...before, damage: 12 } });
  const bad = [
    { unequip: { expect: 861, picked: 0, swapsSent: 1 } }, { equip: { expect: 861, picked: 861, swapsSent: 0 } },
    { off: { ...off, damage: 40 } }, { off: bagOf({ 6: weapon }, { 0: it(401, [61, 120]) }, { damage: 12 }) },
    { on: { ...on, damage: 12 } }, { on: { ...on, carry: off.carry } }, { observer: { sawOff: false, sawOn: true } }, { observer: { sawOff: true, sawOn: false } },
    { refused: { cursor: 401, bag: { equip: on.equip, carry: on.carry } } },
    { refused: { cursor: 0, bag: { equip: on.equip, carry: off.carry } } },
    { relogin: bagOf({}, { 0: it(401, [61, 120]) }) },
  ];
  for (const b of bad) assert.throws(() => checkEquip({ ...e, ...b }), JSON.stringify(Object.keys(b)));
});

test('potion needs missing HP, one unit per use, a heal B sees and the same count after relogin', () => {
  const after = bagOf({}, { 0: it(401, [61, 117]) });
  const p = { slot: 0, amount0: 120, hpBefore: 300, maxHp: 400,
    use: { usesSent: 1, amount: 119, hp: 400 }, observer: { hpBefore: 300, hpAfter: 400 },
    double: { usesSent: 2, amount: 117, bag: { equip: after.equip, carry: after.carry } },
    empty: { usesSent: 0, bag: { equip: after.equip, carry: after.carry } },
    beforeRelogin: after, relogin: structuredClone(after) };
  checkPotion(p);
  checkPotion({ ...p, double: { ...p.double, amount: 118 }, beforeRelogin: bagOf({}, { 0: it(401, [61, 118]) }),
    relogin: bagOf({}, { 0: it(401, [61, 118]) }) });
  const bad = [
    { hpBefore: 400 }, { use: { usesSent: 0, amount: 119, hp: 400 } }, { use: { usesSent: 1, amount: 118, hp: 400 } },
    { use: { usesSent: 1, amount: 119, hp: 300 } }, { use: { usesSent: 1, amount: 119, hp: 330 } },
    { observer: { hpBefore: 300, hpAfter: 300 } },
    { double: { ...p.double, amount: 119 } }, { double: { ...p.double, amount: 116 } },
    { empty: { usesSent: 0, bag: { equip: after.equip, carry: bagOf({}, {}).carry } } },
    { relogin: bagOf({}, { 0: it(401, [61, 118]) }) },
  ];
  for (const b of bad) assert.throws(() => checkPotion({ ...p, ...b }), JSON.stringify(Object.keys(b)));
});

test('loot needs server-paid kills that only add to carry or coin, kept after relogin', () => {
  const end = bagOf({}, { 0: it(401, [61, 120]), 2: it(1805) }, { coin: 1270 });
  const l = { kills: [{ id: 1037 }], coinGain: 270, itemGain: [{ slot: 2, before: 0, after: 1 }], lost: [],
    start: { coin: 1000 }, end, relogin: structuredClone(end) };
  checkLoot(l);
  checkLoot({ ...l, itemGain: [] });
  checkLoot({ ...l, coinGain: 0 });
  for (const b of [{ kills: [] }, { coinGain: 0, itemGain: [] }, { lost: [{ slot: 0 }] },
    { itemGain: [{ slot: 2, before: 1, after: 1 }] }, { start: { coin: 2000 } }, { relogin: { ...end, coin: 1000 } }])
    assert.throws(() => checkLoot({ ...l, ...b }), JSON.stringify(Object.keys(b)));
});

test('item phases run alone after both sessions entered; loot runs with login', () => {
  assert.doesNotThrow(() => validateOptions(options('login,enter,second,equip')));
  assert.throws(() => validateOptions(options('login,enter,equip')));
  assert.throws(() => validateOptions(options('login,enter,second,move,equip')));
  assert.doesNotThrow(() => validateOptions(options('login,enter,second,death,potion')));
  assert.throws(() => validateOptions(options('login,enter,second,potion')));
  assert.throws(() => validateOptions(options('login,enter,second,attack,death,potion')));
  assert.throws(() => validateOptions(options('login,enter,second,equip,potion')));
  assert.doesNotThrow(() => validateOptions(options('login,loot')));
  assert.doesNotThrow(() => validateOptions({ ...options('login,grind,loot'), 'grind-level': '4' }));
  assert.throws(() => validateOptions(options('login,enter,loot')));
  assert.throws(() => validateOptions(options('loot')));
});

test('slice 3 phases: shop and bank alone with login,enter; chat with B', () => {
  assert.doesNotThrow(() => validateOptions(options('login,enter,shop')));
  assert.doesNotThrow(() => validateOptions(options('login,enter,bank')));
  assert.doesNotThrow(() => validateOptions(options('login,enter,second,chat')));
  assert.throws(() => validateOptions(options('login,shop')));
  assert.throws(() => validateOptions(options('login,enter,second,shop')));
  assert.throws(() => validateOptions(options('login,enter,shop,bank')));
  assert.throws(() => validateOptions(options('login,enter,chat')));
  assert.throws(() => validateOptions(options('login,enter,second,move,chat')));
});

test('shop needs a server-confirmed sale and purchase, a silent refusal and paid repeats kept after relogin', () => {
  const end = bagOf({}, { 0: it(401, [61, 120]), 1: it(400), 2: it(400) }, { coin: 20 });
  const s = { merchant: 12474, cells: [{ item: 400, price: 10 }],
    sell: { sent: 1, after: { index: 0 }, coinBefore: 0, coinAfter: 50 },
    buy: { sent: 1, gained: 1, coinBefore: 50, coinAfter: 40 },
    poor: { sent: 1, coinBefore: 40, coinAfter: 40, gained: 0 },
    repeat: { sent: 2, coinBefore: 40, coinAfter: 20, gained: 2 },
    beforeRelogin: end, relogin: structuredClone(end) };
  checkShop(s);
  checkShop({ ...s, poor: undefined, repeat: { sent: 1, coinBefore: 40, coinAfter: 30, gained: 1 } });
  // Two units on one purchase (button held across frames), each paid.
  checkShop({ ...s, buy: { sent: 2, gained: 2, coinBefore: 60, coinAfter: 40 } });
  const bad = [
    { cells: [] }, { sell: { ...s.sell, sent: 0 } }, { sell: { ...s.sell, after: { index: 7 } } },
    { sell: { ...s.sell, coinAfter: 0 } }, { buy: { ...s.buy, gained: 0 } }, { buy: { ...s.buy, coinAfter: 50 } },
    { poor: { ...s.poor, coinAfter: 30 } }, { poor: { ...s.poor, gained: 1 } },
    { repeat: { sent: 2, coinBefore: 40, coinAfter: 30, gained: 2 } },
    { buy: { sent: 2, gained: 2, coinBefore: 60, coinAfter: 45 } },
    { relogin: bagOf({}, { 0: it(401, [61, 120]), 1: it(400) }, { coin: 20 }) },
    { relogin: { ...structuredClone(end), coin: 30 } },
  ];
  for (const b of bad) assert.throws(() => checkShop({ ...s, ...b }), JSON.stringify(Object.keys(b)));
});

test('bank moves gold both ways by the amount, refuses overdraws and keeps both pools after relogin', () => {
  const b = { opened: true, amount: 25,
    deposit: { coinBefore: 50, cargoBefore: 0, coin: 25, cargo: 25 },
    withdraw: { coin: 50, cargo: 0 },
    overdraw: { sent: 1, coin: 50, cargo: 0 }, overdeposit: { sent: 0, coin: 50, cargo: 0 },
    store: { item: 400, cargoItem: 400, carryItem: 0 }, fetch: { carryItem: 400 },
    keep: { amount: 37, sent: 1, coin: 13, cargo: 37 },
    relogin: { coin: 13, cargo: 37 }, restore: { coin: 50, cargo: 0 } };
  checkBank(b);
  const bad = [
    { opened: false }, { deposit: { ...b.deposit, cargo: 0 } }, { deposit: { ...b.deposit, coin: 50 } },
    { withdraw: { coin: 25, cargo: 25 } }, { overdraw: { sent: 0, coin: 50, cargo: 0 } },
    { overdraw: { sent: 1, coin: 1050, cargo: -1000 } }, { overdeposit: { sent: 1, coin: 50, cargo: 0 } },
    { store: { item: 400, cargoItem: 0, carryItem: 400 } }, { fetch: { carryItem: 0 } },
    { relogin: { coin: 50, cargo: 25 } }, { relogin: { coin: 13, cargo: 0 } }, { relogin: { coin: 50, cargo: 0 } },
    { keep: { amount: 37, sent: 0, coin: 13, cargo: 37 } }, { keep: { amount: 37, sent: 1, coin: 50, cargo: 37 } },
    { restore: { coin: 13, cargo: 37 } },
  ];
  for (const x of bad) assert.throws(() => checkBank({ ...b, ...x }), JSON.stringify(Object.keys(x)));
});

test('paid portal charges the price once, refuses without it and keeps the charge after relogin', () => {
  const t = { paid: { lastSent: 0x290, moved: 900, nearNoatum: true, coinBefore: 1000, coinAfter: 300 },
    back: { sent: true }, parked: { sent: 1, amount: 800 },
    refused: { lastSent: 0x290, moved: 0, coinBefore: 500, coinAfter: 500 },
    restore: { sent: 1, coin: 300 }, relogin: { coin: 300 } };
  checkPaidTeleport(t, 700);
  const bad = [
    { paid: { ...t.paid, coinAfter: 1000 } }, { paid: { ...t.paid, nearNoatum: false } }, { paid: { ...t.paid, lastSent: 0x36c } },
    { refused: { ...t.refused, moved: 900 } }, { refused: { ...t.refused, coinAfter: 0 } }, { refused: { ...t.refused, coinBefore: 800 } },
    { restore: { sent: 1, coin: 1000 } }, { relogin: { coin: 1000 } }, { back: { sent: false } },
  ];
  for (const x of bad) assert.throws(() => checkPaidTeleport({ ...t, ...x }, 700), JSON.stringify(Object.keys(x)));
  validateOptions(options('login,enter,paidteleport'));
  assert.throws(() => validateOptions(options('login,enter,second,paidteleport')));
});

test('chat needs B to show the line and the whisper, and the /city commands to move A by the server', () => {
  const c = { say: { sent: true, heard: true }, whisper: { sent: true, heard: true },
    teleport: { moved: 400, bLost: true }, back: { moved: 400 } };
  checkChat(c);
  const bad = [
    { say: { sent: true, heard: false } }, { whisper: { sent: false, heard: true } },
    { teleport: { moved: 3, bLost: true } }, { teleport: { moved: 400, bLost: false } }, { back: { moved: 0 } },
  ];
  for (const x of bad) assert.throws(() => checkChat({ ...c, ...x }), JSON.stringify(Object.keys(x)));
});

test('settings: music levels follow the original curve, mute survives a zone change, relogin restores', () => {
  assert.equal(musicCentibels(50), -1500);
  assert.equal(musicCentibels(0), -10000);
  assert.equal(musicElementVolume(-10000), 0);
  const m = level => ({ level, cB: musicCentibels(level), audioVolume: musicElementVolume(musicCentibels(level)) });
  const point = (x, y) => ({ expected: [x, y], got: [x + 1, y] });
  const res = (resolution, fit = false) => ({ resolution, canvas: resolution, fit, inField: true,
    displayed: fit ? [1550, 1240] : [1036, 829],
    points: [point(256, 192)], walk: { from: [2100, 2100], to: [2103, 2101] } });
  const ok = { slider: { musicLevel: 50, effectsLevel: 40, effects: 40, music: m(50) },
    mute: { music: m(0) },
    zone: { teleported: true, playCallsBefore: 1, playCallsAfter: 2, music: m(0) },
    relogin: { saved: { music: 35, effects: 0 }, beforeEnter: { music: 35, effects: 0 }, music: m(35) },
    resolutions: [res('1024x768'), res('1280x1024'), res('1280x1024', true)] };
  checkSettings(ok);
  const bad = patch => assert.throws(() => checkSettings({ ...structuredClone(ok), ...patch }));
  // Original -30 dB on a zone change while muted: audible, must fail.
  bad({ zone: { ...ok.zone, music: { level: 0, cB: -3000, audioVolume: musicElementVolume(-3000) } } });
  bad({ zone: { ...ok.zone, playCallsAfter: 1 } });
  bad({ relogin: { ...ok.relogin, beforeEnter: { music: 50, effects: 40 } } });
  bad({ resolutions: [res('1024x768'), { ...res('1280x1024'), points: [{ expected: [640, 512], got: [512, 410] }] }, res('1280x1024', true)] });
  bad({ resolutions: [res('1024x768'), res('1280x1024')] });
  bad({ mute: { music: m(50) } });
  // "fit" that did not enlarge (the canvas already shrunk by max-width) proves nothing.
  bad({ resolutions: [res('1024x768'), res('1280x1024'), { ...res('1280x1024', true), displayed: [1036, 828] }] });
  assert.throws(() => validateOptions({ target: 'h:1', 'client-version': '12000', class: '0', phases: 'login,enter,second,settings' }));
  validateOptions({ target: 'h:1', 'client-version': '12000', class: '0', phases: 'login,create,enter,settings' });
});
