# Instruções para agentes

## Missão

Implementar um cliente web real de WYD, compatível com o servidor Go de Jean1dev, preservando comportamento e visual clássico. Leia `docs/CONTEXT.md`, `docs/SOURCES.md`, `docs/ACCEPTANCE.md` e `docs/PROGRESS.md` antes de agir.

## Invariantes

- O servidor continua autoritativo para combate, drops, economia, inventário, RNG e persistência. O navegador envia intenções; animação ou predição local não confirma resultado.
- O servidor mantém compatibilidade com o cliente Windows 7662. Adapte o cliente web aos layouts existentes; não mude o protocolo do servidor para acomodar structs do upstream.
- Estado do mundo do servidor pertence exclusivamente a `world.World.Run`, sem locks; I/O bloqueante sai via `World.Go`. Mudanças necessárias no servidor são entregas separadas, documentadas e testadas.
- Build 7662, dialeto documentado 7640 e valor efetivo de `ClientVersion` são conceitos distintos. Verifique configuração do servidor: há ambientes com 12000.
- Serialização por offsets explícitos e little-endian; valide tamanho, sinal, arrays e padding. Não presuma que ABI WASM, Go e MSVC x86 têm layouts iguais.
- Gateway repassa fluxo binário ordenado; não contém regras de jogo. Destinos TCP vêm de configuração do operador, nunca de host/porta arbitrários do navegador.
- Não registre senhas/PINs/tokens em logs, URLs, fixtures ou capturas. Credenciais necessárias ao protocolo legado ficam apenas transitoriamente em memória; senhas persistidas no servidor usam `internal/secret`/Argon2id. CPSock não substitui TLS.
- Não faça login, crie contas ou execute testes de carga em servidores de terceiros. Use o stack local ou ambiente do operador.
- Não copie bundles, identidade visual ou assets do Valthera. Registre origem e condições de uso de dependências; acesso público não equivale a licença. Submodule não resolve licenciamento.
- Não publique assets comerciais, executáveis ou credenciais no Git. Planeje importação local de assets e manifesto de hashes.

## Trabalho e evidência

Use a etapa pendente de `docs/PROGRESS.md`; inspecione o código antes de inventar comandos. Fixe versões da toolchain e SHAs. Prefira fatias pequenas que rodem de ponta a ponta. Não substitua cenas reais por placeholders para marcar etapas completas.

Marque achados como `confirmado em fonte`, `confirmado em execução`, `hipótese` ou `bloqueado`. Relatórios históricos podem estar errados. Fontes executáveis e capturas controladas prevalecem sobre resumos antigos; registre divergências.

Teste mudanças de protocolo com vetores independentes, fragmentação e pacotes inválidos. Teste gameplay com servidor real, duas sessões e relogin. Use mock apenas para testes isolados, nunca como evidência de multiplayer.

Ao terminar uma sessão, atualize progresso e evidências: arquivos alterados, comandos, resultados, limitações, decisão e próximo passo. Não declare testes que não executou. Não trate roadmap como implementação. Não crie commits ou publique builds com arquivos de terceiros sem avaliar a proveniência.
