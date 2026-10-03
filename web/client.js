"use strict";
// Cliente WYD conectado: o runtime original fala CPSock pelo gateway do operador.
// A página só entrega o endpoint e a versão de protocolo lidos de /config.json.
// Conta, senha e PIN são digitados na interface do jogo; nada é gravado no
// navegador, na URL ou no console por esta página. Apenas assets do jogo
// podem ser persistidos pelo carregador em IndexedDB.
const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const identityEl = document.getElementById("identity");

const SESSION_EXPIRED = "Sua sessão expirou. Entre novamente pelo portal.";
const DOWNLOAD_FAILED = "Não foi possível baixar os dados do jogo. Verifique a conexão e tente novamente.";

// Tela de carregamento: mostra só etapas e a contagem de bytes do pacote,
// nunca conta, URL ou payload.
const Loader = (() => {
  const root = document.getElementById("loader");
  const stageEl = document.getElementById("loader-stage");
  const detailEl = document.getElementById("loader-detail");
  const noteEl = document.getElementById("loader-note");
  const tipEl = document.getElementById("loader-tip");
  const retryEl = document.getElementById("loader-retry");
  const bar = document.getElementById("loader-bar");
  const fill = bar.firstElementChild;
  const MIB = 1048576;
  const TIPS = [
    "Clique no chão para andar.",
    "Música, efeitos e resolução ficam no botão de configurações, no canto da tela.",
    "Depois do primeiro acesso, os dados do jogo ficam guardados no navegador.",
    "Conta, senha e PIN são digitados só na tela do jogo; a página não os guarda."
  ];
  const mb = bytes => (bytes / MIB).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const eta = s => s < 60 ? `${Math.max(1, Math.ceil(s))} s` : `${Math.ceil(s / 60)} min`;
  let samples = [], painted = 0, finished = false, failed = false, tip = 0;

  retryEl.addEventListener("click", () => location.reload());
  tipEl.textContent = TIPS[0];
  const tipTimer = setInterval(() => {
    tipEl.classList.add("fading");
    setTimeout(() => {
      tip = (tip + 1) % TIPS.length;
      tipEl.textContent = TIPS[tip];
      tipEl.classList.remove("fading");
    }, 400);
  }, 7000);

  function determinate(fraction) {
    root.classList.remove("indeterminate");
    fill.style.transform = `scaleX(${fraction})`;
    bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  }

  return {
    get finished() { return finished || failed; },
    stage(text, detail = "") {
      if (finished || failed) return;
      stageEl.textContent = text;
      detailEl.textContent = detail;
      root.classList.add("indeterminate");
      fill.style.transform = "";
      bar.removeAttribute("aria-valuenow");
    },
    // Chamado a cada bloco recebido; a tela é redesenhada no máximo a cada 100 ms.
    progress(loaded, total) {
      if (finished || failed || !(total > 0)) return;
      const now = performance.now();
      samples.push([now, loaded]);
      while (samples.length > 2 && now - samples[0][0] > 4000) samples.shift();
      if (loaded < total && now - painted < 100) return;
      painted = now;
      const [t0, b0] = samples[0];
      const rate = now - t0 > 1000 ? (loaded - b0) / ((now - t0) / 1000) : 0;
      let detail = `${mb(loaded)} / ${mb(total)} MB`;
      if (rate > 0) {
        detail += ` · ${(rate / MIB).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB/s`;
        if (loaded < total) detail += ` · ~${eta((total - loaded) / rate)}`;
      }
      stageEl.textContent = loaded < total ? "Baixando dados do jogo…" : "Guardando os dados no navegador…";
      detailEl.textContent = detail;
      determinate(Math.min(1, loaded / total));
      noteEl.textContent = `O primeiro acesso baixa cerca de ${mb(total)} MB. ` +
        "Nas próximas vezes o jogo abre a partir dos dados guardados no navegador.";
      noteEl.hidden = false;
    },
    fail(message) {
      if (failed) return;
      failed = true;
      clearInterval(tipTimer);
      root.hidden = false;
      root.classList.remove("leaving", "indeterminate");
      root.classList.add("failed");
      root.setAttribute("aria-busy", "false");
      bar.removeAttribute("aria-valuenow");
      stageEl.textContent = message;
      detailEl.textContent = "";
      retryEl.hidden = false;
      retryEl.focus();
    },
    done() {
      if (finished || failed) return;
      finished = true;
      clearInterval(tipTimer);
      determinate(1);
      root.setAttribute("aria-busy", "false");
      root.classList.add("leaving");
      setTimeout(() => { if (!failed) root.hidden = true; }, 500);
    }
  };
})();

