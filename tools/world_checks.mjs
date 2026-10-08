// Pure acceptance rules for the real-server harness (no mock multiplayer).
import assert from 'node:assert/strict';

export function redactEvidence(value, secrets) {
  if (typeof value === 'string') {
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
      value = value.split(secret).join('<redacted>');
    return value;
  }
  if (Array.isArray(value)) return value.map(v => redactEvidence(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactEvidence(v, secrets)]));
  return value;
}

export const PHASES = ['badpass', 'badpin', 'classes', 'login', 'create', 'enter',
  'inventory', 'second', 'move', 'logout', 'mapchange', 'attack', 'death', 'grind', 'learn', 'cast', 'buff', 'healother', 'castarea',
  'equip', 'potion', 'loot', 'shop', 'trash', 'bank', 'paidteleport', 'chat', 'party', 'partychat', 'guildchat', 'restart', 'trade', 'tradeedge', 'delete', 'concurrent', 'settings'];

export function validateOptions(opt) {
  assert.match(opt.target ?? '', /^[a-zA-Z0-9.-]+:[0-9]+$/, '--target host:port is required');
  const port = Number(opt.target.split(':')[1]);
  assert(port > 0 && port <= 65535, 'invalid target port');
  assert(/^\d+$/.test(opt['client-version']) && Number(opt['client-version']) > 0 &&
    Number(opt['client-version']) <= 2147483647, 'invalid client version');
  assert(/^[0-3]$/.test(opt.class), '--class must be 0..3');
  const names = opt.phases.split(',').map(s => s.trim());
  assert(names.length && names.every(n => PHASES.includes(n)), 'unknown or empty phase');
  assert(new Set(names).size === names.length, 'duplicate phase');
  const phases = new Set(names);
  if (phases.has('castarea')) {
    assert.equal(opt.class, '0', 'castarea requires Transknight');
    assert.deepEqual([...phases].sort(), ['castarea', 'enter', 'login', 'second'],
      'castarea runs only with login,enter,second');
  }
  // Item phases (stage 5, slice 2) end with their own relogin, so each runs
  // alone after the two sessions are in the Field.
  if (phases.has('equip'))
    assert.deepEqual([...phases].sort(), ['enter', 'equip', 'login', 'second'],
      'equip runs only with login,enter,second');
  // The potion needs real missing HP: the death phase revives A with HP 2.
  if (phases.has('potion'))
    assert.deepEqual([...phases].sort(), ['death', 'enter', 'login', 'potion', 'second'],
      'potion runs only with login,enter,second,death');
  // Slice 3: shop and bank are private to A and end with their own relogin;
  // chat needs B as the listener and includes the /city teleport commands.
  for (const [p, only] of [['shop', ['enter', 'login', 'shop']], ['trash', ['enter', 'login', 'trash']], ['bank', ['bank', 'enter', 'login']],
    ['paidteleport', ['enter', 'login', 'paidteleport']],
    ['chat', ['chat', 'enter', 'login', 'second']], ['party', ['enter', 'login', 'party', 'second']],
    ['partychat', ['enter', 'login', 'partychat', 'second']],
    ['guildchat', ['enter', 'guildchat', 'login', 'second']],
    ['restart', ['enter', 'login', 'restart', 'second']],
    ['trade', ['enter', 'login', 'second', 'trade']], ['tradeedge', ['enter', 'login', 'second', 'tradeedge']],
    ['delete', ['delete']]]) {
    if (phases.has(p)) assert.deepEqual([...phases].sort(), only, `${p} runs only with ${only.join(',')}`);
  }
  // Etapa 7: the settings panel reloads A's page (relogin, resolution), alone.
  if (phases.has('settings'))
    assert([...phases].every(n => ['login', 'create', 'enter', 'settings'].includes(n)) && phases.has('enter'),
      'settings runs only with login,[create,]enter');
  const deps = { create: ['login'], enter: ['login'], inventory: ['enter'], second: ['enter'],
    move: ['second'], logout: ['second'], mapchange: ['second'], attack: ['second'], death: ['second'], grind: ['login'], learn: ['login'], cast: ['login'], buff: ['login'], healother: ['login'], loot: ['login'], concurrent: ['enter'] };
  for (const name of phases) for (const dep of deps[name] ?? [])
    assert(phases.has(dep), `${name} requires ${dep}`);
  // death takes A through the portal and needs B waiting at the Armia spawn;
  // mapchange/attack move B away (attack also closes it).
  for (const other of ['mapchange', 'attack'])
    assert(!(phases.has('death') && phases.has(other)), `death cannot run with ${other}`);
  // grind enters the --class character itself, alone (one game page).
  const own = ['login', 'grind', 'learn', 'cast', 'buff', 'healother', 'loot'];
  for (const p of own.slice(1)) {
    if (!phases.has(p)) continue;
    for (const other of phases)
      assert(own.includes(other), `${p} runs only with ${own.join('/')} (got ${other})`);
  }
  if (phases.has('healother')) assert.equal(opt.class, '1', 'healother needs --class 1 (Foema)');
  if (phases.has('buff')) assert(['1', '2'].includes(opt.class), 'buff needs --class 1 (Cura) or 2 (Lobisomem)');
  if (opt.skill) assert(['27', '64'].includes(opt.skill), '--skill must be 27 (Cura) or 64 (Lobisomem)');
  if (phases.has('grind')) {
    assert(/^\d+$/.test(opt['grind-level'] ?? '') && Number(opt['grind-level']) >= 2 &&
      Number(opt['grind-level']) <= 20, '--grind-level must be 2..20');
  }
  return phases;
}

