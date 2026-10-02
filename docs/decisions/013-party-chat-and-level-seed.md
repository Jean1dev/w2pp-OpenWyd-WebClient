# ADR 013: chat de grupo e nível inicial no servidor (etapa 5)

Data: 01/10/2026. Estado: as duas correções do servidor estão **confirmadas em teste** e abertas nos PRs [#364](https://github.com/Jean1dev/w2pp-OpenWYD/pull/364) (chat de grupo) e [#365](https://github.com/Jean1dev/w2pp-OpenWYD/pull/365) (nível), **sem merge nem deploy**. A lacuna do chat de grupo está **confirmada em execução** no Railway `052cd5fe`.

## Contexto

O checklist da etapa 5 tinha o chat de grupo pendente e uma divergência de nível entre telas: o mesmo personagem aparece como "Nv 1" na seleção e "Nv 2" no mundo ([fatia A](../evidence/05-gameplay/2026-10-01-slice-a.md#score-no-snapshot-de-login-361)). Os dois são lacunas do servidor. Pelas invariantes, o cliente e o gateway não ganham regra de jogo.

## Chat de grupo

### Fontes

- **Runtime (confirmado em fonte):** `TMFieldScene::InsertInChatList` envia `MSG_MessageWhisper` com `MobName` vazio e o texto com o prefixo `=`. Fora de grupo, o próprio cliente não envia (`m_nNumItem <= 0`). Ao receber, mostra `[nome]> texto` sem o `=`. O botão original `B_CHAT_PARTY` (65678) envia `MSG_MessageChat` com `partychat`.
- **Legado (confirmado em fonte):** região "Chat Party" de `_MSG_MessageWhisper.cpp:1470-1510`.
  - `MobName` passa a ser o nome de quem fala.
  - O líder recebe, a menos que seja quem falou.
  - Os membros do `PartyList` do líder recebem, menos quem falou e quem desligou o canal.
  - O toggle está em `_MSG_MessageChat.cpp:117-126` e responde "Party Chatting : Off/On".
- **Go `052cd5fe` (confirmado em fonte e em execução):** `messageWhisper` trata o `MobName` vazio como destinatário, responde `NoticeNotConnected` (`0x0102`) e não entrega a ninguém. `partychat` vira fala pública.

### Decisão

- **Servidor (PR #364, `patches/server/0003-party-chat.patch`):** `partyChat` porta a região do legado e `Session.PartyChat` guarda o toggle.
  - Não modelados: `MuteChat`, que não existe no Go, e a linha `chat_party` do log. O texto nunca vai para o log.
  - Testes em `party_chat_test.go`: membro → líder, líder → membro, nome forjado, toggle, sem grupo e depois da saída. Cinco dos seis falham sem a correção.
- **Dialeto:** sem mudança, porque o `0x0334` já é traduzido nos dois sentidos (160↔158, [ADR 008](008-shop-cargo-chat-dialect.md)).
- **Harness:** fase isolada `partychat` (`login,enter,second,partychat`) e `checkPartyChat` em `tools/party_checks.mjs`.
  - A e B formam o grupo e cada um fala com `=`.
  - O outro precisa mostrar a linha com o nome de quem falou, e quem falou não pode receber aviso.
  - B desliga o canal pelo botão 65678: a fala de A não chega. B religa e a fala volta a chegar.
  - B sai pelo "Sair do Grupo": o runtime não envia mais a linha.
  - A caixa de chat reabre com o prefixo `=`, por isso o harness apaga o conteúdo antes de digitar.

## Nível inicial

### Fontes

- **Legado (confirmado em fonte e nos dados):** a criação copia `g_pBaseSet` (`CFileDB.cpp:984-993`; o Arch também, em `:1448`). Os templates `Release/DBsrv/run/BaseMob/{TK,FM,BM,HT}` têm `BaseScore.Level = 0` em @44, com Ac 4 e Damage 5. A virada Celestial zera o nível com Ac 230 (`_MSG_UseItem.cpp:3124-3135`). Cada nível soma +1 de Ac (`CMob.cpp:1133`).
- **Runtime 7662 (confirmado em fonte):** soma 1 nas duas telas (`TMSelectCharScene.cpp:1018`, `TMFieldScene.cpp:4230`).
- **Go `052cd5fe` (confirmado em fonte):**
  - o dbserver cria com `Level: 1`;
  - `selCharWireLevel` (commit `2a2c4a4`) envia `level − 1` só na seleção;
  - `playerBaseAC` usa `baseline + (level − 1)`;
  - a curva é a do legado: `applyLevelUps` sobe enquanto `Exp ≥ g_pNextLevel[level+1]`.

  Por isso, quem já subiu de nível tem nível e Exp coerentes com o legado. Só a semente está errada: no Go, o nível 1 cobre Exp 0–1123, que o legado divide entre o nível 0 (0–499) e o nível 1.

### Decisão

- **Servidor (PR #365, `patches/server/0004-level-zero-seed.patch`):**
  - criação no nível 0;
  - SELCHAR com o nível armazenado;
  - `playerBaseAC = baseline + level`;
  - migração `0025`, que leva ao nível 0 só os personagens em nível 1 com Exp < 500.
- **Efeitos para o operador decidir:**
  - a migração mexe em dados vivos;
  - todo personagem acima do nível 0 ganha +1 de Ac (valor do legado);
  - a prévia da seleção de quem já subiu passa a mostrar um nível a mais, igual ao mundo.
- **Cliente:** nenhuma mudança. O runtime já segue o legado.

## Consequências

- Até o merge e o deploy do #364, o chat de grupo fica **bloqueado pelo servidor** no checklist. A fase `partychat` reprova de propósito contra o `052cd5fe`.
- Até o #365, o HUD continua mostrando um nível a mais que a seleção em personagens novos.
- A falha de `TestTransformExpiryRevertsMesh` (instável também no `main`) e as falhas de `dbserver/cmd` e `npctemplate` (Windows) ficam registradas nos PRs. Nenhuma delas é causada por estas mudanças.
