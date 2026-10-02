"use strict";
// Cena local do cliente WYD: renderiza uma cena real do runtime original com os
// assets do operador. Não há login, credenciais nem conexão ao servidor aqui.
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const identityEl = document.getElementById("identity");

const FIELD_STATE = 0;          // ObjectManager::TM_FIELD_STATE
const SELECTSERVER_STATE = 7;   // ObjectManager::TM_SELECTSERVER_STATE
const requestedState = (() => {
  const raw = Number.parseInt(new URLSearchParams(location.search).get("state") ?? "", 10);
  return raw === SELECTSERVER_STATE ? SELECTSERVER_STATE : FIELD_STATE;
})();

const WM = { MOUSEMOVE: 0x0200, LBUTTONDOWN: 0x0201, LBUTTONUP: 0x0202, RBUTTONDOWN: 0x0204,
  RBUTTONUP: 0x0205, MOUSEWHEEL: 0x020a, KEYDOWN: 0x0100, KEYUP: 0x0101 };
const MK = { LBUTTON: 0x0001, RBUTTON: 0x0002, SHIFT: 0x0004, CONTROL: 0x0008, MBUTTON: 0x0010 };

window.sceneEvidence = {
  requestedState, ready: false, boot: null, frames: 0, errors: [], diagnostics: []
};

function diagnostic(message) {
  // Esta página não possui campos de credencial nem conexão de rede.
  if (sceneEvidence.diagnostics.length < 150) sceneEvidence.diagnostics.push(String(message));
}

function call(name, ...args) {
  return typeof Module[name] === "function" ? Module[name](...args) : null;
}

function text(name, ...args) {
  const ptr = call(name, ...args);
  return ptr && typeof Module.UTF8ToString === "function" ? Module.UTF8ToString(ptr >>> 0) : null;
}

// Caminhos distintos que o runtime tentou abrir e não encontrou no dataset.
function samples() {
  const total = call("_wyd_d3d9_asset_file_open_fail_sample_count");
  if (!total) return [];
  return Array.from({ length: total }, (_, i) => text("_wyd_d3d9_asset_file_open_fail_sample", i));
}

// Identificação lida do próprio runtime, não do que a página presume ter feito.
function probe() {
  return {
    state: call("_wyd_get_game_state"),
    stateName: text("_wyd_get_state_name", call("_wyd_get_game_state")),
    placeholder: call("_wyd_state_is_placeholder"),
    fieldMode: call("_wyd_get_field_mode"),
    fieldInitialized: call("_wyd_field_initialized"),
    fieldFixture: call("_wyd_field_debug_fixture_used"),
    fieldCriticalError: call("_wyd_field_critical_error"),
    hasGround: call("_wyd_field_has_ground"),
    hasMyHuman: call("_wyd_field_has_my_human"),
    mapX: call("_wyd_field_map_x"),
    mapY: call("_wyd_field_map_y"),
    humanName: text("_wyd_field_myhuman_name"),
    humanClass: call("_wyd_field_myhuman_class_id"),
    humanX: call("_wyd_field_myhuman_x"),
    humanY: call("_wyd_field_myhuman_y"),
    humanHp: call("_wyd_field_myhuman_hp"),
    humanMaxHp: call("_wyd_field_myhuman_max_hp"),
    humanMoving: call("_wyd_field_myhuman_moving"),
    humanMoveToX: call("_wyd_field_myhuman_move_to_x"),
    humanMoveToY: call("_wyd_field_myhuman_move_to_y"),
    groundHeightUnderPlayer: call("_wyd_field_ground_height_under_player"),
    cameraValid: call("_wyd_debug_camera_valid"),
    cameraX: call("_wyd_debug_camera_x"),
    cameraY: call("_wyd_debug_camera_y"),
    cameraZ: call("_wyd_debug_camera_z"),
    lastPickValid: call("_wyd_field_last_pick_valid"),
    lastPickX: call("_wyd_field_last_pick_x"),
    lastPickY: call("_wyd_field_last_pick_y"),
    mouseEvents: call("_wyd_input_mouse_event_count"),
    keyEvents: call("_wyd_input_key_event_count"),
    webgl2: call("_wyd_d3d9_is_webgl2"),
    presentCalls: call("_wyd_d3d9_present_calls"),
    drawCalls: call("_wyd_d3d9_draw_calls"),
    texturedDraws: call("_wyd_d3d9_textured_draws"),
    textureOpenFailures: call("_wyd_d3d9_asset_file_open_fail_texture"),
    assetOpenFailures: call("_wyd_d3d9_asset_file_open_fail"),
    assetOpenFailureSamples: samples(),
    glErrorTotal: call("_wyd_d3d9_gl_error_total"),
    glErrorLast: call("_wyd_d3d9_gl_error_last"),
    settings: WydSettings.snapshot()
  };
}
window.sceneProbe = probe;

