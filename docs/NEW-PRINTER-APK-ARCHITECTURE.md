# Arquitetura — aplicativo de impressão Super Quina

Data: 08/11/2026
Status: implementação parcial. Fluxo direto SPP definido; PrintService e chamada ao Print Framework removidos. Perfil por impressora, página de teste e envio em blocos com pausa implementados nesta etapa. Build final e impressão física ainda pendentes.

## Objetivo e limite
Criar um aplicativo Android próprio, inspirado no comportamento de configuração de impressoras do RawBT 7.0.2, para uso exclusivo com o site Super Quina. Não copiar código, marca, recursos visuais proprietários nem contornar licenças. O APK terá uma interface de gerenciamento de impressoras e uma WebView para o site. Não terá editor de documentos, editor de imagens, galeria, gerenciador de arquivos, conversor nem impressão genérica de arquivos. O recibo oficial continuará sendo criado e autorizado pelo site.

## Decisão técnica: um único caminho de impressão
A implementação anterior continha dois caminhos concorrentes. Nesta etapa, o manifesto deixou de registrar o PrintService e a ponte Capacitor deixou de expor printCurrentWebView(). Os arquivos órfãos do PrintService e a antiga atividade de configuração foram removidos do branch; o manifesto não registra atividade de impressão.

O caminho escolhido é plugin Capacitor + encoder ESC/POS oficial + Bluetooth Classic SPP:
1. O site autentica o usuário e disponibiliza o DTO oficial de recibo confirmado.
2. O encoder ESC/POS do Super Quina gera os bytes.
3. O usuário escolhe a impressora e seu perfil salvo.
4. O plugin nativo conecta por RFCOMM/SPP e transmite os bytes.
5. O resultado de transporte é registrado no fluxo de impressão existente.
6. Falha durante transmissão pode deixar o resultado físico incerto; nunca repetir automaticamente.

O Android Print Framework/PrintService, printCurrentWebView() e PDF rasterizado não fazem parte do fluxo final. O manifesto, as interfaces e os arquivos nativos não mantêm mais esse caminho.

## Interface inspirada nas telas de referência
- Adicionar impressora.
- Método de conexão: Bluetooth habilitado na primeira versão; Wi-Fi/Ethernet e USB ficam planejados/ocultos até implementação. AIDL/POS fica fora do primeiro escopo.
- Lista de dispositivos pareados com nome e endereço.
- Escolha de driver/protocolo. ESC/POS geral é o primeiro driver ativo. Não exibir protocolos sem encoder e transporte testados.
- Perfil de papel individual por endereço Bluetooth da impressora, salvo localmente no dispositivo Android; cada perfil define largura, colunas e fonte ESC/POS A/B.
- Página de teste ESC/POS sem reservar job e sem consultar/alterar recibos financeiros.
- Botão Imprimir teste, que envia teste ESC/POS sem dados financeiros nem criação de job de recibo.
- Envio nativo em blocos de 256 bytes, com flush e pausa curta entre blocos para reduzir risco de saturação do buffer em impressoras de entrada.
- Campos de nome e descrição.
- Salvar/selecionar impressora padrão, reconectar e desconectar.
- Mensagens claras de permissão, Bluetooth desligado, impressora indisponível e falha de transmissão.

## Modelo de perfil de impressora
Persistir por endereço/identidade do dispositivo: identificador e nome amigável; tipo de conexão; driver/protocolo; largura nominal do papel e largura imprimível em pontos; DPI horizontal/vertical; colunas de texto; página de códigos e mapa de caracteres; avanço final; corte (desabilitado por padrão, ativado só se suportado); densidade/limiar de raster quando aplicável; perfil padrão e data de atualização.

Não usar largura fixa global de 58 mm. Opções candidatas da referência: 58 mm, 58 mm Max, 80 mm, 80 mm Max, 110 mm e bobina contínua. Cada opção precisa mapear para largura útil e limites reais da impressora. Não habilitar opção apenas por aparecer na referência. Largura nominal do rolo não é igual à largura imprimível.

## Drivers
Primeiro perfil funcional: ESC/POS geral. Outros perfis só podem ser ativados após implementação e teste: GS v 0 only, Peripage, Paperang, CPCL, EPL, TSPL, ZPL e demais perfis de fabricante. Driver deve ser independente do transporte.

## Transportes
- Bluetooth Classic SPP/RFCOMM: primeira versão.
- Wi-Fi/Ethernet: futuro; requer endereço/porta e transporte socket validado.
- USB: futuro; requer USB Host, descoberta VID/PID e permissões.
- BLE: não presumir compatibilidade com impressoras SPP; protocolo GATT específico precisa ser implementado.
- AIDL/POS: fora do escopo inicial, depende do SDK do terminal.

## Estado real do código auditado
- Plugin Capacitor possui listagem de pareados, connect, send, disconnect e getConnectionState.
- Encoder ESC/POS do site suporta perfil 58/80 mm, colunas, code page/mapa, QR, avanço e corte.
- ThermalBluetoothPrinter lista dispositivos pareados, conecta/desconecta, envia recibo oficial e possui página de teste sem reserva financeira.
- Perfis são persistidos por endereço Bluetooth; cada impressora mantém sua própria largura, quantidade de colunas e seleção da fonte ESC/POS A/B.
- O plugin envia em blocos de 256 bytes com pausa de 30 ms entre blocos; é uma proteção conservadora inicial, que precisa ser ajustada com a impressora real.
- ThermalReceipt é o componente visual do recibo; a ponte printCurrentWebView() foi removida das interfaces e do plugin nativo.
- A antiga classe SuperQuinaPrintService.java, o XML correspondente e PrinterSetupActivity.java foram removidos; a antiga orientação para habilitar serviço de impressão não permanece no APK.
- O perfil da impressora é carregado pela interface e aplicado ao encoder; a configuração fica individual por dispositivo pareado.
- A tela nativa atual só solicita permissão e não implementa o gerenciador mostrado nas imagens.
- Não há evidência de build Android ou teste físico aprovado nesta etapa.

## Plano de implementação
1. [Concluído parcialmente] Retirar o registro do PrintService e a API printCurrentWebView() do manifesto, plugin e interfaces.
2. [Implementado; falta validar em aparelho] Integrar UI ao plugin: listar, selecionar, conectar, testar, salvar perfil e desconectar.
3. [Implementado] Persistir perfil por impressora e permitir seleção de papel 58/80 mm e colunas personalizadas.
4. [Implementado] Página de teste ESC/POS sem reserva de recibo; validar comunicação e largura útil na impressora real.
5. Validar acentos, QR, densidade, avanço, corte e recibo completo na impressora real.
6. Adicionar Wi-Fi/Ethernet e USB somente se houver necessidade e hardware para teste.
7. Rodar lint, typecheck, testes e build do APK; instalar e testar em aparelho real.
8. Não mesclar em main nem publicar sem autorização.

## Critério de conclusão
Só considerar concluído após build reproduzível, cadastro/seleção do dispositivo, teste de impressão, recibo oficial impresso corretamente e confirmação de que erros não provocam duplicidade automática.