// Inbound gameplay the dialect deliberately drops until its layout is
// translated (ADR 003: unmapped packets are dropped and counted, never reach a
// scene). Only these, and only as "unknown" drops, may appear in a scenario;
// they are reported in the evidence. Any other drop still fails.
// 0x0367 (MSG_Attack) left the list when it was translated (ADR 004).
// 0x5000 MSG_Exp_Msg_Panel_ is a server-custom text panel ("+N de EXP",
// mobkilled.go) with no runtime handler; the EXP itself arrives in the
// MSG_Attack echo (CurrentExp). Deferred, not rendered (ADR 004 revision).
export const DEFERRED_INBOUND = new Set(['0x5000']);

// Outbound runtime messages the locked server has no route for: dispatch.go
// logs them as routed=false and ignores them, so dropping them in the dialect
// changes nothing on the server. Same rule as inbound: listed, counted, any
// other outbound drop fails.
// 0x02CB MoveStop: the runtime sends it before a plain melee hit while walking
// (TMFieldScene.cpp, SkillIndex -1); the server has no handler at 98286fdf.
export const DEFERRED_OUTBOUND = new Set(['0x02cb']);

export function checkHealth(p, errors = [], deferredIn = DEFERRED_INBOUND, deferredOut = DEFERRED_OUTBOUND) {
  assert.equal(errors.length, 0, 'page errors');
  assert.equal(p.glErrorTotal, 0, 'WebGL errors');
  assert.equal(p.placeholder, 0, 'placeholder scene');
  for (const k of ['inDropSize', 'inDropRange',
    'outDropSize', 'outDropRange', 'outDropNoVersion'])
    assert.equal(p.dialect[k], 0, `protocol rejection: ${k}`);
  const droppedIn = p.dialect.droppedIn ?? [];
  const unexpected = droppedIn.filter(d => !deferredIn.has(d.opcode));
  assert.deepEqual(unexpected, [], 'protocol rejection: inbound opcode outside the deferred list');
  const deferred = droppedIn.reduce((n, d) => n + d.times, 0);
  assert(p.dialect.inDropUnknown <= deferred, `protocol rejection: inDropUnknown ${p.dialect.inDropUnknown} > deferred ${deferred}`);
  const droppedOut = p.dialect.droppedOut ?? [];
  assert.deepEqual(droppedOut.filter(d => !deferredOut.has(d.opcode.toLowerCase())), [],
    'protocol rejection: outbound opcode outside the deferred list');
  const deferredSent = droppedOut.reduce((n, d) => n + d.times, 0);
  assert(p.dialect.outDropUnknown <= deferredSent,
    `protocol rejection: outDropUnknown ${p.dialect.outDropUnknown} > deferred ${deferredSent}`);
  if (p.state === 0) assert.equal(p.field.fixture, 0, 'offline fixture');
}

export function checkPreview(actual, expected) {
  for (const key of ['name', 'level', 'maxHp', 'maxMp', 'str', 'int', 'dex', 'con', 'equip'])
    assert.deepEqual(actual[key], expected[key], `persisted preview differs: ${key}`);
}

export function checkArmiaSpawn(me) {
  // CitySpawn(0): (2086,2093) + rand%15; EmptyCellNear may shift by <=3 tiles.
  // Runtime centers tiles. Exact chosen cell is corroborated by server logs.
  assert(me.x >= 2083 && me.x < 2104 && me.y >= 2090 && me.y < 2111, 'relogin outside Armia spawn');
}

export function checkTeleport(after) {
  // world/teleport.go: destination (2588,2096) + rand%3, plus tile center.
  assert(after.x >= 2588 && after.x < 2591 && after.y >= 2096 && after.y < 2099,
    'teleport outside Armia Field destination');
  // Loaded terrain block, 128 cells per block: 2588>>7 = 20, 2096>>7 = 16.
  assert.equal(after.groundX, 20, 'destination terrain block X not loaded');
  assert.equal(after.groundY, 16, 'destination terrain block Y not loaded');
}

