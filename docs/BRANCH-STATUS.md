# Estado do projeto — Super Quina

Atualizado em 2026-11-05. Repositório: `jpveiculos/Super-Quina`.

**Estado atual:** `main` é a única branch existente e oficial do projeto. As comparações com `main`, `foundation/super-quina-v2` e demais branches abaixo são registros históricos de auditorias anteriores à renomeação; não representam branches ativas nem tarefas de integração pendentes.

Branch oficial de trabalho: `main`.

## Limites de segurança e operação
- Trabalhar exclusivamente na branch `main`. Não criar branches paralelas para o fluxo normal de desenvolvimento.
- `main` e as demais branches citadas nas seções históricas não fazem parte do fluxo ativo.
- Não fazer merge, deploy, alteração de DNS/infraestrutura ou migração em banco de produção sem autorização explícita.
- O Super Quina usará um banco novo e vazio, sem importar absolutamente nenhum dado, usuário, ADMIN, aposta, pagamento, saldo, rodada, resultado ou histórico do sistema anterior.
- As migrations são permitidas exclusivamente para criar a estrutura do banco numérico novo.
- O primeiro ADMIN será criado no próprio ambiente Super Quina pelo script `scripts/provision-admin.mjs`, executado automaticamente após `prisma migrate deploy` na inicialização. As variáveis `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD` e `CONFIRM_ADMIN_PROVISIONING=CREATE_FIRST_ADMIN` devem ser configuradas como secrets no servidor. A conta nasce com `mustChangePassword=true`.
- O provisionamento é idempotente: se já existir ADMIN, não cria outro nem altera a conta. Se não houver credenciais/confirmador válidos, a inicialização falha explicitamente para permitir correção com suporte técnico; não há credenciais padrão.

## Estado técnico confirmado
- Produto exclusivamente numérico: palpites de cinco algarismos, de `00000` a `99999`.
- Compra Pix pendente é uma intenção; participações e recibo só são criados após confirmação válida do provedor.
- Webhook Mercado Pago valida assinatura e consulta o estado canônico no provedor; o scheduler também reconcilia Pix pendente.
- Compras CASH e WALLET confirmam participações transacionalmente.
- Rodadas são mantidas em fila futura, com fechamento, abertura, sorteio e apuração processados pelo endpoint interno do scheduler.
- Financeiro do cambista separa dinheiro e Pix confirmado, acumula até acerto individual e preserva histórico. O botão de acerto é exclusivo do ADMIN e a autorização também é validada no servidor.
- Migração de acertos de cambistas criada em `20261102020000_cashier_settlements`; ainda não aplicada em produção.
- A área do jogador deve manter a ordem e a posição atuais dos componentes. Não fazer reorganização visual nessa área sem pedido explícito.

## Validação automatizada
- Em 2026-11-04, o GitHub Actions concluiu com sucesso no commit `c9fe6fa7ec6c47ac30efec6d4e0a0f656283009d`: Prisma validate/generate, TypeScript, testes unitários/rotas, lint, migrations em PostgreSQL descartável, testes de integração PostgreSQL e build de produção. A execução também validou os testes de bloqueio limitado de rodadas na criação de compras CASH.
- Isso valida o commit no CI; não comprova funcionamento no AquaCloud, configuração de secrets, pagamento real, impressora ou ambiente de produção.
- Execução: https://github.com/jpveiculos/Super-Quina/actions/runs/41752444863

