# Evidências da etapa 4 — login, entrada no mundo e duas sessões — 28/09/2026

## Ambiente

- **Revisões:** servidor `98286fdf01202f503523e89d3e50b2183f00c36c`, que é o deploy do tm-server no Railway, `W2PP_CLIENT_VERSION=12000`. OpenWyd `beb9f69bdea6d81f70af14b5ce85ed064575bb26` com `patches/openwyd/0001..0004`.
- **Ferramentas:** Go 1.25.13, Emscripten 6.0.0, Playwright 1.54.2 com Chromium headless, que rasteriza em software a cerca de 1 quadro/s.
- **Decisões:** [ADR 003](../../decisions/003-in-world-dialect-and-automation.md).

## Resumo

| Item do prompt 04 | Estado | Como |
|---|---|---|
| Login incorreto | **confirmado em execução** (Railway) | servidor `bad password fails=1` → `0x102`; o cliente exibe "Senha incorreta." e continua na seleção de servidor |
| Login correto → seleção | **confirmado em execução** | `account login: OK`; estado 5 |
| PIN | **confirmado em execução** | 1º `0xFDE` numa conta sem PIN o definiu (lock → 1); logins seguintes verificam o mesmo PIN (lock → 1). PIN errado → `0xFDF` **não executado** |
| Criação de personagem e preview | **confirmado em execução** | `create char class=0` → `create char: OK`; preview lido da seleção: nível 0, HP 100/100, atributos 12/12/12/12, equipamento inicial `[1,1103,1115,1127,1139,1151,861]` |
| Entrada no Field com entidades reais | **confirmado em execução** | `CNFCharacterLogin` do servidor, sem fixture offline; 39 frames recebidos, 37 traduzidos, 2 repassados, **0 descartados**, 0 erros de página ou GL; NPCs e jogadores do servidor visíveis |
| Duas contas, spawn mútuo, nomes e equipamento | **confirmado em execução** | A vê B e B vê A; nomes iguais aos criados; `look` de A visto por B igual ao de A |
| Movimento bidirecional | **confirmado em execução** | clique real no canvas; o servidor registra `0x036C` e `0x0366` de cada sessão e os repassa; a posição final vista pelo outro coincide com a do dono (2090,5/2101,5 e 2091,5/2104,5); direção vista por B: −π/2 |
| Quem confirma a posição | **confirmado em fonte e em log** | o servidor aceita o destino e repassa o frame à área de visão (`movement.go`); a outra sessão só move a entidade ao receber o frame do servidor |
| Relogin e persistência | **parcial** | a cada login o servidor gerou spawn próprio perto da cidade (2097/2100, 2093/2093, 2090/2106, 2091/2105), coerente com a regra "cidade, não coordenada exata" (`world.go`, `character.go:228-235`). A fase automatizada de logout/relogin com a segunda sessão **não rodou** (ver Limites) |
| Despawn ao desconectar | **confirmado em log, não no cliente** | ao fechar B, o servidor enviou `0x0165` para A (22:31:36Z). A verificação do lado do cliente não rodou |
| Troca de mapa | **preparado, não executado** | `ReqTeleport` `0x290` e `ChangeCity` `0x291` passam pelo dialeto. `0x291` já chega ao servidor (`routed=true`). A fase `mapchange` (portal Armia → Armia Field) não rodou |
| Login concorrente | **confirmado em fonte, não executado** | o servidor não bloqueia sessões duplicadas; o cargo é sobrescrito (`world.go:442`). A fase `concurrent` não rodou |
| Erro de protocolo diagnosticável | **confirmado em execução** | avisos do servidor aparecem no painel; opcodes descartados ficam listados no probe e contados. Fora da tradução, o único opcode de saída descartado ao entrar era `0x0291`, que agora passa |
| Cliente Windows 7662 | **pendente** | não há ambiente Windows com o cliente; ver o roteiro manual abaixo |

## 1. Pacotes divergentes corrigidos (teste unitário)

