# Deploy no Railway

Estado: **preparado, ainda não executado.** A imagem e a CI existem. Nenhum serviço foi criado nem publicado no Railway por esta entrega. Decisões do operador em 29/09/2026: assets num Volume, acesso protegido por senha e WASM compilado no build da imagem.

## O que roda

Um único serviço, `wydgateway -env`, na imagem do `Dockerfile` da raiz:

| Rota | Conteúdo | Origem |
|---|---|---|
| `/healthz` | `ok` (sem autenticação, para o healthcheck) | gateway |
| `/`, `/client.html`, `runtime.js`, `tmproject_startup.<id>.wasm` | página e runtime | imagem (`/srv/site`), compilados do upstream no SHA do lock + `patches/openwyd` |
| `openwyd_assets.data/.js`, `music/*`, `manifest.json` | dados do jogo do operador | Volume (`WYD_ASSET_DIR`); **nunca** na imagem ou no Git |
| `/config.json` | canal, `wss://…/ws/<canal>`, `clientVersion` | gateway; o destino TCP não aparece |
| `/ws/<canal>` | relé binário WebSocket ↔ TCP do tm-server | gateway; destino só por variável |

Com `WYD_BASIC_AUTH_*`, todas as rotas exceto `/healthz` exigem a credencial, inclusive a abertura do WebSocket. O TLS termina na borda do Railway, e o gateway (`tlsTerminatedByProxy`) só aceita origem `https://` e URL `wss://`.

## Variáveis do serviço

| Variável | Exemplo | Observação |
|---|---|---|
| `PORT` | definida pelo Railway | não definir manualmente |
| `WYD_PUBLIC_ORIGIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | origem exata do navegador |
| `WYD_TARGET` | `tm-server.railway.internal:<porta interna>` | host:porta do tm-server pela rede privada do projeto. **Confirme a porta** nas variáveis do tm-server; o proxy TCP público (`reseau.proxy.rlwy.net:56950`) funciona como alternativa |
| `WYD_CLIENT_VERSION` | `12000` | valor efetivo do tm-server (`W2PP_CLIENT_VERSION`), não o build 7662 |
| `WYD_BASIC_AUTH_USER` | `operador` | sem `:` |
| `WYD_BASIC_AUTH_PASSWORD` | variável secreta | no mínimo 12 caracteres; nunca em arquivo versionado |
| `WYD_ASSET_DIR` | `/data/assets-f4c03289374bd614` | diretório **versionado** dentro do Volume (ver rollback) |
| `WYD_ASSET_MANIFEST` | `f4c03289374bd614` | opcional; exposto em `/config.json` |
| `WYD_CHANNEL`, `WYD_MAX_CONNS`, `WYD_MAX_CONNS_PER_IP` | `server`, `256`, `4` | opcionais |
| `WYD_ALLOW_PUBLIC` | — | só `true` permite subir **sem** senha; não usar enquanto a licença dos assets não estiver resolvida |

Sem `WYD_TARGET`, origem, versão ou credencial, o gateway recusa iniciar com uma mensagem que lista o que falta. A mensagem nunca inclui a senha.

## Primeiro deploy

1. **Serviço:** crie um serviço a partir deste repositório. O `railway.json` seleciona o `Dockerfile` e o healthcheck `/healthz`. O build compila os 115 objetos do runtime e leva alguns minutos.
2. **Domínio e variáveis:** gere um domínio público para o serviço e defina as variáveis acima.
3. **Volume:** crie e anexe o Volume em `/data`:
   ```powershell
   npx -y @railway/cli@5.63.1 volume add --service <servico-web> --mount-path /data
   ```
4. **Assets, empacotados localmente** a partir dos dados do operador:
   ```powershell
   python tools/build_local_scene.py            # empacota assets-local/runtime (já feito no setup)
   python tools/pack_deploy_assets.py           # .cache/deploy-assets + manifest.json (hashes)
   ```
5. **Upload para um diretório versionado:**
   ```powershell
   npx -y @railway/cli@5.63.1 volume files upload .cache/deploy-assets /assets-<version> --volume <volume>
   npx -y @railway/cli@5.63.1 volume files list /assets-<version> --volume <volume> --json
   ```
   Confira se `openwyd_assets.data`, `openwyd_assets.js`, `music/` e `manifest.json` estão direto sob `/assets-<version>`. O comando e o formato vêm da ajuda da CLI 5.63.1 e **não foram executados** nesta entrega.
6. **Diretório ativo:** aponte `WYD_ASSET_DIR=/data/assets-<version>` e faça redeploy.

**Permissão:** a imagem roda como `nonroot` (uid 65532). Se os arquivos do Volume não puderem ser lidos (404/403 com os arquivos presentes), defina `RAILWAY_RUN_UID=0` no serviço. **Hipótese:** o dono dos arquivos enviados pela CLI não foi verificado.

## Verificação depois do deploy

```text
GET /healthz                       -> 200 ok
GET /client.html (sem credencial)  -> 401
GET /config.json (com credencial)  -> wsUrl wss://<domínio>/ws/server, sem host do tm-server
GET /openwyd_assets.data           -> 200, Content-Type application/octet-stream
```

Depois disso, faça login real com uma conta de teste pelo navegador. **A confirmar no primeiro deploy:**
- se o navegador reenvia a credencial Basic na abertura do WebSocket de mesma origem (Chrome e Firefox costumam reenviar);
- se o `X-Forwarded-For` do Railway traz o IP do cliente como última entrada, premissa do limite por IP no modo proxy.

## Rollback

- **Página e runtime:** use o redeploy de um deployment anterior no Railway. Página, `runtime.js` e `.wasm` estão sempre na mesma imagem e não se misturam.
- **Assets:** cada versão fica em `/data/assets-<version>`. Voltar é repor o `WYD_ASSET_DIR` anterior e redeployar. Apague uma versão antiga só depois de validar a nova. O `manifest.json` de cada diretório registra os hashes.
- **Compatibilidade:** o loader `openwyd_assets.js` é gerado pelo `file_packager` do emscripten 6.0.0, a mesma versão da imagem. Trocar a versão do emsdk exige reempacotar os assets.

## O que a CI cobre e o que não cobre

A CI (`.github/workflows/ci.yml`) faz:
- gateway com `-race`;
- regras do harness;
- reprodutibilidade dos vetores e fixtures;
- vetores contra o codec Go do servidor fixado;
- teste do dialeto em wasm32;
- build completo da imagem, com smoke sem assets: healthz, 401, runtime, MIME do WASM, `/config.json` sem destino e ausência de `openwyd_assets.data`.

Ela **não** cobre a cena com assets nem o jogo online, porque os dados do jogo e as contas de teste são privados. Isso roda localmente com `npm run scene`, `npm run client:stream` e `npm run world` (ver [setup](setup.md)).
