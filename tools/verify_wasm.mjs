// Structural build check only: no runtime, network connection or scene is started.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (process.argv.length !== 3) {
  console.error('Usage: node tools/verify_wasm.mjs path/to/tmproject_startup.wasm');
  process.exit(2);
}
const bytes = await readFile(process.argv[2]);
const module = await WebAssembly.compile(bytes);
const names = WebAssembly.Module.exports(module).map(entry => entry.name);
const required = ['wyd_start_client', 'wyd_boot_client', 'wyd_tick_client', 'wyd_shutdown_client'];
const missing = required.filter(name => !names.includes(name) && !names.includes(`_${name}`));
if (missing.length) throw new Error(`Missing runtime exports: ${missing.join(', ')}`);
console.log(JSON.stringify({
  valid_wasm: true,
  runtime_executed: false,
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  exports: names.length,
  required_exports: required,
}, null, 2));
