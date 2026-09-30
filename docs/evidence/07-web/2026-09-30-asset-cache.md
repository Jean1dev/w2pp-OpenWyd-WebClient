# Cache local do pacote de assets — 30/09/2026

## Escopo e fontes

Pedido: reutilizar assets nas próximas aberturas de `client.html`. Escopo escolhido:
pacote principal, sem ampliar para WASM ou músicas. Sem login, deploy ou mudança de
protocolo/gameplay nesta sessão.

**Confirmado em fonte:** `tools/build_local_scene.py` não habilitava cache de preload.
O Emscripten 6.0.0 instalado oferece `--use-preload-cache`, UUID pelo SHA-256 do
conteúdo e IndexedDB em blocos de 64 MiB, com fallback de leitura/gravação. O
`no-cache` do gateway significa revalidação HTTP, não prova de download integral;
a transferência anterior em produção não foi medida nesta sessão.

Base do repositório: `bf83cf5631254e890ef90ac58950036cf5b56683`.
Upstream: `beb9f69bdea6d81f70af14b5ce85ed064575bb26`; Emscripten 6.0.0
(release fixada `772bb4648be4a897ca062d6adc65bc70223d2703`), Go 1.25.13,
Playwright 1.54.2. Harness executado com Node 24.14.1 e Python 3.14.3 em Windows.

## Alterações

- Empacotamento: `--use-preload-cache --indexedDB-name=WYD_PRELOAD_CACHE`.
- Gateway: `private, no-cache` no loader `.js`, tanto no diretório local quanto no
  fallback Volume/S3; testes de 200/304 e propagação dos validadores.
- Página: `clientEvidence.assetPreload.fromCache` registra o resultado do loader.
- Harness `tools/verify_asset_cache.mjs`, script `assets:cache` e instruções de deploy.

**Confirmado em execução:** `assets-local/runtime` estava ausente. A primeira
tentativa de empacotamento falhou antes de gerar o pacote. Recuperados 7.093 arquivos
do `.data` local existente pelos offsets do loader, todos conferidos com os hashes
`output_sha256` de `assets-local/manifest.json`. Nenhum asset foi obtido de terceiros
ou adicionado ao Git. O `.data` regenerado preservou seu hash original:

- `.data`: 319.802.941 bytes, SHA-256
  `3dad59775988f3970931b9e5d9b06b4fb5f799cf558239d3c38c39468fe4a905`.
- `.js`: 529.643 bytes, SHA-256
  `da733c1d50c3623755cc8aa30ef22218036501f87136804d5b9099a3b8906880`.
- `.cache/deploy-assets/manifest.json`: versão `a457267b6cd82874`,
  15 arquivos / 346.605.246 bytes, mais o manifesto. Preparado localmente, sem upload.

## Validação

Comandos executados:

```text
python tools/gateway_test.py
npx.cmd playwright install firefox
python tools/build_local_scene.py
python tools/pack_deploy_assets.py
node tools/verify_asset_cache.mjs
node tools/verify_asset_cache.mjs --real
node --check tools/verify_asset_cache.mjs
node --check web/client.js
git diff --check
```

Gateway: vet e todos os testes aprovados. Fixtures pequenas usam o loader gerado
pelo Emscripten real, com consumidor de filesystem isolado; não são prova de
gameplay. Nove cenários aprovados por navegador: cold, warm, reinício do processo
com o mesmo perfil, reempacotamento idêntico, conteúdo novo, warm após atualização,
IndexedDB indisponível, falha de escrita simulada por `QuotaExceededError` e recuperação.

O harness real abre `client.html`, aguarda 15 quadros da cena 7, verifica ausência
de placeholder e erros de página/runtime/WebGL, e fecha cada página antes da próxima.
O servidor HTTP local força `no-store` para separar IndexedDB do cache HTTP.
Contadores do servidor medem corpos servidos, sem overhead HTTP, compressão ou TLS.
O teste não envia credenciais nem inicia uma sessão de jogo.

A primeira tentativa de `--real` falhou no próprio harness: `waitForFunction` usava
eval, bloqueado pela CSP. Corrigido para polling com `page.evaluate`, preservando
a CSP. Execução definitiva: **24 cenários aprovados**, 12 por navegador.

**Confirmado em execução — pacote real:**

| Navegador | Primeiro acesso | Reabertura | Após reiniciar | `.data` nas duas reaberturas |
|---|---:|---:|---:|---:|
| Chromium 139.0.7258.5 | 14,091 s | 22,801 s | 14,879 s | 0 requisições / 0 bytes |
| Firefox 140.0.2 | 33,052 s | 19,065 s | 22,558 s | 0 requisições / 0 bytes |

Primeiro acesso: 319.802.941 bytes do `.data`; total servido de arquivos:
323.669.621 bytes. Reaberturas: 3.866.680 bytes de outros arquivos, pois o teste
desabilita o cache HTTP. O tempo vai da navegação à leitura das evidências e captura
da tela após pelo menos 15 quadros; não inclui iniciar o processo do navegador.
No Chromium, warm foi mais lento que cold: a evidência comprova economia de rede,
não uma redução universal do tempo de inicialização em localhost.

Resultados pequenos sanitizados: [JSON](2026-09-30-asset-cache.json).
Relatório original, perfis e capturas locais:
`.cache/asset-cache/run-jPPbcT/`. WASM reutilizado:
`1433ef27d5179a1c2687e46e11c15b05eb9eea8762e998e3dc38879b0763e1b0`.

## Limites e próximo passo

Medições são locais, em headless e sequenciais, uma amostra por condição; não
estimam ganho em Internet. Inicialização do runtime e montagem do filesystem
continuam necessárias. Navegador pode remover o cache, e limpeza do site exige
novo download. Nenhuma promessa de armazenamento permanente ou jogo offline.

Próximo passo operacional: publicar o par de assets e manifesto em prefixo novo,
aplicar a imagem do gateway e trocar prefixo/versão conforme `docs/deploy.md`;
depois medir no domínio público. Safari, multiplayer e desempenho em produção
não foram testados nesta fatia. Etapa 7 permanece em andamento.
