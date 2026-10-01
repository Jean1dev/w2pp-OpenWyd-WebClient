# ADR 011: DeleteCharacter ponta a ponta e resposta de falha do servidor (etapa 3)

Data: 30/09/2026. Estado: exclusão **confirmada em execução** no Railway. A correção da resposta de falha no servidor está **confirmada em teste**, aberta no [PR #359](https://github.com/Jean1dev/w2pp-OpenWYD/pull/359) e ainda **não publicada**.

## Contexto

A etapa 3 só tinha prova unitária de `DeleteCharacter` (`0211`, 48→44) e `CNFDeleteCharacter` (`0112`, 844→920). Faltava provar o fluxo pela interface original contra o servidor real.

## Fontes

- **Runtime (confirmado em fonte):** `TMSelectCharScene.cpp`. O botão 4615 abre a caixa 4615. Confirmar a caixa mostra o painel de senha (`m_pInputPWPanel`/`m_pPWEdit`, controle 65889). O controle 65886 envia `MSG_DeleteCharacter` com o slot, o nome e a senha. O `0x0112` substitui o SELCHAR e recarrega a lista. O `0x011A` mostra a mensagem 19 (falha de criação) e o `0x011B` mostra a mensagem 20 (falha de exclusão).
- **Higiene:** o código original apagava só 4 dos 256 bytes do campo de senha depois do envio. O patch 0021 apaga o campo inteiro.
- **Legado (confirmado em fonte):** `w2pp-OpenWYD`, `Source/Code/TMSrv/ProcessDBMessage.cpp:641-649`. `_MSG_DBDeleteCharacterFail` vira `SendClientSignal(conn, 0, _MSG_DeleteCharacterFail)`, que é `27 | FLAG_GAME2CLIENT = 0x011B` (`Basedef.h:1732`).
- **Servidor Go `98286fdf` (confirmado em fonte e em execução):** `deleteCharacter` responde à recusa com `MsgNewCharacterFail` (`0x011A`). No Railway, a senha errada recebeu `0x011A`.

## Decisão

- Cliente: `patches/openwyd/0021-selchar-delete-probe.patch`.
  - `wyd_debug_selchar_open_delete(slot)` aciona o controle 4615.
  - O harness confirma a caixa com `wyd_debug_scene_msgbox_ok`.
  - `wyd_debug_selchar_delete(senha)` preenche o campo original e aciona o 65886.
  - A senha fica só num buffer de pilha e no campo original, e os dois são zerados após o envio.
  - A automação passa pelos controles da cena, não pelo socket, como `wyd_debug_selchar_create`.
- O dialeto não muda: `0x011A` e `0x011B` já passam sem corpo.
- Servidor: entrega separada, o PR #359 (`patches/server/0002-delete-character-fail.patch`, SHA-256 `aad98fef…`). Adiciona `MsgDeleteCharacterFail = 0x011B` e responde com ele à recusa. O caminho de sucesso não muda. O teste `TestDeleteCharacterWrongPassword` é novo.
- Harness: fase `delete`, isolada, na conta B.
  - Cria um personagem descartável num slot vazio e confere que ele persiste após o relogin.
  - Tenta apagar com a senha errada (recusa) e depois com a certa.
  - Confere que só o slot alvo sumiu e reloga.
  - Nunca apaga o personagem configurado e nunca libera espaço apagando outro.
  - A checagem pura é `checkDelete`, em `tools/trade_checks.mjs`.

## Consequências

Até o PR #359 ser publicado, o cliente web mostra a falha de exclusão com o texto de falha de criação, exatamente como o cliente Windows faria contra o mesmo servidor. O cliente não compensa isso.
