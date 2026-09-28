# Etapa 6 — fidelidade e desempenho

Leia critérios de aceitação e bugs conhecidos. Defina baseline e orçamento mensurável para um dispositivo/resolução/navegador identificados.

- Monte cenas reproduzíveis em Armia e pelo menos um mapa contrastante, com posição/câmera/horário/entidades controlados. Compare com cliente Windows equivalente; quando indisponível, não declare paridade visual validada.
- Confira terreno e costuras, transparência, profundidade, iluminação, água, animações, modelos, armas, montarias disponíveis, efeitos, fontes, HUD, inventário, cursor e áudio.
- Meça startup frio/quente, bytes, decodificação, upload de texturas, memória e frame time p50/p95. Faça ensaio prolongado com mudanças de mapa e crescimento de memória documentado.
- Preserve cadência da simulação ao desacoplar apresentação. Otimização não pode modificar timers de gameplay, consumo de pacotes ou ordem de ações.
- Corrija por gargalo medido; valide novamente cenário afetado. Evite reconstruir cache inteiro ou duplicar o pacote completo em memória sem medição.
- Teste redimensionamento, DPI, perda/restauração de contexto WebGL, aba em segundo plano, teclado e foco entre canvas e formulários.

Aceitação: relatório antes/depois, capturas comparáveis, configurações e limitações por navegador. Não usar FPS médio sozinho como prova de fluidez.
