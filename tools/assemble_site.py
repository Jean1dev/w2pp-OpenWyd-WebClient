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


# The offline test scene drives wyd_debug_* probes, absent from a public runtime.
PRIVATE_PAGES = ("local-scene.",)


def assemble(site: Path, link_dir: Path = DEFAULT_LINK, index: str = "local-scene.html",
             public: bool = False) -> Path:
    """Returns the published .wasm path inside site."""
    bootstrap = (link_dir / "tmproject_startup.js").read_text(encoding="utf-8")
    match = re.search(r"tmproject_startup\.\d+\.js", bootstrap)
    if not match:
        raise ValueError("unrecognized upstream bootstrap; build it first")
    runtime = link_dir / match[0]
    wasm = runtime.with_suffix(".wasm")
    site.mkdir(parents=True, exist_ok=True)
    # Every page keeps its own name; index.html is a copy of the chosen entry:
    # the offline scene locally (npm run scene), the connected client
    # (client.html) in a deployment. Both share the same runtime and dataset.
    for path in (ROOT / "web").glob("*.*"):
        if public and path.name.startswith(PRIVATE_PAGES):
            continue
        shutil.copyfile(path, site / path.name)
    if not (site / index).is_file() or not index.endswith(".html"):
        raise ValueError(f"unknown index page {index!r}")
    shutil.copyfile(site / index, site / "index.html")
    shutil.copyfile(runtime, site / "runtime.js")
    shutil.copyfile(wasm, site / wasm.name)
    return site / wasm.name


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--link-dir", type=Path, default=DEFAULT_LINK)
    ap.add_argument("--index", default="local-scene.html", help="page served at / (e.g. client.html)")
    ap.add_argument("--public", action="store_true",
                    help="published site: no offline scene, runtime linked with --public (checked)")
    args = ap.parse_args()
    wasm = assemble(args.out, args.link_dir, args.index, args.public)
    if args.public:
        from check_public_exports import check
        errors = check(args.out)
        if errors:
            raise SystemExit("public export check failed:\n" + "\n".join(errors))
    print(json.dumps({"site": str(args.out), "wasm": wasm.name}))


if __name__ == "__main__":
    main()
