# Fatia 2 — inventário, equipamento, poção e loot

Data: 30/09/2026. Decisão: [ADR 007](../../decisions/007-inventory-dialect.md).

Ambiente:

- Railway `tm-server`: servidor `98286fdf…`, `ClientVersion=12000`, TCP `reseau.proxy.rlwy.net:56950`, contas A/B do `.env`.
- Upstream `beb9f69b…` com os patches 0001–0017.
- WASM `tmproject_startup.1790775454462731200.wasm`, SHA-256 `3c27933b590a417a73f55ef9ed9fb5896692feb289a0ee64d6c4d121b28e9b64`.

## Implementação

- **Dialeto** (`client/dialect/WydDialect.cpp`):
  - `0x0376` nos dois sentidos, com mapeamento posicional e `TargetID` u16 ↔ `WarpID` i32. Slots fora das grids do runtime são recusados.
  - `0x0373` 36↔34.
  - `0x0185` repassado.
- **Patch `0017-inventory-probes`** (somente leitura):
  - página do inventário e centro das células de carry e equip;
  - pares de efeito (EF_AMOUNT 61);
  - item no cursor;
  - Damage/Ac do último `0x0336`.
- **Harness:**
  - fases `equip`, `potion` e `loot` em `tools/verify_world.mjs`;
  - regras `checkEquip`, `checkPotion`, `checkLoot`, `checkInventoryRelogin` e `itemAmount` em `tools/world_checks.mjs`;
  - `crack` incluído no filtro de `tools/capture_world_logs.py`.

## Verificação local

| Comando | Resultado |
|---|---|
| `npm run protocol:dialect` | 496 verificações, 0 falhas (eram 469). Novos: eco de troca, carry 60 recusado (`RANGE`), eco de UseItem 34→36, UpdateCarry com tamanho exato e tamanho−1, saída de troca com padding zerado, `DestType` 3 e equip 16 recusados, UseItem 36→34 |
| `npm run protocol:vectors` | verde. 97 vetores, 28 fluxos; overlay com `swap_item`, `swap_item_range`, `use_item` e `update_carry` iguais aos encoders do servidor; saída decodificada por `MsgTradingItemBody`/`MsgUseItemBody` reais |
| `npm run world:checks` | 21 testes, 0 falhas |
| Build de objetos + link `--dev` | `contract_unchanged=true certified=true`, link com 0 indefinidos |
| `python tools/apply_openwyd_patches.py --check` | pilha 0001–0017 aplicada |
| `npm run scene`, `npm run client:stream` | verdes com o WASM novo |

## Equipar e desequipar — **aprovado** (Railway)

Comando:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,equip --class 0
```

A (TK, slot 0) e B (observador) estão no spawn de Armia. A abre o inventário com a tecla `i` e move a arma com o gesto original: clique na célula, que prende o item ao cursor, e clique no destino.

| Passo | Resultado |
|---|---|
| Desequipar: equip 6 (item 861) → carry 13 | cursor pegou 861; um `0x0376` enviado; o eco do servidor aplicou a troca (equip 6 = 0, carry 13 = 861) |
| B vê | `look` de A `[…,0,863]` → `[…,0,0]` (`0x036B`) |
| Reequipar: carry 13 → equip 6 | um `0x0376`; estado inicial restaurado; B vê `863` de volta |
| Score do servidor | Damage 28 → 28 → 30 e Ac 39 inalterado. O recálculo com a arma (30) difere do valor sem ela (28) |
| Movimento impossível: poção 401 → equip 6 | o runtime recusa localmente (`nPos`), **0 pacotes**; o cursor é liberado; carry e equip inalterados |
| Relogin | equip, carry (índice e efeitos), coin, nível e EXP idênticos |
| Saúde | nenhum descarte de entrada ou saída, nenhum erro de página ou de GL |
| Log do servidor | dois `recv packet type=0x0376 len=8 routed=true`, nenhum `crack` |

Arquivos: [JSON](2026-09-30-inventory-equip-passed.json), [log do servidor](2026-09-30-inventory-equip-passed-server.txt).

### Primeira execução: reprovada pela regra, não pelo cliente

A [execução 1](2026-09-30-inventory-equip-score-failed.json) teve o mesmo fluxo e o mesmo resultado. Ela reprovou em `score not recomputed after unequip` porque a regra comparava com o Damage de antes do movimento.

**Confirmado em fonte:** o snapshot de login (`0x0114`, `protocol/mob.go` `EncodeCNFCharacterLoginRaw`) grava em CurrentScore o template BaseMob da classe, e só Special e as skills são corrigidos. O Damage e o Ac mostrados após o login são os do template até o primeiro `0x0336`. `computeScore` usa `effectiveDamage = Damage + weaponDamage`.

A regra passou a comparar os dois recálculos do servidor, com e sem o item. É uma **divergência do servidor**, que continua exibindo um score de template até o primeiro `0x0336`. O candidato para uma entrega separada é enviar `sendScore` depois do login. Não foi corrigida no cliente.

## Poção — **aprovada** (Railway, execução 8)

Comando, cada execução num processo separado:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,death,potion --class 0
```

Antes das execuções 4–8, a memória foi liberada com autorização do usuário: 61 processos `tail`/`grep` órfãos de monitores antigos, Docker Desktop, Chrome em segundo plano e outras sessões do Claude Code. Com isso, o Node via 2,3–2,6 GB livres no início e ≥ 1.019 MiB com as duas páginas no Field. Nenhuma execução foi interrompida por memória.

