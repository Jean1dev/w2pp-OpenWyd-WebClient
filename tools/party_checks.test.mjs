import test from 'node:test';
import assert from 'node:assert/strict';
import { checkParty, checkPartyEvidence } from './party_checks.mjs';
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
