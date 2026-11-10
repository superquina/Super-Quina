# Android APK — Super Quina

## Objetivo e limites

O APK é uma aplicação Android nativa com Capacitor que abre a aplicação Next.js hospedada em produção. O Next.js continua responsável por páginas, rotas de API, sessão/autenticação, Prisma, pagamentos e confirmação definitiva do Pix.

- Aplicação web de produção: `https://superquina.com`
- Identificador Android: `com.superquina.app`
- Nome: `Super Quina`
- Branch isolada: `main`
- Hospedagem autorizada: AquaCloud
- Não gerar exportação estática do Next.js.
- Não adicionar URLs, variáveis ou referências a outros provedores de hospedagem.
- Não alterar `main`.

## Estado inicial auditado

- `capacitor.config.ts` já existe e aponta para `https://superquina.com`, com HTTPS e conteúdo misto desabilitado.
- `package.json` ainda não declara `@capacitor/core`, `@capacitor/cli` ou `@capacitor/android`.
- O lockfile presente é `package-lock.json`; ele ainda não contém os pacotes Capacitor.
- `android/app/src/main/AndroidManifest.xml` ainda não existe na branch.
- Portanto, a plataforma Android ainda precisa ser inicializada e sincronizada. Não declarar o APK pronto antes de compilar e testar em aparelho real.

## Decisões de configuração

### Capacitor e Next.js

Manter a aplicação Next.js hospedada. O campo `webDir` é necessário para o CLI, mas não significa que o Next.js deva ser exportado como HTML estático quando a configuração usa `server.url`.

Manter em produção:
- `server.url = https://superquina.com`
- `server.cleartext = false`
- `android.allowMixedContent = false`

Não copiar a URL de exemplo `https://vercel.app`, nem habilitar HTTP/cleartext ou conteúdo misto em produção.

### Bluetooth Android

As permissões devem ser declaradas com o atributo XML `android:name` (não `android:permission`). A configuração final deve respeitar o SDK de destino e solicitar permissões em tempo de execução:

- Android 12 (API 31) ou superior: `BLUETOOTH_SCAN` e `BLUETOOTH_CONNECT`; solicitar ao usuário quando necessário. Só declarar `BLUETOOTH_ADVERTISE` se o aplicativo realmente anunciar/for descoberto por outros dispositivos.
- Android 11 (API 30) ou inferior: permissões legadas `BLUETOOTH` e `BLUETOOTH_ADMIN` com limite de SDK adequado. A descoberta pode exigir permissão de localização e tratamento de localização em tempo de execução, conforme a versão do Android e o fluxo adotado.
- Não solicitar permissões de localização indiscriminadamente em Android recente se a implementação não precisar delas.
- Declarar o recurso Bluetooth como opcional se o app também precisar abrir em dispositivos sem Bluetooth.

### Impressora térmica

O requisito é Bluetooth clássico RFCOMM/SPP e impressão ESC/POS. Uma biblioteca exclusivamente BLE não atende automaticamente a esse requisito. Antes de escolher dependência, validar:
- suporte real a Bluetooth clássico SPP em Android;
- compatibilidade com os modelos de impressora usados;
- manutenção/compatibilidade com a versão de Capacitor escolhida;
- permissões Android 12+ e reconexão;
- envio de bytes ESC/POS, acentuação, largura de papel e corte.

A camada de impressão deve ser isolada atrás de uma interface Capacitor para permitir trocar o plugin sem alterar as telas e regras de negócio.

## Arquitetura de impressão e pagamento

1. O backend recebe e valida a confirmação definitiva do pagamento com o provedor.
2. O backend atualiza o estado da compra/aposta de forma transacional e idempotente.
3. A interface consulta o estado confirmado por uma rota autenticada já existente.
4. Somente após o estado confirmado, a interface solicita a impressão nativa.
5. O dispositivo envia o conteúdo ESC/POS à impressora Bluetooth selecionada.
6. A interface apresenta sucesso ou falha e oferece reimpressão manual autorizada.

Regras:
- Nunca considerar o retorno visual do QR Code ou a URL de retorno do navegador como prova suficiente de pagamento.
- Notificações repetidas do provedor não podem criar vendas nem disparar impressão automática duplicada.
- Falha de Bluetooth/impressora não pode desfazer nem alterar um pagamento confirmado.
- Reimpressão não pode gerar nova cobrança, nova aposta ou novo recibo financeiro.
- Não expor credenciais do Mercado Pago no aplicativo; operações sensíveis permanecem no servidor.

