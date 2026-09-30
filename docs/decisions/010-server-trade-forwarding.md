# ADR 010 — Troca P2P: entrega no servidor e mapeamento no dialeto (etapa 5, fatia 4)

Data: 30/09/2026. Estado: servidor e dialeto **confirmados em teste** local; **não publicado** no Railway; troca **não executada online**. Substitui a parte "troca" da [ADR 009](009-party-dialect-and-trade-block.md).

## Contexto

A ADR 009 bloqueou a troca porque `trade.go` (servidor `98286fdf`) não encaminhava a oferta, respondia com um payload provisório (`tradeResultPayload`, marcado `UNVERIFIED`) e não reenviava o inventário. O usuário escolheu fazer a entrega separada no servidor.

## Fontes

- **Legado (confirmado em fonte):** `w2pp-OpenWYD` `8f65f35a`, `Source/Code/TMSrv/_MSG_Trade.cpp`, `Server.cpp:8114` (`RemoveTrade`), `SendFunc.cpp:1642` (`SendCarry`) e `Basedef.cpp:5244` (`BASE_CanTrade`). Código GPL-2.0, usado só como referência de comportamento; nada copiado para este repositório.
  - Cada oferta aceita é reenviada ao parceiro com `ID = parceiro` e `OpponentID = remetente`. É isso que abre e atualiza a janela do outro lado.
  - Uma alteração zera `MyCheck` dos dois lados. Um item já ofertado, ou um valor diferente de zero, não pode mudar.
  - O primeiro `MyCheck` responde `_MSG_CNFCheck` (`0x0386`) ao remetente e reenvia a oferta marcada. O segundo troca, envia `SendCarry` (`0x0185`, com Coin) aos dois, chama `SaveUser` nos dois e `RemoveTrade` (`0x0384`) nos dois.
- **Runtime (confirmado em fonte):** `TMHuman::OnPacketTrade/QuitTrade/CNFCheck` já tratam `0x0383/0x0384/0x0386` no layout clássico de 156 bytes. O aceite (`TMFieldScene.cpp`, caixa 601) reenvia a oferta vazia do solicitante, com `CarryPos = -1` e o próprio `OpponentID`.
- **Layout — divergência registrada:** no `Basedef.h` do legado, `MSG_Trade` fica fora de `#pragma pack(1)`, o que dá 156 bytes no MSVC x86. O servidor Go usa 154 empacotados, com dinheiro @147, check @151 e oponente @152. É o mesmo padrão já aceito em `MSG_Sell` (18) e `MSG_MessageWhisper` (158). Como o servidor é a referência de compatibilidade com o 7662, o layout **não** foi alterado. O dialeto traduz. Confirmar no binário 7662 continua pendente (hipótese).

## Decisão — servidor (`patches/server/0001-trade-forwarding.patch`)

Aplicada no checkout `external/server`, branch local `webclient/trade-forwarding`, base `98286fdf`. Não houve commit, porque o índice do checkout referencia um blob ausente no object store. O patch é a entrega.

- `trade.go`: implementa o fluxo legado acima, dentro de `World.Run`, sem locks.
  - Valida a oferta contra o carry: slot acessível, sem repetição, item idêntico ao do carry (memcmp) e sem `EF_NOTRADE`.
  - Revalida a oferta do parceiro, recusa `MyCheck` sobre dados diferentes dos já encaminhados e limita valor e ouro final a 2G.
  - A troca continua atômica (valida tudo e depois aplica tudo, com rollback).
  - Remove `tradeResultPayload`.
  - Uma recusa responde `0x0384` mesmo antes de haver troca registrada (`rejectTrade`), como o `RemoveTrade` legado.
- `party.go` (`SessionEnd`): uma desconexão cancela a troca e avisa o parceiro.
- `protocol/types.go`: `MsgCNFCheck = 0x0386`.
- `world/session.go`: `TradeState` guarda a oferta completa (itens, `InvenPos`, valor).
- **Divergências do legado, mantidas de propósito:**
  - trava de modo PK, bloqueio de sussurro e regras de itens de guilda não foram portados (o servidor também não os tinha);
  - uma troca que falha por falta de espaço ou ouro cancela a troca e avisa com `NoticeNoEmptySlot`, em vez de deixar as duas janelas marcadas.

## Decisão — dialeto

| Opcode | Entrada | Saída |
|---|---|---|
| `0x0383` | 154 → 156 por campo; oponente 1..999, check 0/1, valor 0..2G, slot −1..63, índice ≥ 0, slot −1 só com item vazio | 156 → 154 com o mesmo critério; padding do runtime nunca vai para o fio |
| `0x0384` | 12 bytes, repassado | 12 bytes, repassado |
| `0x0386` | 12 bytes, repassado | — |

O placeholder do servidor antigo (13 ou 21 bytes) é descartado por tamanho e nunca chega ao runtime. Contra o servidor atual do Railway, o pedido de troca sai, mas nenhuma janela abre, porque o servidor não encaminha nada: não há estado falso.

## Evidência

- Servidor: `go test ./tmserver/internal/handler -run 'Trade|AutoTrade'`, com 19 testes verdes, 8 deles novos ou reescritos: encaminhamento, troca atômica com `0x0185` e ouro, save dos dois lados, reset do check, ofertas adulteradas, falta de espaço com rollback, cancelamento, desconexão e drop.
  - `go vet ./...` limpo; `gofmt` limpo nos arquivos alterados.
  - `go test ./...` completo: só falham 13 testes que leem `Release/TMsrv/run/...`, conteúdo ausente no checkout e sem relação com a troca.
- Dialeto: `protocol:dialect` 800/0.
- `protocol:vectors`: 97 vetores e 34 fluxos, com três fluxos de troca (byte a byte, corte no meio da oferta, truncado). O overlay confere as fixtures com o `MsgTradeBody.Encode/Decode` real do servidor alterado.
- WASM `tmproject_startup.1790802394708885000`: 115 objetos certificados, 0 indefinidos. `scene`, `client:stream` e `world:checks` 27/0 verdes.

## Pendente (bloqueado)

- Publicar o servidor com o patch no Railway exige o operador (reinício do `tm-server`).
- Depois disso: fase `trade` no harness com duas sessões (oferta, alteração que zera o check, confirmação bilateral, recusa por espaço, cancelamento, desconexão, relogin) e o roteiro Windows × web.
