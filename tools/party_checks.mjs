import assert from 'node:assert/strict';

// Compare observed runtime rows to the server-confirmed membership expected
// by the scenario. Pending invitations are not membership.
export function checkParty(rows, ids, leader) {
  assert.deepEqual(rows.map(r => r.id).sort((a, b) => a - b), [...ids].sort((a, b) => a - b),
    'party members missing, duplicated or stale');
  for (const row of rows) {
    assert.equal(row.state, row.id === leader ? 2 : 0, 'wrong leader or pending invitation');
    assert.equal(row.member, 1, 'confirmed party not reflected on entity');
  }
}

export function checkPartyEvidence(r) {
  for (const key of ['accepted', 'repeated', 'rejoined']) {
    const s = r[key];
    assert(s, `missing ${key}`);
    checkParty(s.a, [s.aId, s.bId], s.aId);
    checkParty(s.b, [s.aId, s.bId], s.aId);
  }
  for (const key of ['refused', 'left', 'kicked', 'memberDisconnected', 'leaderDisconnected']) {
    assert(r[key], `missing ${key}`);
    for (const rows of Object.values(r[key])) assert.deepEqual(rows, [], `${key}: stale rows`);
  }
  assert.equal(r.inventoryPreserved, true, 'group scenario changed inventory or coin');
}
