#!/usr/bin/env node
// Separate browser processes per scenario; never run these in parallel.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateOptions } from './world_checks.mjs';

const { values: opt } = parseArgs({ options: {
  target: { type: 'string' }, 'client-version': { type: 'string', default: '12000' },
  'env-file': { type: 'string' }, headed: { type: 'boolean', default: false },
} });
const scenarios = [
  ['badpass,badpin', '0'],
  ...[0, 1, 2, 3].map(c => ['classes', String(c)]),
  ['login,enter,second,move,logout', '0'],
  ['login,enter,second,mapchange', '0'],
  ['login,enter,concurrent', '0'],
];
for (const [phases, cls] of scenarios) validateOptions({ ...opt, phases, class: cls });
for (const [phases, cls] of scenarios) {
  const args = [resolve(import.meta.dirname, 'verify_world.mjs'), '--target', opt.target,
    '--client-version', opt['client-version'], '--phases', phases, '--class', cls];
  if (opt['env-file']) args.push('--env-file', opt['env-file']);
  if (opt.headed) args.push('--headed');
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => done(code ?? 1));
  });
  if (code !== 0) process.exit(code); // Fail fast; do not multiply logins on failure.
}
