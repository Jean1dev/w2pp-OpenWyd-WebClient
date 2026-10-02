import test from 'node:test';
import assert from 'node:assert/strict';
import { checkParty, checkPartyChat, checkPartyEvidence } from './party_checks.mjs';
import { validateOptions } from './world_checks.mjs';

test('party rejects stale, duplicate, optimistic and incorrectly led membership', () => {
  const rows = [{ id: 7, state: 2, member: 1 }, { id: 8, state: 0, member: 1 }];
  checkParty(rows, [7, 8], 7);
  for (const wrong of [rows.slice(0, 1), [...rows, rows[1]],
    [rows[0], { ...rows[1], state: 1 }], [rows[0], { ...rows[1], member: 0 }]])
    assert.throws(() => checkParty(wrong, [7, 8], 7));
  assert.throws(() => checkParty(rows, [7, 8], 8));
  assert.throws(() => checkPartyEvidence({}));
});

test('party requires two sessions and an isolated scenario', () => {
  const opt = { target: 'localhost:8281', 'client-version': '12000', class: '0' };
  validateOptions({ ...opt, phases: 'login,enter,second,party' });
  for (const phases of ['login,enter,party', 'login,enter,second,party,chat'])
    assert.throws(() => validateOptions({ ...opt, phases }));
});

test('party chat needs both directions, the toggle and the local block outside a party', () => {
  const rows = [{ id: 7, state: 2, member: 1 }, { id: 8, state: 0, member: 1 }];
  const line = { sent: true, lastSent: '0x334', heard: true, senderShown: 'sender', notice: false };
  const ok = { party: { aId: 7, bId: 8, a: rows, b: rows }, leaderSays: line, memberSays: line,
    toggleOff: { confirmed: true }, silenced: { sent: true, heard: false }, toggleOn: { confirmed: true },
    restored: { ...line }, afterLeave: { sent: false, heard: false } };
  checkPartyChat(ok);
  const bad = [{ party: undefined }, { leaderSays: { ...line, heard: false } }, { memberSays: { ...line, senderShown: 'receiver' } },
    { memberSays: { ...line, notice: true } }, { leaderSays: { ...line, lastSent: '0x333' } },
    { toggleOff: { confirmed: false } }, { silenced: { sent: true, heard: true } }, { toggleOn: {} },
    { restored: { heard: false } }, { afterLeave: { sent: true, heard: false } }, { afterLeave: { sent: false, heard: true } }];
  for (const x of bad) assert.throws(() => checkPartyChat({ ...ok, ...x }), JSON.stringify(x));
  const opt = { target: 'localhost:8281', 'client-version': '12000', class: '0' };
  validateOptions({ ...opt, phases: 'login,enter,second,partychat' });
  for (const phases of ['login,enter,partychat', 'login,enter,second,party,partychat'])
    assert.throws(() => validateOptions({ ...opt, phases }));
});

test('buff and cure need a server MP cost, the visible effect and the skill after relogin', async () => {
  const { checkBuff } = await import('./world_checks.mjs');
  const wolf = { skill: 64, pos: 16, kind: 'transform' }, cure = { skill: 27, pos: 3, kind: 'heal' };
  const base = { attempts: 1, attacksSent: 1, relogin: { learned: (1 << 16) | (1 << 3) } };
  const t = { ...base, before: { mp: 126, maxHp: 115, model: 3 }, after: { mp: 95, maxHp: 110, model: 22 },
    observedBefore: { maxHp: 115 }, observedAfter: { maxHp: 110 } };
  checkBuff(t, wolf);
  for (const x of [{ after: { mp: 126, maxHp: 110, model: 22 } }, { after: { mp: 95, maxHp: 110, model: 3 } },
    { after: { mp: 95, maxHp: 115, model: 22 } }, { observedAfter: { maxHp: 115 } },
    { relogin: { learned: 1 << 16, maxHp: 110, model: 3 } },
    { attacksSent: 0 }, { relogin: { learned: 0 } }])
    assert.throws(() => checkBuff({ ...t, ...x }, wolf), JSON.stringify(x));
  const h = { ...base, before: { hp: 20, maxHp: 115, mp: 145, level: 16 }, after: { hp: 115, mp: 130 },
    observedBefore: { hp: 20 }, observedAfter: { hp: 115 } };
  const heal = { in: [{ skill: 27, attacker: 1, hp: 430, targets: [{ id: 1, damage: -100 }] }] };
  Object.assign(h, { logsA: heal, logsB: heal });
  checkBuff(h, cure);
  for (const x of [{ logsA: { in: [] } }, { logsB: { in: [] } },
    { logsB: { in: [{ skill: 27, attacker: 1, hp: 430, targets: [{ id: 1, damage: -50 }] }] } }])
    assert.throws(() => checkBuff({ ...h, ...x }, cure), JSON.stringify(x));
  for (const x of [{ before: { hp: 115, maxHp: 115, mp: 145, level: 16 } }, { after: { hp: 20, mp: 130 } },
    { after: { hp: 66, mp: 130 } }, { observedAfter: { hp: 20 } }])
    assert.throws(() => checkBuff({ ...h, ...x }, cure), JSON.stringify(x));
  const opt = { target: 'localhost:8281', 'client-version': '12000' };
  validateOptions({ ...opt, class: '2', phases: 'login,buff' });
  validateOptions({ ...opt, class: '1', skill: '27', phases: 'login,learn,buff' });
  for (const bad of [{ class: '0', phases: 'login,buff' }, { class: '2', phases: 'login,enter,buff' },
    { class: '2', skill: '5', phases: 'login,learn' }])
    assert.throws(() => validateOptions({ ...opt, ...bad }), JSON.stringify(bad));
});

test('restart keeps what both clients held, including unsaved gold, carry and cargo', async () => {
  const { checkRestart } = await import('./world_checks.mjs');
  const side = { coin: 900, level: 6, exp: '4566', learned: 0, equip: [1, 2], carry: [{ index: 401 }, { index: 1774 }] };
  const ok = { buy: { gained: 1, price: 100, coinBefore: 1053, coinAfter: 953 }, deposit: { amount: 53, cargoBefore: 0 },
    droppedAt: { a: 't', b: 't' }, before: { a: side, b: side, cargo: { coin: 53, items: [0, 7] } },
    after: { a: side, b: side, cargo: { coin: 53, items: [0, 7] } } };
  checkRestart(ok);
  const bad = [{ after: { ...ok.after, a: { ...side, coin: 1053 } } }, { after: { ...ok.after, b: { ...side, exp: '0' } } },
    { after: { ...ok.after, a: { ...side, carry: [{ index: 401 }] } } }, { after: { ...ok.after, cargo: { coin: 0, items: [0, 7] } } },
    { droppedAt: { a: 't' } }, { buy: { gained: 0, price: 100, coinBefore: 1053, coinAfter: 1053 } }];
  for (const x of bad) assert.throws(() => checkRestart({ ...ok, ...x }), JSON.stringify(Object.keys(x)));
  const opt = { target: 'localhost:8281', 'client-version': '12000', class: '0' };
  validateOptions({ ...opt, phases: 'login,enter,second,restart' });
  assert.throws(() => validateOptions({ ...opt, phases: 'login,enter,restart' }));
});

