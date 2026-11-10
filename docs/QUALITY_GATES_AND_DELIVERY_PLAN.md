# Critérios de qualidade, lacunas e plano de entrega — Super Quina

Atualizado em 2026-11-05. Documento consolidado a partir da auditoria da branch `rebuild/super-quina-clean` e da fundação `foundation/super-quina-v2`. A implementação vigente e única branch oficial é `main`.

## 1. Princípios técnicos adotados

1. Monólito modular Next.js + TypeScript + Prisma + PostgreSQL enquanto não houver gargalo comprovado que justifique separar serviços.
2. PostgreSQL é a fonte de verdade. Regras financeiras, pagamentos, rodadas, sorteios e premiações são decididos no servidor.
3. Valores monetários são inteiros em centavos; números sorteados e palpites são strings de cinco dígitos, preservando zeros à esquerda.
4. Operações financeiras e tarefas recorrentes são transacionais, idempotentes e auditáveis. Correções financeiras usam lançamentos compensatórios; não se sobrescreve o histórico.
5. Web e futuro Android compartilham contratos e regras do servidor. O cliente não recalcula nem autoriza operações financeiras.
6. Implementado, testado automaticamente, homologado e liberado são estados diferentes. Nunca declarar uma etapa pronta apenas porque existe uma rota, tela ou tabela.
7. Nenhuma integração real, deploy, DNS, alteração de secrets ou banco de produção ocorre sem autorização específica.

## 2. Gates obrigatórios antes da primeira liberação

### P0 — Bloqueadores

### Contrato de validação do Pix (derivado de `docs/PRODUCT_RULES.md`)
- [ ] Webhook intermediário, isoladamente, não efetiva nem cancela compra; validar assinatura e usar a notificação como gatilho de reconciliação.
- [ ] A API do Mercado Pago é consultada para confirmar o estado atual, conferindo ID/referência, valor e moeda; não confiar na ordem de chegada das notificações.
- [ ] Estado pendente, inconclusivo, divergente ou indisponibilidade da API não libera participações nem recibo; reconciliação retoma sem perda da intenção.
- [ ] Webhook e consulta periódica convergem para um único serviço de confirmação/máquina de estados; não existem rotas ou workers paralelos aprovando/cancelando a mesma compra.
- [ ] Transições finais são transacionais e idempotentes sob reentrega, concorrência e reinício; nenhuma participação, recibo, comissão ou crédito é duplicado.
- [ ] Estados terminais e transições são mapeados conforme a documentação oficial vigente do Mercado Pago; reembolso/chargeback inesperado segue o tratamento de incidente já definido nas regras do produto.
- [ ] Testes cobrem notificações intermediárias, duplicadas, atrasadas e fora de ordem; falha/timeout da API; consulta repetida; divergência de valor/referência; confirmação tardia; rejeição/cancelamento/expiração; concorrência webhook + scheduler.

- [ ] Banco novo e vazio confirmado; nenhum dado, conta, senha, sessão ou histórico de outro projeto.
- [ ] Primeiro ADMIN criado pelo provisionamento próprio, com troca obrigatória de senha; testar idempotência e falha por secrets ausentes em PostgreSQL descartável.
- [ ] Matriz de permissões por papel (PLAYER, CASHIER, ADMIN) e testes negativos em todas as rotas sensíveis, inclusive propriedade dos recursos.
- [ ] Autenticação web revisada: cookies seguros, validação de origem/CSRF conforme contexto, rate limit, expiração e revogação de sessão.
- [ ] Compra, carteira, comissões e saques testados sob concorrência; invariantes protegidos por transação e constraints.
- [ ] Pix validado em sandbox: assinatura do webhook, consulta canônica ao provedor, valor/moeda/referência, eventos duplicados, confirmação tardia, falha de rede e reconciliação.
- [ ] Calendário e cutoff testados com relógio controlado, incluindo virada de horário, atraso do scheduler e ausência temporária de rodada elegível.
- [ ] Scheduler com uma única estratégia de execução; concorrência entre instâncias, reinício, retries e execução parcial demonstrados.
- [ ] Apuração e crédito automático de prêmios ligados ao fluxo normal após o sorteio, com ledger idempotente e auditoria. O serviço de liquidação isolado não basta: provar que a execução automática realmente o chama.
- [ ] Migrations executadas em PostgreSQL descartável vazio e backup/restore testados antes de qualquer banco real.
- [ ] CI verde no commit candidato: Prisma validate/generate, TypeScript, unit/route tests, lint, migrations limpas, integração PostgreSQL e build.

### P1 — Essenciais para operação
- [ ] Recibo emitido somente após pagamento confirmado e todas as repetições vinculadas; QR e impressão/reimpressão não criam compra nem recibo novo.
- [ ] Verificação pública do recibo revela apenas dados mínimos; recibo completo exige autenticação e autorização.
- [ ] Prêmio de recibo de cambista distingue claramente premiado, aguardando pagamento e pago; baixa exige evidência e auditoria.
- [ ] Financeiro de cambista separa vendas em dinheiro, Pix, comissão calculada, dinheiro recebido e comissão efetivamente paga.
- [ ] Saques distinguem solicitado, analisado, aprovado, pago e rejeitado; aprovado não significa transferência realizada. Payout automático permanece desativado sem autorização.
- [ ] Histórico, resultados, compras e auditoria usam paginação e limites server-side.
- [ ] Testes E2E de PLAYER, CASHIER e ADMIN e homologação visual em celular e desktop.
- [ ] Logs estruturados, sem segredos/PII desnecessária, com correlation ID, alertas de falha e métricas do scheduler.

### P2 — Evolução após estabilizar o site
- [ ] Otimizar fisicamente os assets originais após inspeção visual e medição; otimização de entrega já existente não significa que os PNGs de origem foram reduzidos.
- [ ] Contrato OpenAPI/versionamento, paginação e erros estáveis para clientes adicionais.
- [ ] Android nativo completo (PLAYER, CASHIER e ADMIN), usando API compartilhada; autenticação própria com access token curto, refresh rotativo/revogável e armazenamento no Android Keystore. Não reutilizar cookie HttpOnly web.
- [ ] Impressão térmica desacoplada: modelo lógico de recibo → layout → comandos ESC/POS → perfil de compatibilidade → transporte. Validar Bluetooth Classic, BLE e USB conforme cada equipamento suportar.
- [ ] Homologar mais de uma impressora real. ESC/POS é amplamente adotado, mas não garante compatibilidade absoluta de todos os comandos.
- [ ] Monitoramento operacional com health checks, alertas de deploy, versão implantada, falhas e compatibilidade de migrations.

## 3. Riscos concretos que exigem correção/verificação

1. **Liquidação automática:** o endpoint do scheduler chama criação/abertura/fechamento/sorteio e reconciliação, mas a auditoria estática encontrou o serviço `settleNumericRoundPrizes` separado. Antes da liberação, rastrear o fluxo completo e garantir que o sorteio concluído acione a liquidação automática sem depender de ação manual. Testar créditos idempotentes e reexecução.
2. **Concorrência do scheduler:** provar que duas chamadas simultâneas não duplicam trabalho, não disputam o cursor da fila e não deixam pagamentos ou compras sem reconciliação. Se houver execução sobreposta, adotar claim/lock distribuído no PostgreSQL com lease/expiração e teste de concorrência.
3. **Tempo e timezone:** a implementação atual usa UTC−03 fixo. Centralizar a regra de calendário e testar datas/horários de fronteira. Não misturar relógio do navegador com relógio do banco.
4. **Tempo máximo de execução:** chamadas sequenciais ao Mercado Pago dentro do scheduler podem consumir o limite de execução. Medir latência e garantir orçamento total por execução; preferir filas/claims com lotes pequenos e retomada segura.
5. **Bootstrap ADMIN no start:** testar em ambiente descartável o comportamento de migration + provisionamento no start, incluindo secrets ausentes, ADMIN já existente e reinício concorrente. Não executar contra produção como teste.
6. **Histórico de migrations:** a cadeia do branch de trabalho tem histórico de evolução do jogo de placas seguido de limpeza numérica. Não copiar migrations da V2 nem reescrever histórico já aplicado. Validar a cadeia completa em banco novo descartável e manter a restrição de nunca aplicar sobre banco antigo de placas.

