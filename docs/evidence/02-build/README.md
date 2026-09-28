# Evidências da etapa 2 — cena real no navegador — 28/09/2026

## Estado observado

**Confirmado em execução:** a página própria (`web/local-scene.*`) inicializa o runtime WASM do Alan, monta os assets do operador e renderiza duas cenas originais em WebGL2, sem conexão ao servidor. A cena Field é identificada pelo próprio runtime — mapa 16,16, personagem `OpenWYD` classe 1 em 2096,5/2092,5, HP 320/320 — e responde a mouse e teclado: o clique no terreno alterou o destino de rota para 2094,5/2090,5 e a consulta de terreno devolveu o ponto 2092,25/0/2088,25. Zero erros GL, zero erros de página e zero requisições falhas nas duas cenas.

**Confirmado em execução:** a cena Field usa a *fixture offline* do runtime (`wyd_field_debug_fixture_used = 1`), não um mapa entregue pelo servidor. Isto não é paridade de mundo; é a cena real do cliente com dados locais enquanto o protocolo não existe.

**Confirmado em execução:** o relógio falso era a causa da cena distorcida registrada antes desta sessão. Com `?tickMs=16`, o harness upstream reproduz exatamente a mesma imagem — modelos gigantes e horizonte torto — porque a câmera fica no início da animação de abertura. Não era defeito de renderização nem de asset. A página agora acompanha o relógio do navegador, como o jogo ao vivo.

**Confirmado em execução:** o terreno sem textura vem de arquivos que o cliente 7662 do operador não fornece. Substituindo em memória, apenas para diagnóstico, os sete `env/tile*2.wys` da cena Field pelo nível 1 correspondente, as falhas de abertura caíram de 18.897 para 746 e os quadrados brancos sumiram — mas o terreno não ficou correto, e sim escuro. O nível 2 é um asset distinto, não uma cópia; nenhuma substituição o reproduz.

## Lacuna de conteúdo

[known-asset-gaps.json](known-asset-gaps.json) registra a união observada: 16 caminhos, todos ausentes do cliente do operador. São famílias de tile que entregam só os níveis 0 e 1, três recursos de modelo e `ui/questsubjects4.txt` (o operador tem QuestSubjects 1 a 3). Nada disso foi fabricado nem substituído por primitiva.

A lista varia por execução porque a cena de seleção de servidor sorteia modelos e tiles. Por isso o smoke test não cobra a lista: ele cobra a regra verificável de que **nenhum arquivo presente no dataset entregue pode falhar ao abrir**. Caminhos ausentes do dataset são registrados como lacuna de conteúdo em `contentGaps`.

## Comando reproduzível

```
npm run scene           # remonta a página sobre o dataset já empacotado e verifica
npm run scene:package   # reempacota o dataset (file_packager) antes de verificar
```

`tools/probe_missing_assets.mjs` lista os caminhos distintos que o runtime tentou abrir e não achou, por cena, em `.cache/missing-assets.json`.

`tools/verify_local_scene.mjs` sobe o próprio servidor estático em porta efêmera sobre `.cache/local-scene`, de modo que a verificação não depende de servidor externo nem pode medir uma cópia velha da página. `SCENE_ORIGIN` aponta para um site já hospedado; `SCENE_FRAMES` e `SCENE_DEADLINE_MS` ajustam o orçamento de quadros.

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
- Terreno segue sem textura correta enquanto a lacuna de conteúdo acima existir.