// Combat result as observed by the clients. Damage, HP and experience are the
// server's (0x0367 echo / broadcast); the harness only compares observations.
export function checkCombat(c) {
  assert(!c.died, 'attacker died before combat verification');
  assert(!c.lost, 'target disappeared without confirmed death');
  assert(c.attacksSent > 0, 'no attack left the client');
  assert(c.echoes > 0, 'no attack echo from the server');
  assert(c.hpTrail.length >= 2, 'target HP never observed twice');
  const first = c.hpTrail[0], last = c.hpTrail.at(-1);
  assert(c.killed || last < first, 'target HP never decreased');
  if (c.killed) assert(c.exp1 > c.exp0, 'kill without server experience');
  assert(c.exp1 >= c.exp0, 'experience decreased while attacking');
  for (let i = 1; i < c.hpTrail.length; i++)
    assert(c.hpTrail[i] <= c.hpTrail[i - 1] || c.regen, 'target HP rose without regeneration');
  assert(c.observer?.sawTarget, 'observer never saw the target');
  assert(c.observer.echoes > 0, 'observer received no attack broadcast');
  assert(c.observer.hpTrail.length >= 2 || c.observer.sawKill, 'observer has no damage observation');
  assert(c.observer.hpTrail.at(-1) < c.observer.hpTrail[0] || c.observer.sawKill,
    'observer did not see the damage');
}

export function checkCombatRelogin(before, after) {
  for (const key of ['name', 'characterClass', 'equip', 'look', 'level', 'exp'])
    assert.deepEqual(after[key], before[key], `post-combat persistence differs: ${key}`);
  checkArmiaSpawn(after);
}

// Death and respawn (stage 5). Everything is server-confirmed state seen by the
// clients: A's HP reaches 0 through mob attacks (0x0367 broadcast), the
// runtime opens box 11 on a field click, OK sends 0x03AE and, 5 s later,
// 0x0289; handler/character.go restart revives (HP = 2) and recalls to
// CitySpawn(LastCity). Mortal characters below level 35 lose no EXP
// (death_exp.go FREEEXP gate), so level and EXP must be unchanged there.
export function checkRespawn(d) {
  assert(d.died, 'A never died');
  assert(d.hpAtDeath <= 0, 'death without HP 0');
  assert(d.mobHits > 0, 'death without a server attack on A');
  assert.equal(d.box, 11, 'return-to-town box did not open');
  assert(d.sent.includes('0x03ae'), 'DelayStart (0x03AE) not sent');
  assert(d.sent.includes('0x0289'), 'Restart (0x0289) not sent');
  checkArmiaSpawn(d.after);
  assert(d.after.hp > 0 && d.after.hp <= d.after.maxHp, 'respawned without valid HP');
  assert.notEqual(d.after.die, 1, 'still dead after respawn');
  assert.equal(d.after.level, d.before.level, 'level changed by death');
  if (d.before.level < 35) assert.equal(d.after.exp, d.before.exp, 'EXP lost below the level-35 gate');
  else assert(d.after.exp <= d.before.exp, 'EXP rose on death');
  assert(d.observer?.sawRespawn, 'B did not see A back in the city');
}

// Leveling by real combat: every kill is a target the server took to 0 HP and
// paid EXP for; level only rises through the server's level-up (mobkilled.go).
export function checkGrind(g) {
  assert(g.kills.length > 0, 'no kill');
  for (const k of g.kills) {
    assert(k.hpTrail.at(-1) <= 0 || k.gone, `kill ${k.id} without HP 0`);
    assert(k.hpTrail.length >= 2 && k.hpTrail[0] > k.hpTrail.at(-1), `kill ${k.id} without damage`);
    assert(k.exp1 > k.exp0, `kill ${k.id} paid no EXP`);
  }
  assert(g.end.exp > g.start.exp, 'EXP did not rise');
  assert(g.end.level >= g.start.level, 'level fell');
  assert(!g.died, 'grinding character died');
}

// Learning a skill from the class master (skill.go learnSkill). The client
// only asks: NPC click (0x027B) -> server ShopType 3 list -> box 4 -> ApplyBonus
// BonusType 2 (Detail = 5000+idx, TargetID = master). The learned bit and the
// spent points are the server's (MSG_UpdateEtc), and must survive a relogin.
export function checkLearn(l) {
  const bit = (l.skill - 5000) % 24;
  const cls = Math.floor((l.skill - 5000) / 24);
  assert(l.offered.includes(l.skill), 'skill not offered by the master');
  assert(l.offered.every(i => i >= 5000 + cls * 24 && i < 5024 + cls * 24), 'master offered another class');
  assert.equal(l.merchant, l.npc, 'runtime recorded another merchant');
  assert.equal(l.box, 4, 'learn box did not open');
  assert.equal((l.before.learned >>> bit) & 1, 0, 'skill already learned before');
  assert.equal((l.after.learned >>> bit) & 1, 1, 'server did not set the learned bit');
  assert.equal(l.after.learned & ~(1 << bit), l.before.learned & ~(1 << bit), 'other learned bits changed');
  assert.equal(l.before.bonus - l.after.bonus, l.cost, 'skill points not charged by the cost');
  assert.equal((l.relogin.learned >>> bit) & 1, 1, 'learned bit lost on relogin');
  assert.equal(l.relogin.bonus, l.after.bonus, 'skill points differ after relogin');
}

