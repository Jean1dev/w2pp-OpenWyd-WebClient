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
  'inventory', 'second', 'move', 'logout', 'mapchange', 'attack', 'death', 'grind', 'learn', 'cast', 'castarea',
  'equip', 'potion', 'loot', 'shop', 'bank', 'chat', 'party', 'concurrent'];

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
  for (const [p, only] of [['shop', ['enter', 'login', 'shop']], ['bank', ['bank', 'enter', 'login']],
    ['chat', ['chat', 'enter', 'login', 'second']], ['party', ['enter', 'login', 'party', 'second']]]) {
    if (phases.has(p)) assert.deepEqual([...phases].sort(), only, `${p} runs only with ${only.join(',')}`);
  }
  const deps = { create: ['login'], enter: ['login'], inventory: ['enter'], second: ['enter'],
    move: ['second'], logout: ['second'], mapchange: ['second'], attack: ['second'], death: ['second'], grind: ['login'], learn: ['login'], cast: ['login'], loot: ['login'], concurrent: ['enter'] };
  for (const name of phases) for (const dep of deps[name] ?? [])
    assert(phases.has(dep), `${name} requires ${dep}`);
  // death takes A through the portal and needs B waiting at the Armia spawn;
  // mapchange/attack move B away (attack also closes it).
  for (const other of ['mapchange', 'attack'])
    assert(!(phases.has('death') && phases.has(other)), `death cannot run with ${other}`);
  // grind enters the --class character itself, alone (one game page).
  const own = ['login', 'grind', 'learn', 'cast', 'loot'];
  for (const p of own.slice(1)) {
    if (!phases.has(p)) continue;
    for (const other of phases)
      assert(own.includes(other), `${p} runs only with ${own.join('/')} (got ${other})`);
  }
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
// 0x0379 echo, 0x0337 and 0x0182. A refused buy leaves both untouched.
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
  }
  // Every unit gained was paid for, at one unit price, also on a repeated click.
  const spent = s.buy.coinBefore - s.buy.coinAfter;
  assert.equal(spent % s.buy.gained, 0, 'purchase: gold is not a whole number of units');
  const price = spent / s.buy.gained;
  assert.equal(s.repeat.coinBefore - s.repeat.coinAfter, s.repeat.gained * price, 'repeated buy: gold and items disagree');
  checkInventoryRelogin(s.beforeRelogin, s.relogin);
  assert.equal(s.relogin.coin, s.beforeRelogin.coin, 'gold differs after relogin');
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
  assert.equal(b.overdeposit.sent, 0, 'deposit above carry gold must be refused by the client');
  assert.equal(b.store.cargoItem, b.store.item, 'item did not reach the cargo');
  assert.equal(b.store.carryItem, 0, 'stored item still in the carry');
  assert.equal(b.fetch.carryItem, b.store.item, 'item did not come back');
  assert.equal(b.relogin.cargo, b.withdraw.cargo, 'cargo gold differs after relogin');
  assert.equal(b.relogin.coin, b.withdraw.coin, 'carry gold differs after relogin');
}

// Chat (slice 3): B shows A's line under A's name; the whisper reaches B; the
// /city command moves A by the server (0x036C) and B loses sight of it.
export function checkChat(c) {
  assert(c.say.sent, 'no 0x0333 left the client');
  assert(c.say.heard, "B did not show A's line");
  assert(c.whisper.sent, 'no 0x0334 left the client');
  assert(c.whisper.heard, 'B did not show the whisper');
  assert(c.teleport.moved > 50, 'the /city command did not move A');
  assert(c.teleport.bLost, 'B still sees A after the teleport');
  assert(c.back.moved > 50, 'the return command did not move A');
}
