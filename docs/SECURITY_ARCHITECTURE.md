# Super Quina — Princípios de arquitetura e segurança

Este documento define guardrails de implementação, não uma afirmação de que controles já estejam implementados.

## Regras obrigatórias
- Segredos somente em variáveis de ambiente ou secret manager do ambiente; manter `.env.example` sem valores reais e ignorar arquivos `.env*` com segredos.
- Não colocar tokens de provedor Pix, credenciais de produção, chaves privadas, cookies, dados de clientes ou dumps no Git.
- Validar no servidor toda entrada, papel, saldo, preço, janela de rodada e estado de pagamento. Nunca confiar em valores calculados pelo navegador.
- Usar transações de banco de dados e restrições de unicidade para impedir apostas duplicadas, processamento duplicado de webhook, crédito duplicado de prêmio ou saque acima do saldo disponível.
- Verificar autenticidade do webhook conforme documentação do provedor, persistir o evento de forma segura, tolerar reentregas e processar de forma idempotente.
- Tratar o estado financeiro como livro-razão auditável; não corrigir saldo diretamente sem lançamento compensatório.
- Segregar permissões por papel e por proprietário dos dados; não confiar apenas em ocultação de botões no frontend.
- Proteger autenticação com hash de senha apropriado, cookies de sessão seguros, proteção contra CSRF quando aplicável, limitação de tentativas e logs sem segredos.
- Auditar alterações administrativas, mudanças de configuração, correções de rodadas e ações financeiras.
- Usar migrações reversíveis quando possível, backups verificados e plano de rollback antes de mudanças de produção.
- Separar ambientes de desenvolvimento, teste e produção. Testar pagamentos em sandbox antes de considerar produção.
- Nenhuma implantação, migração destrutiva ou alteração de serviço de produção sem revisão explícita de impacto.

## Processo de trabalho
1. Inspecionar o estado atual e documentar decisões antes de escolher a stack.
2. Implementar exclusivamente na branch oficial `main`; não criar branches paralelas para o fluxo normal.
3. Entregar mudanças pequenas, com testes e resumo dos arquivos/impactos.
4. Revisar segurança, compatibilidade e migrações antes de abrir/mesclar PR.
5. Confirmar variáveis e configurações de ambiente sem expor valores secretos.
6. Validar em ambiente não produtivo e manter um caminho de reversão.
