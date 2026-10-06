# Etapa 7 com o pacote real: cache, carregamento e configurações (06/10/2026)

## Escopo

Pedido do usuário: validar a etapa 7 com o pacote real, que antes só tinha testes com runtime ou pacote falsos. Decisões do usuário: montar o ambiente local do zero e criar duas contas de teste novas no portal do operador.

Validações:
- cache do pacote principal ([30/09](2026-09-30-asset-cache.md)): `assets:cache -- --real`;
- tela de carregamento ([02/10](2026-10-02-loading-screen.md)): pacote real, IndexedDB frio e quente, rede lenta;
- painel de configurações ([02/10](2026-10-02-settings.md)): roteiro online no tm-server do Railway.

## Ambiente

Repositório `fb88dd8` com as mudanças desta sessão. Montagem do zero conforme `docs/setup.md` e `dependencies.lock.json`, em Windows:

| Item | Versão e verificação |
|---|---|
| upstream | `beb9f69bdea6d81f70af14b5ce85ed064575bb26` (`tools/fetch_pinned.py`), patches 0001–0026 aplicados do zero |
| servidor (fonte) | `98286fdf01202f503523e89d3e50b2183f00c36c` |
| emsdk | 6.0.0, commit `d223ae73…` conferido com o lock; em++ aquecido antes do build |
| Go | 1.25.13; SHA-256 do zip igual ao do lock |
| Node / Python / Playwright | 24.14.1 / 3.14.3 / 1.54.2 (Chromium 139.0.7258.5, Firefox 140.0.2) |
| WASM | `tmproject_startup.1791287597150354500.wasm` (SHA-256 `56d3d16a8df83b4b…`), objetos `certified=true`, link `--dev` com `undefined_total=0` |
| Assets | importados de `Client-aws`, origem só lida: 7.093 arquivos, 319.802.941 bytes, 13 faixas de música; pacote `openwyd_assets.data` de 304 MB |

tm-server lido com a CLI do Railway (`@railway/cli` 5.63.1, só leitura): `reseau.proxy.rlwy.net:56950`, `W2PP_CLIENT_VERSION=12000`, deploy `0a42c7d3` (commit `dbb3ad85`, 06/10, SUCCESS). Esse deploy já contém o PR #368 (painel do chat de guilda).

Contas: duas contas novas via `node tools/create_test_account.mjs --portal https://wyd-ten.vercel.app` (`POST /api/signup` → 201 nas duas), gravadas só no `.env` ignorado.

## Cache e tela de carregamento com o pacote real

### Alterações

`tools/verify_asset_cache.mjs`:
- nos casos `real-*`, um `MutationObserver` injetado por `addInitScript` registra cada mudança de `#loader` (etapa, `aria-valuenow`, detalhe, `hidden`);
- `checkLoader` exige:
  - barra sempre crescente;
  - camada escondida depois do boot;
  - no acesso frio: "Baixando dados do jogo…", 100% e "Guardando os dados no navegador…", com o total mostrado igual ao tamanho real do `.data` (±1 MiB);
  - no acesso quente: "Abrindo os dados guardados no navegador…", sem a etapa de download, e o tempo dessa leitura medido;
- `--slow` acrescenta, só no Chromium, o caso `real-fast4g`: perfil novo e CDP `Network.emulateNetworkConditions` com o perfil "Fast 4G" do DevTools (9 Mbit/s, 60 ms) por 30 s. Depois a rede volta ao normal e o download termina. O check exige uma velocidade mostrada entre 0,5 e 1,6 MB/s.

### Confirmado em execução

`node tools/verify_asset_cache.mjs --real --slow`, exit 0, Chromium e Firefox, servidor local sem cache HTTP. JSON completo em [`2026-10-06-real-package.json`](2026-10-06-real-package.json).

| Caso | Chromium | Firefox |
|---|---|---|
| 9 casos de fixture (30/09) | ok | ok |
| `real-cold`: `.data` baixado | 319.802.941 B; camada some em 14,1 s; total mostrado 305 MB = 305 MiB reais | idem; some em 34,6 s |
| `real-warm`: do IndexedDB | 0 B do `.data`; "Abrindo os dados guardados…" por **10,8 s** | 0 B; **19,7 s** |
| `real-restart` (navegador reaberto) | 0 B; 10,0 s de leitura | 0 B; 18,9 s |
| `real-fast4g` | 44 amostras na janela: "28 / 305 MB · 1,1 MB/s · ~5 min"; depois 100% e "Guardando…" | não executado (CDP só no Chromium) |

Etapas vistas no acesso frio: "Verificando acesso…", "Baixando o jogo…", "Baixando dados do jogo…" e "Guardando os dados no navegador…". No quente: "Verificando acesso…", "Baixando o jogo…" e "Abrindo os dados guardados no navegador…".

### Achados

- **Leitura do cache sem progresso (confirmado em execução):** no acesso quente, a camada fica 10–20 s em "Abrindo os dados guardados no navegador…" com a barra indeterminada. É mais tempo do que o próprio download local (2–3 s). A fonte do `file_packager.py` 6.0.0 já indicava que essa leitura não informa progresso. Numa máquina lenta, isso pode parecer travado. Possível melhoria, não feita: texto de tempo decorrido nessa etapa.
- O total mostrado em MB é MiB (`client.js`, `MIB = 1048576`) e bate com o arquivo.
- Em "Fast 4G", 305 MiB levariam ~5 min, como a tela informa.

### Limites

- Servidor local, sem gateway, S3 nem TLS. O caso do domínio público continua com o operador.
- Rede lenta só no Chromium; Firefox não tem CDP de rede no Playwright.
- Safari não testado.

## Painel de configurações online (fase `settings`)