// O runtime raciocina em pixels lógicos do backbuffer; a página pode exibir o
// canvas em outra escala.
function logicalPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const clamp = (v, max) => Math.min(max, Math.max(0, Math.round(v)));
  return { x: clamp((event.clientX - rect.left) * scaleX, canvas.width - 1),
           y: clamp((event.clientY - rect.top) * scaleY, canvas.height - 1) };
}

function mouseFlags(event) {
  let flags = 0;
  if (event.buttons & 1) flags |= MK.LBUTTON;
  if (event.buttons & 2) flags |= MK.RBUTTON;
  if (event.buttons & 4) flags |= MK.MBUTTON;
  if (event.shiftKey) flags |= MK.SHIFT;
  if (event.ctrlKey) flags |= MK.CONTROL;
  return flags >>> 0;
}

function sendMouse(msg, event, wheelDelta = 0) {
  const point = logicalPoint(event);
  call("_wyd_mouse_event", msg >>> 0, mouseFlags(event), point.x | 0, point.y | 0, wheelDelta | 0);
}

function wireInput() {
  canvas.addEventListener("mousemove", event => sendMouse(WM.MOUSEMOVE, event));
  canvas.addEventListener("mousedown", event => {
    canvas.focus();
    sendMouse(event.button === 2 ? WM.RBUTTONDOWN : WM.LBUTTONDOWN, event);
  });
  canvas.addEventListener("mouseup", event =>
    sendMouse(event.button === 2 ? WM.RBUTTONUP : WM.LBUTTONUP, event));
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    sendMouse(WM.MOUSEWHEEL, event, event.deltaY > 0 ? -120 : 120);
  }, { passive: false });
  // Sem campos de texto nesta página: apenas teclas de comando chegam ao cliente.
  canvas.addEventListener("keydown", event => {
    event.preventDefault();
    call("_wyd_key_event", WM.KEYDOWN, event.keyCode >>> 0);
  });
  canvas.addEventListener("keyup", event => {
    event.preventDefault();
    call("_wyd_key_event", WM.KEYUP, event.keyCode >>> 0);
  });
}

function describe(info) {
  if (info.state === SELECTSERVER_STATE) return `${info.stateName} — seleção de servidor`;
  const origin = info.fieldFixture ? "fixture offline" : "dados do servidor";
  return `${info.stateName} — mapa ${info.mapX},${info.mapY} · ${info.humanName ?? "?"} ` +
    `em ${info.humanX},${info.humanY} (${origin})`;
}

// O runtime lê a resolução do tamanho do canvas no boot.
WydSettings.applyBeforeBoot(canvas);

window.Module = {
  canvas,
  // Endpoint deliberadamente inutilizável na cena offline; a CSP também proíbe WS.
  wydSocketProxyUrl: "ws://127.0.0.1:1/offline",
  print: diagnostic,
  printErr: diagnostic,
  onAbort() {
    sceneEvidence.errors.push("WASM abort");
    statusEl.textContent = "Falha no runtime. Consulte a evidência local.";
  },
  onRuntimeInitialized() {
    try {
      sceneEvidence.ready = true;
      // Mesma ordem de boot do harness upstream em modo legado: backend bridge e
      // field real antes do boot, cena e contadores logo depois.
      call("_wyd_renderer_set_backend", 0);
      call("_wyd_set_field_mode", 1);
      WydSettings.beforeBoot({ call, inField: () => call("_wyd_field_has_my_human") === 1 });
      sceneEvidence.boot = Module._wyd_boot_client(1);
      if (sceneEvidence.boot !== 1) throw new Error("Falha ao inicializar a cena");
      Module._wyd_set_game_state(requestedState);
      WydSettings.afterBoot();
      call("_wyd_d3d9_set_debug_flags", 0);
      call("_wyd_d3d9_reset_debug_counters");
      wireInput();
      function frame() {
        try {
          // A cena acompanha o relógio do navegador, como o jogo ao vivo. Relógio
          // falso congela a câmera no início da animação e distorce a captura.
          if (Module._wyd_tick_client() < 0) throw new Error("Falha no tick");
          sceneEvidence.frames++;
          sceneEvidence.probe = probe();
          statusEl.textContent = "Cena local — sem conexão ao servidor";
          identityEl.textContent = describe(sceneEvidence.probe);
          requestAnimationFrame(frame);
        } catch (error) {
          sceneEvidence.errors.push(String(error));
          statusEl.textContent = "Falha ao renderizar a cena.";
        }
      }
      requestAnimationFrame(frame);
    } catch (error) {
      sceneEvidence.errors.push(String(error));
      statusEl.textContent = "Falha ao carregar a cena.";
    }
  }
};
