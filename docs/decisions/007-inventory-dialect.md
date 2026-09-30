# ADR 007 — Dialeto de itens e lacuna dos itens no chão

Data: 30/09/2026. Estado: implementada (dialeto, probes e harness); resultado online registrado nas evidências da etapa 5.

## Problema confirmado em fonte

Na revisão anterior, o dialeto descartava todos os opcodes de item nos dois sentidos. Arrastar um item ou beber uma poção gerava descarte e reprovava a saúde de protocolo. Servidor `98286fdf`, upstream `beb9f69b`:

- **`0x0376`, troca de slots** (`handler/item.go` `tradingItem`): 20 bytes nos dois lados.
  - O servidor lê `DestPlace, DestSlot, SrcPlace, SrcSlot` (u8 @12..15) e `WarpID` i32 @16.
  - O runtime (`MSG_SwapItem`) escreve `SourType, SourPos, DestType, DestPos` (char @12..15) e `TargetID` u16 @16, com padding em 18–19.
  - A troca é simétrica (`*src, *dst = *dst, *src`). As regras de equipamento avaliam os dois sentidos, e o servidor ecoa o payload como recebeu.
  - Quando o slot da mão principal fica vazio, o servidor manda um eco extra, `shiftWeaponToRightHand`.
  - O runtime não move nada localmente: `SGridControl::SwapItem` só envia. `TMFieldScene::OnPacketSwapItem` aplica a troca a partir do eco e indexa `m_pGridInvList[pos/15]` (4 páginas, 60 células) e 18 grids de equipamento.
- **`0x0373`, UseItem:** 34 bytes no servidor e 36 no runtime (`sizeof` com padding @34). O campo `ItemID` u16 @32 corresponde ao `WarpID` do servidor.
  - O servidor ecoa `0x0373` somente ao equipar pelo uso (`equipItem`). O runtime não tem `case 0x373`, e os dispatchers ignoram tipos desconhecidos (`return 0`).
  - A poção consome uma unidade, depois envia `0x0182` e `0x0181`. A cura sai no tick de 1 s como `0x0336` para quem está em visão.
  - O runtime decrementa a pilha localmente, e o `0x0182` do servidor sobrescreve esse valor.
- **`0x0185`, UpdateCarry:** layout idêntico (Carry[64]@12, Coin@524, 528 bytes).
- **Itens no chão:**
  - `dropItem`/`getItem` removem ou adicionam o item no servidor, mas não enviam `_MSG_CreateItem 0x026E` a ninguém (`item.go:76`, "deferred").
  - Os CNF `0x0175`/`0x0171` têm 16 bytes com o slot como placeholder, e o runtime espera 28.
  - Não existe decay, dono nem `0x026E` S→C.
  - O loot dos mobs vai direto ao carry do matador (`mobkilled.go`), sem passar pelo chão.
  - O runtime só remove o item arrastado para o chão ao receber `0x0175` (`OnPacketCNFDropItem`). `TMFieldScene::DropItem` apenas envia.

## Decisão

- **`0x0376` nos dois sentidos**, com mapeamento **posicional**: bytes 12–15 iguais, `TargetID` estendido com zero para o `WarpID` i32, e padding nunca enviado.
  - Como a troca é simétrica e o eco volta byte a byte, os nomes invertidos não mudam o resultado.
  - O dialeto recusa (`RANGE`) um `place` maior que 2 e um slot fora do que o runtime desenha: equip < 16, carry < 60, cargo < 120. Um eco com carry 60–63, marcadores de bolsa, indexaria além de `m_pGridInvList`.
- **`0x0373` saída:** 36 → 34 bytes, por campo, com `Header.Size` reescrito.
- **`0x0373` entrada:** traduzido para 36 bytes e entregue. O runtime o ignora, o que é a semântica original. Não há contador novo nem descarte silencioso.
- **`0x0185` entrada:** repassado, com `static_assert` do layout.
- **Itens no chão:** `0x0272`, `0x0270`, `0x0171`, `0x0175`, `0x016F` e `0x026E` continuam descartados e fora de `DEFERRED_*`. Um drop feito pelo jogador reprova a saúde, sem perda de item, porque o servidor não recebe o pedido e o runtime não remove nada sem o CNF.
  - Nenhuma regra foi acrescentada no cliente ou no gateway.
- **Probes somente leitura** (patch 0017):
  - `wyd_field_inv_page`;
  - `wyd_field_inv_cell_screen`, `wyd_field_equip_cell_screen`;
  - `wyd_debug_my_item_ef`: pares efeito/valor, EF_AMOUNT 61;
  - `wyd_field_cursor_item`;
  - `wyd_field_my_attack`: Damage/Ac do último `0x0336`.

  O harness usa os gestos originais: clicar para pegar e clicar no destino, e clique direito para usar.

## Proposta de entrega separada no servidor (não feita)

Itens no chão exigem mudança no tm-server, em entrega própria, com testes no `world.World.Run`:

1. No drop, enviar `_MSG_CreateItem 0x026E` para quem está em visão, e `_MSG_DecayItem 0x016F` na coleta ou na expiração.
2. Substituir os CNF placeholders pelos layouts de 28 bytes (`DestType/DestPos` e item), a validar contra captura do cliente 7662.
3. Dono e janela de saque, timer de decay e limite de itens por célula.

Na mesma linha, também confirmado em execução em 30/09:

- o ouro dos mobs nunca é pago, porque `ParseMobBasics`/`SpawnMobAt` não leem o `Coin` do template;
- o snapshot de login traz o score do template da classe até o primeiro `0x0336`.

Até lá, "coleta/drop no chão" fica **bloqueada pelo servidor** na etapa 5. O loot provado é o que o servidor realmente implementa: direto ao carry e ao Coin.

## Limites

Cargo (`place 2`, NPC guarda) não foi exercitado; é da fatia 3. Split e delete (`0x02E5`/`0x02E4`) seguem descartados. A recusa por requisito (`NoticeReqNotMet`) só é alcançável quando o runtime não bloqueia antes. O runtime recusa localmente um item cujo `nPos` não serve no slot, sem enviar pacote.
