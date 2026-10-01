# Setup auditado — Windows / PowerShell

Revisão da etapa 2: 01/10/2026. O importador já converte ItemList/SkillData 7662 e o runtime já possui cena offline e integração online. Os números de 28/09 abaixo são históricos; a reprodução atual está em [evidências da etapa 2](evidence/02-build/README.md).

## Ambiente e fontes

Ambiente desta sessão: Windows amd64, PowerShell, Git, Python **3.14.3**. Go **1.25.13** e emsdk **6.0.0** instalados apenas em `.cache/toolchains`; Node **22.16.0** e Python **3.13.3** são dependências internas do SDK. WSL Ubuntu tem Python 3.12.3, mas não foi usado para compilar. Docker CLI 29.8.0 existe; o daemon Linux não estava ativo. Não alteramos a configuração global do PATH.

Para reproduzir em clone limpo, executar da raiz do cliente (os clones abaixo só quando não existirem):

```powershell
git clone --filter=blob:none --sparse https://github.com/Jean1dev/w2pp-OpenWYD.git external/server
git -C external/server checkout --detach 98286fdf01202f503523e89d3e50b2183f00c36c
git -C external/server sparse-checkout set tmserver internal api dbserver binserver webserver scripts docs/migration development-guidelines

git clone --filter=blob:none --sparse https://github.com/alanpetry/OpenWyd.git external/OpenWyd
git -C external/OpenWyd checkout --detach beb9f69bdea6d81f70af14b5ce85ed064575bb26
git -C external/OpenWyd sparse-checkout set Projects/TMProject Dependencies/Directx/Include webclient/app webclient/server webclient/client-wasm/compat webclient/client-wasm/config webclient/client-wasm/tools webclient/client-wasm/build/link webclient/tools docker docs .github
```

O aplicativo `webclient/app` é um inspetor de assets: frontend HTML/JS com WebGL2, WASM próprio e chamadas Fetch para `/api/manifest`, `/api/resolve` e `/api/assets/*`, atendidas por `webclient/server/app.py`. Ele não é o jogo integrado nem requisito do build do runtime escolhido. O runtime é `Projects/TMProject` compilado pelos scripts em `webclient/client-wasm/tools/` e iniciado por `webclient/client-wasm/build/link/startup_harness.html`; usa a bridge WASM de entrada/render/rede e assets fornecidos localmente. `CommonFiles`, servidor C++ upstream e bundle `v769ClientRelease` não são requisitos para compilar os objetos selecionados. O build requer os headers DirectX listados acima e os shims de compatibilidade.

O proxy exploratório `webclient/server/wyd_tcp_proxy.py` faz ponte WebSocket↔TCP em bytes, mas aceita `host` e `port` da query por padrão. Serve para desenvolvimento controlado; não deve ser exposto. O gateway deste projeto escolhe destinos apenas da configuração do operador.

Instalação local do SDK usada nesta sessão:

```powershell
git clone --depth 1 --branch 6.0.0 https://github.com/emscripten-core/emsdk.git .cache/toolchains/emsdk
python .cache/toolchains/emsdk/emsdk.py install 6.0.0
python .cache/toolchains/emsdk/emsdk.py activate 6.0.0
$env:EMSDK = (Resolve-Path .cache/toolchains/emsdk).Path
& ./.cache/toolchains/emsdk/upstream/emscripten/em++.exe --version
```

No Windows, esta distribuição fornece **em++.exe**, não em++.bat. A ativação foi local, sem `--permanent`/`--system`. Verificar o commit do emsdk contra o lock antes da instalação. Os downloads vieram do instalador oficial do SDK.

Go foi obtido de `https://dl.google.com/go/go1.25.13.windows-amd64.zip`, conferido por SHA-256 contra os metadados de `https://go.dev/dl/?mode=json&include=all` e extraído em `.cache/toolchains/go`. O hash esperado está no lock; rejeitar o arquivo se divergir. A primeira tentativa com Invoke-WebRequest foi interrompida por não progredir; o download por curl, a verificação e a extração terminaram com sucesso.

## Comandos verificados