## 4. Decisões de arquitetura aproveitadas das outras branches

- Da `foundation/super-quina-v2`: monólito modular, domínio separado de infraestrutura, segurança server-side, idempotência ponta a ponta, auditoria, CI e gates de validação. Foram aproveitados os critérios, não o código de autenticação nem a migration inicial, pois duplicariam User/Session e têm parâmetros de hash incompatíveis.
- Da `rebuild/super-quina-clean`: matriz de requisitos/lacunas, distinção entre implementado e validado, operação financeira explícita, separação entre prêmio devido e pago, Android completo e impressão ESC/POS extensível.
- Não importar o esqueleto Android como se fosse aplicativo pronto; não copiar valores comerciais, URLs, números de contato ou decisões operacionais de documentos de outras branches sem confirmar que continuam válidos no escopo atual.
- Não copiar UI ou migrations integralmente. Comparar patches e testar cada alteração contra as regras atuais do produto.

## 5. Ordem prática de execução

1. Fechar a experiência PLAYER: formulário, pagamento Pix/saldo, carteira, histórico próprio, resultados e crédito automático de prêmios.
2. Fechar a experiência CASHIER: formulário visualmente idêntico ao PLAYER, variando apenas Pix/dinheiro, recibo impresso, resultados e financeiro.
3. Auditar e concluir a área ADMIN, que tem escopo mais amplo, incluindo gestão, histórico, acertos e controles.
4. Fechar os gates P0 de scheduler, liquidação automática, concorrência e provisionamento ADMIN, além dos testes financeiros/Pix e E2E.
5. Homologar impressão/recibos, saques e os fluxos completos dos três papéis.
6. Preparar documentação operacional, backup/restore e observabilidade.
7. Só depois abrir etapa Android/ESC-POS e preparar release.

## 6. Limites

Este documento não autoriza deploy, alteração de DNS, conexão com banco real, execução de migrations em produção, alteração de secrets, Pix real, payout, pagamento de prêmio ou ativação de cron externo. Cada operação exige autorização específica.


## 7. Registro de auditoria incremental — Bloco 1 (2026-11-04)

Escopo: scheduler de rodadas, sorteio numérico e liquidação automática. Branch auditada: `main`.

### Evidências confirmadas por leitura do código

- `src/app/api/internal/round-scheduler/route.ts`: endpoint protegido por `ROUND_SCHEDULER_SECRET`; cria fila de rodadas, aloca compras pagas pendentes, reconcilia Pix, fecha/abre rodadas, realiza sorteios e chama a liquidação automática.
- `src/app/api/internal/round-scheduler/route.test.ts`: há testes para autenticação, criação/idempotência da agenda, liquidação automática, falha com resposta 207 para permitir retentativa e reconciliação Pix sem polling do navegador.
- `src/modules/rounds/close-round.ts`, `open-round.ts` e `draw-round-results.ts`: as operações usam transações e bloqueio da linha da rodada (`FOR UPDATE`). Fechamento e sorteio verificam os horários com relógio do banco. Fechamento e liquidação possuem retentativa limitada para conflitos de serialização; sorteio e abertura podem falhar naquela execução e ser retomados pelo scheduler seguinte.
- `src/modules/rounds/settle-numeric-round-prizes.ts`: exige rodada concluída, bloqueia rodada e linhas elegíveis, recalcula o prêmio a partir do snapshot salvo e grava crédito no ledger com chave estável `numeric-prize-credit:<linha>` dentro da mesma transação. Divergências de valores existentes são tratadas como inconsistência, não sobrescritas.
- `src/modules/purchases/allocate-paid-purchases.ts`: processamento é limitado a 100 compras por execução, em lotes de até 50, com cursor persistido; a compra é bloqueada antes da alocação e a intenção só é confirmada após vínculo de todas as repetições.
- `prisma/schema.prisma`: `Round.code` é único; participações são únicas por compra/rodada; ledger tem chave de idempotência única.

### Lacunas ainda não demonstradas

1. Os testes da rota simulam as dependências. Não demonstram concorrência real entre duas requisições simultâneas no PostgreSQL nem provam ausência de starvation/retrocesso do cursor sob execuções sobrepostas.
2. Não foi encontrado no endpoint um lock global/lease de execução. As operações críticas possuem proteções por linha, transação, constraints ou claim por `updatedAt`; isso reduz o risco de duplicação, mas a segurança do fluxo completo sob sobreposição ainda precisa de teste de integração PostgreSQL. Não adicionar lock global sem demonstrar que é necessário.
3. O endpoint tem `maxDuration = 60` e executa reconciliações Pix sequencialmente (até 50 pagamentos selecionados) além da alocação de compras e processamento das rodadas. Não há evidência medida, nesta etapa, de que o pior caso caiba no limite. Medir latência e garantir retomada sem perda de itens.
4. O teste de liquidação da rota comprova que a função é chamada e que a falha é reportada; não prova, por si só, crédito financeiro real. A idempotência e transação estão implementadas no serviço, mas ainda exigem teste PostgreSQL com linhas premiadas, duas execuções concorrentes e falha/reexecução.

### Decisão desta etapa

- Não foi feita alteração de código: a leitura confirmou que a integração sorteio → liquidação automática já existe; criar outra seria duplicação.
- Bloco 1 permanece **PARCIAL — implementação identificada; validação concorrente e de duração pendente**.
- Próximas verificações obrigatórias: testes de integração com PostgreSQL descartável para duas execuções concorrentes do scheduler, alocação/cursor, sorteio único e crédito único; medição do tempo de execução com lote Pix representativo; executar testes, typecheck, lint e build em ambiente de desenvolvimento antes de marcar o bloco como concluído.
- Nenhum deploy, migration ou operação em banco de produção foi realizado ou autorizado.
- Varredura de traços históricos: nesta etapa foram inspecionados os arquivos listados acima; não foi feita alteração nem integração de código de outro projeto. A varredura global continua sendo gate obrigatório antes de qualquer integração futura.


### Complemento da auditoria — evidência de testes e risco operacional (2026-11-04)

A inspeção adicional do pipeline `.github/workflows/quality.yml` confirmou que o CI sobe PostgreSQL 16, aplica migrations e executa `npm run test:postgres`. Porém, o script `test:postgres` do `package.json` aponta somente para `src/lib/auth/login-rate-limit.postgres.integration.test.ts`. Portanto, o pipeline atual **não executa testes PostgreSQL de concorrência do scheduler, sorteio, alocação de compras ou liquidação de prêmios**.

