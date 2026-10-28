# Issue #42: música do login duplicada no jogo (27/10/2026)

## Relato

"Ao logar, a música da tela de login continua no fundo durante toda a gameplay; ficam tocando duas trilhas sonoras enquanto jogamos."

## Causa (confirmado em fonte e em execução)

O BGM web é um `HTMLAudioElement` criado por `WydWebMusicPlayPath`, em `webclient/client-wasm/compat/src/win32_emscripten_stubs.cpp` do upstream `beb9f69`:

- **Ouvintes de gesto sempre registrados.** A cada faixa, a função registrava `audio.play()` em `pointerdown` e `keydown` do `document`, com `once`, mesmo quando o autoplay tinha funcionado. Esses ouvintes não eram removidos na troca de faixa nem no `StopBGM`.
- **Faixa antiga carregada.** A faixa substituída recebia só `pause()` e `removeAttribute('src')`. O recurso já carregado continua no elemento, então um `play()` posterior volta a tocá-lo.
- **Login sem gesto.** O login automático do portal e o login do harness não têm gesto. O primeiro clique ou tecla no Field dispara o ouvinte pendente da `login.mp3`, que volta a tocar sob a música do mapa.
- **Fora do alcance do jogo.** Nenhum código guarda mais referência à `login.mp3`, então o mudo e as trocas de zona não a alcançam.

## Medição

Fase nova `music` em `tools/verify_world.mjs`, com a regra `checkSingleMusic` em `tools/world_checks.mjs`:

- **Rastreio:** um init script envolve `window.Audio` e guarda cada elemento de música criado pela página.
- **Política de autoplay:** a padrão do Chromium, sem `--autoplay-policy`, como para um jogador.
- **Janelas:** em cada uma, a conta A clica no chão e aperta Ctrl; depois de 2 s, a fase lista os elementos com `paused === false`.
- **Volume:** música no nível 50, pelo painel da página.

**Ambiente:**
- tm-server do Railway (`reseau.proxy.rlwy.net:56950`), `ClientVersion` 12000;
- conta A;
- Playwright 1.54.2 (Chromium).

### Antes (runtime com 0001–0032; run `2026-10-27T12-41-45-567Z`)

| Janela | Elementos criados | Tocando (volume) |
|---|---|---|
| primeira entrada | 2 | `login.mp3` substituída (0), `town01.mp3` atual (0,178) |
| relogin no mesmo perfil | 2 | `login.mp3` substituída (0,178), `town01.mp3` atual (0,178) |
| troca de zona (Armia → Armia Field) | 3 | `login.mp3` substituída (0,178), `field02.mp3` atual (0,178) |

- **Primeira entrada:** a `login.mp3` estava a volume 0, porque o `Config.bin` local tem música 0. O nível 50 foi aplicado só à faixa atual.
- **Relogin:** com o nível 50 salvo desde o boot, a faixa do login toca no mesmo volume da música do mapa. É o relato da issue.

### Depois (runtime com 0001–0033, `tmproject_startup.1793105373617881500`; run `2026-10-27T12-50-59-050Z`)

| Janela | Elementos criados | Tocando (volume) |
|---|---|---|
| primeira entrada | 2 | `town01.mp3` atual (0,178) |
| relogin no mesmo perfil | 2 | `town01.mp3` atual (0,178) |
| troca de zona | 3 | `field02.mp3` atual (0,178) |

## Correção

`patches/openwyd/0033-music-single-track.patch` muda só o bloco EM_JS de música:

- **Gesto só quando necessário:** o reenvio por gesto só é registrado quando `audio.play()` é rejeitado (autoplay bloqueado). Ele toca apenas se a faixa ainda for a atual e não estiver parada.
- **Ouvintes removidos:** saem na troca de faixa e no `WydWebMusicStop`.
- **Faixa antiga descarregada:** recebe `load()` depois de perder o `src`.
- **Escopo:** `DirShow.cpp`, o protocolo e o build Windows não mudam.

## Limitações

- A fase `settings` (mudo na troca de zona, relogin e resoluções) começou com o runtime novo, mas o Claude Code a interrompeu por falta de memória na máquina. A fase `audio` não rodou. As duas ficam pendentes.
- Não testados: Firefox, Safari, cliente Windows e o domínio público (antes do deploy).