## Próximas etapas

- [ ] Confirmar a versão de Capacitor compatível com o projeto e instalar core/cli/android.
- [ ] Atualizar `package.json` e `package-lock.json` juntos por meio de instalação real.
- [ ] Inicializar o projeto Android e revisar o Manifest gerado.
- [ ] Selecionar plugin/módulo nativo para Bluetooth clássico SPP (não BLE-only).
- [ ] Implementar pareamento, seleção, conexão, desconexão e envio ESC/POS.
- [ ] Auditar a rota e o fluxo reais de confirmação do Pix antes de conectar o gatilho de impressão.
- [ ] Implementar idempotência e controle de reimpressão no fluxo existente.
- [ ] Executar build, typecheck e testes automatizados.
- [ ] Compilar e testar APK em Android físico com impressora térmica real.

## Limitação operacional desta etapa

A auditoria e a documentação podem ser versionadas pelo GitHub. A sincronização `npx cap sync android`, a instalação npm, a compilação Gradle e os testes em hardware exigem um ambiente de execução Node/Android; não devem ser declarados executados apenas por alterar arquivos no GitHub.

## Auditoria do fluxo Pix existente (branch `main`)

A leitura dos módulos reais confirmou que já existe uma camada de domínio para confirmação/cancelamento, portanto a integração de impressão deve reutilizá-la e não criar uma segunda confirmação paralela:

- `src/modules/payments/confirm-payment.ts`: `confirmPixPayment` confirma pagamento e compra dentro de transação, valida igualdade dos valores, atualiza participações e gera um único `receiptCode`. Os resultados distinguem `confirmed` de `already_confirmed`; ambos devolvem o mesmo recibo persistido.
- `src/modules/payments/cancel-pending-pix-purchase.ts`: `cancelPendingPixPurchase` aplica estados terminais apenas a pagamentos ainda pendentes, com escrita condicional, transação serializável e auditoria.
- `src/modules/payments/mercado-pago.ts`: a consulta autenticada da Orders API usa o token exclusivamente no servidor; a classificação de sucesso exige pedido `processed`, pagamento `processed` e detalhe `accredited`. A validação da assinatura do webhook também está centralizada nesse módulo.
- `src/modules/payments/pix-terminal-race.postgres.integration.test.ts`: há testes de concorrência para confirmação versus cancelamento e para confirmações duplicadas, verificando recibo e auditoria únicos.

### Consequência para a impressão

O APK não deve chamar `confirmPixPayment`, acessar credenciais do Mercado Pago ou inferir sucesso pelo desaparecimento do QR Code. A impressão deve consumir o recibo já persistido e confirmado pelo servidor. O resultado `already_confirmed` não deve, por si só, provocar uma nova impressão automática em cada consulta/polling; reimpressão deve ser uma ação explícita. O mecanismo final para reservar/registrar uma única impressão automática ainda precisa ser definido depois de localizar a rota de API e a tela que consultam o pagamento.

### Pendência de auditoria de rotas

Os módulos de domínio foram identificados, mas a rota HTTP real e o componente de interface que exibem o QR Code/recibo ainda não foram confirmados nesta etapa. Não conectar o gatilho de impressão a uma rota presumida. Antes da implementação, localizar esses dois pontos no repositório e verificar autenticação, autorização do dono da compra e formato dos dados do recibo.

## Integração inicial do recibo do jogador

A auditoria encontrou uma lacuna funcional: a rota `GET /api/player/purchases/[purchaseId]/receipt` estava limitada a ADMIN/CASHIER, embora o jogador seja o dono da compra Pix; além disso, a interface de compra só montava o componente de recibo para CASHIER.

Correção aplicada na branch:

- A rota agora aceita PLAYER, mas consulta a compra com filtro simultâneo por `id` e `playerId`. Compra de outro jogador retorna 404.
- ADMIN continua podendo consultar; CASHIER continua restrito ao próprio `cashierId`.
- O polling do pagamento agora abre o componente de recibo oficial também para PLAYER quando `receiptReady` chega verdadeiro.
- Os testes da rota cobrem acesso do próprio jogador e bloqueio de recibo de outro jogador.