// Using a learned skill (skill.go / combat.go). The client assigns it to the
// belt (0x0378), selects the slot and right-clicks the target; the server
// validates the learned bit and class, charges MP and decides the damage.
// MP spent is the signature of a skill: plain melee costs none.
export function checkCast(c) {
  assert.equal(c.cell, 5000 + c.cls * 24 + c.pos, 'skill window shows another skill');
  assert.equal(c.belt, c.skill, 'belt slot does not hold the skill');
  assert.equal(c.selected, c.slot, 'slot not selected');
  assert(c.attacksSent > 0, 'no skill attack left the client');
  assert(c.echoes > 0, 'no attack echo from the server');
  assert(c.mpTrail.length >= 2 && Math.min(...c.mpTrail) < c.mpTrail[0], 'server charged no MP');
  assert(c.hpTrail.length >= 2 && c.hpTrail.at(-1) < c.hpTrail[0], 'target took no damage');
  assert(!c.died, 'caster died');
  // Area (TargetType 3): the target is always among the mobs the server hit;
  // more than one only when another mob stood inside the range (recorded).
  if (c.area) {
    assert(Array.isArray(c.hitMobs) && c.hitMobs.includes(c.target?.id), 'area cast: target not among the hit mobs');
    assert(c.hitMobs.length <= c.nearby, 'area cast: more hits than mobs in range');
  }
}

// ---- Stage 5, slice 2: items (ADR 007) ----
// Every value below is what the client holds after the server's frames
// (0x0114 snapshot, 0x0376 echo, 0x0182 slot, 0x0337 coin, 0x0336 score):
// the harness compares observations, it never predicts an outcome.

// EF_AMOUNT (61) carries the stack size; an item without it is one unit.
export function itemAmount(it) {
  if (!it?.index) return 0;
  const amount = it.ef?.find(([e]) => e === 61);
  return amount ? amount[1] : 1;
}

const slotKey = it => `${it.index}:${(it.ef ?? []).map(p => p.join('.')).join(',')}`;

function sameSlots(a, b, what) {
  assert.equal(a.length, b.length, `${what}: slot count differs`);
  a.forEach((it, i) => assert.equal(slotKey(b[i]), slotKey(it), `${what}: slot ${i} differs`));
}

// Carry, equip and coin identical before logout and after the next login.
export function checkInventoryRelogin(before, after) {
  sameSlots(before.equip, after.equip, 'equip after relogin');
  sameSlots(before.carry, after.carry, 'carry after relogin');
  assert.equal(after.coin, before.coin, 'coin after relogin');
  assert.equal(after.level, before.level, 'level after relogin');
  assert.equal(after.exp, before.exp, 'exp after relogin');
}

// Unequip to a free carry cell and back, by the original click-to-pick
// gesture (0x0376 each way); the server echoes, sends both slots and, for an
// equip slot, UpdateEquip to the viewers and a recomputed score.
export function checkEquip(e) {
  const { slot, free } = e;
  const item = e.before.equip[slot];
  assert(item.index > 0, 'no equipped item to move');
  assert.equal(e.before.carry[free].index, 0, 'destination cell not empty');
  for (const [name, m] of [['unequip', e.unequip], ['equip', e.equip]]) {
    assert.equal(m.picked, m.expect, `${name}: item not picked by the cursor`);
    assert(m.swapsSent >= 1, `${name}: no 0x0376 left the client`);
  }
  assert.equal(e.off.equip[slot].index, 0, 'equip slot still holds the item after unequip');
  assert.equal(slotKey(e.off.carry[free]), slotKey(item), 'item did not land in the carry cell');
  sameSlots(e.before.equip, e.on.equip, 'equip after re-equip');
  sameSlots(e.before.carry, e.on.carry, 'carry after re-equip');
  // The login snapshot's CurrentScore is the class BaseMob template
  // (protocol/mob.go EncodeCNFCharacterLoginRaw), so Damage/Ac before the
  // first 0x0336 are not the character's: compare the server's two recomputes.
  assert(e.on.damage !== e.off.damage || e.on.ac !== e.off.ac, 'server score equal with and without the item');
  assert(e.observer.sawOff, 'B did not see the unequip (0x036B)');
  assert(e.observer.sawOn, 'B did not see the re-equip');
  // A move the item cannot make (potion onto the equip slot): whether the
  // runtime blocks it or the server refuses it, nothing may change.
  sameSlots(e.on.equip, e.refused.bag.equip, 'equip after refused move');
  sameSlots(e.on.carry, e.refused.bag.carry, 'carry after refused move');
  assert.equal(e.refused.cursor, 0, 'item left on the cursor after refused move');
  checkInventoryRelogin(e.on, e.relogin);
}