## Bloqueios antes de liberar o site
1. **Reconciliação de branches:** na comparação atual, `main` está divergente de `main` (309 commits à frente e 9 atrás) e de `foundation/super-quina-v2` (309 commits à frente e 45 atrás). Revisar individualmente os commits ausentes e o diff antes de qualquer integração. Não mesclar automaticamente.
2. **Baseline do banco:** a cadeia histórica de migrations começa com tabelas do jogo de placas e depois faz a limpeza numérica. Antes do banco novo, construir e validar uma baseline numérica limpa em PostgreSQL descartável; não apagar nem reordenar migrations existentes.
3. **Conta ADMIN:** configurar as três variáveis privadas de provisionamento no AquaCloud e confirmar nos logs a criação do primeiro ADMIN após a migration. Se o processo falhar, acionar o suporte técnico do servidor com o erro dos logs, sem compartilhar senhas.
4. **AquaCloud / scheduler:** confirmar configuração de execução do endpoint `POST /api/internal/round-scheduler` a cada minuto, com `Authorization: Bearer <ROUND_SCHEDULER_SECRET>`. Verificar logs, último sucesso e tratamento de falhas sem revelar segredo.
5. **Variáveis e integração Pix:** conferir no ambiente correto a presença e consistência de `DATABASE_URL`, `AUTH_SECRET`, `APP_BASE_URL`, `ROUND_SCHEDULER_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` e `WALLET_PIX_ENCRYPTION_KEY`. Nunca copiar valores secretos para Git ou chat.
6. **Auditoria financeira:** testar ponta a ponta Pix aprovado/rejeitado/cancelado/expirado/reembolsado, reentregas de webhook, confirmação tardia, idempotência, comissões, estornos e acerto de cambista. Confirmar também como tratar estorno ocorrido depois de um acerto já fechado.
7. **Operação e segurança:** verificar backup/restauração, logs, health check, limites de acesso, cookies/CSRF, rate limit e procedimento de rollback.

## Integrações seguintes — ainda não iniciadas como produto
- **Android:** não há projeto Android/Capacitor/Expo no repositório. Definir se será um app Android dedicado ou uma camada nativa para impressão e comunicação com o site.
- **Impressora térmica:** existe benchmark de impressão Bluetooth no iPhone, mas não há integração Bluetooth implementada. Validar modelo/protocolo/SDK da impressora e testar impressão real de recibo do cambista.
- **API de acompanhamento do servidor:** não há contrato OpenAPI/Swagger nem painel de monitoramento identificado. Definir endpoints autenticados de saúde/diagnóstico e métricas operacionais sem expor dados pessoais ou segredos.
- **Sincronização servidor/repositório:** definir alertas de deploy, commit implantado, resultado de build, saúde do serviço e compatibilidade de migrations. Não confundir deploy automático com autorização para promover código.

## Próxima sequência de trabalho
1. Auditoria de desempenho e fila de alocação concluída no código; CI completo aprovado no commit indicado acima.
2. Reconciliar branches e revisar migrations/baseline e preservação do ADMIN.
3. Validar configuração e execução no AquaCloud sem tocar produção até autorização.
4. Executar homologação completa de compras, Pix, sorteios, premiações, carteira, cambistas e recibos.
5. Só então avançar para Android, impressora térmica e API de monitoramento.


