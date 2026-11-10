# Auditoria do fluxo de recibo e impressão — Android

Data: 2026-11-05  
Branch: `main`

## Resultado da auditoria

### Confirmação do Pix e recibo

O fluxo atual está corretamente dividido:

1. O endpoint de status do jogador é `GET /api/player/purchases/[purchaseId]/status`.
2. O endpoint equivalente do cambista é `GET /api/cashier/purchases/[purchaseId]/status`.
3. Ambos verificam a propriedade da compra antes de expor o estado. O endpoint do jogador filtra por `playerId`; o do cambista, por `cashierId`.
4. Quando necessário, o endpoint consulta o Mercado Pago através de `reconcilePixPaymentFromProvider`. A confirmação converge para a transação idempotente existente no backend.
5. O recibo só é sinalizado como disponível quando a compra está `CONFIRMED`, existe `receiptCode` e `confirmedAt`; para Pix também é exigida a confirmação do pagamento e seu `confirmedAt`.
6. O cliente busca os dados oficiais em `GET /api/player/purchases/[purchaseId]/receipt`, que valida sessão, propriedade e estado confirmado.

O aplicativo Android deve continuar consumindo esse recibo oficial. Não deve montar um recibo financeiro a partir do QR Code Pix, do estado visual da tela ou de dados locais.

### Comportamento atual do componente

- `numeric-game-purchase-form.tsx` consulta o endpoint de status a cada 3 segundos.
- Ao receber `receiptReady: true`, abre `PlayerPurchaseReceipt` e encerra o acompanhamento daquela compra.
- `PlayerPurchaseReceipt` busca novamente o recibo autenticado e renderiza `ThermalReceipt`.
- `ThermalReceipt` atualmente oferece impressão pelo diálogo do sistema (`window.print`) e download HTML. Ainda não existe envio Bluetooth SPP.
- O componente não dispara impressão automática Bluetooth. Portanto, não há hoje uma impressão física duplicada causada pelo polling.

### Observação de concorrência

O polling usa `setInterval` e não possui uma trava explícita contra duas consultas HTTP simultâneas caso uma resposta demore mais de três segundos. A rota de status limita a reconciliação com o provedor através de uma atualização condicional do timestamp do pagamento, e a confirmação financeira é idempotente; assim, consultas concorrentes não devem criar uma segunda compra nem um segundo recibo. Ainda assim, antes de ligar a impressão, o cliente deve ter uma trava de consulta em andamento e uma trava local de evento de recibo para evitar processamento repetido na mesma montagem.

## Contrato obrigatório para impressão Bluetooth

### Fonte dos dados

A impressão recebe exclusivamente o objeto retornado pela rota autenticada de recibo. O app nativo não recebe nem armazena token do Mercado Pago e não confirma pagamentos.

### Idempotência da impressão automática

A idempotência financeira existente não é suficiente para impedir duas impressões físicas. A impressão precisa de estado próprio, separado de `Purchase` e `Payment`.

Desenho recomendado para implementação posterior:

- Criar registro persistente de trabalho de impressão associado à compra.
- Impor unicidade no banco para o propósito `AUTO_RECEIPT` por compra.
- Criar/reservar esse registro em transação, somente depois de validar compra confirmada, recibo existente e autorização do proprietário.
- Somente a instância que conseguir criar a reserva pode iniciar a impressão automática.
- Registrar estado, tentativas, horários, dispositivo selecionado e erro técnico sem armazenar dados desnecessários do recibo.
- Não repetir automaticamente uma impressão cujo resultado ficou incerto após desconexão ou encerramento do app. Uma impressora pode ter recebido os bytes mesmo que o app não tenha recebido a confirmação.
- Disponibilizar reimpressão apenas por ação explícita do usuário, registrada como nova tentativa/manual, sem alterar pagamento, compra, participações ou `receiptCode`.
- Nunca interpretar `already_confirmed`, uma resposta repetida de polling ou a reabertura da tela como autorização para imprimir novamente.

A garantia prática deve ser: **uma única reserva de impressão automática por compra**. Não prometer entrega física exatamente uma vez, porque uma queda de conexão pode ocorrer depois de a impressora imprimir e antes de o aplicativo receber a confirmação.

### Ponte nativa

A interface TypeScript deve ficar isolada atrás de um adaptador Capacitor com operações explícitas para listar dispositivos pareados, conectar, enviar bytes ESC/POS e desconectar. O módulo Android implementará Bluetooth clássico RFCOMM/SPP e permissão `BLUETOOTH_CONNECT` quando exigida. Não usar BLE/GATT como substituto de SPP.

### Encoder ESC/POS

O recibo HTML atual não é conteúdo válido para envio direto à impressora. Criar encoder puro, testável, que transforme o DTO oficial do recibo em bytes ESC/POS. Separar formatação de texto, alinhamento, QR, avanço e corte do transporte Bluetooth.

## Situação e próximos passos

- [x] Localizar rotas reais de status do jogador e cambista.
- [x] Confirmar filtros de propriedade e critério de recibo confirmado.
- [x] Localizar componente de consulta e componente de recibo.
- [x] Confirmar que ainda não existe impressão Bluetooth automática.
- [x] Documentar o limite de idempotência física e o desenho de reserva.
- [ ] Implementar trava de consulta concorrente no polling, com teste de componente.
- [ ] Definir e testar encoder ESC/POS com amostras do DTO oficial.
- [ ] Implementar tabela/serviço de reserva idempotente e testes concorrentes no PostgreSQL.
- [ ] Inicializar Capacitor/Android em ambiente Node, JDK e Gradle real.
- [ ] Implementar e testar a ponte RFCOMM/SPP em aparelho e matriz de impressoras físicas.

Nenhuma alteração foi feita em `main`. Nenhum APK foi compilado nesta etapa.

## Correção de escopo: compatibilidade universal ESC/POS

O projeto não será desenvolvido para um fabricante ou modelo isolado. O alvo é uma ampla classe de impressoras térmicas com Bluetooth clássico SPP/RFCOMM e implementação compatível com ESC/POS.

A implementação deve usar perfis genéricos de 58 mm e 80 mm, sem presumir colunas fixas apenas pela largura nominal. A code page deve ser configurável/testada para português; QR nativo e corte devem ser capacidades opcionais. Para dispositivos sem cortador, usar avanço de papel. A ponte SPP transporta bytes e não conhece regras financeiras.

Como SPP não garante descoberta padronizada de largura, tabela de caracteres, suporte a QR ou cortador, o aplicativo não deve fingir detectar automaticamente o que o protocolo não informa. Deve oferecer configuração de perfil e comandos conservadores, com capacidade opcional ativada explicitamente quando necessário.

A validação deve usar uma matriz de impressoras representativas de diferentes fabricantes/firmwares, em 58 mm e 80 mm. O compromisso técnico é ampla compatibilidade com o subconjunto ESC/POS comum, não compatibilidade absoluta com implementações proprietárias ou incompletas.
