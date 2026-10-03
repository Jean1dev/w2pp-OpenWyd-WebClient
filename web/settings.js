"use strict";
// Painel de configurações da página: volume de música e efeitos, resolução e
// ajuste do canvas à janela. Faz o papel do editor externo do Config.bin.
// Guarda só preferências locais em localStorage; nunca credenciais.
//
// Níveis na escala do Config.bin (0..100; 0 = desligado). O runtime aplica as
// curvas originais (patch 0023). Sem preferência salva vale o Config.bin.
// A resolução é lida pelo runtime no boot (tamanho do canvas), então trocar
// recarrega a página.
window.WydSettings = (() => {
  const STORAGE_KEY = "wyd.settings.v1";
  const RESOLUTIONS = ["640x480", "800x600", "1024x768", "1280x1024", "1600x1200"];
  const DEFAULT_RESOLUTION = "800x600";
  const GUTTER = 16;

  let canvas = null;
  let call = () => null;
  let inField = () => false;
  let booted = false;
  let prefs = load();

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    } catch {
      saved = null;
    }
    const level = v => Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
    const audio = saved?.audio && level(saved.audio.music) !== null && level(saved.audio.effects) !== null
      ? { music: saved.audio.music, effects: saved.audio.effects,
          musicMuted: saved.audio.musicMuted === true, effectsMuted: saved.audio.effectsMuted === true }
      : null;
    return {
      audio,
      resolution: RESOLUTIONS.includes(saved?.resolution) ? saved.resolution : DEFAULT_RESOLUTION,
      fit: saved?.fit === true
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Sem armazenamento (aba privada, bloqueio): vale só nesta sessão.
    }
  }

  function size(resolution) {
    const [width, height] = resolution.split("x").map(Number);
    return { width, height };
  }

  function effectiveLevels() {
    const a = prefs.audio;
    return { effects: a.effectsMuted ? 0 : a.effects, music: a.musicMuted ? 0 : a.music };
  }

  function sendLevels() {
    if (!prefs.audio) return;
    const { effects, music } = effectiveLevels();
    call("_wyd_audio_set_levels", effects, music);
  }

  // ---- ajuste à janela ----
  // Tamanho exibido calculado em pixels: o retângulo do canvas é exatamente a
  // área desenhada, então logicalPoint() das páginas continua acertando o clique.
  function layout() {
    if (!canvas) return;
    if (!prefs.fit) {
      canvas.style.width = "";
      canvas.style.height = "";
      return;
    }
    // Dentro de .wyd-stage, a largura é a que sobra ao lado do chat.
    const stage = canvas.closest(".wyd-stage");
    const availW = stage ? stage.clientWidth : document.documentElement.clientWidth - 2 * GUTTER;
    const top = canvas.getBoundingClientRect().top + window.scrollY;
    const availH = window.innerHeight - top - GUTTER;
    const scale = Math.max(0.1, Math.min(availW / canvas.width, availH / canvas.height));
    canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
    canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
  }

  // Antes do boot: o runtime adota o tamanho do canvas como resolução.
  function applyBeforeBoot(target) {
    canvas = target;
    const { width, height } = size(prefs.resolution);
    canvas.width = width;
    canvas.height = height;
    canvas.classList.toggle("wyd-fit", prefs.fit);
    layout();
    window.addEventListener("resize", layout);
  }

  // Depois do onRuntimeInitialized e antes de _wyd_boot_client.
  function beforeBoot(options) {
    call = options.call;
    inField = options.inField ?? (() => false);
    sendLevels();
  }

  function afterBoot() {
    booted = true;
    render();
  }

  function snapshot() {
    return {
      resolution: canvas ? `${canvas.width}x${canvas.height}` : null,
      fit: prefs.fit,
      effects: call("_wyd_audio_get_level", 0),
      music: call("_wyd_audio_get_level", 1),
      saved: prefs.audio ? effectiveLevels() : null
    };
  }

  // ---- painel ----
  let ui = null;

  function audioRow(kind, label) {
    const row = document.createElement("div");
    row.className = "wyd-settings-row";
    const name = document.createElement("label");
    name.htmlFor = `wyd-${kind}`;
    name.textContent = label;
    const range = document.createElement("input");
    range.type = "range";
    range.id = `wyd-${kind}`;
    range.min = "0";
    range.max = "100";
    range.step = "1";
    const value = document.createElement("output");
    value.htmlFor = range.id;
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "wyd-mute";
    mute.textContent = "Mudo";
    mute.setAttribute("aria-label", `${label}: mudo`);
    row.append(name, range, value, mute);
    return { row, range, value, mute };
  }

  // Sem preferência salva, parte dos níveis que o runtime leu do Config.bin.
  function ensureAudioPrefs() {
    if (prefs.audio) return;
    const level = which => {
      const v = call("_wyd_audio_get_level", which);
      return Number.isInteger(v) && v >= 0 && v <= 100 ? v : 50;
    };
    prefs.audio = { music: level(1), effects: level(0), musicMuted: false, effectsMuted: false };
  }

  function onAudioInput(kind, range) {
    ensureAudioPrefs();
    prefs.audio[kind] = Number(range.value) | 0;
    prefs.audio[`${kind}Muted`] = false;
    commitAudio();
  }

  function onMute(kind) {
    ensureAudioPrefs();
    prefs.audio[`${kind}Muted`] = !prefs.audio[`${kind}Muted`];
    commitAudio();
  }

  function commitAudio() {
    save();
    sendLevels();
    // Gesto do usuário: libera o AudioContext suspenso pela política de autoplay.
    call("_wyd_audio_resume");
    render();
  }

  function build() {
    const details = document.createElement("details");
    details.className = "wyd-settings";
    const summary = document.createElement("summary");
    summary.textContent = "Configurações";
    const panel = document.createElement("div");
    panel.className = "wyd-settings-panel";

    const soundTitle = document.createElement("p");
    soundTitle.className = "wyd-settings-group";
    soundTitle.textContent = "Som";
    const music = audioRow("music", "Música");
    const effects = audioRow("effects", "Efeitos");
    const soundNote = document.createElement("p");
    soundNote.className = "wyd-settings-note";

    const displayTitle = document.createElement("p");
    displayTitle.className = "wyd-settings-group";
    displayTitle.textContent = "Exibição";
    const resRow = document.createElement("div");
    resRow.className = "wyd-settings-row";
    const resLabel = document.createElement("label");
    resLabel.htmlFor = "wyd-resolution";
    resLabel.textContent = "Resolução";
    const resolution = document.createElement("select");
    resolution.id = "wyd-resolution";
    for (const r of RESOLUTIONS) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r.replace("x", "×");
      resolution.append(opt);
    }
    resRow.append(resLabel, resolution);

    const confirm = document.createElement("div");
    confirm.className = "wyd-settings-confirm";
    confirm.hidden = true;
    const confirmText = document.createElement("p");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "wyd-primary";
    apply.textContent = "Aplicar e recarregar";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    confirm.append(confirmText, apply, cancel);

    const fitLabel = document.createElement("label");
    fitLabel.className = "wyd-settings-check";
    const fit = document.createElement("input");
    fit.type = "checkbox";
    fit.id = "wyd-fit";
    fitLabel.append(fit, " Ampliar mantendo proporção");

    panel.append(soundTitle, music.row, effects.row, soundNote,
      displayTitle, resRow, confirm, fitLabel);
    details.append(summary, panel);

    for (const [kind, row] of [["music", music], ["effects", effects]]) {
      row.range.addEventListener("input", () => onAudioInput(kind, row.range));
      row.mute.addEventListener("click", () => onMute(kind));
    }
    resolution.addEventListener("change", () => {
      const current = canvas ? `${canvas.width}x${canvas.height}` : prefs.resolution;
      confirm.hidden = resolution.value === current;
      confirmText.textContent = inField()
        ? "O jogo será recarregado e você sairá do servidor."
        : "O jogo será recarregado.";
    });
    cancel.addEventListener("click", () => {
      resolution.value = canvas ? `${canvas.width}x${canvas.height}` : prefs.resolution;
      confirm.hidden = true;
    });
    apply.addEventListener("click", () => {
      if (!RESOLUTIONS.includes(resolution.value)) return;
      prefs.resolution = resolution.value;
      save();
      location.reload();
    });
    fit.addEventListener("change", () => {
      prefs.fit = fit.checked;
      save();
      canvas?.classList.toggle("wyd-fit", prefs.fit);
      layout();
    });
    // Teclas só chegam ao jogo pelo canvas; ao fechar o painel, o foco volta.
    details.addEventListener("toggle", () => {
      if (!details.open) canvas?.focus({ preventScroll: true });
    });

    ui = { details, music, effects, soundNote, resolution, confirm, fit };
    document.body.prepend(details);
  }

  function render() {
    if (!ui) build();
    const live = booted && typeof call("_wyd_audio_get_level", 0) === "number";
    const levels = prefs.audio ?? {
      music: Math.max(0, call("_wyd_audio_get_level", 1) ?? 0),
      effects: Math.max(0, call("_wyd_audio_get_level", 0) ?? 0),
      musicMuted: false, effectsMuted: false
    };
    for (const kind of ["music", "effects"]) {
      const row = ui[kind];
      const muted = levels[`${kind}Muted`];
      row.range.value = String(levels[kind]);
      row.range.disabled = !live;
      row.value.textContent = muted ? "mudo" : String(levels[kind]);
      row.mute.disabled = !live;
      row.mute.setAttribute("aria-pressed", String(muted));
    }
    ui.soundNote.textContent = live ? "" : "Este runtime não tem controle de volume.";
    ui.soundNote.hidden = live;
    if (ui.confirm.hidden) ui.resolution.value = canvas ? `${canvas.width}x${canvas.height}` : prefs.resolution;
    ui.fit.checked = prefs.fit;
  }

  return { applyBeforeBoot, beforeBoot, afterBoot, snapshot };
})();