## Resultado da revisão de integração e banco — 2026-11-04
- A comparação com `main` identificou quatro arquivos com alterações posteriores à base comum: `src/app/globals.css`, `src/app/player/page.tsx`, `src/components/admin/admin-cashier-manager.tsx` e `src/components/player/player-bet-history.tsx`. São mudanças de interface/fluxo; devem ser avaliadas e portadas seletivamente, não por merge integral. Em particular, o `main` remove ações de recibo do histórico, enquanto o branch de trabalho mantém acesso ao recibo confirmado. Essa diferença exige decisão funcional antes de qualquer cópia.
- A branch `foundation/super-quina-v2` contém uma migration `20261103000000_initial_foundation` que cria novamente os tipos `UserRole` e `AccountStatus`, além das tabelas `User` e `Session`. Ela não pode ser adicionada à cadeia atual: a migration inicial de `main` já cria esses objetos e a execução duplicada falharia.
- A fundação também possui utilitários de identidade próprios e parâmetros scrypt diferentes (`N=32768`), enquanto o código atual usa `N=16384`. Não importar esses arquivos nem assumir compatibilidade de hashes sem conversão/verificação explícita. O importador atual aceita apenas `scrypt$16384$8$1`, salt de 16 bytes e digest de 64 bytes.
- A cadeia atual contém 14 migrations SQL, da inicial `20261023000000_init` até `20261103010000_performance_queue_indexes`. O CI anterior executou migrations em PostgreSQL descartável e testes de integração com sucesso. Portanto, para o banco novo, a estratégia segura neste momento é aplicar a cadeia existente em ordem com `prisma migrate deploy`; não criar baseline paralela, não editar/reordenar migrations já aplicadas e não executar contra produção nesta etapa.
- A migration `20261101020000_numeric_only_cleanup` elimina `ParticipationLine` e os campos/tipos específicos de placas. Ela é deliberadamente destrutiva e reforça que a cadeia histórica não deve ser aplicada sobre uma base antiga com dados de placas sem plano de migração e backup próprios.
- O fluxo de importação de ADMIN do sistema antigo foi descartado. Não existe transferência de conta, hash, usuário ou qualquer outro dado legado. O provisionamento cria uma identidade nova no Super Quina.
- Nenhuma alteração foi feita em `main`, na branch de fundação, no banco ou na infraestrutura. Nenhuma integração de branch foi executada.


## Integração seletiva das branches — 2026-11-04
- Criado `docs/QUALITY_GATES_AND_DELIVERY_PLAN.md`, consolidando critérios de qualidade da `foundation/super-quina-v2` e a matriz operacional da `rebuild/super-quina-clean`, sem importar código ou migrations incompatíveis.
- Incorporados como critérios: monólito modular, servidor como autoridade, centavos inteiros, ledger por compensação, idempotência ponta a ponta, permissões testadas negativamente, diferença entre implementado/testado/homologado, segurança da API Android e impressão ESC/POS desacoplada.
- A auditoria estática identificou um bloqueio a verificar antes da liberação: o scheduler chama o sorteio, enquanto o serviço `settleNumericRoundPrizes` está separado. É necessário provar e testar que o sorteio concluído dispara a liquidação/crédito automático, sem depender de ação manual.
- Também ficaram registrados como gates: sobreposição de execuções do scheduler/cursor, limite de duração das consultas sequenciais Pix, bootstrap ADMIN em ambiente descartável, testes E2E das três áreas e homologação de recibos/financeiro.
- Não foram copiados: autenticação ou migration da V2, código Android esqueleto, migrations históricas, parâmetros de hash, dados de outro projeto ou regras comerciais não confirmadas.
- Nenhuma alteração em `main`, banco, secrets, DNS, hospedagem ou deploy.
- Commit desta integração documental: `fe86db3dbe812053a01d59b0f26e2d01c0541516`.


## Decisões registradas para implementação futura — 2026-11-03
- Política de confirmação Pix documentada em `docs/PRODUCT_RULES.md`: notificações intermediárias do webhook não efetivam nem cancelam compras; a decisão final depende da consulta do estado atual na API do Mercado Pago e da validação dos dados do pagamento.
- Webhook e consulta periódica/direta são complementares e devem convergir para um único serviço central e uma única máquina de estados. Não criar rotas, workers ou fluxos paralelos para a mesma confirmação.
- Eventos duplicados, atrasados ou fora de ordem não podem reverter indevidamente o estado nem duplicar cobrança, participações, recibo, comissão ou crédito. Enquanto houver estado pendente, inconclusivo, divergente ou indisponibilidade da API, não liberar participações nem recibo.
- Os testes obrigatórios dessa política foram adicionados aos gates P0 em `docs/QUALITY_GATES_AND_DELIVERY_PLAN.md`.
- Esta mudança é documental: não implementa nem altera código, rotas, webhook, scheduler, banco, secrets ou integração real. A implementação fica para a etapa de pagamentos, após auditoria do que já existe, para ampliar/corrigir o fluxo atual sem duplicidade.


