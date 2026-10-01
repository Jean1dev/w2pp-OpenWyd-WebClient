# Reprodução da etapa 2 — 01/10/2026

## Fontes e ambiente

- **Confirmado em fonte:** OpenWyd `beb9f69bdea6d81f70af14b5ce85ed064575bb26`, servidor `98286fdf01202f503523e89d3e50b2183f00c36c`, emsdk `d223ae73c6998296e3ab27cf81dc2c2c9fd383de`, Emscripten 6.0.0. Patches próprios 0001–0021 aplicados no checkout ignorado.
- Windows 10.0.26300, Intel Core i5-10210U, 7,83 GiB de RAM; Python 3.14.3, Node do host 24.14.1, Node do SDK 22.16.0, Playwright 1.54.2. Navegadores executados sequencialmente, headless, viewport 1100×900, canvas 800×600.
- Este workspace não tinha toolchain, node_modules, dataset importado ou build anterior. Os checkouts fixados e as alterações locais da auditoria foram preservados. Não foi criado um segundo clone integral do cliente.
- Assets lidos da pasta do operador indicada no setup; Tahoma lida do Windows. Nenhum original alterado, executável importado ou asset publicado.

## Contratos dos loaders e texto

**Confirmado em fonte:** `Basedef.cpp::BASE_ReadItemList` e `BASE_ReadSkillBin` leem as tabelas pelo tamanho das estruturas e aplicam XOR 0x5A. `Basedef.h` fixa ItemList em 164 bytes e Spell em 104. O importador adapta os registros 7662 de 140/96 bytes, descartando o trailer de quatro bytes. O trailer não é validado como checksum: seu algoritmo não foi confirmado.

Nos itens, bytes 0–133 são preservados; a máscara u16 em 134 vira u32 em 136; Extra/Grade migram de 136/138 para 140/142; campos adicionais ficam zerados. Nas skills, os 96 bytes originais são preservados e SkillIndex/Reserved ficam zerados, sem inventar índices do dialeto 769.

**Confirmado em fonte:** `EnsureFontRenderer`, em `compat/src/win32_emscripten_stubs.cpp`, abre `/Tahoma.ttf` e inicializa `stb_truetype`. Este caminho não precisa do gerador de atlas GDI/MSVC citado no setup histórico. Não houve mudança de renderer ou geração de atlas nesta sessão.

## Mudanças e verificações

- Importador valida tabelas obrigatórias e assinatura básica da fonte antes de copiar músicas/dataset; erros de ausência ou tamanho inválido têm mensagem legível. Manifesto das músicas agora também registra o hash de saída.
- Sete testes sintéticos aprovados: offsets, sinais, máscara, primeiro/último registro, campos ausentes, tamanhos inválidos, entradas obrigatórias e ausência de cópias após erro de tabela. A CI passa a executar a suíte; **confirmado em execução** no GitHub Actions, [execução 36866420277](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/actions/runs/36866420277), com os 7 testes aprovados.
- **Confirmado em execução:** importação de 7.093 arquivos, 319.802.941 bytes, e 13 músicas, 26.272.662 bytes. Todos os hashes de saída conferidos com o manifesto. Vinte padrões do manifesto upstream não encontrados, preservados como lacunas explícitas.
- Amostra convertida: item 1115 `Armadura_de_Couro(A)`, preço 2300, posição 4, grau 3. Não é validação de preço/economia do servidor.
- **Confirmado em execução:** compilação limpa dos 115 objetos em 96.661 ms, `contract_unchanged=true`, `certified=true`. Link estrito aprovado com zero símbolos indefinidos; WASM válido, 988 exports, quatro exports obrigatórios presentes.
- WASM: 1.929.842 bytes, SHA-256 `6cda98b228cf15a502f9eebed575118dc95c59c33cf317fca3265bcb80e810e6`. Artefato local `tmproject_startup.1790859244302076800.wasm`.
- Testes e link inicialmente encontraram erros de permissão em temporários do sandbox Windows; repetidos com permissão de execução e aprovados. Não foram contornados alterando o contrato de build.

## Reprodução

Depois de buscar os SHAs e instalar/ativar o SDK fixado conforme `docs/setup.md`:

```powershell
npm ci
python tools/apply_openwyd_patches.py
python -m unittest discover -s tools -p test_asset_conversion.py -v
$env:EMSDK = (Resolve-Path .cache/toolchains/emsdk).Path
& .cache/toolchains/emsdk/upstream/emscripten/em++.exe --version
python external/OpenWyd/webclient/client-wasm/tools/build_tmproject_wasm_objects.py --repo-root external/OpenWyd --jobs 4
python external/OpenWyd/webclient/client-wasm/tools/link_tmproject_wasm_startup.py --repo-root external/OpenWyd --dev --jobs 4 --link-opt-level O2
python tools/import_local_assets.py --assets '<diretório autorizado>' --font C:\Windows\Fonts\tahoma.ttf
python tools/build_local_scene.py
node tools/verify_local_scene.mjs
$env:SCENE_BROWSER = 'firefox'
node tools/verify_local_scene.mjs
Remove-Item Env:SCENE_BROWSER
```

O smoke bloqueia requisições fora da origem local, não faz login e exige identificação explícita da fixture Field offline (`OpenWYD`, mapa 16,16). Evidências e capturas ficam separadas em `.cache/scene-chromium/` e `.cache/scene-firefox/`.

Hospedagem: JS/WASM/dados na mesma origem e MIME correto, CSP com `wasm-unsafe-eval`. Sem pthreads, SharedArrayBuffer ou necessidade de COOP/COEP. O teste local não mede desempenho de produção nem paridade Windows.

## Resultado das cenas

**Confirmado em execução**, sequencialmente, headless, com o WASM acima e o dataset importado nesta sessão. `failures: []` nos dois navegadores.

| | Chromium 139.0.7258.5 | Firefox 140.0.2 |
|---|---|---|
| Field offline | estado 0, fixture `OpenWYD` classe 1 no mapa 16,16, HP 320/320, terreno e câmera válidos, 121 quadros | idem, 123 quadros |
| Entrada no Field | mouse e teclado aceitos; pick no terreno 2092,25/0/2088,25; destino 2096,5/2092,5 → 2094,5/2090,5 | idêntico |
| Select Server | estado 7, painéis, lista de servidores e copyright legíveis, 121 quadros | idem, 125 quadros |
| Erros | 0 GL, 0 de página, 0 de console, 0 requisições falhas, 0 falhas de textura | idem |
| Lacunas de conteúdo | Field: `mesh//abox01.msa`, `mesh//abox02.msa`, `ui/questsubjects4.txt`; Select Server: os dois `abox` | Field: as mesmas três; Select Server: nenhuma (a cena sorteia modelos) |

As três lacunas também não existem na pasta do operador (busca sem distinção de maiúsculas). Já constavam de [known-asset-gaps.json](known-asset-gaps.json) e não foram substituídas.

Inspeção visual das quatro capturas: HUD com nome, nível, HP/MP e barra de atalhos; chat com abas; calçamento de Armia, poço e pilares com efeito; texto Tahoma legível. Chromium e Firefox produzem a mesma composição. Hashes das capturas (locais, fora do Git por conterem assets):

- `.cache/scene-chromium/local-scene-field.png` `306f8f5f…20dd`; `local-scene-selectserver.png` `939e142a…3473`
- `.cache/scene-firefox/local-scene-field.png` `c0507ee6…fa4a`; `local-scene-selectserver.png` `5a2706de…1dc`

Durações: Chromium 2 min 20 s; Firefox na mesma ordem de grandeza (sem cronometragem isolada). Rasterização em software headless; não mede desempenho real.

## Limites

- Cena Field é a fixture offline do runtime, não mapa entregue pelo servidor; Select Server não conecta. Login e mundo online são evidência da etapa 4.
- Safari não testado (sem ambiente macOS). A CI do PR passou ([execução 36866420277](https://github.com/Jean1dev/w2pp-OpenWyd-WebClient/actions/runs/36866420277)); ela não executa a cena, que depende de assets locais.
- Sem comparação pixel a pixel com o `WYD.exe`; paridade visual fica para a etapa 6.

## Decisão

Etapa 2 **Validada**: build reproduzido sem artefatos anteriores, importador com testes sintéticos, cena real identificada com entrada, UI e terreno em Chromium e Firefox, smoke que falha em erro de runtime, WebGL ou asset presente que não abre. Nenhum ADR novo: não houve mudança de abordagem.
