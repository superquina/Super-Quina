# Plano de implementacao do APK Super Quina

## Decisao de produto

Vamos manter duas camadas bem separadas:

- **Aplicativo Android:** interface WebView do Super Quina e ponte nativa Bluetooth Classic SPP.
- **Servidor/site:** login, sessoes, dados, pagamentos, autorizacao do recibo e registro do trabalho de impressao.

O APK nao deve duplicar regras financeiras nem guardar segredos do servidor.

## O que o repositorio ja tem

- Projeto web Next.js e Capacitor.
- Plugin Android local `plugins/rawbt-printer` com listagem de dispositivos pareados, conexao RFCOMM/SPP e envio serializado de bytes.
- Workflow GitHub Actions para compilar um APK de depuracao.
- A configuracao atual do Capacitor aponta para `https://superquina.com`. Isso abre o site hospedado dentro do app, mas nao incorpora uma copia offline do site no APK.

## Caminho A — site dentro do APK (primeira tentativa)

A WebView carrega o site hospedado, mantendo APIs, login e recibos no servidor. O plugin nativo oferece a impressora ao site. Esse caminho ja esta parcialmente representado pela configuracao Capacitor atual.

**Importante:** "abrir o site dentro do APK" nao significa que o site inteiro esta empacotado/offline. O site atual usa Next.js e rotas de servidor; empacotar tudo localmente exigiria exportacao estatica ou uma arquitetura hibrida, e as rotas autenticadas continuariam precisando do servidor.

## Caminho B — APK-ponte independente (plano de contingencia)

Se a WebView integrada causar incompatibilidade, o APK sera pequeno e dedicado a:
- parear/selecionar impressora Bluetooth;
- conectar via RFCOMM/SPP;
- receber do site somente o payload de impressao autorizado;
- transmitir ESC/POS e devolver sucesso/erro de transporte.

O site continua aberto normalmente no navegador e chama a ponte por uma integracao Android definida e segura.

## Auditoria obrigatoria antes de copiar ou reconstruir

1. Inventariar o ZIP do JADX: pacotes, classes, XML, assets, bibliotecas, Gradle e manifest.
2. Marcar cada componente como referencia, codigo aberto com licenca verificada, ou proprietario/nao reutilizavel.
3. Nao importar classes/recursos proprietarios do RawBT para o app Super Quina.
4. Comparar o servico Android PrintService do RawBT com o plugin SPP atual. O fluxo escolhido deve ser unico e testado; nao manter caminhos paralelos sem necessidade.
5. Testar permissao Bluetooth, pareamento, reconexao, escrita em blocos, acentos, QR Code, avancos e corte na impressora fisica.
6. Validar o fluxo do recibo real, incluindo estados RESERVED/SENDING/SENT/FAILED/UNKNOWN e bloqueio de reenvio automatico quando o resultado for incerto.

## Criterio de conclusao

So declarar pronto depois de compilar o APK, instalar em Android fisico, abrir o site, selecionar a impressora e imprimir um recibo oficial de teste. Envio aceito pelo socket nao e prova de que o papel saiu.
