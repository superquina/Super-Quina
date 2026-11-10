# Plano de auditoria e implementação — prêmios de bilhetes de cambista

**Objetivo:** preservar as decisões de produto e permitir uma auditoria objetiva do que já existe, do que foi corrigido e do que ainda falta. Este documento complementa `docs/PRODUCT_RULES.md`, que contém as regras normativas.

## 1. Decisões fechadas

1. A venda no ponto de cambista é anônima para o comprador. Não criar conta nem exigir nome, telefone ou cadastro do apostador.
2. O recibo contém somente dados da aposta/pagamento, código e QR Code de consulta e identificação do ponto de venda/cambista que vendeu.
3. A identificação do ponto deve vir do cambista autenticado que realizou a venda; não pode depender de texto livre.
4. Sorteio e apuração dos prêmios continuam automáticos pelo scheduler e pelo serviço central já existente.
5. Prêmio de compra vinculada a jogador/conta continua sendo creditado automaticamente na carteira, com idempotência.
6. Prêmio de bilhete vendido por cambista, sem jogador vinculado, não é creditado em carteira. O ganhador solicita o recebimento pelo WhatsApp oficial da plataforma.
7. Na consulta pública do QR Code, a apresentação é curta e visual:
   - `NÃO PREMIADO`
   - `PRÊMIO DISPONÍVEL` + botão WhatsApp
   - `PRÊMIO PAGO`
8. WhatsApp serve para contato; não confirma o prêmio nem registra pagamento.
9. A equipe confere o bilhete e o resultado na área ADMIN, paga o ganhador por Pix e só então registra a baixa no sistema.
10. A baixa precisa ser atômica, definitiva, auditada e idempotente por linha premiada. Um prêmio já baixado nunca pode voltar a aparecer como disponível nem ser pago novamente.
11. Após a baixa, a consulta pública do mesmo QR Code deve exibir imediatamente `PRÊMIO PAGO`.
12. Não criar uma segunda apuração, outro ledger de carteira, outra consulta pública ou outro worker. Ampliar os serviços, páginas e rotas atuais.

## 2. Auditoria inicial — evidências encontradas na branch main

| Área | Evidência atual | Situação |
|---|---|---|
| Recibo | `src/components/receipts/thermal-receipt.tsx` aceita `customerLabel` opcional e `cashierLabel`; imprime Cambista quando informado | Parcial: confirmar origem do label e se é o nome/identificação do ponto |
| QR Code do recibo | `src/components/receipts/receipt-qr.ts` gera imagem local com `qrcode-generator` | Implementado; sem serviço remoto |
| Consulta pública | Página `src/app/verificar-recibo/[receiptCode]/page.tsx`; API `src/app/api/public/receipt-verification/[receiptCode]/route.ts` | Existe; API calcula prêmio, mas `prizePaid` usa somente `prizeCreditedAt`, que não representa Pix externo de cambista |
| Outra consulta | API `src/app/api/public/ticket-check/route.ts` | Existe e tem regra própria de validade de 7 dias; `PREMIADA` também depende de `prizeCreditedAt`. Comparar chamadas e finalidade antes de alterar, evitando dois estados públicos divergentes |
| Apuração | `src/modules/rounds/settle-numeric-round-prizes.ts` | Automática para jogador; prêmio sem jogador ou com venda de cambista incrementa `pendingManualPayouts` |
| Scheduler | `src/app/api/internal/round-scheduler/route.ts` | Já chama o serviço central de apuração após o sorteio |
| Reconciliação ADMIN | `src/app/api/admin/prize-credit-reconciliation/route.ts` e componente correspondente | É apenas para corrigir crédito de carteira de jogador; não atende prêmio de cambista |
| Modelo de dados | `NumericParticipationLine` tem `prizeCents` e `prizeCreditedAt`, sem estado/data/ator de pagamento manual | Falta persistir a baixa externa do prêmio de cambista |
| Recibo / ponto | O componente imprime `Cambista: {cashierLabel}`; a API pública deriva o label de `cashier.fullName` ou `username` | Não há evidência de que isso seja um identificador próprio do ponto de venda; confirmar regra e origem. A API pública também expõe esse label, sem necessidade de dados pessoais do comprador |