Confirmações adicionais:
- `drawRoundResults` bloqueia a linha da rodada, verifica o horário com o relógio do banco e grava resultado/status/auditoria na mesma transação. Uma segunda execução encontra a rodada concluída e não sorteia novamente.
- `settleNumericRoundPrizes` bloqueia rodada e linhas, usa transação serializável e chave única `numeric-prize-credit:<lineId>`; repetições verificam se o lançamento existente corresponde ao prêmio recalculado.
- `closeRound` também bloqueia a rodada e repete conflitos de serialização até três vezes.
- Não há lock global/lease do endpoint. A criação de rodadas usa transação serializável e a unicidade do código; as rotinas críticas usam bloqueios por linha. Isso não demonstra, isoladamente, que o endpoint inteiro seja serializado — nem prova que tal serialização global seja necessária.
- O scheduler executa reconciliação Pix sequencialmente para até 50 pagamentos e, no mesmo request, aloca compras, fecha/abre rodadas, sorteia e liquida até 100 rodadas. Com `maxDuration = 60`, há risco de ultrapassar o tempo de execução em picos. Não há benchmark ou telemetria de duração verificada nesta auditoria.

### Próxima ação técnica aprovada para o bloco

Não introduzir lock global, paralelismo Pix ou mudança de limite sem teste e medição. O próximo incremento deve adicionar uma suíte PostgreSQL de integração específica do domínio, reaproveitando o serviço de banco e fixtures existentes, com cenários:
1. Duas chamadas simultâneas de sorteio para a mesma rodada: um único resultado e um único evento de sorteio.
2. Duas liquidações simultâneas da mesma rodada: exatamente um crédito por linha premiada, ledger consistente e auditoria única.
3. Falha/rollback durante liquidação seguida de retentativa: nenhum crédito parcial e conclusão posterior.
4. Duas alocações simultâneas da mesma compra: uma única participação por rodada e compra confirmada uma única vez.
5. Duas execuções simultâneas do scheduler: sem rodadas duplicadas, créditos duplicados ou perda permanente de itens da fila.

Adicionar medição de duração por etapa (reconciliação Pix, alocação, fechamento/abertura, sorteio e liquidação) e teste com lote representativo antes de decidir se Pix deve ser limitado/particionado ou processado por worker. Qualquer limite de lote precisa preservar retomada e reconciliação eventual.

Status permanece **PARCIAL**. Esta complementação é documental; nenhum código de produção foi modificado e nenhum teste foi executado nesta sessão. O CI configurado no GitHub foi inspecionado, mas seu resultado mais recente não foi consultado. Não houve deploy nem acesso/escrita em banco de produção.

## 8. Auditoria incremental — Bloco 2: área do cambista (2026-11-04)

Escopo inicial: tela do cambista, criação de vendas CASH/PIX, resumo financeiro e superfícies administrativas de cadastro/acerto/histórico. Branch: `main`.

### Funcionalidades já identificadas no código

- `src/app/cashier/page.tsx`: área autenticada de cambista; apresenta formulário de venda, últimos resultados e resumo financeiro no rodapé.
- `src/components/purchases/numeric-game-purchase-form.tsx`: formulário compartilhado PLAYER/CASHIER; permite números de cinco algarismos, valor por número, 1–10 repetições, CASH ou PIX para cambista, chave de idempotência no cliente e consulta de status Pix. Para CASH, apresenta recibo; para PIX, aguarda confirmação e só abre recibo quando a API informa que está pronto.
- `src/app/api/cashier/purchases/cash/route.ts` e `create/route.ts`: exigem sessão CASHIER sem troca de senha pendente, validam origem e payload e chamam o serviço central `createNumericPurchase`. A rota CASH confirma a venda e registra comissão; a rota PIX cria/recupera a ordem do Mercado Pago e mantém a compra sem recibo até confirmação.
- `src/app/api/cashier/purchases/[purchaseId]/status/route.ts`: restringe a consulta à compra do próprio cambista e limita a reconciliação direta do provedor por claim de 10 segundos.
- `src/app/api/cashier/summary/route.ts` e `src/components/cashier/cashier-sales-summary.tsx`: exibem comissão, vendas totais, dinheiro, Pix confirmado, quantidade de vendas/jogos e último acerto; atualizam a cada 30 segundos.
- Área administrativa já permite cadastrar/editar/bloquear cambistas, definir comissão individual, consultar vendas e acertos e registrar acerto somente pelo ADMIN. A comissão é armazenada por venda com taxa snapshot; o cálculo usa centavos inteiros.
- A venda anônima sem cadastro de cliente está alinhada à regra de produto para bilhetes vendidos por cambista.

### Lacunas concretas identificadas

1. `GET /api/admin/cashiers` usa `take: 500`, enquanto a tela trata o resultado como lista completa. Acima de 500 cambistas, o administrador não consegue listar/selecionar todos. A correção deve introduzir paginação real (com ordenação estável e total/cursor), sem simplesmente remover o limite e devolver quantidade ilimitada.
2. `src/app/admin/cashiers/[cashierId]/page.tsx` carrega todas as compras do cambista com `findMany`, sem limite ou paginação. O histórico cresce indefinidamente; implementar paginação antes de volume operacional relevante, preservando filtros/status e ordenação estável.
3. A leitura dos caminhos de teste junto às rotas de cambista e de acerto não encontrou testes colocados ao lado dessas rotas. Isso não prova ausência de cobertura em outros arquivos; localizar a cobertura efetiva e acrescentar testes de autorização, propriedade da compra, idempotência, comissão, reconciliação Pix e acerto concorrente antes de declarar a área homologada.
4. A área do cambista atualmente apresenta venda, resumo financeiro e últimos resultados; o histórico detalhado de vendas está na área ADMIN. Confirmar se o escopo de produto exige que o próprio cambista consulte o histórico detalhado, ou se o resumo atual é suficiente. Não criar uma nova tela sem fechar esse requisito.
5. O acerto usa bloqueio da linha do cambista e transação serializável, mas ainda precisa de teste PostgreSQL concorrente para provar que duas solicitações simultâneas não fecham o mesmo período nem duplicam valores.

### Próxima ação

- Antes de alterar o fluxo de venda, localizar a cobertura de testes existente e conferir o contrato do recibo para identificação obrigatória do ponto de venda.
- Planejar e implementar paginação no diretório de cambistas e no histórico administrativo, com testes de ordenação, navegação, ausência de duplicidade e acesso ADMIN.
- Definir se o cambista precisa de histórico detalhado próprio.
- Testar em PostgreSQL: duas vendas simultâneas com a mesma chave, vendas concorrentes com chaves distintas, comissão snapshot, Pix confirmado/pendente e dois acertos simultâneos.
- Não alterar regras de pagamento nesta etapa; a auditoria completa das rotas de pagamento continua reservada ao bloco correspondente.

Status do Bloco 2: **EM AUDITORIA — funcionalidades-base identificadas; paginação, cobertura de testes e requisito de histórico próprio ainda pendentes**. Nenhum teste foi executado nesta sessão. Nenhuma migration, alteração de banco, secret, deploy ou produção foi tocada.

### 8.1 Requisitos confirmados pelo usuário para a área do cambista (2026-11-04)

A área do CASHIER deve ser enxuta e conter somente o formulário da jogada, últimos resultados e financeiro. O histórico detalhado de jogos do cambista fica exclusivo da área ADMIN. O PLAYER, por sua vez, tem seu próprio histórico de jogos na área dele.

