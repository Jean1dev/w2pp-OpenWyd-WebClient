# ADR 009 — Dialeto de grupo e bloqueio da troca (etapa 5, fatia 4)

Data: 30/09/2026. Estado: grupo implementado e **confirmado em teste** local (dialeto 616/0, vetores, harness 27/0, `scene`, `client:stream`); **ainda não aprovado no Railway**. Execução 1: alvo não clicado (harness corrigido). Execução 2: convite descartado pelo dialeto (classe −1, corrigido abaixo). Execução 3: interrompida por falta de memória no host antes do convite. Troca **bloqueada** por dependência de backend.

## Grupo — problema confirmado em fonte

Servidor `98286fdf`, upstream `beb9f69b`. Os quatro opcodes de grupo eram descartados como desconhecidos.

- **`0x037F` convite:** 48 bytes no fio. Classe u8 @12 (@13 zero), nível @14, MaxHp @16, Hp @18, ID do líder @20, nome @22..37, destino i32 @40 e u16 @44. `MSG_REQParty` do runtime tem 44 bytes (`PARTY` de 26 bytes, `TargetID` @40).
- **`0x037D` membro:** 40 bytes. Em @12 o servidor não põe a classe: põe o ID do próprio membro quando ele é o líder, ou 30000 quando não é. O runtime lê @12 como `Class`/`PartyIndex`.
- **`0x03AB` aceite:** 32 bytes no fio (`LeaderID` @12, nome @14); `MSG_CNFParty2` tem 32 com os mesmos campos, e o runtime deixa lixo no padding.
- **`0x037E` saída/expulsão:** `StandardParm` de 16 bytes. O servidor lê só o ID em 16 bits; o tail é padding legado.
- O runtime preenche `Leader.Class` com `m_nSkinMeshType - 1` (`TMFieldScene.cpp`, controle 641). `m_nSkinMeshType` é o corpo (`BASE_DefineSkinMeshType`: classes 1 e 4 → 0; 2 e 8 → 1), não a classe: corpos masculinos enviam −1 (0xFF). O servidor ignora @12 no convite recebido e reescreve a classe real (`reqPartyBody`, `e.Class`) no convite encaminhado. A primeira versão do dialeto exigia 0..3 e descartou o convite de um TK na execução 2 (ver evidências).
- O runtime original marcava `m_bParty = 1` localmente ao aceitar (`TMFieldScene.cpp`, dois pontos), antes da confirmação do servidor.

## Decisão (grupo)

| Opcode | Entrada | Saída |
|---|---|---|
| `0x037F` | 48 → 44, por campo; classe > 3 ou @13 ≠ 0 descarta | 44 → 48; exige `Leader.ID` = ID do cabeçalho, alvo em 1..999, classe −1..3, `PartyIndex` 0 |
| `0x037D` | 40 → 40; @12 vira `PartyIndex` (0 líder, 1 membro); `Class = -1` e a cena resolve pela entidade real (patch 0019) | — |
| `0x03AB` | — | 32 → 32 com padding zerado; `LeaderID` fora de 1..999 descarta |
| `0x037E` | ID em i16 @12, tail ignorado | repassado se 16 bytes e ID 0..999 |

- O patch `0019-party-probes-and-confirmation.patch` remove a marcação antecipada de membro: só a confirmação `0x037D` do servidor forma o grupo. Também expõe probes somente leitura (linhas, líder, menu do jogador, coordenadas dos controles 641 e 475139). Nenhum probe envia pacote.
- Tamanho errado, truncado ou fora de faixa descarta e conta como `DROP_SIZE`/`DROP_RANGE`, o que reprova a saúde de protocolo do harness.

## Troca — bloqueio confirmado em fonte

`tmserver/internal/handler/trade.go` (`98286fdf`):

- `trade` (linhas 18–66) valida a oferta e grava `s.Trade`, mas **não encaminha a oferta ao parceiro**. O cliente clássico mostra a oferta do outro lado pelo `0x0383` recebido; aqui o parceiro não recebe nada.
- A primeira confirmação responde ao próprio remetente com `tradeResultPayload(nil)` (linha 65): um byte de contagem, não um `MSG_Trade`.
- `executeSwap` (linhas 71–109) troca itens e ouro de forma atômica, mas responde com "contagem + itens" (linhas 105–108, marcado `UNVERIFIED` pelo próprio servidor). Não envia `0x0182` por slot nem `0x0337` de ouro. O cliente não teria como refletir o resultado.
- O `MsgTradeBody` do servidor tem 154 bytes; `MSG_Trade` do runtime tem 156, com dinheiro, `MyCheck` e oponente deslocados.

## Decisão (troca)

- O dialeto **não** mapeia `0x0383`: descarta nos dois sentidos, e as fixtures `trade_offer_blocked`/`trade_result_blocked`/`trade_ack_blocked` provam isso. Converter a resposta provisória em sucesso mostraria no cliente um estado que o servidor não confirmou.
- Nenhuma troca foi executada online.
- Dependência de backend, a entregar separadamente, com testes no servidor e sem quebrar o cliente Windows 7662:
  1. encaminhar cada oferta (`0x0383`, layout clássico) ao parceiro, incluindo alterações e o estado de confirmação;
  2. confirmação bilateral com reset da confirmação quando qualquer lado altera a oferta;
  3. após a troca, `0x0182` por slot alterado e `0x0337` com o ouro, nos dois lados;
  4. `0x0384` consistente nos dois lados ao cancelar, mover, atacar ou desconectar.
- Com isso entregue, o dialeto mapeia 154 ↔ 156 por campo e a fase `trade` entra no harness.