```powershell
python tools/audit_sources.py --out docs/evidence/01-auditoria/source-inventory.json
python tools/probe_upstream_layouts.py --clang .cache/toolchains/emsdk/upstream/bin/clang++.exe --out docs/evidence/01-auditoria/upstream-layouts.json

$env:EMSDK = (Resolve-Path .cache/toolchains/emsdk).Path
python external/OpenWyd/webclient/client-wasm/tools/build_tmproject_wasm_objects.py --repo-root external/OpenWyd --jobs 4
python external/OpenWyd/webclient/client-wasm/tools/link_tmproject_wasm_startup.py --repo-root external/OpenWyd --dev --jobs 4 --link-opt-level O2

$wasmArtifact = Get-ChildItem external/OpenWyd/webclient/client-wasm/build/link -Filter 'tmproject_startup.*.wasm' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
& ./.cache/toolchains/emsdk/node/22.16.0_64bit/bin/node.exe tools/verify_wasm.mjs $wasmArtifact.FullName
```

A primeira compilação produziu 114 objetos, mas **retornou 2** porque seu fingerprint mudou durante a execução. A repetição retornou 0 com `contract_unchanged=true` e `certified=true`. Não alterar o contrato para ignorar esse erro. Causa confirmada em execução em 29/09/2026 no build Docker com cache frio: a identidade do compilador inclui a saída de `em++ --version`, que muda na primeira execução de uma toolchain nova (mensagens de sanity/cache). Aquecer a toolchain antes do build resolve ([evidências](evidence/08-entrega/README.md)).

O link `--dev` compilou os objetos incrementais, `wyd_client_entry.cpp` e `win32_emscripten_stubs.cpp`, e produziu JS/WASM com 0 símbolos indefinidos. `--dev` deixa os assets externos; não significa runtime pronto para jogar. Há warnings de capitalização de includes Windows/D3D9. O build Linux foi validado em 29/09/2026 dentro do `Dockerfile` (`emscripten/emsdk:6.0.0`); macOS não foi validado.

Resultados gerados, todos fora do Git: `webclient/client-wasm/build/obj/`, relatórios de objetos/link, `.pch`, response file e `build/link/tmproject_startup.<id>.{js,wasm}` com bootstrap `tmproject_startup.js`. O WASM medido tem 1.893.013 bytes; JS principal, 252.904 bytes. O probe Node verificou o módulo e quatro exports de ciclo de vida sem instanciá-lo ou abrir rede.

Testes executados:

```powershell
python -m unittest discover -s external/OpenWyd/webclient/client-wasm/tools -p test_wasm_socket_bridge.py -v
python -m unittest discover -s external/OpenWyd/webclient/client-wasm/tools -p test_wasm_link_freshness.py -v

$env:GOTOOLCHAIN = 'local'
Push-Location external/server
& ../../.cache/toolchains/go/bin/go.exe test -json ./tmserver/internal/protocol
Pop-Location
```

Os testes Python são contratos estáticos e testes isolados com mocks de ferramentas; não são integração de rede. O teste Go não usou `-race` e não iniciou PostgreSQL/dbserver/binserver/tmserver. Os detalhes de resultados e skips estão nas evidências.

## Assets do operador

Pasta fornecida pelo usuário: `C:\Users\User\Documents\Client-aws\Client-aws`. Ela foi **apenas lida**, sem copiar, alterar ou executar binários. Para outro ambiente, substituir o argumento por seu diretório local autorizado:

```powershell
python tools/audit_assets.py --assets 'C:\Users\User\Documents\Client-aws\Client-aws' --layouts docs/evidence/01-auditoria/upstream-layouts.json --out .cache/operator-assets-with-layouts.json
```

Saída 2 significa preflight incompleto, não erro de instalação do Python. O inventário tem 7.092 arquivos e hashes, 318.725.705 bytes, 20 caminhos/padrões ausentes, 2 padrões de derivados upstream e 5 arquivos vazios. Ausência no manifesto não prova que o runtime usa aquele arquivo; é preciso relacionar cada ausência com o consumidor. `ItemPrice.bin` tem fallback explícito; `Env/AttributeMap.dat` existe e é o caminho que `BASE_InitializeAttribute` realmente abre, embora o manifesto também peça uma cópia na raiz.

**Conversão implementada:** o Alan pede 6500×164 = 1.066.000 bytes para ItemList; o arquivo 7662 tem 910.004. Para SkillData, pede 248×104 = 25.792, mas há 23.812 bytes. `tools/import_local_assets.py` remove o trailer de quatro bytes, decodifica XOR 0x5A e adapta os registros antes de recodificar. Preserva a máscara de equipamento de 16 bits em 32 bits e zera os campos sem origem 7662. `tools/test_asset_conversion.py` verifica offsets, sinais, fronteiras, campos adicionais e rejeição de tamanhos inválidos com dados sintéticos. O trailer é descartado; não se afirma validação de checksum sem algoritmo confirmado.