| Execução | Resultado |
|---|---|
| 1 (`…,potion`, dano dos Gremlins) | **interrompida pelo Claude Code por falta de memória** durante o login de B (1.087 MiB livres depois do `enter` de A, [issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)) |
| 2 (mesmo cenário, pedida pelo usuário; [JSON](2026-09-30-inventory-potion-gremlins-failed.json)) | **reprovada no desenho:** HP 130/130 depois de 11 lutas contra Gremlins. O dano é pequeno, e a regeneração natural (nível+30 a cada 10 s) repõe tudo |
| 3 (`…,death,potion`) | **interrompida pelo Claude Code por falta de memória** durante o login de B (1.174 MiB livres depois do `enter` de A) |
| 4 ([JSON](2026-09-30-inventory-potion-regen-failed.json)) | `death` aprovada; `potion` reprovou com HP 130/130. O servidor revive com 1–50% do HP máximo (aqui 41, não 2), e entre o recall e o uso passaram mais de 30 s (amostragem de memória, screenshots, abertura do inventário): três ticks de regeneração |
| 5 ([JSON](2026-09-30-inventory-potion-portal-failed.json)) | A caixa do portal abriu, mas A passou do tile (2141.5,2065.5). O servidor calcula o teleporte pelo tile atual e ignora o pedido em silêncio. O harness passou a voltar ao portal e repetir, com até 3 tentativas registradas em `portalAttempts` |
| 6 ([JSON](2026-09-30-inventory-potion-regen2-failed.json)) | Mesmo motivo da 4, mesmo com a leitura do HP adiada |
| 7 ([JSON](2026-09-30-inventory-potion-emptycell-failed.json)) | **Poção funcionou** (HP 80→130, 120→119, clique duplo 119→117 com 2 envios, B viu 130). Reprovou só na pré-condição do harness: o loot encheu a página 0 da bolsa, e não havia célula vazia para o caso negativo |
| 8 ([JSON](2026-09-30-inventory-potion-passed.json), [log do servidor](2026-09-30-inventory-potion-passed-server.txt)) | **aprovada** |

Correções do harness nesta sequência:
- o primeiro uso acontece dentro da fase `death`, logo após o recall, com o inventário aberto pela tecla `i` enquanto A espera o recall;
- o caso negativo usa uma célula de equipamento vazia quando a página 0 da bolsa está cheia;
- o observador compara o HP que B vê com o HP de A antes da poção.

Resultado da execução 8 (`2026-09-30T17-01-36-742Z`), confirmado em execução:
- A morre para os Trolls, a caixa 11 envia `0x03AE`/`0x0289`, e o servidor revive A no spawn de Armia com HP 41/130. No momento do uso, depois de um tick de regeneração, o HP era 80;
- um clique direito real na poção (slot 0) envia um `0x0373`; o servidor consome uma unidade (117→116 pelo `0x0182`), e o HP sobe para 130 pelo tick;
- B, no spawn, vê o HP de A em 130 pelo `0x0336` do servidor;
- dois cliques direitos no mesmo quadro enviam dois `0x0373`, e o servidor consome dois (→114); o valor local do runtime também é 114;
- um clique direito numa célula vazia (equipamento 7) não envia nada, e bolsa e equipamento continuam iguais;
- o relogin preserva a bolsa inteira, o ouro, o nível, a EXP e as 114 poções;
- protocolo limpo;
- o log do servidor registra `0x03AE` (`routed=false`), `0x0289` e três `0x0373` de 22 bytes de corpo.

## Loot — **aprovado** (Railway), sem ouro por defeito do servidor

Comando:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,loot --class 0
```

A execução foi pedida pelo usuário depois da interrupção da poção. A TK da conta A matou Gremlins por cliques reais até o limite de 25 abates, porque o harness esperava ouro além de itens.

| Medida | Resultado |
|---|---|
| Abates pagos pelo servidor (EXP subiu) | 25; nível 8 → 9, EXP 8606 |
| Itens recebidos no carry (`0x0182`, só para o matador) | 8, nos slots 13–20: 1551 ×3, 1560 ×2, 1701 ×2, 1801, todos do loot do template Gremlin |
| Itens perdidos ou trocados | nenhum |
| Ouro | **0** em 25 abates; coin 1.000.000, o valor inicial |
| Relogin | carry (índice e efeitos), equip, coin, nível e EXP idênticos |
| Saúde | nenhum descarte, nenhum erro de página |
| Log do servidor | 51 `0x039d` e 44 `0x036c` roteados; nenhum `crack` |

Arquivos: [JSON](2026-09-30-inventory-loot-passed.json), [log do servidor](2026-09-30-inventory-loot-passed-server.txt).

**Defeito do servidor, confirmado em fonte e em execução:** nenhum mob dá ouro. `loot.GoldDrop` devolve 0 quando `mobCoin == 0`, e `world.SpawnMobAt` (`world/api.go`) monta a entidade a partir de `protocol.ParseMobBasics`, que não lê o `Coin` do template (`MobBasics` não tem o campo). Por isso `mob.Coin` é sempre 0.

Com o `Coin` 50 do Gremlin e a chance de 1/3 para mobs abaixo do nível 10, 25 abates sem ouro teriam probabilidade de cerca de 4×10⁻⁵. A TK também não ganhou ouro em mais de 50 abates de sessões anteriores.

Correção proposta para uma entrega separada no servidor: ler `STRUCT_MOB.Coin` (@28) em `ParseMobBasics` e atribuí-lo em `SpawnMobAt`, com teste. O caminho `0x0337` do cliente foi exercitado só nas unidades; sem ouro, não teve prova online.

## Itens no chão — **bloqueado pelo servidor**

O servidor não anuncia itens no chão: não envia `0x026E`, os CNF são placeholders de 16 bytes e não há decay. Proposta de entrega separada na [ADR 007](../../decisions/007-inventory-dialect.md). Nada foi alterado no servidor.
