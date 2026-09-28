# Etapa 4 — fatia online completa

Leia contexto, matriz de compatibilidade e evidências de transporte. Suba o backend Go real usando seus comandos documentados; use contas locais de teste.

- Integre conta/login pelo fluxo efetivamente suportado. Inspecione a API web antes de usá-la; não invente endpoint de game-session. Credenciais não ficam em URL, localStorage ou logs.
- Valide login correto/incorreto, seleção dos slots, preview de atributos/equipamento, criação de personagem, entrada no Field e carregamento das entidades reais.
- Conecte duas contas. Confirme movimento bidirecional, spawn/despawn, nomes, direção, equipamentos, troca de mapa e desconexão. Identifique quem confirmou a posição: servidor ou estado local.
- Verifique login concorrente e comportamento de sessão expirada conforme o backend. Uma falha de protocolo deve aparecer como erro diagnosticável, não travamento silencioso.
- Deslogue/relogue e confira persistência conforme regra do servidor; não exigir retorno à coordenada exata se o servidor persiste apenas cidade.
- Rode cenário equivalente com cliente Windows quando disponível. Sem ambiente Windows, marque essa parte pendente e forneça roteiro reproduzível.

Aceitação: vídeo/capturas e logs sanitizados de duas sessões reais, relatório de pacotes divergentes corrigidos e roteiro automatizado ou manual reproduzível. Atualize matriz e progresso. Não avance com seleção ou inventário silenciosamente corrompidos.