// HP potion by right click (0x0373): the server consumes one unit (0x0182),
// raises the target HP (0x0181) and the tick heals, seen by B as 0x0336.
// A rapid double use may consume one or two units, never more, and the
// client keeps exactly the server's count (verified again after relogin).
export function checkPotion(p) {
  assert(p.hpBefore < p.maxHp, 'no HP missing before the potion');
  assert(p.use.usesSent >= 1, 'no 0x0373 left the client');
  assert.equal(p.use.amount, p.amount0 - 1, 'server did not consume exactly one unit');
  // Natural regeneration adds Level+30 per 10 s tick; a 200 potion must
  // raise HP by more than one such tick (or fill it).
  assert(p.use.hp - p.hpBefore > 39 || p.use.hp === p.maxHp, 'HP did not rise beyond regeneration after the potion');
  assert(p.observer.hpAfter > p.hpBefore, 'B did not see the heal');
  const spent = p.use.amount - p.double.amount;
  assert(spent >= 1 && spent <= 2, `double use consumed ${spent} units`);
  assert(p.double.usesSent >= 1, 'double use sent nothing');
  sameSlots(p.double.bag.equip, p.empty.bag.equip, 'equip after empty-cell use');
  sameSlots(p.double.bag.carry, p.empty.bag.carry, 'carry after empty-cell use');
  checkInventoryRelogin(p.beforeRelogin, p.relogin);
  assert.equal(itemAmount(p.relogin.carry[p.slot]), p.double.amount, 'potion count differs after relogin');
}

// Loot from real kills: the server puts drops straight into the killer's
// carry (0x0182) and gold into Coin (0x0337); nothing lands on the ground at
// the locked revision. Carry may only gain, and coin may only rise.
export function checkLoot(l) {
  assert(l.kills.length > 0, 'no kill');
  assert(l.coinGain > 0 || l.itemGain.length > 0, 'no loot after the kills');
  for (const g of l.itemGain) assert(g.after > g.before, `slot ${g.slot} did not gain`);
  assert.deepEqual(l.lost, [], 'carry lost items while looting');
  assert(l.end.coin >= l.start.coin, 'coin fell while looting');
  checkInventoryRelogin(l.end, l.relogin);
}

// NPC shop (slice 3). Gold and items move only on the server's word: the
// sale by its 0x037A echo, 0x0182 clear and 0x0337 gold; the purchase by the
// 0x0379 echo, 0x0337 and 0x0182. A refused buy leaves both untouched and
// shows the legacy panel.
export function checkShop(s) {
  assert(s.merchant > 0 && s.cells.length > 0, 'shop window did not list items');
  assert(s.sell.sent >= 1, 'no 0x037A left the client');
  assert.equal(s.sell.after.index, 0, 'sold slot not cleared by the server');
  assert(s.sell.coinAfter > s.sell.coinBefore, 'sale did not raise gold');
  assert(s.buy.sent >= 1, 'no 0x0379 left the client');
  assert(s.buy.gained >= 1, 'bought item did not reach the carry');
  assert(s.buy.coinAfter < s.buy.coinBefore, 'purchase did not lower gold');
  if (s.poor) {
    assert(s.poor.sent >= 1, 'refused buy sent nothing');
    assert.equal(s.poor.coinAfter, s.poor.coinBefore, 'refused buy changed gold');
    assert.equal(s.poor.gained, 0, 'refused buy added an item');
    assert.equal(s.poor.notice, true, 'refused buy: no _NN_Not_Enough_Money panel');
  }
  // Every unit gained was paid for, at one unit price, also on a repeated click.
  const spent = s.buy.coinBefore - s.buy.coinAfter;
  assert.equal(spent % s.buy.gained, 0, 'purchase: gold is not a whole number of units');
  const price = spent / s.buy.gained;
  assert.equal(s.repeat.coinBefore - s.repeat.coinAfter, s.repeat.gained * price, 'repeated buy: gold and items disagree');
  checkInventoryRelogin(s.beforeRelogin, s.relogin);
  assert.equal(s.relogin.coin, s.beforeRelogin.coin, 'gold differs after relogin');
}

// Trash grid (player report of 08/10, ADR 007): the item dropped on the trash
// and confirmed (box 740) leaves through 0x02E4 and the server deletes it, so
// a later buy and a relogin do not bring it back; equip/unequip still work.
export function checkTrash(t) {
  assert.equal(t.drop.cursor, t.victim.index, 'trash: item not picked by the cursor');
  assert.equal(t.drop.box, 740, 'trash: confirmation box 740 did not open');
  assert(t.drop.sent >= 1, 'trash: nothing left the client');
  assert.equal(t.drop.lastSent, '0x2e4', 'trash: 0x02E4 was not the last frame sent');
  assert.equal(t.afterTrash.carry[t.victim.slot].index, 0, 'trash: cell still holds the item');
  assert.equal(t.counts.afterTrash, t.counts.before - 1, 'trash: item count did not drop by one');
  assert(t.buy.gained >= 1, 'trash: the buy after the trash did not land');
  assert.equal(t.counts.afterBuy, t.counts.afterTrash, 'trash: the discarded item came back after the buy');
  checkInventoryRelogin(t.beforeRelogin, t.relogin);
  assert.equal(t.counts.afterRelogin, t.counts.afterTrash, 'trash: the discarded item came back after relogin');
  const { slot, free, item } = t.equip;
  for (const [name, m] of [['unequip', t.equip.unequip], ['equip', t.equip.reequip]]) {
    assert.equal(m.picked, m.expect, `trash ${name}: item not picked by the cursor`);
    assert(m.swapsSent >= 1, `trash ${name}: no 0x0376 left the client`);
  }
  assert.equal(t.equip.off.equip[slot].index, 0, 'trash unequip: slot still holds the item');
  assert.equal(t.equip.off.carry[free].index, item, 'trash unequip: item not in the carry cell');
  assert.equal(t.equip.on.equip[slot].index, item, 'trash re-equip: item not back in the slot');
  assert.equal(t.equip.on.carry[free].index, 0, 'trash re-equip: carry cell not emptied');
}