## Liquidação automática de prêmios — implementação
- O scheduler agora procura rodadas `COMPLETED` com resultado publicado e sem auditoria de liquidação bem-sucedida (manual ou automática), e chama o serviço existente `settleNumericRoundPrizes`.
- Falhas permanecem sem auditoria de sucesso; a próxima execução do scheduler tenta novamente. A seleção é limitada a 100 rodadas por execução.
- A liquidação automática não cria um segundo mecanismo financeiro: reutiliza o serviço central existente, o bloqueio da rodada, o ledger e a chave idempotente por linha. A auditoria automática é gravada uma única vez após liquidação bem-sucedida.
- Foram adicionados testes de rota para sucesso automático e falha recuperável. Execução real de CI ainda precisa ser confirmada; nenhuma homologação ou deploy foi realizado.


## Plano de prêmio de bilhete de cambista — 2026-11-03
- Decisão detalhada registrada em `docs/PRODUCT_RULES.md` e roteiro de auditoria/implementação criado em `docs/CASHIER_TICKET_PRIZE_PAYOUT_PLAN.md`.
- Auditoria inicial confirmou: recibo aceita cliente opcional e rótulo de cambista; QR de recibo é gerado localmente; consulta pública já possui página/API; scheduler chama a apuração central; serviço marca prêmios sem jogador ou de venda por cambista como `pendingManualPayouts`.
- A reconciliação ADMIN existente é para crédito de prêmio em carteira de jogador, não para pagamento externo de bilhete de cambista. O modelo atual não registra ator/data/status de pagamento Pix externo por linha premiada.
- Ainda não foi confirmado se o rótulo `cashierLabel` identifica o ponto de venda correto, nem se a consulta pública já apresenta estados de prêmio ou contato WhatsApp. Esses pontos estão marcados para rastreamento no plano.
- Implementação pendente: persistência da baixa externa, ação ADMIN após Pix efetivo, atualização da consulta QR para `NÃO PREMIADO` / `PRÊMIO DISPONÍVEL` + WhatsApp / `PRÊMIO PAGO`, configuração central do WhatsApp e testes de idempotência/concorrência/permissões.
- Nenhum código, schema, migration, rota, interface ou deploy foi alterado nesta etapa; foram feitas somente atualizações documentais na branch `main`.
- Commits: plano `b3a0d0e1a7ec2f21a1d866c1b86680a0c80095cf`; regras de produto `69606bca4a406866414ea9906553b04d5ee13437`.

- Auditoria adicional da consulta pública: `receipt-verification` e `ticket-check` usam `prizeCreditedAt` como indicador de prêmio pago/premiado. Esse campo representa crédito na carteira e não pode ser reutilizado para baixa de Pix externo de cambista. A API de recibo exibe `cashier.fullName` ou `username`; falta confirmar que isso corresponde à identificação comercial do ponto de venda. A API `ticket-check` também aplica janela de 7 dias, regra que deve ser avaliada para não conflitar com a consulta QR do recibo.
- Plano atualizado com essas divergências no commit `0c3ee07b76962b9d476eb2f4b2134955a83eb369`.


## Fechamento da auditoria incremental — 2026-11-05

### CI confirmado no commit de trabalho
- Commit: `f8f02e0512ca443743c2d2689262c30074ec47e1` — `test: cover Mercado Pago webhook retries and duplicates`.
- GitHub Actions execução #433, run `41974462763`: **conclusão success**.
- Passaram: validação/geração Prisma, TypeScript, testes unitários e de rotas, lint, migrations em PostgreSQL limpo, testes de integração PostgreSQL e build de produção.
- A suíte nova `src/app/api/payments/mercadopago/webhook/route.test.ts` passou com os cenários de assinatura inválida, evento duplicado já processado, falha transitória com reentrega e pagamento ainda não mapeado.
- Execução: https://github.com/jpveiculos/Super-Quina/actions/runs/41974462763
- Esse resultado comprova o pipeline no commit indicado; não comprova pagamento real, webhook real, secrets ou comportamento no AquaCloud.