**Importante:** auditoria estática parcial. A existência de páginas e arquivos não prova que o fluxo completo esteja funcional. Não marcar item como concluído sem ler API, página, componentes chamadores, origem dos dados e testes.

## 3. Passo a passo de implementação

### Etapa A — fechar o diagnóstico antes de editar
- [ ] Ler integralmente página de consulta do recibo, API `receipt-verification`, API `ticket-check` e testes.
- [ ] Rastrear de onde vem `cashierLabel` no momento de montar o recibo. Confirmar se é identificação do ponto (nome/código do ponto) e se deriva de `Purchase.cashierId` / conta autenticada.
- [ ] Ler criação de compra do cambista, schema de `Purchase`, modelos `User` e `Customer`; confirmar que a venda anônima não cria cliente implicitamente.
- [ ] Identificar configuração existente do WhatsApp oficial (setting/env/configuração). Se não existir, definir uma única configuração administrável; não espalhar número em componentes.
- [ ] Rastrear todos os usos de `pendingManualPayouts`, ações manuais de apuração e APIs de prêmio para separar pagamento externo de crédito em carteira.
- [ ] Corrigir a semântica pública: `prizeCreditedAt` significa crédito em carteira, não Pix externo. A API de recibo hoje devolve `prizePaid` a partir desse campo; a API `ticket-check` usa o mesmo campo para classificar `PREMIADA`. Ambas precisam ler o estado específico de baixa externa quando o bilhete for de cambista.
- [ ] Mapear chamadas da área ADMIN e permissões. Não remover ferramentas de auditoria/reconciliação de jogador que tenham finalidade válida.

### Etapa B — modelar a baixa de prêmio externo
- [ ] Definir estado explícito de pagamento externo para cada `NumericParticipationLine` premiada de compra de cambista, distinguindo pelo menos disponível e pago.
- [ ] Persistir data/hora, ADMIN responsável e referência/observação do Pix quando disponível. Não armazenar dados bancários sensíveis desnecessários.
- [ ] Criar migration aditiva, com índice/constraint que impeça duas baixas para a mesma linha. Não reescrever migrations já existentes.
- [ ] Não usar `prizeCreditedAt` para representar Pix externo: esse campo significa crédito no ledger/carteira e deve continuar com o significado atual.
- [ ] Fazer a operação em transação com lock da linha e verificação de elegibilidade: compra CONFIRMED, participação CONFIRMED, rodada COMPLETED, prêmio calculado positivo, compra vinculada a cashier e sem jogador beneficiário.
- [ ] Se já estiver pago, retornar conflito/estado já pago sem nova baixa. Duas requisições concorrentes devem resultar em uma única baixa.
- [ ] Gravar evento de auditoria com ator, linha, compra, participação, rodada, valor, timestamp e referência informada.

### Etapa C — consulta pública e WhatsApp
- [ ] Estender a consulta pública existente; não criar endpoint paralelo.
- [ ] Calcular/ler o estado de pagamento a partir do registro persistido e devolver estado consistente por linha premiada.
- [ ] Bilhete sem prêmio: mostrar `NÃO PREMIADO`.
- [ ] Prêmio de cambista ainda não pago: mostrar `PRÊMIO DISPONÍVEL` e botão WhatsApp oficial, com mensagem pré-preenchida contendo somente código do recibo/bilhete ou identificador público seguro.
- [ ] Prêmio já pago: mostrar `PRÊMIO PAGO`; não exibir botão de solicitação.
- [ ] Para jogador com carteira, manter o comportamento de crédito existente; não mostrar WhatsApp como substituto do crédito.
- [ ] Interface curta, visual, responsiva e sem parágrafos longos. Não expor nome, telefone ou dados pessoais do comprador anônimo.