### Confirmado em fonte (upstream fixado)

- A música de zona toca num `<audio>` da camada compat: `Module.wydMusic` (`win32_emscripten_stubs.cpp`, `WydWebMusicSetVolume`), com `audio.volume = 10^(cB/2000)` e 0 para -10000. O roteiro de 02/10 citava esse objeto, que não existe neste repositório e vem do upstream.
- O nível n de música vira `30*n-3000` cB (patch 0023). O `DirShow.cpp` do patch força -10000 quando chega ≤ -3000. Sem isso, a troca de zona com o nível 0 tocaria a -30 dB, audível.
- Exports usados só para **ler**: `wyd_audio_get_level`, `wyd_audio_get_music_volume`, `wyd_audio_music_play_calls`, `wyd_audio_music_state`, `wyd_input_mouse_x/y`. Os níveis foram mudados só pelo painel da página.

### Alterações

- `tools/verify_world.mjs`:
  - fase `settings` e `Session.reload()`, que recarrega no mesmo contexto do navegador, preservando o `localStorage` como para um jogador;
  - Chromium com `--autoplay-policy=no-user-gesture-required` só nessa fase;
  - prazo de 25 min.
- `tools/world_checks.mjs`:
  - `checkSettings`, `musicCentibels` e `musicElementVolume`;
  - a fase roda só com `login,[create,]enter`.
- `tools/world_checks.test.mjs`: um teste novo, com casos que devem reprovar:
  - -30 dB audível na troca de zona;
  - troca de zona sem música nova;
  - níveis não restaurados no relogin;
  - ponteiro deslocado;
  - "ampliar" ausente ou que não amplia.

### Confirmado em execução (Railway, deploy `dbb3ad85`)

Três execuções de `node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases …`:

| Execução | Fases | Resultado |
|---|---|---|
| `2026-10-06T12-00-58` | `login,create,enter,settings` | ok com a regra antiga; o "ampliar" não aumentou (ver Achados) |
| `2026-10-06T12-18-52` | `login,enter,settings` | encerrada pelo Claude Code no meio da `settings`, por falta de memória no sistema (issue #6) |
| **`2026-10-06T12-27-17`** | `login,enter,settings` | **ok com a regra atual**: a fase levou 16,8 min; Docker e Chrome fechados pelo usuário, com 1,6–2,1 GB livres e o navegador do teste em 1,25 GB |

A tabela e o JSON sanitizado [`2026-10-06-settings-online.json`](2026-10-06-settings-online.json) são da execução de 12-27-17, com contas e personagem mascarados. O protocolo ficou limpo (`inDropUnknown 0`, nada descartado). As capturas ficam em `.cache/world/` e não foram publicadas.

| Passo | Medido |
|---|---|
| Inicial (sem preferência) | música 0 e efeitos 20, vindos do `Config.bin` do operador; `town01.mp3` tocando com `volume` 0 |
| Sliders 50/40 pelo painel | nível 50 → -1500 cB → `audio.volume` 0,1778; efeitos 40 |
| Mudo (música) | nível 0, -10000 cB, `volume` 0, botão `aria-pressed=true` |
| Portal Armia → Armia Field, mudo | teleporte; `play_calls` 2→3, faixa `town01.mp3` → `field02.mp3`; **-10000 cB, `volume` 0** |
| Preferência 35, efeitos mudos → recarregar no mesmo perfil | antes de entrar: música 35, efeitos 0; no Field: -1950 cB, `volume` 0,1059 |
| 1024×768 pelo painel | aviso "sairá do servidor"; recarga, relogin e Field; canvas exibido 1:1; ponteiro (256,192) (512,384) (819,537) para (256,192) (512,384) (819,538); clique no chão andou 4 tiles; HUD conferido na captura |
| 1280×1024 pelo painel (janela 1400×1200) | idem; exibido 1036×829, porque o `max-width: 100%` do `client.css` reduz o canvas ao lado do chat; ponteiro com erro ≤ 1 px; andou 6 tiles; HUD conferido |
| "Ampliar", 1280×1024, janela 1900×1300 | **exibido 1467×1174** (proporção 1,250); ponteiro (320,256) (640,512) (1024,716) para (320,256) (640,512) (1024,717); andou 3 tiles; HUD ampliado conferido na captura |

### Achados

- **Música desligada por padrão (confirmado em execução):** o `Config.bin` do dataset do operador traz música 0. Sem preferência salva, o jogador entra sem música, e o elemento toca com volume 0. Decisão do operador: manter, ou definir um padrão da página (por exemplo, 50) quando não houver preferência.
- **O canvas maior que a janela já é reduzido sem o "ampliar" (confirmado em execução):** o `client.css` aplica `max-width: 100%`, e o "ampliar" só muda algo quando há espaço para crescer. Na 1ª execução, em 1400×1200, os dois modos ficaram iguais (1036×829) e o check passou sem provar a ampliação. O check foi endurecido: agora exige tamanho exibido maior que o canvas e a mesma proporção, e a fase mede o "ampliar" em 1900×1300.

### Não executado / limites

- O áudio foi medido pelo ganho do elemento, não ouvido; em headless não há saída de som. Efeitos sonoros: só o nível (`wyd_audio_get_level(0)`), não o volume de um som tocando.
- Uma execução aprovada com a regra atual, só no Chromium. Safari, Firefox online e o domínio público não foram testados.

## Próximo passo

1. Operador: decidir o padrão de música quando o `Config.bin` traz 0.
2. Avaliar mostrar o tempo decorrido em "Abrindo os dados guardados no navegador…".
3. Operador, no domínio público: primeiro acesso e reabertura pelo portal, e o painel com áudio ouvido.
