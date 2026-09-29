# Evidências da etapa 8 — imagem de deploy e CI (29/09/2026)

Estado: **preparação verificada localmente; nenhum deploy no Railway e nenhuma execução da CI remota.** Decisões na [ADR 005](../../decisions/005-railway-deploy-and-ci.md); guia em [deploy.md](../../deploy.md).

## Build da imagem (Docker 29.8.0, Windows 11, Docker Desktop linux/amd64)

```powershell
docker build --build-arg BUILD_JOBS=4 -t wyd-webclient:local .
```

- **Primeira tentativa: exit 2.** Os 115 objetos compilaram (`ok=115 failed=0`), mas `contract_unchanged=false certified=false`, com a mensagem "source or toolchain contract changed while compilation was in progress".
  - **Causa:** a identidade do compilador inclui a saída de `em++ --version`, e uma toolchain nova imprime nela as mensagens de primeiro uso e geração de cache.
  - É o mesmo "retornou 2 na primeira compilação" registrado no Windows em 28/09 ([setup](../../setup.md)), antes tratado como hipótese.
- **Correção:** aquecer a toolchain (`em++ --version` e uma compilação/link triviais) no mesmo `RUN` do build.
- **Confirmado em execução com cache frio** (id de cache novo):
  - `ok=115 failed=0`, `contract_unchanged=true certified=true`;
  - link `returncode=0 undefined_total=0`;
  - `tmproject_startup.1790698763802704410.wasm` com 1.916.659 bytes.

  É a primeira compilação Linux do runtime com os patches deste repositório.
- **Bases fixadas por digest** (ver [dependências](../../dependencies.md)). A imagem final tem 19.084.709 bytes (distroless + gateway + site, sem dados do jogo).

## Smoke do contêiner (mesmos passos do job `image` da CI)

Credencial aleatória descartável; destino `127.0.0.1:9`, inalcançável de propósito.

| Verificação | Resultado |
|---|---|
| `GET /healthz` | `ok` |
| `GET /client.html` sem credencial | 401 |
| `GET /client.html` com credencial | 200 |
| `.wasm` citado no `runtime.js` | 200, `application/wasm`, 1.916.659 bytes |
| `GET /config.json` | `{"channel":"server","wsUrl":"wss://wyd.ci.invalid/ws/server","clientVersion":12000}`, sem o destino |
| `GET /openwyd_assets.data` sem Volume | 404 (nenhum dado do jogo na imagem) |
| Com `.cache/deploy-assets` montado em `/data/assets:ro` | `openwyd_assets.data` 200, `application/octet-stream`, 319.802.941 bytes; `music/*` 200 |
| Senha nos logs do contêiner | ausente |

Os assets do Volume vieram de `python tools/pack_deploy_assets.py`: 15 arquivos, 346.597.791 bytes, manifesto `f4c03289374bd614`. Eles ficaram só em `.cache/`, fora do Git e da imagem.

## Testes

- `npm run gateway:test`: vet e testes verdes, incluindo `TestFromEnv*`, `TestTLSProxyValidation`, `TestBasicAuthGuardsEverythingButHealth`, `TestAssetDirFallback` e `TestRemoteIPBehindProxy`. Sem `-race` localmente (não há gcc); a CI roda com `-race`.
- `python tools/protocol/run_dialect_test.py` (429) e reprodutibilidade de `gen_vectors`/`gen_fixtures`: sem diferença além dos fixtures de combate novos.

## Não verificado

- **Jogo pela imagem:** login pelo contêiner e navegador exigem `wss://`, e não há TLS local. O jogo local continua via `make dev`.
- **No primeiro deploy:** reenvio da credencial Basic no WebSocket, `X-Forwarded-For` do Railway, leitura do Volume pelo uid `nonroot`, porta interna do tm-server e upload com `railway volume files upload`.
- **CI no GitHub:** o workflow foi escrito, mas só roda depois do push.

