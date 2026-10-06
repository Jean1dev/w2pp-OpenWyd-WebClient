# ADR 008 — Dialeto de loja, banco e chat (etapa 5, fatia 3)

Data: 30/09/2026. Estado: implementada e provada no Railway: loja, banco, chat e teleporte por comando ([evidências](../evidence/05-gameplay/2026-09-30-shop-bank-chat.md)).

## Problema confirmado em fonte

Na revisão anterior, o dialeto descartava como desconhecidos, nos dois sentidos, todos os opcodes de loja, banco e chat. Comprar, vender, mexer no ouro do banco ou falar gerava descarte e reprovava a saúde de protocolo. Servidor `98286fdf`, upstream `beb9f69b`:

- **`0x0379` Buy** (`handler/shop.go` `buy`):
  - o servidor lê `TargetID` u16 @12, o slot da loja @14 e o slot da bolsa @16;
  - ecoa o payload recebido com o ouro novo em @20, depois envia `0x0337` e `0x0182`;
  - `MSG_Buy` do runtime tem 24 bytes, com padding em 18–19 e `Coin` @20;
  - `OnPacketBuy` não faz nada: o item chega pelo `0x0182`.
- **`0x037A` Sell** (`sell`): 18 bytes no servidor; `MSG_Sell` do runtime tem 20 (padding de alinhamento @18). O servidor ecoa, limpa o slot (`0x0182`) e envia `0x0337`. Só aceita `MyType` 1 (bolsa).
- **`0x0388`/`0x0387`, depósito e saque** (`handler/cargo.go`): `StandardParm(valor)`, 16 bytes. O servidor ecoa e envia `0x0339` e `0x0337`. O runtime aplica o eco como delta, e os dois pacotes seguintes corrigem os valores absolutos.
- **`0x0339` UpdateCargoCoin:** 57 bytes no servidor, com o ouro em @12. O próprio servidor marca esse offset como placeholder (`protocol/cargo.go`). O runtime espera `StandardParm` de 16 bytes (`OnPacketUpdateCargoCoin`).
- **`0x0333` fala:**
  - a fala de um jogador é repassada como veio (140 bytes deste runtime), para quem está em visão, sem eco para quem falou;
  - avisos do servidor (`sendChatText`, `sendNPCChatText`, `/nick`) são texto cru terminado em NUL, de tamanho variável;
  - `MSG_MessageChat` do runtime tem 140 bytes.
- **`0x0334` sussurro/comando:**
  - o servidor lê `MobName[16]` e o texto restante (≥ 16 bytes de corpo) e repassa o payload ao destino;
  - `/cidade` é um sussurro cujo nome é o comando (`runCommand`, `teleportCmds`);
  - `MSG_MessageWhisper` do runtime tem 160 bytes (`MobName` @12, `String` @28, `Color` @156, padding @158). O conteúdo útil tem 158.

## Decisão

| Opcode | Saída | Entrada |
|---|---|---|
| `0x0379` | traduzido por campo, 24 bytes, padding zerado | repassado com 24 bytes |
| `0x037A` | 20 → 18 bytes, padding descartado | repassado com 18 bytes (o runtime só lê até @17) |
| `0x0387`/`0x0388` | repassados com 16 bytes | repassados com 16 bytes |
| `0x0339` | — | 57 → 16 bytes, `Parm` = i32 @12 (**hipótese**, ver abaixo) |
| `0x0333` | repassado com 140 bytes | 12..140 bytes → layout de 140, `String[127]` = 0 |
| `0x0334` | 160 → 158 bytes, padding descartado | 28..158 bytes → layout de 160, `MobName[15]` e `String[127]` = 0 |

- Tamanho errado é descartado (`DROP_SIZE`), como nos demais opcodes, e fala maior que 140 bytes também.
- O offset do ouro no `0x0339` segue como **hipótese** até uma execução comparar o ouro do banco mostrado pelo cliente com o log `cargo opened/deposit/withdraw` do servidor.
- **Probes somente leitura** (patch 0018):
  - loja: `wyd_field_shop_visible`, `_merchant`, `_cell_item`, `_cell_screen`, `_grid_size`;
  - banco: `wyd_field_cargo_visible`, `_coin`, `_page`, `wyd_debug_cargo_item`, `wyd_field_cargo_cell_screen`;
  - chat: `wyd_field_chat_count`, `_line`, `_editing`;
  - ouro: `wyd_field_button_screen` (apenas B_MONEY, B_CARGO_MONEY e B_IG_OK) e `wyd_field_gold_input_visible`;
  - catálogo: `wyd_item_price`, só para o harness escolher o que tentar. Quem cobra é o servidor.

  Nenhum probe envia pacote nem muda estado. O harness compra, vende, deposita e fala com mouse e teclado reais.