**Formulário da jogada — requisito funcional, ainda sujeito à aprovação visual do usuário**
- Um campo para digitar uma sequência de exatamente cinco algarismos.
- Ação explícita para adicionar cada número à mesma jogada; permitir vários números antes de finalizar.
- Seletor de repetições/rodadas consecutivas, de 1 a 10, com 1 pré-selecionada. O cambista não escolhe rodadas específicas.
- O formulário do PLAYER e do CASHIER deve ser visual e funcionalmente idêntico em todos os aspectos: mesma estrutura, ordem, campos, espaçamentos, componentes, textos e comportamento. Exceções de experiência fora do formulário: o CASHIER possui recibo impresso; o PLAYER possui histórico próprio e crédito automático de prêmio na carteira.
- A única diferença permitida é a opção de pagamento: PLAYER = Pix ou saldo da conta; CASHIER = Pix ou dinheiro.
- Não exibir dinheiro como opção para PLAYER nem saldo da conta como opção para CASHIER.
- Ação final para fechar/finalizar a jogada e registrar o pagamento.
- Manter validação de números, cálculo do total e idempotência. O recibo impresso é exclusivo do CASHIER e só pode ser emitido após confirmação/alocação. PLAYER não tem recibo impresso: acompanha a aposta no histórico próprio.
- Não acrescentar recursos extras à área sem necessidade ou aprovação.
- O formulário atual é compartilhado entre PLAYER e CASHIER. A regra aprovada é manter a mesma interface nos dois papéis, variando exclusivamente a segunda opção de pagamento: saldo da conta para PLAYER e dinheiro para CASHIER; Pix aparece para ambos. Não criar diferenças no formulário além da segunda forma de pagamento. As diferenças de recibo/histórico/carteira são regras próprias de cada papel, fora da apresentação do formulário.

**Financeiro — menu recolhível com seta**
Exibir cinco indicadores separados:
1. Valor total das vendas confirmadas.
2. Valor real acumulado da comissão em reais (não a taxa percentual).
3. Total de vendas em dinheiro.
4. Total de vendas em Pix confirmado.
5. Quantidade de jogos realizados.
Os valores devem refletir o período corrente desde o último acerto administrativo, conforme a regra financeira atual. Manter atualização automática.

**Últimos resultados — menu recolhível com seta**
- Mostrar somente resultados publicados nas últimas 24 horas.
- Resultados anteriores a essa janela deixam de aparecer na lista.

**Histórico de jogos**
- Não exibir histórico detalhado na área do cambista.
- O histórico completo fica disponível somente na área ADMIN.
- Se o cambista precisar consultar jogos anteriores, deverá solicitar ao administrador, que disponibilizará as informações.
- O cambista acompanha a quantidade de jogos realizados pelo indicador do Financeiro (ícone/contador), sem acesso à listagem detalhada.

### 8.2 Comparação com o código atual

- Formulário numérico existente: suporta vários números por compra (até 100), campo de cinco algarismos, botão atual “Adicionar”, remoção de números, valor por número, seletor de 1–10 repetições com 1 padrão, opções de pagamento Pix/dinheiro no modo CASHIER e Pix/saldo da conta no modo PLAYER (a equivalência visual integral entre os modos ainda precisa ser conferida). A finalização atual é “Registrar venda”. Portanto, a mecânica de múltiplos números já existe, mas a apresentação e a nomenclatura ainda não correspondem integralmente ao requisito aprovado.
- A opção “Gerar número” e a entrada separada de valor por número também estão presentes; confirmar se permanecem no desenho final, pois o usuário pediu uma interface simples e ainda vai aprovar o formulário.
- Financeiro: já é um menu `details` recolhível e mostra quatro cartões monetários (total, comissão em reais, dinheiro, Pix) e a quantidade de vendas/jogos em texto agregado. Precisa apresentar a quantidade de jogos como quinto indicador separado. O resumo atual considera somente vendas confirmadas e acumula desde o último acerto.
- Resultados: já são recolhíveis; a API filtra rodadas concluídas/publicadas com `resultAt` nas últimas 24 horas e a interface mostra até dez resultados.
- Histórico próprio: não será implementado na área do cambista por decisão explícita do usuário. O histórico detalhado permanece exclusivo do ADMIN; consultas solicitadas pelo cambista serão atendidas pelo administrador. O cambista acompanha apenas a quantidade pelo indicador do Financeiro.
- Não foram encontrados termos ou componentes de placas no formulário numérico atual consultado. Isso não substitui uma varredura global de histórico/artefatos e não autoriza reaproveitar código específico do sistema antigo.

Status: requisitos funcionais registrados; formulário existente identificado, mas desenho final ainda não aprovado; histórico próprio descartado por decisão do usuário; falta apenas confirmar/aprovar a apresentação visual do formulário e ajustar o indicador de quantidade no Financeiro, se necessário. Nenhuma alteração de código, banco ou interface foi feita neste subbloco.


### 8.3 Reordenação do trabalho e pontos de atenção — PLAYER antes de CASHIER e ADMIN (2026-11-04)

O usuário definiu a ordem de conclusão: primeiro PLAYER, depois CASHIER e somente então ADMIN. Não iniciar a auditoria extensa da área ADMIN antes de fechar as duas áreas menores.

Leitura inicial da implementação PLAYER:
- `src/app/player/page.tsx` já reúne formulário, carteira/saques, histórico próprio e resultados, todos em seções recolhíveis exceto o formulário.
- `src/app/api/player/history/route.ts` limita o histórico aos últimos sete dias, filtra por `playerId` da sessão e limita a 100 compras. O histórico exibe números, rodadas, estados de apuração e prêmio creditado.
- `src/modules/rounds/settle-numeric-round-prizes.ts` calcula o prêmio e cria lançamento `PRIZE_CREDIT` idempotente para compra de PLAYER (`playerId` presente e `cashierId` ausente), dentro da transação de liquidação da rodada. A implementação do crédito automático está presente; falta demonstrar por testes PostgreSQL/E2E que o fluxo completo é executado e o saldo atualizado é refletido na carteira.
- `src/app/api/player/withdrawals/route.ts` consulta o ledger para saldo disponível e permite solicitar saque integral mediante chave Pix; reserva o saldo transacionalmente e grava auditoria. A tela apresenta o histórico de saques.
- `src/app/api/player/results/route.ts` filtra sorteios concluídos publicados nas últimas 24 horas.

Divergência que precisa ser corrigida na área PLAYER:
- `src/components/player/player-bet-history.tsx` renderiza `PlayerPurchaseReceipt` para cada compra confirmada. O usuário definiu que PLAYER não tem recibo impresso; o recibo impresso é exclusivo de CASHIER. Remover a apresentação do recibo do histórico do jogador, preservando os dados da aposta no histórico.

Divergência que precisa ser corrigida no formulário compartilhado:
- `src/components/purchases/numeric-game-purchase-form.tsx` atualmente muda textos de identificação/título e texto do botão final conforme o papel, além da forma de pagamento. O requisito é que o formulário seja visualmente idêntico; somente a segunda forma de pagamento muda (PLAYER: saldo da conta; CASHIER: dinheiro), com Pix comum aos dois. Padronizar os elementos visuais e a nomenclatura do formulário, sem alterar as rotas/regras financeiras específicas de cada papel.

Próximas verificações PLAYER: examinar rotas/testes de histórico, carteira, crédito de prêmio e compras; verificar estados pendentes/confirmados, atualização do saldo após crédito e saque; conferir se não há recibo/QR de impressão no PLAYER; executar testes focados antes de declarar concluído. Em seguida, concluir CASHIER e só então iniciar ADMIN.

Esta seção registra auditoria estática inicial. Nenhum código ou banco foi alterado nesta etapa; não foram executados testes nem deploy.

## 9. Auditoria incremental — Bloco 3: entrada e estrutura da área ADMIN (2026-11-04)

