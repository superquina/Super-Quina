# Regras de produto — Super Quina

Este documento é a fonte de referência das regras comerciais e da terminologia do jogo. Deve ser atualizado junto com as implementações e servirá de base para o futuro manual técnico.


## 0. Estrutura do site e navegação — decisão de produto

- O site possui quatro áreas principais distintas: (1) página pública de apresentação/início; (2) área do jogador; (3) área do cambista; e (4) área do administrador. A página de apresentação é a entrada pública padrão do domínio e não substitui nem absorve as três áreas autenticadas.
- Ao acessar o domínio pela raiz `/`, a pessoa deve chegar à página pública de apresentação do Super Quina, com explicação clara de como funciona e caminhos para entrar ou criar conta. Não encaminhar automaticamente visitantes não autenticados para o login, salvo quando tentarem acessar uma área protegida.
- As áreas de jogador, cambista e administrador continuam separadas, com permissões e funcionalidades próprias. O trabalho em uma delas não elimina nem substitui as outras.
- Termos de uso e verificação de recibo são páginas públicas complementares, não novas áreas principais de operação. Os caminhos existentes `/termos-de-uso` e `/verificar-recibo/[receiptCode]` devem ser mantidos e integrados à navegação pública.
- QR Code de pagamento Pix e recibo oficial devem ser apresentados no próprio fluxo/tela em que a pessoa iniciou a compra ou venda, sem redirecionamento desnecessário para uma nova página. O QR Pix deve permanecer junto do estado da cobrança e da confirmação; após pagamento confirmado e alocação concluída, o recibo deve aparecer na mesma tela, substituindo ou sucedendo o QR conforme o estado.
- A exigência de manter o fluxo na mesma tela não elimina a página pública própria de verificação do recibo: quando alguém escanear o QR impresso do recibo, deve abrir a rota pública existente de verificação daquele recibo.
- Não criar novas rotas ou páginas para duplicar telas/funcionalidades já existentes. Antes de qualquer alteração de navegação, conferir os caminhos atuais e preservar o fluxo em andamento.

## 1. Conceitos oficiais

- **Jogo** e **jogada** são sinônimos: representam uma compra completa formada pela escolha de um conjunto de números e sua contratação/pagamento.
- **Número** é uma sequência individual de exatamente cinco algarismos, de `00000` a `99999`. Zeros à esquerda são significativos.
- Um jogo pode conter um ou vários números de cinco algarismos, respeitando os limites técnicos da aplicação.
- **Repetições** representam quantas vezes o jogo completo será realizado em rodadas consecutivas/próximas rodadas válidas. O jogador escolhe de 1 a 10 repetições.
- Em cada repetição, todos os números do jogo são mantidos. Exemplo: um jogo com cinco números e dez repetições gera dez participações em rodadas distintas, cada uma contendo os mesmos cinco números.
- **Rodada** é o evento de sorteio ao qual uma repetição é vinculada. A seleção das rodadas é automática pelo sistema; o jogador e o cambista não escolhem rodadas.
- O sistema mantém uma fila móvel de **48 rodadas futuras**, com sorteios de 30 em 30 minutos, cobrindo as próximas 24 horas. A cada execução do scheduler, horários ausentes são repostos para preservar essa janela.
- **Categorias de premiação** são unidade, dezena, centena, milhar e quina. Elas não são números nem jogos.

## 2. Cálculo do valor

O total da compra é:

`valor por número em cada rodada × quantidade de números × quantidade de repetições`

A aposta mínima é de R$ 1,00 por número em cada rodada. Esse valor concorre simultaneamente às cinco categorias: unidade, dezena, centena, milhar e quina. O valor em centavos é rateado igualmente entre as cinco categorias; eventual sobra de centavos é acrescentada à unidade. Exemplo: R$ 1,00 resulta em 20 centavos para cada categoria. A alocação é registrada separadamente por categoria para calcular o prêmio correspondente.

## 3. Pagamento e vínculo com rodadas

