# Progresso

Atualização: 02/10/2026. O cliente web, via gateway próprio, faz no tm-server do operador (Railway) login, PIN (inclusive recusa de PIN errado), criação das quatro classes e entrada no Field com as entidades reais. Duas contas se veem e veem o movimento, o relogin e a troca de mapa uma da outra pelo servidor. O login duplicado segue o comportamento do backend fixado. No Railway, o combate básico foi aprovado de ponta a ponta ([execução 7](evidence/05-gameplay/2026-09-29-basic-combat.md#execução-7-combate-básico-e-relogin-aprovados)): A mata um Gremlin, B observa o mesmo dano e a morte, e o relogin preserva equipamento, nível e Exp, com protocolo limpo. A morte para os Trolls e a volta à cidade (caixa 11, `0x03AE`/`0x0289`, HP 2 no spawn) também foram aprovadas ([morte e respawn](evidence/05-gameplay/2026-09-29-death-respawn.md)). Também foram aprovados no Railway a poção (fatia 2) e a fatia 3: loja NPC (venda, compra, recusa, clique repetido), banco (item e ouro nos dois sentidos, recusas), chat (fala, sussurro, aviso de offline) e teleporte por comando `/cidade` ([fatia 3](evidence/05-gameplay/2026-09-30-shop-bank-chat.md)). O deploy no Railway com assets no bucket S3, senha e login pelo domínio público foi verificado; a CI está preparada. O grupo foi aprovado no Railway (recusa, aceite, saída, expulsão, desconexão e relogin; [fatia 4](evidence/05-gameplay/2026-09-30-party.md)). Em 30/09, a exclusão de personagem foi aprovada ponta a ponta no Railway ([etapa 3](evidence/03-protocolo/README.md#exclusão-de-personagem-ponta-a-ponta-30092026)). Em 01/10, com os PRs [#358](https://github.com/Jean1dev/w2pp-OpenWYD/pull/358) e [#359](https://github.com/Jean1dev/w2pp-OpenWYD/pull/359) integrados e implantados (`2e532afa`), foram aprovadas a recusa de exclusão com `0x011B` ([etapa 3](evidence/03-protocolo/README.md#recusa-de-exclusão-com-0x011b-01102026)) e a troca entre duas contas ([fatia 4](evidence/05-gameplay/2026-10-01-trade.md)). O cliente Windows já entrou no mundo junto com o web; falta o relogin dele. Na noite de 01/10, com o PR #363 implantado (`052cd5fe`), o HUD mostra o dano com a arma logo após o login. Em 02/10, com os PRs [#364](https://github.com/Jean1dev/w2pp-OpenWYD/pull/364) e [#365](https://github.com/Jean1dev/w2pp-OpenWYD/pull/365) implantados (`bc7b3923`, [ADR 013](decisions/013-party-chat-and-level-seed.md)), o chat de grupo e o nível foram aprovados; com o [#366](https://github.com/Jean1dev/w2pp-OpenWYD/pull/366) (`9d9af882`), também o buff (Lobisomem, inclusive após o relogin), a cura em si mesmo e em outro jogador, e a persistência após reinício controlado do servidor (fatia 5).

| Etapa | Estado | Evidência |
|---|---|---|
| 1 Auditoria | Validada (consumidores dos fluxos do primeiro marco revisados em fonte; loaders 7662 e paridade Windows continuam para etapa 2/6) | [Fontes, layouts, build, assets e revisão dos consumidores](evidence/01-auditoria/README.md) |
| 2 Build e cena | Validada (01/10: build limpo, importador com testes sintéticos e cena Field/Select Server em Chromium e Firefox; Field é fixture offline; Safari não testado) | [Cena real no navegador](evidence/02-build/README.md), [reprodução de 01/10](evidence/02-build/2026-10-01-reproduction.md) |
| 3 Protocolo | Validada (01/10: vetores, streaming adversarial, login real e DeleteCharacter com recusa `0x011B` no Railway `2e532afa`; login real no tm-server do operador, não numa stack local) | [Gateway, vetores, dialeto e login real](evidence/03-protocolo/README.md) |
| 4 Login e mundo | Em andamento (01/10: duas sessões web aprovadas no Railway, com movimento, logout/relogin, troca de mapa e login concorrente; Windows × web com movimento nos dois sentidos e despawn; falta o relogin do Windows) | [Login, Field e duas sessões](evidence/04-login-mundo/README.md) |
| 5 Gameplay | Em andamento (fatias 1–3 aprovadas no Railway: combate, morte/respawn, skills das quatro classes, área em dois alvos, equipar, poção, loot, loja, banco, chat e teleporte por comando; drop no chão bloqueado pelo servidor; grupo e troca aprovados; fatia A de 01/10: venda, ouro no banco entre sessões, teleporte pago e troca com bolsa cheia/desconexão; score do login aprovado com o #363; em 02/10, chat de grupo (#364) e nível (#365) aprovados no servidor `bc7b3923`, buff (Lobisomem) e cura (Cura) aprovados com nível ajustado no banco, fatia 5 (reinício controlado) e cura em outro jogador aprovadas; o checklist não tem mais item pendente que dependa só do cliente) | [Checklist por funcionalidade](evidence/05-gameplay/README.md) |
| 6 Paridade | Em andamento (01/10: linha de base offline em Chromium headless; a cena abre 50,5 de 305 MiB do pacote, com heap JS de 527 MiB; sem comparação Windows) | [Linha de base](evidence/06-paridade/README.md) |
| 7 Experiência web | Em andamento (cache do pacote principal validado localmente em Chromium e Firefox; publicação pendente; 02/10: painel de música, efeitos e resolução compilado e testado com runtime falso, áudio real ainda não verificado; tela de carregamento com progresso real, cache e erros testada com runtime falso, pacote real ainda não verificado; seleção automática do servidor quando todos os canais têm o mesmo destino (patch 0025), aprovada com runtime real contra o tm-server do Railway; login automático pela conta do portal (ADR 017) aprovado de ponta a ponta na stack local, deploy pendente) | [Cache local de assets](evidence/07-web/2026-09-30-asset-cache.md), [painel de configurações](evidence/07-web/2026-10-02-settings.md), [tela de carregamento](evidence/07-web/2026-10-02-loading-screen.md), [seleção automática do servidor](evidence/07-web/2026-10-02-auto-server.md), [login automático](evidence/07-web/2026-10-02-auto-login.md) |
| 8 Entrega | Em andamento (02/10: gate por conta do portal no lugar do Basic Auth, implantado e confirmado no domínio público; falta o login real pelo portal) | [Imagem, CI e deploy no Railway verificados](evidence/08-entrega/README.md), [gate do portal](evidence/08-entrega/2026-10-02-portal-gate.md) |

## Próxima ação

1. Etapa 5:
   - fatia A (01/10): venda, ouro no banco entre sessões, teleporte pago e casos de troca confirmados. A execução 4 de `tradeedge` (01/10, 21:04) rodou todos os passos: aviso "Nao ha espaco no inventario." confirmado online e B limpo. Só a regra final reprovou, porque B começou cheio de sobra; regra corrigida e JSON reavaliado offline;
   - PRs #361, #362 e #363 implantados (`052cd5fe`). Ouro dos mobs e dano após o login foram confirmados em execução;
   - PRs #364 e #365 implantados (`bc7b3923`); chat de grupo e nível confirmados em execução em 02/10 ([evidência](evidence/05-gameplay/2026-10-02-partychat-level-deployed.md)). Em produção real, rodar migrações de personagem com jogadores deslogados;
   - fatia 5 aprovada em 02/10 ([evidência](evidence/05-gameplay/2026-10-02-restart.md));
   - buff e cura aprovados em 02/10 ([evidência](evidence/05-gameplay/2026-10-02-buff-cure.md)). O modelo da BM voltava a humano no relogin; corrigido pelo PR [#366](https://github.com/Jean1dev/w2pp-OpenWYD/pull/366) e confirmado em execução em `9d9af882`. A cura em outro jogador foi aprovada em 02/10 ([evidência](evidence/05-gameplay/2026-10-02-buff-cure.md#cura-em-outro-jogador-loginhealother---class-1-aprovada));
   - chat de guilda confirmado em execução no `3ae11009` (PR #367; [evidência](evidence/05-gameplay/2026-10-02-guildchat.md)). Falta o painel do toggle: merge e deploy do PR [#368](https://github.com/Jean1dev/w2pp-OpenWYD/pull/368) e uma nova execução de `login,enter,second,guildchat`. A guilda de teste (id 1) continua no banco.

   Rodar os cenários online em processos separados. Antes de abrir A e B, confirmar ≥ 2 GB livres: órfãos `tail`/`grep`, Docker e Chrome em segundo plano custaram ~1,3 GB nesta sessão ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)).
2. Etapa 4 — fechar (os cenários de duas sessões passaram em 01/10, [evidência](evidence/04-login-mundo/2026-10-01-two-sessions.md)):
   - o operador executa o roteiro Windows × web com `node tools/tcp_relay.mjs --target reseau.proxy.rlwy.net:56950` ativo, porque o `serverlist.bin` do `Client-aws` aponta para `127.0.0.1:8281` ([roteiro](evidence/04-login-mundo/README.md#3-roteiro-manual-para-o-cliente-windows-7662-pendente));
   - registrar a comparação visual Windows × web das cenas de seleção/criação e do Field.
3. Etapa 8 — gate por conta do portal implantado ([ADR 015](decisions/015-portal-account-gate.md)). Falta verificar no navegador: login ou cadastro no portal → `/jogar` → jogo, duas sessões e relogin.
   Build público sem `wyd_debug_*` e IP do cliente pela primeira entrada do `X-Forwarded-For` ([ADR 016](decisions/016-public-build-and-client-ip.md)): implantados e confirmados em produção em 02/10. O operador testou o login pelo portal e o jogo no navegador com o build público, e está OK.
   Também: confirmar o `X-Forwarded-For` e verificar a CI no GitHub. Deploy, assets no bucket e reenvio da credencial no WebSocket já têm prova na [etapa 8](evidence/08-entrega/README.md). Conferir o deploy automático após os merges; esta retomada não publica builds.
4. Etapas 1–3 fechadas; a paridade do cliente Windows continua na etapa 6.
5. Etapa 7 — painel de configurações: com o dataset, verificar no Railway música e efeitos ao vivo, mudo na troca de zona, persistência no relogin e as resoluções 1024×768/1280×1024 ([roteiro](evidence/07-web/2026-10-02-settings.md#próximo-passo)). Tela de carregamento: `npm run assets:cache -- --real` e um primeiro acesso em rede lenta com o pacote real ([evidência](evidence/07-web/2026-10-02-loading-screen.md#próximo-passo)).
6. Servidor, entregas separadas (não feitas):
   - itens no chão: `0x026E`, CNF de 28 bytes, decay e dono ([ADR 007](decisions/007-inventory-dialect.md));
   - aviso na recusa do teleporte pago (o original avisa, o Go fica em silêncio);
   - sussurro: gravar o nome de quem envia e reproduzir a reescrita legada; enviar aviso nas recusas de compra, venda, banco e teleporte; confirmar o layout de 57 bytes do `0x0339` ([ADR 008](decisions/008-shop-cargo-chat-dialect.md)).
6. Servidor, entrega separada: proteção contra login duplicado na mesma conta (`AccountLogin` aceita; cargo compartilhado é substituído/liberado). Não fazer no cliente nem no gateway.

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

### 30/09/2026 — etapa 5: Giro da Fúria em vários alvos

- **Pedido do usuário:** executar o plano "Giro da Fúria com múltiplos alvos" ([ADR 006](decisions/006-area-combat-evidence.md)); o usuário autorizou criar contas de teste no portal do operador.
- **Arquivos:**
  - alterados: `client/dialect/WydDialect.{h,cpp}` (diagnóstico de combate opt-in, 2×64 eventos), `tools/protocol/dialect_test.cpp`, `tools/verify_world.mjs` (fase `castarea`), `tools/world_checks.mjs`, `package.json`;
  - novos: `tools/area_checks{,.test}.mjs`, ADR 006, evidência [`2026-09-30-area-multiple`](evidence/05-gameplay/2026-09-30-area-multiple.md) com JSON e log do servidor sanitizados.
- **Confirmado em teste:** `world:checks` 15/0; `protocol:dialect` 469/0; `protocol:vectors` 97 vetores e 28 fluxos; `scene`; `client:stream`. WASM `9479750f…`.
- **Confirmado em execução (Railway, contas novas):** personagens criados; TK nível 1→8 em duas execuções de grind (51 abates, a primeira encerrada pelo prazo em nível 7); Giro da Fúria aprendido e preservado no relogin; `castarea` aprovado na primeira tentativa de lançamento: um `0x0367` e uma resposta com dano 40 em cada um dos Gremlins 1037 e 1035, recebida igual por A e B, com HP 70→30 nas duas sessões, MP 112→97, e relogin preservando equipamento, nível, EXP e skill.
- **Falhas registradas:** senhas de 12 caracteres truncadas para 11 pela cena de login (`AccountPass[12]`), com contas substituídas; a primeira execução de `castarea` parou na proteção de 1 GiB livre antes de abrir B, sem combate.
- **Hipótese aberta:** o snapshot local de MP após o golpe (112) diverge do MP autoritativo (97); pode ser regeneração, não foi verificado.
- **Limites:** um par e um lançamento; buff/cura não exercitados; sem comparação com o cliente Windows. Nenhum commit ou deploy nesta fatia.
- **Próximo passo:** investigar a divergência de MP local ou seguir para buff/cura (níveis 11+) e a fatia 2 (inventário, equipamento, drop).

### 30/09/2026 — etapa 5, fatia 2: itens

- **Pedido do usuário:** executar o orquestrador. No plano aprovado, o usuário escolheu a fatia 2 (inventário, equipamento, consumo, loot e atributos).
- **Arquivos:**
  - alterados: `client/dialect/WydDialect.cpp` (`0x0376` C↔S posicional, `0x0373` 36↔34, `0x0185`), `tools/protocol/{gen_fixtures.py,dialect_test.cpp,overlay/zz_ext_dialect_test.go}`, `tools/verify_world.mjs` (fases `equip`, `potion`, `loot`; `bag`, `openInventory`, `moveItem`), `tools/world_checks{,.test}.mjs`, `tools/capture_world_logs.py` (`crack`), `docs/compatibility.md`, README da etapa 5;
  - novos: `patches/openwyd/0017-inventory-probes.patch`, [ADR 007](decisions/007-inventory-dialect.md), [evidências](evidence/05-gameplay/2026-09-30-inventory.md) com JSONs e o log do servidor sanitizados.
- **Confirmado em fonte:**
  - a troca do servidor é simétrica e ecoa o payload, e o runtime só aplica a troca pelo eco;
  - o runtime só remove um item jogado no chão ao receber o CNF;
  - itens no chão não existem para o cliente no servidor fixado;
  - o loot vai direto ao carry e ao Coin;
  - o CurrentScore do login vem do template da classe.
- **Confirmado em teste:**
  - `protocol:dialect` 496/0;
  - `protocol:vectors` verde (overlay com decoders e encoders reais);
  - `world:checks` 21/0;
  - build certificado e link com 0 indefinidos (WASM `3c27933b…`);
  - `scene` e `client:stream` verdes;
  - pilha de patches 0001–0017 verificada.
- **Confirmado em execução (Railway):** `equip` aprovado na execução 2.
  - A tira a arma 861 e a põe de volta por cliques reais, com um `0x0376` roteado em cada sentido.
  - B vê a troca de visual.
  - O Damage do servidor é 28 sem a arma e 30 com ela.
  - A poção arrastada para o slot da arma é recusada localmente, sem pacote.
  - O relogin preserva tudo, com protocolo limpo e nenhum `crack`.
  - A execução 1 reprovou só na regra do harness, que usava o score de template do login como referência; a regra foi corrigida.
- **`loot` aprovado** (execução pedida pelo usuário): 25 abates, 8 itens do loot do Gremlin no carry via `0x0182`, relogin idêntico, nível 8→9.
  - Nenhum ouro. Causa confirmada em fonte: `SpawnMobAt` não copia o `Coin` do template, e `GoldDrop` devolve 0.
- **`potion` não provada:**
  - execuções 1 e 3 interrompidas pelo Claude Code por falta de memória no login de B;
  - execução 2 sem dano suficiente: Gremlins não baixam o HP de um personagem de nível 8–9. A fase passou a usar o respawn com HP 2 da fase `death`.
- **Não executado:**
  - comparação com o cliente Windows.
- **Limitações:** drop no chão bloqueado pelo servidor; cargo, split e delete fora desta fatia; a recusa por requisito no servidor (`NoticeReqNotMet`) não foi alcançada, porque o runtime bloqueia antes.
- **Próximo passo:** rodar `potion` e `loot` com memória livre; depois buff/cura ou a fatia 3.

### 30/09/2026 — etapa 5: poção (fatia 2) e fatia 3 (loja, banco, teleporte, chat)

- **Pedido do usuário:** executar o orquestrador. No plano aprovado: poção primeiro, depois a fatia 3.
- **Memória:** o usuário autorizou encerrar 61 processos `tail`/`grep` órfãos de monitores antigos e o Docker Desktop, fechou o Chrome (o processo em segundo plano foi encerrado) e fechou as outras sessões do Claude Code. O Node passou a ver 2,3–3,5 GB livres; nenhuma execução foi interrompida por memória.
- **Arquivos:**
  - alterados: `client/dialect/WydDialect.cpp`, `tools/protocol/{gen_fixtures.py,dialect_test.cpp,overlay/zz_ext_dialect_test.go,gen_client_stream.py}`, `tools/verify_world.mjs` (portal com nova tentativa, poção dentro da `death`, fases `shop`/`bank`/`chat` e auxiliares de sessão), `tools/world_checks{,.test}.mjs`, `tools/capture_world_logs.py`, `docs/compatibility.md`, checklist e inventário da etapa 5;
  - novos: `patches/openwyd/0018-shop-cargo-chat-probes.patch`, [ADR 008](decisions/008-shop-cargo-chat-dialect.md), [evidências da fatia 3](evidence/05-gameplay/2026-09-30-shop-bank-chat.md), JSONs e logs do servidor sanitizados.
- **Confirmado em teste:**
  - `protocol:dialect` 545/0;
  - `protocol:vectors` com 97 vetores e 28 fluxos, e overlay com os encoders reais;
  - `world:checks` 25/0;
  - `scene` e `client:stream` verdes;
  - WASM `tmproject_startup.1790788748589055200` (SHA-256 `1433ef27…`), 115 objetos certificados, 0 indefinidos.
- **Confirmado em execução (Railway):**
  - poção aprovada na execução 8: uso com HP 80 → 130, uma unidade consumida pelo servidor, B vê a cura, clique duplo consome 2, relogin idêntico;
  - loja, banco, chat e teleporte por `/azran`/`/armia` aprovados, com os valores do cliente iguais aos do log do servidor.
- **Falhas registradas e corrigidas (harness):**
  - regeneração enchendo o HP antes da poção (respawn de 1–50%, não HP 2);
  - A passando do tile do portal;
  - página 0 da bolsa cheia;
  - clique segurado comprando duas vezes (comportamento original: 513 por nível + trava de 500 ms);
  - nome "Guarda Carga";
  - caixa de valor modal depois da recusa;
  - corte do primeiro caractere no memo de sussurro.

  O dialeto também teve de descartar o padding de `MSG_Sell` (20→18) e de `MSG_MessageWhisper` (160→158), detectado pelos `static_assert`.
- **Limites:**
  - só Chromium headless, sem cliente Windows;
  - o nome do remetente do sussurro não foi observado (lacuna confirmada só em fonte);
  - o `0x0339` @12 continua hipótese para ouro guardado entre sessões;
  - teleporte pago, chat de grupo/guilda e interrupção no meio de uma transação não foram exercitados;
  - sem commit nem deploy nesta sessão.
- **Próximo passo:** fatia 4 (grupo e troca).

### 30/09/2026 — etapa 7: cache local do pacote principal

- **Pedido do usuário:** implementar cache automático do pacote principal (~320 MB), com atualização por conteúdo.
- **Arquivos:** `tools/build_local_scene.py`, `web/client.js`, gateway `static.go`, `deploy_test.go` e `s3_test.go`, `tools/verify_asset_cache.mjs`, `package.json`, `docs/deploy.md` e [evidências](evidence/07-web/2026-09-30-asset-cache.md).
- **Decisão:** cache nativo do Emscripten 6.0.0 em `WYD_PRELOAD_CACHE` (IndexedDB); hash do conteúdo invalida o pacote; loader `.js` revalidado também no diretório local. WASM e músicas fora deste cache.
- **Confirmado em execução:** gateway vet/test verde; 24 cenários aprovados no harness Chromium/Firefox, incluindo atualização, falhas de armazenamento, cena real de `client.html` e reinício do navegador. Reaberturas reais: zero requisições e zero bytes do `.data`; primeiro acesso: 319.802.941 bytes.
- **Preparação:** restaurados 7.093 arquivos da cópia local existente, todos conferidos com o manifesto; pacote regenerado sem alterar hash do `.data`; novo manifesto local `a457267b6cd82874` em `.cache/deploy-assets`.
- **Limites:** medições locais não provam ganho de tempo em produção; Chromium warm foi mais lento que cold. Sem Safari, login, multiplayer ou deploy nesta fatia. Assets continuam ignorados pelo Git.
- **Entrega solicitada:** commit e push do código e das evidências na branch `Jean1dev/shop-bank-chat`; pacote de assets e perfis de navegador permanecem locais.
- **Próximo passo:** publicar loader/dados/manifesto juntos num prefixo novo, aplicar gateway atualizado e medir no domínio público. Instruções em `docs/deploy.md`; demais pendências de gameplay preservadas.

### 30/09/2026 — etapa 5, fatia 4: grupo no Railway e troca no servidor

- **Pedido do usuário:** executar o orquestrador. No plano aprovado: aprovar o grupo no Railway e fazer a troca como entrega separada no servidor. O usuário autorizou encerrar o Chrome para liberar memória.
- **Arquivos:**
  - servidor, no checkout `external/server` (branch local `webclient/trade-forwarding`, base `98286fdf`, sem commit porque o índice referencia um blob ausente): `handler/trade.go`, `trade_test.go`, `view_test.go`, `party.go`, `protocol/types.go`, `types_test.go` e `world/session.go`. Entrega em `patches/server/0001-trade-forwarding.patch` (SHA-256 `6a8f8c1d…`);
  - cliente: `client/dialect/WydDialect.cpp` (`0383` 154↔156, `0384`/`0386`), `tools/protocol/{gen_fixtures.py,gen_vectors.py,gen_client_stream.py,dialect_test.cpp,overlay/zz_ext_dialect_test.go}`, `tools/verify_world.mjs` (pick do alvo do grupo), [ADR 010](decisions/010-server-trade-forwarding.md), ADR 009, `docs/compatibility.md`, [evidência](evidence/05-gameplay/2026-09-30-party.md) e checklist da etapa 5.
- **Confirmado em fonte:** fluxo legado de `_MSG_Trade.cpp` (`w2pp-OpenWYD` `8f65f35a`): encaminhamento, `CNFCheck`, `SendCarry`, `SaveUser` e `RemoveTrade`. O runtime já consome `0383/0384/0386/0185`. Divergência registrada: o `MSG_Trade` legado tem alinhamento natural (156), mas o servidor Go usa 154 empacotados. O layout do servidor foi mantido e o dialeto traduz.
- **Confirmado em teste:**
  - servidor: testes de troca 19/0 (8 novos ou reescritos), `go vet` limpo. No `go test ./...` completo, só falham 13 testes que dependem de `Release/` ausente no checkout;
  - cliente: `protocol:dialect` 800/0; `protocol:vectors` com 97 vetores e 34 fluxos, e o overlay com o encoder real do servidor alterado; `world:checks` 27/0; `scene` e `client:stream` verdes;
  - WASM `tmproject_startup.1790802394708885000` (115 objetos certificados, 0 indefinidos).
- **Online (Railway):**
  - execução 4 do grupo reprovou no harness: o hover pegou um NPC que cobria B. A correção foi feita, mas não foi validada online;
  - execução 5 foi interrompida pelo Claude Code por falta de memória e não foi reiniciada;
  - nenhuma troca online.
- **Bloqueios:**
  - publicar o patch do servidor (operador);
  - memória do host para duas sessões (issue #6);
  - não há stack local com persistência (Docker indisponível).
- **Execução 6 (pedida pelo usuário, 21:49–22:11 UTC):** fase `party` **aprovada** no Railway, validando online a correção do pick. Recusa, aceite, clique repetido, saída, expulsão, desconexão de membro e de líder, e relogin com inventário preservado. Zero descartes do dialeto, zero erros de página e nenhum `crack`. Log do servidor: 6 `0x037F`, 5 `0x03AB` e 4 `0x037E` roteados.
- **Próximo passo:** publicação do patch de troca pelo operador; depois, fase `trade` no harness.

### 30/09–01/10/2026 — PRs no servidor, exclusão de personagem e suíte da etapa 4

- **Pedido do usuário:** executar o orquestrador. No plano aprovado, o usuário pediu que a alteração necessária no `tm-server` seja feita e enviada como PR ao repositório do servidor, e escolheu fechar as etapas 3 e 4.
- **Checkouts:** `external/server-pr`, clone limpo de `Jean1dev/w2pp-OpenWYD` com `main` = `98286fdf`. O `external/server` tem o índice corrompido e o remoto apontando para `../start`, que não existe.
- **Servidor (entregas separadas, sem merge nem deploy):**
  - [PR #358](https://github.com/Jean1dev/w2pp-OpenWYD/pull/358), troca. Commit `cf583a37`, diff idêntico ao `patches/server/0001`. Testes de troca 19/0, `go test ./...` do tmserver verde no clone limpo, `go vet` limpo e `gofmt` sem diff.
  - [PR #359](https://github.com/Jean1dev/w2pp-OpenWYD/pull/359), recusa de exclusão `0x011A` → `0x011B`, como no legado `ProcessDBMessage.cpp:641-649`. Teste novo `TestDeleteCharacterWrongPassword`, `go test ./...` verde. Entregue como `patches/server/0002-delete-character-fail.patch` ([ADR 011](decisions/011-delete-character-end-to-end.md)).
- **Cliente:**
  - patches `0020-trade-probes` e `0021-selchar-delete-probe`. O 0021 também apaga os 256 bytes do campo de senha da exclusão; o original apagava 4;
  - `tools/verify_world.mjs`, com as fases `delete` e `trade`, `openPlayerMenu`/`uiButton`/`trade()`/`requestTrade` e o auxiliar `classChar`;
  - `tools/trade_checks{,.test}.mjs`; `tools/world_checks.mjs` (fases e regras); `package.json`; `tools/capture_world_logs.py` (filtro);
  - ADR 010 (revisão) e ADR 011; matriz; evidências das etapas 3, 4 e 5.
- **Confirmado em teste:**
  - WASM `tmproject_startup.1790812300295676400` (SHA-256 `6c441b66…`), 115 objetos certificados e 0 indefinidos;
  - pilha de patches 0001–0021 aplicada;
  - `protocol:dialect` 800/0, `protocol:vectors` verde, `world:checks` 31/0, `scene` e `client:stream` verdes.
- **Confirmado em execução (Railway):**
  - `delete` aprovado na primeira execução ([evidência](evidence/03-protocolo/README.md#exclusão-de-personagem-ponta-a-ponta-30092026)): senha errada recusada com `0x011A` e lista intacta; senha certa com `0x0112` e só o slot descartável removido; relogin igual;
  - suíte da etapa 4: `badpass,badpin` e `classes` 0–3 aprovados. As classes 1–3 foram **criadas** nos slots 1–3 da conta A, que agora está cheia.
- **Falhas:**
  - a primeira suíte reprovou em `classes` 1, porque o nome derivado tinha 14 caracteres. O harness foi corrigido;
  - a segunda foi interrompida pelo Claude Code por falta de memória ao abrir B e não foi reiniciada.
- **Não executado:**
  - fase `trade` online (depende do merge e deploy do PR #358);
  - `move,logout`, `mapchange` e `concurrent` desta suíte;
  - cliente Windows;
  - nenhum commit no repositório do cliente.
- **CI (pedido do usuário, 01/10):**
  - Cliente: o job `protocol` do PR #11 falhava porque o overlay usava `MsgCNFCheck`, que só existe com o PR #358, e a CI usa o servidor fixado `98286fdf`. Localmente passava porque o `external/server` tem o patch aplicado. Corrigido no commit `2ba7d89`: valor literal no overlay e opção `--server` em `run_go_vectors.py`, verificada contra o clone limpo e contra o servidor com patch. No mesmo commit, as actions passaram para as majors em Node 24 e o job `checks` passou a rodar `tools/*.test.mjs`. Os 5 jobs ficaram verdes.
  - Servidor: o [PR #360](https://github.com/Jean1dev/w2pp-OpenWYD/pull/360) fixa o `govulncheck` em `v1.7.0`. O `@latest` agora resolve para a v1.8.0, que exige Go 1.26, e com isso Vulnerabilities falha em qualquer execução nova. O PR também passa as actions para Node 24 e fixa o runner em `ubuntu-24.04`. Todos os jobs ficaram verdes, sem anotações. Os PRs #358 e #359 precisam do #360 (merge ou rebase) para que uma nova execução de Vulnerabilities passe.
  - Os patches 0020/0021 foram gerados de novo sem a linha em branco extra no fim do arquivo. A pilha 0001–0021 aplica num checkout LF limpo do upstream fixado com `--whitespace=error`.
- **Próximo passo:** merge e deploy dos PRs #358 e #359 pelo operador. Depois, rodar `trade` e `delete`, e os cenários restantes da etapa 4 com memória livre.

Estados permitidos: Pendente, Em andamento, Bloqueada (motivo específico), Validada. Uma etapa parcialmente testada não é Validada.

### 01/10/2026 — fechamento documental da etapa 1

- **Pedido:** implementar o plano da etapa 1 e revisar os consumidores restantes contra os SHAs fixados.
- **Checkouts recuperados:** `external/OpenWyd` em `beb9f69bdea6d81f70af14b5ce85ed064575bb26`; `external/server` em `98286fdf01202f503523e89d3e50b2183f00c36c`. Foram clones sparse, ignorados pelo Git.
- **Revisão:** consumidores de `TMSelectServerScene`, `TMSelectCharScene`, `TMFieldScene` e `TMHuman`; handlers/protocolos atuais do servidor; runtime de inspeção de assets versus startup WASM; versão efetiva de cliente, portas e contrato de contas. Detalhes e limitações em [evidências da etapa 1](evidence/01-auditoria/README.md) e [matriz](compatibility.md).
- **Confirmado em fonte:** o executável tem default `ClientVersion=7640`, o Compose de produção configura `12000`, o upstream TMProject envia `1758`; CPSock usa 8281 e status HTTP 80. `webclient/app` inspeciona assets via API própria, enquanto o jogo usa `Projects/TMProject` e o startup harness. `AccountWebService` cria contas e verifica credenciais, sem emitir ticket de sessão do jogo. O runtime espera confirmações de drop/get de 28 bytes, mas o servidor atual envia 16 e não fornece spawn `0x026E`.
- **Arquivos versionados:** `docs/compatibility.md`, `docs/setup.md`, `docs/evidence/01-auditoria/README.md`, `tools/fetch_pinned.py` e este progresso. O inventário `source-inventory.json` foi regenerado: 102 opcodes Go, 61 rotas diretas, 69 declarações upstream.
- **Verificação:** fetch dos dois SHAs; revisão estática com `rg`/`Get-Content`; `python tools/audit_sources.py --out docs/evidence/01-auditoria/source-inventory.json` passou. Nenhum teste ou build foi executado nesta atualização.
- **Limites:** etapa 1 validada para contratos e consumidores dos fluxos do primeiro marco. Não afirma paridade Windows nem gameplay novo. Conversão/teste dos loaders ItemList/SkillData e geração de atlas ficam para etapa 2; autotrade, loja premium, guilda, quests e refino ficam fora do primeiro marco. Assets e fontes externas continuam locais, sem inclusão no Git.
- **Próximo passo:** executar a etapa 2 nos loaders 7662 e na cena real com assets locais autorizados; manter itens de paridade Windows para etapa 6.

### 01/10/2026 — etapa 2 validada

- **Pedido:** executar o plano aprovado da etapa 2 (build reproduzível e validação da cena real), retomado de sessão anterior.
- **Arquivos versionados:** `tools/import_local_assets.py` (valida tabelas obrigatórias e fonte antes de copiar; erros legíveis; hash de saída das músicas), `tools/test_asset_conversion.py` (7 testes: offsets, sinais, máscara, primeiro/último registro, campos ausentes, tamanhos inválidos, nenhuma cópia após erro), `tools/verify_local_scene.mjs` (`SCENE_BROWSER=chromium|firefox`, evidência por navegador), `.github/workflows/ci.yml` (roda a suíte sintética), `docs/setup.md`, `docs/evidence/02-build/README.md`, `docs/evidence/02-build/2026-10-01-reproduction.md` e este progresso.
- **Confirmado em fonte:** texto usa `/Tahoma.ttf` via `stb_truetype` (`EnsureFontRenderer`); o atlas GDI/MSVC não é necessário no build `--dev`. Conversões ItemList 140→164 e SkillData 96→104 conferidas com `Basedef.h/.cpp`.
- **Confirmado em execução:** workspace sem build anterior; Emscripten 6.0.0 fixado; 115 objetos em 96,7 s; link estrito sem símbolos indefinidos; WASM 1.929.842 bytes (`6cda98b2…10e6`). Importação de 7.093 arquivos e 13 músicas com hashes conferidos. `python -m unittest discover -s tools -p test_asset_conversion.py`: 7 OK. `node tools/verify_local_scene.mjs` em Chromium 139 e, com `SCENE_BROWSER=firefox`, em Firefox 140: `failures: []`, zero erros GL/página/console/rede, entrada e pick no Field aprovados.
- **Limites:** Field é a fixture offline; três lacunas reais (`abox01/02.msa`, `questsubjects4.txt`), ausentes também na pasta do operador. Safari não testado; sem comparação com o `.exe` (etapa 6). Erros de permissão de temporários do sandbox exigiram repetir testes/link com permissão, sem mudar o build.
- **CI do PR #12 (confirmado em execução):** [execução 36866420277](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/actions/runs/36866420277), 5 jobs aprovados; o job de testes sintéticos executou os 7 testes de conversão. Na primeira tentativa, `TestShutdownClosesRelays` do gateway falhou (`relay still live: 1`) sem mudança em `gateway/`; passou ao repetir. Instabilidade tratada em PR separado do gateway.
- **Próximo passo:** etapa 4 (cenários restantes e roteiro Windows × web) e fatias pendentes da etapa 5, conforme “Próxima ação”.

### 01/10/2026 — gateway: fechamento limpo no desligamento

- **Sintoma:** `TestShutdownClosesRelays` falhou na CI do PR #12 (`relay still live: 1`) sem mudança em `gateway/`; passou ao repetir.
- **Causa (confirmada em fonte e em execução):** o `NetConn` do par usava contexto derivado de `baseCtx`. No desligamento, `coder/websocket` v1.8.15 fecha a conexão via `context.AfterFunc` sem frame de fechamento, concorrendo com `closeBoth("shutdown", true)`. Quando a biblioteca ganhava, o navegador recebia EOF (como falha de rede); quando `closeBoth` ganhava, `Close` aguardava a resposta do cliente por até 5 s, o mesmo prazo de `waitIdle`. Localmente: 3/10 falhas no teste original; com o teste exigindo `StatusNormalClosure`, 32/50.
- **Correção:** `gateway/internal/relay/relay.go`: contexto do par cancelado apenas por `closeBoth`; o loop observa `baseCtx` separadamente. O teste lê do WebSocket como um navegador e exige `StatusNormalClosure`.
- **Verificação:** Go 1.25.13 local (zip oficial, SHA-256 conferido, em `.cache/toolchains`); `go vet ./...`; teste de desligamento 50/50 em < 1 s; `go test -count=10 ./...` duas vezes sem falhas. `-race` não executado localmente (sem cgo/gcc); fica para a CI.
- **Segundo defeito (achado pelo `-race` da CI no PR #13, `TestConnectionLimits`):** `g.active.Add(1)` só rodava depois de `websocket.Accept`, que sequestra a conexão; daí em diante `http.Server.Shutdown` não espera o handler, e `Wait()` podia correr com o `Add` e retornar enquanto um relay ainda abria. Agora o handler é contado antes do upgrade. `go test -count=10 ./...` local sem falhas; `-race` só na CI (Docker local parado).
- **Limite:** navegador que não responde ao frame de fechamento ainda atrasa o desligamento em até 5 s por relay, dentro dos 10 s do processo.

### 01/10/2026 — etapa 4: cenários de duas sessões

- **Pedido:** seguir para a etapa 4.
- **Contas:** o `.env` com as contas anteriores não estava neste worktree; com autorização do usuário, duas contas novas foram criadas no portal do operador (`tools/create_test_account.mjs`), com credenciais só no `.env` ignorado.
- **Confirmado em execução (Railway `98286fdf`, `ClientVersion=12000`):** `login,create,enter,second,move,logout`, `login,enter,second,mapchange` e `login,enter,concurrent`, um processo cada, todos `ok`, zero erros de página e zero pacotes descartados. Movimento bidirecional confirmado pelo servidor; logout/relogin com despawn e respawn vistos por B; troca de mapa para Armia Field; login duplicado aceito conforme o backend fixado.
- **Arquivos:** `docs/evidence/04-login-mundo/2026-10-01-two-sessions.md`, três JSONs sanitizados (conferidos contra todos os valores do `.env`), README da etapa 4 e este progresso.
- **Limites:** log do servidor não coletado (Railway CLI sem login); cliente Windows pendente; só Chromium; "Nv 2"/HP 105 no HUD é hipótese ligada ao `0x0336` ausente após o login.
- **Próximo passo:** o operador executa o roteiro Windows × web; com o Railway CLI autenticado, anexar o log sanitizado destas janelas (14:43–15:08 UTC).

### 01/10/2026 — cliente Windows fecha ao entrar no Field

- **Sintoma:** pelo launcher, login/PIN/seleção funcionam e o jogo fecha ao entrar; já ocorrera em 29/09.
- **Confirmado em execução:** o Windows registra a falha de `wyd.exe` em `msmpeg2ac3dec.dll` (`0xc0000602`, offset `0x53ebc`), 1 s após `Init Field Scene::End`; mesma assinatura 3× em 29/09. O tm-server (Railway `2e532af`) completou a entrada no mundo sem erro e só viu EOF. Launcher e deploy do dia descartados.
- **Hipótese:** liberação excessiva em `DS_SOUND_CHANNEL::CleanGraph` (`DirShow.cpp:200`) na troca de música ao entrar no Field.
- **Contorno aplicado:** `Config[3]` (música) do `Config.bin` do operador de 20 para 0, com backup `Config.bin.bak-2026-10-01`. [Evidência](evidence/04-login-mundo/2026-10-01-windows-crash.md).
- **Confirmado em execução:** com o contorno, o operador entrou no jogo (13:10, −03:00); sem nova falha no Windows e entrada completa no log do tm-server.
- **Próximo passo:** seguir o roteiro Windows × web com a música desligada. Correção definitiva no cliente Windows é entrega separada.

### 01/10/2026 — Windows × web

- **Execução manual do operador:** cliente Windows 7662 pelo launcher (música desligada) e cliente web por `npm run dev`, no tm-server Railway `2e532af`.
- **Confirmado em execução (log do tm-server) e pelo operador:** sessões identificadas pelo horário do `WYD.log` e pela sondagem do launcher; ambos no mundo de 16:14:53 a 16:15:19 UTC; movimento repassado e visto nos dois sentidos; chat Windows → web; despawn do web entregue ao Windows (`0x0165`); sem erro nem `version mismatch`. [Evidência](evidence/04-login-mundo/2026-10-01-windows-web.md).
- **Não coberto:** relogin do Windows com o web observando; capturas da comparação visual.
- **Próximo passo:** repetir com os dois no mundo, fechar e reabrir o Windows; com isso a etapa 4 pode ser validada.

### 01/10/2026 — etapa 3 validada e troca online (fatia 4)

- **Pedido:** executar o orquestrador. No plano aprovado: fechar a etapa 3 e provar a troca online, porque os PRs #358/#359/#360 do servidor foram integrados em 01/10 (11:26–11:35 UTC). Isso tornou desatualizado o "Próxima ação" anterior.
- **Pré-condições confirmadas:** o deploy `5b9c73de` do `tm-server` está `SUCCESS` em `2e532afa` (`railway deployment list`); a pilha de patches 0001–0021 está aplicada; WASM `tmproject_startup.1790859244302076800`.
- **Arquivos:**
  - `tools/trade_checks{,.test}.mjs`: `checkDelete` exige `0x011B` e o texto da recusa;
  - `tools/verify_world.mjs`: a fase `delete` lê o painel assim que a resposta chega (o runtime o mostra por só 2000 ms) e tira a captura `delete-reply`; na fase `trade`, a caixa 601 é aceita pelo OK, porque o original descarta o Enter (`TMFieldScene.cpp:5757`);
  - ADR 010 e 011 (revisões);
  - evidências: `docs/evidence/03-protocolo/2026-10-01-delete-011b{.json,-server.txt}` e `docs/evidence/05-gameplay/2026-10-01-trade{.md,-passed.json,-passed-server.txt,-run1-accept-failed.json}`, mais os READMEs das etapas 3 e 5.
- **Confirmado em teste:** `npm run world:checks` 31/0.
- **Confirmado em execução (Railway `2e532afa`):**
  - `delete`: duas execuções aprovadas. Na segunda, a recusa chega como `0x011B` com "Falha ao apagar o personagem."; a exclusão chega como `0x0112`; o relogin mostra a mesma lista;
  - `login,enter,second,trade`: aprovada na execução 2. Recusa; oferta encaminhada; reset das confirmações por ouro; troca do item 401 e de 10 de ouro; relogin; cancelamento `0x0384`; troca de volta. Dois `trade completed` no log, zero descartes, zero erros de página, nenhum `crack`.
- **Falhas registradas:** a troca 1 reprovou por defeito do harness (Enter na caixa 601), corrigido. `login,enter,shop` reprovou com "sale did not raise gold": A já tinha 1.000.000 de ouro (contas de 01/10), e a venda do item 4144 não rendeu ouro. Causa não verificada. Essa execução comprou dois itens 1774 para A.
- **Limites:** o aceite da caixa 601 e o OK da exclusão usam exports de automação; só Chromium headless; nenhum cliente Windows nesta sessão; recusa por falta de espaço e desconexão no meio da troca não exercitadas; capturas com nomes ficam só no `.cache`. Sem commit, push ou deploy.
- **Próximo passo:** relogin do cliente Windows pelo operador (fecha a etapa 4); na etapa 5, buff/cura, reinício controlado e a falha de venda com 1.000.000 de ouro.

### 01/10/2026 — etapa 5, fatia A, e PRs do servidor (score do login e ouro dos mobs)

- **Pedido do usuário:** fatia A (venda, teleporte pago, ouro no banco entre sessões e casos de troca) e os PRs 1 e 2 do servidor. Com autorização, foram encerrados processos que ocupavam memória: o resto do Chrome, o OneDriveSetup, `tail`/`grep` órfãos e o CapCut.
- **Servidor (entregas separadas, sem merge nem deploy):** clone limpo `external/server-pr` em `2e532afa`.
  - **PR [#361](https://github.com/Jean1dev/w2pp-OpenWYD/pull/361):** `OverlayLoginScores` grava `BaseScore` (estado persistido) e `CurrentScore` (`computeScore`) no snapshot com template, como `ProcessDBMessage.cpp:812-821`. O item registrado antes ("enviar `0x0336`") estava errado, porque `enterWorldView` já envia o `0x0336`.
  - **PR [#362](https://github.com/Jean1dev/w2pp-OpenWYD/pull/362):** `ParseMobBasics` lê o `Coin` @28 (`Basedef.h:556`; o Gremlin tem 50), e `SpawnMobAt` o copia. Uma morte de mob com `Coin` passa a fazer o `rand()` de ouro, como o legado.
  - Os testes novos dos dois PRs falham sem a correção. `go test ./tmserver/...` e `go vet` limpos localmente; sem `-race`, que roda na CI.
- **Cliente:**
  - `tools/verify_world.mjs`: venda só de item com preço; ouro guardado no `bank`; fases `paidteleport` e `tradeedge`; helpers de troca compartilhados; `holdCanvas`.
  - `tools/world_checks{,.test}.mjs`: `checkBank` e `checkPaidTeleport`.
  - `tools/trade_checks{,.test}.mjs`: `checkTradeEdge` e `sellPrice`.
  - `patches/openwyd/0022-inventory-page-buttons.patch`.
  - `client/dialect/WydDialect.cpp`: avisos 16–33.
  - Fixture `notice_no_empty_slot` em `gen_fixtures.py`, `dialect_test.cpp` e no overlay Go.
  - ADRs 008 e 010 (revisões), checklist e [evidência da fatia A](evidence/05-gameplay/2026-10-01-slice-a.md).
- **Confirmado em teste:**
  - `world:checks` 33/0, `protocol:dialect` 803/0, `protocol:vectors` verde;
  - `client:stream` e `scene` verdes;
  - WASM `tmproject_startup.1790883428920400700` (SHA-256 `8c562869…`), 115 objetos certificados, 0 indefinidos.
- **Confirmado em execução (Railway `2e532afa`):**
  - `shop`: a venda do 1774 rende 75;
  - `bank`: 74 de ouro no banco sobrevivem ao relogin;
  - `paidteleport`: cobra exatamente 700 e leva a Noatum; com 500 de ouro, recusa sem cobrar; o relogin mantém só a cobrança;
  - `tradeedge`, execução 2: a bolsa cheia desfaz a troca (aviso 31) e a desconexão no meio da troca fecha a janela de B, as duas sem mudar nada.
- **Falhas e limites:**
  - **`bank`:** a primeira execução foi interrompida pelo Claude Code por falta de memória e deixou 37 de ouro no banco de A.
  - **`tradeedge`:**
    - execução 1: defeitos do harness (destino da compra na página visível; A fora da visão de B); deixou 4 itens 1774 em B;
    - execução 2: estourou o prazo de 40 min na limpeza (~46 s por venda); ficaram 3 itens 1774 em B (slots 27–29).
  - **Online:** as execuções usaram o WASM `…1790876556349708400`, que ainda não tinha a tabela de avisos estendida.
  - Sem commit nem push nesta sessão.
- **Próximo passo:** merge e deploy dos PRs #361/#362 pelo operador, e então conferir o score do login e o `loot` com ouro. Uma `tradeedge` completa (60 min). Relogin do cliente Windows (etapa 4).

### 01/10/2026 — conferência dos PRs #361 e #362 no Railway

- **Deploy:** `tm-server` com o commit `200f4824`, `SUCCESS` às 19:53 UTC; inclui o #361 (`307ac2ab`).
- **Harness:** a fase `enter` registra o score do HUD e a prévia da seleção (`tools/verify_world.mjs`).
- **Confirmado em execução:**
  - `loot`: 7 de 23 Gremlins deram ouro, de 256 a 292, na faixa do legado;
  - `equip`: aprovada de novo;
  - `login,enter`: o HUD mostra nível 1, HP 105/105, dano 21.
- **Achados:**
  - **Nível (confirmado em fonte):** o "Nv 2" do HUD vem do nível interno em base 1 do servidor. A seleção envia `level − 1` (commit `2a2c4a4`), o mundo envia o valor sem ajuste. A hipótese anterior, de que vinha do template, estava errada.
  - **Dano após o login:** 21, que vira 23 ao reequipar a mesma arma, igual ao padrão de 30/09. Pela fonte, a fórmula do servidor é a mesma nas duas rotas. Causa não determinada, em aberto.
  - **HP/MP/atributos do #361:** a execução não distingue o efeito, porque template e valor calculado coincidem neste personagem; o efeito está confirmado em teste no PR.
- **Evidência:** [fatia A](evidence/05-gameplay/2026-10-01-slice-a.md#depois-do-merge-e-deploy-dos-prs-361-e-362-0110-1954-2020-utc). Sem commit.
- **Investigação do dano (mesma data, pedido do usuário):** a causa é o `CreateMob` próprio, montado por `createMobFrom` com campos crus e enviado depois do `UpdateScore` do login. Reproduzido em teste com o conteúdo real (19 / 17 / 19). Corrigido no PR [#363](https://github.com/Jean1dev/w2pp-OpenWYD/pull/363) (`19b235e`, teste `TestEnterWorldSelfCreateMobCarriesTheScore`, suíte do `tmserver` verde), sem merge.

### 01/10/2026 — enquanto o PR #363 aguarda: `tradeedge` e linha de base da etapa 6

- **`tradeedge`:**
  - execução 3: A preso nos canteiros a leste do spawn; correção: rota `ARMIA_EAST` antes de se aproximar de B;
  - execução 4: todos os passos rodaram. Troca desfeita com a bolsa cheia, com o texto "Nao ha espaco no inventario." visto online. Desconexão de A no meio da troca sem nenhuma mudança. Limpeza de 26 itens. Só a regra final reprovou, porque B começou cheio; `checkTradeEdge` foi corrigida, o JSON reavaliado offline passa e `world:checks` fica em 33/0.
- **Etapa 6:**
  - `tools/measure_scene.mjs` e `npm run measure` (instrumentação externa de `FS.open` e `_wyd_tick_client`);
  - [linha de base](evidence/06-paridade/README.md) em Chromium headless, com renderização por software:
    - pronto em 4,4 s a frio e 1,4 s com cache; primeiro quadro em 18,8 s e 15,5 s;
    - 309 MiB a frio e 4,4 MiB com cache;
    - heap JS de 527 MiB e WASM de 180 MiB;
    - CPU do jogo de ~11 ms por quadro, mas ~410 ms entre quadros (renderização por software);
    - a cena abre 50,5 de 305 MiB do pacote.
  - Opções para o preload registradas, a decidir em ADR. O passo mais barato é investigar os ~220 MiB de heap JS além do tamanho do pacote.
- Sem commit.
- **Memória (etapa 6, mesma data):** os 527 MiB do `performance.memory` são o pacote (305 MiB) mais o WASM (180 MiB), contados como backing store de `ArrayBuffer`. Os objetos JS somam ~4 MiB depois da coleta, não há cópia do pacote e os "220 MiB extras" eram o WASM. Por processo, com uma página: renderer 654 MiB, browser 140, GPU 137, utilitários 105 (1.036 no total). Carregar sob demanda economizaria até ~255 MiB por página; a escolha da abordagem fica para uma ADR.
- **Arquivos abertos online (mesma data):** `--trace-files` no harness, com o `tools/fs_trace.mjs` compartilhado com a medição offline. Duas sessões no Railway (`loot` e `paidteleport`, ambas `ok`) abriram juntas 1.968 arquivos, 76,5 de 305 MiB; Noatum acrescentou 2,8 MiB. Opção nova registrada: pré-carregar o conjunto quente e ler o resto sob demanda com XHR síncrono por faixa de bytes (`createLazyFile`), economizando até ~225 MiB por página. [ADR 012](decisions/012-on-demand-asset-loading.md): o operador rejeitou a leitura sob demanda pela rede (travadas), e o preload integral continua. A issue #6 se resolve rodando o harness numa máquina com mais RAM.

### 01/10/2026 (noite) — score após o #363, chat de grupo e nível inicial

- **Pedido do usuário:** executar o orquestrador. No plano aprovado: conferir o #363, chat de grupo, buff e cura, e nível na seleção × no mundo. Na sessão, o usuário adiou buff e cura, e deixou o reinício controlado fora (autorizado via CLI quando entrar).
- **Pré-condições:** deploy `bb798b1b` do `tm-server` em `052cd5fe` (merge do #363), `SUCCESS`; a Railway CLI foi religada à worktree (`railway link`) só para leitura.
- **Servidor (entregas separadas, sem merge nem deploy), clone `external/server-pr`:**
  - [PR #364](https://github.com/Jean1dev/w2pp-OpenWYD/pull/364) (`77ae8f96`): chat de grupo `=` e toggle `partychat`, como o legado. Seis testes novos, cinco falham sem a correção. Patch `patches/server/0003-party-chat.patch` (SHA-256 `92c11fe8…`);
  - [PR #365](https://github.com/Jean1dev/w2pp-OpenWYD/pull/365) (`32e5114a`): criação no nível 0, SELCHAR com o nível armazenado, `playerBaseAC = baseline + level` e migração `0025`. Patch `patches/server/0004-level-zero-seed.patch` (SHA-256 `17bc00ff…`).
- **Cliente:**
  - `tools/verify_world.mjs`: fase `partychat`; `say` com a opção `clear`;
  - `tools/party_checks{,.test}.mjs`: `checkPartyChat`;
  - `tools/world_checks.mjs`: regra da fase;
  - [ADR 013](decisions/013-party-chat-and-level-seed.md), [evidência](evidence/05-gameplay/2026-10-01-partychat-level.md), checklist da etapa 5, matriz e fatia A.
- **Confirmado em teste:** `world:checks` 34/0. Servidor: testes de chat/grupo verdes e `go vet` limpo; falhas preexistentes ou de ambiente registradas na evidência.
- **Confirmado em execução (Railway `052cd5fe`):**
  - `login,enter,second,equip`: dano 28 após o login, 26 sem a arma e 28 com ela;
  - `login,enter,second,partychat` reprovou contra o servidor sem o #364, como esperado: as linhas `=` voltam como `0x0102` e ninguém as recebe. A mesma execução revelou dois defeitos do harness, corrigidos mas não validados online.
- **Não executado:** buff e cura (adiados); `partychat` aprovado (depende do #364); reinício controlado; cliente Windows. Sem rebuild do WASM. Sem commit no repositório do cliente.
- **Próximo passo:** merge e deploy dos #364 e #365 pelo operador; depois, `partychat` e a conferência de "Nv 1" nas duas telas.

### 02/10/2026 — buff e cura com nível ajustado no banco

- **Pedido do usuário:** como o ambiente é de testes, ler a conexão do banco nas variáveis do Railway e ajustar o nível dos personagens para verificar buff e cura.
- **Banco:**
  - DSN `W2PP_DB_DSN` do serviço `db-server` (Postgres externo), só no ambiente do processo;
  - utilitário temporário com `pgx`, fora do Git;
  - escritas transacionais limitadas a uma linha da conta A;
  - BM (id 209) no nível 11 e Foema (id 210) no 16, com a Exp e o HP/MP coerentes com a curva;
  - um afeto residual do Lobo apagado;
  - HP máximo da Foema em 1000 só durante a execução final da Cura, depois restaurado.

  Detalhes na [evidência](evidence/05-gameplay/2026-10-02-buff-cure.md).
- **Arquivos:**
  - `tools/verify_world.mjs`: `--skill` no `learn`; fase `buff`; diagnóstico de combate;
  - `tools/world_checks.mjs`: `checkBuff` e regras da fase;
  - `tools/party_checks.test.mjs`;
  - evidência e checklist da etapa 5.
- **Confirmado em teste:** `world:checks` 35/0.
- **Confirmado em execução (Railway `052cd5fe`):**
  - `classes` 2 e 1 criaram a BM e a Foema;
  - Lobisomem aprendido e usado: MP 126→95, modelo 4→26, HP máx. 115→110 visto por B;
  - Cura aprendida e usada: resposta do servidor `Dam = −100` igual em A e B, MP 146→131.
- **Falhas registradas:**
  - Lobisomem, execução 1: sonda errada (`look_mesh`), corrigida;
  - Cura, execuções 1 e 2: a regeneração encheu o HP antes do lançamento. Na execução 2, sem custo de MP visível, causa não determinada.
- **Em aberto:** modelo humano no relogin com o afeto ativo (hipótese); cura em outro jogador; reinício controlado.
- **Próximo passo:** merge e deploy dos #364/#365; investigar o modelo da BM no relogin; fatia 5.

### 02/10/2026 — PRs #364 e #365 implantados: chat de grupo e nível

- **Servidor:** o usuário integrou o #364 e depois o #365. A CI do #365 reprovava no `gofmt` (linha em branco no fim de `login.go`), corrigido no commit `9483ff94`; todos os jobs ficaram verdes. Deploy `bc7b3923` às 11:01 UTC. `patches/server/0004-level-zero-seed.patch` regenerado com os dois commits (SHA-256 `e47bb333…`).
- **Confirmado em execução:**
  - `login,enter,second,partychat` aprovado na execução 3;
  - o nível aparece igual na seleção e no HUD (6/6), e a defesa sobe 1 (37→38).
- **Falhas registradas:**
  - execução 1 interrompida pelo deploy do #365;
  - execução 2 com todo o chat certo, mas sem sair do grupo, porque o `say` fechava a janela do grupo com Esc. Corrigido com `keepPanels` em `tools/verify_world.mjs`.
- **Migração:** a `0025` foi aplicada, mas o TK de B, online durante o deploy, foi salvo de volta no nível 1. O mesmo `UPDATE` foi reaplicado no banco de testes (1 linha). Em produção real, migrar com os jogadores deslogados.
- **Verificação:** `world:checks` 35/0; evidências sem valores do `.env`.
- **Próximo passo:** modelo da BM no relogin, cura em outro jogador e fatia 5 (reinício controlado).

### 02/10/2026 — BM volta a humano no relogin

- **Pedido do usuário:** investigar.
- **Causa (confirmada em fonte):**
  - o runtime monta o próprio personagem pelo snapshot `0x0114` e, quando ele já existe, ignora o equipamento do `CreateMob` próprio (`TMFieldScene.cpp:18519-18553`);
  - o Go envia no snapshot o item de corpo salvo, e o lobo vai só no `CreateMob` (`equipVisual`);
  - o legado grava a malha da fera em `MOB.Equip[0].sIndex` no `GetCurrentScore`, antes de copiar o `MOB` para o snapshot (`Basedef.cpp:4106`, `ProcessDBMessage.cpp`).
- **Servidor:** [PR #366](https://github.com/Jean1dev/w2pp-OpenWYD/pull/366) (`webclient/transform-login-snapshot`), `patches/server/0005-transform-login-snapshot.patch` (SHA-256 `2f24ca8a…`). O teste novo falha sem a correção; `go vet` limpo, `go test ./tmserver/...` verde e `gofmt` conferido. Sem merge nem deploy.
- **Cliente:** `checkBuff` exige o mesmo modelo após o relogin enquanto a transformação durar; `world:checks` verde.
- **Próximo passo:** merge e deploy do #366; depois, `login,buff --class 2` (a BM já tem o Lobisomem aprendido e na barra).
- **Revisão (02/10, 12:06 UTC):**
  - o usuário integrou o #366; deploy `9d9af882` `SUCCESS`;
  - afeto residual da BM apagado (1 linha);
  - `login,buff --class 2` aprovado: um lançamento com custo de 72 MP pelo eco do servidor, modelo 4→26, HP máximo 110 visto por B;
  - **no relogin, A continua lobo (modelo 26)**.

  O "126 → 95" registrado antes incluía um tick de regeneração.

### 02/10/2026 — fatia 5: reinício controlado

- **Pedido do usuário:** fazer a fatia 5 com o reinício.
- **Confirmado em fonte:** o tm-server salva no logout ou desconexão e no desligamento (`world.go` `shutdown`: personagens em jogo, depois os bancos); não há salvamento periódico.
- **Arquivos:**
  - `tools/verify_world.mjs`: fase `restart`. A compra e deposita com A e B online, sinaliza `.cache/restart-ready.json`, espera `.cache/restart-done.json`, reloga com novas tentativas e compara;
  - `tools/world_checks.mjs`: `checkRestart` e regra da fase;
  - `tools/party_checks.test.mjs`;
  - evidência e checklist.
- **Confirmado em execução (Railway `9d9af882`):**
  - `railway restart -s tm-server -y` às 13:06:18; `sessions_saved=2`;
  - o banco de dados mostrou a compra e o depósito só depois do reinício;
  - A e B relogaram com tudo idêntico;
  - `world:checks` 36/0.
- **Falhas registradas:**
  - primeira chamada com `ARMIA_EAST` antes de definido;
  - segunda tentativa sem detectar a queda (causa não determinada; servidor reiniciado às 12:37:55) e DSN vazia na CLI;
  - a CLI de restart só sai pelo timeout.
- **Próximo passo:** cura em outro jogador; etapa 4 (relogin do cliente Windows); etapas 6–8.

### 02/10/2026 — cura em outro jogador

- **Pedido do usuário:** fazer a cura em outro jogador.
- **Confirmado em fonte:** a Cura tem `BParty = 0` e `Range = 6`; o servidor aceita qualquer jogador no alcance, sem exigir grupo.
- **Arquivos:**
  - `tools/verify_world.mjs`: fase `healother`, com horários por passo;
  - `tools/world_checks.mjs`: `checkHealOther` e regras da fase;
  - `tools/party_checks.test.mjs`;
  - evidência e checklist.
- **Banco de testes:** HP máximo de B em 1000 e depois em 30.000 (HP 100) durante as execuções; restaurado para 100/100.
- **Confirmado em execução (Railway `9d9af882`):** execução 2 aprovada. O eco do servidor traz `Dam = −100` da skill 27 de A em B, igual nas duas páginas; o MP de A cai de 146 para 131; o HP de B sobe de 700 para 920 (cura e regeneração).
- **Falha registrada:** na execução 1, a cura ocorreu no servidor, mas 6 minutos depois de A entrar, quando B já estava cheio.
- **Verificação:** `world:checks` 37/0.
- **Próximo passo:** etapa 4 (relogin do cliente Windows pelo operador) e etapas 6–8.

### 02/10/2026 — chat de guilda

- **Pedido do usuário:** corrigir o `PROGRESS.md` e fazer o chat de guilda.
- **`PROGRESS.md`:** abertura atualizada para 02/10. Os PRs #364–#366 constam como implantados e a cura em outro jogador saiu da lista de itens em aberto.
- **Confirmado em fonte:**
  - o runtime envia `-texto`/`--texto` como `0x0334`, com `MobName` vazio e `Color = 3`, e só mostra a linha como chat de guilda com `Color == 3`;
  - o legado (`_MSG_MessageWhisper.cpp:1426-1468`, `_MSG_MessageChat.cpp:140-150`) entrega a linha à guilda e à aliada (com `--`) e tem o toggle `guildchat`;
  - o Go `9d9af882` responde `0x0102` à linha. Detalhes na [ADR 014](decisions/014-guild-chat.md).
- **Servidor:** [PR #367](https://github.com/Jean1dev/w2pp-OpenWYD/pull/367) (`webclient/guild-chat`, commit `2b714b6c`), `patches/server/0006-guild-chat.patch` (SHA-256 `95c3fae0…`).
  - Grava `Color` em `String[128]`, offset do 7662; o legado grava em `String[96]`, por causa do layout de 100 bytes.
  - Os sete testes novos falham sem a correção.
  - Rodados com Go 1.25.13 local: `go test ./tmserver/internal/handler/ -run 'GuildChat|PartyChat|Whisper|ChatPublic|Guild'` ok; `go vet ./tmserver/...` limpo; `go test ./tmserver/...` com 17 pacotes ok e nenhuma falha; `gofmt` limpo nos arquivos alterados.
- **Cliente/harness:**
  - fase `guildchat` em `tools/verify_world.mjs`;
  - `checkGuildChat` em `tools/party_checks.mjs`, com regras em `tools/world_checks.mjs` e testes em `tools/party_checks.test.mjs`;
  - `world:checks` 39/0.
- **Não executado:** nenhuma execução online. O servidor implantado não tem a correção, e a guilda de teste ainda não foi criada no banco.
- **Limites:** com o canal desligado, o runtime também esconde a linha, então o bloqueio no servidor só é provado pelo teste. Aliança entre guildas e recusa sem guilda ficam só nos testes do servidor, porque não há terceira conta.
- **Próximo passo:** merge e deploy do #367 pelo operador; criar a guilda de teste com A e B no banco; rodar `login,enter,second,guildchat`.

### 02/10/2026 — chat de guilda no Railway

- **Servidor:** o usuário integrou o #367 (CI verde) e autorizou a preparação no banco. Deploy `3ae11009` às 16:30 UTC.
- **Railway CLI:** não estava instalada nesta máquina. Usado o `@railway/cli` via `npx`, com o login já existente em `~/.railway`.
- **Banco:** guilda `WebTeste` (id 1), com o TK de A como líder e o de B como membro, criada às 16:36 por um utilitário temporário fora do Git ([preparação](evidence/05-gameplay/2026-10-02-guildchat.md#preparação-no-banco)).
- **Confirmado em execução (execução 1):**
  - `-` nos dois sentidos e `--`, mostrados com o nome de quem falou e sem o prefixo;
  - com o canal de B desligado, o servidor não enviou a linha de A: 3 de 4 `0x0334` para B nas estatísticas de envio.
- **Falha:** o painel `Guild Chatting : Off/On` não apareceu. O Go envia `0x0101` com `HEADER.ID` igual ao conn, e o 7662 só trata o painel com ID 0 (`TMScene.cpp:1371`).
- **Correção:** [PR #368](https://github.com/Jean1dev/w2pp-OpenWYD/pull/368) (`webclient/guild-chat-panel`, `ab210eb9`), `patches/server/0007-guild-chat-panel-id.patch` (SHA-256 `ecf8d2f8…`). Os dois testes de painel falham sem a correção. `go vet` limpo e `go test ./tmserver/...` com 17 pacotes ok.
- **Achado:** kefra, refino, nightmare, convite de guilda e o relógio `!!` usam o mesmo `w.Send` para o painel e devem estar invisíveis no 7662. Não foi verificado em execução.
- **Arquivos:** evidência, JSON e log sanitizado da execução 1; ADR 014; checklist; patch 0007; este progresso.
- **Próximo passo:** merge e deploy do #368; repetir `login,enter,second,guildchat`.

### 02/10/2026 — painel de configurações (música, efeitos e resolução)

- **Pedido do usuário:** painel de configurações com som, música ambiente e resolução, como no wyd.vektar.tech. Escolhas do usuário: recarregar com confirmação ao trocar a resolução e "ampliar mantendo proporção"; sem tela cheia.
- **Referência:** o Valthera foi só observado (HTML/JS público, sem login, nada copiado), conforme `docs/SOURCES.md`.
- **Confirmado em fonte:**
  - o `Config.bin` (som, música e resolução) só é lido no boot;
  - os managers de áudio só existem com nível > 0;
  - a troca de zona recria o BGM a partir de `m_nMusic`;
  - no WASM, a resolução é o tamanho do canvas.
  Detalhes na [evidência](evidence/07-web/2026-10-02-settings.md).
- **Arquivos:**
  - `patches/openwyd/0023-audio-levels.patch` (exports `wyd_audio_set_levels`/`wyd_audio_get_level`; managers sempre criados no WASM; nível 0 = mudo);
  - `web/settings.js`, `web/settings.css`;
  - `web/client.{html,js}`, `web/local-scene.{html,js}`;
  - `tools/verify_settings_ui.mjs`, `package.json` (`settings:ui`).
- **Comandos e resultados:**
  - `python tools/fetch_pinned.py upstream` e `apply_openwyd_patches.py` a partir do reset: 0001–0023 aplicados;
  - `docker build --target wasm`: exit 0, com os exports presentes no `runtime.js`;
  - runtime real sem dataset: resolução 1024×768 e níveis da página aplicados no `NewApp`; o boot para em `BASE_InitializeBaseDef`, sem assets;
  - `npm run settings:ui`: 36/36 em Chromium e Firefox, três vezes.
- **Não executado:**
  - áudio real, Field e servidor, porque esta máquina não tem dataset, emsdk ou Go locais;
  - nenhum deploy;
  - o teste de UI usa runtime falso e não é evidência de gameplay.
- **Próximo passo:** roteiro online da [evidência](evidence/07-web/2026-10-02-settings.md#próximo-passo).

### 02/10/2026 — fim do Basic Auth: acesso pela conta do portal

- **Pedido do usuário:** remover o prompt de usuário e senha da entrada e definir como o jogador sem conta se cadastra. O cadastro é feito pelo site.
- **Decisão do operador:** o acesso público total foi recusado depois de ver as consequências (licença dos assets, egress, abuso e `wyd_debug_*`). Escolhido o gate por conta do portal ([ADR 015](decisions/015-portal-account-gate.md)).
- **Confirmado em fonte:**
  - o prompt é o `basicAuth` do gateway;
  - o portal `wyd-plataforma` já tem `/api/signup`, `/api/login` e `iron-session`.
- **Arquivos:**
  - gateway: `internal/config/{config,env,env_test}.go`, `internal/relay/{portalauth,portalauth_test,relay}.go`, `cmd/wydgateway/main.go`;
  - docs: ADR 015, `deploy.md` e a [evidência](evidence/08-entrega/2026-10-02-portal-gate.md);
  - portal, em worktree separada `wyd-plataforma-jogar` sem commit: `src/lib/play-ticket{,.test}.ts`, `src/app/jogar/route.ts`, `AuthTabs.tsx`, `TopNav.tsx` e `app/download/page.tsx`.
- **Comandos e resultados:**
  - gateway: `go vet`, e `go test ./...` ok;
  - portal: `pnpm test` 17/17, e `lint`, `typecheck` e `build` ok;
  - fluxo HTTP local entre os dois aprovado, com replay recusado.
- **Variáveis registradas por CLI:**
  - Railway: `WYD_PORTAL_URL` e `WYD_PORTAL_TICKET_SECRET`, com `--skip-deploys`;
  - Vercel (`wyd`, Production): `PLAY_TICKET_SECRET` e `WEBCLIENT_URL`.
  O `WYD_BASIC_AUTH_*` deve ser removido junto com o deploy desta versão.
- **Não executado:** deploy, login real no portal (sem `web-api` local), navegador real e duas sessões.
- **Próximo passo:** PRs, depois a troca descrita na ADR 015 e a verificação no domínio público.
- **Implantação (mesmo dia, a pedido do usuário):**
  - merge do portal [#34](https://github.com/Jean1dev/wyd-plataforma/pull/34), com produção do Vercel confirmada;
  - merge do gateway [#19](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/pull/19);
  - `WYD_BASIC_AUTH_*` removidas do Railway; deploy `3504ab4c` em SUCCESS.
  O domínio público responde como esperado ([evidência](evidence/08-entrega/2026-10-02-portal-gate.md#produção-02102026)). Falta o login real pelo portal.

### 02/10/2026 — build público sem `wyd_debug_*` e IP do cliente

- **Pedido do usuário:** aplicar as recomendações de antes de abrir: `wyd_debug_*` atrás de flag e `WYD_MAX_CONNS_PER_IP`.
- **Confirmado em fonte:**
  - as `wyd_debug_*` chegam ao WASM pela lista `EXPORTED_FUNCTIONS` do link e por `KEEPALIVE`;
  - `client.js` e `settings.js` não usam nenhuma; só `local-scene.js` usa `wyd_debug_camera_*`.
- **Confirmado em execução:** o gateway registrava um IP de borda e não o IP do cliente, porque a última entrada do `X-Forwarded-For` é um salto do Railway.
- **Arquivos:**
  - `patches/openwyd/0024-public-build-exports.patch`;
  - `tools/check_public_exports.py`, `tools/test_public_exports.py`, `tools/assemble_site.py`;
  - `Dockerfile`, `.github/workflows/ci.yml`;
  - gateway: `config`, `env`, `relay`, `portalauth` e testes;
  - ADR 016 e `deploy.md`.
- **Comandos e resultados:**
  - patches 0001–0024 aplicados num checkout limpo;
  - testes do verificador: 4/4;
  - `assemble_site --public` com link falso: o build limpo passa, sem a cena offline; o build com `wyd_debug_selchar_pin` falha;
  - gateway: `go vet` e `go test ./...` passam.
- **Railway:** `WYD_FORWARDED_FOR=first` e `WYD_MAX_CONNS_PER_IP=4` registradas com `--skip-deploys`.
- **CI do PR #20:** a 1ª versão (`-sEXPORT_KEEPALIVE=0`) foi barrada pelo verificador, com 13 `wyd_debug_*` `KEEPALIVE` ainda exportadas. Corrigido no próprio código: `WYD_DEBUG_EXPORT` sem `KEEPALIVE`, exportação pelo nome e `--public` filtrando a lista.
- **Não executado:** build real da imagem (sem Docker ou emsdk locais), que fica com a CI e o Railway.
- **Produção (mesmo dia, a pedido do usuário):** merge do PR #20 (`384d8ef`) e deploy `de59e41b` em SUCCESS.
  - Log com `forwardedFor="first"`. Foi registrado o IP real da máquina de teste, e um `X-Forwarded-For` forjado foi ignorado.
  - O `.wasm` publicado tem 0 `wyd_debug_*` e todas as funções usadas pela página (946 exports).
  - `/local-scene.html` → 404.
  - O operador testou o login pelo portal e o jogo no navegador: OK.

### 02/10/2026 — tela de carregamento (etapa 7)

- **Pedido do usuário:** uma tela de carregamento amigável, como a do wyd.vektar.tech. Plano aprovado; visual próprio, sem copiar o site.
- **Confirmado em fonte:** o `file_packager.py` do Emscripten 6.0.0 informa o progresso por `Module.setStatus("Downloading data... (recebidos/total)")` e marca `fromCache` antes de ler o IndexedDB. A falha de download fica sem tratamento, e a página antes travava em "Carregando…".
- **Arquivos:** `web/client.html`, `web/client.js` (objeto `Loader`), `web/loader.css`, `tools/verify_loading_ui.mjs`, `package.json` (`loading:ui`) e a [evidência](evidence/07-web/2026-10-02-loading-screen.md).
- **Comandos e resultados:**
  - `npm run loading:ui`: 36/36 em Chromium e Firefox, com runtime e pacote falsos;
  - `npm run settings:ui`: 36/36 (regressão).
- **Não executado:** `assets:cache`, `--real` e Railway. Este worktree não tem emsdk nem dataset.
- **Próximo passo:** validar com o pacote real e rede lenta; depois do deploy, o operador confere no domínio público.

### 02/10/2026 — seleção automática do servidor (etapa 7)

- **Pedido do usuário:** o jogador entra pelo portal; o `serverlist.bin` tem vários grupos, mas todos apontam para o mesmo destino, então o jogo deve pular a lista. O teste deve usar o tm-server via CLI do Railway. Pular conta e senha exige mudar o servidor e não foi feito.
- **Arquivos:**
  - `patches/openwyd/0025-selectserver-auto.patch` (`wyd_selectserver_auto`: destino único; aciona grupo, canal e OK originais);
  - `web/client.js`;
  - `tools/verify_auto_server.mjs` (`npm run auto:server`), `tools/verify_loading_ui.mjs`;
  - a [evidência](evidence/07-web/2026-10-02-auto-server.md).
- **Toolchain local montada:** emsdk 6.0.0 (`d223ae7`), Go 1.25.13 com hash conferido e assets importados de `Client-aws`.
- **Comandos e resultados:**
  - runtime linkado com 0 indefinidos;
  - `auto:server` **8/8 com o runtime real** contra `reseau.proxy.rlwy.net:56950` (destino lido com a CLI do Railway): 3 canais e 1 destino; login aberto sem clique; `0x020D` digitado pelo teclado; o tm-server respondeu `0x0102` "Conta inexistente.";
  - `loading:ui` 42/42; `settings:ui` 36/36; `test_public_exports` 4/4.
- **Não executado:** relogin com conta real, Firefox com runtime real e build `--public` local.
- **Próximo passo:** PR, CI verde e deploy; conferir pelo portal.

### 02/10/2026 — login automático pela conta do portal (ADR 017)

- **Pedido do usuário:** pular conta e senha para quem já entrou no portal (item 2). Plano aprovado: código de uso único, teste de ponta a ponta numa stack local com Docker e issue separada sobre o webserver exposto (Jean1dev/w2pp-OpenWYD#369).
- **Entregas:**
  - servidor `Jean1dev/play-code` (`84272fc9`): `internal/playcode`, migração 0026, `IssuePlayCode` com asserção HMAC e `dbserver AccountLogin`;
  - portal `Jean1dev/play-code` (`0d75da2`): `/jogar` com código no ticket;
  - este repositório: handoff no gateway, patch 0026, `web/client.js`, `tools/verify_auto_login.mjs`, ADR 017 e a [evidência](evidence/07-web/2026-10-02-auto-login.md).
- **Resultados:**
  - unitários e integração verdes (as falhas de `npctemplate` já existiam no Windows);
  - `loading:ui` 52/52;
  - `auto:server` contra o Railway 8/8;
  - **`auto:login` 9/9 na stack local**: login automático até a seleção de personagem, handoff de uso único, nada vazado e, sem segredo, login manual.
- **Observado:** a primeira execução de ponta a ponta deu `DeadlineExceeded` no dbserver. A hipótese é a ordem de boot do compose somada à CPU disputada; a execução seguinte passou, e os detalhes estão na evidência.
- **Próximo passo:** PRs nos três repositórios; deploy na ordem servidor, portal, cliente web, com `W2PP_PLAY_CODE_SECRET`/`PLAY_CODE_SECRET`.
