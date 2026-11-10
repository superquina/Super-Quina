# Cruzamento técnico — APK anterior x APK integrado Super Quina

Data: 09/11/2026

## Branches comparadas
- APK anterior: `feature/superquina-bluetooth-printer`
- Projeto integrado atual: `feature/superquina-rawbt-rebuild`

As branches divergiram: a integrada está 149 commits à frente e 54 atrás da anterior no comparativo consultado. Não fazer merge integral. Transportar seletivamente componentes e comportamentos para não regredir o site.

## Arquitetura do APK anterior
O diretório `superquina-print-bridge/` contém um app Android Kotlin independente com duas entradas:
1. Compartilhamento Android ACTION_SEND/text/plain: recebe JSON/texto, seleciona dispositivo pareado, conecta por Bluetooth Classic RFCOMM/SPP e gera ESC/POS com QR Code.
2. Android Print Framework: recebe PDF do diálogo nativo, rasteriza cada página para monocromático e transmite raster ESC/POS por Bluetooth.

O app persiste o endereço selecionado em SharedPreferences e solicita BLUETOOTH_CONNECT no Android 12+. Para o fluxo PDF, o usuário precisa ativar manualmente o serviço Super Quina nas configurações Android de impressão. O workflow usava Java 17, Gradle 8.9 e Android SDK 35; o artefato `superquina-print-bridge-debug` foi gerado.

## Arquitetura integrada atual
A branch atual usa Capacitor 7 e carrega o site hospedado em `https://superquina.com`. A interface `ThermalBluetoothPrinter` lista impressoras pareadas, permite conectar, desconectar, testar e selecionar perfis 58/80 mm. O fluxo de impressão busca o recibo oficial autenticado, gera bytes ESC/POS no TypeScript, reserva um trabalho no backend e envia Base64 ao plugin Android `SuperQuinaPrinterPlugin`. O plugin implementa RFCOMM/SPP, fila serial, timeout, fallback de socket e envio em blocos.

## Falha concreta identificada e corrigida
O arquivo `src/modules/printing/client/print-official-purchase-receipt.ts` ainda importava `getRawBtPrinter` de `rawbt-printer-bridge`, embora a pasta antiga tivesse sido removida. Isso deixava o fluxo apontando para um módulo inexistente e podia bloquear typecheck/build.

Correção já aplicada nesta branch: import e chamada migrados para `getSuperQuinaPrinter` de `superquina-printer-bridge`.

## Outras causas prováveis da falha de integração

### A. Print Framework não é uma ponte automática para WebView
O app anterior recebia intents Android e trabalhos PDF do Android Print Framework. Isso não significa que `window.print()` dentro da WebView Capacitor abrirá o mesmo serviço. A WebView precisa de um adaptador nativo explícito, ou a página precisa chamar o plugin nativo diretamente.

Decisão: o botão de impressão do APK integrado deve usar diretamente o plugin Capacitor SPP. Não depender de `window.print()` para Bluetooth.

### B. Transporte duplicado no APK anterior
O app anterior implementa RFCOMM tanto em `MainActivity` quanto em `SuperquinaPrintService`. São dois caminhos independentes. Não copiar ambos para o app integrado.

Decisão: um único transporte SPP no plugin nativo.

### C. Contrato do recibo diferente
O app antigo recebe JSON pelo compartilhamento e monta ESC/POS no Kotlin. O novo projeto busca o DTO oficial autenticado, monta ESC/POS no encoder TypeScript e entrega bytes ao plugin.

Decisão: manter o contrato novo. O servidor continua fonte de verdade; Android só conecta e transmite. Não duplicar regras financeiras nem confiar em recibos montados localmente.

### D. Seleção da impressora
O app anterior persiste o endereço Bluetooth em SharedPreferences. O projeto integrado persiste perfis de papel no localStorage, mas a seleção de dispositivo é estado do componente.

Melhoria recomendada: persistir o endereço selecionado e restaurá-lo ao abrir o app, validando se o dispositivo continua pareado. Não presumir que a conexão permanece ativa após fechar o aplicativo.

### E. Dependências
O `package.json` já declara Capacitor e o plugin local, mas o `package-lock.json` consultado ainda não contém essas dependências. O workflow usa `npm install`, que pode atualizar o lockfile durante o build, mas o repositório não tem resolução reproduzível versionada.

Pendência: gerar e versionar o lockfile em ambiente Node real, sem edição manual.

### F. Gatilho do build
O workflow atual dispara em push para main, PR para main ou execução manual. Ele não dispara automaticamente em push na branch de trabalho.

Melhoria recomendada: incluir `feature/superquina-rawbt-rebuild` no gatilho push durante o desenvolvimento.

### G. Jogador e cambista
O componente Bluetooth está visivelmente montado em `PlayerPurchaseReceipt`. Confirmar se o fluxo de recibo do cambista também passa pelo mesmo componente/rota antes de declarar integração completa do site.

## O que aproveitar do APK anterior

