# Auditoria das tentativas anteriores de APK e impressão Bluetooth

Data da auditoria: 2026-11-08
Repositório: `jpveiculos/Super-Quina`
Branch de trabalho atual: `feature/rawbt-inspired-printer-core`

## Resultado executivo

As tentativas anteriores não foram versões independentes de uma solução validada. As três branches de APK reutilizam essencialmente a mesma arquitetura Capacitor/WebView e a mesma ponte Bluetooth SPP, com pequenas variações no código. Os PRs registram expressamente que não houve teste físico de impressão; portanto, não há evidência de que qualquer uma dessas versões tenha funcionado em uma impressora real.

Não gerar outro APK copiando essas branches.

## Branches antigas identificadas

| Branch | Diferença observada em relação a main | Observação |
|---|---:|---|
| `feature/android-apk-printer` | 46 commits à frente / 157 atrás | APK geral; contém ponte Bluetooth, projeto Android e workflows |
| `feature/android-apk-public` | 39 à frente / 157 atrás | Variante Público; mesma base Android e mesma ponte Bluetooth |
| `feature/cashier-apk-from-public` | 53 à frente / 157 atrás | Variante Cambista derivada da estrutura Público; ponte Bluetooth muito semelhante |
| `feature/rawbt-minimal-printer` | 1 à frente / 3 atrás | Apenas documento de escopo mínimo; não é APK funcional |
| `feature/rawbt-inspired-printer-core` | branch atual | Novo scaffold isolado; ainda não integrado/compilado |

Os números são comparação com `main` no momento desta auditoria. As branches estão bastante divergentes da versão atual; não devem ser mescladas integralmente em `main`.

## PRs anteriores encontrados

- PR #5 — botão do recibo para impressão Bluetooth, baseado na branch antiga do APK.
- PR #6 — mesmo objetivo na branch Público.
- PR #7 — variante Cambista derivada da branch Público.
- PR #8 — scaffold novo inspirado na arquitetura do RawBT.

As descrições dos PRs #5, #6 e #7 dizem explicitamente que não foram executados build Gradle nem teste físico. PR #8 também declara que ainda não há plataforma Android gerada nem APK compilado.

## Falhas estruturais observadas nas implementações antigas

### 1. Bluetooth implementado como conexão descartável

Nas versões Público e APK Printer, a rotina de impressão:
- abre um socket RFCOMM;
- tenta conectar;
- escreve e faz flush;
- fecha o socket imediatamente no bloco `finally`.

Não existe uma sessão de impressora mantida entre operações, nem um fluxo separado e verificável de conectar, testar a conexão e imprimir. A tela seleciona um dispositivo pareado, mas isso não prova que a impressora esteja acessível ou aceite o perfil SPP.

Na branch Cambista foi adicionado fallback de RFCOMM seguro para inseguro e timeouts. Isso é uma diferença de implementação, não evidência de compatibilidade: o código ainda fecha a conexão depois de cada envio e não foi validado em hardware.

### 2. Compatibilidade limitada, mas apresentada como impressão Bluetooth

As implementações antigas trabalham apenas com Bluetooth Classic RFCOMM/SPP e dispositivos previamente pareados. Não implementam BLE/GATT. Uma impressora que use BLE, protocolo proprietário, perfil serial diferente ou pareamento incompleto não será atendida por essa ponte.

### 3. Diagnóstico insuficiente

A ponte antiga transforma várias falhas de conexão e escrita em um erro genérico `CONNECTION_FAILED`. Isso não permite distinguir com precisão:
- impressora desligada ou fora de alcance;
- dispositivo pareado, mas sem serviço SPP;
- falha de autenticação/pareamento;
- timeout de conexão;
- desconexão durante a escrita;
- impressora que recebeu bytes mas não os imprimiu.

### 4. Fluxo de impressão não comprova impressão física

O retorno `bytesWritten` significa que o transporte aceitou os bytes; não confirma que o papel saiu. O ledger atual já prevê estados `SENDING`, `SENT`, `FAILED` e `UNKNOWN`, o que deve ser preservado. Falha após iniciar a escrita precisa permanecer `UNKNOWN`; não pode provocar reenvio automático.

