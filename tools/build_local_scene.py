"""Assemble the existing WASM build and operator assets for localhost only."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--page-only', action='store_true', help='reuse the already packaged local dataset')
    args = parser.parse_args()
    upstream = ROOT / "external/OpenWyd/webclient/client-wasm/build/link"
    bootstrap = (upstream / "tmproject_startup.js").read_text(encoding="utf-8")
    match = re.search(r"tmproject_startup\.\d+\.js", bootstrap)
    if not match:
        raise ValueError("unrecognized upstream bootstrap; build it first")
    runtime = upstream / match[0]
    wasm = runtime.with_suffix(".wasm")
    site = ROOT / ".cache/local-scene"
    site.mkdir(parents=True, exist_ok=True)
    # The offline scene is the index; the connected client (client.html) shares
    # the same runtime and dataset and is served by the gateway (gateway/).
    for path in (ROOT / "web").glob("*.*"):
        name = "index.html" if path.name == "local-scene.html" else path.name
        shutil.copyfile(path, site / name)
    shutil.copyfile(runtime, site / "runtime.js")
    shutil.copyfile(wasm, site / wasm.name)
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
