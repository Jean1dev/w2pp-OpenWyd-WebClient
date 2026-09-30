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

## Poção — **não provada**

| Execução | Resultado |
|---|---|
| 1 (`…,potion`, dano dos Gremlins) | **interrompida pelo Claude Code por falta de memória** durante o login de B (1.087 MiB livres depois do `enter` de A, [issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)) |
| 2 (mesmo cenário, pedida pelo usuário; [JSON](2026-09-30-inventory-potion-gremlins-failed.json)) | **reprovada no desenho:** HP 130/130 depois de 11 lutas contra Gremlins. Nenhuma execução de grind (136 abates somados, quatro classes) ficou abaixo de 50% de HP; o dano é pequeno e a regeneração natural (nível+30 a cada 10 s) repõe tudo |
| 3 (`…,death,potion`) | **interrompida pelo Claude Code por falta de memória** durante o login de B (1.174 MiB livres depois do `enter` de A) |

Mudança depois da execução 2: a fase `potion` passou a exigir `login,enter,second,death`.

- O dano vem da fase `death`, já provada: A morre para os Trolls e o servidor a revive com HP 2 no spawn de Armia, ao lado de B.
- A regra exige que o HP suba mais do que um tick de regeneração (39) ou chegue ao máximo, para não confundir a poção com a regeneração.

Em nenhuma das três execuções o cenário chegou a usar a poção. Nenhum processo ficou órfão.

Comando pendente:

```
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,death,potion --class 0
```

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
