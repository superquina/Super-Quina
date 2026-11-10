# Padrão técnico de referência — RawBT

Data da auditoria: 08/11/2026  
Arquivo de referência: `RawBT.apk` (5.747.888 bytes)  
Objetivo: transformar a arquitetura e o comportamento observável do RawBT em uma lista de verificação para auditar o Super Quina. Este documento descreve requisitos e evidências, não autoriza copiar código, recursos, marca ou componentes proprietários.

## Regras da auditoria

- O RawBT é a referência primária de arquitetura e comportamento.
- O APK Super Quina enviado é apenas uma amostra para comparação, não define o padrão.
- Distinguir sempre: **confirmado no APK**, **inferido**, **ainda não verificado em execução**.
- Não implementar recurso só porque existe no RawBT: primeiro classificar se é necessário para o cenário Super Quina (site + recibo oficial + impressora térmica Bluetooth).
- Não alterar a branch `main`, regras financeiras ou o fluxo de pagamentos.
- Não considerar um recurso concluído sem teste reproduzível no Android e, quando envolver impressão, saída física na impressora.

## 1. Entrada de trabalhos de impressão

**Padrão observado**
- O RawBT apresenta-se ao Android como destino de impressão/compartilhamento.
- O recurso `res/xml/printservice.xml` declara o serviço e suas Activities de configuração e descoberta.
- O DEX contém `RawBtService`, `AbstractRawBtPrintService`, `IRawBtPrintService`, `RawbtPrintJob` e referências ao Android `PrintJob`.
- O DEX contém callbacks do Android Print Framework, incluindo fila de trabalhos.

**Checklist**
- [ ] Serviço declarado no Manifest com a ação e metadados corretos.
- [ ] XML de print-service associado ao serviço.
- [ ] Sessão de descoberta criada e encerrada corretamente.
- [ ] Impressoras publicadas ao Android com IDs estáveis.
- [ ] Trabalho recebido, acompanhado, concluído ou falhado corretamente.
- [ ] Cancelamento do trabalho tratado.
- [ ] Erros comunicados ao Android sem marcar sucesso prematuramente.

## 2. Descoberta e cadastro de impressoras

**Padrão observado**
- O RawBT tem camada de modelo persistente para impressoras.
- A tabela encontrada contém campos como nome, descrição, impressora atual, protocolo, MAC, host/porta, VID/PID, driver/perfil, largura em pontos, DPI, linguagem de impressão e página de códigos.

**Checklist**
- [ ] Descobrir impressoras compatíveis com o transporte selecionado.
- [ ] Permitir selecionar e identificar a impressora.
- [ ] Persistir configuração por dispositivo.
- [ ] Manter uma impressora padrão/atual.
- [ ] Validar disponibilidade antes de enviar trabalho.
- [ ] Exibir estado de conexão e erros de forma compreensível.

## 3. Modelo de perfil de impressão

**Padrão observado**
- O modelo de impressora inclui protocolo, driver/perfil, largura em pontos, DPI, linguagem, code page, comandos gráficos, linhas de avanço, corte, densidade e dithering.
- O APK contém famílias/perfis distintos (por exemplo, perfil ESC/POS geral e perfis específicos de fabricantes).
- O APK contém opções de papel contínuo, incluindo variantes de rolo.

**Checklist**
- [ ] Perfil separado do transporte.
- [ ] Largura útil em pontos/colunas configurável.
- [ ] DPI compatível com a impressora.
- [ ] Linguagem/protocolo de impressão identificado.
- [ ] Página de caracteres configurável e validada para português.
- [ ] Papel em rolo/contínuo com comprimento variável.
- [ ] Margens e avanço configuráveis.
- [ ] Corte automático configurável apenas quando suportado.
- [ ] Perfil específico não deve ser aplicado automaticamente a impressora desconhecida.

## 4. Pipeline de conversão do documento

**Padrão observado**
- O APK inclui um conjunto extenso de comandos ESC/POS e renderização: texto, alinhamento, modos de fonte, códigos de barras, QR, gráficos raster, alimentação, corte e comandos específicos.
- O DEX contém componentes separados para emulação/renderização e comandos de impressora.

**Checklist**
- [ ] Entrada do documento claramente definida.
- [ ] Conversão consistente para a linguagem da impressora.
- [ ] Texto, acentos e code page tratados explicitamente.
- [ ] Largura e escala respeitam o papel selecionado.
- [ ] QR Code e códigos de barras usam comandos compatíveis ou rasterização.
- [ ] Imagens convertidas com largura/DPI corretos.
- [ ] Avanço final e corte só quando aplicável.
- [ ] Não imprimir conteúdo de demonstração ou marca de terceiros no recibo Super Quina.

## 5. Camada de transporte

**Padrão observado**
- O RawBT tem abstrações de impressão e várias classes de transporte/protocolo no DEX.
- A presença de classes de BLE, USB, rede ou outros drivers não prova que todos sejam necessários ao cenário Super Quina.

**Checklist para o primeiro escopo Super Quina**
- [ ] Bluetooth Classic RFCOMM/SPP.
- [ ] Permissões e ciclo de vida Android corretos.
- [ ] Seleção do dispositivo e conexão com serviço serial suportado.
- [ ] Escrita integral do trabalho e tratamento de desconexão.
- [ ] Resultado de transporte não confundido com confirmação física de papel.
- [ ] Sem repetição automática quando o resultado da transmissão for incerto.