### Reconciliação com main — decisão do responsável
- A branch `main` foi esvaziada intencionalmente e não está conectada ao servidor; esse estado foi confirmado pelo responsável em 2026-11-05.
- A ausência de arquivos em `main` não representa perda acidental e não exige recuperação, sincronização ou integração com a branch de trabalho.
- O trabalho técnico permanece em `main`. Não fazer merge, rebase, cherry-pick ou publicação sem autorização explícita.

### Estado técnico e gates restantes
- A rota do webhook valida assinatura, consulta o estado canônico do pedido no Mercado Pago, confere referência externa, moeda, valor e método Pix, e converge para o serviço central de confirmação/cancelamento.
- O scheduler chama a liquidação central de prêmios após o sorteio, com lock da rodada e idempotência por linha; o CI acima passou nos testes atuais de rota e integração de ciclo de rodadas.
- Ainda falta teste PostgreSQL concorrente específico para corrida entre webhook e polling, reentrega simultânea do mesmo evento e notificação terminal fora de ordem. Os testes recentes do webhook são testes de rota com mocks, não homologação de concorrência real.
- Permanecem sem comprovação: credenciais e webhook URL no painel Mercado Pago, variáveis/secrets no AquaCloud, criação efetiva do primeiro ADMIN, execução recorrente do scheduler no servidor, backup/restauração, monitoramento e homologação ponta a ponta de Pix, saques, comissões, prêmios e recibos.
- A cadeia de migrations deve ser aplicada somente num banco novo e vazio, conforme a regra de não importar dados legados. Não executar em produção nesta fase.
- A impressão Bluetooth ainda não foi implementada. Antes de iniciar, identificar os modelos exatos das impressoras e confirmar se usam BLE/GATT ou Bluetooth Classic/SPP; a impressão direta pelo navegador não é universal.

### Decisão operacional
- Auditoria de código e CI: avançada, com pipeline verde no commit citado.
- Liberação/implantação: **não aprovada ainda**, devido aos gates ambientais e de homologação acima e à divergência da branch.
- Próxima sequência segura: resolver documentalmente a preservação/reconciliação de `main`; acrescentar testes PostgreSQL concorrentes do webhook; validar configuração e homologação no ambiente novo somente com autorização explícita; depois identificar impressoras e iniciar a etapa Bluetooth.
- Nenhum deploy, alteração de secrets, banco de produção, DNS ou integração Bluetooth foi executado.


## Esclarecimento do estado de main — 2026-11-05
- O responsável pelo projeto confirmou que a branch `main` foi esvaziada intencionalmente e não está conectada ao servidor. A ausência de `.gitignore` e `README.md` em `main` é, portanto, estado deliberado, não uma perda acidental a ser recuperada.
- A branch de trabalho permanece `main`; ela é a referência do trabalho técnico atual. Não é necessário sincronizar nem integrar com `main` nesta fase.
- Não interpretar a divergência entre `main` e `main` como bloqueio técnico do projeto. A publicação só será considerada quando houver autorização explícita e decisão sobre qual branch será conectada ao servidor.
- Inventário confirmado: `npm run test:postgres` já inclui `src/modules/payments/pix-terminal-race.postgres.integration.test.ts`, que executa concorrência real entre confirmação Pix e cancelamento terminal, verificando que pagamento, compra, participação e recibo não terminam em estados divididos. Essa suíte foi incluída no pipeline CI #433 aprovado.
- Continua pendente teste PostgreSQL específico de duas confirmações simultâneas do mesmo pagamento e teste de concorrência da reserva/processamento do mesmo evento webhook. A cobertura de rota atual testa reentrega sequencial e falha transitória com mocks.