**Escopo deste bloco:** somente a página principal administrativa, proteção de acesso à página e leitura inicial do painel de rodadas. Não equivale à auditoria das operações financeiras, saques, cambistas, prêmios ou rotas de pagamento.

### Estrutura identificada

- `src/app/admin/page.tsx` protege a página com `requireRole("ADMIN")`.
- A página apresenta seis seções recolhíveis: rodadas e sorteios; últimos resultados; prêmios e carteira digital; multiplicadores; controle financeiro e saques; cadastro e gestão de cambistas.
- A página reutiliza `PlayerRecentResults` dentro do ADMIN. Isso é compartilhamento de componente, não necessariamente compartilhamento de permissão: a API chamada pelo componente precisa ser conferida separadamente no bloco de resultados.
- O rodapé descreve a operação de rodadas e informa que a integração Pix está implementada, mas ainda depende de homologação ponta a ponta. A redação não deve ser interpretada como autorização para operação real.
- Não foi identificado nesta página texto, imagem ou nomenclatura explícita de placas/Joga Placas. Esta inspeção limitada não substitui a varredura global de identidade e arquivos históricos.

### Proteção de acesso observada

- `src/lib/auth/require-role.ts` exige sessão, bloqueia usuário com troca de senha inicial pendente e redireciona papéis diferentes para suas áreas.
- `GET /api/admin/rounds` repete a verificação de sessão, papel ADMIN e troca de senha pendente; responde 401/403 e usa `Cache-Control: no-store, private`.
- As rotas POST de fechar, sortear e apurar rodada validam origem/host, sessão, papel ADMIN, troca de senha e identificador da rodada. Tentativas com papel insuficiente geram evento de auditoria.
- Existe teste para `GET /api/admin/rounds` cobrindo ausência de sessão, papéis PLAYER/CASHIER e resposta sem cache. A existência de testes para as três operações POST deve ser avaliada individualmente no subbloco seguinte; não presumir cobertura completa a partir do teste GET.

### Achados e pendências deste bloco

1. **Limite fixo de 100 rodadas:** `GET /api/admin/rounds` usa `take: 100`, ordena da mais recente para a mais antiga e não oferece paginação nem informa total. A tela não informa que a lista é parcial. Em histórico superior a 100 rodadas, o ADMIN não consegue consultar todas por este painel. Classificação: melhoria funcional de prioridade média; implementar paginação/cursor estável quando o bloco de rodadas for revisado.
2. **Resumo de compras sem recorte temporal:** os contadores `pendingPayments` e `confirmedPurchases` contam todas as compras nos respectivos estados, sem período ou explicação de escopo. Confirmar se os números devem representar totais históricos ou operação corrente; se forem totais, explicitar o rótulo. Não alterar sem decisão de produto.
3. **Resultados compartilhados:** `PlayerRecentResults` é usado na página ADMIN. Verificar a rota de dados, permissões e limite temporal no bloco de resultados, para garantir que o compartilhamento do componente não exponha dados indevidos nem aplique um filtro inadequado.
4. **Ações manuais sensíveis:** a interface permite fechar, sortear e apurar manualmente, além do scheduler automático. O servidor revalida as condições e os serviços devem garantir idempotência; no próximo bloco revisar transações, estados, testes negativos e a relação entre ação manual e execução automática.
5. **Coerência da apresentação:** o texto introdutório menciona “dois resultados independentes” no histórico de auditoria, enquanto a implementação atual da tela de rodadas exibe `resultNumber` singular. Resolver a terminologia apenas após conferir schema, regras do produto e serviço de sorteio; não alterar a regra de sorteio por inferência.

### Decisão e próximo bloco

- A proteção de entrada da página ADMIN e a estrutura dos menus foram identificadas; não foi encontrada falha comprovada de autorização nesta leitura estática.
- A limitação de 100 rodadas e a semântica dos contadores ficam registradas para revisão específica.
- **Próximo bloco recomendado: “Rodadas e sorteios” — painel ADMIN + GET/POST das rotas close/draw/settle + serviços de domínio e testes correspondentes.** Manter o escopo restrito ao ciclo da rodada; não misturar saques, cadastro de cambistas ou pagamento Pix.
- Antes de marcar este bloco como concluído, executar testes focados e CI no commit correspondente. A inspeção estática não substitui execução.
- Nenhuma migration, alteração de banco, secret, deploy ou operação em produção foi realizada nesta etapa.


## 10. Auditoria incremental — Bloco 4: ciclo de rodadas e sorteios no ADMIN (2026-11-04)

**Escopo:** painel ADMIN de rodadas, rotas POST de fechamento/sorteio/apuração, serviços de domínio, integração com scheduler e testes relacionados. Não inclui saques, cadastro/acerto de cambistas ou revisão geral de pagamentos.

### Fluxo confirmado

- `src/components/admin/admin-round-manager.tsx` apresenta status da rodada, horários, participações, resultado oficial e ações manuais. A interface pede confirmação antes de fechar, sortear ou apurar e atualiza o painel após a operação.
- `close/route.ts`, `draw/route.ts` e `settle/route.ts` validam Origin/Host, sessão, papel ADMIN, troca obrigatória de senha e identificador. As respostas são `no-store`; tentativas de papel insuficiente são auditadas.
- As três rotas chamam os mesmos serviços de domínio utilizados pelo scheduler: `closeRound`, `drawRoundResults` e `settleNumericRoundPrizes`. Não foi identificada uma implementação paralela para a ação manual.
- `closeRound` bloqueia a linha da rodada, só aceita estados SCHEDULED/OPEN e usa o relógio do banco para impedir fechamento antes do cutoff. Repetir o fechamento de rodada já CLOSED é no-op idempotente, com evento de auditoria para ação manual.
- `drawRoundResults` bloqueia a rodada, exige status CLOSED e horário de resultado alcançado pelo relógio do banco. Gera um único resultado usando `node:crypto.randomInt(100000)`, convertido para string de cinco posições, preservando zeros à esquerda. Resultado já existente com rodada COMPLETED é devolvido sem novo sorteio; estado incompatível é bloqueado como inconsistência.
- `settleNumericRoundPrizes` bloqueia rodada e linhas elegíveis, exige resultado publicado, recalcula prêmio a partir do snapshot histórico e rejeita divergência. Créditos de PLAYER usam chave de idempotência `numeric-prize-credit:<lineId>` na mesma transação; compras de CASHIER ficam como pagamento manual pendente.
- O scheduler chama esses mesmos serviços em sequência: fecha rodadas vencidas, abre as programadas, sorteia rodadas fechadas no horário e tenta apurar rodadas concluídas sem auditoria de liquidação. Falhas são reportadas e as tarefas elegíveis podem ser retomadas na execução seguinte.
- `docs/PRODUCT_RULES.md` define um único número oficial de cinco algarismos por rodada. A tela/serviço atuais usam `resultNumber` singular; não alterar para dois resultados independentes.

### Achados e pendências