### 5. A interface mistura seleção e envio sem diagnóstico independente

O componente antigo carrega dispositivos pareados e permite selecionar um deles, mas não oferece uma etapa de diagnóstico independente que comprove conexão SPP e perfil ESC/POS antes de usar um recibo real. Isso dificulta separar defeito de conexão de defeito no conteúdo ESC/POS.

## O que já existe e deve ser preservado

- Rota autenticada do recibo oficial: `GET /api/player/purchases/{purchaseId}/receipt`. Só entrega recibo após confirmação definitiva e valida a titularidade.
- Reserva auditada de reimpressão manual: `POST /api/purchases/{purchaseId}/print-jobs/manual`.
- Reserva automática idempotente: `POST /api/purchases/{purchaseId}/print-jobs/auto`.
- Transições auditadas: `POST /api/print-jobs/{jobId}/transition`.
- Encoder puro ESC/POS: `src/modules/printing/escpos/encode-thermal-receipt.ts`.
- Serviço de ledger: `src/modules/printing/print-job-service.ts`.

## Pontos técnicos que precisam ser resolvidos antes de novo APK

1. Criar um teste nativo de conexão SPP que não imprima um recibo de venda.
2. Separar conexão, consulta de estado, envio e desconexão; registrar o motivo real de falha.
3. Validar secure/insecure RFCOMM com a impressora-alvo e Android real.
4. Fazer um teste ESC/POS mínimo (inicialização, texto ASCII, alimentação) antes do recibo completo.
5. Validar largura de papel, code page, QR Code e corte no modelo real.
6. Corrigir a representação de data do encoder: hoje usa `toISOString()`, que imprime UTC, enquanto o recibo visual apresenta horário de São Paulo.
7. Garantir que o app Android mantém a sessão autenticada do site remoto e que as rotas do recibo/PrintJob funcionam dentro da WebView.
8. Executar build, testes automatizados e teste físico documentado. Só então preparar APK de distribuição.

## Decisão

Não copiar as branches `feature/android-apk-printer`, `feature/android-apk-public` ou `feature/cashier-apk-from-public` para a solução nova. Não apagar nem mesclar essas branches nesta etapa. A branch `feature/rawbt-inspired-printer-core` permanece isolada; o próximo desenvolvimento deve começar por diagnóstico de transporte e prova de impressão mínima, antes da integração do recibo.

## Evidência adicional — teste do usuário em 08/11/2026

As capturas do aparelho mostram a tela de pré-visualização do serviço de impressão Android, com o erro explícito "Serviço de impressão não ativado". A impressora KPrinter_4765 aparece como dispositivo Bluetooth pareado, mas o trabalho foi encaminhado ao serviço de impressão do Android e não à ponte SPP direta.

A comparação dos componentes do site nesta branch identificou o motivo da rota genérica ser aberta: o componente ThermalReceipt continha um botão que chamava window.print(), além do componente separado ThermalBluetoothPrinter que já mantinha o fluxo direto SPP. Portanto, a tela Android Print Framework não era necessária para o recibo oficial.

Correção aplicada nesta branch:
- Removido o botão window.print() do recibo oficial.
- Removida a ação de baixar o recibo HTML, pois o recibo permanece no site.
- Mantido o botão de impressão Bluetooth dentro do modal do recibo, ligado ao PrintJob e à rota autenticada do recibo.
- A ponte nativa foi reforçada com fila serial para operações de socket, timeout de conexão, fallback RFCOMM seguro/inseguro e escrita em blocos.
- A validação da conexão nativa ocorre antes de reservar o PrintJob, evitando reservas sem possibilidade de impressão.
- Não foi incluído PrintService no novo plugin Android; a impressão direta não depende de ativar serviço de impressão nas configurações do aparelho.

A correção remove a causa identificada para a abertura da tela Android Print Framework, mas ainda não comprova a saída física do papel. Isso exige build atualizado, instalação no Android e teste real com a KPrinter_4765/OY-580IP.
