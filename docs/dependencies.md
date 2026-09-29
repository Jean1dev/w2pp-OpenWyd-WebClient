# Dependências e proveniência

Auditoria: 28/09/2026. O arquivo `dependencies.lock.json` fixa revisões; caminhos abaixo são relativos ao repositório, não requisitos de instalação absolutos.

| Componente | Revisão / versão | Origem e situação |
|---|---|---|
| Cliente próprio | HEAD inicial `b60db820aa84e3ded322a64ebdd2d99e14b9b6f2` | Documentação/prompts; alterações desta sessão ainda sem commit |
| Servidor Go | `98286fdf01202f503523e89d3e50b2183f00c36c` | https://github.com/Jean1dev/w2pp-OpenWYD — checkout separado `external/server` |
| Baseline histórico servidor | `8a14bcc52bbe1636886e0e7e25a7ed735d5570dc` | Comparado por Git; não usado como alvo novo |
| OpenWyd | `beb9f69bdea6d81f70af14b5ce85ed064575bb26` | https://github.com/alanpetry/OpenWyd — checkout separado `external/OpenWyd` |
| Go | 1.25.13 | `server/go.mod`; arquivo oficial Windows amd64, SHA-256 `54a6bbffada82938ac4ae66e354b2e9c04ebdceff96f8d0455406c723b5ed1fc`, conferido contra https://go.dev/dl/?mode=json&include=all |
| Emscripten | 6.0.0 | Versão do `OpenWyd/docker/web.Dockerfile`, não selecionada por ser a mais nova |
| emsdk | tag 6.0.0, commit `d223ae73c6998296e3ab27cf81dc2c2c9fd383de` | https://github.com/emscripten-core/emsdk; release `772bb4648be4a897ca062d6adc65bc70223d2703`; instalação apenas em `.cache/toolchains/emsdk` |
| Node do emsdk | 22.16.0 | Dependência selecionada pelo SDK fixado; não é um requisito inferido do app de inspeção |
| Python do emsdk | 3.13.3 | Instalado pelo SDK no Windows; scripts de auditoria executados com Python 3.14 local |
| Playwright | 1.54.2 | Fixado em `package.json`; usado nos smokes de cena e de conexão (Chromium headless) |
| github.com/coder/websocket | v1.8.15, `go.sum` `h1:6B2JPeOG…NUA=` | Única dependência do `gateway/`; licença ISC no próprio módulo. Escolhida por ser mantida, sem cgo e com `NetConn`; `NetConn` desativa o limite de leitura e o gateway o restaura (ver ADR 002) |
| Railway CLI | `@railway/cli` 5.63.1 via `npx` | Uso somente leitura no ambiente do operador: status, variáveis redigidas, deploys e logs. Sem deploy, restart ou mudança de variáveis. O deploy documentado em `docs/deploy.md` (volume, upload) é executado pelo operador |
| Imagem de build `emscripten/emsdk` | `6.0.0@sha256:9eed2e47b4206928b22f99d2917013ad5462d777bb24cb546a652729896badd8` | Estágio WASM do `Dockerfile` e job `dialect` da CI; mesma versão do lock. Só no build; nada dela vai para a imagem final além do site compilado |
| Imagem de build `golang` | `1.25.13-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48` | Estágio do gateway (binário estático, `CGO_ENABLED=0`) |
| Imagem final `gcr.io/distroless/static-debian12` | `nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab` | Base sem shell; contém apenas `wydgateway` e `/srv/site` |
| GitHub Actions | `actions/checkout@v4`, `setup-go@v5`, `setup-node@v4`, `setup-python@v5`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v6` | CI; fixadas por versão principal (não por SHA) |

**Imagem publicada:** contém o gateway próprio, a página (`web/`) e o runtime compilado do upstream com os patches deste repositório. O runtime é derivado de código cuja licença de conjunto não está resolvida (ver abaixo), por isso o deploy é **restrito por senha** ([ADR 005](decisions/005-railway-deploy-and-ci.md)). Os dados do jogo nunca entram na imagem: ficam no Volume do operador. Os headers DirectX são usados só no estágio de build e não são copiados para a imagem final.

## Direitos: achados confirmados em fonte

- O README do Alan declara intenção GPL-3.0-or-later para mudanças de autoria OpenWyd e ressalva expressamente os direitos do código histórico, nomes e assets do jogo. A busca na árvore Git não encontrou arquivo LICENSE/COPYING/NOTICE que resolva a distribuição de todo o conjunto.
- `webclient/package.json` declara ISC. Esse metadado não licencia automaticamente a engine C++, DirectX, fontes ou dados comerciais; a diferença de escopo precisa ser preservada.
- O servidor tem LICENSE na raiz; o header legado Basedef contém aviso GPL-3.0-or-later de autores históricos. Não atribuir uma única licença nova à combinação de arquivos. Nesta sessão, os codecs Go são fonte de contrato e testes, não foram copiados para a engine.
- `Dependencies/Directx/Include` contém headers de terceiros necessários aos includes do build; a mera presença no upstream não autoriza redistribuição. O probe de layout usa o Basedef original local sem copiá-lo para as evidências.
- Fontes Tahoma/Nanum, atlas GDI, dados `v769ClientRelease`, derivados optimized-hd e assets do servidor exigem avaliação própria. Não foram adicionados ao Git do cliente.

## Decisão por componente

**Pode avançar independentemente:** ferramentas próprias de auditoria/bootstrap, documentação factual de contratos, gateway próprio e codecs por offsets. Dependências novas só entram com origem, versão e termos registrados.

**Reutilização técnica local escolhida:** runtime C++ do Alan, bridges de plataforma/renderização e scripts de build, preservados no checkout externo. Sua aptidão técnica não equivale a uma autorização para redistribuir o repositório inteiro.

**Esclarecimento necessário antes de incorporar/publicar:** delimitação dos direitos sobre código histórico, headers DirectX e assets/derivados. Não foi enviada mensagem a terceiros. Não houve importação de Valthera, publicação ou criação de fork remoto.
