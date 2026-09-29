#!/usr/bin/env python3
"""Stage the operator's game data for a deployment volume, with a hash manifest.

Input: the dataset packaged by build_local_scene.py (.cache/local-scene) and
the streamed music (assets-local/streaming). Output: .cache/deploy-assets/,
uploaded by the operator to the service volume (docs/deploy.md). Nothing here
is committed or baked into an image.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / ".cache/local-scene"
STREAMING = ROOT / "assets-local/streaming"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=ROOT / ".cache/deploy-assets")
    args = ap.parse_args()
    data, loader = SITE / "openwyd_assets.data", SITE / "openwyd_assets.js"
    if not data.is_file() or not data.stat().st_size or not loader.is_file():
        raise SystemExit("package the dataset first: python tools/build_local_scene.py")
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    shutil.copyfile(data, args.out / data.name)
    shutil.copyfile(loader, args.out / loader.name)
    if STREAMING.is_dir():
        shutil.copytree(STREAMING, args.out, dirs_exist_ok=True)
    files = sorted(p for p in args.out.rglob("*") if p.is_file())
    entries = [{"path": p.relative_to(args.out).as_posix(), "bytes": p.stat().st_size, "sha256": sha256(p)}
               for p in files]
    digest = hashlib.sha256("".join(e["path"] + e["sha256"] for e in entries).encode()).hexdigest()
    lock = json.loads((ROOT / "dependencies.lock.json").read_text(encoding="utf-8"))
    manifest = {
        "version": digest[:16],
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "emscripten": lock["toolchains"]["emscripten"],
        "note": "operator-local game data; do not commit or publish without rights",
        "files": entries,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    total = sum(e["bytes"] for e in entries)
    print(json.dumps({"out": str(args.out), "files": len(entries), "bytes": total, "version": manifest["version"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
