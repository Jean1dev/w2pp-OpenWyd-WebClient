#!/usr/bin/env python3
"""Independent CPSock reference: header, keyword transform, checksum and framing.

The key table is parsed from the upstream C++ client source (CPSock.cpp), never
from the Go server, and the transform follows CPSock::AddMessage/ReadMessage.
The Go table is parsed only to compare hashes. Running this module with
``--check`` prints both SHA-256 digests and fails if they differ.

Nothing here comes from the encoder under test, so vectors generated with it
are a genuine cross-check of both the Go server and the C++ client codec.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CPP_SOCK = ROOT / "external/OpenWyd/Projects/TMProject/CPSock.cpp"
GO_TABLE = ROOT / "external/server/tmserver/internal/protocol/keytable.go"
# Snapshot of the legacy server spec (cites legacy Source/Code/CPSock.cpp).
SPEC_TABLE = ROOT / "reference/server/protocol-spec.md"

HEADER_SIZE = 12
INIT_CODE = 0x1F11F311
MAX_FRAME = 8192  # server limit (header.go MaxMessageSize)


def _parse_table(text: str, opener: str, source: Path) -> bytes:
    start = text.find(opener)
    if start < 0:
        raise ValueError(f"{source}: table opener {opener!r} not found")
    body = text[text.index("{", start) + 1 : text.index("}", start)]
    values = [int(v, 16) for v in re.findall(r"0x([0-9a-fA-F]{1,2})\b", body)]
    if len(values) != 512:
        raise ValueError(f"{source}: expected 512 table bytes, parsed {len(values)}")
    return bytes(values)


def cpp_table(path: Path = CPP_SOCK) -> bytes:
    return _parse_table(path.read_text(encoding="utf-8", errors="replace"),
                        "unsigned char pKeyWord[512]", path)


def spec_table(path: Path = SPEC_TABLE) -> bytes:
    return _parse_table(path.read_text(encoding="utf-8"), "unsigned char pKeyWord[512]", path)


def go_table(path: Path = GO_TABLE) -> bytes:
    return _parse_table(path.read_text(encoding="utf-8"), "var keyWord = [512]byte", path)


class CPSock:
    """Reference codec over a given 512-byte table."""

    def __init__(self, table: bytes):
        if len(table) != 512:
            raise ValueError("table must have 512 bytes")
        self.t = table

    def _transform(self, frame: bytearray, ikey: int, encode: bool) -> tuple[int, int]:
        """Transform bytes [4:size) in place. Returns (sum_plain, sum_wire)."""
        pos = self.t[ikey * 2]
        s_plain = s_wire = 0
        for i in range(4, len(frame)):
            trans = self.t[(pos % 256) * 2 + 1]
            mod = i & 3
            if encode:
                s_plain += frame[i]
                if mod == 0:
                    frame[i] = (frame[i] + (trans << 1)) & 0xFF
                elif mod == 1:
                    frame[i] = (frame[i] - (trans >> 3)) & 0xFF
                elif mod == 2:
                    frame[i] = (frame[i] + (trans << 2)) & 0xFF
                else:
                    frame[i] = (frame[i] - (trans >> 5)) & 0xFF
                s_wire += frame[i]
            else:
                s_wire += frame[i]
                if mod == 0:
                    frame[i] = (frame[i] - (trans << 1)) & 0xFF
                elif mod == 1:
                    frame[i] = (frame[i] + (trans >> 3)) & 0xFF
                elif mod == 2:
                    frame[i] = (frame[i] - (trans << 2)) & 0xFF
                else:
                    frame[i] = (frame[i] + (trans >> 5)) & 0xFF
                s_plain += frame[i]
            pos += 1
        return s_plain & 0xFF, s_wire & 0xFF

    def encode(self, plain: bytes, ikey: int) -> bytes:
        """Obfuscate a full plaintext frame (header included).

        Like the client, Size/KeyWord/CheckSum are rewritten; Type/ID/Tick and
        the body are taken from ``plain``.
        """
        if not HEADER_SIZE <= len(plain) <= 0xFFFF:
            raise ValueError("frame size out of range")
        frame = bytearray(plain)
        struct.pack_into("<HBB", frame, 0, len(frame), ikey, 0)
        s_plain, s_wire = self._transform(frame, ikey, encode=True)
        frame[3] = (s_wire - s_plain) & 0xFF
        return bytes(frame)

    def decode(self, wire: bytes) -> tuple[bytes, bool]:
        """Return (plain frame, checksum_ok). Header bytes 0..3 are kept."""
        size, ikey, check = struct.unpack_from("<HBB", wire, 0)
        if size != len(wire):
            raise ValueError("size field does not match frame length")
        frame = bytearray(wire)
        s_plain, s_wire = self._transform(frame, ikey, encode=False)
        return bytes(frame), ((s_wire - s_plain) & 0xFF) == check


class StreamError(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def split_frames(stream: bytes, expect_init: bool, max_frame: int = MAX_FRAME) -> list[bytes]:
    """Frame a byte stream the way the server framer must.

    Raises StreamError with kind ``bad_init``, ``bad_size`` or
    ``unexpected_eof``.
    """
    pos = 0
    if expect_init:
        if len(stream) < 4:
            raise StreamError("unexpected_eof" if stream else "eof")
        if struct.unpack_from("<I", stream, 0)[0] != INIT_CODE:
            raise StreamError("bad_init")
        pos = 4
    frames = []
    while pos < len(stream):
        if len(stream) - pos < HEADER_SIZE:
            raise StreamError("unexpected_eof")
        size = struct.unpack_from("<H", stream, pos)[0]
        if size < HEADER_SIZE or size > max_frame:
            raise StreamError("bad_size")
        if len(stream) - pos < size:
            raise StreamError("unexpected_eof")
        frames.append(stream[pos : pos + size])
        pos += size
    return frames


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail unless C++, Go and spec tables match")
    ap.add_argument("--json", type=Path, help="write the hash report to this file")
    args = ap.parse_args()
    cpp, go, spec = cpp_table(), go_table(), spec_table()
    report = {
        "spec_source": str(SPEC_TABLE.relative_to(ROOT)).replace("\\", "/"),
        "spec_table_sha256": hashlib.sha256(spec).hexdigest(),
        "cpp_source": str(CPP_SOCK.relative_to(ROOT)).replace("\\", "/"),
        "cpp_table_sha256": hashlib.sha256(cpp).hexdigest(),
        "go_source": str(GO_TABLE.relative_to(ROOT)).replace("\\", "/"),
        "go_table_sha256": hashlib.sha256(go).hexdigest(),
        "table_bytes": len(cpp),
        "identical": cpp == go == spec,
    }
    if not cpp == go == spec:
        report["first_difference"] = next(i for i in range(512) if not cpp[i] == go[i] == spec[i])
    print(json.dumps(report, indent=2))
    if args.json:
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if (report["identical"] or not args.check) else 1


if __name__ == "__main__":
    sys.exit(main())
