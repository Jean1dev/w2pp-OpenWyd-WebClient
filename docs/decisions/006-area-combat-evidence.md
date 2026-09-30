# ADR 006 — Prova de dano em área por resultado autoritativo

Data: 30/09/2026. Estado: implementada; resultado online registrado nas evidências da etapa 5.

## Problema confirmado em fonte

O cenário `cast` anterior aceitava um único alvo e comparava HP antes/depois de uma janela com vários cliques. O formato `0x0367` com 13 posições não prova que dois mobs receberam dano no mesmo golpe.

No upstream `beb9f69b`, `TMFieldScene::SkillUse` centra a skill 0 no alvo sob o cursor. `TargetType=3` usa `nGridDistance=1`, distância por tiles inteiros (`BASE_GetDistance`) e visibilidade pelo heightmap. No servidor `98286fdf`, `validateSkillTarget` limita o alcance por `mobDistance` e `MaxTarget`; o resultado sobrescreve dano, HP/MP e EXP, sendo enviado ao atacante e aos jogadores em vista.

## Decisão

- Preservar `cast` e acrescentar `castarea`, classe 0, somente com `login,enter,second`.
- Procurar dois Gremlins vivos a um tile entre si e dentro do alcance 5 da TK. A seleção original do runtime continua decidindo a visibilidade e os alvos enviados; o harness não injeta ataques.
- Acrescentar ao dialeto diagnóstico opt-in, em memória, com 64 eventos por direção. Capturar somente ataques traduzidos, após validação de tamanho/capacidade. A tradução dos bytes não muda.
- Expor `wyd_combat_enable`, `clear`, `count`, `lost` e `value`. Cada evento contém sequência local, atacante, skill, progressão, HP/MP, EXP em duas palavras, coordenadas do alvo e até 13 pares ID/dano. Nenhum frame bruto, identidade de conta, senha ou PIN é capturado. Desabilitar também apaga os buffers.
- Não acrescentar o diagnóstico ao probe geral da página: somente o harness o habilita e lê. Não existe mudança de API de rede, gateway ou regra do servidor.
- Correlacionar um único envio com uma única resposta usando atacante, skill, progressão, coordenadas e IDs ordenados. B deve receber o mesmo resultado, ignorando apenas a sequência local. Ambiguidade e sobrescrita invalidam a prova.
- Exigir dois IDs distintos com dano positivo, HP coerente nas duas sessões, cobrança autoritativa de MP, saúde limpa e relogin com equipamento, nível, EXP e learned skill preservados. Sumiço isolado de entidade não prova dano.
- Limitar o cenário a 25 minutos, busca a 12 minutos e até seis cliques de lançamento. Mais de um ataque no mesmo clique encerra com falha, sem acumular dano. Fechar B antes do relogin de A; exigir 1 GiB livre antes de abrir B.

## Limites

Uma janela sem par adequado, dano positivo ou observador não valida área. O verificador usa snapshots de HP e reprova interferência que impeça atribuir o dano ao resultado; não infere sucesso de animação ou proximidade. A comparação de progressão é específica à skill 0 neste servidor fixado. Buff/cura, outras áreas e cliente Windows ficam fora desta prova.
