# Contrato de integración del cliente de impresión

Estado: especificación previa a la integración nativa.

## Datos oficiales del recibo

El cliente móvil no debe construir importes, apuestas, estado de pago ni código de recibo. La fuente es la ruta autenticada existente:

- `GET /api/player/purchases/{purchaseId}/receipt`

El componente `PlayerPurchaseReceipt` ya consume esta ruta y recibe un DTO con:
- `receiptCode`
- `paymentStatus: CONFIRMED`
- `issuedAt`
- `paymentMethod`
- `totalCents`
- `currency`
- `customerLabel`
- `cashierLabel`
- `entries[]`

El encoder térmico debe receber exclusivamente esse DTO validado, nunca dados montados no aparelho.

## Ciclo obrigatório do PrintJob

1. Reservar com `POST /api/purchases/{purchaseId}/print-jobs/auto`.
2. Só prosseguir se o servidor responder com um trabalho que possa ser enviado e estiver em `RESERVED`.
3. Obter o DTO oficial pela rota de recibo autenticada.
4. Converter o DTO em ESC/POS usando `encodeThermalReceipt`.
5. Mudar o trabalho para `SENDING` antes de transmitir.
6. Enviar os bytes pelo plugin Bluetooth.
7. Se o socket aceitar a escrita, registrar `SENT` — isso significa bytes aceitos pelo transporte, não confirmação física do papel.
8. Se houver falha depois do início da escrita, registrar `UNKNOWN`; nunca reenviar automaticamente.
9. Se a falha ocorrer antes de iniciar a escrita, registrar `FAILED` com código específico.
10. Reimpressão somente por ação explícita e auditada.

## Lacunas que precisam ser fechadas antes da tela de impressão

- Localizar e validar a rota de transição de estado do PrintJob para o cliente.
- Confirmar como a rota do recibo autoriza cada papel (jogador, cambista e administrador).
- Definir como o cliente Android mantém a sessão autenticada e os cookies na WebView.
- Implementar seleção de largura 58/80 mm e perfil ESC/POS por impressora.
- O recibo visual atual contém QR Code de verificação; o encoder ESC/POS atual ainda não codifica esse QR. A impressão deve manter esse recurso, usando comandos ESC/POS QR compatíveis com o modelo ou uma imagem raster gerada no cliente, após teste físico.
- Corrigir/validar o fuso horário do encoder: a interface mostra horário de São Paulo, enquanto o encoder atual serializa a data em UTC.
- Adicionar testes unitários para codificação, limites, falhas e transições antes de habilitar impressão automática.

## Decisão de escopo

Primeira versão Android: Capacitor + WebView do site autenticado + plugin Bluetooth Classic SPP. Pareamento é feito nas configurações Android. Sem PDF, Word, imagem avulsa, PrintService genérico, BLE, USB ou rede.

Não instalar dependências nem gerar lockfile manualmente. Capacitor core/cli/android devem ser adicionados por instalação real e o lockfile gerado pelo npm, seguido de build Android. O repositório ainda não contém plataforma Android nem dependências Capacitor.
