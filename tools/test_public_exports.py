"""Tests for check_public_exports.py with hand-built WASM modules."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from check_public_exports import check, wasm_exports


def leb(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def module(*names: str) -> bytes:
    """One function `() -> ()` exported under every name."""
    def section(sid: int, body: bytes) -> bytes:
        return bytes([sid]) + leb(len(body)) + body
    types = section(1, b"\x01\x60\x00\x00")
    funcs = section(3, b"\x01\x00")
    exports = leb(len(names)) + b"".join(leb(len(n)) + n.encode() + b"\x00\x00" for n in names)
    code = section(10, b"\x01\x02\x00\x0b")
    return b"\0asm\x01\0\0\0" + types + funcs + section(7, exports) + code


class PublicExportsTest(unittest.TestCase):
    def site(self, names: list[str], page: str) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "tmproject_startup.123.wasm").write_bytes(module(*names))
        (root / "client.js").write_text(page, encoding="utf-8")
        (root / "runtime.js").write_text("Module['_wyd_debug_x']", encoding="utf-8")
        return root

    def test_parses_export_names(self):
        self.assertEqual(wasm_exports(module("a", "wyd_tick_client")), {"a", "wyd_tick_client"})

    def test_clean_site(self):
        root = self.site(["wyd_tick_client", "wyd_net_stat"], "M._wyd_tick_client(); M._wyd_net_stat(0)")
        self.assertEqual(check(root), [])

    def test_debug_export_fails(self):
        root = self.site(["wyd_tick_client", "wyd_debug_selchar_pin"], "M._wyd_tick_client()")
        self.assertEqual(check(root), ["debug export present: wyd_debug_selchar_pin"])

    def test_missing_page_export_fails(self):
        root = self.site(["wyd_tick_client"], "M._wyd_tick_client(); M._wyd_audio_set_levels(1, 2)")
        self.assertEqual(check(root), ["client.js uses _wyd_audio_set_levels, which is not exported"])


if __name__ == "__main__":
    unittest.main()