### Etapa D — área ADMIN
- [ ] Criar seção/ação clara para localizar prêmio pendente de bilhete de cambista pelo código do recibo/bilhete.
- [ ] Exibir dados para conferência: número apostado, rodada, resultado, categoria/valor do prêmio, código do recibo e ponto de venda.
- [ ] O ADMIN confere o bilhete e efetua o Pix fora do sistema.
- [ ] Só depois do Pix realizado, o ADMIN clica em `Registrar prêmio pago` (rótulo sugerido) e confirma a ação.
- [ ] A ação não deve transferir dinheiro nem criar crédito de carteira; apenas registrar que o pagamento externo foi feito.
- [ ] Atualizar imediatamente a listagem ADMIN e o resultado público para `PRÊMIO PAGO`.
- [ ] Manter consulta e auditoria de pagamentos anteriores. Não permitir reabrir/rebaixar um prêmio pago por operação comum.

### Etapa E — testes obrigatórios
- [ ] Venda de cambista sem conta/cliente e recibo sem dados pessoais.
- [ ] Recibo sempre identifica o ponto de venda correto; não pode ser falsificado por payload do cliente.
- [ ] Venda de jogador mantém recibo e crédito de carteira atuais.
- [ ] Prêmio de cambista aparece como disponível e com WhatsApp.
- [ ] WhatsApp não altera status nem baixa prêmio.
- [ ] Baixa ADMIN após Pix grava ator, horário, valor e referência.
- [ ] Consulta QR antes da baixa mostra disponível; depois mostra pago.
- [ ] Repetir a baixa retorna já pago e não cria segunda auditoria de baixa nem pagamento.
- [ ] Duas baixas concorrentes resultam em uma única baixa.
- [ ] ADMIN sem permissão, jogador e cambista não conseguem registrar baixa.
- [ ] Tentativa de baixar linha sem prêmio, não confirmada ou de jogador é recusada.
- [ ] Falha de banco durante a transação não deixa estado parcialmente pago.
- [ ] Apuração automática e crédito de carteira não sofrem regressão.
- [ ] Testar múltiplas linhas premiadas no mesmo recibo: baixa individual por prêmio/linha.

### Etapa F — validação e encerramento
- [ ] Executar Prisma validate/generate, typecheck, testes, lint, migrations em PostgreSQL descartável e build.
- [ ] Fazer revisão de concorrência, autorização, CSRF/origin, idempotência e exposição pública de dados.
- [ ] Atualizar este documento com arquivos/commits implementados e resultado de cada teste.
- [ ] Atualizar `docs/PRODUCT_RULES.md` somente se alguma regra de produto mudar.
- [ ] Não fazer deploy nem tocar em produção, banco real, DNS ou secrets sem autorização explícita.

## 4. Critérios de aceite final

- Comprador de cambista permanece anônimo; recibo identifica o ponto de venda.
- A apuração é automática e única.
- Prêmio de cambista não vira crédito de carteira; contato é pelo WhatsApp.
- ADMIN registra somente a baixa após Pix externo efetivo.
- A baixa é única, auditável e não reversível pela operação normal.
- QR Code passa a mostrar `PRÊMIO PAGO` após a baixa.
- Não há rotas, workers ou motores duplicados.
- Todos os testes acima passam e o CI é confirmado.

## 5. Histórico de execução

- 2026-11-03: regras de prêmio de cambista e baixa pós-Pix documentadas em `docs/PRODUCT_RULES.md`.
- 2026-11-03: este plano criado como roteiro de auditoria e implementação. Nenhuma alteração de código, schema, migration ou interface foi realizada nesta etapa.
- Auditoria ampliada: a API pública de verificação calcula o prêmio no retorno e marca `prizePaid` apenas com `prizeCreditedAt`; a API `ticket-check` também usa `prizeCreditedAt` para estado premiado e aplica validade pública de 7 dias. A API de recibo mostra `cashier.fullName` ou `username` como `cashierLabel`; isso ainda não comprova identificação correta do ponto de venda.


## 6. Decisão adicional — pagamento presencial em dinheiro pelo cambista

A regra original de pagamento exclusivamente pela plataforma foi ampliada. Para bilhetes de cambista, o ganhador escolhe livremente entre os dois canais abaixo:

1. **Pix da plataforma:** contato pelo WhatsApp oficial; a equipe confere o recibo e a apuração, realiza o Pix externamente e só depois um ADMIN registra a baixa.
2. **Dinheiro no ponto de venda:** o ganhador entrega o recibo físico ao cambista, que confere o bilhete, retém o recibo como comprovante e entrega o dinheiro em mãos. Só depois da entrega efetiva, o cambista autenticado registra a baixa no painel.

