# Lixeira (`0x02E4`): relato de jogador, 08/10/2026

## Relato

Um jogador perguntou se o problema era da versão web ou também do cliente. Ele relatou:

1. itens descartados somem, mas voltam ao comprar algo;
2. os stats ficaram negativos;
3. o arco fica segurado de forma esquisita;
4. não consegue equipar nem desequipar nada.

Ele não informou a plataforma, o personagem, a classe nem prints.

## Diagnóstico

| Sintoma | Estado | Causa |
|---|---|---|
| 1 Item descartado volta | **confirmado em fonte**, só no web | O runtime tira o item da grade ao confirmar a lixeira (upstream `SGrid.cpp:1949-1957`, `TMFieldScene.cpp:16946-16973`, caixa 740) e envia `0x02E4`. O dialeto descartava o opcode (`default` → `outDropUnknown`). O servidor ficava com o item e o reenviava na compra seguinte. |
| 4 Não equipa/desequipa | **hipótese** (consequência do 1) | Com a grade dessincronizada, arrastar o equipamento para um slot "vazio" vira, no servidor, uma troca com o item fantasma. `tradingItem` recusa com `NoticeReqNotMet`. Sem descarte, equipar e desequipar foi aprovado em 30/09 ([inventário](2026-09-30-inventory.md)). |
| 2 Stats negativos | **hipótese**, sem dado | Falta saber qual campo. Candidatos: score com equipamento trocado por fantasmas; `UpdateEtc` repassado. |
| 3 Arco | **hipótese**, sem dado | É visual. Envolve `shiftWeaponToRightHand` (servidor, slot 7 → 6) e a animação por tipo de arma no runtime. Pode ocorrer também no Windows. |

## Mudanças

- **Cliente** ([ADR 007, revisão de 08/10](../../decisions/007-inventory-dialect.md#revisão-de-08102026-lixeira-0x02e4)): `client/dialect/WydDialect.cpp` encaminha `0x02E4` com 20 bytes escritos por offset (`Slot` @12, `SIndex` @16). Tamanho errado e slot fora de `[0, 60)` são descartados. Inclui um `static_assert` do `MSG_STANDARDPARM2`.
- **Servidor** (`patches/server/0011-delete-item-sindex.patch`, sobre `b8488a56`; [PR #377](https://github.com/Jean1dev/w2pp-OpenWYD/pull/377), sem merge nem deploy): o `deleteItem` só limpa o slot se o índice for igual ao `SIndex`. Se for diferente, reenvia o slot real. Um cliente dessincronizado deixa de apagar um item que o jogador não via.

## Comandos e resultados (08/10, confirmados em execução local)

| Comando | Resultado |
|---|---|
| `python tools/protocol/run_dialect_test.py` (emsdk 6.0.0, wasm32) | 811 checks, 0 failures; inclui `0x02E4` válido = vetor `k_out_delete_item`, tamanho 19 e `outCap` 19 descartados, slots -1 e 60 descartados |
| `python tools/protocol/run_go_vectors.py` (servidor fixado `98286fdf`) | `TestExtDialectOutbound/delete_item` PASS; pacote `protocol` ok |
| `python tools/protocol/gen_fixtures.py` | 48 inbound + 14 outbound; `dialect.json` regenerado |
| `go test ./tmserver/internal/handler/` com o patch 0011 (Go 1.25.13, `b8488a56`) | ok (179 s) |
| `TestDeleteItemWrongIndexResyncs` sem a correção | FAIL (`slot=0 index=0, want slot 0 kept with 1100`) |

## Não executado

- Fase online (lixeira → compra → relogin → equipar) no Railway: sem `.env` neste worktree e sem build do runtime.
- Logs do tm-server para o personagem do jogador: falta o nome.
- `-race`/lint no servidor; cliente Windows.

## Próximo passo

1. Perguntar ao jogador: plataforma, personagem, classe e prints dos stats e do arco.
2. Build e deploy do cliente. Depois, a fase online acima, com duas sessões e relogin.
3. Merge e deploy do [PR #377](https://github.com/Jean1dev/w2pp-OpenWYD/pull/377).
4. Sintomas 2 e 3: reproduzir com Caçadora e arco, web × Windows.
