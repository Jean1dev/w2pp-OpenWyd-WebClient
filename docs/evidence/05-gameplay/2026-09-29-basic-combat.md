# Retomada: critérios de combate e relogin

## Ambiente e proveniência

- **Confirmado em execução pela Railway CLI 5.63.1:** projeto `wyd` (`08049b1a-6753-4274-b436-0dff658a5df1`), serviço `tm-server`, ambiente `production`; TCP `reseau.proxy.rlwy.net:56950`; `W2PP_CLIENT_VERSION=12000`.
- Deploy ativo `9016864a-f04c-4023-86d2-832efbbe6a3c`, status `SUCCESS`, commit `98286fdf01202f503523e89d3e50b2183f00c36c`. Consultas `project list`, `variable list` e `deployment list`; valores privados das variáveis filtrados em memória.
- Cliente parte de `604328926be1d52bfe3d1ed16e14ac2933c152ee`; upstream `beb9f69bdea6d81f70af14b5ce85ed064575bb26`, patches 0001–0012. Checkouts isolados em `external/server` e `external/OpenWyd`.
- Node 22.16.0, Go 1.25.13, Python 3.14.3, Playwright 1.54.2, Chromium 139.0.7258.5. WASM já compilado reutilizado do worktree `start`; fontes dos patches conferidas, JS/WASM/dataset verificados por SHA-256. Nenhuma recompilação nesta retomada; Emscripten 6.0.0 é a toolchain registrada do artefato original.
- Contas existentes A/B lidas de `../start/.env`, sem criação de contas, ajuste de atributos, mudança de servidor ou deploy. Assets e capturas ficam em diretórios ignorados.

## Correções confirmadas em fonte

- O cenário anterior pulava `checkCombat` quando A morria; o observador era opcional. Agora morrer não aprova combate, B precisa ver o alvo, receber broadcast e observar dano/morte explícita. Desaparecimento isolado não comprova morte.
- A lista de tentativas armazenava `target.id`, mas a seleção consultava `id`: o mesmo alvo podia ser escolhido novamente.
- Observações finais de HP/morte de A e B entram na evidência. Tentativas são preservadas quando os critérios reprovam.
- Depois do combate aprovado, clique real no chão interrompe o ataque; A desconecta e reconecta. A prova compara identidade, classe, equipamento, aparência, nível e experiência e aceita o spawn da cidade e HP regenerado. `world.CharacterSaveFor` no servidor persiste nível/experiência/equipamento; o navegador não os calcula.

## Execução 1: portal para a região dos Trolls

**Confirmado em execução, falhou:** `2026-09-29T18:16:10Z` até `18:26:58Z`.

Login, PIN, entrada no mundo de A/B e percurso ao portal passaram. Logs do servidor registram `0x0290` para ambos: B chegou a `2588,2097`; A a `2589,2098`.

A já estava com HP **0/105** antes do primeiro clique. O alvo selecionado era `Troll Mago`, ID 2714, HP 2500; B também o via com HP 2500. Foram **zero cliques, zero ataques enviados e zero ecos** na janela do alvo, experiência 0→0. O teste reprovou com `attacker died before combat verification`, em vez de aceitar a morte como sucesso. Não prova ataque básico nem relogin pós-combate.

Os contadores finais não registraram descartes de opcode/tamanho/faixa, campos zerados ou erros de página. Capturas locais e hashes estão no JSON da execução; a imagem de A confirma HP zero. Os logs correlacionam os dois teleportes e encerramentos, sem registrar envio de ataque pelo cliente.

**Decisão:** não repetir esse percurso com os personagens iniciais. O `NPCGener.txt` da revisão fixada (blob Git `caa5b32db3b02be233a4964b17ced50fd260a97c`) define os geradores 27–30 de `Gremlin` em x=2184, y=2118/2106/2094/2086. O cenário passa a caminhar pela saída leste de Armia e selecionar somente o nome `Gremlin`, conferido nas entidades reais recebidas. Essa definição em fonte não substitui a prova online do novo percurso.

