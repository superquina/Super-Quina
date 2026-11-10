# Mapa de classes RawBT para estudo — Super Quina

Esta lista serve para localizar os pontos de arquitetura na exportação JADX. Os caminhos abaixo são relativos a `codigo_nativo_jadx/app/src/main/java/`. Não significa autorização para copiar código proprietário para o produto.

## Entrada de trabalhos e ciclo de impressão

- `ru/a402d/rawbtprinter/printservice/RawBtService.java` — adaptador Android Print Framework (`PrintService`).
- `rawbt/sdk/AbstractRawBtPrintService.java` — serviço interno, fila e callbacks de impressão.
- `rawbt/sdk/IRawBtPrintService.java` — contrato IPC do serviço interno.
- `rawbt/sdk/PrintThread.java` — execução de trabalho em thread.
- `rawbt/sdk/RawbtPrintJob.java` e `rawbt/api/RawbtPrintJob.java` — modelos de trabalho.
- `rawbt/sdk/ICallback.java` — retorno de progresso, erro e conclusão.

## Bluetooth e seleção de impressora

- `rawbt/sdk/btpair/BtScanActivity.java` — fluxo de descoberta/seleção.
- `rawbt/sdk/btpair/BtPairActivity.java` — atividade de pareamento.
- `rawbt/sdk/btpair/BtDevAdapter.java` — adaptação/listagem de dispositivos.
- `rawbt/sdk/transport/Bt.java` — transporte Bluetooth clássico.
- `rawbt/sdk/transport/BLE.java` — transporte BLE, fora do escopo inicial.
- `rawbt/sdk/transport/Transport.java` e `TransportFactory.java` — abstração e seleção de transporte.
- `rawbt/sdk/dao/PrinterEntity.java` e `PrintersModel.java` — configuração persistente de impressoras.
- `rawbt/sdk/PrinterInfo.java` — informação/capacidades de impressora.

## Linguagem de impressão

- `rawbt/sdk/drivers/EscGeneral.java` — driver ESC/POS geral.
- `rawbt/sdk/drivers/AbstractDriverWithTransport.java` — ligação driver/transporte.
- `rawbt/sdk/drivers/PrinterDriverFactory.java` — seleção de driver.
- `rawbt/sdk/emulator/escpos/EscPosEmulator.java` — interpretação/emulação ESC/POS.
- `rawbt/sdk/emulator/escpos/Printer2DQrCommands.java` e `rawbt/sdk/barcode/QrCodeDraw.java` — QR Code.
- `rawbt/sdk/PrinterEncoding.java` — codificação de caracteres.

## Interface Web de demonstração

- `fontes_web/index.html`
- `fontes_web/app.js`
- `fontes_web/app.css`

Esses arquivos ajudam a entender o formato de comandos e o fluxo da interface do produto de referência. Não devem ser incorporados ao site Super Quina sem revisão de licença e segurança.

## Comparação com o Super Quina atual

O plugin local `plugins/rawbt-printer` já implementa um caminho mais curto: lista dispositivos pareados, conecta por RFCOMM/SPP e envia bytes ESC/POS fornecidos pelo site. Para nosso caso de uso, a arquitetura mais enxuta continua sendo:

```
Site autenticado -> DTO de recibo oficial -> encoder ESC/POS próprio
 -> plugin Capacitor -> BluetoothSocket RFCOMM/SPP -> impressora
```

Não é necessário reproduzir todo o Print Framework do RawBT se o nosso site chamar diretamente o plugin nativo. O PrintService só deve ser considerado se houver requisito real de imprimir a partir do menu de impressão do Android ou de outros aplicativos.

## Decisão inicial

- Manter WebView hospedada + plugin SPP próprio como primeira opção.
- Não registrar Android PrintService no nosso APK nesta fase.
- Não importar BLE, USB, TCP, CPCL, EPL, TSPL, ZPL ou drivers proprietários para o primeiro produto.
- Validar 58 mm/80 mm, code page para português, QR Code, avanço/corte e comportamento de desconexão na impressora física.