Limite desta entrega: isso libera a apresentação e impressão manual do recibo oficial já confirmado. Ainda não habilita impressão automática Bluetooth. A ponte nativa SPP/ESC-POS, a reserva idempotente da impressão automática e a reimpressão explícita ainda dependem da instalação do runtime Capacitor e do serviço nativo Android.

## Avaliação de transporte Bluetooth SPP (2026-11-05)

A comparação foi aprofundada no código Kotlin, Manifest, Gradle e metadados do pacote publicado:

- `@capacitor-community/bluetooth-le` foi descartado: implementa BLE/GATT, não Bluetooth clássico SPP/RFCOMM.
- `@kduma-autoid/capacitor-bluetooth-printer@0.2.1` é antigo e declara peer dependency Capacitor 6.
- `@devlas/capacitor-thermal-printer@0.8.1` realmente contém transporte SPP/RFCOMM com `BluetoothSocket`, usa dispositivos já pareados e solicita `BLUETOOTH_CONNECT` em Android 12+. O pacote publica bytes ESC/POS em Base64. A versão 0.8.1 aparece no catálogo npm; a página npm indexada ainda mostra 0.8.0 em parte do conteúdo.
- Apesar do README anunciar ausência de dependências nativas adicionais, o código Gradle atual do repositório inclui Kotlin Gradle Plugin/Kotlin stdlib 2.2.10, Android Gradle Plugin 8.2.1, AppCompat, USB serial 3.11.0 e repositório JitPack. O mesmo módulo contém funções além da impressão, como leitura de balança e servidor/túnel de impressão.

### Decisão revisada

**Não adicionar esse pacote diretamente ao Super Quina neste momento.** Embora o transporte Bluetooth funcione pelo desenho do código, a adoção traz uma superfície nativa maior que a necessidade do projeto e possíveis conflitos de resolução Gradle/Kotlin/JitPack com outros plugins Android. A versão ainda tem histórico público curto e a validação de hardware publicada pelo mantenedor não substitui teste com a impressora que será usada no Super Quina.

A direção preferida é uma ponte Capacitor Android mínima, isolada, com apenas:
- enumeração de dispositivos Bluetooth clássicos já pareados;
- solicitação de `BLUETOOTH_CONNECT` em Android 12+;
- conexão RFCOMM usando UUID SPP padrão;
- envio de bytes ESC/POS em Base64;
- erros estáveis para dispositivo ausente, permissão negada, falha de conexão e falha de escrita.

Não implementar descoberta por varredura Bluetooth se o pareamento pelo Android Settings resolver o fluxo; isso reduz permissões e complexidade. Não adicionar BLE, USB, TCP, modo host, balança ou JitPack para este requisito.

### Encoder e compatibilidade física

O recibo web atual é HTML/CSS e não deve ser enviado diretamente à impressora. É necessário um encoder ESC/POS separado que receba o objeto oficial retornado pela rota autenticada de recibo. Antes de fixar code page, largura, densidade, QR e corte, confirmar o modelo exato da impressora e executar impressão de teste. Até lá, não assumir que todas as térmicas de 58 mm usam a mesma tabela de caracteres ou os mesmos comandos.

### Estado de validação

- O código Kotlin/Manifest/Gradle do candidato foi inspecionado; não foi instalado no projeto.
- Nenhum pacote Capacitor foi adicionado ao `package.json` ou ao lockfile.
- Nenhuma plataforma Android foi sincronizada ou compilada.
- A ponte nativa própria ainda não foi criada; requer o projeto Android gerado e ambiente Node/Gradle/JDK para validar.
- A reserva idempotente da impressão automática continua pendente. A confirmação do pagamento e a disponibilidade do recibo seguem exclusivamente no backend.


## Estratégia universal de compatibilidade ESC/POS

O objetivo do Super Quina não é suportar uma impressora específica. O requisito é atender uma ampla variedade de impressoras térmicas que implementem Bluetooth clássico SPP/RFCOMM e comandos ESC/POS compatíveis.

Compatibilidade será tratada por capacidades e perfis, não por uma lista fixa de marcas/modelos:

- **Transporte:** Bluetooth clássico SPP/RFCOMM. BLE-only, Wi-Fi/TCP e USB não são considerados equivalentes ao requisito SPP.
- **Largura de papel:** perfis genéricos de 58 mm e 80 mm, calculando a largura imprimível conforme configuração, sem presumir colunas idênticas.
- **Comandos ESC/POS:** usar um subconjunto comum e conservador para inicialização, texto, alinhamento, ênfase e avanço. Recursos opcionais ficam isolados.
- **Acentuação:** code page configurável por perfil, com testes de caracteres portugueses. Não assumir tabela universal.
- **QR Code:** preferir comando nativo ESC/POS quando suportado; manter alternativa de renderização.
- **Corte:** opcional; sem cortador, finalizar com avanço de papel.
- **Densidade e velocidade:** não impor comandos específicos de fabricante como padrão.

SPP não garante identificação padronizada de largura, code page, QR ou cortador. Quando não houver negociação confiável, o app deve permitir selecionar perfil genérico e usar comandos conservadores, sem fingir detectar capacidades que o protocolo não informa.

A camada de encoder deve ser independente da ponte SPP e receber o DTO autenticado do recibo. A camada de transporte apenas envia bytes; não interpreta pagamento nem altera conteúdo financeiro.

### Matriz de validação

Validar impressoras representativas de diferentes fabricantes e firmwares, cobrindo 58 mm e 80 mm, SPP/RFCOMM, reconexão, acentuação portuguesa, números com zeros à esquerda, QR de verificação, dispositivos com e sem corte e falhas de conexão/escrita.

A meta é ampla interoperabilidade com o subconjunto ESC/POS comum, não uma promessa de compatibilidade absoluta com implementações proprietárias, firmware incompleto ou dispositivos que apenas anunciem compatibilidade.

## Diretriz de configuração aplicada ao Super Quina

Esta seção substitui qualquer exemplo genérico de hospedagem ou permissões que venha de instruções externas. Os valores abaixo são os do projeto e respeitam a arquitetura já existente.

### Configuração real de `capacitor.config.ts`

O arquivo já está criado na raiz e deve permanecer com esta configuração:

```ts
const config = {
  appId: "com.superquina.app",
  appName: "Super Quina",
  webDir: "www",
  server: {
    url: "https://superquina.com",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
```

Justificativas específicas:
- `https://superquina.com` é o domínio de produção do Super Quina na AquaCloud. Não usar `https://vercel.app` nem URL de exemplo.
- O Next.js continua executando no servidor. Não configurar `output: "export"`, não gerar site estático e não mover rotas de API para o APK.
- `webDir: "www"` é o diretório local exigido pelo CLI para a configuração atual; não é instrução para exportar o Next.js. Manter esse valor até a inicialização/sincronização real do Capacitor confirmar a estrutura necessária.
- Não habilitar `cleartext` nem `allowMixedContent`: produção usa HTTPS integralmente.
- O app continua usando as rotas remotas autenticadas por cookies/sessão. Não embutir credenciais do banco ou do Mercado Pago no aplicativo.

### Manifest Android: permissões mínimas para a primeira versão

O projeto Android ainda não foi gerado; portanto, ainda não existe `android/app/src/main/AndroidManifest.xml` para editar. Quando o Capacitor criar a plataforma, revisar o Manifest e adicionar dentro de `<manifest>`, antes de `<application>`, somente as permissões necessárias ao fluxo escolhido:

```xml
<uses-permission
    android:name="android.permission.BLUETOOTH"
    android:maxSdkVersion="30" />
<uses-permission
    android:name="android.permission.BLUETOOTH_CONNECT" />

<uses-feature
    android:name="android.hardware.bluetooth"
    android:required="false" />
```

Decisão funcional da primeira versão: o usuário pareia a impressora nas configurações Bluetooth do Android e o Super Quina lista/conecta dispositivos já pareados. Por isso:
- Não solicitar `BLUETOOTH_SCAN`, `ACCESS_FINE_LOCATION` ou `ACCESS_COARSE_LOCATION` sem implementar descoberta ativa de dispositivos próximos.
- Não solicitar `BLUETOOTH_ADMIN` se o app não iniciar pareamento/descoberta nem alterar configurações Bluetooth.
- Solicitar `BLUETOOTH_CONNECT` em tempo de execução no Android 12 (API 31) ou superior, tratar recusa e explicar ao usuário por que a permissão é necessária.
- A permissão legada `BLUETOOTH` fica limitada ao Android 11/API 30 e anteriores.
- Usar sempre o atributo XML `android:name`; a forma `android:permission="android:permission.BLUETOOTH"` do exemplo genérico está incorreta para declarar permissões.