## Verificações locais

Evidência da primeira execução: [JSON sanitizado](2026-09-29-trolls-failed.json), [logs do Railway](2026-09-29-trolls-server.txt) e [hashes dos artefatos reutilizados](2026-09-29-reused-artifacts.json).

- `node --test tools/world_checks.test.mjs`: **8 testes passaram**, também na versão fixada 22.16.0. Casos negativos: morte de A, alvo perdido, observador ausente, broadcast ausente, HP inalterado, envio/eco ausente e divergência de persistência.
- `node --check tools/verify_world.mjs` e `node --check tools/world_checks.mjs`: passaram.
- `python tools/build_local_scene.py --page-only` e `node tools/verify_local_scene.mjs`: Field e Select Server, 121 quadros cada, zero erros GL/página/requisição. Lacunas conhecidas: `abox01/02.msa`, `questsubjects4.txt`; cena offline não é prova de multiplayer.
- `node tools/verify_client_stream.mjs`: passou, 1002 frames, 154148 bytes, 158 chunks terminando no meio de frames, hash `33f7b512`. Servidor roteirizado local, apenas regressão do transporte.
- Nenhum codec foi alterado; os testes C++/Go de dialeto e vetores não foram repetidos.

Comando online (Node 22.16.0 em `.cache/toolchains/node/node.exe` neste worktree):

```powershell
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file ../start/.env --phases login,enter,second,attack
```

## Execução 2: caminho até a saída leste

**Confirmado em execução, falhou:** iniciada em `2026-09-29T18:36:11Z`, [JSON sanitizado](2026-09-29-east-gate-failed.json). A/B fizeram login e entraram no mundo; a caminhada parou perto de `2140,2097`, ao tentar alcançar `2146,2096`. A captura local `B-stall.png` mostra a cerca lateral do portão. O limite de quatro tentativas sem progresso encerrou a execução; nenhum combate foi aprovado.

**Correção derivada de fonte:** obter somente os blobs `HeightMap.dat` (`b273155fa007d09a29832ba5c968e2dc47b6ff4e`) e `AttributeMap.dat` (`74cfab0f01d33d3b34992eae1398fc97bbad25b7`) da revisão fixada, mantidos no checkout ignorado. Aplicar as condições de `route.Bake`/`route.Next`: atributo bit 2 bloqueia o tile e diferença de altura deve ser menor que 8. A busca entre `2130,2092` e `2184,2106` encontrou caminho de 55 tiles pelo corredor y=2102. Os bytes de atributos do cliente coincidem com os do servidor ao longo do caminho.

O harness passa por `2138.5,2102.5`, `2152.5,2102.5`, `2166.5,2102.5` e `2184.5,2106.5`, por cliques reais. A busca estática serve para escolher pontos de caminhada; o cliente continua solicitando movimento e o servidor continua validando cada intenção. O trajeto ainda exige confirmação em execução.

## Execução 3: pick coberto por entidade

**Confirmado em execução, falhou:** `2026-09-29T19:02:20Z`, [JSON sanitizado](2026-09-29-entity-pick-failed.json). A execução iniciada ao fim da sessão anterior (`18:47:09Z`) foi interrompida sem resultado. Login/entrada de A/B passaram; A estava a 6,3 tiles do primeiro ponto quando os cinco deslocamentos do melhor pick caíram sobre uma entidade, e `walkTo` abortou com `no entity-free ground near target`. Não é bloqueio de rota.

**Correção no harness:** um pick coberto por entidade entra em `avoid` e a iteração escolhe outro ponto da tela, dentro de `maxClicks`/`maxStalls`. Continua sendo clique real; nada é enviado sem pick livre.

## Execução 4: rota leste aprovada, ataque descartado pelo dialeto

**Confirmado em execução, falhou:** `2026-09-29T19:07:24Z`, [JSON sanitizado](2026-09-29-attack-one-size-failed.json).

