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

## 06/10/2026: com o #368 implantado (tm-server `25016ab3`)

O ambiente local de 02/10 e as contas de teste de 06/10 não existiam mais nesta máquina (ficavam num worktree removido). Por isso:
- o ambiente foi remontado do zero;
- duas contas novas foram criadas no portal, com credenciais só no `.env`;
- os personagens foram criados com `login,create,enter,second` (ok).

**Preparação no banco**, com o mesmo utilitário e as mesmas regras (DSN só no ambiente do processo, uma transação, cada escrita em exatamente uma linha, contas offline). Decisão do usuário: adicionar as contas novas sem remover as antigas. Às 17:20:15 UTC, o TK de A (id 218) entrou como líder (9) e o de B (id 219) como membro (0). A guilda 1 passou de 2 para 4 membros.

**Execução 2 (17:20–17:37 UTC): o chat foi aprovado de novo, mas a regra do toggle reprovou.** A→B, B→A e `--` chegaram com o remetente e sem o prefixo, a linha com B desligado não chegou e voltou a chegar depois de religar. A regra `guildchat off not confirmed` reprovou outra vez: o harness esperava o painel com o texto `Guild Chatting : Off`.

**Causa, confirmada em fonte e em execução:** era defeito do harness.
- O runtime mostra o texto cru no painel por 4 s (`TMScene.cpp:1603`);
- só com o texto exato ele chama `SetGuildChat`, que inverte o botão (`TMScene.cpp:1660-1669`, `TMFieldScene.cpp:14989`);
- depois, grava na lista de chat as strings localizadas 450 + 447/446;
- o fallback digitado (`say`) volta depois que o painel já sumiu.

A correção não muda `web/` nem o comportamento do runtime:
- `patches/openwyd/0028-guild-chat-probe.patch`: probe só de leitura `wyd_field_guild_chat_selected()`;
- a fase passa a confirmar pela inversão do botão;
- `checkGuildChat` exige que o On devolva o botão ao estado de antes do Off.

**Execução 3 (17:48–18:06 UTC), [JSON](2026-10-06-guildchat-run3.json):**
- o chat passou nos três sentidos, e a linha com B desligado ficou bloqueada (`silenced.heard = false`, `restored.heard = true`);
- no Off o botão foi de 1 para 0, e no On de 0 para 1. Isso confirma em execução que o painel `0x0101` agora chega com ID 0 e é reconhecido (o #368 funciona);
- a execução ainda usava a regra intermediária (botão **e** painel visível) e reprovou, porque o painel já tinha sumido;
- **o JSON reavaliado offline com a regra final passa** (`checkGuildChat`, 41/41 em `npm run world:checks`);
- protocolo limpo e sem erros de página. A execução 2 do harness tinha sido encerrada pelo Claude Code por falta de memória; esta rodou depois de fechar Chrome, Insomnia e Adobe Collab Sync.

**Limitação:** nenhuma execução online passou com a regra final de ponta a ponta. A aprovação vem da reavaliação offline de uma execução real.

## Pendente

- Opcional: uma execução de `login,enter,second,guildchat` com a regra final.
- Quando o item for fechado, decidir se a guilda de teste fica no banco ou é removida. O `guildprep restore` remove a guilda inteira, então os personagens antigos 204/205 precisam ser tratados à parte.