Se uma etapa futura realmente exigir descoberta ativa, reavaliar separadamente permissões de scan e localização conforme o SDK-alvo e as versões Android suportadas. Não ampliar permissões preventivamente.

### Gatilho de impressão após Pix: sequência obrigatória

O pedido para imprimir automaticamente após o Pix é um objetivo funcional, não autorização para imprimir com base apenas na tela de sucesso. No Super Quina, a ordem de implementação é:

1. Preservar a confirmação definitiva no backend existente, incluindo reconciliação autenticada com o Mercado Pago e transação idempotente.
2. Usar o recibo oficial de `GET /api/player/purchases/[purchaseId]/receipt`, que valida sessão, propriedade e confirmação.
3. Implementar registro persistente de reserva única `AUTO_RECEIPT` por compra. A restrição única no banco impede duas instâncias/pollings de reservar o mesmo recibo.
4. Implementar encoder ESC/POS puro a partir do DTO oficial do recibo e perfis configuráveis de 58 mm/80 mm.
5. Implementar ponte Android RFCOMM/SPP e testar conexão, envio, falhas e reconexão em impressoras reais.
6. Só então conectar a reserva confirmada ao envio Bluetooth automático. Manter reimpressão manual explícita e separada.

Não disparar impressão a partir de `already_confirmed`, do desaparecimento do QR Code, da reabertura da tela ou de respostas repetidas do polling. Se o envio falhar em estado incerto, não repetir automaticamente: a impressora pode ter recebido os bytes. A compra e o pagamento permanecem confirmados independentemente da impressora.

### Limite de execução nesta alteração

A configuração do Capacitor já existente foi conferida e está alinhada com esta diretriz; não precisou ser substituída. O Manifest ainda não pode ser editado porque a plataforma Android não existe na branch. Também não executar `npx cap sync android` até instalar Capacitor com atualização real e coerente de `package.json`/ `package-lock.json` e inicializar a plataforma Android em ambiente Node/Gradle/JDK.


## Regras adicionais de segurança e confiabilidade

Esta seção prevalece sobre exemplos genéricos anteriores quando houver divergência.

- Primeira versão: conectar somente a impressoras já pareadas pelo Android Settings. Android 12/API 31+: solicitar `BLUETOOTH_CONNECT`; Android 11/API 30 e anteriores: permissão legada `BLUETOOTH` limitada a API 30. Não solicitar `BLUETOOTH_SCAN`, localização, `BLUETOOTH_ADMIN` ou `BLUETOOTH_ADVERTISE` sem implementar e justificar descoberta/pareamento ativo.
- Solicitar permissão Bluetooth apenas quando o usuário iniciar configuração ou impressão. Recusa não pode bloquear login nem consulta de compras.
- WebView: manter TLS validado, HTTPS e conteúdo misto desabilitado. Restringir navegação principal a `https://superquina.com`; links externos abrem no navegador do sistema. A ponte nativa só pode ser invocada por conteúdo confiável. Não aceitar certificados inválidos nem expor ponte JavaScript a páginas arbitrárias.
- Preservar cookies/sessão do site e testar login, expiração, logout e retorno do segundo plano em aparelho real. Toda rota valida sessão, autorização e propriedade no servidor; ID enviado pelo cliente não concede acesso.
- Nunca embutir segredos, tokens ou credenciais Mercado Pago no APK. Não registrar cookies, tokens ou conteúdo sensível do recibo.
- Ponte SPP mínima: listar pareados, conectar RFCOMM, enviar bytes ESC/POS em Base64 e desconectar. Aplicar timeout, impedir escritas concorrentes no mesmo socket, liberar recursos e normalizar erros de permissão, Bluetooth desligado, dispositivo ausente, conexão, desconexão e escrita.
- Sucesso de escrita significa somente que os bytes foram entregues ao socket, não que o papel foi impresso. Diferenciar estados persistentes `RESERVED`, `SENDING`, `SENT`, `FAILED` e `UNKNOWN`. Nunca repetir automaticamente `SENDING`, `SENT` ou `UNKNOWN`; resultado incerto exige decisão manual. Reimpressão deve ser autorizada, auditada e identificada como segunda via.
- Encoder ESC/POS deve ser TypeScript puro e testável, receber apenas DTO oficial autenticado, preservar zeros à esquerda e valores em centavos sem recálculo em ponto flutuante. Perfis 58/80 mm configuram largura imprimível e code page; acentos, cedilha, QR e corte exigem testes por firmware. Não prometer compatibilidade absoluta.
- Distinguir pagamento confirmado, recibo disponível, impressora conectada e envio concluído. Retorno do segundo plano deve consultar o servidor e nunca reimprimir por reabertura. Falha de impressora não altera pagamento.
- Critérios de aceite: testes unitários de bytes/acentos/limites; concorrência da reserva no PostgreSQL; autorização de PLAYER/CASHIER/ADMIN; permissões concedidas/negadas; falhas e timeout SPP; aparelhos reais 58/80 mm com e sem corte; versões Android suportadas; lint, typecheck, testes e builds web/Android.
- Assinatura do APK deve usar chaves e senhas fora do repositório e do binário, via secrets protegidos. Validar instalação e atualização. O app remoto depende de domínio, TLS, rede e disponibilidade do site; não prometer operação offline completa.

