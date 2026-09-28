#!/usr/bin/env python3
"""Read-only inventory of operator assets against the pinned upstream manifest.

Only manifest-selected files are hashed; executables, logs and screenshots are
never imported. This verifies presence/integrity metadata, not format parity or
permission to redistribute. No file contents or absolute source path are emitted.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--upstream", type=Path, default=Path("external/OpenWyd"))
    parser.add_argument("--layouts", type=Path, help="Clang report from probe_upstream_layouts.py")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    root = args.assets.resolve(strict=True)
    if not root.is_dir():
        parser.error("asset source must be a directory")
    if args.out.resolve().is_relative_to(root):
        parser.error("report must be outside the read-only asset directory")
    manifest = args.upstream / "webclient/client-wasm/config/startup-preload-manifest.txt"
    records, missing, generated, rejected, empty_files = {}, [], [], [], []
    for line_no, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        source, separator, destination = line.partition("@")
        if not separator:
            parser.error(f"manifest line {line_no}: malformed mapping")
        if not source.startswith("v769ClientRelease/"):
            generated.append({"line": line_no, "source": source, "destination": destination,
                              "available": any(p.is_file() for p in args.upstream.glob(source))})
            continue
        relative = source.removeprefix("v769ClientRelease/")
        if Path(relative).is_absolute() or ".." in Path(relative).parts:
            parser.error(f"manifest line {line_no}: source escapes asset directory")
        files = sorted(path for path in root.glob(relative) if path.is_file())
        if not files:
            missing.append({"line": line_no, "source": relative, "destination": destination})
        for path in files:
            name = path.relative_to(root).as_posix()
            if not path.resolve().is_relative_to(root):
                rejected.append({"path": name, "reason": "symlink leaves asset root"})
                continue
            if path.suffix.lower() in {".exe", ".dll", ".sys", ".vxd", ".log"}:
                rejected.append({"path": name, "reason": "executable or log"})
                continue
            if name in records:
                continue
            digest = hashlib.sha256()
            count = 0
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    count += len(chunk)
            records[name] = {"path": name, "bytes": count, "sha256": digest.hexdigest()}
            if not count:
                empty_files.append(name)
    binary_checks = []
    if args.layouts:
        layouts = json.loads(args.layouts.read_text(encoding="utf-8"))
        header = (args.upstream / "Projects/TMProject/Basedef.h").read_bytes()
        if hashlib.sha256(header).hexdigest() != layouts["header_sha256"]:
            parser.error("layout report does not match the current upstream header")
        types = layouts["targets"]["wasm32-unknown-emscripten"]
        text = header.decode("utf-8")
        for filename, record, constant in (
            ("ItemList.bin", "STRUCT_ITEMLIST", "MAX_ITEMLIST"),
            ("SkillData.bin", "STRUCT_SPELL", "MAX_SPELL_LIST"),
        ):
            match = re.search(rf"constexpr\s+int\s+{constant}\s*=\s*(\d+)", text)
            if not match:
                parser.error(f"cannot find upstream count {constant}")
            count = int(match.group(1))
            stride = types[record]["size"]
            actual = (root / filename).stat().st_size if (root / filename).is_file() else None
            binary_checks.append({"file": filename, "upstream_record_bytes": stride,
                                  "upstream_count": count, "upstream_read_bytes": stride * count,
                                  "actual_bytes": actual,
                                  "upstream_read_fits": actual is not None and actual >= stride * count,
                                  "scope": "size only; decoding/semantic compatibility not verified"})
    report = {
        "schema_version": 1,
        "source": "operator-provided local client directory; read only",
        "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "complete_for_upstream_manifest": not missing and not rejected and all(p["available"] for p in generated),
        "format_compatibility": "not validated",
        "binary_size_checks": binary_checks,
        "summary": {"files_hashed": len(records), "bytes_hashed": sum(v["bytes"] for v in records.values()),
                    "missing_patterns": len(missing), "upstream_generated_patterns": len(generated),
                    "rejected": len(rejected), "empty_files": len(empty_files)},
        "missing": missing, "upstream_generated_inputs": generated, "rejected": rejected,
        "empty_files": empty_files,
        "files": sorted(records.values(), key=lambda item: item["path"]),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"]))
    # This is a preflight, not a successful build when inputs are incomplete.
    ready = report["complete_for_upstream_manifest"] and all(c["upstream_read_fits"] for c in binary_checks)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
