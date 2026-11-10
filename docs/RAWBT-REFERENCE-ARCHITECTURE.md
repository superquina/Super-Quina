# Referência técnica — RawBT Print Service 7.0.2

Data da inspeção: 2026-11-08  
APK de referência: rawbt-print-service-7-0-2(1).apk (5.747.888 bytes)  
Pacote identificado nos recursos: ru.a402d.rawbtprinter

## Resultado da inspeção

O arquivo enviado é o RawBT Print Service 7.0.2. Ele não é o APK Super Quina. O pacote contém uma arquitetura Android nativa de impressão, com módulos separados para serviço de impressão, SDK de impressão, drivers, transportes e persistência de perfis de impressora.

A análise foi feita por inspeção dos arquivos internos do APK, recursos XML/JSON e símbolos/strings do DEX. Não foi feita engenharia reversa integral do código-fonte nem execução dinâmica do APK; por isso, detalhes de fluxo interno que não aparecem explicitamente nos recursos/símbolos devem ser validados em aparelho antes de serem tratados como comportamento confirmado.

## Componentes identificados

### 1. Serviço Android e entrada de trabalhos

Foram identificados:
- android.printservice.PrintService e PrinterDiscoverySession;
- configuração res/xml/printservice.xml;
- atividade de configuração ru.a402d.rawbtprinter.activity.Magic;
- ações internas ru.a402d.rawbtprinter.action.PRINT_RAWBT, CANCEL e FINISH;
- extra de dados ru.a402d.rawbtprinter.extra.DATA.

Isso mostra que o RawBT pode atuar como serviço do framework de impressão do Android, recebendo trabalhos iniciados por outros aplicativos. O Super Quina não precisa reproduzir essa integração genérica com o menu Compartilhar/Imprimir: o nosso app já conhece o recibo que deve imprimir e pode chamar diretamente a ponte nativa.

### 2. SDK e motor de impressão

Namespaces identificados:
- rawbt/api: API e tipos de trabalho;
- rawbt/sdk: serviço, callbacks, fila/threads e codificação;
- rawbt/sdk/emulator/escpos: comandos e interpretação ESC/POS;
- rawbt/sdk/barcode: código de barras e QR Code;
- rawbt/sdk/dao: persistência de impressoras;
- rawbt/sdk/drivers: drivers por linguagem/protocolo;
- rawbt/sdk/transport: meios físicos de comunicação.

Também foram identificados comandos de QR Code ESC/POS, corte, inicialização, impressão gráfica e suporte a múltiplas code pages.

### 3. Pareamento e Bluetooth

Símbolos identificados:
- rawbt/sdk/btpair/BtDevAdapter;
- rawbt/sdk/transport/Bt;
- rawbt/sdk/transport/BLE;
- classes Android BluetoothAdapter, BluetoothDevice, BluetoothSocket e BluetoothGatt;
- chamadas e termos associados a startDiscovery, conexão, desconexão e dispositivos Bluetooth clássicos.

O pacote separa Bluetooth clássico e BLE em transportes distintos. Para o Super Quina, o transporte principal será Bluetooth clássico SPP/RFCOMM, porque é o caminho necessário para as impressoras térmicas que usam porta serial Bluetooth. BLE/GATT não será usado como substituto de SPP.

### 4. Outros transportes e drivers encontrados

O RawBT inclui muito mais do que precisamos:
- USB e USB serial;
- rede/TCP e WebSocket;
- BLE;
- AIDL para impressoras integradas;
- HID bridge;
- serial COM;
- linguagens ESC/POS, CPCL, EPL, TSPL, ZPL e modos proprietários;
- drivers para Paperang, Peripage e outras famílias.

Esses recursos explicam parte da complexidade e da interface ampla do RawBT. Não fazem parte do escopo inicial do Super Quina.

### 5. Perfil e configurações de impressora

O banco Room contém uma entidade printers com campos como nome, descrição, protocolo, MAC, host/porta, VID/PID, baud rate, driver serial, perfil, dots/DPI, linguagem de impressão, code page, comandos de inicialização/finalização, corte, avanço e dithering.

Não vamos copiar esse cadastro extenso. O Super Quina terá apenas configurações necessárias ao recibo:
- impressora Bluetooth pareada selecionada;
- conexão e estado;
- largura/perfil 58 mm ou 80 mm;
- codificação de caracteres;
- QR Code;
- avanço final e corte opcional.