## Auditoria incremental — concorrência de eventos do webhook Mercado Pago (2026-11-05)

- A auditoria identificou uma janela de corrida: duas entregas simultâneas de um evento já persistido, mas ainda não processado, podiam observar `processedAt = null` e executar o mesmo fluxo em paralelo. A restrição única de `providerEventId` protege a criação duplicada, mas não reservava o processamento de uma linha já existente.
- Corrigido `src/app/api/payments/mercadopago/webhook/route.ts`: o processamento agora usa compare-and-set em `WebhookEvent.processingError` para adquirir uma reserva exclusiva antes de executar confirmação/cancelamento/registro de estorno.
- A reserva expira após cinco minutos para permitir recuperação se o processo morrer. Falhas liberam somente a reserva pertencente àquela execução; conclusão exige que a mesma reserva ainda seja a proprietária do evento.
- Adicionados testes de rota para concorrência sobre evento pendente existente, evento já reservado, recuperação de reserva expirada, falha transitória/reentrega e corrida na criação do mesmo evento.
- Adicionada a suíte PostgreSQL `src/modules/payments/webhook-event-claim.postgres.integration.test.ts`, que comprova com duas atualizações simultâneas que apenas uma execução adquire a reserva e somente a reserva vencedora consegue concluir o evento.
- A suíte foi incluída em `npm run test:postgres`; não exige migration ou alteração de schema, pois reutiliza o campo existente `WebhookEvent.processingError`.
- Commits desta sequência: `9c9e244ee9593745a652bfe16f80be00939b04ae`, `b84a56a13aea3a7576f3f10b370b105d964f3603`, `0554643d61fcd298740f107d340542292e460a44`, `32cf9cbda8f5c1087e5a212f6a9691988dfdbcea`, `97a1b290e71c048e7b61568191b738ee17483bbd` e `0e5a260bfdd096b03a0d33baa916ca917b967a69`.
- **Validação pendente:** a alteração foi registrada na branch, mas ainda não há confirmação de execução verde do CI para o novo HEAD. Não declarar o bloco aprovado antes do workflow completo, incluindo PostgreSQL e build.
- Nenhuma migration, alteração de banco de produção, secret, DNS ou deploy manual foi executado. A branch de trabalho continua `main`; `main` permanece intocada.


## Auditoria incremental — estratégia única do scheduler (2026-11-05)

- O contrato operacional documentado em `.env.example` é uma chamada externa a `POST /api/internal/round-scheduler` a cada minuto, autenticada por `ROUND_SCHEDULER_SECRET`.
- A auditoria encontrou também `instrumentation.ts`, que iniciava um segundo mecanismo opcional dentro do processo Node a cada cinco segundos quando `ROUND_SCHEDULER_ENABLED=true`. Isso permitia duas estratégias simultâneas e criava ambiguidade operacional.
- Removido `instrumentation.ts`. A estratégia de código passa a ser exclusivamente o endpoint protegido acionado pelo cron da AquaCloud, conforme o contrato já documentado. Não foi alterada a lógica de rodadas, pagamentos, alocação ou liquidação.
- **Validação ambiental pendente:** ainda é necessário configurar/confirmar o cron na AquaCloud, verificar o secret sem expor seu valor, observar execuções recorrentes e confirmar logs/retentativas. A remoção do timer interno não configura o cron externo automaticamente.
- O teste de integração PostgreSQL já existente cobre fechamento, sorteio e liquidação concorrentes por rodada; a suíte de alocação cobre disputa e checkpoint do cursor. Ainda falta teste de sobreposição do endpoint completo e medição de duração com volume representativo.
- CI para o novo HEAD permanece pendente de confirmação. Nenhuma alteração de secrets, configuração do cron, banco de produção ou deploy manual foi realizada.


## Auditoria incremental — concorrência de saques da carteira (2026-11-05)