## 6. Configuração e experiência Android

**Padrão observado**
- O XML do serviço RawBT aponta para uma Activity de configurações e outra de descoberta de impressoras.
- O DEX contém telas de perfil e configuração de impressora.

**Checklist**
- [ ] Tela de configuração acessível a partir das configurações do serviço Android.
- [ ] Fluxo de adicionar/descobrir impressoras.
- [ ] Seleção de perfil e papel.
- [ ] Estado do serviço compreensível.
- [ ] Mensagens de permissão e ativação claras.
- [ ] A configuração não deve exigir criar ou editar manualmente o recibo.

## 7. Integração com o site Super Quina

**Adaptação necessária — não é uma exigência do RawBT**
- O recibo oficial continua sendo criado, exibido e autorizado pelo site.
- O usuário aciona imprimir a partir do recibo no site.
- O Android recebe o trabalho por uma integração compatível com o Print Framework; o serviço nativo processa e encaminha à impressora.
- Não criar uma tela de edição/geração de recibo no APK.
- Preservar autorização, autenticação e controle de PrintJob do site.
- Não modificar pagamentos, prêmios, comissões ou regras financeiras.

**Checklist**
- [ ] O recibo exibido no site é a origem dos dados impressos.
- [ ] A ação do site encaminha um trabalho ao mecanismo Android pretendido.
- [ ] O PrintService recebe o trabalho e obtém o documento.
- [ ] O documento é convertido para o perfil de impressora selecionado.
- [ ] O estado do trabalho é atualizado corretamente.
- [ ] Falhas não causam duplicação automática.
- [ ] Teste ponta a ponta a partir do site, sem baixar/editar o recibo.

## 8. Evidências estáticas confirmadas no APK RawBT

- ZIP do APK contém `AndroidManifest.xml`, `classes.dex`, `res/xml/printservice.xml`, `assets/app/index.html`, `app.js`, `app.css` e biblioteca de codificação.
- DEX contém `ru.a402d.rawbtprinter.RawBtPrintService`, `ru.a402d.rawbtprinter.printservice.RawBtService`, `rawbt.sdk.AbstractRawBtPrintService`, `rawbt.sdk.IRawBtPrintService`, `rawbt.sdk.RawbtPrintJob` e classes de perfil/ESC-POS.
- DEX referencia Android `PrintJob`, `PrinterInfo`, `PrinterCapabilitiesInfo`, `PrintService` e `PrinterDiscoverySession`.
- XML binário `res/xml/printservice.xml` contém referências a `SettingsActivity` e à Activity de descoberta `ru.a402d.rawbtprinter.activity.Magic`.
- A página embarcada descreve receber textos/imagens por ações de compartilhar/enviar/abrir e escolher RawBT como destino.
- O código JavaScript de demonstração contém exemplos de texto, alinhamento, fontes, codificação, barcode, QR e envio por intent `rawbt:`.

**Limites da evidência**
- Esta auditoria é estática. Não houve execução instrumentada, captura de tráfego ou inspeção completa do fluxo em runtime.
- Strings e nomes de classes não comprovam por si só a ordem exata de execução nem o comportamento de cada driver.
- A inspeção do APK não autoriza copiar implementação proprietária nem contornar licenciamento.

## 9. Escopo que não precisa ser reproduzido inicialmente

- BLE, USB, Wi-Fi/rede e protocolos especializados, salvo necessidade comprovada.
- Drivers de fabricantes que não sejam o modelo térmico usado no Super Quina.
- Recursos comerciais, contas, anúncios, marca, telemetria ou demonstrações do RawBT.
- Funções de edição/compartilhamento genérico que não façam parte do fluxo de recibo do site.

## 10. Critério de aprovação

Um item só passa a **Conforme** quando:
1. há implementação correspondente no Super Quina;
2. a implementação está ligada ao fluxo real, não apenas a uma classe/arquivo isolado;
3. há evidência de build e execução;
4. para impressão, o recibo real sai fisicamente com largura, escala, acentos e QR corretos.

Estados permitidos na comparação: **Conforme**, **Parcial**, **Ausente**, **Não aplicável**, **Não verificado**.


## Evidências adicionais das telas fornecidas pelo usuário

As imagens do RawBT mostram: cadastro com Bluetooth, Wi-Fi/Ethernet, USB e AIDL para terminais POS; famílias de papel 110 mm Roll, 58 mm Roll, 58 mm Roll Max, 80 mm Roll, 80 mm Roll Max, A4 e variantes contínuas; seleção da impressora por nome e endereço Bluetooth; Bluetooth e BLE; seleção de driver ESC/POS geral, GS v 0 only, Peripage, Paperang, CPCL, EPL, TSPL, ZPL e raw transfer; botão de teste; campos de nome e descrição.

As imagens comprovam a presença dessas opções na interface observada, mas não que todos os protocolos funcionem com a impressora Super Quina. O Super Quina deve habilitar somente métodos, tamanhos e drivers implementados e testados. Editores de texto, documentos e imagens ficam excluídos.
