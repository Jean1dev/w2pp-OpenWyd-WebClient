# Setup auditado — Windows / PowerShell

Revisão: 28/09/2026. **Confirmado em execução:** compilação de 114 unidades C++ e link estrito do runtime em Emscripten 6.0.0, sem assets embutidos. Ainda não há cena executada no navegador nem conexão de jogo.

## Ambiente e fontes

Ambiente desta sessão: Windows amd64, PowerShell, Git, Python **3.14.3**. Go **1.25.13** e emsdk **6.0.0** instalados apenas em `.cache/toolchains`; Node **22.16.0** e Python **3.13.3** são dependências internas do SDK. WSL Ubuntu tem Python 3.12.3, mas não foi usado para compilar. Docker CLI 29.8.0 existe; o daemon Linux não estava ativo. Não alteramos a configuração global do PATH.

Para reproduzir em clone limpo, executar da raiz do cliente (os clones abaixo só quando não existirem):

```powershell
git clone --filter=blob:none --sparse https://github.com/Jean1dev/w2pp-OpenWYD.git external/server
git -C external/server checkout --detach 98286fdf01202f503523e89d3e50b2183f00c36c
git -C external/server sparse-checkout set tmserver internal api dbserver binserver webserver scripts docs/migration development-guidelines

git clone --filter=blob:none --sparse https://github.com/alanpetry/OpenWyd.git external/OpenWyd
git -C external/OpenWyd checkout --detach beb9f69bdea6d81f70af14b5ce85ed064575bb26
git -C external/OpenWyd sparse-checkout set Projects/TMProject Dependencies/Directx/Include webclient/client-wasm/compat webclient/client-wasm/config webclient/client-wasm/tools webclient/client-wasm/build/link webclient/tools webclient/server docker docs .github
```

O aplicativo de inspeção `webclient/app` foi lido separadamente na auditoria e não é requisito do build do runtime. `CommonFiles`, servidor C++ upstream e o bundle `v769ClientRelease` não são requisitos para compilar os objetos selecionados. O build requer os headers DirectX listados acima, além dos shims de compatibilidade.

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

A primeira compilação produziu 114 objetos, mas **retornou 2** porque seu fingerprint mudou durante a execução. A repetição retornou 0 com `contract_unchanged=true` e `certified=true`. Não alterar o contrato para ignorar esse erro. A causa exata da primeira diferença não foi isolada; inicialização da toolchain é hipótese, não conclusão.

O link `--dev` compilou os objetos incrementais, `wyd_client_entry.cpp` e `win32_emscripten_stubs.cpp`, e produziu JS/WASM com 0 símbolos indefinidos. `--dev` deixa os assets externos; não significa runtime pronto para jogar. Há warnings de capitalização de includes Windows/D3D9. Linux/macOS não foram validados.

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

**Incompatibilidade concreta de leitura:** o Alan pede 6500×164 = 1.066.000 bytes para ItemList; o arquivo fornecido tem 910.004. Para SkillData, pede 248×104 = 25.792, mas há 23.812 bytes. Não renomear/copiar e considerar os dados compatíveis. O formato legado de ItemList documentado no servidor é 6500×140 com 4 bytes finais, sem header inicial. A identificação semântica da cópia fornecida e a conversão ainda exigem teste independente.

As wrappers shell upstream de build completo validam o manifesto e depois geram o atlas GDI. Este caminho requer os assets e uma toolchain MSVC/Windows SDK descoberta por `build_gdi_font_atlas.py` no layout `external/.tools/portable-msvc-v142-x86/msvc`, ausente nesta sessão. Há Visual Studio BuildTools instalado em outro layout; ele não foi adaptado/validado para esse gerador. Não baixar atlas/fontes comerciais para esconder a lacuna. O link `--dev` não depende desse atlas, mas a cena real depende de recursos de texto válidos.

## Próxima execução

Concluir a revisão dos consumidores ainda pendentes na matriz; definir e testar loaders 7662 para ItemList/SkillData, mapear somente dados realmente necessários e resolver a geração local do atlas com proveniência. Em seguida, importar os assets em diretório ignorado e montar uma cena Field real. Antes de servir o harness, substituir credenciais persistidas/query string e destinos de rede de demonstração. Não abrir o harness upstream contra seus servidores públicos.

O link usa WebGL 1–2 e crescimento de memória, sem flag de pthreads; não foi identificada exigência de SharedArrayBuffer nesse comando. Headers de hospedagem, smoke Chromium/Firefox, resolução e coordenadas da cena serão validados quando houver aplicação servida. Nenhuma URL de demo/deploy foi criada.
