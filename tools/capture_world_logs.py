#!/usr/bin/env python3
"""Read a bounded Railway tm-server log window; write only sanitized messages."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--since', required=True)
    ap.add_argument('--until', required=True)
    ap.add_argument('--env-file', default='.env')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    for stamp in (args.since, args.until):
        if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z', stamp):
            ap.error('timestamps must be absolute UTC ISO timestamps')
    secrets = {}
    for line in Path(args.env_file).read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'\s*(W2PP_TEST_[A-Z0-9_]+)\s*=\s*(.*?)\s*', line)
        if match:
            secrets[match[1]] = match[2].strip('\'"')
    secrets.update({k: v for k, v in os.environ.items() if k.startswith('W2PP_TEST_')})
    lock = json.loads((ROOT / 'dependencies.lock.json').read_text(encoding='utf-8'))
    operator = lock['operator_environment']
    command = [shutil.which('npx.cmd' if os.name == 'nt' else 'npx'), '-y', '@railway/cli@5.63.1',
               'logs', '-p', operator['railway_project'], '-e', 'production', '-s', operator['service'],
               '--since', args.since, '--until', args.until, '--json']
    result = subprocess.run(command, cwd=ROOT, capture_output=True, encoding='utf-8', timeout=180)
    if result.returncode:
        raise SystemExit(f'Railway log read failed (exit {result.returncode}); no raw output written')
    messages = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        message = row.get('message', '')
        # Do not publish incidental world events from other players.
        if not re.search(r'connection|recv packet|send packet|account login|account secure|create char|char(?:acter)? login|first action|teleport|disconnect|shop opened|skill learned|crack|buy ok|buy denied|buy resync|sell ok|cargo opened|cargo deposit|cargo withdraw|chat command', message):
            continue
        for key, value in sorted(secrets.items(), key=lambda kv: len(kv[1]), reverse=True):
            if value:
                message = message.replace(value, f'<{key}>')
        # Redact identities even if a log line belongs to a different account.
        message = re.sub(r'\b(account|name|ip|remote)=(("[^"]*")|\S+)', r'\1=<redacted>', message)
        messages.append(message)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(f'# Railway read-only; {args.since} .. {args.until}; sanitized identities.\n' +
                   '\n'.join(messages) + '\n', encoding='utf-8')
    print(json.dumps({'messages': len(messages), 'out': str(out)}))


if __name__ == '__main__':
    main()
