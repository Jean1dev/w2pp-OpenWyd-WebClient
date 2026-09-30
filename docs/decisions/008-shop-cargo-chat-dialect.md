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