## Registro persistente de impressão — primeira camada

Na branch `main` foi criada a estrutura persistente para separar o estado financeiro do estado físico da impressora:

- `PrintJob` registra compra, finalidade, estado, dispositivo e timestamps.
- `AUTO_RECEIPT` usa `autoReceiptKey = purchaseId` com restrição única no PostgreSQL. Polling ou duas instâncias concorrentes não podem reservar duas impressões automáticas para a mesma compra.
- `MANUAL_REPRINT` sempre cria um novo registro, sem reutilizar a chave automática, preservando auditoria de cada reimpressão.
- A reserva automática verifica compra confirmada, código de recibo, data de confirmação e confirmação do pagamento Pix. A validade segue o limite de sete dias já aplicado pela rota oficial.
- O serviço valida o proprietário para reimpressão manual (PLAYER/CASHIER) e permite ADMIN, sem expor a existência de compras alheias.
- A máquina de estados permite `RESERVED -> SENDING -> SENT|FAILED|UNKNOWN`. Falha de codificação pode ser registrada como `FAILED` antes do envio. `SENDING`, `SENT` e `UNKNOWN` não são reiniciados automaticamente.

Arquivos adicionados:
- `prisma/migrations/20261105010000_print_job_ledger/migration.sql`
- `src/modules/printing/print-job-service.ts`
- `src/modules/printing/print-job-service.test.ts`

A tela de compra também passou a impedir consultas de status simultâneas: se uma requisição de polling ainda estiver em andamento, a próxima verificação de três segundos é ignorada.

### Limites desta camada

A estrutura do banco e o serviço de domínio estão preparados, mas ainda não há rota HTTP que reserve o job nem integração com a ponte Bluetooth. Não disparar impressão automática até implementar e validar os endpoints autenticados, a ponte SPP e o tratamento do resultado de escrita. Em caso de resultado de transporte incerto, registrar `UNKNOWN` e exigir ação explícita do usuário; não repetir automaticamente.

### Endpoints internos do ledger

Foram acrescentadas rotas autenticadas para preparar a integração nativa:

- `POST /api/purchases/[purchaseId]/print-jobs/auto`: valida propriedade (ou ADMIN), confirma que o recibo está pronto e reserva/recupera a reserva única `AUTO_RECEIPT`. A resposta indica se o registro foi criado e seu estado. Uma reserva existente não significa que a impressão foi enviada.
- `POST /api/purchases/[purchaseId]/print-jobs/manual`: cria um novo job `MANUAL_REPRINT` após validar sessão, propriedade e prazo do recibo.
- `POST /api/print-jobs/[jobId]/transition`: permite ao proprietário ou ADMIN avançar o estado com transições condicionais no banco. Códigos de falha são uma lista fechada; mensagens/exceções brutas do Android não são armazenadas.

O cliente nativo deverá primeiro reservar/recuperar o job e, imediatamente antes de enviar bytes, disputar a transição atômica `RESERVED -> SENDING`. Apenas quem conseguir essa transição pode iniciar a escrita. Depois deverá registrar `SENT`, `FAILED` ou `UNKNOWN`. Um job `SENDING` que ficou sem resultado não deve ser reenviado automaticamente.

Essas rotas ainda não estão ligadas ao polling ou a um transporte Bluetooth; são a API de controle e auditoria para a próxima etapa. O site continua oferecendo a impressão HTML atual até a ponte nativa ser implementada.
