# Relato do jogador: download a cada acesso e mudo dos efeitos (09/10/2026)

## Relato

O jogador mandou um vídeo de 30,6 s (Screenity, 1920×862, fora do Git) e escreveu que "o botão do mudo não está funcionando" e que "o cliente está baixando todas as vezes que entro pelo link".

## Vídeo

Decodificado com o Chrome headless (Playwright 1.54.2, `channel: chrome`), porque esta máquina não tem ffmpeg.

- **Quadros (confirmado no vídeo):**
  - Field, mapa 16,16, em combate;
  - painel de configurações aberto, com Música e Efeitos em "mudo" e os dois botões pressionados;
  - Screenity gravando com o microfone ligado.
- **Áudio (medido):**
  - 48 kHz, dois canais idênticos (L = R, sinal mono);
  - cerca de −20 dBFS durante o combate.
  - A música do jogo é estéreo e não aparece, o que é compatível com o mudo da música funcionando.
- **Origem do som:**
  - o usuário ouviu o vídeo e reconheceu efeitos do jogo;
  - a correlação cruzada normalizada (8 kHz) contra os 350 WAVs do dataset não encontrou correspondência forte: máximo 0,51 (`menu9.wav`), sem repetições acima de 0,5;
  - sem um caso positivo para calibrar o método, isso não prova a origem. É compatível com som captado pelo microfone a partir das caixas de som (hipótese).

## Download a cada acesso

**Causa (confirmado em execução):**
- a produção usava `WYD_ASSET_MANIFEST=f4c03289374bd614`, o pacote de 29/09;
- o loader desse prefixo (522.188 bytes, lido do bucket) não tem `WYD_PRELOAD_CACHE`;
- o cache em IndexedDB de 30/09 (`a457267b6cd82874`) nunca tinha sido publicado.

**Pacote:**
- o `.data` local de 08/10 diferia do publicado só no `Config.bin` (música 0 desde o contorno de 01/10, contra 20 no publicado), conferido arquivo por arquivo contra o `.data` de produção;
- reempacotado numa cópia de `assets-local/runtime`, com o `Config.bin` publicado:
  - `.data` `3dad5977…`, idêntico ao de produção;
  - loader `da733c1d…`, o mesmo de 30/09;
  - manifesto `a457267b6cd82874`.

**Publicação (com aprovação do usuário):**
- `upload_assets_s3.py`: 16 objetos e 346.607.659 bytes em `assets-a457267b6cd82874/`, todos verificados por `HEAD`;
- variáveis `WYD_ASSET_S3_PREFIX` e `WYD_ASSET_MANIFEST` trocadas;
- deploy `5669ce6f` em SUCCESS;
- o prefixo anterior fica no bucket para rollback.

**Verificação no domínio público**, entrando pelo link do portal (`/jogar`) com a conta de teste B, em dois acessos no mesmo perfil:

| Navegador | 1º acesso | 2º acesso |
|---|---|---|
| Chromium 139 | `.data` 200, 319.802.941 bytes; `fromCache: false`; 59 s | nenhuma requisição do `.data`; `fromCache: true`; 13 s |
| Firefox 140 | `.data` 200; `fromCache: false`; 69 s | nenhuma requisição do `.data`; `fromCache: true`; 24 s |

O loader veio com `Cache-Control: private, no-cache`. Todo jogador baixa o pacote uma última vez depois da troca.

## Mudo dos efeitos

Nova fase `audio` em `tools/verify_world.mjs`, com a regra `checkAudio` em `tools/world_checks.mjs`.

**Como mede:**
- registra cada `AudioBufferSourceNode.start` com o ganho do nó ligado ao `destination` e a pilha de quem chamou;
- conta como audível qualquer som iniciado com ganho > 0;
- usa só o painel da página, com clique e slider.

**Ambiente:** runtime local `tmproject_startup.1791462973030210400.wasm`, do upstream `beb9f69` com os patches 0001–0030. É a mesma fonte do build de produção (`apply_openwyd_patches.py --check`). tm-server do Railway (`reseau.proxy.rlwy.net:56950`), conta A.

**Resultados (confirmado em execução):**

| Janela | Plays | Audíveis | Efeitos |
|---|---|---|---|
| andando na cidade, sem mudo | 9–139 | todos (ganho 0,316 = −1000 cB, nível 60) | 60 |
| luta com Gremlin, sem mudo | 7–18 | todos | 60 |
| andando, mudo | 0 | 0 | 0 |
| luta, mudo | 0 | 0 | 0 |
| andando, mudo salvo desde o boot | 0 | 0 | 0 |
| luta, mudo salvo desde o boot | 0 | 0 | 0 |
| luta depois de desmutar | 17 | 17 | 60 |

Na cidade, os sons vieram do ambiente do mapa (`TMFieldScene::FrameMove` → `CSound::Play`).

**Conclusão:** não reproduzido. Com o mudo, o runtime não inicia nenhum efeito: `CSoundManager::GetSoundData` devolve `nullptr` em −10000. Nenhum código mudou no jogo.

**Também:**
- na página de produção, a conta B (sem personagem) não toca efeitos na seleção de personagem, então o teste ali não prova nada;
- o runtime publicado não foi medido no Field.

## Execuções

- `npm run world:checks`: 43/43.
- `node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,audio`:
  - 12-14-20: só a cidade, ok;
  - 12-38-37: prazo de 15 min estourado depois de "luta, mudo"; o prazo passou para 25 min;
  - 12-53-56: sem Gremlin depois do relogin (o personagem volta para a cidade); o trajeto foi adicionado;
  - 13-08-18: **ok**, com todas as janelas da tabela.

## Limites e próximo passo

- **Não verificado:** o mudo no runtime publicado dentro do Field; Safari; o perfil do jogador.
- **Pedir ao jogador:**
  - se havia outra aba ou o cliente Windows aberto;
  - se o som saía pelas caixas (o Screenity grava o microfone);
  - uma gravação com o microfone do Screenity desligado e o áudio da aba ligado.
