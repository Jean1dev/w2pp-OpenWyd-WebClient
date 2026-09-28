"""Prepare an ignored, local-only dataset for the pinned Alan runtime.

The operator's directory is read-only. Converted tables are presentation data;
the Go server remains authoritative. No executables or credentials are imported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]

# MP3 music is streamed from the same origin on demand and is deliberately kept
# out of the preload package, as the upstream manifest requires. It still has to
# be imported, or the scene reports a missing track.
STREAMING = (("music/*.mp3", "music/"),)


def xor(data):
    return bytes(value ^ 0x5A for value in data)


def convert_items(data):
    if len(data) != 6500 * 140 + 4:
        raise ValueError("ItemList requires exactly 6500 x 140 bytes + 4-byte trailer")
    source = xor(data[:-4])
    result = bytearray(6500 * 164)
    for i in range(6500):
        old, new = i * 140, i * 164
        result[new:new + 134] = source[old:old + 134]
        # 7662's 16-bit equipment bitmask becomes Alan's 32-bit bitmask.
        struct.pack_into("<I", result, new + 136,
                         struct.unpack_from("<H", source, old + 134)[0])
        result[new + 140:new + 144] = source[old + 136:old + 140]
        # UNK_1/2/3/4, mType/mData and UnkNewValues have no 7662 source.
        # Explicit zero defaults; this does not claim support for 769 features.
    return xor(result)


def convert_skills(data):
    if len(data) != 248 * 96 + 4:
        raise ValueError("SkillData requires exactly 248 x 96 bytes + 4-byte trailer")
    source = xor(data[:-4])
    result = bytearray(248 * 104)
    for i in range(248):
        result[i * 104:i * 104 + 96] = source[i * 96:(i + 1) * 96]
        # SkillIndex/Reserved are unconsumed in this pinned runtime; absent
        # in 7662. Do not fabricate a one-based identity from the 769 table.
    return xor(result)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def import_streaming(source):
    """Copy the on-demand set served beside the page, recording every hash."""
    output = ROOT / "assets-local/streaming"
    records = []
    for pattern, dest in STREAMING:
        for path in sorted(p for p in source.glob(pattern) if p.is_file()):
            if not path.resolve().is_relative_to(source):
                raise ValueError("asset symlink leaves source")
            payload = path.read_bytes()
            target = dest + path.name
            destination = output / target
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
            records.append({"path": target, "source_sha256": sha(payload),
                            "bytes": len(payload), "delivery": "streamed",
                            "origin": "operator assets"})
    return records


def merge_streaming_manifest(streamed):
    manifest = ROOT / "assets-local/manifest.json"
    report = json.loads(manifest.read_text(encoding="utf-8"))
    report["streaming"] = streamed
    manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--font", required=True, type=Path)
    parser.add_argument("--streaming-only", action="store_true",
                        help="refresh only the streamed set beside an existing dataset")
    args = parser.parse_args()
    source = args.assets.resolve(strict=True)
    output = ROOT / "assets-local/runtime"
    if output.resolve().is_relative_to(source):
        parser.error("output must be outside the original asset directory")
    if output.exists() and not args.streaming_only:
        parser.error("assets-local/runtime already exists; use a fresh workspace or explicitly move the old dataset")
    if args.streaming_only and not output.exists():
        parser.error("assets-local/runtime is missing; run the full import first")
    streamed = import_streaming(source)
    if args.streaming_only:
        merge_streaming_manifest(streamed)
        print(json.dumps({"streamed": len(streamed),
                          "bytes": sum(r["bytes"] for r in streamed)}))
        return
    manifest = ROOT / "external/OpenWyd/webclient/client-wasm/config/startup-preload-manifest.txt"
    records, missing, selected = [], [], {}
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        if not raw.startswith("v769ClientRelease/"):
            continue
        pattern, dest = raw.removeprefix("v769ClientRelease/").split("@")
        if ".." in Path(pattern).parts or Path(pattern).is_absolute():
            raise ValueError("unsafe source pattern")
        matches = sorted(p for p in source.glob(pattern) if p.is_file())
        if not matches:
            missing.append(pattern)
        prefix = pattern.split("*")[0]
        prefix = prefix[:prefix.rfind("/") + 1]
        for path in matches:
            if not path.resolve().is_relative_to(source):
                raise ValueError("asset symlink leaves source")
            if path.suffix.lower() in {".exe", ".dll", ".sys", ".vxd", ".log"}:
                raise ValueError("executable or log selected")
            relative = path.relative_to(source).as_posix()
            target = dest.lstrip("/") + relative[len(prefix):] if dest.endswith("/") else dest.lstrip("/")
            if ".." in Path(target).parts or Path(target).is_absolute():
                raise ValueError("unsafe destination")
            if target in selected and selected[target] != path:
                raise ValueError("duplicate asset destination")
            selected[target] = path
    selected["Tahoma.ttf"] = args.font.resolve(strict=True)
    converters = {"ItemList.bin": convert_items, "SkillData.bin": convert_skills}
    # Validate table lengths before writing any output.
    for name, convert in converters.items():
        convert(selected[name].read_bytes())
    output.mkdir(parents=True)
    for target, path in sorted(selected.items()):
        original = path.read_bytes()
        payload = converters[target](original) if target in converters else original
        destination = output / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        records.append({"path": target, "source_sha256": sha(original),
                        "output_sha256": sha(payload), "bytes": len(payload),
                        "conversion": target in converters,
                        "origin": "local Windows font" if target == "Tahoma.ttf" else "operator assets"})
    report = {"schema": 1, "scope": "local-only; missing resources are not fabricated",
              "missing_patterns": missing, "files": records, "streaming": streamed}
    (output.parent / "manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(records), "bytes": sum(r["bytes"] for r in records),
                      "streamed": len(streamed), "missing_patterns": len(missing)}))


if __name__ == "__main__":
    main()
