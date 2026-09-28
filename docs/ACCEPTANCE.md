# Critérios de aceitação

## Primeiro marco: cliente conectado

- Clone limpo + toolchain fixada + assets locais documentados produzem o build.
- Gateway aceita somente destinos configurados e encerra conexões com limpeza de recursos.
- Handshake, ofuscação, framing e layouts têm vetores independentes do próprio encoder.
- Login real, seleção/criação de personagem e entrada no Field funcionam contra o tmserver Go.
- Duas sessões veem movimento e entidades uma da outra; cliente Windows continua compatível.
- Relogin recupera o estado esperado pelo servidor. Não exigir posição exata quando a regra é spawn na última cidade.

## Marco jogável

Validar com contas de teste controladas: quatro classes; combate básico e skills representativas; dano/HP/morte; inventário/equipamento; coleta/drop; loja NPC; banco; teleporte; chat; grupo; troca entre dois personagens e cancelamento; persistência após relogin e reinício controlado do servidor. Se o backend não implementa um fluxo, registrar limitação e mudança necessária em vez de inventar resultado no cliente.

Para cada cenário guardar: preparação, ações, resultado esperado, observado, versões, captura e logs sanitizados. Casos financeiros devem conferir saldos e quantidades nos dois clientes/servidor, inclusive tentativa duplicada ou interrupção.

## Qualidade de entrega

- Comparar câmera/coordenadas idênticas: terreno, personagens, equipamentos, animações, UI, fontes, água, efeitos e áudio. Distinguir defeito de renderização de dado ausente.
- Medir cold/warm start, bytes baixados, memória, frame time p50/p95 e estabilidade em cenário reproduzível. Definir orçamento com hardware, resolução e navegador antes de otimizar.
- Matriz mínima desktop: Chromium e Firefox; testar Safari quando houver ambiente e indicar se não testado. Mobile é um marco adicional, não condição implícita do primeiro build.
- Sem senhas em persistência do navegador/logs, proxy TCP aberto ou mutação de regras no gateway.
- CI executa apenas comandos reais; não exige assets privados indisponíveis no runner para fingir uma aprovação.
- Deploy documentado com HTTPS/WSS, cache versionado e rollback. Reconexão transparente só é entregue depois de comprovar ausência de replay duplicado de ações.

## Evidências

Criar `docs/evidence/<etapa>/README.md` e arquivos pequenos sanitizados. Capturas grandes ficam como artefatos com hash e localização. Não gravar dumps de login reais. Relatórios devem separar leitura estática, teste unitário, integração real e verificação visual manual.
