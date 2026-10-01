# Etapa 6: fidelidade e desempenho

## Linha de base offline (01/10/2026)

Primeira medição da etapa 6. Não depende de servidor nem do cliente Windows.

| Item | Valor |
|---|---|
| Máquina | notebook de desenvolvimento do operador, Windows 11, 8 GB de RAM |
| Navegador | Chromium 139.0.7258.5 (Playwright 1.54.2), headless, WebGL2 por software (SwiftShader) |
| Janela e canvas | viewport 1100×900, canvas 800×600 |
| Cena | Field offline em Armia (fixture do runtime, mapa 16,16), sem entidades do servidor |
| WASM | `tmproject_startup.1790883428920400700` |
| Pacote | `openwyd_assets.data`: 7.093 arquivos, 305 MiB, preload integral com cache em IndexedDB (`WYD_PRELOAD_CACHE`) |

```
npm run measure            # = build_local_scene --page-only + node tools/measure_scene.mjs
node tools/measure_scene.mjs --seconds 60 [--browser firefox]
```

O `tools/measure_scene.mjs` serve o site local e usa um perfil persistente: a primeira carga é fria e a segunda usa o cache. A página é instrumentada só por fora, com um script de inicialização que envolve `Module.FS.open` (arquivos abertos) e `Module._wyd_tick_client` (CPU por quadro). Runtime e página não mudam. A amostragem de quadros começa depois do primeiro quadro e dura 60 s.

Resultado ([JSON](2026-10-01-baseline-chromium.json)):

| | Frio | Com cache |
|---|---|---|
| Runtime pronto (`onRuntimeInitialized`) | 4,4 s | 1,4 s |
| Primeiro quadro | 18,8 s | 15,5 s |
| Bytes servidos | 309,3 MiB | 4,4 MiB |
| Heap JS / heap WASM | 527 / 180 MiB | 527 / 180 MiB |
| Quadros por segundo | 2,6 | 2,7 |
| CPU do jogo por quadro (`_wyd_tick_client`), p50/p95/p99 | 10,4 / 13,0 / 16,1 ms | 11 / 16 / — ms |
| Intervalo entre quadros, p50/p95/p99 | 412 / 434 / 448 ms | — |

Leitura (**confirmado em execução**, nesta máquina):
- **O gargalo de fluidez é o renderizador por software do headless**, não a lógica: ~11 ms de CPU do jogo contra ~410 ms entre quadros. Esse número não serve de orçamento para uso real; falta medir com GPU, num navegador com janela.
- **O cache funciona:** a carga com cache baixa só 4,4 MiB e o runtime fica pronto em 1,4 s. Mas o primeiro quadro ainda leva 15,5 s, gastos no boot do cliente (abre 1.182 arquivos e monta a cena).
- **O preload integral domina a memória.** O heap JS tem 527 MiB para um pacote de 305 MiB, e a cena abre só 50,5 MiB dele:

| Diretório | Abertos / total de arquivos | MiB abertos / total |
|---|---|---|
| `Mesh` | 1.039 / 5.357 | 36,1 / 174,5 |
| `UI` | 29 / 339 | 2,9 / 70,9 |
| `Sound` | 9 / 351 | 5,3 / 36,3 |
| `Env` | 41 / 521 | 1,6 / 13,2 |
| `Effect` | 33 / 467 | 0,5 / 3,8 |
| `NUI` | 2 / 8 | 1,1 / 3,2 |
| raiz e `shader` | 29 / 50 | 3,1 / 3,1 |

A lista de caminhos não é versionada, porque o manifesto completo de assets fica fora do Git; ela sai em `.cache/measure/`.

## Por que reduzir o preload não é trivial (confirmado em fonte)

- O runtime lê arquivos com `fopen` síncrono na thread principal.
- Modelos e animações de mobs e NPCs são abertos quando a entidade aparece (`CreateMob`), a qualquer momento da sessão.
- Uma busca pela rede no momento do `fopen` exige Asyncify, ou o laço principal num Worker (leitura síncrona, `OffscreenCanvas`), ou um sistema de arquivos com acesso síncrono (WASMFS com OPFS, também só em Worker).

Opções, a decidir em ADR antes de implementar:
1. **Pacotes por região, com pré-busca nas transições conhecidas** (login no Field, `0x0290`, teleporte por comando), mantendo `Mesh` comum preloaded. Reduz `UI`/`Env`/`Sound`, mas não resolve `Mesh`, que vem de entidades dinâmicas.
2. **Asyncify só nos caminhos de leitura de asset.** Busca sob demanda com cache em IndexedDB. Custa tamanho e desempenho do WASM, e mexe no build.
3. **Laço do jogo num Worker**, com arquivos sob demanda (síncronos no Worker) e WebGL por `OffscreenCanvas`. É a mudança estrutural maior; resolve memória e travamentos de carga.
4. ~~Investigar os 220 MiB além do pacote no heap JS~~. Resolvido em 01/10 (abaixo): não há duplicação.

## Composição da memória (01/10/2026, confirmado em execução)

Mesma cena e mesmo navegador, a frio e com cache. A coleta de lixo foi forçada pelo protocolo de depuração do Chromium (`HeapProfiler.collectGarbage`), e a leitura usou `Runtime.getHeapUsage`. Medido com um script descartável, não versionado.

| | Antes da coleta | Depois |
|---|---|---|
| Objetos JS (heap V8) | 8,5 MiB | 3,9 MiB |
| Backing store de `ArrayBuffer`s | 496,4 MiB | 496,4 MiB |
| `performance.memory.usedJSHeapSize` | 527,4 MiB | 527,4 MiB |

- Os 527 MiB do `performance.memory` não são objetos JS. São o backing store dos `ArrayBuffer`s: o pacote (305 MiB) mais a memória linear do WASM (180 MiB), que o Chromium soma nessa métrica, mais ~11 MiB de outros buffers.
- Não há cópia do pacote: os 7.093 arquivos do MEMFS são `subarray` de um único buffer de 305 MiB (`FS_createDataFile` com `canOwn`). As cópias do download e do IndexedDB são temporárias e coletáveis.
- O WASM cresce sob demanda (`ALLOW_MEMORY_GROWTH=1`, sem memória inicial alta). Os 180 MiB são alocação do motor.

Memória dos processos do Chromium com uma página do jogo aberta (working set, MiB):

| renderer | browser | gpu-process | utility | total |
|---|---|---|---|---|
| 654 | 140 | 137 | 105 | 1.036 |

**Conclusão:** o pacote é quase metade do renderer, e a cena usa ~50 MiB dele. Carregar sob demanda economiza até ~255 MiB por página, ~25% do total e ~0,5 GB nas execuções com duas contas (issue #6). As opções 1–3 acima continuam valendo e precisam de uma ADR. O próximo dado necessário é o conjunto de arquivos abertos numa sessão online (Field com mobs, troca de mapa, combate), para dimensionar pacotes por região.

## Limites desta medição

- Só Chromium headless com renderização por software; sem GPU, sem Firefox e sem Safari.
- Cena offline: sem mobs do servidor, sem troca de mapa e sem ensaio longo. O conjunto de trabalho de uma sessão real será maior que 50,5 MiB e precisa ser medido online (Field com mobs, troca de mapa, combate).
- Sem comparação visual com o cliente Windows (depende das capturas do operador).
- Uma única execução de cada caso.