// O file_packager não trata a falha do download no build não-ES6 (Emscripten
// 6.0.0, fetchRemotePackage): sem isto a página ficaria carregando para sempre.
window.addEventListener("unhandledrejection", event => {
  if (Loader.finished) return;
  const reason = String(event.reason?.message ?? event.reason);
  clientEvidence.errors.push(reason);
  Loader.fail(/^401\b/.test(reason) ? SESSION_EXPIRED : DOWNLOAD_FAILED);
});

const SELECTSERVER_STATE = 7; // ObjectManager::TM_SELECTSERVER_STATE
const WM = { MOUSEMOVE: 0x0200, LBUTTONDOWN: 0x0201, LBUTTONUP: 0x0202, RBUTTONDOWN: 0x0204,
  RBUTTONUP: 0x0205, MOUSEWHEEL: 0x020a, KEYDOWN: 0x0100, KEYUP: 0x0101, CHAR: 0x0102 };
const MK = { LBUTTON: 0x0001, RBUTTON: 0x0002, SHIFT: 0x0004, CONTROL: 0x0008, MBUTTON: 0x0010 };

// Contadores do tradutor de dialeto (WydDialect.h, enum WydDialectStat).
const STATS = ["inPass", "inTranslated", "inDropUnknown", "inDropSize", "inDropRange",
  "outPass", "outTranslated", "outDropUnknown", "outDropSize", "outDropRange", "outDropNoVersion",
  "fieldZeroed", "cargoHidden", "unmappedNonZero", "inAttack", "outAttack"];

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
    glErrorTotal: call("_wyd_d3d9_gl_error_total"),
    settings: WydSettings.snapshot()
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

