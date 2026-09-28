#!/usr/bin/env python3
"""Apply this repository's changes to the pinned OpenWyd checkout.

1. Refuses to run unless external/OpenWyd is at the commit in dependencies.lock.json.
2. Copies our own sources (client/dialect/*) into Projects/TMProject.
3. Applies patches/openwyd/*.patch in order with `git apply`; a patch that is
   already applied is detected with a reverse check and skipped.

Run with --check to report state without modifying anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "external/OpenWyd"
TMPROJECT = UPSTREAM / "Projects/TMProject"
PATCHES = ROOT / "patches/openwyd"
OWN_SOURCES = [ROOT / "client/dialect/WydDialect.h", ROOT / "client/dialect/WydDialect.cpp"]


def git(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(UPSTREAM), *args], capture_output=True, text=True, check=check)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="report only")
    args = ap.parse_args()

    lock = json.loads((ROOT / "dependencies.lock.json").read_text(encoding="utf-8"))
    want = lock["upstream"]["commit"]
    head = git("rev-parse", "HEAD", check=True).stdout.strip()
    if head != want:
        print(f"external/OpenWyd is at {head}, lock requires {want}", file=sys.stderr)
        return 2

    status = 0
    for src in OWN_SOURCES:
        dst = TMPROJECT / src.name
        same = dst.exists() and sha(dst) == sha(src)
        print(f"source {src.name}: {'current' if same else 'copy needed'}")
        if not same and not args.check:
            shutil.copyfile(src, dst)
            print(f"  copied -> {dst.relative_to(ROOT)}")

    for patch in sorted(PATCHES.glob("*.patch")):
        if git("apply", "--reverse", "--check", str(patch)).returncode == 0:
            print(f"patch {patch.name}: applied")
            continue
        probe = git("apply", "--check", str(patch))
        if probe.returncode != 0:
            print(f"patch {patch.name}: DOES NOT APPLY\n{probe.stderr}", file=sys.stderr)
            return 1
        if args.check:
            print(f"patch {patch.name}: pending")
            status = 1
            continue
        git("apply", str(patch), check=True)
        print(f"patch {patch.name}: applied now")
    return status


if __name__ == "__main__":
    sys.exit(main())
