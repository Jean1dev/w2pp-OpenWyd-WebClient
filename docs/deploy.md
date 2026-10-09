# Deploy no Railway

Estado em 29/09/2026: **no ar e verificado.** Deploy pela branch do PR #3 (`railway up`): build no Railway, assets do bucket e login real até a seleção de personagem pelo domínio público ([evidências](evidence/08-entrega/README.md)). O primeiro deploy do `main` tinha falhado por causa do cache mount no Dockerfile, corrigido no PR #3. Decisões do operador: assets num **bucket** privado (mudança de 29/09; o Volume segue como alternativa), acesso por senha e WASM compilado no build da imagem ([ADR 005](decisions/005-railway-deploy-and-ci.md)).

## Ambiente atual

| Item | Valor |
|---|---|
| Projeto / ambiente | `wyd-client-web` / `production` |
| Serviço | `w2pp-OpenWyd-WebClient` (repositório, deploy automático do `main`, builder Dockerfile via `railway.json`) |
| Domínio | `https://w2pp-openwyd-webclient-production.up.railway.app` (porta 8080) |
| Bucket | `arranged-orb` (região `iad`), prefixo `assets-a457267b6cd82874` desde 09/10 (cache do pacote ativo), 16 objetos, 346.607.659 bytes, verificados por `HEAD`; o prefixo anterior `assets-f4c03289374bd614` (sem cache) fica para rollback |
| tm-server | projeto `wyd`; como a rede privada não atravessa projetos, o acesso é pelo proxy TCP público `reseau.proxy.rlwy.net:56950` |

## O que roda

Um único serviço, `wydgateway -env`, na imagem do `Dockerfile` da raiz:

| Rota | Conteúdo | Origem |
|---|---|---|
| `/healthz` | `ok` (sem autenticação, para o healthcheck) | gateway |
| `/` (= `client.html`, cliente conectado), `runtime.js`, `tmproject_startup.<id>.wasm` | páginas e runtime | imagem (`/srv/site`), compilados do upstream no SHA do lock + `patches/openwyd`. Build público: sem `wyd_debug_*` e sem a cena offline `/local-scene.html` ([ADR 016](decisions/016-public-build-and-client-ip.md)) |
| `openwyd_assets.data/.js`, `music/*`, `manifest.json` | dados do jogo do operador | bucket privado: o gateway assina um `GET` (SigV4) por requisição e repassa em streaming, com `Range`/206/304. O navegador nunca vê o bucket nem as credenciais |
| `/config.json` | canal, `wss://…/ws/<canal>`, `clientVersion` | gateway; o destino TCP não aparece |
| `/ws/<canal>` | relé binário WebSocket ↔ TCP do tm-server | gateway; destino só por variável |
| `/chat/ws` | chat global da página, só em memória ([ADR 018](decisions/018-web-chat.md)) | gateway; nick vindo da sessão do portal |

Todas as rotas, exceto `/healthz`, exigem a credencial Basic, inclusive a abertura do WebSocket e os assets. Com o gate por conta do portal ([ADR 015](decisions/015-portal-account-gate.md)), a credencial Basic é substituída pelo cookie `wyd_play`, emitido em `POST /auth/portal`. Sem cookie, a navegação vai para `<portal>/jogar` e o resto recebe 401. Arquivos da imagem têm precedência, então o bucket não consegue sombrear `runtime.js`.

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
| `WYD_ASSET_S3_PREFIX`, `WYD_ASSET_MANIFEST` | `assets-a457267b6cd82874`, `a457267b6cd82874` (09/10) | versão ativa dos assets |

Gate por conta do portal ([ADR 015](decisions/015-portal-account-gate.md)), alternativa exclusiva ao Basic. **Ativo em produção desde 02/10** (deploy `82f3850`); `WYD_BASIC_AUTH_*` foram removidas:
- `WYD_PORTAL_URL`: origem do portal, por exemplo `https://wyd-ten.vercel.app`;
- `WYD_PORTAL_TICKET_SECRET`: ≥ 32 caracteres, o mesmo valor de `PLAY_TICKET_SECRET` no Vercel.

Ao ativar o gate, remova `WYD_BASIC_AUTH_*`; com as duas credenciais o gateway recusa iniciar. No portal, defina também `WEBCLIENT_URL` com o domínio deste serviço.

Login automático pela conta do portal ([ADR 017](decisions/017-portal-auto-login.md)): o gateway não precisa de variável nova. Ativação, nesta ordem:
1. servidor (`w2pp-OpenWYD`) com a migração 0026 e `W2PP_PLAY_CODE_SECRET` (≥ 32 bytes aleatórios) no `api-server`;
2. `PLAY_CODE_SECRET` com o mesmo valor no Vercel;
3. este serviço com o patch 0026.

