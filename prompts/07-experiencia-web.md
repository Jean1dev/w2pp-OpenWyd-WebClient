# Etapa 7 — experiência de navegador

Leia contexto, arquitetura e critérios. Preserve visual e regras existentes; não copie a marca Valthera. Implemente por subetapas com status independente:

1. Portal de entrada, seleção de servidor configurada pelo operador, progresso de download, erros recuperáveis e preferências de exibição/áudio. Integre API real; se precisar de tickets, documente contrato e trabalho no backend. Tickets curtos e uso único, sem senha persistida no browser.
2. Cache versionado de assets com hash, invalidação, limite de quota, recuperação de corrupção e alternativa quando storage estiver indisponível. Garanta combinação coerente entre app/WASM/manifesto; não misture versões no meio da sessão. Aviso de atualização sem recarregar automaticamente durante transação.
3. Controles touch sobre as mesmas intenções do desktop; testar seleção, movimento, skill, inventário, teclado virtual e interrupção por gesto do navegador. Só declarar mobile suportado com teste em dispositivo real identificado.
4. Avalie retomada de sessão separadamente. Um reconnect WebSocket não retoma automaticamente uma conexão TCP/sessão do jogo. Defina posse da sessão, autenticação, TTL, ACK, ordem, deduplicação e limites de replay. Teste perda de ACK após compra/troca, duas abas, expiração e reinício do gateway. Até provar semântica segura, use desconexão explícita com novo login; não reenvie ações financeiras cegamente.

Grupos/ranking/bestiário podem ter interfaces próprias apenas se respaldados por dados e APIs reais. Automação Idle não pertence a esta etapa. Aceitação: testes por subetapa e registro claro do que ficou adiado.
