#!/usr/bin/env python3
"""Inventory pinned source contracts. This does not assert wire compatibility."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def source(root, relative):
    path = root / relative
    return path.read_text(encoding="utf-8"), {
        "path": relative,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def matches(text, pattern):
    return [dict(line=text.count("\n", 0, m.start()) + 1, **m.groupdict())
            for m in re.finditer(pattern, text, re.MULTILINE)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", type=Path, default=Path("external/server"))
    parser.add_argument("--upstream", type=Path, default=Path("external/OpenWyd"))
    parser.add_argument("--lock", type=Path, default=Path("dependencies.lock.json"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    report = {"status": "confirmado em fonte", "repositories": {}}
    for name, root in (("server", args.server), ("upstream", args.upstream)):
        commit = git(root, "rev-parse", "HEAD")
        if commit != lock[name]["commit"]:
            parser.error(f"{name}: HEAD {commit} differs from lock")
        if git(root, "status", "--porcelain", "--untracked-files=no"):
            parser.error(f"{name}: tracked source modifications invalidate pinned audit")
        report["repositories"][name] = {"commit": commit, "url": lock[name]["url"]}
    text, metadata = source(args.upstream, "Projects/TMProject/Basedef.h")
    report["upstream_header"] = metadata
    report["upstream_opcodes"] = matches(
        text, r"constexpr\s+(?:auto|int)\s+(?P<name>MSG_\w+_Opcode)\s*=\s*(?P<value>0x[0-9A-Fa-f]+)\s*;")
    report["upstream_structs"] = matches(text, r"^struct\s+(?P<name>(?:MSG|STRUCT)_\w+)\s*$")
    text, metadata = source(args.server, "tmserver/internal/protocol/types.go")
    report["server_types"] = metadata
    report["server_opcodes"] = matches(
        text, r"^\s*(?P<name>Msg\w+)\s+Type\s*=\s*(?P<value>0x[0-9A-Fa-f]+)")
    text, metadata = source(args.server, "tmserver/internal/handler/dispatch.go")
    report["server_dispatch"] = metadata
    report["server_routes"] = matches(
        text, r"d\.routes\[protocol\.(?P<name>Msg\w+)\]\s*=\s*d\.(?P<handler>\w+)")
    report["server_changes_since_baseline"] = git(
        args.server, "diff", "--name-only", lock["server"]["historical_commit"], "HEAD").splitlines()
    report["server_protocol_changes_since_baseline"] = git(
        args.server, "diff", "--name-only", lock["server"]["historical_commit"], "HEAD",
        "--", "tmserver/internal/protocol").splitlines()
    report["upstream_login_versions"] = []
    for relative in ("Projects/TMProject/TMSelectServerScene.cpp", "Projects/TMProject/TMFieldScene.cpp"):
        text, metadata = source(args.upstream, relative)
        report["upstream_login_versions"].append({**metadata, "assignments": matches(
            text, r"stAccountLogin\.Version\s*=\s*(?P<value>\d+)\s*;")})
    if not report["server_routes"] or not report["upstream_opcodes"]:
        parser.error("source shape changed: empty inventory")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Source inventory: {len(report['server_opcodes'])} server opcodes; "
          f"{len(report['server_routes'])} routes; {len(report['upstream_opcodes'])} upstream opcode declarations")


if __name__ == "__main__":
    main()
