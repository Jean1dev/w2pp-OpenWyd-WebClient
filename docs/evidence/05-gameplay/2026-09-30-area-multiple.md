# Giro da Fúria — prova de múltiplos alvos

Data: 30/09/2026. Decisão: [ADR 006](../../decisions/006-area-combat-evidence.md).

## Preparação confirmada em execução

- Worktree `taimen`, cliente inicial `92eb55f`; servidor em `external/server` no SHA `98286fdf01202f503523e89d3e50b2183f00c36c`; upstream separado em `external/OpenWyd`, `beb9f69bdea6d81f70af14b5ce85ed064575bb26`.
- Railway, leitura pela CLI 5.63.1: deploy `9016864a-f04c-4023-86d2-832efbbe6a3c`, estado SUCCESS, commit `98286fdf…`, `W2PP_CLIENT_VERSION=12000`, TCP `reseau.proxy.rlwy.net:56950`.
- `.env` e emsdk das sessões históricas não existiam neste worktree. O usuário autorizou criar contas de teste no portal do operador. Duas requisições `POST /api/signup` retornaram HTTP 201. Credenciais geradas e guardadas somente no `.env` ignorado pelo Git; sem cookies ou resposta bruta persistidos. Essas são contas novas, não os personagens das evidências anteriores.
- Emsdk restaurado localmente no commit `d223ae73c6998296e3ab27cf81dc2c2c9fd383de`, release 6.0.0 / `772bb4648be4a897ca062d6adc65bc70223d2703`; ativação apenas local. Aquecimento `em++ --version` antes do build.
- Assets reutilizados localmente; nenhum asset ou executável adicionado ao Git.

## Implementação

`castarea` requer TK, A/B e a skill 0 aprendida. Seleciona Gremlins adjacentes por tiles inteiros, revalida o par após o hover e envia o gesto original. O diagnóstico registra um subconjunto explícito dos campos de combate, em dois buffers de 64 eventos, somente quando habilitado pelo harness. O verificador reprova dano acumulado, resposta ambígua, observador ausente, eventos perdidos, IDs repetidos e HP incompatível com o resultado autoritativo. B fecha antes do relogin de A.

## Verificação local

- `npm.cmd run world:checks`: 15 testes aprovados, incluindo seleção geométrica e falsos positivos de múltiplos alvos.
- `npm.cmd run protocol:dialect`: 469 verificações, zero falhas, compiladas para wasm32. Diagnóstico desabilitado, campos/sinal/EXP, tamanho inválido, capacidade de saída insuficiente, limites/overflow e limpeza exercitados.
- `npm.cmd run protocol:vectors`: 97 vetores e 28 fluxos; overlays Go e fragmentação aprovados. Bytes do protocolo permanecem inalterados.
- `node --check tools/verify_world.mjs`: aprovado.
- Build de objetos: 115/115, `contract_unchanged=true`, `certified=true`, `--jobs 2`. Link estrito com zero indefinidos; repetição incremental retornou 0 e reutilizou os 115 objetos. O primeiro wrapper PowerShell com redirecionamento de stderr reportou exit 1 apesar do relatório de link com `returncode=0`; a repetição com `exit $LASTEXITCODE` confirmou sucesso.
- WASM `tmproject_startup.1790768589961421100.wasm`, SHA-256 `9479750f7b1245ccb4881bcfe6c9d74e396d2cd72139fe21246acdce76234368`. Os cinco exports de diagnóstico estão presentes.
- `npm.cmd run scene`: Field e Select Server com 121 quadros cada, zero falhas; entrada de mouse/teclado e terreno aprovados.
- `npm.cmd run client:stream`: aprovado, 1002 frames/154148 bytes exatos, incluindo 158 fragmentos terminando no meio de frames. Teste isolado, sem alegação de multiplayer.

## Comandos

```powershell
$env:EMSDK = (Resolve-Path .cache/toolchains/emsdk).Path
python external/OpenWyd/webclient/client-wasm/tools/build_tmproject_wasm_objects.py --repo-root external/OpenWyd --jobs 2
python external/OpenWyd/webclient/client-wasm/tools/link_tmproject_wasm_startup.py --repo-root external/OpenWyd --dev --jobs 2 --link-opt-level O2
npm.cmd run scene
npm.cmd run client:stream
node tools/verify_world.mjs --target reseau.proxy.rlwy.net:56950 --client-version 12000 --env-file .env --phases login,enter,second,castarea --class 0
```

## Resultado online