- O fluxo aceita vendas de jogadores e cambistas durante a transição entre fechamento, sorteio e abertura de rodadas. O fechamento de uma rodada não bloqueia vendas globalmente: cada compra usa as próximas 1 a 10 rodadas futuras válidas da fila de 48 rodadas.
- A ausência momentânea de uma rodada com status `OPEN` não deve, por si só, bloquear uma venda.
- No fluxo Pix, a compra fica como intenção pendente e não recebe vínculo definitivo com rodadas antes da confirmação autêntica do pagamento.
- Após a confirmação do Pix, o sistema deve atribuir automaticamente as repetições às próximas rodadas válidas. Se ainda não houver uma sequência completa ou ocorrer uma falha transitória, o pagamento permanece pendente de conclusão da alocação e o scheduler consulta novamente o Mercado Pago e tenta vincular as rodadas em execuções subsequentes, até concluir. A confirmação externa do Pix não pode ser perdida só porque a alocação falhou na primeira tentativa.
- Para dinheiro e saldo da carteira, o recebimento/débito é registrado mesmo que o agendador esteja momentaneamente entre rodadas. A compra permanece em estado pendente de alocação, com a intenção numérica persistida. O agendador tenta vinculá-la automaticamente em cada execução (configurado para rodar a cada minuto) e repete a tentativa enquanto a compra continuar pendente, até conseguir vincular todas as repetições. Falta de rodadas, indisponibilidade temporária do banco ou erro técnico não pode descartar a intenção nem encerrar definitivamente as tentativas. O débito da carteira e a comissão do cambista não podem ser repetidos durante a retentativa. Para proteger a duração de cada execução, o worker processa no máximo 100 compras por chamada, em lotes de até 50, e persiste um cursor na tabela `Setting`. O cursor avança mesmo quando uma compra falha e retorna ao início ao alcançar o fim da fila, permitindo que compras posteriores avancem e que falhas anteriores sejam tentadas novamente nas próximas execuções.
- O recibo oficial só pode ser emitido depois que o pagamento estiver confirmado e todas as repetições estiverem vinculadas às rodadas correspondentes.
- Se ocorrer falha técnica depois de o pagamento ter sido recebido, a compra deve permanecer registrada para tratamento administrativo auditável. Não se deve cancelar a aposta paga nem gerar reembolso automático. O recibo oficial só é criado depois da alocação completa; enquanto isso, a interface informa que o valor foi recebido e que a alocação está em processamento.


### 3.1 Confirmação definitiva do Pix — decisão obrigatória

- Notificações intermediárias do webhook do Mercado Pago são apenas sinais para iniciar/verificar a reconciliação. Elas não podem, isoladamente, efetivar nem cancelar uma compra.
- A compra só pode avançar para um estado financeiro final quando o sistema consultar o pagamento diretamente na API do Mercado Pago e validar o estado atual retornado pelo provedor, além de conferir identificação/referência, valor e moeda esperados.
- A decisão deve considerar o estado canônico atual do pagamento no provedor, não simplesmente a mensagem mais recente que chegou ao servidor: webhooks podem ser repetidos, atrasados ou entregues fora de ordem.
- Enquanto a API retornar estado pendente, não conclusivo, indisponível ou divergente, a compra permanece sem confirmação final e não pode gerar participações nem recibo oficial. A reconciliação deve tentar novamente de forma segura.
- Webhook e consulta periódica/direta são mecanismos complementares de detecção e recuperação, não dois fluxos independentes de aprovação. Ambos devem convergir para um único serviço central de confirmação e uma única máquina de estados do pagamento.
- A transição final precisa ser transacional e idempotente. Reentrega de webhook, consulta repetida, concorrência ou reinício não podem duplicar cobrança, participações, recibo, comissão ou crédito.
- Estados finais aceitos, transições permitidas e tratamento de rejeição/cancelamento/expiração devem ser mapeados explicitamente a partir dos estados oficiais do Mercado Pago durante a implementação. O Super-Quina não oferece nem executa fluxo interno de estorno. Uma notificação externa de reembolso/chargeback serve somente para registro informativo e conciliação financeira: nunca cancela compra já confirmada, nunca desfaz participações já alocadas e nunca reverte prêmios ou comissões. A alocação continua sendo obrigatória após a confirmação autêntica do pagamento; pagamento não confirmado pelo provedor não pode gerar aposta.
- Antes de implementar ou importar qualquer mecanismo, auditar os serviços, rotas, webhooks, scheduler e estados já existentes. Se já houver uma função equivalente, corrigir ou ampliar a implementação atual; não criar uma segunda rota, worker, máquina de estados ou mecanismo paralelo para a mesma responsabilidade.


## 4.0 Experiência e histórico do jogador

- A área do jogador oferece o formulário de jogo, resultados recentes, histórico próprio de apostas e carteira digital em seções recolhíveis.
- O histórico do jogador consulta somente compras vinculadas à conta autenticada e apresenta números, rodadas, resultados e prêmios. A implementação atual limita a consulta aos últimos 7 dias e às 100 compras mais recentes.
- O jogador não recebe nem imprime recibo oficial. O recibo imprimível é reservado às vendas realizadas por cambistas e às consultas administrativas autorizadas.
- Os métodos de pagamento do jogador são Pix e saldo da própria carteira. Dinheiro é exclusivo do fluxo de cambista.
- Alterações no saldo causadas por compras com carteira ou solicitações de saque devem refletir nos componentes de jogo e carteira sem exigir recarga manual da página.

