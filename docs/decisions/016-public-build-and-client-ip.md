# ADR 016: build público sem `wyd_debug_*` e IP do cliente no Railway

Data: 02/10/2026. Estado: **implantado e confirmado em execução** (PR [#20](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/pull/20), `384d8ef`, deploy `de59e41b`):
- o log de início mostra `forwardedFor="first"` e `auth="portal"`;
- requisições da máquina de teste registram o IP público real dela. Com um `X-Forwarded-For: 203.0.113.77` forjado, o log continua mostrando o IP real, ou seja, a borda do Railway descarta o valor do cliente;
- o `.wasm` publicado (`tmproject_startup.1790967849521866044.wasm`), baixado do domínio com sessão e passado pelo `check_public_exports.py`, tem 946 exports, 0 `wyd_debug_*` e todas as funções usadas por `client.js`/`settings.js`;
- `/local-scene.html` com sessão → 404.

**Pendente:** jogar no navegador com o build público (login, seleção, Field, configurações).

## Contexto

Com o gate da [ADR 015](015-portal-account-gate.md), qualquer conta do portal baixa o runtime. A [ADR 003](003-in-world-dialect-and-automation.md) exige que as exports `wyd_debug_*` fiquem atrás de uma flag de build antes de uma entrega pública. Essas funções acionam a interface (PIN, criar, entrar e excluir personagem, confirmar caixas), mexem no tempo falso e na câmera e leem itens. O harness usa todas elas.

O limite de conexões por IP também depende de identificar o cliente. Em 02/10, o log de produção mostrou que o gateway registra um IP de borda (`46.151.x.x`) e não o IP público da máquina de teste (`131.19.x.x`). O `remoteIP` usava a **última** entrada do `X-Forwarded-For`. Segundo a equipe do Railway (resposta de 09/03/2026 em [station.railway.com](https://station.railway.com/questions/which-header-should-i-rely-on-for-real-c-d78a6f96)), a borda controla esse header e a **primeira** entrada é o cliente real. Sem a correção, o limite por IP vale para todos que chegam pelo mesmo nó de borda.

## Decisão

- **Build público** (`patches/openwyd/0024-public-build-exports.patch`):
  - as 13 funções `wyd_debug_*` de `wyd_client_entry.cpp` deixam de ser `KEEPALIVE` e passam a usar `WYD_DEBUG_EXPORT`, vazio. O script de link as exporta pelo nome, então o build padrão (harness) não muda;
  - `link_tmproject_wasm_startup.py --public` tira todo nome `_wyd_debug_*` de `EXPORTED_FUNCTIONS`, incluindo os do upstream (tempo falso, câmera).
  - **Confirmado na CI (PR #20, 1ª execução):** a primeira versão, com `-sEXPORT_KEEPALIVE=0`, não removia as funções `KEEPALIVE`. No Emscripten 6.0.0 a exportação fica marcada no objeto já na compilação. O verificador detectou as 13 exports e barrou a imagem.
- **Site público** (`tools/assemble_site.py --public`):
  - não copia `local-scene.*`, porque a cena offline de teste usa `wyd_debug_camera_*`;
  - roda `tools/check_public_exports.py`, que lê a seção de exports do `.wasm` e falha o build se houver `wyd_debug_*` ou se uma função `_wyd_*` usada por um script da página não estiver exportada.
  - O `Dockerfile` usa as duas opções. A CI roda os testes do verificador e confirma 404 em `/local-scene.html` no smoke da imagem.
- **IP do cliente:**
  - `forwardedFor` / `WYD_FORWARDED_FOR` escolhe `first` ou `last`. O padrão continua `last`, para proxies que acrescentam o par no fim;
  - vale só com `tlsTerminatedByProxy`;
  - cabeçalhos repetidos são lidos como uma lista só;
  - o modo aparece no log de início.
- **Railway (variáveis registradas em 02/10, com `--skip-deploys`):** `WYD_FORWARDED_FOR=first` e `WYD_MAX_CONNS_PER_IP=4`. `WYD_MAX_CONNS` fica no padrão de 256.

## Limites

- Esconder as exports não é uma fronteira de segurança. O servidor continua autoritativo, e quem quiser automatizar ainda pode instrumentar o WASM. A medida tira do build publicado a API pronta de automação do harness.
- A confiança na primeira entrada depende do Railway descartar o `X-Forwarded-For` enviado pelo cliente. Isso precisa ser verificado depois do deploy, enviando um header forjado. Se o forjado aparecer no log, voltar para `last` e reabrir a questão.