## Arquitetura reduzida do Super Quina

```text
Recibo oficial autenticado (servidor)
                |
                v
       Encoder ESC/POS (TypeScript)
                |
          bytes / Base64
                |
                v
       Capacitor Bluetooth Bridge
                |
       Android BluetoothSocket
         RFCOMM / UUID SPP
                |
                v
         Impressora térmica
```

A interface terá somente:
1. listar impressoras já pareadas;
2. selecionar impressora;
3. conectar/desconectar;
4. testar impressão;
5. configurar largura e codificação;
6. imprimir recibo confirmado;
7. reimprimir manualmente com registro de segunda via.

Não haverá ferramentas de PDF, Word, documentos, imagens avulsas, compartilhamento genérico, gerenciador de arquivos, conversores, terminal, emulador, rede, USB, BLE, balança ou drivers de outras linguagens nesta primeira versão.

## Contrato mínimo da ponte Android

A ponte nativa deve expor operações pequenas e estáveis:
- listPairedDevices(): retorna identificador/MAC e nome dos dispositivos já pareados;
- connect(deviceId): abre socket RFCOMM com UUID SPP 00001101-0000-1000-8000-00805F9B34FB;
- send(dataBase64): envia os bytes em thread de I/O, serializando escritas e aplicando timeout;
- disconnect(): fecha output stream, socket e libera recursos.

A ponte não deve:
- confirmar pagamento;
- montar valores financeiros;
- consultar Mercado Pago;
- gerar recibo;
- armazenar credenciais;
- abrir arquivos ou aceitar documentos arbitrários.

Permissões mínimas:
- Android 12+: BLUETOOTH_CONNECT em tempo de execução;
- Android 11 e anteriores: permissão legada BLUETOOTH limitada a API 30.
- Não pedir scan/localização na primeira versão, pois a seleção será feita a partir dos dispositivos pareados pelo Android.

## Robustez de impressão

- Não executar conexão ou escrita Bluetooth na thread principal.
- Impedir duas escritas simultâneas no mesmo socket.
- Enviar em blocos quando necessário, com pausas configuráveis após teste em impressoras de buffer pequeno.
- Tratar desconexão, socket ocupado, permissão negada, Bluetooth desligado e dispositivo ausente.
- Reconectar antes de uma nova impressão somente quando o estado da conexão permitir; não reenviar automaticamente um trabalho de resultado incerto.
- Sucesso da escrita no socket não comprova que o papel saiu. Manter a distinção entre bytes enviados e impressão física confirmada.
- Codificação de português deve ser testada com CP858/CP850 e com a impressora real; não assumir uma code page universal.
- QR Code nativo ESC/POS e corte devem ser capacidades opcionais; oferecer avanço de papel quando não houver guilhotina.

## Regras de integração com pagamento

O encoder recebe somente o DTO do recibo oficial devolvido pela rota autenticada do Super Quina. O app não pode criar um recibo financeiro local nem considerar o desaparecimento do QR Pix como confirmação.

A reserva idempotente AUTO_RECEIPT e o ledger PrintJob já existentes no projeto devem ser respeitados. O fluxo nativo deve disputar RESERVED -> SENDING antes de escrever e registrar SENT, FAILED ou UNKNOWN. Estados SENDING abandonados e UNKNOWN não podem provocar reenvio automático. Reimpressão é uma ação explícita e auditada.

## Próximas entregas de implementação

1. Inicializar/sincronizar a plataforma Android Capacitor em ambiente Node/JDK/Gradle.
2. Criar plugin Android próprio e mínimo para RFCOMM/SPP.
3. Criar adaptador TypeScript com tipos e tratamento de erros.
4. Criar tela simples de impressora dentro do Super Quina.
5. Criar encoder ESC/POS puro usando o DTO real do recibo, com testes de bytes, acentos, zeros à esquerda e QR.
6. Integrar com as rotas autenticadas e o ledger de impressão já existentes.
7. Testar com o APK instalado em Android físico e com impressoras reais de 58 mm e 80 mm.

## Limite desta etapa

Esta inspeção confirmou a arquitetura e os recursos do APK de referência. Nenhum código proprietário do RawBT foi copiado. Nenhum APK foi modificado. O projeto Android ainda precisa ser inicializado e compilado em ambiente de desenvolvimento Android; portanto, esta etapa não declara a ponte pronta nem a impressão física validada.