## 4.1 Prêmios de bilhetes vendidos por cambistas — decisão de produto

- A venda feita pelo cambista é anônima para o comprador: não exige cadastro de jogador nem coleta de nome, telefone ou identificação pessoal. O recibo contém os dados da aposta, pagamento, código/QR de consulta e identificação do ponto de venda/cambista responsável.
- A identificação do ponto de venda é obrigatória no recibo e deve vir do vínculo autenticado do cambista que registrou a venda; não pode ser digitada livremente nem omitida.
- A apuração do sorteio continua automática e única. Para compras de jogador vinculadas a uma conta, o prêmio segue o crédito automático na carteira, com idempotência.
- Para bilhetes vendidos por cambista sem conta de jogador, o prêmio não é creditado automaticamente em carteira. O ganhador consulta o bilhete pelo QR Code e, se premiado e ainda não pago, vê somente um destaque visual curto com botão de contato pelo WhatsApp oficial da plataforma. O contato deve estar associado ao prêmio disponível; evitar textos longos e não expor dados pessoais.
- O ganhador escolhe livremente entre dois canais: (a) contato com a plataforma pelo WhatsApp oficial para receber Pix feito pela equipe; ou (b) pagamento presencial em dinheiro no próprio ponto de venda pelo cambista responsável.
- No canal WhatsApp, a equipe confere o bilhete e o resultado na área administrativa, realiza o Pix fora do sistema e somente depois um ADMIN registra a baixa. O contato pelo WhatsApp, por si só, não altera o estado do prêmio.
- No canal presencial, o ganhador entrega o recibo físico ao cambista. O cambista confere o bilhete, retém o recibo como comprovante, entrega o dinheiro em mãos e somente depois registra **Registrar prêmio pago em dinheiro** no painel autenticado.
- Cambista só pode pagar em dinheiro prêmio de bilhete vendido pelo próprio ponto/vínculo `cashierId`. Cambista nunca paga prêmio por Pix e não pode existir campo, botão ou capacidade de transferência Pix no painel do cambista para essa finalidade.
- Os dois canais usam a mesma baixa persistida por linha premiada. ADMIN Pix e CASHIER dinheiro são mutuamente exclusivos: a primeira transação válida conclui a linha; a outra recebe conflito de prêmio já pago. Cada baixa registra canal, ator, cambista/ponto quando aplicável, data/hora, recibo, compra, participação/linha, rodada, valor e referência/observação opcional.
- A baixa é definitiva e atômica: cada linha premiada de bilhete de cambista só pode ser marcada como paga uma vez. Repetições, concorrência ou reenvio não podem gerar pagamento duplicado.
- A consulta pública do QR Code deve refletir imediatamente o estado: NÃO PREMIADO, PRÊMIO DISPONÍVEL (com as duas opções de recebimento) ou PRÊMIO PAGO, identificando se foi pago pela plataforma (Pix) ou no ponto (dinheiro), sem expor dados pessoais. Depois da baixa, não mostrar opções de pagamento.
- Pagamento manual externo não é crédito de carteira nem altera a apuração. O pagamento em dinheiro é adiantamento de caixa da plataforma devido ao cambista, não é comissão, venda ou despesa própria do cambista.
- Antes de implementar, auditar consulta pública, recibo, configuração do WhatsApp, modelo de prêmio, permissões ADMIN e reconciliação atual. Estender o que já existe; não criar segunda apuração, segundo ledger de carteira ou rota paralela de consulta.

### 4.2 Saques da carteira do jogador

- O jogador pode solicitar saque somente do saldo total disponível. Não informa nem escolhe um valor parcial.
- Ao solicitar, o sistema reserva integralmente o saldo disponível por meio de lançamento negativo no ledger. A solicitação, a reserva, o histórico de estado e a auditoria devem ser gravados na mesma transação.
- A chave Pix é armazenada criptografada. A área do administrador pode consultá-la para realizar o pagamento; a área do jogador não recebe a chave armazenada nem dados internos da auditoria.
- O administrador confere a chave e realiza a transferência Pix manualmente, fora da plataforma. Somente depois de realizar e conferir a transferência, clica em **Aprovar e concluir**. Essa única ação marca o saque como `PAID`, registra a baixa/auditoria e encerra definitivamente a solicitação. Não existe etapa posterior de aprovação, processamento ou confirmação do pagamento.
- A aprovação não apaga nem altera lançamentos anteriores do ledger: a reserva negativa permanece como registro contábil, e um lançamento de valor zero registra a liquidação externa. O saldo já foi debitado da disponibilidade quando reservado.
- Se a chave Pix estiver inválida ou houver outro motivo para não pagar, o administrador informa obrigatoriamente o motivo e clica em **Recusar e devolver saldo**. Na mesma transação, a solicitação passa para `REJECTED`, o valor integral reservado é creditado de volta ao ledger e o motivo fica no histórico e na auditoria.
- O jogador visualiza o motivo da recusa e pode fazer uma nova solicitação com a chave Pix corrigida.
- Aprovação e recusa só são permitidas enquanto a solicitação estiver `PENDING`. Bloqueio da linha, transação serializável e restrições de idempotência impedem dupla conclusão ou dupla devolução por concorrência/reenvio.
- O sistema não envia Pix automaticamente. O clique de aprovação representa a declaração do administrador de que a transferência externa já foi realizada e conferida.


