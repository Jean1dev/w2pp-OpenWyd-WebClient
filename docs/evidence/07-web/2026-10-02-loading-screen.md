# Tela de carregamento do cliente (02/10/2026)

## Escopo

Pedido: uma tela de carregamento amigável, como a do wyd.vektar.tech. Antes, `client.html` mostrava só "Carregando…" enquanto baixava o pacote de ~305 MiB ([ADR 012](../../decisions/012-on-demand-asset-loading.md): o preload integral continua). No primeiro acesso, não havia sinal de progresso.

O wyd.vektar.tech **não** foi aberto nem copiado nesta sessão. O visual é próprio: `web/loader.css` e um emblema em SVG inline, sem imagens, fontes externas nem textos de terceiros. A CSP da página não mudou.

Base: repositório `8758d80`. Toolchain: Playwright 1.54.2, Node 24.14.1 e Python 3.14.3, em Windows. emsdk, dataset e runtime compilado **não** existem neste worktree.

## Confirmado em fonte

`tools/file_packager.py` do Emscripten **6.0.0** (tag fixada em `dependencies.lock.json`, lido de `raw.githubusercontent.com/emscripten-core/emscripten/6.0.0`):
- `fetchRemotePackage` chama `Module.setStatus('Downloading data...')` e, a cada bloco do `ReadableStream`, `Module.setStatus("Downloading data... (recebidos/total)")`, com o total vindo do `Content-Length`;
- com `--use-preload-cache`, `preloadResults[nome].fromCache` é definido **antes** de ler o IndexedDB, e a leitura do cache não informa progresso;
- no build não-ES6, a falha do download vira uma promise rejeitada sem `catch` (`"<status>: <url>"`). A dependência de execução nunca é liberada e a página ficava parada sem mensagem;
- no fim, `setStatus('Downloading...')`, que a página ignora.

## Implementação

- `web/client.html`: a camada `#loader` (`role=status`, `aria-live`, `aria-busy`) traz o emblema, a etapa, uma barra `role=progressbar`, o detalhe, a nota de primeiro acesso, o botão "Tentar novamente" e dicas. `#status` mostra só o canal.
- `web/loader.css`: camada fixa de tela cheia (z-index 5, abaixo do painel de configurações), com animações desligadas em `prefers-reduced-motion`.
- `web/client.js`, objeto `Loader`:
  - etapas, na ordem:
    1. "Verificando acesso…"
    2. "Baixando o jogo…"
    3. "Baixando dados do jogo…": MB recebidos/total, MB/s em janela de 4 s e tempo restante
    4. "Guardando os dados no navegador…" a 100%, ou "Abrindo os dados guardados no navegador…" com `fromCache`
  - a camada some com fade no **primeiro** `_wyd_tick_client` bem-sucedido e fica `hidden` depois de 500 ms. Ela tem `pointer-events: none` desde o início do fade;
  - erros com botão (`location.reload()`):
    - `config.json` 401 ou `.data` 401 (sessão do portal expirada, [ADR 015](../../decisions/015-portal-account-gate.md)): "Sua sessão expirou. Entre novamente pelo portal.";
    - outra falha de download: mensagem de conexão;
    - `onAbort`, boot e tick com mensagens próprias;
  - `clientEvidence` continua igual e recebe o motivo da rejeição.
  - A página mostra só bytes e etapas: nenhuma credencial ou URL aparece na tela.
- `tools/verify_loading_ui.mjs` (`npm run loading:ui`): teste isolado.

## Confirmado em execução (isolado, com runtime e pacote FALSOS)

O `openwyd_assets.js` falso repete a sequência de chamadas da fonte acima (25 blocos de um total de 320 MiB, a 120 ms). Isso **não** é evidência do pacote real, de rede real nem de gameplay.

| Comando | Resultado |
|---|---|
| `npm ci --ignore-scripts` | dependências do lock |
| `npm run loading:ui` | **36/36 ok** (Chromium e Firefox): etapa, bytes, velocidade e tempo restante; barra monotônica até 100; nota "cerca de 320 MB"; some no primeiro quadro; clique real do Playwright chega ao canvas (`WM_LBUTTONDOWN`); cache sem nota; 401 no `config.json`, 401 no `.data` e `onAbort` com falha e botão visíveis; 375 px sem rolagem horizontal |
| `npm run settings:ui` (regressão) | **36/36 ok**: cliques, teclas e foco no canvas e o painel de configurações continuam funcionando |

As capturas ficam em `.cache/loading-ui/` (ignorado): desktop durante o download, celular de 375 px e a falha. Elas foram revistas: depois disso, o brilho da barra e a dica passaram a sumir no estado de falha.

## Não executado / limitações

- `npm run assets:cache` e `--real`: dependem do emsdk e do dataset locais, ausentes neste worktree. O progresso com o pacote **real**, inclusive o tempo da leitura do IndexedDB em ~305 MiB, ainda não foi visto.
- Falta testar no Railway com o gate do portal, em rede real (throttling) e com uma sessão expirada de verdade.
- A rede lenta sem erro não tem aviso de "sem dados há N s". A barra só para.

## Próximo passo

Com o dataset local: `npm run assets:cache -- --real` e um primeiro acesso manual com DevTools em "Fast 4G" (IndexedDB limpo e depois quente). Depois do deploy, o operador confere a tela no domínio público.
