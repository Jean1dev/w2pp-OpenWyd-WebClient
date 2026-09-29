# ADR 005 — Deploy no Railway e CI

Data: 29/09/2026. Estado: **implementado; build local da imagem e testes verificados; deploy não executado.** Guia em [deploy.md](../deploy.md).

## Contexto

O operador pediu um deploy no Railway com Dockerfile e uma CI de validação. Três restrições do projeto definem a forma:

- os dados do jogo são comerciais e não podem entrar na imagem nem no Git (AGENTS.md, prompt 08);
- o runtime vem de um upstream sem licença que cubra a redistribuição do conjunto ([dependências](../dependencies.md));
- o gateway é só relé: não tem regra de jogo e o destino TCP é do operador.

## Decisões do operador (29/09/2026)

1. **Assets num Volume do Railway.** O operador envia os dados com `railway volume files upload`. Nada disso vai para a imagem.
2. **Acesso restrito por senha.** O gateway ganha Basic Auth opcional, e o modo por ambiente o **exige**, salvo `WYD_ALLOW_PUBLIC=true` explícito.
3. **WASM compilado no build da imagem**, a partir do SHA do `dependencies.lock.json`, com os patches locais. É reproduzível a partir do Git.

## Decisões técnicas

- **Imagem em três estágios:**
  - `emscripten/emsdk:6.0.0`, a mesma versão do lock, com sparse clone do upstream e `apply_openwyd_patches.py`;
  - `golang:1.25.13-bookworm`, com build estático do gateway;
  - `distroless/static-debian12:nonroot` no final.

  As bases ficam fixadas por digest. O upstream é lido do lock dentro do build, então não há um segundo lugar para o SHA.
- **Gateway, novos campos de configuração:**
  - `tlsTerminatedByProxy`: TLS na borda da plataforma; exige origens `https://` e `wss://` e exclui `allowInsecure`;
  - `assetDir`: segunda raiz estática. Os arquivos da imagem têm precedência, e o volume não consegue sombrear `runtime.js`;
  - `basicAuth`: comparação em tempo constante sobre SHA-256;
  - `/healthz` sem autenticação;
  - `-env`: configuração por variáveis `WYD_*`. O modo por arquivo continua igual para o uso local.
- **Limite por IP atrás do proxy:** o socket é sempre o proxy do Railway. No modo `tlsTerminatedByProxy`, o gateway usa a entrada mais à direita do `X-Forwarded-For`, a única adicionada pelo proxy. Fora desse modo, os cabeçalhos continuam ignorados. **Hipótese a confirmar no primeiro deploy:** o Railway anexa o IP do cliente como última entrada.
- **Rollback:**
  - página e runtime voltam juntos pelo redeploy de uma imagem anterior;
  - assets ficam em diretórios versionados (`/data/assets-<manifest>`) e voltam trocando `WYD_ASSET_DIR`;
  - `tools/pack_deploy_assets.py` gera o manifesto de hashes.
- **CI só com entradas distribuíveis:** este repositório, os checkouts públicos fixados (`tools/fetch_pinned.py`) e os fixtures sintéticos. Cena com assets e cenários online ficam locais, e a CI não finge cobri-los.
  - `run_dialect_test.py` aceita o emsdk do ambiente (`EMSDK`).
  - Os scripts Go já aceitavam o `go` do PATH.

## Consequências

- O primeiro deploy exige passos manuais do operador: serviço, domínio, variáveis, volume e upload. Estão descritos, mas não foram executados por esta entrega.
- **A confirmar em execução:** reenvio da credencial Basic na abertura do WebSocket de mesma origem; leitura do volume pelo uid `nonroot` (alternativa: `RAILWAY_RUN_UID=0`); porta interna do tm-server na rede privada.
- As exports `wyd_debug_*` continuam no build publicado. A ADR 003 pede uma flag de build antes de uma entrega **pública**. Com o acesso restrito isso é aceitável, mas continua pendente para a etapa 8.

## Revisão — 29/09/2026 (bucket)

- **Nova decisão do operador:** os assets ficam no bucket privado do Railway (`arranged-orb`, projeto `wyd-client-web`) em vez do Volume. Alternativas apresentadas: Volume (sem código novo, uma réplica) e bucket (código novo, várias réplicas, tráfego bucket→gateway).
- **Gateway:** `assetS3` / `WYD_ASSET_S3_*`, exclusivo com `assetDir`.
  - SigV4 só com a biblioteca padrão, conferida contra o vetor "GET Object" da documentação da AWS.
  - Streaming do objeto sob a mesma origem e autenticação, repassando `Range`/`If-*` e 206/304/416; 403/404 viram 404; outros erros viram 502.
  - O navegador nunca vê bucket, endpoint nem credenciais.
- **Upload:** `tools/upload_assets_s3.py`, com um SigV4 independente em Python. Credenciais lidas da CLI em memória, prefixo versionado e verificação por `HEAD`.
- **Projeto:** o operador escolheu o `wyd-client-web` existente. O tm-server está no projeto `wyd`, e a rede privada não atravessa projetos, por isso `WYD_TARGET` usa o proxy TCP público.
- **Dockerfile:** o builder do Railway recusa cache mounts cujo id não tenha o prefixo do serviço (`s/<service-id>-…`). O mount foi removido em vez de prender o arquivo a um serviço. O aquecimento da toolchain continua, e o cache do emscripten fica na camada do estágio de build.
