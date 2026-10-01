import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTradeSwap, checkTradeReset, checkTradeEvidence, checkDelete } from './trade_checks.mjs';
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
  for (const phases of ['login,enter,trade', 'login,enter,second,trade,party', 'login,delete', 'badpass,delete'])
    assert.throws(() => validateOptions({ ...opt, phases }));
});
