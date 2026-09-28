"use strict";
// Cliente WYD conectado: o runtime original fala CPSock pelo gateway do operador.
// A página só entrega o endpoint e a versão de protocolo lidos de /config.json.
// Conta, senha e PIN são digitados na interface do jogo; nada é gravado no
// navegador, na URL ou no console por esta página.
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const identityEl = document.getElementById("identity");

const SELECTSERVER_STATE = 7; // ObjectManager::TM_SELECTSERVER_STATE
const WM = { MOUSEMOVE: 0x0200, LBUTTONDOWN: 0x0201, LBUTTONUP: 0x0202, RBUTTONDOWN: 0x0204,
  RBUTTONUP: 0x0205, MOUSEWHEEL: 0x020a, KEYDOWN: 0x0100, KEYUP: 0x0101, CHAR: 0x0102 };
const MK = { LBUTTON: 0x0001, RBUTTON: 0x0002, SHIFT: 0x0004, CONTROL: 0x0008, MBUTTON: 0x0010 };

// Contadores do tradutor de dialeto (WydDialect.h, enum WydDialectStat).
const STATS = ["inPass", "inTranslated", "inDropUnknown", "inDropSize", "inDropRange",
  "outPass", "outTranslated", "outDropUnknown", "outDropSize", "outDropRange", "outDropNoVersion",
  "fieldZeroed", "cargoHidden", "unmappedNonZero"];

window.clientEvidence = { ready: false, frames: 0, errors: [], diagnostics: [], config: null };

function diagnostic(message) {
  // O runtime pode imprimir textos de interface; nunca recebe credenciais daqui.
  if (clientEvidence.diagnostics.length < 200) clientEvidence.diagnostics.push(String(message));
}

function call(name, ...args) {
  return typeof Module[name] === "function" ? Module[name](...args) : null;
}

function text(name, ...args) {
  const ptr = call(name, ...args);
  return ptr && typeof Module.UTF8ToString === "function" ? Module.UTF8ToString(ptr >>> 0) : null;
}

function dropped(outbound) {
  const n = call("_wyd_net_dropped_count", outbound) ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    opcode: "0x" + (call("_wyd_net_dropped_opcode", outbound, i) >>> 0).toString(16).padStart(4, "0"),
    times: call("_wyd_net_dropped_times", outbound, i) >>> 0
  }));
}

// Somente contadores, opcodes e estado de cena; nenhum payload.
function probe() {
  const stats = Object.fromEntries(STATS.map((k, i) => [k, call("_wyd_net_stat", i) >>> 0]));
  return {
    state: call("_wyd_get_game_state"),
    stateName: text("_wyd_get_state_name", call("_wyd_get_game_state")),
    placeholder: call("_wyd_state_is_placeholder"),
    clientVersion: call("_wyd_net_client_version"),
    socket: {
      connectResult: call("_wyd_socket_last_connect_result"),
      lastError: call("_wyd_socket_last_error"),
      bytesSent: call("_wyd_socket_bytes_sent"),
      bytesReceived: call("_wyd_socket_bytes_received"),
      lastSentOpcode: call("_wyd_socket_last_sent_opcode"),
      lastRecvOpcode: call("_wyd_socket_last_recv_opcode")
    },
    dialect: { ...stats, inboundFrames: call("_wyd_net_inbound_frames") >>> 0,
      inboundHash: (call("_wyd_net_inbound_hash") >>> 0).toString(16).padStart(8, "0"),
      droppedIn: dropped(0), droppedOut: dropped(1) },
    field: {
      initialized: call("_wyd_field_initialized"),
      fixture: call("_wyd_field_debug_fixture_used"),
      mapX: call("_wyd_field_map_x"), mapY: call("_wyd_field_map_y"),
      hasMyHuman: call("_wyd_field_has_my_human"),
      humanName: text("_wyd_field_myhuman_name"),
      humanClass: call("_wyd_field_myhuman_class_id"),
      humanX: call("_wyd_field_myhuman_x"), humanY: call("_wyd_field_myhuman_y"),
      humanHp: call("_wyd_field_myhuman_hp"), humanMaxHp: call("_wyd_field_myhuman_max_hp")
    },
    textInputActive: call("_wyd_text_input_active"),
    webgl2: call("_wyd_d3d9_is_webgl2"),
    glErrorTotal: call("_wyd_d3d9_gl_error_total")
  };
}
window.clientProbe = probe;

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
  const p = logicalPoint(event);
  call("_wyd_mouse_event", msg >>> 0, mouseFlags(event), p.x | 0, p.y | 0, wheelDelta | 0);
}

