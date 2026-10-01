# Etapa 4 — cenários de duas sessões — 01/10/2026

## Ambiente

- Repositório `c96a437b` (com a correção de desligamento do gateway, PR #13), servidor `98286fdf` no Railway, OpenWyd `beb9f69b` com os patches 0001–0021, `ClientVersion=12000`.
- WASM `tmproject_startup.1790859244302076800` (build da [etapa 2](../02-build/2026-10-01-reproduction.md)). Chromium headless 139 via Playwright 1.54.2, um contexto por conta.
- **Contas novas** criadas no portal do operador com `tools/create_test_account.mjs` (A e B, `webt********`); senhas, PINs e nomes só no `.env` ignorado. As contas anteriores não estavam disponíveis neste worktree.
- Um processo por cenário. Memória livre antes de cada um: 2,1 / 2,4 / ~2,4 GB; mínimo durante as duas sessões: 679 MiB (navegador 2,1 GB).

## Resultados

**Confirmado em execução**, todos `ok: true`, zero erros de página, zero pacotes descartados (`inDrop*`, `outDropUnknown`, `droppedIn/Out` vazios). As evidências sanitizadas foram conferidas contra todos os valores do `.env` (nenhuma ocorrência).

| Cenário (janela UTC) | Fase | Resultado | Evidência |
|---|---|---|---|
| `login,create,enter,second,move,logout` (14:43–14:52) | login | PIN definido no 1º acesso (`lock1`); quatro slots vazios | [2026-10-01-move-logout.json](2026-10-01-move-logout.json) |
| | create | personagem classe 0 criado; prévia nível 0, HP 100/100, atributos 12×4, equipamento `[1,1103,1115,1127,1139,1151,861]` | |
| | enter | Field do servidor em 2089,5/2094,5; 37 frames, 35 traduzidos, 2 repassados | |
| | second | B criado e no Field em 2090,5/2095,5 | |
| | move | A vê B e B vê A; clique real: A 2089,5/2094,5 → 2090,5/2089,5, B → 2098,5/2091,5; cada lado vê o destino exato do outro; nomes e `look` iguais; direção de A vista por B −π/2 | |
| | logout | B perde A (despawn); A reloga com o mesmo PIN, reaparece em 2090,5/2101,5 (spawn da cidade, não a última posição), B vê o respawn; prévia e `look` persistidos | |
| `login,enter,second,mapchange` (14:53–15:02) | mapchange | A caminha até o portal Armia → Armia Field (2141,5/2068,5), confirma a caixa e chega em 2588,5/2098,5 (bloco 20,16); B, no portal, viu A antes e o perdeu depois; 217 frames, nenhum descartado | [2026-10-01-mapchange.json](2026-10-01-mapchange.json) |
| `login,enter,concurrent` (15:03–15:08) | concurrent | segundo login na conta de A chega à seleção (`0x10A`) enquanto a 1ª sessão continua no Field; fechar a duplicata não derruba a original, que depois vê uma entidade nova (B) do servidor | [2026-10-01-concurrent.json](2026-10-01-concurrent.json) |

Quem confirma a posição: o servidor. A outra sessão só move a entidade ao receber o frame repassado (`bSawATo`/`aSawBTo` iguais às posições do dono); o relogin usa o spawn da cidade escolhido pelo servidor.

O login duplicado segue o backend fixado: `AccountLogin` aceita a segunda sessão. A proteção é entrega separada do servidor (ver PROGRESS, item 6); nenhuma mutação de inventário foi testada nesse estado.

## Observações nas capturas

Capturas locais em `.cache/world/2026-10-01T14-43-11-581Z/` e `…T14-53-19-782Z/`, fora do Git (contêm assets e nomes).

- Field online e Armia Field texturizados, com HUD, nomes e mobs do servidor.
- **Hipótese:** o HUD mostra "Nv 2" e HP 105 para um personagem com prévia nível 0 / HP 100. O runtime exibe `CurrentScore.Level + 1` (`TMFieldScene.cpp:4230`); a diferença é coerente com o item já registrado de que o snapshot de login traz o `CurrentScore` do template da classe até o servidor enviar `0x0336`. Não verificado nesta sessão.
- Na captura de B depois do movimento, a janela de loja está aberta: o clique de movimento de B caiu perto dos mercadores da cidade. **Hipótese:** abriu a loja de um NPC; não afetou o resultado da fase (B chegou ao destino).

## Limites

- **Log do servidor não coletado:** o Railway CLI não está autenticado nesta máquina. A prova é do lado do cliente (probe e frames do gateway).
- **Cliente Windows 7662:** continua pendente; roteiro manual no [README](README.md#3-roteiro-manual-para-o-cliente-windows-7662-pendente).
- **Sessão expirada:** **confirmado em fonte**, o `tmserver` limpa o prazo de leitura após o handshake (`world/edge.go:38`), e a busca por prazos e ociosidade não encontrou outro limite da sessão de jogo. O corte por ociosidade é do gateway (`Limits.IdleTimeout`, coberto por `TestIdleTimeoutClosesBoth`). Não houve cenário online de expiração.
- Só Chromium headless; Firefox não testado online.
