# Etapa 2 — build reproduzível e primeira cena real

Leia `AGENTS.md`, contexto, progresso, ADR e matriz de compatibilidade. Execute a rota escolhida na etapa 1. Se ela estiver indefinida, resolva a dependência específica antes de importar código.

- Implemente bootstrap/build com toolchain fixada, caminhos configuráveis e falhas legíveis. Preserve proveniência e patches pequenos se usar upstream. Não baixe nem execute binários aleatórios para preencher lacunas.
- Crie importador/validador de assets locais: diretório configurável, manifesto de arquivos/hash/tamanho, erro explícito para ausência ou corrupção. Ignore assets comerciais, caches, builds e segredos no Git. Dados de teste sintéticos mínimos podem ser versionados.
- Produza app que inicializa WASM/renderer, carrega dados reais e renderiza uma cena Field identificada. Valide coordenadas, terreno, personagem, câmera, mouse/teclado e UI básica. Não substitua modelos por primitivas para declarar paridade.
- Determine os headers de hospedagem necessários ao build escolhido. Se houver threads, confirme requisitos de isolamento; não ative recursos extras sem necessidade.
- Documente build a partir de checkout limpo, tempo, tamanho e ambiente. Adicione smoke test que detecta falha de runtime, asset ausente e erro WebGL.

Aceitação: comando reproduzível gera cena real e artefato de evidência. Identifique claramente o que ainda é offline. Se faltarem assets, entregue ferramenta e teste sintético, mantendo a validação visual pendente.
