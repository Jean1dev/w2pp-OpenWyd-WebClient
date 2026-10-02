#!/usr/bin/env python3
"""Check the exports of a published site's WASM runtime (ADR 003, ADR 015).

Reads the export section of the .wasm itself, not the JS glue, and fails when:
- any wyd_debug_* entry point (test-harness automation and probes) is exported;
- a _wyd_* function referenced by a page script of the site is not exported.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEBUG_PREFIX = "wyd_debug_"
PAGE_NAME = re.compile(r"\b_(wyd_[a-z0-9_]+)\b")


def _leb(data: bytes, pos: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7


def wasm_exports(data: bytes) -> set[str]:
    if data[:8] != b"\0asm\x01\0\0\0":
        raise ValueError("not a WebAssembly 1.0 module")
    pos = 8
    while pos < len(data):
        section, pos = data[pos], pos + 1
        size, pos = _leb(data, pos)
        end = pos + size
        if section == 7:
            names = set()
            count, pos = _leb(data, pos)
            for _ in range(count):
                length, pos = _leb(data, pos)
                names.add(data[pos:pos + length].decode("utf-8"))
                pos += length + 1  # kind byte
                _, pos = _leb(data, pos)  # index
            return names
        pos = end
    return set()


def check(site: Path) -> list[str]:
    wasms = sorted(site.glob("tmproject_startup.*.wasm"))
    if len(wasms) != 1:
        return [f"expected one tmproject_startup.*.wasm in {site}, found {len(wasms)}"]
    exports = wasm_exports(wasms[0].read_bytes())
    errors = [f"debug export present: {name}" for name in sorted(exports) if name.startswith(DEBUG_PREFIX)]
    for page in sorted(site.glob("*.js")):
        if page.name == "runtime.js":
            continue
        for name in sorted(set(PAGE_NAME.findall(page.read_text(encoding="utf-8")))):
            if name not in exports:
                errors.append(f"{page.name} uses _{name}, which is not exported")
    print(f"{wasms[0].name}: {len(exports)} exports, "
          f"{sum(n.startswith('wyd_') for n in exports)} wyd_*, {len(errors)} problem(s)")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--site", type=Path, required=True)
    errors = check(ap.parse_args().site)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
