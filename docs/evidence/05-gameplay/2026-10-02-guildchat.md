# Etapa 5: chat de guilda no Railway (02/10/2026)

- Railway `tm-server` `3ae11009` (PR [#367](https://github.com/Jean1dev/w2pp-OpenWYD/pull/367)), `ClientVersion=12000`;
- fonte, decisão e limites: [ADR 014](../../decisions/014-guild-chat.md);
- comando: `node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,guildchat`.

## Preparação no banco

Feita com autorização do usuário (ambiente de testes), como o ajuste de nível do buff e da cura ([buff e cura](2026-10-02-buff-cure.md#preparação-no-banco)):

- DSN lida da variável `W2PP_DB_DSN` do `db-server` por `railway variables --json`, só no ambiente do processo e nunca impressa;
- utilitário temporário em Go, fora do Git, com o `pgx` v5.10.0 de mesmo hash do `go.sum` do servidor;
- uma transação, e cada escrita precisa afetar exatamente uma linha;
- às 16:36:15 UTC, guilda `WebTeste` (id 1) criada em `guild`. O TK de A (id 204, slot 0) entrou como líder (`guild_level` 9) e o TK de B (id 205, slot 0) como membro (0), em `guild_member` e em `character.guild_id/guild_level`;
- antes disso, A e B estavam sem guilda e nenhum dos dois estava online.

## Execução 1 (16:36–16:55 UTC): chat aprovado, painel do toggle invisível

[JSON](2026-10-02-guildchat-run1.json), [log do servidor](2026-10-02-guildchat-run1-server.txt).

**Confirmado em execução:**
- **A → B (`-`)**, **B → A (`-`)** e **A → B (`--`)**:
  - cada linha sai como `0x0334`;
  - o outro lado a mostra na lista de chat com o nome de quem falou e **sem o prefixo**. Pelo runtime, isso só acontece com `Color == 3`;
  - quem falou não recebe aviso (`0x0101`/`0x0102`).
- **Toggle:**
  - o botão 65680 não foi alcançado pelo harness. O fallback digitado enviou `guildchat` como `0x0333`, o mesmo que aconteceu no `partychat`;
  - a linha de A com B desligado não apareceu, e a linha depois de religar apareceu.
- **Bloqueio no servidor, pelo log:**
  - A enviou quatro linhas de guilda (16:42, 16:46, 16:50 com B desligado, 16:54);
  - as estatísticas de envio do servidor registram três `0x0334` para B (conn 2) e um para A (a linha de B);
  - logo, **a linha das 16:50 não saiu do servidor**. Isso confirma em execução o que a ADR 014 dava como coberto só pelo teste.
- Saúde de protocolo limpa nas duas páginas.

**Falha (regra `guildchat off not confirmed`):**
- o servidor enviou os dois painéis (`0x0101:2` para B nas estatísticas), mas o runtime não os mostrou;
- **causa, confirmada em fonte:** o 7662 só trata `MSG_MessagePanel` com `HEADER.ID == 0` (`TMScene.cpp:1371`), e o `SendClientMessage` do legado zera o ID (`SendFunc.cpp:27-43`). O `w.Send` do Go grava o conn da sessão;
- correção no PR [#368](https://github.com/Jean1dev/w2pp-OpenWYD/pull/368) (`sendClientMessage` com ID 0). `TestGuildChatToggle` e `TestGuildChatOutsideGuild` passam a exigir ID 0 e falham sem a correção.
- **Achado:** os demais envios de `MsgMessagePanel` do Go têm o mesmo defeito: `kefra.go:47`, `refine_feedback.go:32`, `nightmare.go:122`, `guild.go:69/117/309` e a linha de relógio `!!` em `chat.go`. Ficam fora do #368.

## Pendente

- Merge e deploy do #368 e uma nova execução da fase, sem mudar a preparação do banco.
- Quando o item for fechado, decidir se a guilda de teste fica no banco ou é removida (`guildprep restore`).
