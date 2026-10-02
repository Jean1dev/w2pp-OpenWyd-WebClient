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

// Party chat ("=text", 0x0334 with an empty MobName; _MSG_MessageWhisper.cpp
// "Chat Party"): each member hears the other under the speaker's name, the
// "partychat" toggle silences the channel for whoever sent it and reports
// both states, and outside a party the runtime does not even send the line.
export function checkPartyChat(r) {
  assert(r.party, 'party not formed');
  checkParty(r.party.a, [r.party.aId, r.party.bId], r.party.aId);
  checkParty(r.party.b, [r.party.aId, r.party.bId], r.party.aId);
  for (const [key, who] of [['leaderSays', 'B'], ['memberSays', 'A']]) {
    const s = r[key];
    assert(s?.sent, `${key}: line not sent`);
    assert.equal(s.lastSent, '0x334', `${key}: not sent as MSG_MessageWhisper`);
    assert.equal(s.heard, true, `${key}: ${who} did not show the party line`);
    assert.equal(s.senderShown, 'sender', `${key}: ${who} did not show the speaker's name`);
    assert.equal(s.notice, false, `${key}: speaker got a notice (party line taken as a whisper)`);
  }
  assert.equal(r.toggleOff?.confirmed, true, 'partychat off not confirmed');
  assert(r.silenced?.sent, 'line during partychat off not sent');
  assert.equal(r.silenced.heard, false, 'member with partychat off still heard the party line');
  assert.equal(r.toggleOn?.confirmed, true, 'partychat on not confirmed');
  assert.equal(r.restored?.heard, true, 'party line not heard after partychat on');
  assert.equal(r.afterLeave?.sent, false, 'runtime sent a party line without a party');
  assert.equal(r.afterLeave.heard, false, 'former member heard the party line');
}
