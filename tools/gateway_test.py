#!/usr/bin/env python3
"""Vet and test gateway/ with the pinned local Go toolchain (see docs/setup.md)."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GO = ROOT / ".cache/toolchains/go/bin" / ("go.exe" if os.name == "nt" else "go")
env = dict(os.environ, GOTOOLCHAIN="local", GOPATH=str(ROOT / ".cache/gopath"), GOMODCACHE=str(ROOT / ".cache/gomod"))
go = str(GO) if GO.exists() else "go"
for cmd in ([go, "vet", "./..."], [go, "test", "-count=1", *sys.argv[1:], "./..."]):
    print("+", " ".join(cmd), flush=True)
    if subprocess.call(cmd, cwd=ROOT / "gateway", env=env):
        sys.exit(1)