// Account cargo (slice 3): both gold pools and the stored item change only by
// the server's echoes; a refused withdraw changes nothing; relogin keeps both.
export function checkBank(b) {
  assert(b.opened, 'cargo window did not open');
  assert.equal(b.deposit.coin, b.deposit.coinBefore - b.amount, 'deposit: carry gold');
  assert.equal(b.deposit.cargo, b.deposit.cargoBefore + b.amount, 'deposit: cargo gold');
  assert.equal(b.withdraw.coin, b.deposit.coin + b.amount, 'withdraw: carry gold');
  assert.equal(b.withdraw.cargo, b.deposit.cargo - b.amount, 'withdraw: cargo gold');
  assert.equal(b.overdraw.sent, 1, 'overdraw: one 0x0387 expected');
  assert.equal(b.overdraw.coin, b.withdraw.coin, 'overdraw changed carry gold');
  assert.equal(b.overdraw.cargo, b.withdraw.cargo, 'overdraw changed cargo gold');
  assert.equal(b.overdraw.notice, true, 'overdraw: no _NN_Cant_Withdraw_That_Much panel');
  assert.equal(b.overdeposit.sent, 0, 'deposit above carry gold must be refused by the client');
  assert.equal(b.store.cargoItem, b.store.item, 'item did not reach the cargo');
  assert.equal(b.store.carryItem, 0, 'stored item still in the carry');
  assert.equal(b.fetch.carryItem, b.store.item, 'item did not come back');
  assert(b.keep.amount > 0 && b.keep.sent === 1, 'kept deposit: one 0x0387 expected');
  assert.equal(b.keep.coin, b.overdeposit.coin - b.keep.amount, 'kept deposit: carry gold');
  assert.equal(b.keep.cargo, b.overdeposit.cargo + b.keep.amount, 'kept deposit: cargo gold');
  assert.equal(b.relogin.cargo, b.keep.cargo, 'cargo gold differs after relogin');
  assert.equal(b.relogin.coin, b.keep.coin, 'carry gold differs after relogin');
  assert.equal(b.restore.coin, b.relogin.coin + b.keep.amount, 'restore: carry gold');
  assert.equal(b.restore.cargo, b.relogin.cargo - b.keep.amount, 'restore: cargo gold');
}

// Paid city portal (Armia -> Noatum): with the price on A the server charges it
// once and moves A; with less, 0x0290 still leaves the client and nothing
// changes. The parked gold comes back and the relogin keeps only the charge.
export function checkPaidTeleport(t, price) {
  assert.equal(t.paid.lastSent, 0x290, 'paid: no 0x0290 after OK');
  assert(t.paid.moved > 50 && t.paid.nearNoatum, 'paid: A did not reach Noatum');
  assert.equal(t.paid.coinAfter, t.paid.coinBefore - price, 'paid: charge differs from the price');
  assert(t.back.sent, 'no /armia command left the client');
  assert(t.parked.sent === 1 && t.refused.coinBefore < price, 'refused: A still had the price');
  assert.equal(t.refused.lastSent, 0x290, 'refused: no 0x0290 after OK');
  assert(t.refused.moved < 3, 'refused: A was teleported without the price');
  assert.equal(t.refused.coinAfter, t.refused.coinBefore, 'refused: gold changed');
  assert.equal(t.refused.notice, true, 'refused: no _NN_Not_Enough_Money panel');
  assert.equal(t.paid.notice, false, 'paid: a not-enough-money panel showed');
  assert.equal(t.restore.sent, 1, 'restore: one 0x0387 expected');
  assert.equal(t.restore.coin, t.paid.coinAfter, 'restore: gold differs from after the charge');
  assert.equal(t.relogin.coin, t.paid.coinAfter, 'relogin: gold differs from after the charge');
}

// Chat (slice 3): B shows A's line under A's name; the whisper reaches B; the
// /city command moves A by the server (0x036C) and B loses sight of it.
export function checkChat(c) {
  assert(c.say.sent, 'no 0x0333 left the client');
  assert(c.say.heard, "B did not show A's line");
  assert(c.whisper.sent, 'no 0x0334 left the client');
  assert(c.whisper.heard, 'B did not show the whisper');
  // Server patch 0008: the sender's name in MobName and a leading space, so the
  // memo (&String[1]) names A and shows the whole text.
  assert.equal(c.whisper.senderShown, 'sender', `B shows the whisper as from ${c.whisper.senderShown}`);
  assert(c.whisper.fullText, 'B shows the whisper text cut');
  assert(c.reply?.sent && c.reply.heard, 'the /r reply did not reach A');
  assert.equal(c.reply.senderShown, 'sender', `A shows the /r reply as from ${c.reply.senderShown}`);
  assert(c.reply.fullText, 'A shows the /r reply cut');
  assert(c.offline?.lastRecv === '0x102' && c.offline.inTranslated >= 1, 'no notice for a whisper to nobody online');
  assert(c.teleport.moved > 50, 'the /city command did not move A');
  assert(c.teleport.bLost, 'B still sees A after the teleport');
  assert(c.back.moved > 50, 'the return command did not move A');
}