As wrappers shell upstream possuem um caminho de geração de atlas GDI, mas ele não é requisito do build `--dev` usado aqui. **Confirmado em fonte:** `EnsureFontRenderer` em `win32_emscripten_stubs.cpp` abre `/Tahoma.ttf` e inicializa `stb_truetype`; o importador fornece a fonte local em sua raiz virtual. Não é necessário instalar MSVC nem baixar atlas para esse caminho. Fonte e derivados permanecem locais e sujeitos à proveniência do operador.

## Próxima execução

Etapa 1 fechada em 01/10/2026 para os consumidores dos fluxos do marco inicial. Para reproduzir a etapa 2, aplicar os patches antes dos comandos de build acima, importar os assets e executar o smoke local. O harness upstream e o inspetor de assets não devem ser expostos com credenciais persistidas/query string ou destinos de rede de demonstração.

```powershell
python tools/apply_openwyd_patches.py
python -m unittest discover -s tools -p test_asset_conversion.py -v
# Compilar/linkar com os comandos acima, depois:
python tools/import_local_assets.py --assets '<diretório autorizado>' --font C:\Windows\Fonts\tahoma.ttf
npm ci
npm run scene:package
$env:SCENE_BROWSER = 'firefox'
npm run scene
Remove-Item Env:SCENE_BROWSER
```

O importador recusa um dataset existente e valida tabelas obrigatórias e assinatura básica da fonte antes de copiar músicas ou dados. Lacunas opcionais do manifesto ficam registradas, sem conteúdo fabricado. Para atualizar somente músicas, usar `--streaming-only`. O Playwright fixado em `package-lock.json` requer seus navegadores Chromium e Firefox instalados (`npx playwright install chromium firefox`). Evidências ficam em `.cache/scene-chromium/` e `.cache/scene-firefox/`.

O link usa WebGL 1–2 e crescimento de memória, sem pthreads ou exigência de SharedArrayBuffer. Servir `.wasm` como `application/wasm`, `.js` como JavaScript e `.data` como `application/octet-stream`, na mesma origem. A página permite WASM por `script-src 'self' 'wasm-unsafe-eval'`; COOP/COEP não são necessários para esse build. O smoke usa localhost, viewport 1100×900 e canvas 800×600. HTTPS/WSS permanece necessário para o cliente conectado fora de loopback.

## Etapa 3 — protocolo, gateway e cliente conectado

Revisão: 28/09/2026. **Confirmado em execução** nesta máquina, com os comandos abaixo (detalhes em [evidências](evidence/03-protocolo/README.md)).

```powershell
python tools/apply_openwyd_patches.py          # copia client/dialect/* e aplica patches/openwyd/*.patch (recusa SHA diferente do lock)
npm run gateway:test                           # go vet + testes do gateway (sem -race: não há gcc/cgo aqui)
npm run protocol:vectors                       # SHA-256 da tabela, vetores independentes, Go overlay (transporte + dialeto)
npm run protocol:dialect                       # teste C++ do tradutor em wasm32 (em++ → node)

# rebuild do runtime com os patches (mesmos comandos da etapa 1)
$env:EMSDK = (Resolve-Path .cache/toolchains/emsdk).Path
python external/OpenWyd/webclient/client-wasm/tools/build_tmproject_wasm_objects.py --repo-root external/OpenWyd --jobs 6
python external/OpenWyd/webclient/client-wasm/tools/link_tmproject_wasm_startup.py --repo-root external/OpenWyd --dev --jobs 6 --link-opt-level O2

npm run scene                                  # regressão da cena offline
npm run client:stream                          # navegador + gateway + servidor roteirizado
```

### Etapa 4: mundo online com duas contas

As contas de teste ficam em `.env`: `W2PP_TEST_{ACCOUNT,PASSWORD,PIN,CHAR}` para A e o sufixo `2` para B. A conta B e os PINs/nomes são gerados sem impressão:

