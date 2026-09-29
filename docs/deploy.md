# Deploy no Railway

Estado em 29/09/2026: **serviço configurado e assets no bucket; o primeiro deploy do `main` falhou no Dockerfile** (cache mount recusado pelo builder do Railway, corrigido no PR seguinte). Decisões do operador: assets num **bucket** privado (mudança de 29/09; o Volume segue como alternativa), acesso por senha e WASM compilado no build da imagem ([ADR 005](decisions/005-railway-deploy-and-ci.md)).

## Ambiente atual

| Item | Valor |
|---|---|
| Projeto / ambiente | `wyd-client-web` / `production` |
| Serviço | `w2pp-OpenWyd-WebClient` (repositório, deploy automático do `main`, builder Dockerfile via `railway.json`) |
| Domínio | `https://w2pp-openwyd-webclient-production.up.railway.app` (porta 8080) |
| Bucket | `arranged-orb` (região `iad`), prefixo `assets-f4c03289374bd614`, 16 objetos, 346.600.204 bytes, verificados por `HEAD` |
| tm-server | projeto `wyd`; como a rede privada não atravessa projetos, o acesso é pelo proxy TCP público `reseau.proxy.rlwy.net:56950` |

## O que roda

Um único serviço, `wydgateway -env`, na imagem do `Dockerfile` da raiz:

| Rota | Conteúdo | Origem |
|---|---|---|
| `/healthz` | `ok` (sem autenticação, para o healthcheck) | gateway |
| `/`, `/client.html`, `runtime.js`, `tmproject_startup.<id>.wasm` | página e runtime | imagem (`/srv/site`), compilados do upstream no SHA do lock + `patches/openwyd` |
| `openwyd_assets.data/.js`, `music/*`, `manifest.json` | dados do jogo do operador | bucket privado: o gateway assina um `GET` (SigV4) por requisição e repassa em streaming, com `Range`/206/304. O navegador nunca vê o bucket nem as credenciais |
| `/config.json` | canal, `wss://…/ws/<canal>`, `clientVersion` | gateway; o destino TCP não aparece |
| `/ws/<canal>` | relé binário WebSocket ↔ TCP do tm-server | gateway; destino só por variável |

Todas as rotas, exceto `/healthz`, exigem a credencial Basic, inclusive a abertura do WebSocket e os assets. Arquivos da imagem têm precedência, então o bucket não consegue sombrear `runtime.js`.

## Variáveis do serviço (definidas em 29/09)

| Variável | Valor | Observação |
|---|---|---|
| `PORT` | `8080` | mesma porta do domínio |
| `WYD_PUBLIC_ORIGIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | resolve para o domínio acima |
| `WYD_TARGET` | `reseau.proxy.rlwy.net:56950` | proxy TCP do tm-server (outro projeto) |
| `WYD_CLIENT_VERSION` | `12000` | `W2PP_CLIENT_VERSION` do tm-server, não o build 7662 |
| `WYD_BASIC_AUTH_USER` | `wyd` | |
| `WYD_BASIC_AUTH_PASSWORD` | secreta (24 caracteres) | gerada aleatoriamente; cópia só no `.env` local (`W2PP_DEPLOY_BASIC_AUTH_PASSWORD`), ignorado pelo Git |
| `WYD_ASSET_S3_ENDPOINT` | `https://t3.storageapi.dev` | `railway bucket credentials` |
| `WYD_ASSET_S3_REGION` | `auto` | |
| `WYD_ASSET_S3_URL_STYLE` | `virtual-host` | |
| `WYD_ASSET_S3_BUCKET` | nome interno do bucket | |
| `WYD_ASSET_S3_ACCESS_KEY_ID`, `WYD_ASSET_S3_SECRET_ACCESS_KEY` | secretas | definidas por stdin a partir da CLI; se forem rotacionadas (`--reset`), redefina-as |
| `WYD_ASSET_S3_PREFIX`, `WYD_ASSET_MANIFEST` | `assets-f4c03289374bd614`, `f4c03289374bd614` | versão ativa dos assets |

Opcionais: `WYD_CHANNEL`, `WYD_MAX_CONNS` e `WYD_MAX_CONNS_PER_IP`. `WYD_ALLOW_PUBLIC=true` é o único jeito de subir sem senha; não use enquanto a licença dos assets não estiver resolvida. Com dados faltando ou inválidos, o gateway recusa iniciar e lista o problema, sem nunca incluir segredos na mensagem.

## Atualizar os assets

```powershell
python tools/build_local_scene.py        # empacota assets-local/runtime (setup)
python tools/pack_deploy_assets.py       # .cache/deploy-assets + manifest.json (hashes, versão)
npx -y @railway/cli@5.63.1 link -p <projeto> -e production
python tools/upload_assets_s3.py --railway-bucket arranged-orb   # PUT + verificação HEAD; credenciais só em memória
```

Depois aponte `WYD_ASSET_S3_PREFIX`/`WYD_ASSET_MANIFEST` para a nova versão. O upload de 29/09 levou cerca de 10 minutos. O script pula objetos já presentes com o mesmo tamanho.

## Verificação

```text
GET /healthz                       -> 200 ok
GET /client.html (sem credencial)  -> 401
GET /config.json (com credencial)  -> wsUrl wss://<domínio>/ws/server, sem host do tm-server
GET /openwyd_assets.data           -> 200, application/octet-stream; Range -> 206
```

Localmente, contra o bucket real (29/09): `.js` 200, Range 206, ausente 404, sem senha 401, e o `.data` de 320 MB chegou pelo gateway com o SHA-256 do manifesto ([evidências](evidence/08-entrega/README.md)).

**A confirmar no primeiro deploy bem-sucedido:**
- o reenvio da credencial Basic na abertura do WebSocket de mesma origem;
- que o `X-Forwarded-For` do Railway traz o IP do cliente como última entrada;
- o login real pelo domínio.

## Rollback

- **Página e runtime:** redeploy de um deployment anterior no Railway. Página, `runtime.js` e `.wasm` saem sempre da mesma imagem.
- **Assets:** cada versão fica num prefixo `assets-<manifest>/`. Voltar é repor o `WYD_ASSET_S3_PREFIX` anterior. Apague um prefixo antigo só depois de validar o novo.
- **Compatibilidade:** o loader `openwyd_assets.js` é gerado pelo `file_packager` do emscripten 6.0.0, a mesma versão da imagem. Trocar o emsdk exige reempacotar os assets.

## Alternativa: Volume

Em vez de `WYD_ASSET_S3_*`, monte um Volume (por exemplo em `/data`) e defina `WYD_ASSET_DIR=/data/assets-<versão>`. Envie os arquivos com `railway volume files upload .cache/deploy-assets /assets-<versão> --volume <volume>`, comando não executado. Com Volume, o serviço fica limitado a uma réplica. Se o uid `nonroot` não conseguir ler os arquivos, use `RAILWAY_RUN_UID=0`.

## CI

A CI (`.github/workflows/ci.yml`) faz:
- gateway com `-race`, incluindo o vetor SigV4 da AWS e um S3 falso;
- reprodutibilidade dos vetores e fixtures;
- vetores contra o codec Go do servidor fixado;
- dialeto em wasm32;
- build completo da imagem com smoke sem assets.

Ela não cobre a cena com assets, o bucket real nem o jogo online, porque dependem de dados e credenciais privados. Isso roda localmente (ver [setup](setup.md)).