- Criada a suíte PostgreSQL `src/modules/wallet/withdrawal-concurrency.postgres.integration.test.ts`, com guarda que só permite execução local na base `superquina_test`.
- O primeiro cenário dispara dois pedidos simultâneos para a mesma carteira e verifica que somente um reserva o saldo integral, sem saldo negativo nem reservas duplicadas.
- O segundo cenário prepara uma carteira independente com depósito de R$ 75,00, cria o saque pendente e sua reserva negativa de R$ 75,00 (mesmo fluxo financeiro da rota real). Duas ações administrativas simultâneas disputam a conclusão `PENDING → PAID`; o teste verifica uma única conclusão, um único lançamento `WITHDRAWAL_PAID` de valor zero (marcador auditável de pagamento externo, sem novo débito) e saldo final zero.
- A suíte foi incluída no comando `npm run test:postgres`. Os testes de rota já existentes continuam cobrindo autenticação, origem, reserva, rejeição e conclusão; a nova suíte acrescenta concorrência real no PostgreSQL.
- Revisão da implementação real: a rota do jogador bloqueia a linha `User`, calcula o saldo pela soma do ledger e cria saque + `WITHDRAWAL_RESERVE` negativa na mesma transação `Serializable`. A rota administrativa bloqueia a linha `Withdrawal`, aceita somente `PENDING`, e ao pagar cria `WITHDRAWAL_PAID` de zero porque a reserva já retirou o valor disponível; ao rejeitar, cria `WITHDRAWAL_RELEASE` positivo para devolver a reserva. O teste concorrente foi alinhado a essa semântica. A validação PostgreSQL e CI ainda não foram executadas/confirmadas para estes commits.
- **Validação pendente:** a suíte foi adicionada ao repositório, mas não foi executada neste ambiente. Exigir execução em PostgreSQL descartável local e CI verde antes de fechar o bloco. Não declarar homologação com base apenas na criação dos testes.
- Não foram alterados regras financeiras, migrations, dados de produção, secrets, cron ou deploy. Branch ativa: `main`; `main` permanece intocada.


## Auditoria financeira — ledger e comissões (revisão de código)

- O saldo de carteira do jogador é a soma dos lançamentos de `LedgerEntry`; saques reservam o saldo com lançamento negativo e rejeições liberam com lançamento positivo. O pagamento externo do saque gera um lançamento `WITHDRAWAL_PAID` de zero centavos como marcador auditável, sem debitar novamente a reserva.
- A comissão do cambista é armazenada separadamente em `CashierCommission`, com `purchaseId` único. A taxa aplicada e o valor em centavos ficam persistidos na confirmação, usando `calculateCommissionCents` com arredondamento half-up. A taxa é consultada no momento da confirmação; a comissão já criada permanece como snapshot histórico.
- Para vendas em dinheiro, `createNumericPurchase` cria compra e comissão na mesma transação serializable, inclusive quando a compra paga aguarda alocação de rodadas. Para Pix, `confirmPixPayment` confirma compra, participações, recibo e comissão na mesma transação, após confirmação canônica do provedor. Para compra por carteira, o débito e a compra são gravados na mesma transação.
- Há teste unitário de cálculo de comissão (limites, zero/100%, arredondamento) e teste de serviço para venda em dinheiro com alocação pendente. A revisão de código não substitui teste PostgreSQL concorrente ou teste de ponta a ponta.
- Ponto ainda aberto: não foi localizada/inspecionada nesta etapa a implementação completa da consulta e do fechamento de caixa/repasse do cambista (modelo `CashierSettlement` existe no schema, mas as rotas correspondentes não foram identificadas com segurança). Portanto não declarar fechamento financeiro homologado. Próximo passo: localizar e auditar as rotas reais de extrato/fechamento, validar vendas CASH versus PIX, prêmio pago em dinheiro, comissão acumulada e prevenção de liquidação duplicada.
- Nenhuma alteração em dados ou ambiente de produção; nenhuma migration ou deploy. CI e testes PostgreSQL continuam sem execução confirmada.


