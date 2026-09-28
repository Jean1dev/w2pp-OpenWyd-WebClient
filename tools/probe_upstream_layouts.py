#!/usr/bin/env python3
"""Ask Clang for actual upstream record layouts under wasm32 and MSVC x86 ABIs.

No upstream source is copied into the report. Clang's MSVC target is an ABI
comparison, not execution of Microsoft's compiler or the Windows game client.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=Path("external/OpenWyd"))
    parser.add_argument("--clang", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    header = (args.upstream / "Projects/TMProject/Basedef.h").resolve()
    report = {"method": "Clang record layout; original complete header; no packing overrides",
              "header_sha256": hashlib.sha256(header.read_bytes()).hexdigest(),
              "compiler": subprocess.check_output([str(args.clang), "--version"], text=True).strip(),
              "targets": {}}
    with tempfile.TemporaryDirectory(prefix="wyd-layout-") as directory:
        probe = Path(directory) / "probe.cpp"
        # HWND is used only by an extern global, never by the measured records.
        probe.write_text('using HWND = void*;\n#include "Basedef.h"\n', encoding="utf-8")
        for target in ("wasm32-unknown-emscripten", "i686-pc-windows-msvc"):
            command = [str(args.clang), "-target", target, "-std=c++17", "-fms-extensions",
                       "-fsyntax-only", "-Xclang", "-fdump-record-layouts-complete",
                       "-I", str(header.parent), str(probe)]
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode:
                raise SystemExit(f"{target}: compiler rejected header\n{result.stderr}")
            records = {}
            for block in result.stdout.split("*** Dumping AST Record Layout"):
                name = re.search(r"^\s*0 \| (?:struct|union) ((?:MSG|STRUCT)_\w+)\s*$", block, re.M)
                size = re.search(r"\[sizeof=(\d+).*?align=(\d+)", block, re.S)
                if not name or not size:
                    continue
                fields = [{"offset": int(m.group(1)), "declaration": m.group(2)}
                          for m in re.finditer(r"^\s*(\d+) \|   (\S[^\n]*)$", block, re.M)]
                records[name.group(1)] = {"size": int(size.group(1)), "alignment": int(size.group(2)),
                                         "fields": fields}
            if not records:
                raise SystemExit(f"{target}: no records parsed")
            report["targets"][target] = records
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Measured records: " + ", ".join(f"{key}={len(value)}" for key, value in report["targets"].items()))


if __name__ == "__main__":
    main()
