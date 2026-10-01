# Evidências da etapa 2 — cena real no navegador — 28/09/2026

## Estado observado

**Reprodução de 01/10/2026:** build limpo, importação e cena aprovados em Chromium e Firefox; etapa 2 **Validada**. Detalhes, hashes e limites em [2026-10-01-reproduction.md](2026-10-01-reproduction.md).

**Confirmado em execução:** a página própria (`web/local-scene.*`) inicializa o runtime WASM do Alan, monta os assets do operador e renderiza duas cenas originais em WebGL2, sem conexão ao servidor. A cena Field é identificada pelo próprio runtime — mapa 16,16, personagem `OpenWYD` classe 1 em 2096,5/2092,5, HP 320/320 — e responde a mouse e teclado: o clique no terreno alterou o destino de rota para 2094,5/2090,5 e a consulta de terreno devolveu o ponto 2092,25/0/2088,25. Zero erros GL, zero erros de página e zero requisições falhas nas duas cenas.

**Confirmado em execução:** a cena Field usa a *fixture offline* do runtime (`wyd_field_debug_fixture_used = 1`), não um mapa entregue pelo servidor. Isto não é paridade de mundo; é a cena real do cliente com dados locais enquanto o protocolo não existe.

**Confirmado em execução:** o relógio falso era a causa da cena distorcida registrada antes desta sessão. Com `?tickMs=16`, o harness upstream reproduz exatamente a mesma imagem — modelos gigantes e horizonte torto — porque a câmera fica no início da animação de abertura. Não era defeito de renderização nem de asset. A página agora acompanha o relógio do navegador, como o jogo ao vivo.

**Corrigido em 28/09/2026 (ver “Catálogos de textura” abaixo): a conclusão deste parágrafo estava errada.** O texto original dizia: o terreno sem textura vem de arquivos que o cliente 7662 do operador não fornece. Substituindo em memória, apenas para diagnóstico, os sete `env/tile*2.wys` da cena Field pelo nível 1 correspondente, as falhas de abertura caíram de 18.897 para 746 e os quadrados brancos sumiram — mas o terreno não ficou correto, e sim escuro. O nível 2 é um asset distinto, não uma cópia; nenhuma substituição o reproduz.

## Catálogos de textura: causa real das cores erradas (28/09/2026)

**Confirmado em execução.** Os catálogos `UI/UITextureListN.bin`, `Effect/EffectTextureList.bin`, `Mesh/MeshTextureList.bin` e `Env/EnvTextureList3.bin` do cliente 7662 usam registros de **264 bytes**: `szFileName[255]`, `cAlpha@255` e 2 DWORDs. Os tamanhos são 512, 512, 2048 e 512 registros, e o espaçamento entre nomes medido nos quatro arquivos é 264.

O runtime lia esses arquivos com `fread` na struct de **528 bytes** (`szFileName[255]`, `szFilePart[255]`, `cAlpha@510` e 4 DWORDs). Com isso, o índice N recebia o nome do registro 2N, e a metade superior ficava vazia. Por exemplo, o índice de ambiente 6 abria `Env\Tile00002.wys`, que é a entrada 12 do catálogo e cujo arquivo não existe. Já os índices 256+ (`MTile*`, a segunda camada do terreno) saíam vazios.

O efeito era terreno branco ou trocado, anéis de efeito no chão, UI sem moldura e modelos com textura errada.

O patch `patches/openwyd/0005-texture-catalog-layout.patch` lê os dois layouts. Ele escolhe o espaçamento pelo conteúdo: conta os registros com nome plausível e código de alpha válido (`N`, `A`, `a` ou `C`) em cada layout.

| Cena | Antes (sha256 da captura) | Depois | Lacunas antes → depois |
|---|---|---|---|
| Field offline | `b44abd0a…59b2`: chão branco/preto, anéis, UI sem moldura | `bb3fcea1…322d`: calçamento de Armia, fonte, UI completa, armadura | 11 → 3 (`mesh//abox01.msa`, `mesh//abox02.msa`, `ui/questsubjects4.txt`) |
| Select Server | `cbe48893…c9db` | `8ce6557b…b58d`: painéis com moldura, céu, água | 3 → 0 nessa execução; a cena sorteia modelos e em outra execução pediu `mesh//abox02.msa` e `mesh/hs010301.msh`, ausentes de fato |
| Field online (Railway, etapa 4) | capturas de `.cache/world` antes da correção | `eeaa36fd…9e47`: cidade texturizada, NPCs e jogadores | — |