1. **Cobertura insuficiente dos serviços de domínio:** os testes das rotas validam autorização e mapeamento de respostas, mas mockam os serviços. Não há, neste bloco, testes PostgreSQL específicos demonstrando concorrência real no fechamento, sorteio único e liquidação/ledger. Prioridade alta antes de homologação financeira.
2. **Sorteio concorrente:** o bloqueio por linha e a transação impedem que duas chamadas válidas sorteiem a mesma rodada duas vezes. Ainda falta teste de integração com duas requisições simultâneas e verificação de um único resultado/evento de auditoria.
3. **Liquidação concorrente e rollback:** a chave única de idempotência e a transação serializável são proteções implementadas, mas faltam cenários PostgreSQL que comprovem um único crédito por linha, rollback sem crédito parcial e retentativa posterior.
4. **Falha de serialização no sorteio:** identificada diferença em relação aos serviços de fechamento e liquidação. Corrigida nesta sequência com retry limitado a três repetições para conflitos Prisma P2034/SQLSTATE 40001; cada tentativa relê a rodada bloqueada e, se outra transação já concluiu o sorteio, devolve o resultado persistido sem gerar outro número. A prova concorrente PostgreSQL continua pendente.
5. **UX de fechamento antecipado:** a interface mostra “Fechar apostas” tanto para SCHEDULED quanto OPEN, mesmo antes do cutoff. O servidor bloqueia corretamente com HTTP 409, portanto não é bypass de regra, mas a interface pode oferecer uma ação que será recusada. Ajustar a disponibilidade/estado do botão ou explicar que o fechamento só é possível no horário; incluir teste de interface.
6. **Lista de rodadas limitada:** permanece o achado do bloco 3: API retorna no máximo 100 rodadas, sem paginação/total, e a tela não sinaliza lista parcial. Tratar com paginação estável em subbloco próprio do painel.
7. **Contadores sem período:** os totais de compras aguardando pagamento e confirmadas continuam sem recorte temporal nem indicação de que são totais históricos. A decisão de produto sobre o período ainda está pendente.
8. **Formatação de horário:** painel usa fuso fixo UTC−03 (`Etc/GMT+3`), consistente com a regra atual do scheduler. Manter centralização dessa regra e testar fronteiras; não substituir por timezone inferido do dispositivo.
9. **Terminologia de legado:** os arquivos inspecionados neste bloco usam “rodada”, “resultado”, “aposta/participação” e “número”; não foi encontrado texto explícito de placas/Joga Placas no painel/rotas/serviços analisados. Isso não substitui a varredura global.

### Decisão

- Nenhuma falha de autorização ou duplicação de fluxo foi comprovada na leitura estática; não foi feita alteração de lógica de produção.
- O bloco fica **PARCIAL — fluxo manual/automático alinhado e proteções identificadas; validação de concorrência PostgreSQL e pequenos ajustes de UX/paginação pendentes**.
- Próxima ação recomendada: criar testes de integração PostgreSQL para fechamento concorrente, sorteio único, liquidação concorrente/rollback e retentativa; depois ajustar o botão de fechamento para não oferecer ação antes do cutoff e planejar paginação da lista de rodadas.
- O CI do commit anterior `9d9175bc` estava em execução durante esta inspeção; resultado ainda não confirmado neste registro. Nenhum teste foi executado nesta sessão.
- Nenhuma migration, alteração de banco, secret, deploy ou operação em produção foi realizada.


## 11. Continuação do Bloco 4 — retry de serialização no sorteio (2026-11-04)

- Arquivo corrigido: `src/modules/rounds/draw-round-results.ts`.
- O sorteio agora trata conflitos de serialização Prisma `P2034` e SQLSTATE `40001` com até três retries e espera incremental curta, seguindo o padrão já usado por fechamento e liquidação.
- Cada retry executa novamente a transação, bloqueia e relê a rodada. Se a primeira transação já concluiu o sorteio, a chamada concorrente retorna o mesmo `resultNumber` persistido; não cria novo resultado nem novo evento de sorteio.
- A alteração não muda a regra do jogo, o algoritmo aleatório, o formato de cinco dígitos, permissões, scheduler ou schema.
- **Validação pendente:** ainda não há teste de integração PostgreSQL do ciclo de rodadas no comando `test:postgres`. A próxima ação é implementar e executar testes reais de concorrência para sorteio e liquidação, incluindo crédito único e rollback. Não declarar o bloco concluído até CI comprovar.
- Nenhum banco de produção, secret, migration ou deploy foi alterado.


## 12. Continuação do Bloco 4 — integração PostgreSQL do ciclo de rodadas (2026-11-04)

- Criada a suíte `src/modules/rounds/round-lifecycle.postgres.integration.test.ts`, habilitada somente com `RUN_POSTGRES_INTEGRATION=1`.
- A suíte recusa conexão fora de uma base local chamada `superquina_test`, evitando execução acidental contra banco remoto/de produção.
- Cenários incluídos: duas solicitações simultâneas de sorteio retornam o mesmo resultado de cinco dígitos e produzem um único evento; duas liquidações simultâneas geram um único lançamento de prêmio e um único evento; snapshot inválido provoca rollback sem crédito parcial nem marcação da linha como paga.
- O script `npm run test:postgres` agora executa essa suíte junto com a integração existente de limite de tentativas de login.
- **Validação pendente:** o commit precisa passar no CI com migrations limpas e PostgreSQL 16. Se falhar, corrigir o teste ou serviço conforme a causa; não considerar o bloco concluído antes do resultado verde.
- Nenhuma alteração em banco de produção, secrets, migration ou deploy.


## 13. Auditoria incremental — Bloco 5: últimos resultados no ADMIN (2026-11-05)

**Escopo:** componente compartilhado de resultados recentes, rota `GET /api/player/results`, uso nas áreas PLAYER/CASHIER/ADMIN e testes de autorização. Não inclui histórico completo de apostas nem paginação do painel de rodadas.

### Fluxo e permissões confirmados

- `PlayerRecentResults` é utilizado nas três áreas autenticadas: jogador, cambista e administrador.
- A rota exige sessão válida e ativa; aceita somente papéis `PLAYER`, `CASHIER` e `ADMIN`; bloqueia qualquer usuário com troca obrigatória de senha pendente.
- A consulta retorna somente rodadas `COMPLETED`, com `resultNumber` não nulo e `resultAt` dentro das últimas 24 horas, ordenadas da mais recente para a mais antiga. A API limita a 50 registros; o componente exibe no máximo 10.
- A resposta usa `Cache-Control: no-store, private`; erros não expõem detalhes internos do banco.
- O resultado apresentado é o único número oficial de cinco algarismos da rodada, preservando zeros à esquerda. Não há dados de jogador, compra ou bilhete nesta resposta.
- A regra do produto confirma que os resultados visíveis ao cambista são os publicados nas últimas 24 horas; a mesma janela é aplicada pelo componente compartilhado nas demais áreas.

### Ajustes realizados

- Adicionado teste explícito de acesso ADMIN à rota de resultados recentes.
- Adicionado teste negativo para bloqueio quando `mustChangePassword` está ativo.
- Corrigida a descrição da operação no rodapé ADMIN: removida a referência incorreta a “dois resultados independentes” e adotada a expressão “resultado oficial”, coerente com o modelo singular `resultNumber` e as regras do produto.

### Pendências e decisão

- A rota tem cobertura de sessão ausente, acesso PLAYER/CASHIER/ADMIN, troca obrigatória de senha, filtro de 24 horas, ausência de cache e erro genérico de banco.
- A janela de 24 horas é calculada com `Date.now()` no servidor. Recomenda-se cobrir explicitamente o limite temporal com relógio controlado em uma revisão de testes de fronteira, sem alterar a regra.
- O texto da seção ADMIN informa 10 resultados mais recentes, enquanto a API aceita até 50 e a interface limita a 10; não há exposição adicional na UI. Manter o limite de apresentação em 10.
- Nenhuma alteração de schema, migration, banco, secrets, deploy ou produção foi realizada.

**Status:** revisão estática e ajustes de teste/texto realizados; aguarda CI verde no commit final para encerrar o bloco.


## 14. Auditoria incremental — Bloco 6: multiplicadores administráveis (2026-11-05)