const NAMED_KEYS = { Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Shift: 0x10, Control: 0x11, Alt: 0x12,
  Escape: 0x1b, " ": 0x20, PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, ArrowLeft: 0x25,
  ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Delete: 0x2e };

function keyCode(event) {
  if (event.keyCode) return event.keyCode;
  return NAMED_KEYS[event.key] || (event.key?.length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0);
}

// Caracteres para os campos de texto do jogo (página de código Latin-1/1252).
function charCode(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return 0;
  if (event.key?.length === 1) {
    const cp = event.key.codePointAt(0);
    return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? cp : 0x3f;
  }
  return { Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Escape: 0x1b }[event.key] || 0;
}

function wireInput() {
  canvas.addEventListener("mousemove", e => sendMouse(WM.MOUSEMOVE, e));
  canvas.addEventListener("mousedown", e => {
    canvas.focus();
    sendMouse(e.button === 2 ? WM.RBUTTONDOWN : WM.LBUTTONDOWN, e);
  });
  canvas.addEventListener("mouseup", e => sendMouse(e.button === 2 ? WM.RBUTTONUP : WM.LBUTTONUP, e));
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    sendMouse(WM.MOUSEWHEEL, e, e.deltaY > 0 ? -120 : 120);
  }, { passive: false });
  canvas.addEventListener("keydown", e => {
    const code = keyCode(e);
    if (!code) return;
    e.preventDefault();
    call("_wyd_key_event", WM.KEYDOWN, code >>> 0, e.repeat ? 1 : 0);
    const ch = charCode(e);
    if (ch) call("_wyd_key_event", WM.CHAR, ch >>> 0, e.repeat ? 1 : 0);
  });
  canvas.addEventListener("keyup", e => {
    const code = keyCode(e);
    if (!code) return;
    e.preventDefault();
    call("_wyd_key_event", WM.KEYUP, code >>> 0, 0);
  });
}

function describe(info) {
  if (info.field.initialized) {
    const origin = info.field.fixture ? "fixture offline" : "servidor";
    return `${info.stateName} — mapa ${info.field.mapX},${info.field.mapY} · ${info.field.humanName ?? "?"} ` +
      `em ${info.field.humanX},${info.field.humanY} (${origin})`;
  }
  return `${info.stateName}`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`falha ao carregar ${src}`));
    document.body.appendChild(s);
  });
}

async function start() {
  const response = await fetch("config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`config.json: HTTP ${response.status}`);
  const cfg = await response.json();
  if (typeof cfg.wsUrl !== "string" || !/^wss?:\/\//.test(cfg.wsUrl) || !(cfg.clientVersion > 0)) {
    throw new Error("config.json inválido");
  }
  clientEvidence.config = { channel: cfg.channel, wsUrl: cfg.wsUrl, clientVersion: cfg.clientVersion };

  window.Module = {
    canvas,
    wydSocketProxyUrl: cfg.wsUrl,
    print: diagnostic,
    printErr: diagnostic,
    onAbort() {
      clientEvidence.errors.push("WASM abort");
      statusEl.textContent = "Falha no runtime.";
    },
    onRuntimeInitialized() {
      try {
        clientEvidence.ready = true;
        call("_wyd_net_set_client_version", cfg.clientVersion | 0);
        call("_wyd_renderer_set_backend", 0);
        call("_wyd_set_field_mode", 1);
        if (Module._wyd_boot_client(1) !== 1) throw new Error("Falha ao inicializar o cliente");
        Module._wyd_set_game_state(SELECTSERVER_STATE);
        call("_wyd_d3d9_set_debug_flags", 0);
        wireInput();
        canvas.focus();
        const frame = () => {
          try {
            if (Module._wyd_tick_client() < 0) throw new Error("Falha no tick");
            clientEvidence.frames++;
            if (clientEvidence.frames % 15 === 1) {
              clientEvidence.probe = probe();
              identityEl.textContent = describe(clientEvidence.probe);
            }
            requestAnimationFrame(frame);
          } catch (error) {
            clientEvidence.errors.push(String(error));
            statusEl.textContent = "Falha ao renderizar.";
          }
        };
        statusEl.textContent = `Canal ${cfg.channel}`;
        requestAnimationFrame(frame);
      } catch (error) {
        clientEvidence.errors.push(String(error));
        statusEl.textContent = "Falha ao iniciar.";
      }
    }
  };
  await loadScript("openwyd_assets.js");
  await loadScript("runtime.js");
}

start().catch(error => {
  clientEvidence.errors.push(String(error));
  statusEl.textContent = String(error.message ?? error);
});