- **Harness:** fases `shop` (Aki, Merchant 1), `bank` (Guarda_Carga, Merchant 2) e `chat`, esta com os comandos `/azran` e `/armia` como prova de teleporte. As posições vêm do `NPCGener.txt` e dos templates do servidor fixado (#3406 em 2144,2088 e #3408 em 2144,2082).

## Achados da execução

- **Clique segurado compra de novo** (confirmado em fonte e em execução): `EventTranslator` gera o evento 513 a cada leitura do DirectInput enquanto o botão está pressionado, e o `SGrid` só espaça as compras por 500 ms. A ~1 quadro/s headless, um clique segurado por dois quadros comprou duas vezes, e o servidor cobrou as duas. É o comportamento original. O harness usa toque curto; nada foi mudado no runtime.
- **Clique repetido na compra:** o segundo pedido vai para o mesmo slot, porque o `0x0182` ainda não chegou, e o servidor responde `buy resync (dest occupied)`, sem duplicar.
- **Sussurro exibido sem o primeiro caractere:** o memo privado mostra `&String[1]`, e o remetente monta `String` sem prefixo. **Hipótese:** o servidor legado reescrevia o sussurro (prefixo e nome do remetente) antes de repassar. Proposta junto com a lacuna 3.
- **Caixa de valor:** um valor recusado pelo cliente (mensagem 34) mantém a caixa modal aberta até Cancelar, como no original.

## Lacunas do servidor (entregas separadas; nada foi feito no cliente nem no gateway)

1. Compra recusada (sem ouro, preço inválido, slot vazio da loja), venda recusada, depósito/saque inválidos e teleporte por tile sem ouro não mandam resposta. O cliente original mostrava aviso. Proposta: enviar a notice correspondente.
2. A venda a partir do equipamento (`MyType` 0) é ignorada em silêncio.
3. O sussurro é repassado sem trocar `MobName` (`chat.go:71`), e o cliente de quem recebe usa esse campo como remetente (confirmado em fonte; o probe não observou o nome). O texto chega sem o prefixo que o memo privado descarta. Proposta: gravar o nome de quem envia em @12 e reproduzir a reescrita do servidor legado antes de repassar.
4. O `0x0339` tem 57 bytes com o ouro num offset não verificado. Na execução, 0 → 100 → 0 bateu com o log do servidor, o que sustenta o @12, mas o ouro guardado entre sessões ainda não foi exercitado.
5. Chat de grupo, guilda e reino é tratado como fala comum.
6. `reqShopList` compara `Merchant` com `==`, mas o campo também guarda a cidade nos bits 6–7 (`world/session.go:214`). Os NPCs de Armia usados aqui têm os bits zerados.

## Consequências

- Fala, sussurro, compra, venda e banco deixam de reprovar a saúde de protocolo.
- Não há regra nova no cliente: sucesso e recusa vêm do servidor. O que o runtime mostra por conta própria (a linha da própria fala, o delta do eco de depósito) é corrigido pelos pacotes seguintes do servidor.

## Revisão de 01/10/2026

- `0x0339` @12: **confirmado em execução** com saldo diferente de zero entre sessões. 74 de ouro no banco antes e depois do relogin, iguais ao log `cargo deposit coin=37 cargo=74` ([fatia A](../evidence/05-gameplay/2026-10-01-slice-a.md)).
- Teleporte pago: o OK da caixa 16 envia `0x0290` sem conferir o ouro, e o servidor recusa em silêncio quando falta ouro. Confirmado em execução; a falta do aviso continua como lacuna do servidor.
- Avisos do servidor: o dialeto traduz os códigos 0–33 de `handler/notice.go` em texto próprio (antes eram 0–15).

## Revisão de 06/10/2026

- **Lacuna 3 (sussurro): corrigida no servidor, sem deploy.** O PR [#374](https://github.com/Jean1dev/w2pp-OpenWYD/pull/374) (`patches/server/0008`) grava o nome de quem envia no `MobName` e põe um espaço na frente do texto. O espaço compensa o `&String[1]` do memo, que também cortava com o servidor C++. O PR também zera o `Color` e traz o `/r`. Ver [ADR 019](019-duplicate-login-and-whisper.md).
- **"Sussurro exibido sem o primeiro caractere":** a hipótese de que o servidor legado reescrevia o texto estava errada. O `_MSG_MessageWhisper.cpp` só troca o `MobName`; o corte é do próprio 7662.
- **Probe:** o nome do remetente aparece no memo privado (`m_pHelpList[3]`), que os probes desta ADR não liam. Por isso o `senderShown` da fase `chat` saía "none". O patch `0027-memo-probes` acrescenta `wyd_field_memo_count`/`_line`.

## Revisão de 06/10/2026 (tarde): lacuna 1

- **Lacuna 1 (recusas sem resposta): corrigida no servidor, sem deploy.** O PR [#376](https://github.com/Jean1dev/w2pp-OpenWYD/pull/376) (`patches/server/0010-refusal-panels.patch`) envia, como o legado, um `SendClientMessage` com a string do `Language.txt`:
  - compra sem ouro: `_NN_Not_Enough_Money` (113), `_MSG_Buy.cpp:147-151`;
  - depósito negativo ou acima do ouro carregado: `_NN_Cant_Deposit_That_Much` (44), `_MSG_Deposit.cpp:34-56`;
  - saque negativo ou acima do banco: `_NN_Cant_Withdraw_That_Much` (45), `_MSG_Withdraw.cpp:34-55`;
  - teleporte pago sem ouro: `_NN_Not_Enough_Money` (113), `_MSG_ReqTeleport.cpp:39-64`.
- **A proposta original estava parcialmente errada (confirmado em fonte):** o legado também fica em silêncio com preço negativo e slot vazio da loja (`return` sem mensagem). Esses casos continuam em silêncio. Na venda, o servidor Go não tem caminho de recusa que o legado avise. As recusas por comerciante errado (112/116) e de poção (167) ficam para quando o Go tiver essas regras.
- O teto de 2G continua com o `NoticeCargoFull` do Go. O legado usa `_NN_Cant_get_more_than_2G` (273), e o dialeto do cliente web já traduz a notice.
- **Harness:** `Session.panels()` coleta dentro da página os textos do painel (que dura 4 s). As regras de `shop`, `bank` e `paidteleport` passam a exigir o painel na recusa, e a ausência dele no teleporte pago com ouro.
