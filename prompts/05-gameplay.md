# Etapa 5 — gameplay com servidor autoritativo

Leia `docs/ACCEPTANCE.md`, matriz e documentação dos handlers do servidor. Implemente em fatias testáveis, nesta ordem:

1. Target, ataque básico, skills representativas das quatro classes, efeitos, HP/MP, morte e respawn.
2. Inventário, equipamento, consumo, coleta/drop e atualização de atributos.
3. Loja NPC, banco, teleporte e chat.
4. Grupo e troca entre dois jogadores, incluindo convite recusado, cancelamento e desconexão.
5. Persistência de itens/saldos/progressão após relogin e reinício controlado.

Para cada fatia, derive comportamento dos handlers e protocolo, implemente apresentação/entrada, execute contra servidor real e registre prova. Não calcule recompensas, dano final ou sucesso de transação autoritativamente no navegador. Respostas rejeitadas pelo servidor devem reverter a apresentação otimista.

Valide slots/limites, item inexistente, saldo insuficiente, clique repetido e mensagens fora do estado esperado. Compare contagens e saldos antes/depois nas duas sessões. Não permita duplicação via UI nem esconda incompatibilidade como sucesso.

Se o servidor não suporta uma mecânica, documente lacuna com referência e proposta de alteração separada; não adicione regras no gateway. Atualize checklist por funcionalidade, não um único booleano de 'gameplay pronto'.