Aprovado; ver [Prova de área](#prova-de-área--aprovada) no fim deste arquivo. Os pré-requisitos (personagens, nível 8, skill) foram obtidos por gameplay real nas contas novas; nenhuma prova histórica foi atribuída a elas.

### Falha de preparação 1

A execução `2026-09-30T11-48-55-745Z` recebeu a recusa de senha do servidor, sem erro de protocolo. A senha gerada tinha 12 caracteres; `TMSelectServerScene` copia para `AccountPass[12]` com `sprintf_s`, implementado por `vsnprintf(buffer, N, ...)` na compatibilidade, que reserva o terminador e trunca para 11. Causa confirmada em fonte; recusa confirmada nos logs do tm-server. O par inicial ficou sem personagens e suas credenciais foram preservadas no arquivo local ignorado `.env.area-first`. O par substituto usa senhas aleatórias de 10 caracteres; seu login já foi aceito. Não houve alteração no fluxo de login nesta fatia.

### Preparação 2 — personagens

Execução `2026-09-30T11-52-17-160Z` (`--phases login,create,enter,second --class 0`): aprovada. A criou a TK no slot 0 e entrou no Field; B entrou em contexto separado. Memória livre mínima 873/8014 MiB com as duas páginas abertas. Confirmado em execução.

### Preparação 3 — progressão da TK

`--phases login,grind --class 0 --grind-level 8`, uma página.

- Execução `2026-09-30T11-59-05-819Z`: 44 abates pagos pelo servidor, nível 1→7, EXP 0→6131, sem morte. Encerrada pelo prazo de 25 minutos do cenário (`ok=false`, esperado para progressão longa; o progresso é persistido pelo servidor). Confirmado em execução.
- Execução `2026-09-30T12-24-27-770Z`: retomou em nível 7/EXP 6131 (progresso persistido), 7 abates, nível 8, EXP 6726, sem morte. `ok=true`. Total: 51 abates. Confirmado em execução.

### Preparação 4 — aprendizado

Execução `2026-09-30T12-33-47-036Z` (`--phases login,learn --class 0`): Cap.Cavaleiros (12467) ofereceu 5000..5023; bit aprendido `0x1` (Giro da Fúria), 0 pontos restantes, bit preservado no relogin. `ok=true`. Confirmado em execução.

### Prova de área — tentativa 1 (memória)

Execução `2026-09-30T12-42-11-832Z` (`.cache/area-cast-1.log`): `FAIL less than 1 GiB free before opening observer`, com 996 MiB livres após `enter`. É a proteção do ADR 006. A memória estava ocupada por outros aplicativos do operador, não por navegadores Playwright remanescentes (nenhum encontrado). Nenhum clique de combate foi enviado. A proteção não foi relaxada.

### Prova de área — aprovada

Execução `2026-09-30T12-43-40-996Z`, `--phases login,enter,second,castarea --class 0`, `ok=true`, 1280 s. Evidência sanitizada: [`2026-09-30-area-multiple-passed.json`](2026-09-30-area-multiple-passed.json) (SHA-256 `7b2a779f54375e13787ef0feef27de33f686d8d58eeae3044c82e24205ffc45a`); logs do tm-server: [`2026-09-30-area-multiple-passed-server.txt`](2026-09-30-area-multiple-passed-server.txt) (SHA-256 `74185895618e8eae48dd9768907ef1c58acd028f4138396972a286b0a12a7e01`), leitura Railway 13:03:00Z..13:08:30Z. Revisões registradas: cliente `92eb55f` + alterações não commitadas desta fatia, servidor `98286fdf…`, upstream `beb9f69b…`.

- A e B caminharam até os geradores 27..30 (Armia leste). Par selecionado: Gremlins 1037 (2183.5, 2103.5) e 1035 (2183.5, 2104.5), um tile entre si, ambos HP 70 em A e em B.
- Atribuição: célula 5000 → cinto 0, selecionada 0; última intenção após atribuir `0x378`.
- **Tentativa 1 aprovada.** Saída de A: um único `0x0367` com alvos 1037 e 1035, `Damage=-1` (intenção de skill). Log do servidor: um único `recv packet conn=1 type=0x0367 len=152 routed=true` às 13:06:21.860Z.
- Resposta autoritativa, idêntica em A e B (exceto a sequência local): atacante 1, skill 0, HP 122, MP 97, EXP 6726; alvos **1037 dano 40** e **1035 dano 40**; as outras 11 posições vazias. Em ambas as sessões os dois Gremlins passaram de HP 70 para 30. MP 112→97 (custo 15 cobrado pelo servidor). `lost=0` nos dois buffers; A não morreu.
- Relogin após fechar B: equipamento, nível 8, EXP 6726 e bit aprendido `0x1` preservados; posição volta ao spawn da cidade (2087, 2104), fora do critério.
- Erros de página: nenhum em A, B e A-relogin.
- Memória: 801 MiB livres com as duas páginas no campo; 1412 MiB após fechar B.
- Capturas locais (não versionadas, contêm assets) em `.cache/world/2026-09-30T12-43-40-996Z/`: `A-area-1.png` `4d064de2…918da`, `B-area-1.png` `032d5a3a…46577`, `A-area-relogin-area-relogin.png` `700e83c8…4a1`, `A-skill-assigned.png` `b3a7bd8c…16c2`.

Divergência registrada (hipótese): o snapshot local de A lido logo após a janela de observação mostra `myMp=112` e `myHp=125`, embora a resposta autoritativa diga MP 97 e HP 122. O HP subiu 3 na mesma janela, o que indica um tick de regeneração do servidor; não foi verificado se o MP voltou por regeneração ou se o cliente deixou de aplicar o MP da resposta. O verificador usa o MP do resultado autoritativo, não o snapshot.

Limites: um único par e um único lançamento; skill 0 no servidor fixado; buff/cura, outras skills de área e cliente Windows não exercitados.