| Recurso | Decisão |
|---|---|
| Bluetooth Classic RFCOMM/SPP | Manter como protocolo; uma única implementação nativa |
| Lista de dispositivos pareados | Manter |
| Permissões Android 12+ | Manter e testar |
| Persistência do dispositivo selecionado | Portar como melhoria |
| Tela nativa simples de configuração | Reproduzir apenas se a UI web não cobrir a necessidade |
| PrintService que recebe PDF | Não incluir na primeira versão integrada |
| Rasterização PDF | Não incluir na primeira versão integrada |
| ACTION_SEND JSON | Não usar como canal principal |
| Encoder ESC/POS Kotlin duplicado | Não portar; encoder TypeScript será a fonte única |
| Dois transportes Bluetooth paralelos | Não portar |

## Plano de validação
1. Corrigir referências antigas — import já corrigido.
2. Gerar lockfile real via npm.
3. Ajustar workflow para compilar a branch de trabalho.
4. Rodar typecheck, lint e testes de encoder/ledger/recibo.
5. Executar `npx cap sync android` e compilar APK.
6. Testar em Android físico: permissão, lista, conexão, desconexão, reconexão e seleção persistida.
7. Testar as impressoras físicas do usuário em 58/80 mm, acentos, QR, avanço e corte.
8. Validar jogador e cambista sem duplicar reserva automática.
9. Conferir o papel: socket aceito não significa impressão física concluída.

## Decisão final
Não fazer merge integral da branch anterior. O APK anterior é referência funcional para seleção, permissões, SPP e UX Android. A branch integrada atual é a base do produto porque já contém o site hospedado, interface, recibo oficial, encoder e ledger. Importar apenas melhorias comprovadas e necessárias.

## Estado
- Branches comparadas e arquiteturas mapeadas.
- Import antigo identificado e corrigido.
- Nenhum merge integral realizado.
- Nenhuma alteração em main.
- Build Android e teste físico ainda não executados nesta auditoria.


## Confirmação pelos logs do GitHub Actions

A leitura dos logs completos confirmou dois bloqueios reais em execuções anteriores:

- Execução `42711524185`: instalação e geração Prisma passaram; o typecheck falhou exatamente por importar o módulo removido `rawbt-printer-bridge`. A referência foi corrigida.
- Execução `42710778477`: typecheck, lint e os 31 testes selecionados passaram; a etapa `npx cap add android` falhou com a mensagem `android platform already exists`.

A causa do segundo bloqueio foi confirmada na árvore Git: a pasta raiz `android/` continha apenas `rawbt-reconstruction/` e seus documentos, não uma plataforma Android Capacitor. O CLI considera a existência da pasta suficiente para recusar `cap add android`.

**Correção aplicada:** os cinco documentos de auditoria foram movidos para `docs/rawbt-reconstruction/`, liberando a pasta `android/` para a plataforma nativa gerada pelo Capacitor. O workflow também foi ajustado para disparar em push na branch de integração.

A execução disparada após essas correções deve ser acompanhada até o fim. Até obter resultado verde, não declarar APK recompilado.


## Escopo confirmado — APK privado do cambista (09/11/2026)

O produto Android não é um aplicativo público e não terá fluxo de impressão para jogador. O escopo é exclusivamente operacional para o cambista:

- Ícone do APK abre diretamente `/cashier-app-login`.
- Login aceita somente perfil `CASHIER`; o servidor continua validando sessão e papel em cada rota protegida.
- Após autenticação, a navegação principal é a área `/cashier`.
- Não incluir atalhos para jogador, administração, cadastro público ou páginas institucionais no fluxo do APK.
- A configuração Bluetooth fica recolhida no rodapé da área do cambista, imediatamente acima de **Sair**.
- O recibo da venda continua oferecendo a ação de impressão Bluetooth; a configuração persistente do dispositivo e o teste da impressora ficam no rodapé.
- Um único plugin nativo SPP atende o fluxo de venda do cambista.

### Alterações aplicadas nesta etapa

- `capacitor.config.ts`: URL inicial do WebView alterada para `https://superquina.com/cashier-app-login`; nome do app ajustado para “Super Quina Cambista”.
- `src/app/cashier/page.tsx`: painel recolhível de configuração Bluetooth inserido em `footerContent`, antes do botão Sair.
- `src/components/receipts/thermal-bluetooth-printer.tsx`: componente permite uso sem compra ativa para configurar, conectar e testar; a ação “Imprimir recibo” só aparece quando há um `purchaseId`, dentro do recibo oficial.

### Pontos de validação antes de distribuir o APK

- Confirmar que o login de cambista direciona para `/cashier` e rejeita jogador/administrador.
- Confirmar que o painel de impressora permanece recolhido por padrão e aparece acima de Sair.
- Confirmar no Android físico permissões, pareamento, conexão SPP, teste e impressão de recibo.
- Confirmar que a sessão expirada retorna ao login exclusivo do cambista.
- O endereço inicial do Capacitor não substitui autorização no servidor; APIs e páginas protegidas devem continuar verificando o papel do usuário.