// Login automático (ADR 017): o gateway entrega uma única vez a conta e o
// código de uso único emitido pelo portal. Qualquer falha deixa o login manual,
// como antes. Nada disso vai para o console, a URL ou o armazenamento.
async function fetchPortalLogin() {
  try {
    const response = await fetch("auth/game-login", { method: "POST", cache: "no-store", credentials: "same-origin" });
    if (response.status !== 200) return null;
    const login = await response.json();
    return typeof login?.account === "string" && typeof login?.code === "string" ? login : null;
  } catch {
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Não foi possível baixar ${src}. Verifique a conexão e tente novamente.`));
    document.body.appendChild(s);
  });
}

async function start() {
  Loader.stage("Verificando acesso…");
  const response = await fetch("config.json", { cache: "no-store" });
  if (response.status === 401) throw new Error(SESSION_EXPIRED);
  if (!response.ok) throw new Error(`Não foi possível ler a configuração (HTTP ${response.status}).`);
  const cfg = await response.json();
  if (typeof cfg.wsUrl !== "string" || !/^wss?:\/\//.test(cfg.wsUrl) || !(cfg.clientVersion > 0)) {
    throw new Error("config.json inválido");
  }
  clientEvidence.config = { channel: cfg.channel, wsUrl: cfg.wsUrl, clientVersion: cfg.clientVersion };
  // O chat não depende do runtime: conecta enquanto o jogo ainda baixa.
  clientEvidence.chat = WydChat.evidence;
  WydChat.start(cfg.chat);
  // O runtime lê a resolução do tamanho do canvas no boot.
  WydSettings.applyBeforeBoot(canvas);

  window.Module = {
    canvas,
    wydSocketProxyUrl: cfg.wsUrl,
    print: diagnostic,
    printErr: diagnostic,
    // O file_packager informa "Downloading data... (recebidos/total)" a cada bloco.
    setStatus(text) {
      const m = /\((\d+)\/(\d+)\)/.exec(text);
      if (m) Loader.progress(Number(m[1]), Number(m[2]));
      else if (text === "Downloading data...") Loader.stage("Baixando dados do jogo…");
    },
    onAbort() {
      clientEvidence.errors.push("WASM abort");
      Loader.fail("O jogo parou por um erro interno. Tente novamente.");
    },
    onRuntimeInitialized() {
      clearInterval(cacheWatch);
      try {
        clientEvidence.ready = true;
        clientEvidence.assetPreload = {
          fromCache: Module.preloadResults?.["openwyd_assets.data"]?.fromCache ?? null
        };
        call("_wyd_net_set_client_version", cfg.clientVersion | 0);
        call("_wyd_renderer_set_backend", 0);
        call("_wyd_set_field_mode", 1);
        WydSettings.beforeBoot({ call, inField: () => call("_wyd_field_has_my_human") === 1 });
        if (Module._wyd_boot_client(1) !== 1) throw new Error("Falha ao inicializar o cliente");
        Module._wyd_set_game_state(SELECTSERVER_STATE);
        WydSettings.afterBoot();
        call("_wyd_d3d9_set_debug_flags", 0);
        wireInput();
        canvas.focus();
        // Com um único servidor, a lista é pulada e o painel de login abre direto
        // (patch 0025). -1: não se aplica; null: runtime sem a exportação.
        let autoServer = true;
        // Login automático: só depois do primeiro salto da lista, uma vez por página.
        let portalLogin = null;
        let loginTries = 0;
        const frame = () => {
          try {
            if (Module._wyd_tick_client() < 0) throw new Error("Falha no tick");
            if (clientEvidence.frames++ === 0) Loader.done();
            if (clientEvidence.frames % 15 === 1) {
              if (autoServer) {
                const result = call("_wyd_selectserver_auto");
                if (result === 1) clientEvidence.autoServer = (clientEvidence.autoServer ?? 0) + 1;
                if (result === null || result === -1) autoServer = false;
                if (result === 1 && clientEvidence.autoLogin === undefined) {
                  clientEvidence.autoLogin = "pending";
                  fetchPortalLogin().then(login => {
                    portalLogin = login;
                    if (!login) clientEvidence.autoLogin = "none";
                  });
                }
              }
              if (portalLogin) {
                // 0: o painel ainda não está pronto; tenta de novo por alguns segundos.
                const result = typeof Module._wyd_selectserver_login === "function"
                  ? Module.ccall("wyd_selectserver_login", "number", ["string", "string"],
                    [portalLogin.account, portalLogin.code])
                  : -1;
                if (result !== 0 || ++loginTries >= 20) {
                  clientEvidence.autoLogin = result === 1 ? "sent" : "failed";
                  portalLogin = null;
                }
              }
              clientEvidence.probe = probe();
              identityEl.textContent = describe(clientEvidence.probe);
            }
            requestAnimationFrame(frame);
          } catch (error) {
            clientEvidence.errors.push(String(error));
            Loader.fail("Falha ao desenhar o jogo. Tente novamente.");
          }
        };
        statusEl.textContent = `Canal ${cfg.channel}`;
        requestAnimationFrame(frame);
      } catch (error) {
        clientEvidence.errors.push(String(error));
        Loader.fail("Falha ao iniciar o jogo. Tente novamente.");
      }
    }
  };
  // O file_packager marca fromCache antes de ler o IndexedDB; a leitura do
  // cache não informa progresso.
  const cacheWatch = setInterval(() => {
    if (Module.preloadResults?.["openwyd_assets.data"]?.fromCache) {
      clearInterval(cacheWatch);
      Loader.stage("Abrindo os dados guardados no navegador…");
    }
  }, 200);
  Loader.stage("Baixando o jogo…");
  try {
    await loadScript("openwyd_assets.js");
    await loadScript("runtime.js");
  } catch (error) {
    clearInterval(cacheWatch);
    throw error;
  }
}

start().catch(error => {
  clientEvidence.errors.push(String(error));
  Loader.fail(String(error.message ?? error));
});
