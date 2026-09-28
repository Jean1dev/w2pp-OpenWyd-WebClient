// Lista os caminhos que o runtime tentou abrir e não encontrou no dataset local.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const ORIGIN = process.env.SCENE_ORIGIN ?? 'http://127.0.0.1:8080';
const browser = await chromium.launch({ headless: true });
try {
  const out = {};
  for (const state of [0, 7]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${ORIGIN}/?state=${state}`, { waitUntil: 'load', timeout: 120000 });
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (await page.evaluate(() => window.sceneEvidence?.frames >= 60)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    out[state] = await page.evaluate(() => {
      const n = Module._wyd_d3d9_asset_file_open_fail_sample_count();
      const samples = [];
      for (let i = 0; i < n; i++) samples.push(Module.UTF8ToString(Module._wyd_d3d9_asset_file_open_fail_sample(i)));
      return { total: Module._wyd_d3d9_asset_file_open_fail(),
               texture: Module._wyd_d3d9_asset_file_open_fail_texture(),
               mesh: Module._wyd_d3d9_asset_file_open_fail_mesh(),
               env: Module._wyd_d3d9_asset_file_open_fail_env(),
               ui: Module._wyd_d3d9_asset_file_open_fail_ui(),
               sound: Module._wyd_d3d9_asset_file_open_fail_sound(), samples };
    });
    await page.close();
  }
  await writeFile('.cache/missing-assets.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
} finally { await browser.close(); }
