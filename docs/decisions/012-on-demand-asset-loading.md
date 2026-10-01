# ADR 012: Carregamento de assets sob demanda (etapa 6)

Data: 01/10/2026. Estado: **proposta**, aguardando decisão do operador. Nada foi implementado.

## Contexto

Cada página do jogo pré-carrega o pacote `openwyd_assets.data` inteiro (7.093 arquivos, 305 MiB) num `ArrayBuffer` que fica na memória do renderer durante toda a sessão. Medições da [etapa 6](../evidence/06-paridade/README.md) (confirmadas em execução):

- **Memória por página:** ~1.036 MiB de working set nos processos do Chromium, dos quais 654 MiB no renderer. Do que o `performance.memory` informa (527 MiB), quase tudo é backing store: o pacote (305 MiB) mais a memória do WASM (180 MiB). Não há cópia do pacote: os arquivos do MEMFS são `subarray` de um único buffer.
- **Uso real:** a cena offline de Armia abre 50,5 MiB. Duas sessões online no Railway (Armia, campo dos Gremlins, Noatum, banco, combate e relogin) abrem juntas 1.968 arquivos, **76,5 MiB**. Noatum acrescentou 2,8 MiB ao conjunto de Armia.
- **Consequência:** as execuções com duas contas precisam de ~2,1 GB e foram interrompidas por falta de memória várias vezes ([issue #6](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/issues/6)). Para o jogador, cada aba consome ~1 GB, e o primeiro acesso baixa 309 MiB antes do primeiro quadro.

Restrição técnica (confirmada em fonte): o runtime lê arquivos com `fopen` síncrono na thread principal. Modelos, animações e texturas de mobs e NPCs são abertos quando a entidade aparece (`CreateMob`), a qualquer momento da sessão. Uma busca assíncrona no momento do `fopen` não é possível sem mudar o modelo de execução.

## Opções avaliadas

| # | Abordagem | Economia de memória | Custo e risco |
|---|---|---|---|
| 1 | Pacotes por região, pré-buscados nas transições conhecidas (login, `0x0290`, comandos de cidade) | `UI`, `Sound` e `Env` (~105 MiB sem uso), mas não `Mesh` | Os modelos de mobs não seguem região; um arquivo fora do pacote carregado falha |
| 2 | Asyncify nos caminhos de leitura de asset | Até ~225 MiB | Mexe no build; o WASM cresce e fica mais lento; risco em código C++ legado reentrante |
| 3 | Laço do jogo num Worker, com leitura síncrona no Worker e WebGL por `OffscreenCanvas` | Até ~225 MiB, e tira as cargas da thread da página | Mudança estrutural no runtime (entrada, áudio, contexto GL); maior esforço |
| 4 | Investigar duplicação no heap JS | — | Descartada: não há duplicação |
| 5 | **Conjunto quente pré-carregado + demais arquivos sob demanda por XHR síncrono com `Range` (`FS.createLazyFile`)** | Até ~225 MiB por página (305 → ~80 MiB) | Ver abaixo |

## Recomendação: opção 5, em duas fases

**Fase A, medir e preparar (sem mudar o comportamento):**
- Registrar o conjunto de arquivos abertos em mais percursos: as quatro classes, outras cidades e campos, combate com skills, loja, banco, grupo e troca. Usar o `--trace-files` existente, com a lista só em `.cache`.
- Gerar um **manifesto quente** (lista de caminhos) a partir da união. Ele só existe localmente, como os outros manifestos de assets, e é derivado no build.

**Fase B, implementar atrás de uma opção desligada por padrão:**
1. O empacotamento gera dois artefatos: `openwyd_hot.data`, pré-carregado como hoje (cache em IndexedDB), e o `openwyd_assets.data` completo, servido com `Range`.
2. No `preRun`, cada arquivo fora do conjunto quente é registrado com `FS.createLazyFile`, apontando para o deslocamento e o tamanho dentro do `.data` completo. A primeira leitura faz um XHR síncrono com `Range` e guarda os bytes no MEMFS. Um arquivo só é baixado uma vez.
3. Nos navegadores que exigem resposta textual em XHR síncrono na thread principal, usar `overrideMimeType('text/plain; charset=x-user-defined')`; seguir o código do `createLazyFile` do Emscripten 6.0.0 fixado.
4. Um Service Worker com Cache Storage pode servir as faixas de bytes sem rede depois da primeira vez. É opcional e fica para uma etapa seguinte.
5. Telemetria local, como no harness: arquivos frios abertos por sessão e tempo de bloqueio de cada leitura.

**Critérios de aceite da fase B:**
- O heap do renderer cai pelo menos 150 MiB por página na cena online de Armia.
- As suítes `scene`, `client:stream` e `world:checks`, e pelo menos `login,enter,second,attack` e `paidteleport` no Railway, ficam verdes com a opção ligada.
- Nenhum `assetOpenFailure` de arquivo presente no dataset.
- Bloqueio por arquivo frio no p95 abaixo de 50 ms em rede local, medido e registrado. Acima disso, a fase fica Em andamento.
- A opção desligada reproduz exatamente o comportamento atual.

## Custos e riscos aceitos se a opção 5 for adotada

- **XHR síncrono obsoleto:** na thread principal ele continua funcionando no Chromium e no Firefox, mas emite aviso de obsolescência e pode ser removido no futuro. As opções 3 ou 2 seguem como caminho de saída.
- **Travadas pontuais:** a primeira leitura de um arquivo frio congela o quadro durante o download. O conjunto quente tem de cobrir o percurso comum; a travada fica restrita a regiões e conteúdos raros.
- **Servidor de assets:** precisa aceitar `Range` no `.data`. O gateway já responde `206`, tanto no diretório local quanto pelo bucket S3 ([etapa 8](../evidence/08-entrega/README.md)).
- **Offline:** sem rede, um arquivo frio falha. Hoje tudo está no cache depois da primeira carga; com a opção 5, só o conjunto quente fica, até o Service Worker do item 4.

## Fora do escopo

- Reduzir os 180 MiB de memória do WASM (alocação do motor), que exige outra investigação.
- Os ~600 MiB de GPU, browser e utilitários do Chromium headless: dependem do navegador e da renderização por software, e precisam ser medidos com GPU real.

## Decisão pedida ao operador

1. Aceitar a opção 5 como direção, com a fase A primeiro.
2. Aceitar os custos acima: XHR síncrono obsoleto, travadas em conteúdo raro e falha offline de arquivos frios até haver Service Worker.
