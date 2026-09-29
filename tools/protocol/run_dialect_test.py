#!/usr/bin/env python3
"""Build tools/protocol/dialect_test.cpp for wasm32 with em++ and run it in Node.

Uses the same compiler and target ABI as the browser runtime, the patched
Basedef.h from external/OpenWyd (run tools/apply_openwyd_patches.py first) and
the fixtures from tools/protocol/gen_fixtures.py.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# The pinned local toolchain (docs/setup.md); CI uses the emscripten/emsdk image
# of the same version, which exports EMSDK.
LOCAL_EMSDK = ROOT / ".cache/toolchains/emsdk"
EMSDK = LOCAL_EMSDK if LOCAL_EMSDK.is_dir() else Path(os.environ.get("EMSDK", LOCAL_EMSDK))
EMXX = EMSDK / "upstream/emscripten" / ("em++.exe" if os.name == "nt" else "em++")
NODE_GLOB = "node/*/bin/node" + (".exe" if os.name == "nt" else "")
OUT = ROOT / ".cache/dialect"


def main() -> int:
    subprocess.check_call([sys.executable, str(ROOT / "tools/protocol/gen_fixtures.py")])
    OUT.mkdir(parents=True, exist_ok=True)
    prelude = OUT / "prelude.h"
    # Basedef.h references HWND only through an extern global.
    prelude.write_text("using HWND = void*;\n", encoding="utf-8")
    js = OUT / "dialect_test.js"
    env = dict(os.environ, EMSDK=str(EMSDK))
    cmd = [str(EMXX), "-std=c++17", "-fms-extensions", "-O1", "-Wall", "-Wno-unused-function",
           "-DWYD_DIALECT_STANDALONE", "-include", str(prelude),
           "-I", str(ROOT / "client/dialect"), "-I", str(ROOT / "external/OpenWyd/Projects/TMProject"),
           "-I", str(OUT),
           str(ROOT / "tools/protocol/dialect_test.cpp"), str(ROOT / "client/dialect/WydDialect.cpp"),
           "-sENVIRONMENT=node", "-o", str(js)]
    print("+", " ".join(cmd), flush=True)
    if subprocess.call(cmd, env=env) != 0:
        return 1
    node = next(iter(sorted(EMSDK.glob(NODE_GLOB))), None)
    return subprocess.call([str(node) if node else "node", str(js)])


if __name__ == "__main__":
    sys.exit(main())
