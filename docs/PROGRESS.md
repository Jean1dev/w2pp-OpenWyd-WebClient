# Progresso

Atualização: 28/09/2026. Auditoria em andamento. O runtime do Alan roda no navegador, conectado por gateway próprio ao tm-server do operador no Railway: o login real chega à seleção de personagem. Seleção de personagem, entrada no Field com servidor, duas sessões e gameplay ainda não foram provados.

| Etapa | Estado | Evidência |
|---|---|---|
| 1 Auditoria | Em andamento | [Fontes, layouts, build e assets](evidence/01-auditoria/README.md) |
| 2 Build e cena | Em andamento | [Cena real no navegador](evidence/02-build/README.md) |
| 3 Protocolo | Em andamento | [Gateway, vetores, dialeto e login real](evidence/03-protocolo/README.md) |
| 4 Login e mundo | Pendente | — |
| 5 Gameplay | Pendente | — |
| 6 Paridade | Pendente | — |
| 7 Experiência web | Pendente | — |
| 8 Entrega | Pendente | — |

## Próxima ação

1. Etapa 4 (`prompts/04-login-mundo.md`): criar personagem, passar pelo PIN (atenção: numa conta sem PIN, a primeira verificação **define** o PIN), entrar no Field com o `CNFCharacterLogin` real e mapear os pacotes que hoje são descartados ao entrar no mundo (`UpdateScore`, `UpdateEtc`, `SendItem`, `PKInfo`…), guiado pela lista de opcodes do probe. Depois, duas sessões e relogin.
2. Fechar a etapa 3: prova ponta a ponta dos pacotes já traduzidos só em teste unitário (CNFCharacterLogin, CreateMob, CNFNew/Delete, AccountSecure); exibir o aviso `0x102`; apagar a senha do controle de edição da cena.
3. Fechar a etapa 1: consumidores ainda assinalados na [matriz](compatibility.md).

A lacuna de conteúdo de terreno ([known-asset-gaps.json](evidence/02-build/known-asset-gaps.json)) é dependência externa do operador, não trabalho de código: o cliente 7662 fornecido não contém os níveis de textura que o runtime 769 abre. Decidir entre obter os arquivos, fixar o runtime em um nível disponível ou aceitar a degradação — nenhuma substituição local reproduz o asset.

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

Estados permitidos: Pendente, Em andamento, Bloqueada (motivo específico), Validada. Uma etapa parcialmente testada não é Validada.
