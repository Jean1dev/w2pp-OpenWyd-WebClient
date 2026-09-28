# Etapa 8 — CI e entrega verificável

Leia todo o progresso e critérios de aceitação. Feche lacunas do escopo prometido antes de declarar a versão pronta.

- Crie CI de build, testes de codec/gateway e smoke browser com versões fixadas. Use fixtures sintéticas distribuíveis; descreva separadamente a validação privada com assets reais.
- Documente configuração local, ambiente de demonstração, HTTPS/WSS, destinos permitidos, limites, headers necessários ao runtime e cache. Inclua exemplo de configuração sem segredos.
- Prepare deployment e rollback coerentes entre app, WASM e manifesto. Não publique automaticamente apenas por existir um roteiro; execute deploy quando autorizado no escopo vigente.
- Verifique proveniência e direitos dos componentes realmente incluídos. Preserve avisos e não atribua licença própria a código/assets de terceiros. Não inclua o pacote comercial de assets na imagem pública.
- Execute os cenários críticos com duas contas e persistência, teste falha de rede e confira compatibilidade nativa quando houver ambiente.
- Produza relatório final com versões, hardware/navegadores, testes executados, links de evidência, funcionalidades suportadas, bugs conhecidos e pendências. Distinga build que compila, demo que renderiza e jogo online validado.

Aceitação: outra pessoa consegue reproduzir o ambiente seguindo README/setup; CI funciona; matriz de funcionalidades tem evidência. Se não atender, continue correções ou descreva bloqueio específico sem marcar etapa Validada.