Regras obrigatórias do canal presencial:

- O cambista só pode registrar pagamento em dinheiro para prêmio de bilhete vendido pelo próprio `cashierId`.
- O cambista não pode pagar por Pix, iniciar transferência Pix ou ter campo/ação de Pix para prêmio.
- A ação do painel deve ser identificada como **Registrar prêmio pago em dinheiro** e representar apenas a declaração de que o dinheiro já foi entregue.
- A baixa ADMIN por Pix e a baixa CASHIER em dinheiro compartilham o mesmo registro persistido por linha premiada. A restrição única e a transação/lock garantem que somente o primeiro canal válido conclua; o outro recebe conflito de prêmio já pago.
- A consulta QR exibe **PRÊMIO PAGO** e identifica a origem como plataforma (Pix) ou ponto de venda (dinheiro), sem revelar dados pessoais. Depois da baixa, nenhuma opção de pagamento permanece visível.
- A auditoria registra canal, ator, cambista/ponto quando aplicável, data/hora, recibo, compra, participação/linha, rodada, valor e referência/observação opcional.
- O valor pago em dinheiro pelo cambista é adiantamento de caixa da plataforma devido ao cambista. Não é comissão, venda nem despesa própria do cambista.
- O financeiro do cambista ganha um sexto indicador: quantidade e total em reais de **Prêmios pagos pelo cambista**, acumulados desde o último acerto.
- O acerto ADMIN apresenta o detalhamento dos prêmios pagos em dinheiro e seus totais para conferência dos recibos físicos e reposição/compensação do caixa do cambista. O registro individual permanece no histórico após o acerto; o corte do período é transacional para não contar duas vezes nem omitir pagamento.
- O pagamento em dinheiro não gera crédito de carteira, comissão ou transferência automática. Só é registrado após a entrega física do dinheiro.

## 7. Escopo técnico revisado

- Criar um único modelo/registro de baixa externa por `NumericParticipationLine`, com canal `PLATFORM_PIX` ou `CASHIER_CASH`, ator, cambista opcional, valor e data/hora. Manter `prizeCreditedAt` exclusivamente para crédito em carteira.
- Implementar as duas ações de baixa sobre o mesmo serviço transacional e a mesma restrição de unicidade.
- Estender as APIs públicas existentes de consulta do recibo e ticket; não criar consulta paralela.
- Adicionar a ação de dinheiro no painel do cambista e a ação Pix já prevista no ADMIN, com autorização por papel e propriedade do bilhete.
- Estender resumo financeiro e acerto ADMIN com quantidade/valor de prêmios pagos em dinheiro, detalhamento e vínculo de corte/auditoria.
- O cálculo de saldo líquido do acerto deve respeitar a regra contábil já existente do produto. Até essa fórmula ser verificada no código e formalmente documentada, apresentar o adiantamento como linha separada de crédito/reembolso devido ao cambista; não inventar um desconto líquido silencioso.

## 8. Casos de teste adicionais obrigatórios

- Cambista A não consegue pagar bilhete de cambista B.
- Cambista não consegue registrar Pix nem acessar qualquer ação/campo de Pix para prêmio.
- O canal CASHIER_CASH só aceita prêmio positivo de compra confirmada, participação confirmada e rodada concluída.
- O recibo físico é retido pelo procedimento operacional; o sistema registra ator e horário após a entrega em dinheiro.
- ADMIN Pix e CASHIER cash concorrentes para a mesma linha geram uma única baixa; o perdedor recebe estado já pago.
- Pagamento em dinheiro atualiza QR e sexto indicador; pagamento Pix não aparece no indicador de dinheiro do cambista.
- Um recibo com várias linhas premiadas permite baixa individual sem duplicidade.
- Acerto ADMIN inclui cada baixa em dinheiro uma única vez no período e preserva detalhes e histórico após o corte.
- Requisição concorrente de baixa durante o acerto não pode ser omitida nem aparecer em dois períodos.
- A liquidação não altera comissão, vendas, carteira do jogador nem saldo de prêmio já calculado.
