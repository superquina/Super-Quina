# Plano de autenticação e autorização

Status: documento histórico do desenho inicial de autenticação. A implementação vigente está na branch oficial `main`; a aprovação para produção depende das validações e controles descritos neste documento.
A CI do commit `c0fbd833a4fc5b05ef2fe396ac12dbf079dc0ea8` passou nos três jobs (verificação, migrações e testes PostgreSQL). Commits posteriores de preparação/deferimento de provisionamento ainda precisam de CI própria.
Este documento não habilita acesso administrativo nem substitui código/testes.

## Decisão de segurança

Já existem hash de senha, login/logout, sessões opacas persistidas e endpoint de introspecção `GET /api/auth/me` com resposta privada sem cache. Ainda não existe fluxo completo de autorização administrativa. Não expor rotas privilegiadas até concluir as pendências abaixo.

### Identidade e credenciais
- Usar o modelo `User` existente; nunca aceitar `role`, `userId` ou `isAdmin` fornecidos pelo cliente como prova de identidade.
- Armazenar apenas hashes de senha produzidos por algoritmo de derivação apropriado para senhas (preferencialmente Argon2id, com parâmetros documentados; avaliar compatibilidade de runtime antes de fixar a dependência).
- Login deve usar respostas genéricas para usuário inexistente, senha incorreta e conta bloqueada, com limitação de tentativas e auditoria sem registrar senha, cookie ou token.
- Provisionar a primeira conta administrativa por comando operacional de servidor que lê credenciais de variáveis de ambiente/segredos; não criar administrador por cadastro público e não enviar segredos ao navegador.
- Após provisionamento, exigir troca de senha inicial se houver senha temporária; não registrar a senha temporária em logs.

### Sessão
- Preferir sessão opaca, aleatória e revogável, armazenada no servidor/banco com expiração e rotação. O navegador recebe apenas cookie `HttpOnly`, `Secure` em HTTPS, `SameSite=Lax` (ou mais restritivo quando compatível), `Path=/` e sem atributo `Domain`.
- Guardar no banco somente o hash do identificador da sessão; nunca persistir o token em texto claro.
- Validar expiração, revogação, estado atual da conta e papel atual no banco em cada requisição privilegiada.
- Invalidar a sessão no logout e ao bloquear/desativar uma conta; considerar rotação após login e mudança de privilégios.
- Operações autenticadas que alteram estado devem ter proteção contra CSRF compatível com cookies e validação de origem.

### Autorização da operação de fechamento
- O handler de fechamento deve exigir método HTTP apropriado, validar o corpo com schema estrito e rejeitar identificadores malformados.
- A autorização deve ocorrer no servidor a partir da sessão validada e do registro `User` atual; somente `ADMIN` com conta `ACTIVE` pode prosseguir.
- O papel nunca vem do corpo, query string, cabeçalho customizado ou estado do frontend.
- O handler chama `closeRound` somente depois da autenticação/autorização. Preservar a transação, o lock e a validação do cutoff do serviço.
- Registrar evento de auditoria para sucesso e tentativas privilegiadas negadas, sem dados secretos.
- Respostas esperadas: `401` sem sessão válida, `403` para conta autenticada sem permissão, `400` para entrada inválida, `404` para rodada inexistente e resposta de conflito adequada para rodada ainda não fechável/cutoff não atingido.

## Plano de implementação e critérios de aceite

1. Implementado nesta etapa: hash de senha com `scrypt` nativo do Node.js (N=16384, r=8, p=1, salt aleatório de 16 bytes e chave de 64 bytes), tabela `Session` e migração Prisma. A escolha evita dependência nativa adicional; reavaliar Argon2id antes de produção.
2. Implementação inicial: acesso Prisma server-only, validação de credenciais, sessão opaca aleatória (token de 256 bits), persistência somente de SHA-256 do token, expiração em 12 horas, revogação e cookie HttpOnly/SameSite=Lax. O endpoint `GET /api/auth/me` devolve apenas identidade segura e papel da sessão atual, retorna 401 sem sessão válida e define `Cache-Control: no-store`.
3. Implementado o comando operacional `npm run admin:provision` em `scripts/provision-admin.mjs`: exige confirmação explícita por variável de ambiente, recusa criar outro administrador se já existir, serializa tentativas concorrentes com advisory lock do PostgreSQL e cria a conta com `mustChangePassword=true`. O comando não foi executado contra banco real; sua validação e teste em banco descartável continuam obrigatórios. Não há endpoint público de criação de administrador.
4. Implementado limitador persistente de login em PostgreSQL: cinco falhas por conta em uma janela de 15 minutos ativam um bloqueio temporário de 15 minutos; atualização atômica por upsert SQL para múltiplas instâncias; chaves guardadas como SHA-256 do nome normalizado; login válido limpa o bucket. Testes unitários de resposta 429/Retry-After incluídos. Ainda faltam testes de integração do limitador e de sessão real no PostgreSQL (incluindo expiração/revogação). `mustChangePassword` existe no modelo, mas ainda não há fluxo de troca que permita considerar essa proteção concluída.
5. Implementada a rota `POST /api/admin/rounds/[roundId]/close`: sessão obrigatória, papel ADMIN, bloqueio de senha inicial pendente, validação de origem e identificador, respostas 401/403/400/404/409 e auditoria das recusas por papel. O serviço `closeRound` grava `ROUND_CLOSED` ou `ROUND_CLOSE_ALREADY_CLOSED` na mesma transação da operação quando chamado pela rota. Testes de autorização foram adicionados; ainda falta testar a rota ponta a ponta contra PostgreSQL com sessões reais.
6. Executar lint, typecheck, testes, build, migração em banco descartável e os testes PostgreSQL de concorrência.
7. Só considerar a integração pronta quando todos os critérios forem comprovados pela CI. Não implantar em produção como parte desta etapa.

## Limites operacionais

- Trabalhar exclusivamente na branch oficial `main`; não criar branches paralelas para o fluxo normal.
- Não acessar banco ou segredos de produção, não provisionar conta real, não implantar e não iniciar cobranças/webhooks.
- A rota de fechamento permanece inexistente até a autenticação e autorização acima serem implementadas e verificadas.


## Provisionamento operacional do primeiro administrador

O comando `npm run admin:provision` é deliberadamente separado do site e não possui endpoint público. Execute-o somente em ambiente controlado depois de aplicar as migrações em um banco apropriado. Injete temporariamente `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD` e `CONFIRM_ADMIN_PROVISIONING=CREATE_FIRST_ADMIN` pelo mecanismo seguro do ambiente; não grave os valores no repositório ou em logs. A senha inicial precisa ter pelo menos 6 caracteres e a conta é obrigada a trocá-la no primeiro acesso. O comando recusa execução sem confirmação, não altera usuários existentes e não cria um segundo administrador. A implementação ainda precisa ser exercitada em banco descartável antes de ser considerada aprovada.


## Limitação de tentativas de login

O login usa `LoginAttemptBucket` no PostgreSQL, compartilhado entre instâncias. Após cinco falhas para o mesmo nome de usuário normalizado durante 15 minutos, novas tentativas recebem HTTP 429 com `Retry-After`; a janela de bloqueio é de 15 minutos. A tabela não armazena nome de usuário nem senha em texto claro. O bucket é removido após login bem-sucedido. Esta primeira versão limita por conta; proteção adicional por IP deve ser aplicada no proxy/WAF confiável antes de produção, sem confiar em cabeçalhos de IP enviados livremente pelo cliente.
