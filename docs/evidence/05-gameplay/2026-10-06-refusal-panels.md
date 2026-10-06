# Etapa 5: avisos nas recusas de compra, banco e teleporte pago (06/10/2026)

- Decisão e fontes: [ADR 008, revisão de 06/10 (tarde)](../../decisions/008-shop-cargo-chat-dialect.md#revisão-de-06102026-tarde-lacuna-1).
- Servidor: PR [#376](https://github.com/Jean1dev/w2pp-OpenWYD/pull/376), espelhado em `patches/server/0010-refusal-panels.patch` (commit `62bfb69d`, a partir de `25016ab3`).
- Comandos: `node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,<fase>`, com `<fase>` = `bank`, `shop` e `paidteleport`, cada uma em seu próprio processo.

## O que muda

O legado responde cada recusa com `SendClientMessage` e uma string do `Language.txt` (**confirmado em fonte**). O Go recusava em silêncio:

| Recusa | Legado | Painel |
|---|---|---|
| compra sem ouro | `_MSG_Buy.cpp:147-151` | `_NN_Not_Enough_Money` (113) |
| depósito negativo ou acima do ouro carregado | `_MSG_Deposit.cpp:34-56` | `_NN_Cant_Deposit_That_Much` (44) |
| saque negativo ou acima do banco | `_MSG_Withdraw.cpp:34-55` | `_NN_Cant_Withdraw_That_Much` (45) |
| teleporte pago sem ouro | `_MSG_ReqTeleport.cpp:39-64` | `_NN_Not_Enough_Money` (113) |

Continuam em silêncio, como no legado: preço negativo ou ausente, slot vazio da loja e valor zero.

## Testes do servidor (confirmado em execução, local)

- `go vet ./tmserver/...` limpo e `go test ./tmserver/...` ok.
- Testes novos ou alterados: `TestBuyNotEnoughMoney`, `TestBuyNegativePriceSilent`, `TestCargoDepositInsufficient`, `TestCargoWithdrawTooMuch`, `TestCargoAmountRefusals` e `TestReqTeleportDungeon/paid-{without,with}-gold`.
- Os testes ficaram estáveis com `-count=10`. Sem a correção, 5 deles falham.
- Não executados localmente: `-race` e `golangci-lint` (sem cgo); ficam com a CI.

## Harness

- `Session.panels()` coleta dentro da página, a cada 100 ms, os textos do painel. O painel dura 4 s e as recusas passam por esperas mais longas.
- O harness compara só a parte ASCII da string do legado, porque os bytes Windows-1252 chegam pela `UTF8ToString`.
- As regras exigem o painel em `shop.poor`, `bank.overdraw` e `paidteleport.refused`, e a ausência dele em `paidteleport.paid`.
- `npm run world:checks`: 41/41.

## Linha de base na produção atual (`25016ab3`, sem o #376)

As três reprovaram só na regra nova, como esperado. As contas de 06/10 têm cerca de 1.000.000 de ouro cada. Não foi preciso ajustar o banco, porque a Aki vende itens acima disso.

- [`bank`](2026-10-06-refusal-bank-baseline.json), 18:25 UTC: o saque acima do banco foi enviado e recusado sem mudar o ouro, e `notice: false`. Reprovou em `overdraw: no _NN_Cant_Withdraw_That_Much panel`.
- [`shop`](2026-10-06-refusal-shop-baseline.json), 18:41 UTC: a compra do item 693 (20.080.000) foi enviada e recusada, com ouro e itens iguais, e `notice: false`. Reprovou em `refused buy: no _NN_Not_Enough_Money panel`.
- [`paidteleport`](2026-10-06-refusal-paidteleport-baseline.json), 18:48 UTC:
  - com ouro, o teleporte Armia → Noatum cobrou 700, sem painel;
  - com 500, A não saiu do lugar, o ouro não mudou e veio `notice: false`. Reprovou em `refused: no _NN_Not_Enough_Money panel`.

Protocolo limpo nas três.

## Com o #376 implantado (`b8488a56`): aprovado

O merge do #376 foi feito às 19:19 UTC, a pedido do usuário, e o Railway implantou o tm-server sozinho (SUCCESS). As três fases foram aprovadas (**confirmado em execução**):

- [`bank`](2026-10-06-refusal-bank-passed.json), 19:21 UTC: o saque acima do banco mostrou `_NN_Cant_Withdraw_That_Much` (`notice: true`), sem mudar o ouro. Depósito, saque, item e relogin passaram como antes;
- [`shop`](2026-10-06-refusal-shop-passed.json), 19:37 UTC: a compra do item 693 (20.080.000) mostrou `_NN_Not_Enough_Money`, com ouro e itens iguais. Venda, compra, clique repetido e relogin passaram;
- [`paidteleport`](2026-10-06-refusal-paidteleport-passed.json), 19:44 UTC: com ouro, cobrou 700 e não mostrou painel; com 500, mostrou `_NN_Not_Enough_Money`, sem mover nem cobrar. O relogin manteve só a cobrança.

Não houve erros de página, e a saúde de protocolo das fases passou.

**Limitação:** o depósito acima do ouro carregado é recusado pelo próprio cliente (mensagem 34), que não envia o pedido. O aviso `_NN_Cant_Deposit_That_Much` do servidor fica coberto só pelo teste Go.

## Pendente

- Cliente Windows: o painel é o mesmo `SendClientMessage` do legado, mas não foi conferido.
