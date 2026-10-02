# Fontes e proveniência

Preparado em 28/09/2026. Atualizar datas e SHAs quando revalidar.

Revalidado em execução em 28/09/2026: checkouts separados em `external/server` (`98286fdf01202f503523e89d3e50b2183f00c36c`) e `external/OpenWyd` (`beb9f69bdea6d81f70af14b5ce85ed064575bb26`). Consulte [dependências e proveniência](dependencies.md), `dependencies.lock.json` e [evidências](evidence/01-auditoria/README.md). A pasta de assets foi indicada pelo operador e apenas inventariada; os caminhos absolutos históricos não são pré-requisitos do projeto.

Revisão de consumidores em 01/10/2026 refeita contra os mesmos SHAs. O sparse checkout do upstream para reproduzir a distinção de produto inclui `webclient/app` e `webclient/server`; o primeiro é inspetor de assets e o segundo fornece a API de desenvolvimento e proxy experimental, nenhum deles é requisito do runtime C++ integrado.

## Servidor de destino

- Repositório: https://github.com/Jean1dev/w2pp-OpenWYD
- Checkout usado nesta preparação: `8a14bcc52bbe1636886e0e7e25a7ed735d5570dc`.
- `main` remoto observado: `98286fdf01202f503523e89d3e50b2183f00c36c`. Não presumir equivalência com o checkout; comparar antes da implementação.
- Os arquivos em `reference/server/` são snapshots documentais do checkout, não uma cópia do servidor. Links relativos dentro deles pertencem à árvore original.
- Não há código externo nem assets incorporados neste pacote. Os snapshots mantêm a proveniência do projeto servidor; este pacote não redefine sua licença.

No checkout do servidor, ler conforme a tarefa:

| Área | Caminhos |
|---|---|
| Protocolo | `docs/migration/protocol-spec.md`, `tmserver/internal/protocol/{header,transform,keytable,framing,messages,selchar,mob,score,types}.go` e testes |
| Fluxos | `docs/migration/flows.md`, `docs/migration/handlers/`, `tmserver/internal/handler/dispatch.go` |
| Layout legado | `Source/Code/Basedef.h`, `Source/Code/CPSock.{h,cpp}` |
| Assets e mundo | `docs/migration/data-formats.md`, `docs/migration/game-rules.md`, `Release/` |
| Runtime | `tmserver/cmd/tmserver/main.go`, `docker-compose.yaml`, `docker-compose.dev.yaml`, `Makefile` |
| Arquitetura | `AGENTS.md`, `docs/agents/PROJECT-OVERVIEW-2026-06-19_16-06-38.md`, `docs/agents/dependency-auditor/dependencies-report-2026-06-19_16-06-38.md` |
| Mudanças Go | `development-guidelines/Go-development-guidelines.md` |
| Estado real | `docs/migration/SESSION-PRIMER.md`, `docs/migration/ingame-bugs.md`, testes de integração |

## Candidato a base de cliente

- https://github.com/alanpetry/OpenWyd/tree/beb9f69bdea6d81f70af14b5ce85ed064575bb26
- Cliente: `Projects/TMProject/` (CPSock, Basedef, cenas e renderização).
- Build: `webclient/client-wasm/tools/`, especialmente `run_tmproject_wasm_objects.sh`, `run_tmproject_wasm_startup_link.sh` e `link_tmproject_wasm_startup.py`.
- Transporte candidato: `webclient/server/wyd_tcp_proxy.py`.
- Entrada: `webclient/client-wasm/build/link/startup_harness.html`.
- Ler README, arquivos de build e declarações de direitos antes de selecionar subconjuntos. Os caminhos precisam ser confirmados no SHA fixado.

## Referência observacional, não código-base

- https://wyd.vektar.tech/
- https://wyd.vektar.tech/startup_harness.html
- https://wyd.vektar.tech/session-resume.js
- https://wyd.vektar.tech/party-finder.js
- https://wyd.vektar.tech/mobile-controls.js
- https://wyd.vektar.tech/web-update.js

Essas URLs são mutáveis. Observações de funcionalidades não validam corretude ou autoria. Não importar conteúdo delas.

Observado em 02/10/2026, sem login: `startup_harness.html` e `openwyd-ui.js` mostram o painel "Exibição". Nele há resolução 640×480–1600×1200, ajuste de tamanho e sliders de música e efeitos que chamam `_wyd_audio_set_volumes`, um export que não existe no upstream fixado. Isso serviu só como referência funcional para o nosso painel ([evidência](evidence/07-web/2026-10-02-settings.md)); nenhum código, texto ou estilo foi importado.

## Fontes para decisões de plataforma

Consultar documentação oficial atual somente quando escolher ou alterar a respectiva capacidade:
- Emscripten: https://emscripten.org/docs/
- WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- WebGL: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- Armazenamento web: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API

Fixar a versão da toolchain encontrada no build validado; não escolher uma versão recente automaticamente. SharedArrayBuffer/threads, se necessários, exigem avaliação de isolamento de origem e headers de hospedagem.
