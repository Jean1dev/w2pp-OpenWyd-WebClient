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

// Server sell price (shop.go sell): Price/4, halved above 10000, 2/3 above 5000.
export function sellPrice(price) {
  let sp = Math.floor(price / 4);
  if (sp > 10000) sp = Math.floor(sp / 2);
  else if (sp > 5000) sp = Math.floor(2 * sp / 3);
  return sp;
}

// Trade edge cases: no room on the taker rolls the swap back with nothing
// moved; a disconnect mid-trade closes the partner's window with nothing moved;
// the filler bought to fill B is sold back.
export function checkTradeEdge(r) {
  const n = r.fill.bought.length, pre = r.fill.preexisting ?? [];
  // B may start full with filler an interrupted run left: then nothing is bought.
  assert(n === r.fill.freeBefore && n + pre.length > 0, `bought ${n} of ${r.fill.freeBefore} free slots`);
  assert(r.fill.bought.every(x => x >= 0 && x < 30), 'filler outside the 30 base slots');
  assert.equal(r.fill.freeAfter, 0, 'B still has room');
  assert.equal(r.full.offer.takerSees, r.full.offer.item, 'full: offer not forwarded');
  assert.deepEqual(r.full.a, r.a0, 'full: A changed');
  assert.deepEqual(r.full.b, r.bFull, 'full: B changed');
  assert.equal(r.drop.offer.takerSees, r.drop.offer.item, 'drop: offer not forwarded');
  assert(r.drop.aSawCheck, "drop: A did not see B's check");
  assert(r.drop.bClosed, "drop: B's window stayed open after A left");
  assert.deepEqual(r.drop.a, r.a0, 'drop: A changed');
  assert.deepEqual(r.drop.b, r.bFull, 'drop: B changed');
  assert.equal(r.cleanup.sold, n + pre.length, 'cleanup: not all filler sold');
  const start = r.b0.carry.map((it, x) => pre.includes(x) ? { ...it, index: 0, ef: [[0, 0], [0, 0], [0, 0]] } : it);
  assert.deepEqual(r.cleanup.b.carry, start, 'cleanup: B carry differs from the start');
  assert.equal(r.cleanup.b.coin, r.b0.coin - n * r.fill.price + (n + pre.length) * r.sellPrice, 'cleanup: B gold');
}

// Character deletion (stage 3): wrong password refused, right one removes only
// the target slot; a relogin shows the same list.
export function checkDelete(r) {
  const names = slots => slots.map(s => s.name);
  assert(r.slot >= 0 && r.slot < 4, 'invalid slot');
  assert(r.before[r.slot].name, 'target slot empty before delete');
  assert.deepEqual(names(r.refused.slots), names(r.before), 'wrong password changed the list');
  // DeleteCharacterFail, as the legacy ProcessDBMessage.cpp:641-649 and the
  // server since 2e532afa (PR #359); 0x011A is the old create-failure reply.
  assert.equal(r.refused.lastRecvOpcode, 0x11b, 'wrong password not answered with DeleteCharacterFail');
  assert(r.refused.panelText, 'refusal message (string 20) not shown');
  assert.equal(r.deleted.lastRecvOpcode, 0x112, 'missing CNFDeleteCharacter');
  const expected = names(r.before).map((n, k) => k === r.slot ? '' : n);
  assert.deepEqual(names(r.deleted.slots), expected, 'delete removed the wrong slot');
  assert.deepEqual(names(r.relogin), expected, 'relogin list differs');
  r.before.forEach((s, k) => {
    if (k !== r.slot && s.name) assert.equal(r.relogin[k].level, s.level, `slot ${k} level changed`);
  });
}