// Buff and cure (stage 5). The MP cost comes from the server; so does the
// effect: the BM transform turns A into the wolf model (the runtime switches
// TMHuman::m_nClass on the body item 22 the server sends, transform.go
// transMesh) and rescales MaxHp, which B sees; the Foema heal raises HP, seen
// by B.
// The skill stays learned after the relogin.
export function checkBuff(r, plan) {
  assert(r.attempts > 0 && r.attacksSent > 0, 'no cast sent');
  // Lowest MP seen after the cast: regeneration refills it within seconds.
  const mp = Math.min(r.after.mp, ...(r.trail ?? []).map(t => t.mp));
  assert(mp < r.before.mp, `server took no MP (${r.before.mp} -> ${mp})`);
  assert(((r.relogin.learned >>> plan.pos) & 1) === 1, 'skill lost after relogin');
  if (plan.kind === 'transform') {
    assert.notEqual(r.after.model, r.before.model, `A kept model ${r.before.model}`);
    assert.notEqual(r.after.maxHp, r.before.maxHp, 'MaxHp not rescaled by the transform');
    assert.equal(r.observedAfter?.maxHp, r.after.maxHp, 'B does not see the transformed MaxHp on A');
    // The affect is saved: after the relogin A is still the beast, on its own
    // screen too (the runtime takes its model from the login snapshot).
    if (r.relogin.maxHp === r.after.maxHp)
      assert.equal(r.relogin.model, r.after.model, `relogin model ${r.relogin.model}, transform still active`);
  } else {
    assert(r.before.hp < r.before.maxHp, 'no HP missing before the cure');
    // More than one natural regeneration step (Level+30 every 10 s).
    const hp = Math.max(r.after.hp, ...(r.trail ?? []).map(t => t.hp));
    assert(hp - r.before.hp > r.before.level + 30,
      `HP rose ${hp - r.before.hp}, no more than one regeneration step (${r.before.level + 30})`);
    assert(r.observedAfter?.hp > (r.observedBefore?.hp ?? Infinity), 'B did not see A healed');
    // The server's answer (combat diagnostics, ADR 006): the heal rides as a
    // negative Dam on A itself, and B receives the same packet.
    const self = l => (l?.in ?? []).find(e => e.skill === plan.skill && e.targets.some(t => t.id === e.attacker && t.damage < 0));
    const echoA = self(r.logsA), echoB = self(r.logsB);
    assert(echoA, 'no server heal answer on A');
    assert(echoB && echoB.targets[0].damage === echoA.targets[0].damage && echoB.hp === echoA.hp,
      'B did not receive the same heal answer');
  }
}

// Slice 5, controlled restart: what both clients held right before the
// server stopped (A's purchase and cargo deposit lived only in its memory)
// comes back unchanged after the restart, through a fresh login.
export function checkRestart(r) {
  assert(r.buy?.gained === 1 && r.buy.coinAfter === r.buy.coinBefore - r.buy.price, 'purchase before the restart not applied');
  assert(r.droppedAt?.a && r.droppedAt?.b, 'the restart did not drop both sessions');
  for (const who of ['a', 'b']) {
    const [x, y] = [r.before[who], r.after[who]];
    for (const k of ['coin', 'level', 'exp', 'learned'])
      assert.deepEqual(y[k], x[k], `${who}.${k} changed across the restart`);
    assert.deepEqual(y.equip, x.equip, `${who}.equip changed across the restart`);
    assert.deepEqual(y.carry, x.carry, `${who}.carry changed across the restart`);
  }
  assert.equal(r.after.cargo.coin, r.before.cargo.coin, 'cargo gold changed across the restart');
  assert.deepEqual(r.after.cargo.items, r.before.cargo.items, 'cargo items changed across the restart');
  assert(r.before.cargo.coin >= r.deposit.cargoBefore + r.deposit.amount, 'deposit not in the cargo before the restart');
}

// Cura on another player: the server answers with a negative Dam on B (the
// heal), A pays the MP, and B sees its own HP rise by more than one natural
// regeneration step (Level+30); both pages receive the same answer.
export function checkHealOther(r) {
  const echo = l => (l?.in ?? []).find(e => e.skill === r.skill && e.attacker === r.casterId &&
    e.targets.some(t => t.id === r.targetId && t.damage < 0));
  const ea = echo(r.logsA), eb = echo(r.logsB);
  assert(ea, 'no server heal answer on B in A');
  assert(eb && eb.targets[0].damage === ea.targets[0].damage, 'B did not receive the same heal answer');
  assert(ea.mp < r.before.caster.mp, `server took no MP from A (${r.before.caster.mp} -> ${ea.mp})`);
  assert(r.before.target.hp < r.before.target.maxHp, 'B had no HP missing');
  assert(r.after.target.hp - r.before.target.hp > r.before.target.level + 30,
    `B's HP rose ${r.after.target.hp - r.before.target.hp}, no more than one regeneration step`);
  assert(r.after.seenByCaster > r.before.seenByCaster, 'A did not see B healed');
}