Os `env/*tile*.wys` “ausentes” eram artefato da leitura errada (`mesh/bird0101.wys` e `mesh/hs010301.msh` não: são ausências reais); o catálogo correto não os pede na cena medida. O experimento de substituição do parágrafo acima deu “terreno escuro” porque o índice continuava errado. Capturas em `.cache/texfix/before/` e `.cache/`, fora do Git porque contêm assets.

### Ícones de item (28/09/2026)

**Confirmado em execução.** O inventário mostrava, em cada célula, um mosaico de uns 3×3 ícones, e os itens equipados apareciam como quadrados brancos. `InitUITextureSetList` sobrescreve o conjunto 526 (ícones de item) com células fixas de 100 px numa grade 10×10, o atlas de 1000 px da base do runtime. Os atlas do 7662 (`UI\itemicon01..10.wyt`) têm 350×350 px, com células de 35 px, conferidas no cabeçalho TGA e em `UITextureSetList.txt`.

Com a célula fixa em 100 px, cada ícone lia um quadrado de 100 px, e a escala 35/100 reduzia a sobreposição de grau (textura 338) a um terço, produzindo o quadrado branco. O patch `0006-item-icon-atlas.patch` mantém a regra da grade 10×10, mas calcula a célula pela largura real do atlas.

Resultado online no Railway: adaga, elmo, armadura, calça, luvas e botas de couro (A), poções de HP/MP ×120, gold e baú aparecem corretos.

A conversão de `ItemList.bin` (140→164 bytes) e `SkillData.bin` (96→104) já era feita por `tools/import_local_assets.py`. O diagnóstico em execução confirmou os campos: 1115 `Armadura_de_Couro(A)`, `nPos` 4, grau 3, ícone 756.

### Armadura escurecida: causa real e correção (29/09/2026)

**Confirmado em execução:** capturas do operador na vista de criação de personagem mostraram, no `WYD.exe` 7662, armaduras douradas e, no cliente web, as mesmas armaduras quase pretas com filetes dourados. A medição anterior (≈50% de brilho, compatível com o shader) estava incompleta. Ela olhou só a cor do vértice e não o estágio 1 de textura.

- **Medição por probe de pixel** (`wyd_d3d9_trace_*`), na mesma cena, com as quatro amostras (`legend=3`, `multi=9`, skin com 2–4 influências): estágio 0 `MODULATE2X` (textura × difusa), estágio 1 `D3DTOP_MODULATEALPHA_ADDCOLOR` (op 18) com `effect/multi009.wys`. A textura da armadura tem alfa 0 em grande parte (ex.: `t0=227,163,24,0`), e a difusa também tem alfa 0.
- **Defeito:** a camada compat implementava op 18 como `Arg1.RGB × Arg1.A + Arg2.RGB` e op 19 como `Arg1.RGB + Arg1.A × Arg2.RGB`, ou seja, as fórmulas trocadas. Pelo D3D9, op 18 é `Arg1.RGB + Arg1.A × Arg2.RGB` e op 19 (`MODULATECOLOR_ADDALPHA`) é `Arg1.RGB × Arg2.RGB + Arg1.A`. Com alfa 0, a cor base era zerada e sobrava só o `multi009`, quase preto.
- **Correção:** `patches/openwyd/0010-texture-op-modulatealpha-addcolor.patch`, nas três cópias de `applyColorOp` (FFP, ator nativo, cor nativa). As ops 20 e 21 foram conferidas e já estavam corretas.
- **Depois:** a mesma cena mostra armaduras douradas e saia vermelha, como na captura do `.exe`. O Field offline mostra o couro vermelho na cor da textura. Capturas em `.cache/world/2026-09-29T13-05-22-837Z` (antes) e `…T13-09-52-079Z` (depois); ficam fora do Git por conterem assets.
- **Ainda não comparado:** pose e ângulo das armas das amostras diferem entre as capturas. É provável que seja fase de animação, mas isso é **hipótese**. Brilho exato não foi medido pixel a pixel contra o `.exe`, porque as capturas têm resolução e janela diferentes.
- **Achado lateral:** o export `wyd_debug_selchar_open_create` (patch 0004) aciona o controle 5673, que na seleção abre a confirmação de "Voltar". O botão "Criar" é o 4613. A criação automatizada não é afetada, porque aperta o 1545 direto. A abertura da vista para o probe usou clique real no botão. Corrigido depois pelo patch 0011; o export abre a vista (execução `.cache/world/2026-09-29T13-20-39-561Z`).

