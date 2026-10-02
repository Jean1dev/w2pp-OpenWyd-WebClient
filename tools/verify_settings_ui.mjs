#!/usr/bin/env node
// Teste isolado do painel de configurações (web/settings.js + web/client.js)
// com um runtime FALSO que imita a semântica do patch 0023 (níveis pendentes
// antes do boot, aplicados ao vivo depois). Não é evidência de gameplay nem de
// áudio real: isso exige o runtime compilado e o servidor (docs/evidence/07-web).
// Uso: npm run settings:ui
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const WEB = join(resolve(import.meta.dirname, '..'), 'web');

const FAKE_RUNTIME = `
(() => {
  const lv = [-1, -1];
  let app = null;
  const clamp = v => Math.max(0, Math.min(100, v | 0));
  window.fake = { setCalls: [], mouse: [], keys: [], bootCanvas: null };
  Object.assign(Module, {
    UTF8ToString: () => "",
    _wyd_audio_set_levels(s, m) {
      s = clamp(s); m = clamp(m); lv[0] = s; lv[1] = m;
      fake.setCalls.push([s, m, app ? "live" : "pending"]);
      if (!app) return 0;
      app.sound = s; app.music = m; return 1;
    },
    _wyd_audio_get_level: w => !app ? lv[w] : (w ? app.music : app.sound),
    _wyd_audio_resume: () => 1,
    _wyd_boot_client() {
      // Config.bin do operador simulado: efeitos 0, música 20.
      app = { sound: lv[0] >= 0 ? lv[0] : 0, music: lv[1] >= 0 ? lv[1] : 20 };
      fake.bootCanvas = [Module.canvas.width, Module.canvas.height];
      return 1;
    },
    _wyd_set_game_state() {},
    _wyd_tick_client: () => 0,
    _wyd_field_has_my_human: () => window.fakeInField ? 1 : 0,
    _wyd_mouse_event: (msg, f, x, y) => { fake.mouse.push([msg, x, y]); return 1; },
    _wyd_key_event: (msg, code) => { fake.keys.push([msg, code]); return 1; },
  });
  setTimeout(() => Module.onRuntimeInitialized(), 0);
})();
`;

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (path === '/config.json') return send('application/json', JSON.stringify({ channel: 'fake', wsUrl: 'ws://127.0.0.1:1/x', clientVersion: 7662 }));
  if (path === '/runtime.js') return send('text/javascript', FAKE_RUNTIME);
  if (path === '/openwyd_assets.js') return send('text/javascript', '');
  try {
    const body = readFileSync(join(WEB, path === '/' ? 'client.html' : path.slice(1)));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    send(types[extname(path)] ?? 'application/octet-stream', body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/client.html`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function ready(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => !!(window.clientEvidence?.ready && window.fake?.bootCanvas))) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('runtime falso não iniciou');
}

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  console.log(`\n# ${name}`);
  const browser = await type.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 1. Sem preferência: 800x600, nada enviado antes do boot, sliders do Config.bin.
  await page.goto(base);
  await ready(page);
  let s = await page.evaluate(() => ({ boot: fake.bootCanvas, calls: fake.setCalls,
    music: document.getElementById('wyd-music').value, effects: document.getElementById('wyd-effects').value,
    disabled: document.getElementById('wyd-music').disabled }));
  check(`${name}: padrão 800x600`, s.boot.join('x') === '800x600', s.boot.join('x'));
  check(`${name}: sem preferência não envia níveis`, s.calls.length === 0, JSON.stringify(s.calls));
  check(`${name}: sliders mostram Config.bin`, s.music === '20' && s.effects === '0' && !s.disabled, `${s.music}/${s.effects}`);

  // 2. Slider de música ao vivo.
  await page.click('.wyd-settings > summary');
  await page.locator('#wyd-music').fill('70');
  s = await page.evaluate(() => ({ last: fake.setCalls.at(-1), snap: WydSettings.snapshot(),
    stored: JSON.parse(localStorage.getItem('wyd.settings.v1')) }));
  check(`${name}: música 70 ao vivo`, s.last?.join() === '0,70,live' && s.snap.music === 70, JSON.stringify(s.last));
  check(`${name}: preferência salva`, s.stored.audio.music === 70 && s.stored.audio.effects === 0);

  // 3. Efeitos de 0 para 40, depois mudo.
  await page.locator('#wyd-effects').fill('40');
  await page.click('#wyd-effects ~ .wyd-mute');
  s = await page.evaluate(() => ({ last: fake.setCalls.at(-1),
    pressed: document.querySelector('#wyd-effects ~ .wyd-mute').getAttribute('aria-pressed'),
    out: document.querySelector('#wyd-effects ~ output').textContent,
    slider: document.getElementById('wyd-effects').value }));
  check(`${name}: mudo envia 0 e mantém slider`, s.last?.join() === '0,70,live' && s.pressed === 'true' && s.slider === '40' && s.out === 'mudo', JSON.stringify(s));
  await page.click('#wyd-effects ~ .wyd-mute');
  s = await page.evaluate(() => fake.setCalls.at(-1));
  check(`${name}: desmutar volta a 40`, s.join() === '40,70,live', s.join());

  // 4. Teclas no painel não chegam ao jogo.
  await page.focus('#wyd-resolution');
  await page.keyboard.press('ArrowUp');
  s = await page.evaluate(() => fake.keys.length);
  check(`${name}: teclas do painel não vazam`, s === 0, String(s));
  await page.evaluate(() => { const r = document.getElementById('wyd-resolution'); r.value = '800x600'; r.dispatchEvent(new Event('change')); });

  // 5. Recarregar: níveis vão antes do boot.
  await page.reload();
  await ready(page);
  s = await page.evaluate(() => ({ first: fake.setCalls[0], snap: WydSettings.snapshot() }));
  check(`${name}: níveis salvos antes do boot`, s.first?.join() === '40,70,pending' && s.snap.music === 70 && s.snap.effects === 40, JSON.stringify(s.first));

  // 6. Resolução: confirmação antes de recarregar, aviso de desconexão no Field.
  await page.evaluate(() => { window.fakeInField = true; });
  await page.click('.wyd-settings > summary');
  await page.selectOption('#wyd-resolution', '1024x768');
  s = await page.evaluate(() => ({ hidden: document.querySelector('.wyd-settings-confirm').hidden,
    text: document.querySelector('.wyd-settings-confirm p').textContent, boot: fake.bootCanvas }));
  check(`${name}: pede confirmação`, !s.hidden && /sairá do servidor/.test(s.text) && s.boot.join('x') === '800x600', s.text);
  await page.click('.wyd-settings-confirm button:not(.wyd-primary)');
  s = await page.evaluate(() => ({ hidden: document.querySelector('.wyd-settings-confirm').hidden, v: document.getElementById('wyd-resolution').value }));
  check(`${name}: cancelar volta ao atual`, s.hidden && s.v === '800x600', s.v);
  await page.selectOption('#wyd-resolution', '1024x768');
  await Promise.all([page.waitForEvent('load'), page.click('.wyd-settings-confirm .wyd-primary')]);
  await ready(page);
  s = await page.evaluate(() => ({ boot: fake.bootCanvas, snap: WydSettings.snapshot(), sel: document.getElementById('wyd-resolution').value }));
  check(`${name}: boot em 1024x768`, s.boot.join('x') === '1024x768' && s.snap.resolution === '1024x768' && s.sel === '1024x768', s.boot.join('x'));

  // 7. Mouse no centro mapeia para o centro lógico (exibição reduzida e ampliada).
  async function centerHit(label) {
    const box = await page.locator('#canvas').boundingBox();
    await page.evaluate(() => { fake.mouse.length = 0; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const m = await page.evaluate(() => fake.mouse.at(-1));
    check(`${name}: centro ${label} (${Math.round(box.width)}x${Math.round(box.height)})`,
      m && Math.abs(m[1] - 512) <= 2 && Math.abs(m[2] - 384) <= 2, JSON.stringify(m));
    return box;
  }
  await centerHit('sem ampliar');
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.click('.wyd-settings > summary');
  await page.check('#wyd-fit');
  await page.click('.wyd-settings > summary');
  const big = await centerHit('ampliado');
  const fits = await page.evaluate(() => document.getElementById('canvas').getBoundingClientRect().bottom <= innerHeight + 1);
  check(`${name}: ampliado maior e canvas inteiro visível`, big.width > 1024 && fits, `${Math.round(big.width)}px, cabe=${fits}`);
  await page.setViewportSize({ width: 600, height: 700 });
  // O relayout acontece no evento resize; espera o canvas caber na janela nova.
  for (let i = 0; i < 100 && (await page.locator('#canvas').boundingBox()).width > 600; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  await centerHit('ampliado em janela estreita');

  // 8. Preferência corrompida não quebra a página.
  await page.evaluate(() => localStorage.setItem('wyd.settings.v1', '{nope'));
  await page.reload();
  await ready(page);
  s = await page.evaluate(() => ({ boot: fake.bootCanvas, calls: fake.setCalls.length }));
  check(`${name}: preferência corrompida cai no padrão`, s.boot.join('x') === '800x600' && s.calls === 0);

  check(`${name}: sem erros de página`, errors.length === 0, errors.join(' | '));
  if (process.env.SETTINGS_SHOT) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => localStorage.removeItem('wyd.settings.v1'));
    await page.reload();
    await ready(page);
    await page.click('.wyd-settings > summary');
    await page.screenshot({ path: `${process.env.SETTINGS_SHOT}-${name}.png` });
  }
  await browser.close();
}
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
