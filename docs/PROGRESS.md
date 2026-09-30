# Progresso

Atualização: 30/09/2026. O cliente web, via gateway próprio, faz no tm-server do operador (Railway) login, PIN (inclusive recusa de PIN errado), criação das quatro classes e entrada no Field com as entidades reais. Duas contas se veem e veem o movimento, o relogin e a troca de mapa uma da outra pelo servidor. O login duplicado segue o comportamento do backend fixado. No Railway, o combate básico foi aprovado de ponta a ponta ([execução 7](evidence/05-gameplay/2026-09-29-basic-combat.md#execução-7-combate-básico-e-relogin-aprovados)): A mata um Gremlin, B observa o mesmo dano e a morte, e o relogin preserva equipamento, nível e Exp, com protocolo limpo. A morte para os Trolls e a volta à cidade (caixa 11, `0x03AE`/`0x0289`, HP 2 no spawn) também foram aprovadas ([morte e respawn](evidence/05-gameplay/2026-09-29-death-respawn.md)). O deploy no Railway com assets no bucket S3, senha e login pelo domínio público foi verificado; a CI está preparada. Cliente Windows e o restante do gameplay ainda não foram provados.

| Etapa | Estado | Evidência |
|---|---|---|
| 1 Auditoria | Em andamento | [Fontes, layouts, build e assets](evidence/01-auditoria/README.md) |
| 2 Build e cena | Em andamento | [Cena real no navegador](evidence/02-build/README.md) |
| 3 Protocolo | Em andamento | [Gateway, vetores, dialeto e login real](evidence/03-protocolo/README.md) |
| 4 Login e mundo | Em andamento | [Login, Field e duas sessões](evidence/04-login-mundo/README.md) |
| 5 Gameplay | Em andamento (combate básico, morte/respawn e uma skill de cada uma das quatro classes aprovados, inclusive de área) | [Combate: dialeto e cenário](evidence/05-gameplay/README.md) |
| 6 Paridade | Pendente | — |
| 7 Experiência web | Pendente | — |
| 8 Entrega | Em andamento | [Imagem, CI e deploy no Railway verificados](evidence/08-entrega/README.md) |

## Próxima ação

1. Etapa 5:
   - tentar observar dano em vários alvos do Giro da Fúria;
   - buff e cura exigem nível 11+ ou 16–20;
   - depois chat `0333/0334`, itens, loja, banco, grupo, troca e persistência.

   Rodar os cenários online em processos separados, por causa da memória ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)).