## Auditoria do fechamento financeiro do cambista — 2026-11-05

- Localizada a implementação real em `POST /api/admin/cashiers/[cashierId]/settlements`, com interface em `src/app/admin/cashiers/[cashierId]/page.tsx`, resumo do cambista em `GET /api/cashier/summary` e histórico persistido em `CashierSettlement`.
- O fechamento grava um snapshot auditável de vendas CASH, Pix confirmado, quantidade de jogos, comissão e prêmios pagos em dinheiro pelo cambista. O snapshot e a associação dos pagamentos de prêmio ao settlement são gravados na mesma transação `Serializable`; há lock da linha do cambista, limite temporal obtido pelo relógio do PostgreSQL e evento `CASHIER_SETTLEMENT_RECORDED`.
- Os prêmios pagos em dinheiro são registrados em `NumericPrizePayout`, com `participationLineId` único; o pagamento em dinheiro bloqueia a linha premiada e a linha do cambista antes de criar o registro, prevenindo pagamento duplicado e concorrência com o acerto. O fechamento os associa ao snapshot sem misturá-los com comissão.
- A auditoria encontrou um defeito concreto: comissão de venda CASH aguardando alocação podia ser criada antes da confirmação da compra. Como os relatórios filtravam a comissão por `CashierCommission.createdAt`, a confirmação após um acerto podia deixar a comissão fora dos dois períodos. Corrigido para filtrar pela data de confirmação da compra, alinhando comissão e venda no endpoint de fechamento, resumo do cambista e tela administrativa.
- Também foi identificado que a transação de fechamento bloqueava a linha do cambista, mas os caminhos que criam/confirmam vendas não compartilhavam esse lock. Incluído lock da mesma linha em `createNumericPurchase`, na alocação tardia de vendas CASH e na confirmação Pix de compras de cambista. Isso coordena a entrada/efetivação de vendas com o limite do acerto.
- O teste de rota do fechamento foi atualizado para exigir a janela de comissão pela data de confirmação da compra. A suíte existente cobre autenticação, proteção de origem, snapshot, associações, auditoria e rollback.
- **Validação pendente:** ainda não foi executado CI para os novos commits nem teste PostgreSQL concorrente específico do fechamento contra o banco local descartável. Os testes de rota usam mocks; a revisão estática não equivale a prova concorrente real. Não declarar o financeiro homologado.
- O botão “Zerar para novo acerto” apenas registra um corte/snapshot e inicia o próximo período; não realiza transferência bancária, pagamento automático de comissão nem liquidação financeira externa. O histórico é preservado.
- Não foram alterados dados de produção, migrations, secrets, DNS ou hospedagem. Nenhum deploy foi realizado. Branch ativa: `main`; `main` e demais branches permanecem intocadas.


### Teste de concorrência do fechamento — complemento

- Criado `src/modules/cashier-settlement-concurrency.postgres.integration.test.ts`.
- O cenário cobre a falha histórica de comissão: cria venda CASH sem rodada disponível (compra pendente, comissão já existente), registra um acerto enquanto a venda ainda está pendente e, depois do corte, executa a alocação tardia com a mesma trava do cambista.
- Verifica que o primeiro acerto não inclui a venda/comissão pendente, que a alocação confirma a venda depois do corte e que o próximo período inclui o valor da venda e sua comissão exatamente uma vez.
- O teste usa Prisma/PostgreSQL real, chama `createNumericPurchase` e `allocatePaidPurchases`, e recusa execução fora de host local e banco `superquina_test`. Foi incluído em `npm run test:postgres`.
- O teste foi adicionado ao repositório, mas ainda não foi executado neste ambiente. A espera concorrente usa uma breve janela de sincronização; a validação efetiva depende de executar a suíte em PostgreSQL local descartável.
