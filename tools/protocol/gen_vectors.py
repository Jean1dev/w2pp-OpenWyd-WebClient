#!/usr/bin/env python3
"""Generate CPSock transport and stream vectors with the independent reference.

Output (deterministic, fixed seed):
  <out>/transport/*.json  one frame per file, in the server fixture schema
                          (tmserver/test/fixtures/transport/_schema_example.json)
  <out>/streams.json      byte streams with chunk plans and the expected
                          framing outcome, valid and adversarial

Plain frames are synthetic; nothing here is a capture of real traffic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import struct
from pathlib import Path

from cpsock_ref import CPSock, HEADER_SIZE, INIT_CODE, StreamError, cpp_table, split_frames

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "docs/evidence/03-protocolo/vectors"
SEED = 7662

# Keywords: 3 is what the upstream client forces (CPSock.cpp AddMessage);
# 0/255 are the table edges; others exercise position wrap.
KEYWORDS = [0, 3, 42, 127, 128, 200, 255]
# Sizes: header-only, one/three body bytes (all i&3 lanes), CPSock login
# sizes (116, 2008) and the 8192 upper bound.
SIZES = [12, 13, 15, 16, 116, 2008, 8192]


def plain_frame(rng: random.Random, size: int, opcode: int, ident: int, fill: str) -> bytes:
    body_len = size - HEADER_SIZE
    if fill == "zero":
        body = bytes(body_len)
    elif fill == "ff":
        body = b"\xff" * body_len
    else:
        body = bytes(rng.randrange(256) for _ in range(body_len))
    hdr = struct.pack("<HBBHHI", size, 0, 0, opcode, ident, rng.randrange(1 << 32))
    return hdr + body


def hexs(b: bytes) -> str:
    return b.hex()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    rng = random.Random(SEED)
    ref = CPSock(cpp_table())
    tdir = args.out / "transport"
    tdir.mkdir(parents=True, exist_ok=True)
    for old in tdir.glob("*.json"):
        old.unlink()

    written = []
    for ik in KEYWORDS:
        for size in SIZES:
            # Keep the large frames few: one random 8192/2008 per keyword edge.
            if size >= 2008 and ik not in (0, 3, 255):
                continue
            fills = ["random"] if size > 16 else ["zero", "ff", "random"]
            for fill in fills:
                plain = plain_frame(rng, size, 0x020D if size == 116 else 0x0364, 30000 + ik, fill)
                wire = ref.encode(plain, ik)
                back, ok = ref.decode(wire)
                assert ok and back[4:] == plain[4:], "reference round trip failed"
                # plain_hex carries the header exactly as the client builds it
                # before encoding: Size, KeyWord=ik, CheckSum=0.
                plain_hdr = bytearray(plain)
                struct.pack_into("<HBB", plain_hdr, 0, size, ik, 0)
                name = f"k{ik:03d}_s{size:04d}_{fill}.json"
                vec = {
                    "kind": "transport",
                    "v": 1,
                    "note": "synthetic; encoded by tools/protocol/cpsock_ref.py from the C++ table",
                    "iKeyWord": ik,
                    "plain_hex": hexs(bytes(plain_hdr)),
                    "wire_hex": hexs(wire),
                    "checksum": wire[3],
                }
                (tdir / name).write_text(json.dumps(vec, indent=1) + "\n", encoding="utf-8", newline="\n")
                written.append(name)

    streams = build_streams(rng, ref)
    (args.out / "streams.json").write_text(json.dumps(streams, indent=1) + "\n", encoding="utf-8", newline="\n")

    manifest = {
        "generator": "tools/protocol/gen_vectors.py",
        "seed": SEED,
        "table_sha256": hashlib.sha256(ref.t).hexdigest(),
        "transport_vectors": len(written),
        "streams": len(streams),
        "files": {
            p.relative_to(args.out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(args.out.rglob("*.json")) if p.name != "manifest.json"
        },
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(written)} transport vectors, {len(streams)} streams -> {args.out}")
    return 0


def build_streams(rng: random.Random, ref: CPSock) -> list[dict]:
    init = struct.pack("<I", INIT_CODE)
    a = ref.encode(plain_frame(rng, 116, 0x020D, 0, "random"), 3)
    b = ref.encode(plain_frame(rng, 20, 0x0213, 0, "random"), 3)
    c = ref.encode(plain_frame(rng, 52, 0x036C, 7, "random"), 3)
    big = ref.encode(plain_frame(rng, 8192, 0x0364, 1, "random"), 255)
    login = ref.encode(plain_frame(rng, 2008, 0x010A, 30002, "random"), 17)
    mob = ref.encode(plain_frame(rng, 232, 0x0364, 30000, "random"), 99)
    bad_sum = bytearray(ref.encode(plain_frame(rng, 40, 0x0101, 0, "random"), 5))
    bad_sum[3] ^= 0x5A

    def one_by_one(n: int) -> list[int]:
        return [1] * n

    def header_splits(frame: bytes) -> list[list[int]]:
        return [[k, len(frame) - k] for k in range(1, HEADER_SIZE)]

    cases: list[dict] = []

    def add(name, direction, stream, chunks, **expect):
        assert sum(chunks) == len(stream), name
        want_frames = expect.pop("frames", None)
        want_error = expect.pop("error", "")
        # Cross-check the expectation with the reference framer.
        try:
            got = split_frames(stream, expect_init=(direction == "c2s"))
            got_err = ""
        except StreamError as e:
            got, got_err = None, e.kind
        if want_error:
            assert got_err == want_error, (name, got_err)
        else:
            assert got == want_frames, name
        cases.append({
            "name": name,
            "direction": direction,
            "stream_hex": stream.hex(),
            "chunks": chunks,
            "expect_frames_hex": [f.hex() for f in want_frames] if want_frames else [],
            "expect_checksum_ok": [ref.decode(f)[1] for f in want_frames] if want_frames else [],
            "expect_error": want_error,
            **expect,
        })

    s = init + a + b + c
    add("c2s handshake split 1+3", "c2s", s, [1, 3, len(s) - 4], frames=[a, b, c])
    add("c2s byte by byte", "c2s", s, one_by_one(len(s)), frames=[a, b, c])
    for i, plan in enumerate(header_splits(a)):
        st = init + a
        add(f"c2s header split at {plan[0]}", "c2s", st, [4] + plan, frames=[a])
    add("c2s three frames in one chunk", "c2s", s, [len(s)], frames=[a, b, c])
    add("c2s max frame 8192", "c2s", init + big, [4, 4096, 4096], frames=[big])
    add("c2s bad init code", "c2s", b"\x11\xF3\x11\x1E" + a, [4 + len(a)], error="bad_init")
    add("c2s partial init then eof", "c2s", init[:3], [3], error="unexpected_eof")
    for sz in (0, 11, 8193, 0xFFFF):
        hdr = bytearray(a)
        struct.pack_into("<H", hdr, 0, sz)
        add(f"c2s invalid size {sz}", "c2s", init + bytes(hdr), [4 + len(hdr)], error="bad_size")
    add("c2s frame truncated by eof", "c2s", init + a[:70], [4, 70], error="unexpected_eof")
    add("c2s header truncated by eof", "c2s", init + a[:7], [4, 7], error="unexpected_eof")
    add("c2s bad checksum is framed and flagged", "c2s", init + bytes(bad_sum), [4 + len(bad_sum)],
        frames=[bytes(bad_sum)])

    # Server-to-client streams have no INITCODE: the client never expects one.
    t = login + mob + b
    add("s2c login+createmob+short in one chunk", "s2c", t, [len(t)], frames=[login, mob, b])
    add("s2c split every 700", "s2c", t,
        [700] * (len(t) // 700) + ([len(t) % 700] if len(t) % 700 else []), frames=[login, mob, b])
    add("s2c header split at 5 then rest", "s2c", mob, [5, len(mob) - 5], frames=[mob])
    add("s2c frame truncated by eof", "s2c", mob[:100], [100], error="unexpected_eof")
    return cases


if __name__ == "__main__":
    raise SystemExit(main())