// Duplicate login (server patch 0009, legacy DBSrv/TMSrv): the new login is
// refused with _MSG_StillPlaying (0x011D) or, while the kicked session saves,
// _MSG_AlreadyPlaying (0x011C), and the 7662 says to try again; the session in
// the game is closed back to server selection; a retry enters the same character.
export function checkConcurrent(c) {
  assert([0x11d, 0x11c].includes(c.refusal.opcode), `duplicate login answered 0x${c.refusal.opcode?.toString(16)}`);
  assert.equal(c.refusal.state, 7, 'the refused page left server selection');
  assert(c.refusalPanel?.includes('Tente novamente'), `refusal shows "${c.refusalPanel}"`);
  assert(!c.kicked.timedOut && c.kicked.connected === false, 'the first session was not closed');
  assert.equal(c.retries.at(-1), 'selchar', 'the retry did not reach character selection');
  assert(c.sameCharacter && c.sameEquip, 'the retry entered a different character or equipment');
}

// Etapa 7, settings panel (patch 0023, web/settings.js). Music level n -> the
// original 30*n-3000 hundredths of dB; 0 and anything <= -3000 are mute
// (DirShow.cpp clamp). The compat layer plays it on an <audio> element with
// volume 10^(cB/2000) (win32_emscripten_stubs.cpp WydWebMusicSetVolume).
export const musicCentibels = level => level > 0 ? 30 * level - 3000 : -10000;
export const musicElementVolume = cB => cB <= -10000 ? 0 : Math.min(1, Math.pow(10, cB / 2000));

function checkMusic(m, level, what) {
  assert.equal(m.level, level, `${what}: runtime music level ${m.level}, expected ${level}`);
  assert.equal(m.cB, musicCentibels(level), `${what}: music volume ${m.cB} cB`);
  assert(m.audioVolume !== null, `${what}: no music element`);
  assert(Math.abs(m.audioVolume - musicElementVolume(m.cB)) < 1e-3, `${what}: element volume ${m.audioVolume}`);
}

export function checkSettings(s) {
  checkMusic(s.slider.music, s.slider.musicLevel, 'slider');
  assert.equal(s.slider.effects, s.slider.effectsLevel, 'slider: effects level not applied');
  assert(s.slider.music.audioVolume > 0, 'slider: music silent at a non-zero level');
  checkMusic(s.mute.music, 0, 'mute');
  assert.equal(s.mute.music.audioVolume, 0, 'mute: music still audible');
  // A zone change recreates the BGM from m_nMusic (TMFieldScene.cpp).
  assert(s.zone.teleported, 'zone: no teleport');
  assert(s.zone.playCallsAfter > s.zone.playCallsBefore, 'zone: no new music started, the check proves nothing');
  checkMusic(s.zone.music, 0, 'zone');
  assert.equal(s.zone.music.audioVolume, 0, 'zone: music audible after the zone change while muted');
  // Relogin in the same browser profile: localStorage wins over Config.bin before boot.
  assert.deepEqual(s.relogin.beforeEnter, s.relogin.saved, 'relogin: levels not restored before entering');
  checkMusic(s.relogin.music, s.relogin.saved.music, 'relogin');
  for (const r of s.resolutions) {
    assert.equal(r.canvas, r.resolution, `${r.resolution}: canvas is ${r.canvas}`);
    assert(r.inField, `${r.resolution}: did not enter the Field`);
    for (const p of r.points)
      assert(Math.abs(p.got[0] - p.expected[0]) <= 2 && Math.abs(p.got[1] - p.expected[1]) <= 2,
        `${r.resolution}${r.fit ? ' fit' : ''}: pointer ${p.got} for ${p.expected}`);
    if (r.walk) assert(Math.hypot(r.walk.to[0] - r.walk.from[0], r.walk.to[1] - r.walk.from[1]) >= 1,
      `${r.resolution}${r.fit ? ' fit' : ''}: ground click did not move the character`);
  }
  const seen = new Set(s.resolutions.map(r => r.resolution));
  for (const need of ['1024x768', '1280x1024']) assert(seen.has(need), `resolution ${need} not exercised`);
  // "fit" must actually enlarge the canvas (aspect kept), not only keep clicks right.
  const fit = s.resolutions.find(r => r.fit);
  assert(fit, 'fit mode not exercised');
  const [w, h] = fit.canvas.split('x').map(Number);
  assert(fit.displayed[0] > w && Math.abs(fit.displayed[0] / fit.displayed[1] - w / h) < 0.01,
    `fit shows ${fit.displayed} for ${fit.canvas}`);
}
