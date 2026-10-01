import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTradeSwap, checkTradeReset, checkTradeEvidence, checkTradeEdge, sellPrice, checkDelete } from './trade_checks.mjs';
import { validateOptions } from './world_checks.mjs';

const ef = [[0, 0], [0, 0], [0, 0]];
const bag = (carry, coin) => ({ equip: [{ index: 861, ef }], coin,
  carry: Array.from({ length: 64 }, (_, k) => ({ index: carry[k] ?? 0, ef })) });

test('trade swap moves exactly the offered item and gold', () => {
  const giverBefore = bag({ 13: 412, 14: 400 }, 100), takerBefore = bag({ 0: 400 }, 5);
  const giverAfter = bag({ 14: 400 }, 90), takerAfter = bag({ 0: 400, 1: 412 }, 15);
  assert.deepEqual(checkTradeSwap({ giverBefore, giverAfter, takerBefore, takerAfter, slot: 13, gold: 10 }), { takerSlot: 1 });
  // Duplicated item, item kept, wrong item, gold created or lost, extra slot changed.
  for (const [g, t] of [[giverBefore, takerAfter], [giverAfter, bag({ 0: 400, 1: 413 }, 15)],
    [bag({ 14: 400 }, 100), takerAfter], [giverAfter, bag({ 0: 400, 1: 412 }, 25)],
    [giverAfter, bag({ 1: 412 }, 15)], [bag({}, 90), takerAfter]])
    assert.throws(() => checkTradeSwap({ giverBefore, giverAfter: g, takerBefore, takerAfter: t, slot: 13, gold: 10 }));
  assert.throws(() => checkTradeSwap({ giverBefore: bag({}, 0), giverAfter, takerBefore, takerAfter, slot: 13 }));
});

test('a change resets both checks and evidence is complete', () => {
  const t = { visible: 1, myCheck: 0, opCheck: 0 };
  checkTradeReset(t, t);
  assert.throws(() => checkTradeReset(t, { ...t, opCheck: 1 }));
  assert.throws(() => checkTradeReset({ ...t, visible: 0 }, t));
  const r = { refused: { unchanged: true }, cancelled: { unchanged: true }, forward: { item: 412, takerSees: 412 },
    gold: 10, reset: { a: t, b: t }, swap: { takerSlot: 1 }, relogin: true, back: { takerSlot: 13 } };
  checkTradeEvidence(r);
  for (const bad of [{ refused: { unchanged: false } }, { forward: { item: 412, takerSees: 0 } }, { relogin: false }, { back: undefined }])
    assert.throws(() => checkTradeEvidence({ ...r, ...bad }));
});

test('trade edge: no room rolls back, a disconnect cancels, the filler is sold back', () => {
  const a0 = bag({ 13: 412 }, 100), b0 = bag({ 0: 400 }, 1000);
  const fullCarry = {}; for (let k = 0; k < 30; k++) fullCarry[k] = k === 0 ? 400 : 1774;
  const bFull = bag(fullCarry, 1000 - 29 * 300);
  const r = { a0, b0, bFull, sellPrice: 75,
    fill: { item: 1774, price: 300, freeBefore: 29, freeAfter: 0, bought: Array.from({ length: 29 }, (_, k) => k + 1) },
    full: { offer: { item: 412, takerSees: 412 }, a: a0, b: bFull },
    drop: { offer: { item: 412, takerSees: 412 }, aSawCheck: true, bClosed: true, a: a0, b: bFull },
    cleanup: { sold: 29, b: bag({ 0: 400 }, 1000 - 29 * 225) } };
  checkTradeEdge(r);
  // Filler left by an interrupted run (slot 1 before the fill) is sold back too.
  const pre = { ...r, b0: bag({ 0: 400, 1: 1774 }, 1000), fill: { ...r.fill, freeBefore: 28, preexisting: [1],
    bought: Array.from({ length: 28 }, (_, k) => k + 2) }, cleanup: { sold: 29, b: bag({ 0: 400 }, 1000 - 28 * 300 + 29 * 75) } };
  checkTradeEdge(pre);
  // B already full of leftover filler: nothing bought, all of it sold back.
  const full30 = bag(fullCarry, 1000);
  const leftover = { ...r, b0: full30, bFull: full30, fill: { ...r.fill, freeBefore: 0, bought: [],
    preexisting: Array.from({ length: 29 }, (_, k) => k + 1) }, full: { ...r.full, b: full30 }, drop: { ...r.drop, b: full30 },
    cleanup: { sold: 29, b: bag({ 0: 400 }, 1000 + 29 * 75) } };
  checkTradeEdge(leftover);
  assert.throws(() => checkTradeEdge({ ...leftover, fill: { ...leftover.fill, preexisting: [] } }));
  assert.throws(() => checkTradeEdge({ ...pre, cleanup: { sold: 28, b: bag({ 0: 400, 1: 1774 }, 1000 - 28 * 225) } }));
  for (const bad of [{ fill: { ...r.fill, freeAfter: 1 } }, { full: { ...r.full, b: b0 } }, { full: { ...r.full, a: bag({}, 100) } },
    { drop: { ...r.drop, bClosed: false } }, { drop: { ...r.drop, a: bag({}, 100) } }, { drop: { ...r.drop, b: bag({ 0: 400, 1: 412 }, 0) } },
    { cleanup: { sold: 28, b: r.cleanup.b } }, { cleanup: { sold: 29, b: bag({ 0: 400, 5: 1774 }, 1000 - 29 * 225) } },
    { cleanup: { sold: 29, b: bag({ 0: 400 }, 1000) } }])
    assert.throws(() => checkTradeEdge({ ...r, ...bad }), JSON.stringify(Object.keys(bad)));
  assert.equal(sellPrice(300), 75);
  assert.equal(sellPrice(30000), 5000);
  assert.equal(sellPrice(50000), 6250);
});

test('delete removes only the target slot and survives relogin', () => {
  const before = [{ name: 'Keep', level: 9 }, { name: 'Tmp', level: 0 }, { name: '', level: -1 }, { name: '', level: -1 }];
  const after = [before[0], { name: '', level: -1 }, before[2], before[3]];
  const r = { slot: 1, before, refused: { slots: before, lastRecvOpcode: 0x11b, panelText: 'x' },
    deleted: { slots: after, lastRecvOpcode: 0x112 }, relogin: after };
  checkDelete(r);
  for (const bad of [{ refused: { slots: after, lastRecvOpcode: 0x11b } },
    { refused: { slots: before, lastRecvOpcode: 0x11a } }, { refused: { slots: before, lastRecvOpcode: 0x112 } },
    { refused: { slots: before, lastRecvOpcode: 0x11b, panelText: '' } }, { deleted: { slots: before, lastRecvOpcode: 0x112 } },
    { deleted: { slots: [{ name: '' }, ...after.slice(1)], lastRecvOpcode: 0x112 } }, { relogin: before },
    { relogin: [{ name: 'Keep', level: 8 }, ...after.slice(1)] }, { slot: 2 }])
    assert.throws(() => checkDelete({ ...r, ...bad }));
});

test('trade and delete run as isolated scenarios', () => {
  const opt = { target: 'localhost:8281', 'client-version': '12000', class: '0' };
  validateOptions({ ...opt, phases: 'login,enter,second,trade' });
  validateOptions({ ...opt, phases: 'delete' });
  validateOptions({ ...opt, phases: 'login,enter,second,tradeedge' });
  for (const phases of ['login,enter,trade', 'login,enter,second,trade,party', 'login,delete', 'badpass,delete'])
    assert.throws(() => validateOptions({ ...opt, phases }));
});
