#!/usr/bin/env python3
"""Copy the page (web/) and the linked runtime into a site directory.

Game data (openwyd_assets.*, music/) is NOT copied: it is the operator's local
content and stays out of images and the repository. build_local_scene.py adds
it locally; a deployment serves it from a mounted volume (docs/deploy.md).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LINK = ROOT / "external/OpenWyd/webclient/client-wasm/build/link"


def assemble(site: Path, link_dir: Path = DEFAULT_LINK) -> Path:
    """Returns the published .wasm path inside site."""
    bootstrap = (link_dir / "tmproject_startup.js").read_text(encoding="utf-8")
    match = re.search(r"tmproject_startup\.\d+\.js", bootstrap)
    if not match:
        raise ValueError("unrecognized upstream bootstrap; build it first")
    runtime = link_dir / match[0]
    wasm = runtime.with_suffix(".wasm")
    site.mkdir(parents=True, exist_ok=True)
    # The offline scene is the index; the connected client (client.html) shares
    # the same runtime and dataset and is served by the gateway (gateway/).
    for path in (ROOT / "web").glob("*.*"):
        name = "index.html" if path.name == "local-scene.html" else path.name
        shutil.copyfile(path, site / name)
    shutil.copyfile(runtime, site / "runtime.js")
    shutil.copyfile(wasm, site / wasm.name)
    return site / wasm.name


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--link-dir", type=Path, default=DEFAULT_LINK)
    args = ap.parse_args()
    wasm = assemble(args.out, args.link_dir)
    print(json.dumps({"site": str(args.out), "wasm": wasm.name}))


if __name__ == "__main__":
    main()
