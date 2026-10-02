# ADR 014: chat de guilda no servidor (etapa 5)

Data: 02/10/2026. Estado: o PR [#367](https://github.com/Jean1dev/w2pp-OpenWYD/pull/367) foi integrado e implantado (`3ae11009`). O chat de guilda está **confirmado em execução** nos dois sentidos, com `--`, e com o bloqueio do toggle no servidor ([evidência](../evidence/05-gameplay/2026-10-02-guildchat.md)). O painel do toggle não aparece no cliente porque o Go envia `0x0101` com `HEADER.ID` diferente de 0. A correção, **confirmada em teste**, está no PR [#368](https://github.com/Jean1dev/w2pp-OpenWYD/pull/368), sem merge.

## Contexto

O chat de guilda era o único item do checklist da etapa 5 que nunca tinha sido exercitado. É uma lacuna do mesmo tipo que o chat de grupo antes do #364 ([ADR 013](013-party-chat-and-level-seed.md)). Pelas invariantes, nem o cliente nem o gateway recebem regras de jogo.

## Fontes

- **Runtime 7662 (confirmado em fonte, `TMFieldScene.cpp`):**
  - `InsertInChatList` envia `MSG_MessageWhisper` com `MobName` vazio, o texto com o prefixo `-` (ou `--` para a aliança) e `Color = 3` (`:2528-2540`);
  - ao receber, a linha só é tratada como chat de guilda com `String[0] == '-'` e `Color == 3`. Nesse caso aparece na lista de chat como `[nome]> texto`, sem o prefixo, e somente se o botão de guilda estiver selecionado (`:17885-17898`). Sem `Color == 3`, uma linha começando com `-` cai no memorando de sussurro (`m_pHelpList[3]`), fora da lista de chat;
  - o botão `B_CHAT_GUILD` (65680) envia `MSG_MessageChat` com `guildchat` (`:3840-3847`);
  - `TMScene.cpp:1660-1669` compara o texto exato do painel, `Guild Chatting : Off` ou `On`, para inverter o botão. Também troca a linha da lista de chat pelo texto localizado (450 + 446/447). O painel continua mostrando o texto cru.
- **Legado do servidor (confirmado em fonte, `Source/Code/TMSrv` em `w2pp-OpenWYD`):**
  - região "Chat Guild" de `_MSG_MessageWhisper.cpp:1426-1468`:
    - `MobName` passa a ser o nome de quem fala e `String[MESSAGE_LENGTH] = 3`;
    - quem não tem guilda recebe `_NN_Only_Guild_Member_Can` (104: "Só poderá usar o Chat Guildas se pertence a alguma.");
    - recebe a linha todo `USER_PLAY` da mesma guilda, menos quem falou e quem tem `Guildchat` ligado;
    - com `--`, também recebem os membros da guilda `g_pGuildAlly[guild]`. A relação é dirigida, da guilda de quem fala para a aliada;
  - toggle em `_MSG_MessageChat.cpp:140-150`: `SendClientMessage` (painel) com `Guild Chatting : Off/On`.
  - O `OpenWyd/Servidor` (`beb9f69b`) usa `OFF/ON` em maiúsculas, texto que o runtime não reconhece. Ficou valendo a fonte que acompanha o 7662 e casa com o runtime.
- **Layout (confirmado em fonte):** no legado, o `MSG_MessageWhisper` tem `String[100]`, por isso `String[96]` é a posição da cor nesse layout. No 7662, o `Color` fica no offset 156 do quadro, que é o `String[128]` do corpo do Go (`static_assert` em `client/dialect/WydDialect.cpp`). O dialeto web preserva os 158 bytes nos dois sentidos.
- **Go `9d9af882` (confirmado em fonte):** `messageWhisper` só desvia o prefixo `=`. Uma linha `-` com `MobName` vazio é tratada como sussurro para um nome vazio e responde `NoticeNotConnected` (`0x0102`). `guildchat` vira fala pública.

## Decisão

- **Servidor (PR #367, `patches/server/0006-guild-chat.patch`, SHA-256 `95c3fae0…`):**
  - `guildChat` porta a região do legado e grava `Color = 3` em `String[128]`; um corpo curto é completado até `Color`;
  - `Session.GuildChat` guarda o toggle, que responde com o painel do legado;
  - não modelada: a linha `chat_guild` do log. O texto nunca vai para o log;
  - testes em `guild_chat_test.go`: os dois sentidos na guilda, `--` para a aliada, aliança dirigida, `--` sem aliança, sem guilda, toggle e corpo curto. Os sete falham sem a correção.
- **Dialeto:** sem mudança.
- **Harness:** fase isolada `guildchat` (`login,enter,second,guildchat`) com `checkGuildChat` em `tools/party_checks.mjs`.
  - A e B falam com `-`; A fala com `--`;
  - o outro lado precisa mostrar a linha na lista de chat, com o nome de quem falou e sem o prefixo. Isso prova o `Color = 3`. Quem falou não pode receber `0x0101`/`0x0102`;
  - B usa o botão 65680: o painel precisa mostrar exatamente `Guild Chatting : Off`, a linha de A não aparece, e depois `On` e a linha volta.
- **Preparação (ambiente de testes):** A e B precisam estar na mesma guilda. Criar pelo jogo custa 100.000.000 de ouro e exige clã 7 ou 8, então a guilda de teste é criada no banco (`guild`, `guild_member` e `character.guild_id/guild_level`). A fase não depende do id escolhido.

## Consequências

- Até o merge e o deploy do #367, o chat de guilda fica **bloqueado pelo servidor** no checklist.
- Limite da prova online pelo cliente: com o canal desligado, o runtime também esconde as linhas de guilda, porque o painel inverte o botão. A tela de B, sozinha, não distingue o bloqueio do servidor do filtro local. Na execução 1, as estatísticas de envio do servidor fecharam esse ponto: B recebeu 3 das 4 linhas de A, e faltou a enviada com o canal desligado.
- Sem terceira conta no ambiente de testes, a aliança (`--` para outra guilda) e a recusa sem guilda ficam só nos testes do servidor.

## Revisão de 02/10/2026: painel com `HEADER.ID` 0

- **Confirmado em fonte:** o 7662 só trata `MSG_MessagePanel` com `HEADER.ID == 0` (`TMScene.cpp:1371`). O legado `SendClientMessage` zera o ID (`SendFunc.cpp:27-43`). O `w.Send` do Go grava o conn da sessão.
- **Confirmado em execução (execução 1):** o servidor enviou dois `0x0101` para B, e o painel `Guild Chatting : Off/On` não apareceu.
- **Decisão:**
  - PR #368 (`patches/server/0007-guild-chat-panel-id.patch`, SHA-256 `ecf8d2f8…`): `sendClientMessage` com ID 0 nos três painéis do chat de guilda;
  - os outros envios de `MsgMessagePanel` (kefra, refino, nightmare, convite de guilda, relógio `!!`) têm o mesmo defeito e ficam para outra entrega.