**Escopo:** painel `AdminPrizeRules`, API `/api/admin/prize-rules`, persistência em `Setting`, histórico `SettingChange`, auditoria e captura das regras na criação de apostas. Sem alteração de valores comerciais padrão.

### Fluxo confirmado

- O painel ADMIN carrega a configuração com `cache: no-store`, permite editar cinco multiplicadores (unidade, dezena, centena/terno, milhar/quadra e quina) e envia atualização por `PUT`.
- A API exige sessão ativa, papel ADMIN e ausência de troca obrigatória de senha. O PUT também exige Origin/Host compatíveis, valida corpo estrito e aceita somente inteiros de 0 a 1.000.000.
- A configuração é salva na chave `numeric_prize_multipliers`. A mesma transação registra o valor anterior/novo em `SettingChange` e cria `AuditEvent` com ator e ação específica.
- Se não houver configuração salva, o sistema usa os multiplicadores padrão versionados no domínio.
- Na criação de cada compra, `createNumericPurchase` lê a configuração atual dentro da transação e salva uma cópia imutável em `NumericPurchaseIntent.ruleSnapshot`; quando a compra é alocada, o snapshot é copiado às linhas numéricas. A liquidação calcula o prêmio usando esse snapshot histórico, não a configuração atual.
- Configuração persistida inválida causa falha fechada na API e impede criar novas apostas com regra corrompida; não substitui silenciosamente por valores padrão.
- O cálculo paga somente a maior categoria correspondente. A alteração de multiplicadores não altera apostas anteriores nem prêmios já registrados.

### Ajustes de validação realizados

- Testes adicionados para bloquear ADMIN com troca de senha pendente.
- Teste adicionado para rejeitar PUT sem Origin.
- Teste adicionado para configuração persistida malformada, garantindo resposta 500 genérica.
- Teste de serviço adicionado para comprovar que uma aposta Pix pendente captura exatamente os multiplicadores personalizados atuais no snapshot.
- Cobertura existente já verifica defaults, validação estrita, bloqueio de origem cruzada, gravação transacional, histórico de alteração e evento de auditoria.

### Pontos de atenção

- O painel aceita zero como multiplicador. A API e o domínio também permitem zero; isso é comportamento configurável, não erro técnico. A decisão comercial sobre permitir desativar uma categoria por zero deve permanecer explícita.
- O limite de 1.000.000 por multiplicador é aplicado no painel, API e parser compartilhado. A compra também verifica se o prêmio máximo por linha cabe no inteiro suportado pelo banco.
- A concorrência entre duas edições simultâneas do ADMIN não tem controle de versão otimista; a última gravação vence. O histórico registra ambas, mas uma tela aberta em paralelo pode sobrescrever a edição mais recente. Recomenda-se avaliar versão/updatedAt como precondição numa melhoria futura, sem bloquear o uso atual.
- A alteração dos multiplicadores afeta compras criadas depois da gravação, inclusive intenções Pix pendentes criadas antes de pagamento. Isso decorre da captura no momento em que a intenção de compra é criada e precisa ser mantido como regra consistente.

**Status:** fluxo estático confirmado; testes focados acrescentados. Aguardar CI verde para encerrar formalmente o bloco. Nenhuma alteração de schema, migration, banco, secrets, deploy ou produção foi realizada.


## 15. Auditoria incremental — Bloco 7: controle financeiro e saques no ADMIN (2026-11-05)

**Escopo:** painel `AdminWithdrawalManager`, rotas `/api/admin/withdrawals` e `/api/player/withdrawals`, ledger, histórico de estado, criptografia de chave Pix e testes correspondentes. Não inclui reconciliação de prêmios nem acerto de comissões de cambistas.

### Fluxo confirmado

- A página ADMIN é protegida por `requireRole("ADMIN")`; a API administrativa exige sessão, papel ADMIN e ausência de troca obrigatória de senha. As respostas usam `Cache-Control: no-store, private`.
- A solicitação PLAYER exige papel PLAYER, sessão válida, senha inicial atualizada, Origin/Host compatíveis e chave Pix em formato plausível. A chave é criptografada com AES-256-GCM usando `WALLET_PIX_ENCRYPTION_KEY`; a auditoria guarda apenas chave mascarada.
- O jogador solicita o saque integral do saldo disponível. A rota bloqueia a linha do usuário, calcula o saldo pelo ledger e, na mesma transação serializável, cria o saque PENDING, lança `WITHDRAWAL_RESERVE` negativo, registra histórico e evento de auditoria.
- A carteira calcula o saldo disponível pela soma do ledger. A reserva reduz o saldo imediatamente; a recusa cria `WITHDRAWAL_RELEASE` positivo; a marcação de pagamento cria apenas registro auditável `WITHDRAWAL_PAID` de valor zero, pois o valor já foi reservado. Não há débito duplicado na conclusão.
- O ADMIN só pode agir sobre saque PENDING. A transação bloqueia a linha do saque, altera estado, cria lançamento/histórico e auditoria. A tentativa de segunda ação sobre estado encerrado é rejeitada com HTTP 409.
- A interface descreve corretamente que o Pix é transferido manualmente fora da plataforma; “marcar como pago” significa que o administrador confirmou a transferência, não que o sistema enviou dinheiro.
- Os estados APPROVED e PROCESSING permanecem no schema e na consulta histórica, mas a interface os identifica como estados antigos que exigem conferência; não são aceitos para nova ação administrativa.
- Comissão de cambista usa modelos separados (`CashierCommission` e `CashierSettlement`); não foi identificada mistura desses valores com o saldo de saque PLAYER na parte examinada.

### Achado funcional

1. **Solicitações pendentes fora do limite do histórico — CORRIGIDO:** o GET agora busca todas as solicitações PENDING separadamente, sem que estados antigos ou saques encerrados consumam o limite, e consulta os 200 registros históricos mais recentes numa segunda consulta. A ordenação histórica passou a ser cronológica decrescente. Teste de rota atualizado para exigir as duas consultas e confirmar o limite apenas no histórico.
2. **Histórico administrativo sem paginação:** o painel continua exibindo no máximo 200 registros encerrados, sem paginação nem indicação explícita de truncamento. Pendência funcional de prioridade média; não afeta a visibilidade das solicitações abertas após a correção.
3. **Confirmação de pagamento manual:** a API aceita referência externa opcional, mas o painel atual não oferece campo para registrá-la. O evento e a nota de auditoria registram confirmação manual; avaliar incluir a referência Pix/transferência para facilitar conciliação. Não é bloqueio de segurança.

### Cobertura observada e pendências

- Testes existentes cobrem autenticação ADMIN/PLAYER, bloqueio de origem cruzada, reserva integral do saldo, saldo zero, liberação após recusa, marcação de pagamento, histórico/auditoria e bloqueio de segunda ação.
- A suíte usa mocks; não foi encontrado neste bloco teste PostgreSQL concorrente que prove duas solicitações simultâneas de saque não reservam o mesmo saldo nem teste de corrida entre saque e crédito de prêmio.
- A transação serializável e o bloqueio da linha do usuário são proteções implementadas, mas o comportamento concorrente precisa ser comprovado em integração PostgreSQL.
- A consulta do saldo e a consulta dos saques na rota PLAYER são executadas em paralelo, não numa mesma transação de leitura. O saldo é calculado corretamente a partir do ledger, mas a resposta pode refletir instantes ligeiramente diferentes durante uma operação concorrente.
- Corrigidos `src/app/api/admin/withdrawals/route.ts` e `src/app/api/admin/withdrawals/route.test.ts` para separar solicitações abertas do histórico limitado. Teste focado atualizado; execução local e CI ainda precisam confirmar a alteração.
- Permanecem pendentes testes PostgreSQL concorrentes para saque simultâneo e corrida entre saque e crédito de prêmio, além da paginação do histórico encerrado.
- Nenhuma migration, alteração de banco, secret, deploy ou operação em produção foi realizada.