Sem o segredo em qualquer lado, o jogo pede a senha como antes.

Limites e IP do cliente ([ADR 016](decisions/016-public-build-and-client-ip.md)): `WYD_MAX_CONNS_PER_IP=4` e `WYD_FORWARDED_FOR=first`, registradas em 02/10. O Railway põe o cliente na primeira entrada do `X-Forwarded-For`; o padrão `last` registrava o IP da borda.

Opcionais: `WYD_CHANNEL`, `WYD_MAX_CONNS`, `WYD_MAX_CONNS_PER_IP` e `WYD_CHAT_ENABLED` (`false` desliga o chat da página; o padrão é ligado). `WYD_ALLOW_PUBLIC=true` é o único jeito de subir sem senha; não use enquanto a licença dos assets não estiver resolvida. Com dados faltando ou inválidos, o gateway recusa iniciar e lista o problema, sem nunca incluir segredos na mensagem.

## Atualizar os assets

```powershell
python tools/build_local_scene.py        # empacota assets-local/runtime (setup)
python tools/pack_deploy_assets.py       # .cache/deploy-assets + manifest.json (hashes, versão)
npx -y @railway/cli@5.63.1 link -p <projeto> -e production
python tools/upload_assets_s3.py --railway-bucket arranged-orb   # PUT + verificação HEAD; credenciais só em memória
```

Depois aponte `WYD_ASSET_S3_PREFIX`/`WYD_ASSET_MANIFEST` para a nova versão. O upload de 29/09 levou cerca de 10 minutos. O script pula objetos já presentes com o mesmo tamanho.

### Cache local do pacote principal

O empacotamento habilita o cache nativo do Emscripten 6.0.0 em IndexedDB
(`WYD_PRELOAD_CACHE`). A primeira abertura baixa `openwyd_assets.data`; as próximas
reutilizam a cópia local, inclusive após fechar o navegador. O carregador contém
o SHA-256 do conteúdo: recompilar sem mudar o pacote mantém o cache; alterar o
conteúdo exige baixar o pacote inteiro novamente. O cache é por origem, perfil e
diretório da página. WASM e músicas não entram nesse cache.

`openwyd_assets.js` usa `Cache-Control: private, no-cache`, inclusive quando servido
do diretório local: o navegador revalida o carregador antes de escolher o pacote.
`config.json` e HTML continuam sem armazenamento HTTP. Credenciais não são
gravadas no IndexedDB. O jogo continua online e precisa montar os assets em memória.

Ativo em produção desde 09/10 (deploy `5669ce6f`, [evidência](evidence/07-web/2026-10-09-cache-and-mute.md)).
O `Config.bin` do `assets-local` local tem música 0 desde o contorno de 01/10; o publicado
mantém 20. Empacote com o `Config.bin` publicado, ou o `.data` muda e todos baixam de novo.

Para ativar no deploy, regenere os assets com os dois comandos Python acima,
publique **o par `.js`/`.data` e seu manifesto no mesmo prefixo novo**, e só então
troque a configuração. Não substitua arquivos individualmente no prefixo ativo.
Publique também a imagem com o gateway atualizado. `--page-only` não regenera um
carregador antigo; atualizar apenas a imagem não ativa o cache do pacote no bucket.

Se IndexedDB estiver indisponível ou a gravação falhar por quota, o carregador
continua pelo download normal. Limpar os dados do site ou a remoção automática pelo
navegador exige novo download; não há promessa de armazenamento permanente.
Para diagnóstico, `clientEvidence.assetPreload.fromCache` expõe o resultado do
carregador, sem dados de conta. Confirme também as requisições de rede.

Validação local, serial, sem login: `npm run assets:cache` testa fixtures pequenas
com o carregador real em Chromium e Firefox; `npm run assets:cache -- --real`
também abre `client.html` com o pacote local e o runtime real. Instale os browsers
do Playwright fixado antes (`npx playwright install chromium firefox`). Relatórios
e perfis exclusivos ficam em `.cache/asset-cache/`; não publique esses perfis ou assets.

## Verificação

```text
GET /healthz                       -> 200 ok
GET /client.html (sem credencial)  -> 401
GET /config.json (com credencial)  -> wsUrl wss://<domínio>/ws/server, sem host do tm-server
GET /openwyd_assets.data           -> 200, application/octet-stream; Range -> 206
```

Localmente, contra o bucket real (29/09): `.js` 200, Range 206, ausente 404, sem senha 401, e o `.data` de 320 MB chegou pelo gateway com o SHA-256 do manifesto ([evidências](evidence/08-entrega/README.md)).

No Railway (29/09): o navegador reenviou a credencial ao abrir o WebSocket, e o login real chegou à seleção de personagem. **A confirmar:** que o `X-Forwarded-For` do Railway traz o IP do cliente como última entrada.

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