- **Rota confirmada:** A chegou a `2185.5,2106.5` (21 cliques) e B a `2184.5,2106.5` (24 cliques), HP 105/105, pelo corredor y=2102.
- Alvo `Gremlin` id 1037, HP 70, visto por A e B com HP 70.
- O dialeto de A descartou **19** `0x039D` de saída como `outDropSize`; nenhum ataque chegou ao servidor. B não teve descartes.

**Causa, confirmada em fonte:** o caminho corpo a corpo do runtime (`TMHuman.cpp`, ramos em ~11145 e ~15590) declara `MSG_Attack stAttack` com `Header.Type = 0x039D` e `nSize = sizeof(MSG_Attack)` (168). Só reduz para `MSG_AttackOne`/`Two` em ramos de classe 3/skills. A ADR 004 exigia 72 bytes fixos para `0x039D`. O servidor (`MsgAttackBody.Decode`, `98286fdf`) não usa o opcode: deriva N do comprimento, limitado a 13.

**Correção no dialeto:** a struct e N vêm do tamanho do runtime (168/80/72 → N 13/2/1), e o opcode sai como veio. Tamanho diferente desses três continua descartado. Teste `dialect_test.cpp`: `0x039D` com 168 bytes → 164 bytes, opcode `0x039D`, prefixo e `Dam[0]` iguais ao frame de um alvo; tamanho 100 → descarte.

- `python tools/apply_openwyd_patches.py && python tools/protocol/run_dialect_test.py` (em++ 6.0.0 de `../start`, via `EMSDK`): **433 checks, 0 failures**.
- `protocol:vectors` (cpsock_ref, gen_vectors, overlay Go): **PASS**.
- Runtime WASM recompilado (115 objetos, `certified=true`, 0 símbolos indefinidos), `tmproject_startup.1790709956770811300.wasm` SHA-256 `9550da7b19d2f5e96ddfcf02c6553145c9b6c8944524f58c5ab694491b88da1e`. `scene` e `client:stream` passaram.

## Execução 5: dano confirmado, saúde de protocolo reprovada

**Confirmado em execução:** `2026-09-29T19:30:40Z` até `19:43:53Z`, [JSON sanitizado](2026-09-29-combat-health-failed.json), com o runtime recompilado.

- A e B chegaram aos Gremlins, em `2184.5,2107.5` e `2185.5,2106.5`, com 23 cliques cada.
- Alvo `Gremlin` 1031, HP 70. A fez 1 clique; 3 ataques saíram e houve 25 ecos do servidor.
- HP do alvo `[70, 3, 0]` e morte, observados **igualmente por A e B** (B recebeu 25 broadcasts).
- Experiência de A 0→274; HP de A 105/105; gold inalterado.
- **Reprovou em `checkHealth`:** A descartou 1 `0x0378` de saída (`outDropUnknown`) e 1 `0x5000` de entrada. A verificação de relogin pós-combate não chegou a rodar.

**Causa e correção, confirmadas em fonte:**

- `0x0378` `MSG_SetShortSkill`: o runtime envia `Header + char Skill[20]` (32 bytes). `handler/skill.go` lê `[0:4]` como barra e `[4:20]` como atalhos, sem resposta. O layout é idêntico, então passa a atravessar o dialeto com tamanho exato 32; outro tamanho é descartado.
- `0x5000` `MSG_Exp_Msg_Panel_`: painel de texto customizado do servidor (`mobkilled.go`, "+N de EXP"). Não tem handler no runtime. A experiência já chega pelo `CurrentExp` do eco de ataque. Entra em `DEFERRED_INBOUND`: descartado, contado e reportado, sem renderização.
- Testes: `run_dialect_test.py` **435 checks, 0 failures**; `world:checks` **8 passaram**. Runtime recompilado de novo (`tmproject_startup.1790711169720373100`), certificado, 0 símbolos indefinidos; `client:stream` passou.
