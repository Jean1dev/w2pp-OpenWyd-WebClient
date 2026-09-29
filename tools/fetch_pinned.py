#!/usr/bin/env python3
"""Sparse-clone the pinned server or upstream checkout from dependencies.lock.json.

    python tools/fetch_pinned.py server     # -> external/server
    python tools/fetch_pinned.py upstream   # -> external/OpenWyd

Refuses to touch an existing directory; verifies HEAD equals the locked commit.
The sparse sets are the ones docs/setup.md documents.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPARSE = {
    "server": ("external/server", ["tmserver", "internal", "api", "dbserver", "binserver", "webserver",
                                   "scripts", "docs/migration", "development-guidelines"]),
    "upstream": ("external/OpenWyd", ["Projects/TMProject", "Dependencies/Directx/Include",
                                      "webclient/client-wasm/compat", "webclient/client-wasm/config",
                                      "webclient/client-wasm/tools", "webclient/client-wasm/build/link"]),
}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("which", choices=sorted(SPARSE))
    args = ap.parse_args()
    lock = json.loads((ROOT / "dependencies.lock.json").read_text(encoding="utf-8"))[args.which]
    rel, paths = SPARSE[args.which]
    dest = ROOT / rel
    if dest.exists():
        head = git("-C", str(dest), "rev-parse", "HEAD")
        if head != lock["commit"]:
            print(f"{rel} is at {head}, lock requires {lock['commit']}", file=sys.stderr)
            return 2
        print(f"{rel} already at {head}")
        return 0
    git("clone", "--filter=blob:none", "--no-checkout", "--sparse", lock["url"], str(dest))
    git("-C", str(dest), "sparse-checkout", "set", *paths)
    git("-C", str(dest), "checkout", "--detach", lock["commit"])
    head = git("-C", str(dest), "rev-parse", "HEAD")
    if head != lock["commit"]:
        print(f"checkout gave {head}, expected {lock['commit']}", file=sys.stderr)
        return 1
    print(f"{rel} at {head}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
