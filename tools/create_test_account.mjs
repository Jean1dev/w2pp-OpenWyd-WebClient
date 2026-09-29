#!/usr/bin/env node
// Creates a controlled test account on the operator portal and stores the
// generated credentials only in .env (ignored by Git). Nothing secret is
// printed: the output is the HTTP status and the masked account name.
//
// Contract inspected in the portal bundle (2026-09-28): POST /api/signup with
// JSON {name, password, email?}; name 4..12 [A-Za-z0-9]; password >= 4. The
// game protocol carries at most 12 password bytes (WydDialect), so 10 are used.
//
// Usage: node tools/create_test_account.mjs --portal https://wyd-ten.vercel.app --suffix 2
//   --suffix N   writes W2PP_TEST_ACCOUNT<N> / W2PP_TEST_PASSWORD<N> ("" for the first)
//   --extras     only add W2PP_TEST_PIN<N> and W2PP_TEST_CHAR<N> for existing accounts
import { randomInt } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV = resolve(ROOT, '.env');
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function random(alphabet, n) {
  return Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function envKeys() {
  if (!existsSync(ENV)) return new Set();
  return new Set(readFileSync(ENV, 'utf8').split(/\r?\n/).map((l) => l.split('=')[0].trim()).filter(Boolean));
}

function mask(s) { return s.slice(0, 4) + '*'.repeat(Math.max(0, s.length - 4)); }

const suffix = arg('--suffix', '');
const keys = envKeys();
const add = [];

// PIN: 6 digits (server NumericToken[6]). The first verify sets it on the server.
if (!keys.has(`W2PP_TEST_PIN${suffix}`)) add.push(`W2PP_TEST_PIN${suffix}=${random('0123456789', 6)}`);
// Character name: 4..12 alphanumerics, starts with a letter.
if (!keys.has(`W2PP_TEST_CHAR${suffix}`)) add.push(`W2PP_TEST_CHAR${suffix}=Web${random(ALNUM, 7)}`);

if (!process.argv.includes('--extras')) {
  if (keys.has(`W2PP_TEST_ACCOUNT${suffix}`)) {
    console.error(`W2PP_TEST_ACCOUNT${suffix} already exists in .env; refusing to create another account.`);
    process.exit(2);
  }
  const portal = arg('--portal');
  if (!portal || !/^https:\/\//.test(portal)) {
    console.error('--portal https://... is required');
    process.exit(2);
  }
  const name = `webtest${random('0123456789', 5)}`;
  const password = random(ALNUM, 10);
  const res = await fetch(new URL('/api/signup', portal), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = await res.json().catch(() => null);
  console.log(`POST /api/signup -> ${res.status} account=${mask(name)}${res.ok ? '' : ` error=${body?.error ?? '?'}`}`);
  if (!res.ok) process.exit(1);
  add.unshift(`W2PP_TEST_ACCOUNT${suffix}=${name}`, `W2PP_TEST_PASSWORD${suffix}=${password}`);
}

if (add.length) {
  appendFileSync(ENV, `\n# Added by tools/create_test_account.mjs on ${new Date().toISOString()}\n${add.join('\n')}\n`);
}
console.log(`.env: +${add.map((l) => l.split('=')[0]).join(', ') || 'nothing'}`);