```powershell
node tools/create_test_account.mjs --extras                                          # PIN/nome para a conta A existente
node tools/create_test_account.mjs --portal https://wyd-ten.vercel.app --suffix 2    # cria a conta B (uma vez)
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --env-file .env     # todas as fases
node tools/verify_world.mjs ... --phases login,enter,second,move                     # subconjunto
```

O primeiro PIN verificado numa conta sem PIN **define** o PIN; por isso o harness usa sempre o valor do `.env`. Duas instâncias do Chromium com WebGL em software exigem bastante memória. Cada execução grava `.cache/world/evidence-<data>.json`, com contas mascaradas, e capturas locais.

`go test -overlay` injeta testes no pacote de protocolo do servidor sem alterar `external/server`. Para desfazer os patches no checkout: `git -C external/OpenWyd reset --hard` e remover `Projects/TMProject/WydDialect.*`.

### Gateway e página conectada

Copie `gateway/config.example.json` para um arquivo local e defina os canais do operador: `name`, `target` (host:porta TCP, nunca vindo do navegador), `publicWsUrl` e `clientVersion`. Com `staticDir` apontando para `.cache/local-scene`, o gateway serve `client.html` na mesma origem do WebSocket:

```powershell
$env:GOTOOLCHAIN = "local"; $env:GOMODCACHE = (Resolve-Path .cache/gomod).Path
.cache/toolchains/go/bin/go.exe -C gateway build -o ../.cache/bin/wydgateway.exe ./cmd/wydgateway
.cache/bin/wydgateway.exe -config gateway.local.json
# abrir http://127.0.0.1:8290/client.html
```

`ClientVersion` depende do ambiente: 12000 no tm-server do Railway (variável `W2PP_CLIENT_VERSION` lida em 28/09/2026); 7640 no executável sem flag. Fora do loopback, use TLS (`tlsCert`/`tlsKey`) e `wss://`; `allowInsecure` existe só para desenvolvimento local.

### Login real no ambiente do operador

A conta de teste fica em `.env`, ignorado pelo Git, com `W2PP_TEST_ACCOUNT`/`W2PP_TEST_PASSWORD`. Ela foi criada no portal do operador a pedido do usuário. O destino vem da Railway CLI em modo somente leitura:

```powershell
npx -y @railway/cli@5.63.1 link --project 08049b1a-6753-4274-b436-0dff658a5df1 --environment production --service tm-server
npx -y @railway/cli@5.63.1 variables --service tm-server --json   # ler só RAILWAY_TCP_PROXY_* e W2PP_CLIENT_VERSION; não imprimir segredos
node tools/verify_client_stream.mjs --mode server --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env
```

## Checkouts fixados, CI e imagem (29/09/2026)

`tools/fetch_pinned.py` faz o sparse clone do servidor ou do upstream no commit do `dependencies.lock.json` e confere o `HEAD`. Com checkout existente, apenas verifica o SHA:

```powershell
python tools/fetch_pinned.py server     # external/server
python tools/fetch_pinned.py upstream   # external/OpenWyd
```

A CI (`.github/workflows/ci.yml`) usa Go 1.25.13, Node 22.16.0, Python 3.13 e o contêiner `emscripten/emsdk:6.0.0`. Ela roda gateway com `-race`, reprodutibilidade de `docs/evidence/03-protocolo`, vetores contra o codec do servidor fixado, teste do dialeto em wasm32 e build da imagem com smoke sem assets. `run_dialect_test.py` usa o emsdk local em `.cache/toolchains/emsdk` quando existe e, senão, o `EMSDK` do ambiente.

Imagem local, a mesma do deploy ([deploy.md](deploy.md)):

```powershell
docker build --build-arg BUILD_JOBS=4 -t wyd-webclient:local .
python tools/pack_deploy_assets.py      # dados do operador para o Volume (.cache/deploy-assets)
docker run --rm -p 8080:8080 -e PORT=8080 -e WYD_PUBLIC_ORIGIN=https://exemplo.invalid `
  -e WYD_TARGET=reseau.proxy.rlwy.net:56950 -e WYD_CLIENT_VERSION=12000 `
  -e WYD_BASIC_AUTH_USER=operador -e WYD_BASIC_AUTH_PASSWORD=<senha local> `
  -v ${PWD}/.cache/deploy-assets:/data/assets:ro wyd-webclient:local
```

Sem TLS local, o navegador não abre `wss://exemplo.invalid`. Esse `docker run` serve para conferir rotas, autenticação e assets; o jogo local continua usando `make dev`.