A tabela está em [compatibility.md](../../compatibility.md#tradução-acrescentada-na-etapa-4) e as regras no ADR 003.

- **Fixtures independentes:** `gen_fixtures.py` ganhou 15, cobrindo `UpdateScore` (normal, `Magic` em overflow, `Level` em overflow), `SendAffect`, `UpdateEquip`, `CreateMobTrade`, `SetHpDam` (normal e overflow), `SetHpMp`, `SendItem`, `UpdateEtc`, `PKInfo`, `UpdateWeather` e dois avisos `0x102`. O arquivo é [fixtures/dialect.json](../03-protocolo/fixtures/dialect.json).
- **Overlay Go:** `TestExtDialectInbound` exige igualdade byte a byte com `EncodeUpdateScore`, `EncodeSendAffect`, `EncodeUpdateEquip`, `EncodeCreateMobTradeBody`, `EncodeSetHpDam`, `EncodeSetHpMp`, `EncodeSendItemBody`, `EncodeUpdateEtc`, `EncodeStandardParm` e `EncodeUpdateWeather`. Todos passam.
- **Teste C++ wasm32:** 364 verificações, 0 falhas. Cobre:
  - campo a campo;
  - cauda `0xCC` do `UpdateScore` que não chega ao runtime;
  - overflow zerado e contado;
  - tamanhos truncados recusados;
  - `0x102` → `MessagePanel` com `ID 0`;
  - `0x290`/`0x291` de 16 bytes.
- **Fluxo roteirizado da etapa 3:** o opcode "não mapeado" do volume passou de `0x336`, agora traduzido, para `0x333`. O fluxo segue exato: 1002 frames com o mesmo hash.

## 2. Execuções no Railway

`tools/verify_world.mjs` sobe o gateway real, a página real sob CSP e uma sessão Chromium por conta, em contextos separados. As credenciais vêm de `.env` e só chegam à UI do jogo. O arquivo de evidência mascara contas e remove qualquer valor do `.env`.

| Janela (UTC) | Fases | Resultado |
|---|---|---|
| 20:03:45–20:05:22 | badpass, login, create, enter | todas OK. O JSON foi sobrescrito pela execução seguinte, porque o harness ainda não gravava um arquivo por execução; os valores estão na tabela acima e em [railway-tmserver-log.txt](railway-tmserver-log.txt) |
| 22:26–22:31 | login, create, enter, second, move | move **falhou**: `page.mouse.click` instantâneo não chegou à cena, a ~1 quadro/s. O harness passou a passar o mouse, pressionar e soltar com intervalo |
| 22:32:07–22:36:24 | login, enter, second, move | **todas OK**: [run-move-2026-09-28T2233Z.json](run-move-2026-09-28T2233Z.json) |
| 22:37:07–22:38:50 | todas | badpass, login, create e enter OK. Durante `second`, o Claude Code encerrou o processo por falta de memória na máquina, não por falha do teste. Não foi reiniciado automaticamente |

- **Log do servidor** das janelas, sanitizado (IPs, contas e nomes substituídos): [railway-tmserver-log.txt](railway-tmserver-log.txt).
- **Três conexões `version mismatch got=0`** às 20:25, 20:34 e 20:44Z não vieram destas execuções; não havia harness rodando nesses horários.
- **Alerta `session out queue high`** (profundidade 32–37 de 64) aparece em cada entrada no mundo. É a rajada de cerca de 35 `CreateMob` enviada de uma vez, e não indica leitura lenta do cliente: nenhuma sessão foi derrubada.
- **Capturas locais** ficam em `.cache/world/*.png`, fora do Git porque contêm assets e o nome da conta no campo ID. Os SHA-256 estão nos JSONs.

## 3. Roteiro manual para o cliente Windows 7662 (pendente)

Pré-requisitos: cliente 7662 do operador apontado para o mesmo tm-server e as contas A e B de `.env`.

O `serverlist.bin` da cópia do operador (`Client-aws`, SHA-256 `ee979675…`) aponta todos os canais para `127.0.0.1:8281`; o `serverlist.txt` da mesma pasta (192.168.0.103) está desatualizado. **Confirmado em execução (29/09):** decodificado com a chave legada do `Basedef.cpp`. O tmserver responde ao `GET /serv00.htm` na porta de jogo (`world/edge.go`), então basta um relé TCP de loopback, sem regra de jogo, até o destino do operador:

```
node tools/tcp_relay.mjs --target reseau.proxy.rlwy.net:56950   # escuta só em 127.0.0.1:8281
```

Pelo relé, `curl http://127.0.0.1:8281/serv00.htm` devolveu `200` do Railway. O relé registra apenas abertura/fechamento e contagem de bytes.

1. **Windows contra web:** A no navegador (`npm run dev`), B no cliente Windows.
2. **Login e entrada:** logar B, digitar o PIN e entrar no Field.
3. **Visibilidade mútua:** conferir que cada um vê o outro com nome e equipamento.
4. **Movimento:** mover A e conferir no Windows; mover B e conferir no navegador (probe `clientProbe()` e `Module._wyd_field_human_x(id)`).
5. **Desconexão:** fechar o cliente Windows e confirmar o despawn no navegador.
6. **Relogin:** relogar e confirmar o spawn perto da cidade.
7. **Log do servidor:** guardar o log da janela com `railway logs --since/--until`, sanitizado como aqui.

Resultado esperado: os mesmos opcodes do log acima, sem `version mismatch` para o Windows. O navegador precisa usar o mesmo `ClientVersion` configurado no servidor.

## Comandos

```
npm run protocol:vectors          # tabela, vetores, overlay Go (transporte + dialeto)
npm run protocol:dialect          # patches 0001..0011 + teste C++ wasm32 (364 verificações)
npm run gateway:test
# runtime: build_tmproject_wasm_objects.py + link_tmproject_wasm_startup.py (docs/setup.md)
npm run scene                     # regressão da etapa 2
npm run client:stream             # regressão da etapa 3
node tools/create_test_account.mjs --portal https://wyd-ten.vercel.app --suffix 2   # conta B (uma vez)
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --env-file .env [--phases a,b,...]
npx -y @railway/cli@5.63.1 logs -p <projeto> -e production -s tm-server --since <ISO> --until <ISO> --json
```

## Limites

- **Fases executadas em 29/09** (relogin, troca de mapa, concorrência, PIN errado e as quatro classes): ver [continuidade](2026-09-29.md). Cada fase roda sozinha com `--phases`; `logout`, `mapchange` e `concurrent` precisam de `login,enter,second` (ou `login,enter` para `concurrent`).
- **Só Chromium headless**, cerca de 1 quadro/s. Firefox e cliente Windows não foram testados.
- **Automação por export:** PIN, criação e entrada usam exports que chamam os controles originais. O clique 3D na amostra de classe e no slot é substituído por atribuição do alvo. O movimento usa cliques reais.
- **Hipóteses mantidas:** `Tab`→`Nick` no `CreateMobTrade` e `Hold`→`FakeExp` no `UpdateEtc`.
- **Classe no runtime:** `m_nClass` do runtime vale 1 para um personagem criado com classe 0. É a classe de malha do `TMHuman`, não a classe do personagem; o servidor registrou `class=0`.
- **Terreno:** as capturas das execuções desta etapa são anteriores ao patch 0005 (catálogos de textura); depois dele o Field online aparece texturizado. Ver [etapa 2](../02-build/README.md).
