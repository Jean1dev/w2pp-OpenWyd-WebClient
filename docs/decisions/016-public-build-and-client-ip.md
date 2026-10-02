# ADR 016: build público sem `wyd_debug_*` e IP do cliente no Railway

Data: 02/10/2026. Estado:
- **Confirmado em teste:** verificador de exports com WASM sintético; `assemble_site --public` com link falso; patches 0001–0024 aplicados num checkout limpo; `go test`.
- **A confirmar em execução:** build real da imagem (CI e Railway, porque não há Docker ou emsdk nesta máquina) e IP registrado depois do deploy.

## Contexto

Com o gate da [ADR 015](015-portal-account-gate.md), qualquer conta do portal baixa o runtime. A [ADR 003](003-in-world-dialect-and-automation.md) exige que as exports `wyd_debug_*` fiquem atrás de uma flag de build antes de uma entrega pública. Essas funções acionam a interface (PIN, criar, entrar e excluir personagem, confirmar caixas), mexem no tempo falso e na câmera e leem itens. O harness usa todas elas.

O limite de conexões por IP também depende de identificar o cliente. Em 02/10, o log de produção mostrou que o gateway registra um IP de borda (`46.151.x.x`) e não o IP público da máquina de teste (`131.19.x.x`). O `remoteIP` usava a **última** entrada do `X-Forwarded-For`. Segundo a equipe do Railway (resposta de 09/03/2026 em [station.railway.com](https://station.railway.com/questions/which-header-should-i-rely-on-for-real-c-d78a6f96)), a borda controla esse header e a **primeira** entrada é o cliente real. Sem a correção, o limite por IP vale para todos que chegam pelo mesmo nó de borda.

## Decisão

- **Build público** (`patches/openwyd/0024-public-build-exports.patch`):
  - `link_tmproject_wasm_startup.py --public` linka com `-sEXPORT_KEEPALIVE=0` e um `EXPORTED_FUNCTIONS` explícito;
  - essa lista junta a lista do upstream, as `extra_exports` e as funções `KEEPALIVE` de `wyd_client_entry.cpp` e `WydDialect.cpp`, sem nenhum nome `_wyd_debug_*`;
  - os objetos não mudam, e sem `--public` o link é idêntico ao anterior. O harness continua usando o build local (`.cache/local-scene`), sem a opção.
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