## Lacuna de conteúdo

[known-asset-gaps.json](known-asset-gaps.json) registra a união observada: 16 caminhos, todos ausentes do cliente do operador. São famílias de tile que entregam só os níveis 0 e 1, três recursos de modelo e `ui/questsubjects4.txt` (o operador tem QuestSubjects 1 a 3). Nada disso foi fabricado nem substituído por primitiva.

A lista varia por execução porque a cena de seleção de servidor sorteia modelos e tiles. Por isso o smoke test não cobra a lista: ele cobra a regra verificável de que **nenhum arquivo presente no dataset entregue pode falhar ao abrir**. Caminhos ausentes do dataset são registrados como lacuna de conteúdo em `contentGaps`.

## Comando reproduzível

```
npm run scene           # remonta a página sobre o dataset já empacotado e verifica
npm run scene:package   # reempacota o dataset (file_packager) antes de verificar
```

`tools/probe_missing_assets.mjs` lista os caminhos distintos que o runtime tentou abrir e não achou, por cena, em `.cache/missing-assets.json`.

`tools/verify_local_scene.mjs` sobe o próprio servidor estático em porta efêmera sobre `.cache/local-scene`, de modo que a verificação não depende de servidor externo nem pode medir uma cópia velha da página. `SCENE_ORIGIN` aponta para um site já hospedado; `SCENE_FRAMES` e `SCENE_DEADLINE_MS` ajustam o orçamento de quadros. `SCENE_BROWSER=firefox` troca o navegador (padrão `chromium`); as evidências ficam em `.cache/scene-<navegador>/`.

Importação dos assets, incluindo a música transmitida sob demanda:

```
python tools/import_local_assets.py --assets <pasta> --font <tahoma.ttf>
python tools/import_local_assets.py --assets <pasta> --font <tahoma.ttf> --streaming-only
```

## O que o smoke test reprova

| Verificação | Cena | Falha detectada |
|---|---|---|
| erros de página, console e requisições | ambas | falha de runtime e asset ausente no servidor |
| `boot != 1`, estado diferente do pedido, `placeholder` | ambas | cena que não é a pedida ou é substituta |
| `is_webgl2 != 1`, `gl_error_total > 0` | ambas | erro WebGL |
| `present_calls`, `draw_calls`, `textured_draws` em zero | ambas | dataset não montado ou nada desenhado |
| arquivo do dataset que falha ao abrir | ambas | regressão de empacotamento ou de caminho |
| `field_initialized`, `has_ground`, `has_my_human`, coordenadas, HP, câmera | Field | cena Field incompleta |
| contadores de mouse/teclado, rota alterada, pick de terreno | Field | entrada não chega ao runtime |

## Resultados desta execução

| Cena | Quadros | Present | Draws | Com textura | Erros GL | Lacunas |
|---|---|---|---|---|---|---|
| Field (estado 0) | 121 | 121 | ~52.000 | ~35.000 | 0 | 11 |
| Select Server (estado 7) | 121 | 121 | ~79.000 | ~46.000 | 0 | 8 |

Artefatos: `.cache/local-scene-evidence.json`, `.cache/local-scene-field.png`, `.cache/local-scene-selectserver.png`, `.cache/missing-assets.json` e `.cache/diagnose-tiles.png` (experimento de terreno). Ficam fora do Git por tamanho e proveniência.

## Limites desta prova

- Chromium headless com rasterização por software: ~1 quadro/s. Não é medida de desempenho; o orçamento de frame time ainda não foi definido em hardware real.
- Só Chromium foi executado. Firefox e Safari continuam sem teste.
- Nenhum login, conexão, gateway ou segunda sessão. O servidor Go não participou desta etapa.
- A cena Field vem da fixture offline do runtime; mapa real depende das etapas 3 e 4.
- Terreno texturizado depois do patch 0005. Continuam ausentes `mesh//abox01.msa`, `mesh//abox02.msa` e `ui/questsubjects4.txt`.
