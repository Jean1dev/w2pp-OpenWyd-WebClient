"""Assemble the existing WASM build and operator assets for localhost only."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from assemble_site import assemble  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--page-only', action='store_true', help='reuse the already packaged local dataset')
    args = parser.parse_args()
    site = ROOT / ".cache/local-scene"
    wasm = assemble(site)
    streaming = ROOT / 'assets-local/streaming'
    if streaming.is_dir():
        shutil.copytree(streaming, site, dirs_exist_ok=True)
    if args.page_only:
        if not (site / 'openwyd_assets.data').stat().st_size or not (site / 'openwyd_assets.js').is_file():
            raise ValueError('package the dataset first')
        return
    packager = ROOT / ".cache/toolchains/emsdk/upstream/emscripten/tools/file_packager.py"
    subprocess.run([sys.executable, str(packager), "openwyd_assets.data", "--preload",
                    f"{ROOT / 'assets-local/runtime'}@/", "--js-output=openwyd_assets.js",
                    "--no-node", "--quiet"], cwd=site, check=True)
    print(json.dumps({"site": ".cache/local-scene", "wasm": wasm.name}))


if __name__ == "__main__":
    main()
