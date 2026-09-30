import assert from 'node:assert/strict';

// BASE_GetDistance / server mobDistance, on integer world tiles.
const DISTANCE = [[0,1,2,3,4,5,6], [1,1,2,3,4,5,6], [2,2,3,4,4,5,6],
  [3,3,4,4,5,5,6], [4,4,4,5,5,5,6], [5,5,5,5,5,6,6], [6,6,6,6,6,6,6]];
export function tileDistance(a, b) {
  const x = Math.abs(Math.trunc(a.x) - Math.trunc(b.x));
  const y = Math.abs(Math.trunc(a.y) - Math.trunc(b.y));
  return x <= 6 && y <= 6 ? DISTANCE[y][x] : Math.max(x, y) + 1;
}
export function areaPair(me, mobs) {
  const live = mobs.filter(m => m.hp > 0 && m.onScreen && m.name.trim() === 'Gremlin' && tileDistance(me, m) <= 5);
  for (const target of live) {
    const other = live.find(m => m.id !== target.id && tileDistance(target, m) <= 1);
    if (other) return [target, other];
  }
  return null;
}

// Same server result, ignoring the per-client arrival sequence.
const resultKey = ({ sequence, ...event }) => JSON.stringify(event);
const matches = (sent, reply) => reply.attacker === sent.attacker && reply.skill === sent.skill &&
  reply.progress === sent.progress && reply.x === sent.x && reply.y === sent.y &&
  JSON.stringify(reply.targets.map(t => t.id)) === JSON.stringify(sent.targets.map(t => t.id));

export function checkAreaAttempt(c) {
  assert(!c.died, 'caster died');
  assert(c.logsA && c.logsB, 'missing observer diagnostics');
  for (const log of [c.logsA, c.logsB]) assert.equal(log.lost, 0, 'combat events overwritten');
  assert.equal(c.logsB.out.length, 0, 'observer attacked during the observation window');
  const sent = c.logsA.out.filter(e => e.attacker === c.attacker);
  assert.equal(sent.length, 1, 'attempt must contain exactly one player attack');
  assert.equal(sent[0].skill, 0, 'not Giro da Furia');
  const replies = c.logsA.in.filter(e => matches(sent[0], e));
  assert.equal(replies.length, 1, 'missing or ambiguous authoritative result');
  const reply = replies[0];
  assert.equal(c.logsB.in.filter(e => resultKey(e) === resultKey(reply)).length, 1,
    'observer did not receive the same unique result');
  const hits = reply.targets.filter(t => t.id >= 1000 && t.damage > 0);
  assert(hits.length >= 2, 'fewer than two damaged mobs in one result');
  assert.equal(new Set(hits.map(t => t.id)).size, hits.length, 'duplicate target IDs');
  assert(hits.some(t => t.id === c.target), 'clicked target not damaged');
  assert(reply.mp < c.mpBefore, 'no authoritative MP consumption');
  for (const h of hits) {
    assert.equal(sent[0].targets.find(t => t.id === h.id)?.damage, -1, 'target was not a skill intention');
    const before = c.before.find(m => m.id === h.id);
    const beforeB = c.beforeB.find(m => m.id === h.id);
    const afterA = c.afterA.find(m => m.id === h.id);
    const afterB = c.afterB.find(m => m.id === h.id);
    assert(before && afterA?.present && afterB?.present, 'target disappeared without HP evidence');
    assert.equal(beforeB?.hp, before.hp, 'observer baseline differs');
    const expected = Math.max(0, before.hp - h.damage);
    assert.equal(afterA.hp, expected, 'A HP disagrees with authoritative damage');
    assert.equal(afterB.hp, expected, 'B HP disagrees with authoritative damage');
  }
  return { reply, hitIds: hits.map(t => t.id) };
}
