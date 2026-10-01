// Records which files of the preloaded package the runtime opens, from outside
// the page: an init script wraps Module.FS.open (and, for measurements,
// Module._wyd_tick_client) when the page's Module initializes. The runtime and
// the pages are not changed.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const fsTraceInit = () => {
  window.__measure = { t0: performance.now(), opens: new Map(), ticks: [], rafs: [], ready: null, firstFrame: null };
  let mod;
  Object.defineProperty(window, 'Module', {
    configurable: true,
    get() { return mod; },
    set(value) {
      mod = value;
      // The runtime reassigns Module to itself; wrap the page's object once.
      if (!value || value.__measured || typeof value.onRuntimeInitialized !== 'function') return;
      value.__measured = true;
      const init = value.onRuntimeInitialized;
      value.onRuntimeInitialized = function () {
        const m = window.__measure;
        m.ready = performance.now() - m.t0;
        const fs = value.FS;
        const open = fs.open;
        fs.open = function (path, ...rest) {
          if (typeof path === 'string') {
            const key = path.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
            m.opens.set(key, (m.opens.get(key) ?? 0) + 1);
          }
          return open.call(this, path, ...rest);
        };
        const result = init.apply(this, arguments);
        const tick = value._wyd_tick_client;
        value._wyd_tick_client = function () {
          const a = performance.now();
          const r = tick.apply(this, arguments);
          const b = performance.now();
          if (m.firstFrame === null) m.firstFrame = b - m.t0;
          if (m.ticks.length < 200000) { m.ticks.push(b - a); m.rafs.push(b); }
          return r;
        };
        return result;
      };
    },
  });
};

// Package index (file_packager metadata): lower-case path -> size in bytes.
export async function packageIndex(site) {
  const js = await readFile(join(site, 'openwyd_assets.js'), 'utf8');
  const m = js.match(/loadPackage\((\{[\s\S]*?\})\);/);
  if (!m) throw new Error('package metadata not found in openwyd_assets.js');
  return new Map(JSON.parse(m[1]).files.map(f => [f.filename.toLowerCase().replace(/\/{2,}/g, '/'), f.end - f.start]));
}

// Opened package files grouped by top directory: { dir: { files, bytes } }.
export function openedByDir(paths, index) {
  const out = {};
  for (const p of paths) {
    if (!index.has(p)) continue;
    const parts = p.replace(/^\/+/, '').split('/');
    const dir = parts.length > 1 ? parts[0] : '(raiz)';
    out[dir] ??= { files: 0, bytes: 0 };
    out[dir].files++; out[dir].bytes += index.get(p);
  }
  return out;
}
