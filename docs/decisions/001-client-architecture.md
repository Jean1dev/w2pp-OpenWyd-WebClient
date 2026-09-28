# ADR 001 — Continuação do OpenWyd para o servidor Go

Data: 28/09/2026. Estado: **rota escolhida; validação técnica parcial**.

## Decisão

Continuar o projeto de alanpetry como uma linha derivada do OpenWyd, preservando autoria, histórico upstream, cenas C++, formatos e renderer WASM/WebGL. Esta preferência foi confirmada pelo usuário. Não iniciar uma segunda engine. O checkout de auditoria está em `external/OpenWyd`, ignorado pelo Git, no commit de `dependencies.lock.json`; não é ainda um fork publicado nem código incorporado ao repositório do cliente.

Usar o último `main` do servidor observado nesta sessão, `98286fdf01202f503523e89d3e50b2183f00c36c`. A comparação com `8a14bcc` encontrou 74 arquivos alterados: eventos Water/Nightmare/Kefra, progressão Arch, persistência e handlers, entre outros; nenhum arquivo do pacote de codecs mudou. Isso não implica equivalência de gameplay entre as versões.

## Fronteiras

- **Runtime:** reaproveitar `Projects/TMProject`, compatibilidade Win32/DirectX, entrypoint e scripts de objetos/link. O aplicativo JavaScript de inspeção de assets é outro produto e não integra a rota escolhida.
- **Protocolo no cliente:** acrescentar codecs do dialeto do servidor antes dos consumidores de cenas e antes da transformação CPSock de saída. Usar offsets e little-endian explícitos; separar pacote no fio e representação interna. Não reinterpretar os bytes recebidos diretamente como structs do Alan.
- **Capacidade interna:** o adaptador sozinho não acomoda banco de 128 slots em um array de 120. Ajustar armazenamento/UI/loops pertinentes do runtime, conservar 16 equipamentos no fio e tratar os dois slots internos adicionais como indisponíveis. Auditar alcance de Level antes de converter int32 em short; nunca truncar silenciosamente. Preservar valores e regras do servidor.
- **Gateway:** implementar serviço próprio em Go, acompanhando a linguagem do backend, com uma biblioteca WebSocket mantida e fixada quando implementada na etapa 3. Encaminhar somente bytes binários em ordem, com limites de memória, backpressure, timeout e fechamento dos dois lados. Destinos e origens permitidas pertencem à configuração do operador. Sem regras de jogo, tradução de structs ou parâmetros host/port arbitrários do navegador.
- **Configuração:** fornecer ao browser apenas endpoint WSS, identificador de canal, versão de protocolo efetiva e versão do manifesto de assets. Destino TCP fica privado. Para o Compose auditado, ClientVersion é **12000**; o valor padrão do executável avulso é **7640**. Não confundir com build Windows 7662.
- **Contas:** o portal chama AccountWebService através de BFF; CreateAccount/VerifyCredentials não são tickets de jogo. O login inicial continua CPSock via WSS com credencial transitória em memória. Não presumir retomada autenticada nem reenviar ações após desconexão.

## Organização e manutenção

Árvore própria: `tools/` para bootstrap/auditoria/importação; `patches/openwyd/` para mudanças pequenas sobre o SHA fixado; `gateway/` na etapa 3; `docs/` para contratos/evidências. `external/`, `.cache/`, `assets-local/` e builds permanecem ignorados. Até resolver a proveniência dos componentes que precisariam ser distribuídos, manter a fonte histórica apenas no checkout local; não fazer merge integral, submodule ou publicação como atalho de licença.

A linha derivada deve preservar o upstream Git e separar patches de plataforma, segurança, protocolo e capacidade/UI. Atualizações futuras exigem novo lock, diff, reaplicação dos patches e repetição dos testes, sem seguir `main` automaticamente em builds. A entrega para revisão contém ferramentas próprias, documentação e metadados da auditoria; os checkouts e builds de terceiros permanecem locais.

Assets entram por importação local com origem declarada e manifesto SHA-256/tamanho/caminho. Não baixar o bundle comercial do upstream por conveniência e não usar conteúdo Valthera. A fonte Tahoma, atlas GDI, sons, modelos e derivados também exigem proveniência; hashes comprovam integridade, não autorização.

## Evidências e consequências

O probe sobre o header original mede 135 records em wasm32 e no alvo Clang MSVC x86. A [matriz](../compatibility.md) confirma divergências de capacidade, offsets e semântica mesmo quando o sizeof coincide. Exemplos: UpdateScore tem 152 bytes em ambos, mas Level e a cauda divergem; CharacterLogin enviado pelo Alan tem 36 bytes, contra 20 do contrato Go.

O harness upstream armazena credenciais de demonstração em localStorage e aceita senha pela query string. O proxy de debug permite destino indicado pelo browser por padrão. Esses caminhos não serão expostos na nossa aplicação. Não basta trocar o endpoint do harness e declarar integração.

O servidor possui layouts explicitamente provisórios em coleta/drop e banco; são dependências separadas, descritas na matriz. Não modificar suas regras ou mascarar seus resultados na UI.

Alternativa considerada: engine TypeScript/WebGL própria. Rejeitada como rota inicial porque duplicaria parsers, cenas e renderer existentes, além de contrariar a continuidade pedida. Só reabrir a decisão diante de impedimento técnico ou de direitos concreto, com evidência e discussão com o usuário.

Próximo marco: build reproduzível e cena Field real com assets locais autorizados. Compilar objetos ou gerar WASM sem dados não valida esse marco. Testes com duas sessões, Windows 7662 e relogin permanecem obrigatórios depois da adaptação.
