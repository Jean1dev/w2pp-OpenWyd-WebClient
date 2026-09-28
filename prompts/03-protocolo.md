# Etapa 3 — transporte e adaptação do dialeto

Leia `AGENTS.md`, `docs/compatibility.md` e os codecs/testes do servidor. Implemente gateway e adaptação do cliente sem alterar layouts exigidos pelo cliente Windows.

1. Gateway WSS→TCP com destinos definidos pelo operador, validação de Origin, limites de conexões/buffers, backpressure, timeouts e encerramento nas duas pontas. Não permitir host/porta fornecidos pelo cliente. Em desenvolvimento local WS pode ser usado explicitamente.
2. Preserve bytes e ordem: frames WebSocket e reads TCP não equivalem a pacotes CPSock. Teste handshake dividido, header dividido, vários pacotes num chunk, pacote parcial, tamanho inválido, desconexão e consumidor lento. Não aplicar ofuscação duas vezes.
3. Revalide INITCODE, tabela completa, checksum e framing com vetores do servidor e fontes independentes. Registre SHA-256 completo da tabela; não reaproveite o prefixo abreviado do relatório histórico como prova.
4. Adapte estruturas e todos os pontos consumidores: equipamento 16, cargo 128, score/Level e caudas de pacotes conforme codec atual. Use probes sizeof/offsetof e static_assert onde couber; serialização explícita na fronteira quando a ABI divergir. Não resolva tudo com pack(1).
5. Gere fixtures sintéticas de confirmação de login (2008 bytes totais no baseline), seleção, criação de entidade e movimento; compare com emissões do servidor. Teste campos de cauda e limites, não só tamanho. Tenha pelo menos um vetor que não seja produzido pelo encoder sob teste.
6. Torne ClientVersion configurável de acordo com ambiente. Valide recepção real do login no tmserver local com logs sanitizados, sem dump de senha.

Aceitação: testes byte a byte, streaming adversarial e handshake/login real demonstrados. Não exigir gameplay completo aqui; informe precisamente onde termina a compatibilidade comprovada.
