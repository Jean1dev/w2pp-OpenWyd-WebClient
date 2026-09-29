#!/usr/bin/env python3
"""Upload the staged game data (.cache/deploy-assets) to a private S3 bucket.

    python tools/pack_deploy_assets.py
    python tools/upload_assets_s3.py --railway-bucket arranged-orb

Credentials are read from the Railway CLI (`railway bucket credentials --json`
for the linked project) into memory, or from WYD_ASSET_S3_* variables. They
are never printed or written. Objects go under assets-<manifest version>/ so a
previous version stays available for rollback. Each object is verified with a
HEAD (size) afterwards. SigV4 is implemented here independently of the Go
gateway (UNSIGNED-PAYLOAD over HTTPS for the bodies).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAILWAY = ["npx.cmd" if os.name == "nt" else "npx", "-y", "@railway/cli@5.63.1"]
TYPES = {".data": "application/octet-stream", ".js": "text/javascript; charset=utf-8",
         ".json": "application/json", ".mp3": "audio/mpeg"}


def creds_from_railway(bucket: str) -> dict:
    exe = shutil.which(RAILWAY[0]) or RAILWAY[0]
    out = subprocess.run([exe, *RAILWAY[1:], "bucket", "credentials", "--bucket", bucket, "--json"],
                         capture_output=True, text=True, check=False, timeout=180)
    if out.returncode:
        raise SystemExit(f"railway bucket credentials failed (exit {out.returncode}); output withheld")
    c = json.loads(out.stdout)
    return {"endpoint": c["endpoint"], "region": c["region"], "bucket": c["bucketName"],
            "style": c.get("urlStyle", "virtual-host"), "key": c["accessKeyId"], "secret": c["secretAccessKey"]}


def creds_from_env() -> dict:
    e = os.environ
    return {"endpoint": e["WYD_ASSET_S3_ENDPOINT"], "region": e.get("WYD_ASSET_S3_REGION", "auto"),
            "bucket": e["WYD_ASSET_S3_BUCKET"], "style": e.get("WYD_ASSET_S3_URL_STYLE", "virtual-host"),
            "key": e["WYD_ASSET_S3_ACCESS_KEY_ID"], "secret": e["WYD_ASSET_S3_SECRET_ACCESS_KEY"]}


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class Bucket:
    def __init__(self, c: dict):
        self.c = c
        u = urllib.parse.urlsplit(c["endpoint"])
        if u.scheme != "https":
            raise SystemExit("endpoint must be https")
        self.host = f'{c["bucket"]}.{u.netloc}' if c["style"] != "path" else u.netloc
        self.prefix = "" if c["style"] != "path" else "/" + c["bucket"]

    def _headers(self, method: str, path: str, payload_hash: str, extra: dict) -> dict:
        now = dt.datetime.now(dt.timezone.utc)
        amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        h = {"host": self.host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz}
        names = sorted(h)
        canonical = "\n".join([method, path, "", "".join(f"{k}:{h[k]}\n" for k in names), ";".join(names), payload_hash])
        scope = f'{day}/{self.c["region"]}/s3/aws4_request'
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        k = _hmac(("AWS4" + self.c["secret"]).encode(), day)
        for part in (self.c["region"], "s3", "aws4_request"):
            k = _hmac(k, part)
        sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        auth = (f'AWS4-HMAC-SHA256 Credential={self.c["key"]}/{scope}, '
                f'SignedHeaders={";".join(names)}, Signature={sig}')
        return {"Host": self.host, "X-Amz-Date": amz, "X-Amz-Content-Sha256": payload_hash,
                "Authorization": auth, **extra}

    def request(self, method: str, key: str, body=None, length: int = 0, ctype: str = ""):
        path = self.prefix + "/" + urllib.parse.quote(key, safe="/-_.~")
        extra = {"Content-Length": str(length)} if method == "PUT" else {}
        if ctype:
            extra["Content-Type"] = ctype
        payload = "UNSIGNED-PAYLOAD" if method == "PUT" else hashlib.sha256(b"").hexdigest()
        conn = http.client.HTTPSConnection(self.host, timeout=600)
        try:
            conn.request(method, path, body=body, headers=self._headers(method, path, payload, extra))
            resp = conn.getresponse()
            data = resp.read()
            return resp.status, dict(resp.getheaders()), data
        finally:
            conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--railway-bucket", help="bucket name in the linked Railway project")
    ap.add_argument("--src", type=Path, default=ROOT / ".cache/deploy-assets")
    args = ap.parse_args()
    manifest = json.loads((args.src / "manifest.json").read_text(encoding="utf-8"))
    prefix = f'assets-{manifest["version"]}'
    b = Bucket(creds_from_railway(args.railway_bucket) if args.railway_bucket else creds_from_env())
    files = [(e["path"], e["bytes"]) for e in manifest["files"]] + [("manifest.json", (args.src / "manifest.json").stat().st_size)]
    for rel, size in files:
        key = f"{prefix}/{rel}"
        status, headers, _ = b.request("HEAD", key)
        if status == 200 and int(headers.get("Content-Length", headers.get("content-length", -1))) == size:
            print(f"skip {key} ({size} bytes, already present)")
            continue
        ctype = TYPES.get(Path(rel).suffix, mimetypes.guess_type(rel)[0] or "application/octet-stream")
        with (args.src / rel).open("rb") as f:
            status, _, data = b.request("PUT", key, body=f, length=size, ctype=ctype)
        if status != 200:
            print(f"PUT {key}: HTTP {status} {data[:200]!r}", file=sys.stderr)
            return 1
        print(f"put  {key} ({size} bytes)")
    bad = []
    for rel, size in files:
        status, headers, _ = b.request("HEAD", f"{prefix}/{rel}")
        got = int({k.lower(): v for k, v in headers.items()}.get("content-length", -1))
        if status != 200 or got != size:
            bad.append((rel, status, got, size))
    if bad:
        print(f"verification failed: {bad}", file=sys.stderr)
        return 1
    print(json.dumps({"prefix": prefix, "objects": len(files), "bytes": sum(s for _, s in files), "verified": True}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
