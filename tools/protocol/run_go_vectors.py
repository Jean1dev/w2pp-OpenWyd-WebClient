#!/usr/bin/env python3
"""Run the independent vectors against the Go server codec, read-only.

Test files from tools/protocol/overlay/ are injected into the server's
protocol package with `go test -overlay`, so the pinned checkout in
external/server is never modified.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "external/server"
OVERLAY_SRC = ROOT / "tools/protocol/overlay"
GO = ROOT / ".cache/toolchains/go/bin" / ("go.exe" if os.name == "nt" else "go")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--vectors", type=Path, default=ROOT / "docs/evidence/03-protocolo/vectors")
    ap.add_argument("--dialect", type=Path,
                    default=ROOT / "docs/evidence/03-protocolo/fixtures/dialect.json")
    ap.add_argument("--run", default="TestExt", help="go test -run pattern")
    ap.add_argument("--server", type=Path, default=SERVER, help="server checkout (read-only)")
    args = ap.parse_args()
    server = args.server.resolve()
    pkg_dir = server / "tmserver/internal/protocol"

    replace = {}
    for src in sorted(OVERLAY_SRC.glob("*_test.go")):
        target = pkg_dir / src.name
        if target.exists():
            raise SystemExit(f"refusing to shadow an existing server file: {target}")
        replace[str(target)] = str(src)
    overlay = ROOT / ".cache/go-overlay.json"
    overlay.parent.mkdir(parents=True, exist_ok=True)
    overlay.write_text(json.dumps({"Replace": replace}, indent=1), encoding="utf-8")

    env = dict(os.environ, GOTOOLCHAIN="local", W2PP_EXT_VECTORS=str(args.vectors.resolve()),
               W2PP_EXT_DIALECT=str(args.dialect.resolve()),
               GOPATH=str(ROOT / ".cache/gopath"), GOMODCACHE=str(ROOT / ".cache/gomod"))
    go = str(GO) if GO.exists() else "go"
    cmd = [go, "test", "-count=1", f"-overlay={overlay}", "-run", args.run, "-v",
           "./tmserver/internal/protocol"]
    print("+", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=server, env=env)


if __name__ == "__main__":
    sys.exit(main())
