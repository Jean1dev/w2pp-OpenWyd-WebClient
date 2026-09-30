#!/usr/bin/env python3
"""Synthetic server-dialect fixtures for the client translation layer.

Frames are built here by explicit offsets from docs/compatibility.md and the
server's documented layouts, NOT by the Go encoders and NOT by the C++
translator under test. tools/protocol/overlay/zz_ext_dialect_test.go then
rebuilds the same logical data with the server's real encoders and requires
byte equality, and the C++ test (tools/protocol/dialect_test.cpp) checks the
translated runtime structs field by field.

Outputs:
  docs/evidence/03-protocolo/fixtures/dialect.json   logical data + frames
  .cache/dialect/dialect_fixtures.h                  the same, as C++ data
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "docs/evidence/03-protocolo/fixtures/dialect.json"
OUT_H = ROOT / ".cache/dialect/dialect_fixtures.h"

CLIENT_VERSION = 12000  # effective W2PP_CLIENT_VERSION on the operator's Railway tm-server


def header(size: int, opcode: int, ident: int, tick: int = 0x01020304) -> bytearray:
    b = bytearray(size)
    struct.pack_into("<HBBHHI", b, 0, size, 0, 0, opcode, ident, tick)
    return b


def put_item(b: bytearray, off: int, it: dict | None) -> None:
    if not it:
        return
    struct.pack_into("<H", b, off, it["index"])
    for k, (e, v) in enumerate(it.get("eff", [])):
        b[off + 2 + 2 * k] = e
        b[off + 3 + 2 * k] = v


def put_name(b: bytearray, off: int, name: str, width: int = 16) -> None:
    raw = name.encode("ascii")[:width]
    b[off : off + len(raw)] = raw


# ---------------- logical data ----------------

SELCHARS = [
    {"slot": 0, "name": "Guerreiro", "spx": 2100, "spy": 2101, "level": 398, "maxHp": 5000, "hp": 4999,
     "maxMp": 800, "mp": 799, "str": 200, "int": 50, "dex": 100, "con": 150, "direction": 3,
     "guild": 77, "coin": 2000000000, "exp": (1 << 32) + 123,
     "equip": {"0": {"index": 1, "eff": [[43, 5], [0, 0], [0, 0]]},
               "15": {"index": 3500, "eff": [[1, 2], [3, 4], [5, 6]]}}},
    {"slot": 1, "name": "Maga", "spx": 2102, "spy": 2103, "level": 0, "maxHp": 80, "hp": 80,
     "maxMp": 120, "mp": 120, "str": 5, "int": 20, "dex": 8, "con": 5, "direction": 0,
     "guild": 0, "coin": 0, "exp": 0, "equip": {"0": {"index": 11}}},
    # slot 2 stays empty
    {"slot": 3, "name": "Cacadora12345", "spx": 65535, "spy": 1, "level": 32767, "maxHp": 2147483647,
     "hp": 1, "maxMp": 0, "mp": 0, "str": -1, "int": 32767, "dex": -32768, "con": 0, "direction": 7,
     "guild": 65535, "coin": -1, "exp": 9_000_000_000_000_000,
     "equip": {"0": {"index": 31}, "14": {"index": 6499, "eff": [[255, 255], [0, 1], [1, 0]]}}},
]

CARGO = {"0": {"index": 400}, "119": {"index": 401, "eff": [[9, 9], [0, 0], [0, 0]]},
         "120": {"index": 402}, "127": {"index": 403, "eff": [[1, 1], [2, 2], [3, 3]]}}

MOB = {
    "name": "Guerreiro", "pkPoint": 75, "clan": 7, "merchant": 0, "guild": 77, "class": 0, "quest": 0,
    "coin": 55555, "exp": (1 << 33) + 5, "spx": 2090, "spy": 2091, "level": 398, "ac": 120, "damage": 300,
    "maxHp": 5000, "maxMp": 800, "hp": 4999, "mp": 799, "str": 200, "int": 50, "dex": 100, "con": 150,
    "special": [1, 2, 3, 4], "attackRun": 0x34, "direction": 2,
    "equip": {"0": {"index": 1}, "15": {"index": 3500, "eff": [[1, 2], [3, 4], [5, 6]]}},
    "carry": {"0": {"index": 400}, "63": {"index": 401, "eff": [[7, 8], [0, 0], [0, 0]]}},
    "learnedSkill": 0x40000001, "magic": 20, "scoreBonus": 5, "specialBonus": 6, "skillBonus": 7,
    "critical": 8, "skillBar": [1, 2, 3, 4], "guildLevel": 2, "regenHP": 10, "regenMP": 11,
    "resist": [1, 2, 3, 4],
}
CHAR_LOGIN = {"slot": 1, "clientID": 517, "weather": 2, "loginX": 2100, "loginY": 2101,
              "shortSkill": list(range(16)), "mob": MOB}

MOB_PLAYER = {"mobID": 5, "name": "Guerreiro", "isPlayer": True, "pkPoint": 75, "curKill": 3, "totKill": 513,
              "posX": 2100, "posY": 2101, "guild": 77, "guildMemberType": 1, "level": 398, "ac": 120,
              "damage": 300, "maxHp": 5000, "maxMp": 800, "hp": 4999, "mp": 799, "str": 200, "int": 50,
              "dex": 100, "con": 150, "merchant": 0, "attackRun": 0x34, "direction": 1, "createType": 2,
              "equip": {"0": 1, "15": 3500}, "affect": {"0": 0x0101, "31": 0xFFFF},
              "anct": {"0": 0x80, "15": 0x7F}}
MOB_NPC = {"mobID": 1234, "name": "Ciclope_Arqueiro", "isPlayer": False, "pkPoint": 0, "curKill": 0, "totKill": 0,
           "posX": 3000, "posY": 1500, "guild": 0, "guildMemberType": 0, "level": 150, "ac": 50, "damage": 90,
           "maxHp": 9000, "maxMp": 0, "hp": 9000, "mp": 0, "str": 0, "int": 0, "dex": 0, "con": 0,
           "merchant": 1, "attackRun": 0x22, "direction": 0, "createType": 0,
           "equip": {"0": 222}, "affect": {}, "anct": {}}


# ---------------- encoders by explicit offset ----------------

def score(b: bytearray, off: int, c: dict, merchant: int = 0, special=(0, 0, 0, 0)) -> None:
    struct.pack_into("<iii", b, off, c["level"], c.get("ac", 0), c.get("damage", 0))
    b[off + 12] = merchant
    b[off + 13] = c.get("attackRun", 0)
    b[off + 14] = c.get("direction", 0)
    struct.pack_into("<iiii", b, off + 16, c["maxHp"], c["maxMp"], c["hp"], c["mp"])
    struct.pack_into("<hhhh", b, off + 32, c["str"], c["int"], c["dex"], c["con"])
    struct.pack_into("<hhhh", b, off + 40, *special)


def selchar(b: bytearray, off: int, chars: list[dict]) -> None:
    for c in chars:
        s = c["slot"]
        struct.pack_into("<H", b, off + 0 + 2 * s, c["spx"] & 0xFFFF)
        struct.pack_into("<H", b, off + 8 + 2 * s, c["spy"] & 0xFFFF)
        put_name(b, off + 16 + 16 * s, c["name"])
        score(b, off + 80 + 48 * s, c)
        for k, it in c["equip"].items():
            put_item(b, off + 272 + 128 * s + 8 * int(k), it)
        struct.pack_into("<H", b, off + 784 + 2 * s, c["guild"])
        struct.pack_into("<i", b, off + 792 + 4 * s, c["coin"])
        struct.pack_into("<q", b, off + 808 + 8 * s, c["exp"])


def cnf_account_login(chars, cargo, coin, account) -> bytearray:
    b = header(2008, 0x010A, 30002)
    struct.pack_into("<i", b, 28, 1)  # "don't recreate starter potions" marker
    selchar(b, 32, chars)
    for k, it in cargo.items():
        put_item(b, 872 + 8 * int(k), it)
    struct.pack_into("<i", b, 1896, coin)
    put_name(b, 1900, account)
    return b


def cnf_new_character(chars) -> bytearray:
    b = header(856, 0x0110, 30001)
    selchar(b, 16, chars)
    return b


def mob_name(b: bytearray, off: int, name: str, pk: int, cur: int, tot: int) -> None:
    put_name(b, off, name, 12)
    b[off + 12] = pk
    b[off + 13] = cur
    struct.pack_into("<H", b, off + 14, tot)


def struct_mob(b: bytearray, off: int, m: dict) -> None:
    mob_name(b, off, m["name"], m["pkPoint"], 0, 0)
    b[off + 16] = m["clan"]
    b[off + 17] = m["merchant"]
    struct.pack_into("<H", b, off + 18, m["guild"])
    b[off + 20] = m["class"]
    b[off + 24] = m["quest"]
    struct.pack_into("<i", b, off + 28, m["coin"])
    struct.pack_into("<q", b, off + 32, m["exp"])
    struct.pack_into("<hh", b, off + 40, m["spx"], m["spy"])
    score(b, off + 44, m, m["merchant"], m["special"])
    score(b, off + 92, m, m["merchant"], m["special"])
    for k, it in m["equip"].items():
        put_item(b, off + 140 + 8 * int(k), it)
    for k, it in m["carry"].items():
        put_item(b, off + 268 + 8 * int(k), it)
    struct.pack_into("<iIHHH", b, off + 780, m["learnedSkill"], m["magic"], m["scoreBonus"],
                     m["specialBonus"], m["skillBonus"])
    b[off + 794] = m["critical"]
    b[off + 796 : off + 800] = bytes(m["skillBar"])
    b[off + 800] = m["guildLevel"]
    struct.pack_into("<HH", b, off + 802, m["regenHP"], m["regenMP"])
    b[off + 806 : off + 810] = bytes(m["resist"])


def cnf_character_login(c: dict) -> bytearray:
    b = header(1832, 0x0114, 30000)
    struct.pack_into("<hh", b, 12, c["loginX"], c["loginY"])
    struct_mob(b, 16, c["mob"])
    struct.pack_into("<HHH", b, 1040, c["slot"], c["clientID"], c["weather"])
    b[1046:1062] = bytes(c["shortSkill"])
    return b


def create_mob(d: dict) -> bytearray:
    b = header(232, 0x0364, 30000)
    struct.pack_into("<hhH", b, 12, d["posX"], d["posY"], d["mobID"])
    if d["isPlayer"]:
        mob_name(b, 18, d["name"], d["pkPoint"], d["curKill"], d["totKill"])
    else:
        put_name(b, 18, d["name"])
    for k, v in d["equip"].items():
        struct.pack_into("<H", b, 34 + 2 * int(k), v)
    for k, v in d["affect"].items():
        struct.pack_into("<H", b, 66 + 2 * int(k), v)
    struct.pack_into("<H", b, 130, d["guild"])
    b[132] = d["guildMemberType"]
    score(b, 136, d, d["merchant"])
    struct.pack_into("<H", b, 184, d["createType"])
    for k, v in d["anct"].items():
        b[186 + int(k)] = v
    return b


# ---------------- in-world frames (etapa 4) ----------------

SCORE_SELF = {"level": 398, "ac": 120, "damage": 300, "attackRun": 0x34, "maxHp": 5000, "maxMp": 800,
              "hp": 4999, "mp": 799, "str": 200, "int": 50, "dex": 100, "con": 150, "special": [1, 2, 3, -4],
              "critical": 9, "saveMana": 10, "affect": {"0": 0x0102, "31": 0xABCD}, "guild": 77,
              "guildLevel": 513, "resist": [-1, 2, 3, 127], "magic": 300, "id": 5}
AFFECTS = {"0": {"type": 8, "value": 0x1F, "level": 3, "time": 1234},
           "31": {"type": 255, "value": 255, "level": 200, "time": 0x7FFFFFFF}}
EQUIP_UPDATE = {"id": 5, "equip": {"0": 1, "15": 3500}, "anct": {"0": 0x80, "15": 0x7F}}
TRADE = {"mob": MOB_PLAYER, "tab": "LojaTab", "desc": "Vendo pocoes baratas 123"}
HP_DAM = {"id": 1234, "hp": 100, "dam": -250}
HP_MP = {"id": 5, "hp": 4000, "mp": 700, "reqHp": 4999, "reqMp": 799}
SEND_ITEM = {"id": 5, "invType": 1, "slot": 63, "item": {"index": 401, "eff": [[7, 8], [0, 0], [255, 1]]}}
ETC = {"id": 5, "hold": 77, "exp": (1 << 40) + 9, "learn": 0x4000000140000001, "scoreBonus": 5,
       "specialBonus": 6, "skillBonus": 7, "magic": 20, "coin": 2000000001}


def update_score(s: dict) -> bytearray:
    b = header(152, 0x0336, s["id"])
    score(b, 12, s, 0, s["special"])
    b[60] = s["critical"]
    b[61] = s["saveMana"]
    for k, v in s["affect"].items():
        struct.pack_into("<H", b, 62 + 2 * int(k), v)
    struct.pack_into("<HH", b, 126, s["guild"], s["guildLevel"])
    struct.pack_into("<4b", b, 130, *s["resist"])
    struct.pack_into("<iii", b, 136, s["hp"], s["mp"], s["magic"])
    b[148:152] = b"\xcc" * 4
    return b


def send_affect(affects: dict) -> bytearray:
    b = header(268, 0x03B9, 5)
    for k, a in affects.items():
        struct.pack_into("<BBHI", b, 12 + 8 * int(k), a["type"], a["value"], a["level"], a["time"])
    return b


def update_equip(d: dict) -> bytearray:
    b = header(60, 0x036B, d["id"])
    for k, v in d["equip"].items():
        struct.pack_into("<H", b, 12 + 2 * int(k), v)
    for k, v in d["anct"].items():
        b[44 + int(k)] = v
    return b


def create_mob_trade(d: dict) -> bytearray:
    b = header(252, 0x0363, 30000)
    b[: 232] = create_mob(d["mob"])
    struct.pack_into("<HH", b, 0, 252, 0)
    struct.pack_into("<H", b, 4, 0x0363)
    put_name(b, 202, d["tab"], 26)
    put_name(b, 228, d["desc"], 24)
    return b


def set_hp_dam(d: dict) -> bytearray:
    b = header(20, 0x018A, d["id"])
    struct.pack_into("<ii", b, 12, d["hp"], d["dam"])
    return b


def set_hp_mp(d: dict) -> bytearray:
    b = header(28, 0x0181, d["id"])
    struct.pack_into("<iiii", b, 12, d["hp"], d["mp"], d["reqHp"], d["reqMp"])
    return b


def send_item(d: dict) -> bytearray:
    b = header(24, 0x0182, d["id"])
    struct.pack_into("<HH", b, 12, d["invType"], d["slot"])
    put_item(b, 16, d["item"])
    return b


def update_etc(d: dict) -> bytearray:
    b = header(48, 0x0337, d["id"])
    struct.pack_into("<IqQHHHHi", b, 12, d["hold"], d["exp"], d["learn"], d["scoreBonus"],
                     d["specialBonus"], d["skillBonus"], d["magic"], d["coin"])
    return b


# MSG_Attack as the server sends it (protocol/messages.go MsgAttackBody):
# 60 + 8N bytes, CurrentHp@16, CurrentExp@24, PosX..TargetY@34..41,
# AttackerID@42, Progress@44, Motion@46, DoubleCritical@48, CurrentMp@52,
# SkillIndex@56, ReqMp@58, Dam[i]{TargetID i32, Damage i32}@60+8i.
# The server always answers with 0x0367, whatever the request opcode was.
ATTACK_ECHO = {"id": 30000, "currentHp": 320, "currentExp": (1 << 33) + 7, "posX": 2100, "posY": 2101,
               "targetX": 2102, "targetY": 2103, "attackerId": 5, "progress": 3, "motion": 4,
               "doubleCritical": 1, "currentMp": 45, "skillIndex": -1, "reqMp": 40,
               "dam": [[1500, 37]]}
ATTACK_MULTI = dict(ATTACK_ECHO, skillIndex=33, motion=6, doubleCritical=0,
                    dam=[[1000 + i, -3 if i == 4 else 10 * i] for i in range(13)])
ATTACK_MOB = {"id": 30000, "currentHp": 900, "currentExp": 0, "posX": 2110, "posY": 2111,
              "targetX": 2100, "targetY": 2101, "attackerId": 1200, "progress": 0, "motion": 0,
              "doubleCritical": 0, "currentMp": 0, "skillIndex": 0, "reqMp": 0, "dam": [[5, 12]]}
ATTACK_TARGET_OVER = dict(ATTACK_ECHO, dam=[[70000, 37]])
ATTACK_TOO_MANY = dict(ATTACK_MULTI, dam=[[1000 + i, 1] for i in range(14)])


def attack(d: dict, opcode: int = 0x0367) -> bytearray:
    n = len(d["dam"])
    b = header(60 + 8 * n, opcode, d["id"])
    struct.pack_into("<i", b, 16, d["currentHp"])
    struct.pack_into("<q", b, 24, d["currentExp"])
    struct.pack_into("<HHHHHH", b, 34, d["posX"], d["posY"], d["targetX"], d["targetY"],
                     d["attackerId"], d["progress"])
    b[46] = d["motion"]
    b[48] = d["doubleCritical"]
    struct.pack_into("<ihh", b, 52, d["currentMp"], d["skillIndex"], d["reqMp"])
    for i, (target, dam) in enumerate(d["dam"]):
        struct.pack_into("<ii", b, 60 + 8 * i, target, dam)
    return b


# Items (ADR 007). handler/item.go tradingItem echoes the request payload as
# received: DestPlace, DestSlot, SrcPlace, SrcSlot (u8 @12..15), WarpID i32@16.
SWAP_ECHO = {"id": 5, "place0": 0, "slot0": 6, "place1": 1, "slot1": 5, "warp": 0}
SWAP_RANGE = dict(SWAP_ECHO, slot1=60)  # the runtime has 4 carry pages of 15
# equipItem echo of MSG_UseItem (34 bytes): no runtime consumer.
USE_ECHO = {"id": 5, "sourType": 1, "sourPos": 3, "destType": 0, "destPos": 6,
            "gridX": 2100, "gridY": 2101, "warpId": 0}
CARRY = {"id": 5, "coin": 1000350,
         "items": {"0": {"index": 401, "eff": [[61, 119]]}, "1": {"index": 406, "eff": [[61, 120]]},
                   "63": {"index": 3467, "eff": [[0, 0], [0, 0], [0, 0]]}}}


def swap_item(d: dict) -> bytearray:
    b = header(20, 0x0376, d["id"])
    b[12:16] = bytes([d["place0"], d["slot0"], d["place1"], d["slot1"]])
    struct.pack_into("<i", b, 16, d["warp"])
    return b


def use_item(d: dict) -> bytearray:
    b = header(34, 0x0373, d["id"])
    struct.pack_into("<iiiiHHH", b, 12, d["sourType"], d["sourPos"], d["destType"], d["destPos"],
                     d["gridX"], d["gridY"], d["warpId"])
    return b


def update_carry(d: dict) -> bytearray:
    b = header(528, 0x0185, d["id"])
    for k, it in d["items"].items():
        put_item(b, 12 + 8 * int(k), it)
    struct.pack_into("<i", b, 524, d["coin"])
    return b


def standard_parm(opcode: int, ident: int, parm: int) -> bytearray:
    b = header(16, opcode, ident)
    struct.pack_into("<i", b, 12, parm)
    return b


# Outbound expectations: what the translator must emit for runtime structs
# built by dialect_test.cpp with these values.
OUT_ACCOUNT = {"pass": "segredo1", "account": "fixture01", "force": 1, "mac": [1, 2, 3, 0xDEADBEEF]}
OUT_CHARLOGIN = {"slot": 2, "force": 0}
OUT_DELETE = {"slot": 3, "name": "Cacadora12345", "pass": "12345678901"}
OUT_SECURE = {"pin": "123456", "change": 1}


def out_account_login() -> bytearray:
    b = header(116, 0x020D, 0)
    put_name(b, 12, OUT_ACCOUNT["pass"], 12)
    put_name(b, 24, OUT_ACCOUNT["account"])
    struct.pack_into("<ii", b, 92, CLIENT_VERSION, OUT_ACCOUNT["force"])
    struct.pack_into("<4I", b, 100, *OUT_ACCOUNT["mac"])
    return b


def out_character_login() -> bytearray:
    b = header(20, 0x0213, 0)
    struct.pack_into("<ii", b, 12, OUT_CHARLOGIN["slot"], OUT_CHARLOGIN["force"])
    return b


def out_delete_character() -> bytearray:
    b = header(44, 0x0211, 0)
    struct.pack_into("<i", b, 12, OUT_DELETE["slot"])
    put_name(b, 16, OUT_DELETE["name"])
    put_name(b, 32, OUT_DELETE["pass"], 12)
    return b


def out_account_secure() -> bytearray:
    b = header(32, 0x0FDE, 0)
    put_name(b, 12, OUT_SECURE["pin"], 6)
    struct.pack_into("<i", b, 28, OUT_SECURE["change"])
    return b


# Runtime attacks (dialect_test.cpp fills MSG_Attack* with these values over
# 0xAB padding): the wire keeps only the server's fields, @16/@58 stay zero.
OUT_ATTACK_ONE = {"opcode": 0x039D, "id": 5, "posX": 2100, "posY": 2101, "targetX": 2102, "targetY": 2103,
                  "attackerId": 5, "motion": 4, "skillIndex": -1, "dam": [[1500, -2]]}
OUT_ATTACK_MULTI = {"opcode": 0x0367, "id": 5, "posX": 2100, "posY": 2101, "targetX": 2102, "targetY": 2103,
                    "attackerId": 5, "motion": 6, "skillIndex": 33,
                    "dam": [[1000, -1], [1001, -1]] + [[0, 0]] * 11}


# Runtime MSG_SwapItem / MSG_UseItem built by dialect_test.cpp (0xAB padding).
OUT_SWAP = {"id": 5, "place0": 0, "slot0": 6, "place1": 1, "slot1": 5, "warp": 1234}
OUT_USE = {"id": 5, "sourType": 1, "sourPos": 0, "destType": 0, "destPos": 0,
           "gridX": 2100, "gridY": 2101, "warpId": 777}


def out_attack(d: dict) -> bytearray:
    n = len(d["dam"])
    b = header(60 + 8 * n, d["opcode"], d["id"])
    struct.pack_into("<HHHHH", b, 34, d["posX"], d["posY"], d["targetX"], d["targetY"], d["attackerId"])
    b[46] = d["motion"]
    struct.pack_into("<h", b, 56, d["skillIndex"])
    for i, (target, dam) in enumerate(d["dam"]):
        struct.pack_into("<ii", b, 60 + 8 * i, target, dam)
    return b


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    over = [dict(SELCHARS[0], level=40000)]
    score_magic = dict(SCORE_SELF, magic=70000)
    score_level = dict(SCORE_SELF, level=40000)
    dam_over = dict(HP_DAM, dam=100000)
    inbound = {
        "cnf_account_login": (cnf_account_login(SELCHARS, CARGO, 123456789, "fixture01"),
                              {"chars": SELCHARS, "cargo": CARGO, "coin": 123456789, "account": "fixture01"}),
        "cnf_account_login_level_overflow": (cnf_account_login(over, {}, 0, "fixture01"),
                                             {"chars": over, "cargo": {}, "coin": 0, "account": "fixture01"}),
        "cnf_new_character": (cnf_new_character(SELCHARS[:2]), {"chars": SELCHARS[:2]}),
        "cnf_character_login": (cnf_character_login(CHAR_LOGIN), CHAR_LOGIN),
        "create_mob_player": (create_mob(MOB_PLAYER), MOB_PLAYER),
        "create_mob_npc": (create_mob(MOB_NPC), MOB_NPC),
        "update_score": (update_score(SCORE_SELF), SCORE_SELF),
        "update_score_magic_overflow": (update_score(score_magic), score_magic),
        "update_score_level_overflow": (update_score(score_level), score_level),
        "send_affect": (send_affect(AFFECTS), {"affects": AFFECTS}),
        "update_equip": (update_equip(EQUIP_UPDATE), EQUIP_UPDATE),
        "create_mob_trade": (create_mob_trade(TRADE), TRADE),
        "set_hp_dam": (set_hp_dam(HP_DAM), HP_DAM),
        "set_hp_dam_overflow": (set_hp_dam(dam_over), dam_over),
        "set_hp_mp": (set_hp_mp(HP_MP), HP_MP),
        "send_item": (send_item(SEND_ITEM), SEND_ITEM),
        "update_etc": (update_etc(ETC), ETC),
        "pk_info": (standard_parm(0x0166, 5, 75), {"id": 5, "parm": 75}),
        "update_weather": (standard_parm(0x018B, 30000, 2), {"id": 30000, "parm": 2}),
        # handler/notice.go: MsgMessageBoxOk with the local notice code, ID = conn.
        "notice_bad_pass": (standard_parm(0x0102, 7, 3), {"id": 7, "parm": 3}),
        "notice_unknown": (standard_parm(0x0102, 7, 999), {"id": 7, "parm": 999}),
        # handler/combat.go echo of a one-target request, mobai.go mob strike.
        "attack_echo": (attack(ATTACK_ECHO), ATTACK_ECHO),
        "attack_multi": (attack(ATTACK_MULTI), ATTACK_MULTI),
        "attack_mob": (attack(ATTACK_MOB), ATTACK_MOB),
        "attack_target_overflow": (attack(ATTACK_TARGET_OVER), ATTACK_TARGET_OVER),
        "attack_too_many": (attack(ATTACK_TOO_MANY), ATTACK_TOO_MANY),
        "swap_item": (swap_item(SWAP_ECHO), SWAP_ECHO),
        "swap_item_range": (swap_item(SWAP_RANGE), SWAP_RANGE),
        "use_item": (use_item(USE_ECHO), USE_ECHO),
        "update_carry": (update_carry(CARRY), CARRY),
    }
    outbound = {
        "account_login": (out_account_login(), dict(OUT_ACCOUNT, clientVersion=CLIENT_VERSION)),
        "character_login": (out_character_login(), OUT_CHARLOGIN),
        "delete_character": (out_delete_character(), OUT_DELETE),
        "account_secure": (out_account_secure(), OUT_SECURE),
        "attack_one": (out_attack(OUT_ATTACK_ONE), OUT_ATTACK_ONE),
        "attack_multi": (out_attack(OUT_ATTACK_MULTI), OUT_ATTACK_MULTI),
        "swap_item": (swap_item(OUT_SWAP), OUT_SWAP),
        "use_item": (use_item(OUT_USE), OUT_USE),
    }
    doc = {
        "generator": "tools/protocol/gen_fixtures.py",
        "note": "synthetic; no real account data. wire_hex is the full plaintext frame (header included).",
        "clientVersion": CLIENT_VERSION,
        "inbound": {k: {"wire_hex": v[0].hex(), "logical": v[1]} for k, v in inbound.items()},
        "outbound": {k: {"wire_hex": v[0].hex(), "logical": v[1]} for k, v in outbound.items()},
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8", newline="\n")

    OUT_H.parent.mkdir(parents=True, exist_ok=True)
    lines = ["// Generated by tools/protocol/gen_fixtures.py. Do not edit.", "#pragma once", ""]
    for group, items in (("in", inbound), ("out", outbound)):
        for k, (frame, _) in items.items():
            arr = ", ".join(f"0x{x:02x}" for x in frame)
            lines.append(f"static const unsigned char k_{group}_{k}[{len(frame)}] = {{{arr}}};")
    lines.append(f"static const int kClientVersion = {CLIENT_VERSION};")
    OUT_H.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(inbound)} inbound + {len(outbound)} outbound fixtures -> {OUT_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
