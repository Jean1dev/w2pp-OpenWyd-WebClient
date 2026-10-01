#!/usr/bin/env python3
"""Scripted server->client stream for tools/verify_client_stream.mjs.

The scripted server answers the client's AccountLogin with:
  1. the synthetic CNFAccountLogin fixture (translated by the client),
  2. a MessagePanel (passed through),
  3. BULK frames of an unmapped opcode (framed and hashed, then dropped by the
     dialect) totalling more than the client's 128 KiB receive buffer, cut so
     that every chunk ends mid-frame.
Frames are obfuscated with varied keywords by the independent reference codec.
The expected FNV-1a hash matches WydDialectInboundHash (bytes [4, Size) of
each plaintext frame, in order).

Also decodes the bytes the client sent (--check-c2s) and verifies INITCODE,
framing, checksum and the AccountLogin fields, without printing credentials.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

from cpsock_ref import CPSock, INIT_CODE, StreamError, cpp_table, split_frames

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache/client-stream"
FIXTURES = ROOT / "docs/evidence/03-protocolo/fixtures/dialect.json"
BULK_FRAMES = 1000        # 1000 x 152 B = 152,000 B > RECV_BUFFER_SIZE (131,072)
BULK_OPCODE = 0x03A6      # CombineItem: not mapped (trade is, since etapa 5 slice 4)
CHUNK = 1000              # never a multiple of 152: chunks end mid-frame


def fnv(frames: list[bytes]) -> int:
    h = 2166136261
    for f in frames:
        for b in f[4:]:
            h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def frame(opcode: int, size: int, ident: int, fill: int, tick: int) -> bytes:
    b = bytearray([fill & 0xFF]) * size
    struct.pack_into("<HBBHHI", b, 0, size, 0, 0, opcode, ident, tick)
    return bytes(b)


def build() -> dict:
    ref = CPSock(cpp_table())
    fx = json.loads(FIXTURES.read_text(encoding="utf-8"))
    login = bytes.fromhex(fx["inbound"]["cnf_account_login"]["wire_hex"])
    panel = bytearray(frame(0x0101, 140, 0, 0, 7))
    panel[12:12 + 17] = b"fixture: stream\x00\x00"
    plain = [login, bytes(panel)]
    plain += [frame(BULK_OPCODE, 152, 30000 + (i % 7), i, i) for i in range(BULK_FRAMES)]
    wire = b"".join(ref.encode(p, (17 + 37 * i) % 256) for i, p in enumerate(plain))

    # Chunk plan: header of the first frame split 1+5+6, then the rest of the
    # login frame in odd pieces, then fixed CHUNK-sized pieces.
    plan = [1, 5, 6, 700, 700]
    plan.append(len(login) - sum(plan))
    rest = len(wire) - sum(plan)
    plan += [CHUNK] * (rest // CHUNK) + ([rest % CHUNK] if rest % CHUNK else [])
    assert sum(plan) == len(wire)
    ends_mid = sum(1 for i in range(len(plan)) if (sum(plan[: i + 1]) - len(login) - len(panel)) % 152)
    return {
        "reply_hex": wire.hex(),
        "chunks": plan,
        "expect": {
            "frames": len(plain),
            "hash": f"{fnv(plain):08x}",
            "translated": 1,
            "passed": 1,
            "droppedUnknown": BULK_FRAMES,
            "bytes": len(wire),
            "chunksEndingMidFrame": ends_mid,
            "selcharNames": ["Guerreiro", "Maga", "", "Cacadora12345"],
        },
    }


def check_c2s(path: Path, client_version: int) -> int:
    ref = CPSock(cpp_table())
    data = path.read_bytes()
    try:
        frames = split_frames(data, expect_init=True)
    except StreamError as e:
        print(json.dumps({"ok": False, "error": e.kind}))
        return 1
    report = {"ok": False, "frames": [], "initcode": struct.unpack_from("<I", data)[0] == INIT_CODE}
    for f in frames:
        plain, ok = ref.decode(f)
        op = struct.unpack_from("<H", plain, 4)[0]
        entry = {"opcode": f"0x{op:04x}", "size": len(f), "keyword": f[2], "checksumOk": ok}
        if op == 0x020D and len(plain) == 116:
            version, force = struct.unpack_from("<ii", plain, 92)
            entry.update({
                "clientVersion": version,
                "force": force,
                "accountFieldSet": plain[24] != 0,
                "passwordFieldSet": plain[12] != 0,
                "reservedZero": not any(plain[40:92]),
            })
        report["frames"].append(entry)
    first = report["frames"][0] if report["frames"] else {}
    report["ok"] = (report["initcode"] and first.get("opcode") == "0x020d" and first.get("size") == 116
                    and first.get("checksumOk") and first.get("clientVersion") == client_version
                    and first.get("accountFieldSet") and first.get("passwordFieldSet")
                    and first.get("reservedZero"))
    print(json.dumps(report))
    return 0 if report["ok"] else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check-c2s", type=Path, help="decode client bytes captured by the scripted server")
    ap.add_argument("--client-version", type=int, default=12000)
    args = ap.parse_args()
    if args.check_c2s:
        return check_c2s(args.check_c2s, args.client_version)
    OUT.mkdir(parents=True, exist_ok=True)
    script = build()
    (OUT / "script.json").write_text(json.dumps(script), encoding="utf-8")
    print(json.dumps(script["expect"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