## Bucket e serviço no Railway (29/09/2026, mesma data)

- **Projeto `wyd-client-web` / serviço `w2pp-OpenWyd-WebClient`,** já existente e ligado ao repositório:
  - domínio gerado: `https://w2pp-openwyd-webclient-production.up.railway.app`, na porta 8080;
  - 14 variáveis definidas com `--skip-deploys`; os segredos passaram por stdin e nenhum valor foi impresso.
- **Upload** (`tools/upload_assets_s3.py --railway-bucket arranged-orb`): 16 objetos, 346.600.204 bytes em `assets-f4c03289374bd614/`, todos verificados por `HEAD`. O `railway bucket info` confirma 16 objetos e 346,6 MB.
- **Gateway contra o bucket real, localmente** (imagem `sha256:94b4e1c5…`, credenciais num env-file temporário apagado em seguida):

  | Verificação | Resultado |
  |---|---|
  | `openwyd_assets.js` | 200, `text/javascript` |
  | Range `bytes=0-99` | 206, 100 bytes |
  | objeto ausente | 404 |
  | sem senha | 401 |
  | `openwyd_assets.data` completo | SHA-256 igual ao do manifesto, em 95 s |
  | segredos nos logs | ausentes |

- **Primeiro deploy do `main` (`0296e48`): FAILED.** O builder do Railway disse: "dockerfile invalid: flag '--mount=type=cache,id=wyd-emsdk-cache,…' is missing the cacheKey prefix from its id". O Railway **usou o Dockerfile**; o `RAILPACK` no manifesto do deployment é só o valor salvo nas configurações do serviço. Correção: remover o cache mount (ver ADR 005, revisão).

## Deploy verificado no Railway (29/09/2026, branch `Jean1dev/railway-bucket`, `railway up`)

- **Build no builder do Railway, pelo Dockerfile:**
  - 115 objetos, `contract_unchanged=true certified=true`, link com `undefined_total=0`;
  - imagem `sha256:79d54fb5defe95fae06aa0ba08d12670d32794f741e55b5d0808048fd0311a88`; "Deploy complete".
- **Pelo domínio público** `https://w2pp-openwyd-webclient-production.up.railway.app`:

  | Verificação | Resultado |
  |---|---|
  | `/healthz` | `ok` |
  | página sem senha / senha errada / com senha | 401 / 401 / 200 |
  | `/config.json` | `wss://<domínio>/ws/server`, `clientVersion` 12000, `assetManifestVersion` `f4c03289374bd614`, sem o destino TCP |
  | `.wasm` | 200 `application/wasm`, 1.916.659 bytes |
  | `openwyd_assets.js` (bucket) | 200 `text/javascript`, 522.188 bytes |
  | `openwyd_assets.data` com Range | 206, 1.024 bytes |
  | `music/login.mp3` | 200 |
  | dados sem senha | 401 |
  | WebSocket sem senha / origem errada / correto | 401 / 403 / 101 (log: `origin rejected`, `relay open`, `relay closed`) |

- **Navegador real (Chromium headless, Playwright 1.54.2)** com a credencial Basic e a conta de teste A:
  - página carregada, 320 MB baixados do bucket via gateway;
  - runtime na seleção de servidor em 64 s;
  - login real no tm-server (`0x10A`) e "Select Character" em 71 s;
  - WebSocket aberto na mesma origem, com a credencial reenviada pelo navegador (a abertura sem ela daria 401);
  - dialeto sem descartes; 0 erros GL; 0 erros de página;
  - captura local `.cache/suite/deploy-selchar.png`: seleção texturizada, personagens da conta e teclado de PIN.

  Com isso, dois pontos antes "a confirmar" estão **confirmados em execução**: o reenvio da credencial no WebSocket e o acesso ao tm-server pelo proxy TCP a partir de outro projeto.
- **Ainda não confirmado:** o `X-Forwarded-For` do Railway como IP real, que exige duas origens distintas.
