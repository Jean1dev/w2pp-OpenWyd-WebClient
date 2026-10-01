import assert from 'node:assert/strict';

// Server-confirmed P2P trade (0x0383/0x0386/0x0185/0x0384), stage 5 slice 4.
// Inputs are bag() snapshots: { equip, carry: [{ index, ef }], coin }.

const same = (x, y) => x.index === y.index && JSON.stringify(x.ef) === JSON.stringify(y.ef);

// One item (carry slot `slot` of the giver) and `gold` moved from giver to
// taker. Everything else on both sides is unchanged.
export function checkTradeSwap({ giverBefore, giverAfter, takerBefore, takerAfter, slot, gold = 0 }) {
  const item = giverBefore.carry[slot];
  assert(item.index > 0, 'offered slot was empty');
  assert.equal(giverAfter.carry[slot].index, 0, 'offered item still with the giver');
  giverBefore.carry.forEach((c, k) => { if (k !== slot) assert(same(c, giverAfter.carry[k]), `giver slot ${k} changed`); });
  const changed = takerBefore.carry.map((c, k) => same(c, takerAfter.carry[k]) ? -1 : k).filter(k => k >= 0);
  assert.equal(changed.length, 1, `taker changed ${changed.length} slots`);
  const [to] = changed;
  assert.equal(takerBefore.carry[to].index, 0, 'item landed on an occupied slot');
  assert(same(takerAfter.carry[to], item), 'taker received a different item');
  assert.equal(giverAfter.coin, giverBefore.coin - gold, 'giver gold');
  assert.equal(takerAfter.coin, takerBefore.coin + gold, 'taker gold');
  assert.deepEqual(giverAfter.equip, giverBefore.equip, 'giver equipment changed');
  assert.deepEqual(takerAfter.equip, takerBefore.equip, 'taker equipment changed');
  return { takerSlot: to };
}

// A change after a check resets both checks (legacy _MSG_Trade).
export function checkTradeReset(a, b) {
  for (const [who, t] of [['giver', a], ['taker', b]]) {
    assert.equal(t.visible, 1, `${who} window closed on change`);
    assert.equal(t.myCheck, 0, `${who} own check survived the change`);
    assert.equal(t.opCheck, 0, `${who} partner check survived the change`);
  }
}

export function checkTradeEvidence(r) {
  for (const key of ['refused', 'cancelled']) {
    assert(r[key], `missing ${key}`);
    assert.equal(r[key].unchanged, true, `${key} changed inventory or gold`);
  }
  assert(r.forward && r.forward.takerSees === r.forward.item, 'offer not forwarded to the partner');
  if (r.gold > 0) checkTradeReset(r.reset.a, r.reset.b);
  assert(r.swap?.takerSlot >= 0, 'missing swap');
  assert.equal(r.relogin, true, 'relogin changed the traded state');
  assert(r.back?.takerSlot >= 0, 'missing return trade');
}

// Character deletion (stage 3): wrong password refused, right one removes only
// the target slot; a relogin shows the same list.
export function checkDelete(r) {
  const names = slots => slots.map(s => s.name);
  assert(r.slot >= 0 && r.slot < 4, 'invalid slot');
  assert(r.before[r.slot].name, 'target slot empty before delete');
  assert.deepEqual(names(r.refused.slots), names(r.before), 'wrong password changed the list');
  assert.notEqual(r.refused.lastRecvOpcode, 0x112, 'wrong password answered with CNFDeleteCharacter');
  assert.equal(r.deleted.lastRecvOpcode, 0x112, 'missing CNFDeleteCharacter');
  const expected = names(r.before).map((n, k) => k === r.slot ? '' : n);
  assert.deepEqual(names(r.deleted.slots), expected, 'delete removed the wrong slot');
  assert.deepEqual(names(r.relogin), expected, 'relogin list differs');
  r.before.forEach((s, k) => {
    if (k !== r.slot && s.name) assert.equal(r.relogin[k].level, s.level, `slot ${k} level changed`);
  });
}