## 4.3 Experiência e financeiro do cambista

- A área do cambista mantém a operação enxuta: formulário de venda, resultados recentes recolhidos e resumo financeiro recolhido. Não oferece histórico detalhado de apostas; consultas históricas são feitas pelo administrador.
- O formulário de venda é compartilhado com o jogador e mantém a mesma estrutura, ordem, campos e comportamento. A única diferença interna é o segundo meio de pagamento: saldo da carteira para jogador e dinheiro para cambista; Pix está disponível para ambos.
- O resumo financeiro apresenta seis indicadores separados: valor total das vendas confirmadas, comissão acumulada em reais, vendas em dinheiro, vendas em Pix, quantidade de jogos realizados e **prêmios pagos pelo cambista** (quantidade e total em reais).
- O indicador de prêmios pagos pelo cambista considera somente baixas efetivadas no canal CASHIER_CASH desde o último acerto. Pagamentos Pix feitos pela plataforma não entram nesse indicador.
- O valor de prêmios pagos em dinheiro é adiantamento de caixa da plataforma devido ao cambista. Não compõe comissão nem vendas. No acerto, o ADMIN confere a quantidade, o total e o detalhamento por bilhete para repor/compensar o caixa do cambista.
- O resumo atualiza automaticamente a cada 30 segundos e considera o período desde o último acerto financeiro registrado pelo administrador. O histórico de vendas, baixas de prêmios e acertos não é apagado. O corte do período e o registro do acerto devem ser transacionais, sem dupla contagem ou omissão.
- Os resultados exibidos ao cambista são os publicados nas últimas 24 horas.
- O recibo imprimível só fica disponível depois da confirmação do pagamento e da alocação completa de todas as repetições às rodadas. Se uma venda em dinheiro ficar aguardando rodadas, a tela do cambista consulta o status até a alocação terminar e abre o recibo automaticamente; enquanto isso, bloqueia uma nova venda no mesmo formulário.

## 5. Sem reembolso automático

Não existe reembolso no fluxo comercial normal do jogo. Qualquer notificação externa inesperada de estorno/reembolso deve ser tratada como incidente financeiro para análise administrativa, sem desfazer automaticamente uma compra já confirmada, suas participações, prêmios ou comissões.

## 6. Contrato técnico e compatibilidade

- As APIs públicas de criação de compra usam o nome `repetitionCount`.
- O campo legado `NumericPurchaseIntent.roundCount` no banco representa **quantidade de repetições**, e não quantidade de jogos nem uma escolha de rodadas pelo usuário. Sua manutenção temporária evita uma migração destrutiva de dados; o código deve tratá-lo com esse significado.
- Uma repetição gera uma participação em uma rodada. Cada participação contém todos os números do jogo.
- Mudanças de estado, pagamentos recebidos e alocações pendentes devem ser auditáveis e idempotentes. As retentativas devem continuar enquanto houver alocação pendente, sem limite de tentativas de negócio, sem nova cobrança e sem duplicar participações, recibos ou comissões.

## 7. Exemplo de referência

Jogador escolhe os números `12345`, `00007` e `98765`, define valor de R$ 1,00 por número em cada rodada e escolhe 4 repetições:

- 1 jogo/jogada;
- 3 números;
- 4 repetições;
- 4 rodadas escolhidas automaticamente;
- R$ 12,00 no total;
- cada uma das quatro participações contém os mesmos três números.

## 8. Manutenção deste documento

Quando uma regra comercial for alterada, atualizar este documento e os testes correspondentes no mesmo conjunto de mudanças. O futuro manual técnico deve refletir a implementação real, incluindo modelos de dados, estados, APIs, scheduler, pagamentos, auditoria e procedimentos de recuperação.
