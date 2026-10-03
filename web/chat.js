"use strict";
// Chat global da página (ADR 018), ao lado do canvas e fora do protocolo do
// jogo. O gateway mantém uma sala em memória: sem histórico, sem gravação.
// O nick é o nome da conta do portal, decidido pelo gateway a partir da
// sessão; esta página nunca o envia. O texto é exibido só com textContent.
window.WydChat = (() => {
  const MAX_LINES = 200;
  const MAX_RUNES = 200;
  const ERRORS = {
    rate: "Muitas mensagens seguidas. Aguarde um instante.",
    invalid: "Mensagem inválida.",
    readonly: "Entre pelo portal para falar no chat."
  };

  const root = document.getElementById("chat");
  const statusEl = document.getElementById("chat-status");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const button = form.querySelector("button");
  const note = document.getElementById("chat-note");
  const canvas = document.getElementById("canvas");

  const evidence = { state: "off", online: 0, received: 0, sent: 0, errors: {} };
  let ws = null, nick = "", canSend = false, retry = 0, retryTimer = 0, started = false;

  const clock = ts => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function setState(state, text) {
    evidence.state = state;
    root.dataset.state = state;
    statusEl.textContent = text;
  }

  function setOnline(n) {
    evidence.online = n;
    setState("open", n === 1 ? "1 online" : `${n} online`);
  }

  function enableInput(on) {
    input.disabled = !on;
    button.disabled = !on;
  }

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function append(li) {
    // Rola junto só quem já está no fim; quem lê mensagens antigas fica onde está.
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.append(li);
    while (log.childElementCount > MAX_LINES) log.firstElementChild.remove();
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function system(text) {
    const li = document.createElement("li");
    li.className = "wyd-chat-sys";
    li.textContent = text;
    append(li);
  }

  function message(m) {
    if (typeof m.nick !== "string" || typeof m.text !== "string") return;
    evidence.received++;
    const li = document.createElement("li");
    if (m.nick === nick) li.className = "wyd-chat-mine";
    const time = document.createElement("time");
    time.textContent = clock(Number(m.ts) || Date.now());
    const who = document.createElement("b");
    who.textContent = m.nick;
    const text = document.createElement("span");
    text.textContent = m.text;
    li.append(time, " ", who, " ", text);
    append(li);
  }

  function onFrame(event) {
    let m;
    try {
      m = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (m?.t) {
      case "hello":
        retry = 0;
        nick = typeof m.nick === "string" ? m.nick : "";
        canSend = m.canSend === true;
        enableInput(canSend);
        showNote(canSend ? "" : ERRORS.readonly);
        input.placeholder = canSend ? `Falar como ${nick}` : "Somente leitura";
        setState("open", "Conectado");
        break;
      case "online":
        setOnline(Number(m.n) || 0);
        break;
      case "msg":
        message(m);
        break;
      case "error":
        evidence.errors[m.code] = (evidence.errors[m.code] ?? 0) + 1;
        showNote(ERRORS[m.code] ?? ERRORS.invalid);
        break;
    }
  }

  function connect() {
    retryTimer = 0;
    const url = new URL("chat/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    url.hash = "";
    setState("connecting", retry ? "Reconectando…" : "Conectando…");
    const socket = new WebSocket(url);
    ws = socket;
    let opened = false;
    socket.addEventListener("open", () => {
      opened = true;
      system("Conectado ao chat. As mensagens não ficam gravadas.");
    });
    socket.addEventListener("message", onFrame);
    socket.addEventListener("close", () => {
      if (ws !== socket) return;
      ws = null;
      enableInput(false);
      if (opened) system("Conexão com o chat perdida.");
      // 1 s, 2 s, 4 s… até 30 s, com variação para as abas não voltarem juntas.
      const delay = Math.min(30000, 1000 * 2 ** retry) * (0.75 + Math.random() * 0.5);
      retry = Math.min(retry + 1, 5);
      setState("closed", `Reconectando em ${Math.ceil(delay / 1000)} s…`);
      retryTimer = setTimeout(connect, delay);
    });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !canSend || ws?.readyState !== WebSocket.OPEN) return;
    if ([...text].length > MAX_RUNES) {
      showNote(ERRORS.invalid);
      return;
    }
    ws.send(JSON.stringify({ t: "say", text }));
    evidence.sent++;
    input.value = "";
    showNote(canSend ? "" : ERRORS.readonly);
  });

  // Esc volta ao jogo. As teclas do jogo são lidas só no canvas, então digitar
  // aqui não move o personagem.
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      canvas?.focus({ preventScroll: true });
    }
  });

  return {
    evidence,
    // Chamado por client.js com o "chat" de /config.json; gateway antigo ou chat
    // desligado deixam o painel escondido.
    start(enabled) {
      if (started || enabled !== true) return;
      started = true;
      root.hidden = false;
      // O ajuste do canvas à janela depende da largura que sobra ao lado do chat.
      window.dispatchEvent(new Event("resize"));
      connect();
    },
    stop() {
      clearTimeout(retryTimer);
      const socket = ws;
      ws = null;
      socket?.close();
      setState("off", "Desligado");
    }
  };
})();