**Status:** auditoria estática e correção do limite de pendentes realizadas; testes focados/CI e testes de concorrência PostgreSQL ainda pendentes. Bloco permanece PARCIAL, não aprovado.


## 16. Auditoria incremental — Bloco 8: cadastro, financeiro e acertos de cambistas no ADMIN (2026-11-05)

**Escopo:** painel `AdminCashierManager`, cadastro/edição de cambistas, página financeira individual, API de acerto e modelos `CashierCommission`, `CashierSettlement` e `NumericPrizePayout`. Não inclui revisão completa do fluxo de vendas do CASHIER nem pagamento de prêmios do ADMIN.

### Fluxos confirmados

- A página ADMIN e a página financeira individual usam `requireRole("ADMIN")`. As APIs de listagem, criação, edição e acerto validam sessão, papel ADMIN e bloqueiam `mustChangePassword`.
- Cadastro cria usuário com papel CASHIER, status ACTIVE e `mustChangePassword: true`; senha é armazenada por hash. Username é normalizado para minúsculas; WhatsApp é armazenado apenas com dígitos; comissão aceita de 0% a 100%, com até duas casas decimais.
- Edição é restrita a registros com papel CASHIER, permite bloquear/ativar, redefinir senha e alterar comissão. Redefinição força troca no próximo acesso. Criação e edição registram evento de auditoria com valores anteriores/novos; senha/hash não é gravada na auditoria.
- A comissão é materializada em `CashierCommission` por compra, com taxa em basis points e valor em centavos, evitando recalcular vendas antigas pela taxa atual. A comissão não é misturada ao ledger/saldo de saque do PLAYER.
- A página financeira individual tem paginação de 25 vendas e 25 acertos. Exibe vendas confirmadas, pendentes, canceladas e estornadas, além de comissão, forma de pagamento, cliente, recibo e jogos.
- O acerto é protegido por Origin/Host, sessão ADMIN e transação serializável. Bloqueia a linha do cambista, determina o último acerto, fixa um cutoff pelo relógio do banco e calcula vendas confirmadas em dinheiro e Pix, comissão, jogos e prêmios em dinheiro pagos pelo cambista.
- O acerto grava um snapshot imutável em `CashierSettlement`, associa os pagamentos de prêmios em dinheiro ainda não vinculados ao snapshot e grava `CASHIER_SETTLEMENT_RECORDED`. O histórico anterior permanece disponível; não apaga vendas nem comissões.
- A interface explica que prêmios pagos em dinheiro pelo cambista são adiantamentos de recursos da plataforma e ficam discriminados para reposição de caixa, não sendo comissão nem despesa própria do cambista.

### Achados e pendências

1. **Listagem de cambistas limitada a 500:** `GET /api/admin/cashiers` usa `take: 500` sem paginação ou indicação de lista parcial. Com mais de 500 contas, o ADMIN não consegue localizar todos pelo seletor. Prioridade média; implementar paginação ou busca.
2. **Teste dedicado de rota criado — validação pendente:** criado `src/app/api/admin/cashiers/[cashierId]/settlements/route.test.ts`. A suíte cobre sessão ausente, papel incorreto, troca obrigatória de senha, Origin inválida, cambista inexistente, intervalo do último acerto até o cutoff do relógio do banco, agregados de dinheiro/Pix confirmado, comissão, jogos, prêmios ainda não associados, gravação do snapshot, associação dos payouts e resposta genérica em falha de persistência. O teste foi adicionado ao fluxo padrão `vitest run`; execução local/CI ainda não confirmada.
3. **Concorrência do acerto não comprovada em PostgreSQL:** bloqueio da linha do cambista e isolamento serializável estão implementados, mas ainda falta teste real com duas chamadas simultâneas para provar que não criam dois snapshots cobrindo o mesmo intervalo nem associam um mesmo prêmio a dois acertos.
4. **Vendas posteriores ao cutoff:** a consulta usa intervalo `confirmedAt > since AND confirmedAt <= cutoff`; prêmios pagos usam `paidAt` no mesmo intervalo e apenas payouts sem `settlementId`. Essa separação é coerente com o snapshot, mas precisa de teste de fronteira para garantir que operação concorrente após o cutoff permaneça no próximo acerto.
5. **Comissão histórica:** a taxa e o valor são persistidos por compra, então mudar a taxa do cambista não reescreve comissões antigas. Manter essa regra; não recalcular o passado com a taxa atual.
6. **Estados de venda:** a página lista compras não confirmadas e estornadas para histórico, mas elas não entram nos agregados de acerto, que filtram `status: CONFIRMED`; Pix exige também pagamento `CONFIRMED`. Isso evita tratar Pix pendente como venda recebida.
7. **Validação da taxa zero:** cadastro e edição permitem 0%. É comportamento explícito da validação; confirmar decisão comercial antes de restringir. Não alterar por inferência.
8. **Sem prova ponta a ponta de fechamento financeiro:** a revisão estática não confirma que cada forma de venda do CASHIER cria exatamente uma comissão e que os pagamentos Pix tardios são reconhecidos no intervalo correto. Exige teste integrado do ciclo de venda e acerto.

### Decisão

- Não foi identificada falha comprovada de autorização nem mistura do saldo de PLAYER com comissão de CASHIER nesta inspeção.
- A separação entre histórico de vendas, comissão materializada e snapshot de acerto está implementada.
- **Status: PARCIAL.** Teste unitário/de rota foi criado, mas aguarda execução no CI. Permanecem necessários teste de integração PostgreSQL para dois acertos concorrentes e fronteiras temporais reais; avaliar paginação da listagem de cambistas.
- Nenhuma alteração de código, schema, migration, banco, secret, deploy ou produção foi realizada neste bloco.

## 17. Correção de inventário do CI — 2026-11-05

A revisão da branch `main` corrigiu uma informação desatualizada que circulava em auditoria anterior:

- O workflow `.github/workflows/quality.yml` **já existe**. Executa em push e pull request direcionados à branch `main`.
- O workflow já instala com `npm ci`, valida e gera Prisma Client, executa TypeScript, testes unitários/rotas, lint, migrations em PostgreSQL 16 descartável, testes PostgreSQL e build.
- `package-lock.json` também existe; portanto, instalação reproduzível e `npm ci` estão configurados no repositório.
- Foi adicionado o gatilho `workflow_dispatch` para permitir execução manual pela interface do GitHub Actions.
- O script `test:postgres` inclui atualmente duas suítes: rate limit de login e ciclo de vida de rodadas (sorteio/liquidação concorrentes). Não se deve registrar que existe apenas uma suíte.

**Limitação atual:** não foi possível comprovar nesta auditoria uma execução CI concluída no HEAD atual. A existência do workflow e dos comandos não equivale a CI verde. O fluxo Pix ainda não tem teste PostgreSQL concorrente dedicado; os testes atuais de reconciliação são unitários com mocks. Permanecem necessários testes de corrida webhook × polling, notificação terminal × aprovação e indisponibilidade do provedor, além da execução real do pipeline no commit candidato.

**Status:** inventário e gatilho manual corrigidos; validação automática do HEAD e cobertura concorrente do Pix continuam pendentes. Nenhum deploy, migration ou operação de produção foi executado.