2. Etapa 4 — fechar:
   - repetir `npm run world` completo com o trajeto novo até o portal (a execução de 29/09 falhou só na caminhada da `mapchange`);
   - o operador executa o roteiro Windows × web com `node tools/tcp_relay.mjs --target reseau.proxy.rlwy.net:56950` ativo, porque o `serverlist.bin` do `Client-aws` aponta para `127.0.0.1:8281` ([roteiro](evidence/04-login-mundo/README.md#3-roteiro-manual-para-o-cliente-windows-7662-pendente));
   - registrar a comparação visual Windows × web das cenas de seleção/criação e do Field.
3. Etapa 8 — confirmar o `X-Forwarded-For` e verificar a CI no GitHub. Deploy, assets no bucket e reenvio da credencial no WebSocket já têm prova na [etapa 8](evidence/08-entrega/README.md). Conferir o deploy automático após os merges; esta retomada não publica builds.
4. Fechar a etapa 3 (falta DeleteCharacter ponta a ponta) e a etapa 1 (consumidores ainda assinalados na [matriz](compatibility.md)).
5. Servidor, entrega separada: proteção contra login duplicado na mesma conta (`AccountLogin` aceita; cargo compartilhado é substituído/liberado). Não fazer no cliente nem no gateway.

As cores e texturas erradas eram defeito de código, não falta de asset: os catálogos de textura 7662 (registros de 264 bytes) eram lidos como 528, o que foi corrigido pelo patch 0005 ([evidências](evidence/02-build/README.md#catálogos-de-textura-causa-real-das-cores-erradas-28092026)). Restam três arquivos ausentes: `abox01/02.msa` e `questsubjects4.txt`.

## Registro por sessão

### 28/09/2026 — auditoria e viabilidade do porte

- **Decisão do usuário:** continuar/forkar a base alanpetry; acompanhar as últimas alterações integradas do servidor. Não iniciar engine alternativa.
- **Revisões:** cliente inicial `b60db820aa84e3ded322a64ebdd2d99e14b9b6f2`; servidor `98286fdf01202f503523e89d3e50b2183f00c36c`; Alan `beb9f69bdea6d81f70af14b5ce85ed064575bb26`. Checkouts em `external/server` e `external/OpenWyd`, isolados e ignorados.
- **Ambiente:** Windows/PowerShell, Python3.14.3; Go1.25.13 e Emscripten6.0.0 instalados no cache local. Docker daemon indisponível; nenhuma stack iniciada.
- **Entregas próprias:** lock de dependências; ferramentas de inventário de fontes, probe ABI, preflight de assets e verificação estrutural de WASM; matriz, setup, dependências, ADR e evidências. Atualizados README, contexto/fontes, progresso e ignore de caches Python. Nenhuma modificação no servidor ou no upstream versionado.
- **Resultados:** 114 objetos compilados/certificados após uma primeira tentativa recusada por fingerprint; link estrito sem símbolos indefinidos; WASM válido de1.893.013 bytes. Go:111 pass e2 skips; testes Python upstream:6+16 pass. Comandos e limites em [evidências](evidence/01-auditoria/README.md) e [setup](setup.md).
- **Assets fornecidos:** `C:\Users\User\Documents\Client-aws\Client-aws`, somente leitura. 7.092 arquivos/318.725.705 bytes inventariados;20 padrões ausentes,2 derivados upstream ausentes,5 arquivos vazios. ItemList/SkillData incompatíveis com o tamanho lido pelo Alan; nenhuma conversão ou importação realizada.
- **Limitações:** matriz ainda parcial; layouts provisórios no backend; fontes/atlas e formatos de assets pendentes; nenhum teste visual, login ou multiplayer. Proveniência de terceiros ainda limita incorporação/distribuição integral. Nada publicado ou commitado.
- **Próximo passo:** concluir o mapa de consumidores e o contrato dos loaders7662, preparar patches pequenos no fork local e validar uma cena real com os assets do operador. Não declarar etapa1/2 Validada nesta sessão.

### 28/09/2026 — entrega da auditoria para revisão

- Solicitação do usuário: commit, push e PR da entrega acima, na branch `Jean1dev/start`, com destino a `main`.
- Revisados os arquivos próprios e a proveniência dos metadados; assets, executáveis, toolchains, checkouts externos e manifesto completo de assets permanecem ignorados.
- Verificações de entrega: revisão do diff, `git diff --check`, inspeção dos arquivos novos e conferência dos resultados registrados. Não foram repetidos build ou testes de gameplay; a etapa 1 continua Em andamento.

### 28/09/2026 — primeira cena real no navegador

- **Solicitação do usuário:** seguir para a cena local com os assets e depois para a integração com o servidor.
- **Entregas próprias:** página `web/local-scene.*` com ordem de boot correta, entrada de mouse/teclado ligada ao runtime e identificação lida do próprio cliente; smoke test `tools/verify_local_scene.mjs` que sobe o próprio servidor estático e reprova falha de runtime, asset ausente, erro WebGL, cena substituta e entrada não entregue; importação da música transmitida sob demanda em `tools/import_local_assets.py` (13 faixas, 26.272.662 bytes); `npm run scene`. Nenhuma alteração no upstream nem no servidor.
- **Confirmado em execução:** Field (mapa 16,16, `OpenWYD` em 2096,5/2092,5, HP 320/320) e Select Server renderizam em WebGL2 com 121 quadros, zero erros GL, zero erros de página e zero requisições falhas. Clique moveu a rota para 2094,5/2090,5; teclado e consulta de terreno responderam.
- **Causa encontrada:** a cena distorcida anterior vinha do relógio falso, não de renderização ou asset — o harness upstream reproduz a mesma imagem com `?tickMs=16`. A página passou a usar o relógio do navegador.
- **Limitações:** cena Field é a fixture offline do runtime, não mapa do servidor; terreno sem textura por lacuna de conteúdo do cliente 7662 (16 caminhos observados, nada fabricado); só Chromium headless, ~1 quadro/s por rasterização em software; nenhum login, gateway ou multiplayer. Etapa 2 fica Em andamento, não Validada.
- **Próximo passo:** etapa 3, protocolo e gateway.

### 28/09/2026 — etapa 3: gateway, dialeto e login real

- **Solicitação do usuário:** executar o orquestrador; usar o servidor de teste real no Railway (acesso pela Railway CLI) e criar uma conta de teste no portal `wyd-ten.vercel.app`, guardando-a em `.env`.
- **Entregas próprias:**
  - `gateway/`: Go com `coder/websocket` v1.8.15, destinos só por canal configurado, Origin exata, limites, backpressure, timeouts e `/config.json`;
  - `client/dialect/WydDialect.*`: tradução por offsets e allowlist de opcodes, com contadores e exports `wyd_net_*`;
  - `patches/openwyd/0001..0003` e `tools/apply_openwyd_patches.py`: endpoint só por configuração, compactação do buffer de recepção e correção do fim do buffer, higiene de senha e PIN, ganchos do dialeto, banco com 128 posições;
  - `web/client.*`;
  - `tools/protocol/*`: referência CPSock independente, vetores, fixtures, overlay Go e teste C++ wasm32;
  - `tools/verify_client_stream.mjs` e `tools/gateway_test.py`;
  - ADR 002; documentação de evidências, matriz, setup, dependências e lock.

  Servidor e upstream versionado não foram alterados.
- **Confirmado em execução:**
  - a tabela CPSock tem o mesmo SHA-256 nas três fontes;
  - 97 vetores e 28 fluxos passam no Go;
  - o teste C++ passa com 276 verificações;
  - o gateway passa nos testes adversariais;
  - no fluxo roteirizado, o navegador recebeu 1002 frames exatos, com 158 chunks cortados no meio do frame e 154 KB;
  - login real no Railway (deploy `98286fdf`, ClientVersion 12000): o servidor registrou `0x020d` e `account login: OK`, respondeu com `0x010a` de 2008 bytes, e o cliente traduziu e entrou em "Select Character";
  - a regressão da cena offline continua verde.
- **Causas encontradas:**
  - `RefreshRecvBuffer`/`RefreshSendBuffer` do upstream calculavam o fim do buffer errado, e o primeiro nem tinha chamador; o fluxo travava depois de 128 KiB ou dessincronizava;
  - `NetConn` da biblioteca WS desativa o limite de leitura;
  - o close frame se perdia por ordem de cancelamento;
  - `m_szAccountPass` e o `keypass` do PIN retinham credenciais.

  Todos corrigidos e cobertos por teste.
- **Operador:**
  - conta `webtest…` criada via `POST /api/signup` (201); a senha foi gerada e gravada só em `.env`, sem impressão;
  - Railway usada apenas para leitura: status, variáveis redigidas, deploys e logs.
- **Limitações:**
  - só Chromium, sem `-race` (não há gcc), sem segunda sessão, cliente Windows ou relogin;
  - a conta não tem personagens; o login automatizado usa a função de depuração que preenche o painel original;
  - a mensagem `0x102` não é exibida;
  - campos de `CNFCharacterLogin` marcados como hipótese;
  - todo o gameplay não mapeado é descartado.

  A etapa 3 fica **Em andamento**, e não Validada, até a prova ponta a ponta dos pacotes restantes do fluxo de entrada.
- **Próximo passo:** etapa 4.

### 28/09/2026 — etapa 4: entrada no mundo e duas sessões

- **Solicitação do usuário:** executar o orquestrador. Backend: tm-server do Railway. Criar a segunda conta, personagens e PIN, guardando-os só em `.env`.
- **Entregas próprias:**
  - dialeto no mundo: `UpdateScore`, `SendAffect`, `UpdateEquip`, `CreateMobTrade` e `SetHpDam` traduzidos; `SetHpMp`, `SendItem`, `UpdateEtc`, `PKInfo` e `UpdateWeather` repassados; `0x102` vira `MessagePanel` legível; saída `0x290`/`0x291`;
  - 15 fixtures, overlay Go e teste C++ (364 verificações);
  - `patches/openwyd/0004`: senha apagada logo após o envio e exports de automação pelos controles originais;
  - `tools/verify_world.mjs` e `tools/create_test_account.mjs`;
  - ADR 003, evidências, matriz e setup.

  Servidor e upstream versionado não foram alterados.
- **Confirmado em execução no Railway:**
  - senha errada aparece como "Senha incorreta.";
  - o primeiro PIN define o PIN da conta, e os logins seguintes o verificam;
  - criação com preview do servidor;
  - entrada no Field sem nenhum pacote descartado;
  - A e B se veem com nome e equipamento corretos;
  - o movimento de cada um chega ao outro pelo servidor (logs `0x036C`/`0x0366`), com posição final idêntica;
  - o spawn a cada login é gerado pelo servidor perto da cidade.
- **Operador:** conta B criada via `POST /api/signup` (201), com contrato conferido no bundle do portal. Railway só lida: logs via `npx @railway/cli@5.63.1 logs`.
- **Limitações:**
  - a execução completa (`logout`, `mapchange`, `concurrent`) foi encerrada pelo Claude Code por falta de memória e não foi reiniciada automaticamente;
  - só Chromium headless;
  - cliente Windows pendente, com roteiro manual nas evidências;
  - PIN errado e as outras três classes não testados;
  - hipóteses `Tab`→`Nick` e `Hold`→`FakeExp`.

  A etapa 4 fica **Em andamento**.
- **Próximo passo:** repetir a execução completa com memória livre e depois seguir para a etapa 5.

### 28/09/2026 — cores/texturas erradas

- **Solicitação do usuário:** investigar por que as cores do jogo estavam “completamente bugadas”.
- **Causa (confirmada em execução):** os quatro catálogos `*TextureList*.bin` do cliente 7662 têm registros de 264 bytes e eram lidos com a struct de 528. O índice N apontava para o registro 2N, e a metade superior ficava vazia. A conclusão da etapa 2 de que “faltam níveis de textura no cliente 7662” estava errada, porque aqueles nomes eram produto da leitura deslocada.
- **Entrega:** `patches/openwyd/0005-texture-catalog-layout.patch`, leitor único que detecta o layout pelo conteúdo. A etapa 2 foi corrigida em `known-asset-gaps.json` (lacunas retratadas listadas).
- **Resultados:**
  - Field offline passou de 11 para 3 lacunas, com terreno, UI e armadura corretos;
  - Select Server passou de 3 lacunas para 0;
  - Field online no Railway aparece texturizado;
  - `npm run scene` e `npm run client:stream` verdes;
  - link com 0 símbolos indefinidos.
- **Ícones de item (mesma data):** o conjunto 526 usava células fixas de 100 px (atlas de 1000 px da base 769), mas os atlas 7662 têm 350 px. O patch `0006-item-icon-atlas.patch` calcula a célula pela largura do atlas; ícones e sobreposição de grau estão corretos online. `tools/apply_openwyd_patches.py` passou a verificar a pilha de patches inteira, porque o 0006 altera contexto que o 0004 adiciona.
- **Armadura escurecida:** a medida é compatível com a fórmula do shader original (≈50% da textura). Os modos linear e gama foram descartados. Sem captura de referência do cliente Windows, não houve alteração ([evidências](evidence/02-build/README.md#armadura-escurecida-medido-sem-correção)).
- **Limitações:** não há teste unitário isolado do leitor, nem arquivo real de 528 bytes para exercitar esse ramo. A detecção foi validada só com os dados 7662. Firefox e comparação lado a lado com o cliente Windows continuam pendentes.

### 29/09/2026 — etapa 4: relogin, mapa, concorrência, PIN e classes

- **Ambiente:** Railway `tm-server`, deploy `9016864a…`, commit do servidor `98286fdf…`, `ClientVersion=12000`. Contas A/B de `.env`. Cenários rodados um por vez, em processos separados, com 8 GB de RAM.
- **Arquivos:**
  - alterados: `tools/verify_world.mjs`, `package.json`, `tools/capture_world_logs.py` (timeout de leitura 60→180 s), README da etapa 4;
  - novos: `tools/world_checks.mjs` e `.test.mjs`, `tools/verify_world_suite.mjs`, `tools/capture_world_logs.py`, `tools/tcp_relay.mjs`, patches 0007–0009 (probes de leitura) e evidências de 29/09.
- **Resultados confirmados em execução:** senha incorreta e PIN errado são recusados e o correto recupera o acesso; classes 0–3 com persistência; movimento e relogin observados por B; troca de mapa Armia → Armia Field (`0x0290`, terreno 20,16, B vê A no portal e depois o perde); login concorrente aceito pelo backend, com a sessão original preservada. Logs do servidor sanitizados correlacionados. Regressões: `world:checks` com 6 testes, `scene`, `client:stream` e `protocol:dialect` com 364 verificações, todos verdes. Codec não mudou, então vetores e fragmentação não foram reexecutados.
- **Decisões:**
  - `checkHealth` tolera apenas o descarte, já previsto na ADR 003, de `0x0367` (combate, etapa 5), registrado na evidência;
  - o probe `_wyd_field_map_x/y` lê `HomeTownX/Y` e não prova mudança de mapa, por isso passa a valer o bloco de terreno (patch 0009).
- **Limitações:**
  - suíte completa não rodada de ponta a ponta, só cenários independentes;
  - cliente Windows não executado (exige GUI do operador), mas relé e `serverlist.bin` foram verificados;
  - login duplicado sem proteção no backend (entrega separada no servidor, não feita);
  - só Chromium headless.
- **Próximo passo:** roteiro Windows × web pelo operador; depois a etapa 5.

### 29/09/2026 — cores das armaduras (comparação com o `.exe`)

- **Pedido do usuário:** capturas do `WYD.exe` (correto) e do cliente web na vista de criação de personagem; armaduras escuras no web.
- **Causa confirmada em execução:** `D3DTOP_MODULATEALPHA_ADDCOLOR`/`MODULATECOLOR_ADDALPHA` com fórmulas trocadas na camada compat. Corrigido no patch 0010 ([evidências](evidence/02-build/README.md#armadura-escurecida-causa-real-e-correção-29092026)). Isso encerra a pendência "armadura escurecida" de 28/09.
- **Verificação:** probe de pixel antes/depois na cena real (Railway, conta B, sem criar personagem). `scene`, `client:stream`, `protocol:dialect` (364) e `world:checks` (6) verdes após religar o WASM.
- **Pendências:** pose das armas das amostras (hipótese: fase de animação).
- **`open_create` (mesma data):** patch 0011 troca o controle 5673 ("Voltar") pelo 4613 ("Criar"). O export abre a vista de criação no Railway. `scene`, `client:stream`, `protocol:dialect` e `world:checks` verdes após religar.

### 29/09/2026 — suíte da etapa 4 e etapa 5: combate

- **Suíte completa (`npm run world`), build anterior ao combate:**
  - passaram `badpass,badpin`, as classes 0–3 e `login,enter,second,move,logout`;
  - `mapchange` falhou porque A clicou três vezes num ponto sem rota a partir do spawn;
  - `concurrent` não rodou (fail-fast).

  Saúde de protocolo limpa em todos os cenários.
- **Arquivos:**
  - alterados: `client/dialect/WydDialect.{h,cpp}`, `web/client.js`, `tools/protocol/{gen_fixtures.py,dialect_test.cpp,overlay/zz_ext_dialect_test.go}`, `tools/{verify_world,world_checks}.mjs`, `tools/world_checks.test.mjs`, `docs/compatibility.md`;
  - novos: `patches/openwyd/0012-combat-probes.patch`, ADR 004, `docs/evidence/05-gameplay/README.md`.
- **Dialeto de combate (ADR 004):**
  - `0367/039D/039E` traduzidos nos dois sentidos;
  - `ReqMp@58`→`@16`, porque o runtime descontava o HP do atacante do MP de quem apanha;
  - `TargetID` i32↔u16;
  - tamanho `60+8N`↔168/72/80;
  - saída de `0289`, `0369` e `03AE` com tamanho exato;
  - contadores `inAttack`/`outAttack`;
  - `DEFERRED_INBOUND` vazio.
- **Resultados confirmados em teste:**
  - C++ wasm32 com 429 verificações;
  - overlay Go `attack_*` com os encoders e decoders reais;
  - `world:checks` com 7 testes;
  - `scene`, `client:stream`, `gateway:test` e `protocol:vectors` verdes com o WASM novo (link com 0 indefinidos).
- **Online:** cinco execuções do cenário `attack`, nenhuma chegou ao combate:
  - prazo de 15 minutos;
  - B preso num canteiro murado, com clique numa loja;
  - painel de quests aberto sobre o mapa;
  - interrupção pelo Claude Code por falta de memória.

  As causas foram corrigidas no harness: trajeto por pontos da rua, fechamento de painéis com Esc real (export `wyd_field_open_panels`) e prazo de 25 minutos. Detalhes nas [evidências](evidence/05-gameplay/README.md).
- **Limitações:** combate, morte/respawn e skills não foram provados online; a máscara inicial de skills depende do conteúdo do servidor, fora do checkout.

### 29/09/2026 — deploy no Railway e CI (etapa 8, preparação)

- **Pedido do usuário:** preparar o deploy no Railway por Dockerfile e a CI de validação; depois, revisar a documentação e fazer o commit. Decisões do usuário: assets num Volume, acesso restrito por senha e WASM compilado na imagem ([ADR 005](decisions/005-railway-deploy-and-ci.md)).
- **Arquivos:**
  - novos: `Dockerfile`, `.dockerignore`, `railway.json`, `.github/workflows/ci.yml`, `gateway/internal/config/env.go`, testes `env_test.go`/`deploy_test.go`, `tools/{assemble_site,pack_deploy_assets,fetch_pinned}.py`, `docs/deploy.md`, ADR 005;
  - alterados: `gateway` (config, relay, static, main), `tools/build_local_scene.py`, `tools/protocol/run_dialect_test.py`, README e setup.
- **Gateway:** `tlsTerminatedByProxy`, `assetDir`, Basic Auth, `/healthz`, modo `-env` (credencial obrigatória salvo `WYD_ALLOW_PUBLIC=true`) e IP real pelo `X-Forwarded-For` só no modo proxy. `gateway:test` verde.
- **Confirmado em execução (local):**
  - `docker build` com cache frio: 115 objetos certificados e link com 0 indefinidos. É o primeiro build Linux do runtime com os patches. A causa do "exit 2 na primeira compilação" foi confirmada (identidade do compilador muda no primeiro uso) e corrigida com aquecimento da toolchain.
  - Smoke do contêiner: healthz, 401/200, `application/wasm`, `/config.json` sem destino, dados ausentes sem Volume e servidos com Volume.
  - Imagem de 19 MB, com bases fixadas por digest.

  Detalhes nas [evidências](evidence/08-entrega/README.md).
- **Não executado:** nenhum serviço, variável ou volume foi criado no Railway; a CI remota só roda depois do push; o jogo via imagem exige TLS e não foi testado localmente.

### 29/09/2026 — Railway: serviço, bucket e correção do Dockerfile

- **Pedido do usuário:** criar o deploy no Railway (projeto `wyd-client-lib`), usar o bucket existente como storage e verificar as configurações. Não havia projeto com esse nome; o usuário escolheu o `wyd-client-web` já existente. Também escolheu o bucket em vez do Volume, depois de uma recomendação pelo Volume ([ADR 005, revisão](decisions/005-railway-deploy-and-ci.md)).
- **Feito no Railway:**
  - domínio gerado e 14 variáveis definidas (segredos por stdin);
  - 16 objetos (346,6 MB) enviados ao bucket `arranged-orb` e verificados.

  Nada foi apagado, e o serviço não foi recriado.
- **Código:**
  - gateway: fonte de assets S3 (`s3.go`, `sigv4.go`, config e env), com testes (vetor AWS, S3 falso, env);
  - `tools/upload_assets_s3.py`;
  - log de inicialização com a fonte de assets;
  - `Dockerfile` sem cache mount.
- **Confirmado em execução:**
  - `gateway:test` verde;
  - gateway em Docker contra o bucket real: SHA-256 do `.data` igual ao do manifesto, Range 206, 401 sem senha.
- **Falha observada:** o deploy do merge (`0296e48`) falhou no builder do Railway por causa do cache mount.
- **Deploy verificado** (`railway up` da branch do PR #3):
  - build no Railway certificado, com 0 indefinidos;
  - pelo domínio público: 401/403/101 conforme o esperado e assets vindos do bucket;
  - Chromium real com a conta A chegou a "Select Character" em 71 s pelo tm-server;
  - credencial reenviada no WebSocket.

  Detalhes nas [evidências](evidence/08-entrega/README.md).
- **Pendente:** merge do PR #3 (o deploy automático do `main` substitui o `railway up`); confirmar o `X-Forwarded-For`; flag de build para as exports `wyd_debug_*` antes de qualquer abertura pública.

### 29/09/2026 — retomada: combate no Railway

- **Pedido do usuário:** continuar a sessão Codex (plano "combate básico"), usando o tm-server do Railway (`98286fdf`, `ClientVersion=12000`).
- **Arquivos:**
  - alterados: `client/dialect/WydDialect.cpp`, `tools/protocol/dialect_test.cpp`, `tools/{verify_world,world_checks}.mjs`, `tools/world_checks.test.mjs`, ADR 004, `docs/compatibility.md`, `CONTEXT.md`, README da etapa 5;
  - novos: `docs/evidence/05-gameplay/2026-09-29-*` (relato, JSONs sanitizados, logs do servidor, hashes dos artefatos reutilizados).
- **Harness:**
  - observador obrigatório, e morte do atacante reprova;
  - exclusão de alvos por `target.id`;
  - relogin pós-combate (`checkCombatRelogin`);
  - rota até os Gremlins pela saída leste, corredor y=2102 calculado dos mapas de colisão;
  - pick coberto por entidade tenta outro ponto.
- **Dialeto:**
  - saída de ataque pelo tamanho, com opcode preservado (o corpo a corpo manda `0x039D` com `sizeof(MSG_Attack)`);
  - `0x0378` passa com 32 bytes;
  - `0x5000` diferido.
- **Confirmado em teste:** `protocol:dialect` 435/0, `protocol:vectors` verde, `world:checks` 8/0, `scene` e `client:stream` verdes. WASM recompilado duas vezes com o em++ 6.0.0 de `../start` (certificado, 0 indefinidos).
- **Confirmado em execução (Railway, execução 5):** A atacou um Gremlin (HP 70→3→0) e ganhou 274 de Exp; B viu o mesmo HP e a morte. A execução reprovou na saúde de protocolo, que foi corrigida depois.
- **Não executado:** execução limpa com relogin pós-combate. A execução 6 foi interrompida por falta de memória ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)). Validação do cliente Windows, skills e morte/respawn também ficam de fora.
- **Memória (issue #6):** o harness passou a amostrar memória por fase e a fechar B antes do relogin de A. Medido: uma página usa 865 MiB no Chromium (heap JS 497 MiB, WASM 150 MiB), com 1,9 GB livres de 8 GB. Hipótese: o preload integral de `openwyd_assets.data` domina o heap JS. [Detalhes](evidence/05-gameplay/2026-09-29-basic-combat.md#memória-do-harness-issue-6).
- **Execução 7 (aprovada):** `login,enter,second,attack` passou no Railway, rodando como processo separado. Gremlin HP 70→0, Exp 274→548, B observou, relogin preservou o estado, protocolo limpo. Três `0x039D` roteados no servidor (N=1 e N=13).
- **Próximo passo:** morte/respawn e skills (etapa 5 continua Em andamento).

### 29/09/2026 — etapa 5: morte e respawn

- **Pedido do usuário:** seguir para morte e respawn.
- **Arquivos:** `tools/verify_world.mjs` (fase `death`), `tools/world_checks.mjs` (`checkRespawn`, fase `death` e combinações proibidas), `tools/world_checks.test.mjs`, evidências `docs/evidence/05-gameplay/2026-09-29-death-*`.
- **Fonte:** caixa 11 → `0x03AE` → `0x0289` 5 s depois (runtime). O servidor revive com HP 2 e chama `recall` para `CitySpawn`; abaixo do nível 35 não há perda de EXP. Dialeto sem mudança.
- **Confirmado em teste:** `world:checks` 9/0.
- **Confirmado em execução (Railway):**
  - execução 1 reprovou só na métrica do harness (ataques do Troll antes da linha de base), com o resto do fluxo ok;
  - execução 2 aprovada: HP 105→0, `0x03AE`/`0x0289` nos logs do servidor, HP 2 no spawn de Armia, EXP intacta, B vê A voltar, protocolo limpo.
- **Limites:** B não observa a morte em si; o OK da caixa usa o export de automação; perda de EXP acima do nível 35 e PvP não foram exercitados.
- **Próximo passo:** skills (máscara `LearnedSkill` das classes).

### 29/09/2026 — etapa 5: skills (subir de nível e aprender)

- **Pedido do usuário:** seguir para skills. Decisão do usuário: upar a Foema da conta A por combate real.
- **Arquivos:**
  - `client/dialect/WydDialect.cpp` e `tools/protocol/dialect_test.cpp`: `0x027B`, `0x0277`, `0x017C` e `0x036A`;
  - patches `0013-skill-master-probes`, `0014-skill-master-merchant-id` e `0015-skill-points-label`;
  - `tools/verify_world.mjs`: fases `grind` e `learn`, opção `--grind-level`;
  - `tools/world_checks{,.test}.mjs`: `checkGrind`, `checkLearn` e regras de fases;
  - `tools/capture_world_logs.py`: `shop opened` e `skill learned` no filtro;
  - evidências `docs/evidence/05-gameplay/2026-09-29-{skills,grind-*,learn-*}`.
- **Confirmado em teste:** `protocol:dialect` 447/0, `world:checks` 11/0, `client:stream` verde, WASM certificado com 0 indefinidos.
- **Confirmado em execução (Railway):**
  - grind: 12 abates, nível 1→4, EXP 0→2735;
  - learn: NPC 12474 (Merchant 19), Flecha Mágica aprendida, pontos 12→0, preservada no relogin; logs `shop opened` e `skill learned`.
- **Falhas registradas:** saúde (`0x036A`), rota bloqueada, NPC errado (a loja comum funcionou) e geometria da célula. Todas foram corrigidas.
- **Limites:**
  - a skill ainda não foi usada em combate;
  - as outras classes exigem nível 6–8;
  - a Foema da conta A agora tem nível 4 e a skill 24.
- **Próximo passo:** usar a skill em combate.

### 29/09/2026 — etapa 5: usar a skill em combate

- **Arquivos:** patch `0016-skill-belt-probes`; `tools/verify_world.mjs` (fase `cast`, `clickHuman` com botão direito); `tools/world_checks{,.test}.mjs` (`checkCast`); evidências `2026-09-29-cast-passed*`.
- **Confirmado em teste:** `world:checks` 12/0; WASM certificado com 0 indefinidos; `client:stream` verde.
- **Confirmado em execução (Railway):**
  - Flecha Mágica atribuída pelo gesto original (`S`, mouse, Shift+1) com `0x0378` enviado;
  - slot 0 selecionado com a tecla `1`; clique direito no Gremlin;
  - MP 110→105 (servidor), HP 70→16;
  - logs: `recv 0x0378` e `recv 0x039d len=56`.
- **Limites:** outras classes; skills de área, buff e cura; comparação visual da barra com o cliente Windows.
- **Próximo passo:** skills das outras classes, ou as fatias seguintes (chat, itens, loja, banco, grupo, troca).

### 29–30/09/2026 — etapa 5: skills das outras classes

- **Pedido do usuário:** executar o orquestrador. No plano aprovado, o usuário escolheu seguir com as skills das três classes restantes, subindo de nível de forma permanente os personagens da conta A, e o Giro da Fúria (área) para a TK.
- **Arquivos:**
  - alterados: `tools/verify_world.mjs` (mestres e planos por classe, descoberta, cancelamento de caixas com Esc, aproximação e área no `cast`), `tools/world_checks{,.test}.mjs` (`checkCast` com área, `DEFERRED_OUTBOUND = {0x02cb}`), ADR 004 (revisão de 30/09) e checklist da etapa 5;
  - novos: `tools/route_armia.py` e evidências `docs/evidence/05-gameplay/2026-09-30-*`.
  - dialeto, patches e WASM sem mudança; runtime `…1790719644704247800` reutilizado.
- **Confirmado em fonte:** mestres pelos NPCs do servidor (Cap.Cavaleiros → TK, Mestre_Archi → BM, ForeLearner → HT; Mestre_Haby é Merchant 31). A hipótese inicial do plano estava errada e foi corrigida.
- **Confirmado em teste:** `world:checks` 12/0. `route_armia.py` reproduz a rota provada dos Gremlins.
- **Confirmado em execução (Railway):**
  - HT: grind 1→6 (24 abates), Golpe Felino aprendido no ForeLearner (`skill learned skill=80 cost=18`, preservado no relogin), usado com MP 110→100 e HP 70→0;
  - TK: grind 1→8 (49 abates), Giro da Fúria aprendido no Cap.Cavaleiros (`skill=0 cost=24`), usado: `0x0367` de 152 bytes (N=13) roteado, MP 112→97, HP 70→30.
- **Falhas registradas e corrigidas:**
  - Mestre_Haby abre uma caixa de confirmação que bloqueava os cliques;
  - defeito de contabilidade do harness: a fase `learn` da HT passou, mas o veredito geral saiu `false`;
  - `0x02CB` MoveStop descartado, agora diferido;
  - TK presa num canteiro elevado.
- **BeastMaster:** a primeira tentativa foi interrompida pelo Claude Code por falta de memória antes do primeiro abate. A pedido do usuário, rodou de novo em 30/09 com 1,7 GB livres:
  - grind 1→8 (51 abates);
  - Fera Flamejante aprendida no Mestre_Archi (`skill=48 cost=24`, preservada no relogin);
  - usada com MP 119→111 e HP 70→1.

  As três execuções foram aprovadas, com protocolo limpo.
- **Limites:**
  - o dano do Giro da Fúria em vários mobs no mesmo golpe não foi observado;
  - buff e cura não foram exercitados;
  - uma loja comum foi aberta por engano durante uma caminhada, sem efeito;
  - não houve comparação com o cliente Windows.
- **Próximo passo:** dano em vários alvos da skill de área e buff/cura (exigem níveis mais altos), ou a fatia 2 (inventário, equipamento, drop).

Estados permitidos: Pendente, Em andamento, Bloqueada (motivo específico), Validada. Uma etapa parcialmente testada não é Validada.
