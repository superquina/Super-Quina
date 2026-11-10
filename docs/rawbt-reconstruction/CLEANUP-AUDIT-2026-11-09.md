# Auditoria de redução do APK de impressão — Super Quina

Data: 09/11/2026
Branch de trabalho: feature/superquina-rawbt-rebuild

## Objetivo

Reduzir o produto Android a um único propósito: abrir o site Super Quina e permitir que o recibo oficial seja enviado a uma impressora térmica Bluetooth. O APK não será um aplicativo genérico de impressão nem um clone de interface de terceiros.

## O que foi confirmado no APK de referência

A exportação JADX 1.5.6 contém:
- serviços de impressão e transporte Bluetooth;
- camadas de driver ESC/POS, codificação, QR Code e código de barras;
- drivers e transportes adicionais para BLE, USB, rede/TCP, serial, AIDL/POS e linguagens CPCL, EPL, TSPL e ZPL;
- compra de versão Premium/licença por Google Play Billing;
- telas de licença, compra Premium e limites da versão gratuita;
- fluxo de impressão de arquivos compartilhados, PDF, PRN e documentos;
- visualizador PRN/documento, pré-visualização e impressão genérica;
- editor de conteúdo, modelos e templates;
- edição/corte de imagens, seleção de imagem e envio para galeria;
- atividades de configuração extensiva e depuração.

A presença de componentes no APK não prova que todos sejam necessários ao nosso caso. O projeto decompilado também não é um projeto Gradle pronto para recompilar.

## Matriz de decisão

| Recurso encontrado | Decisão Super Quina | Motivo |
|---|---|---|
| Bluetooth Classic SPP/RFCOMM | MANTER | Transporte necessário para a impressora térmica Bluetooth |
| Lista de dispositivos pareados | MANTER | Seleção simples da impressora |
| Conectar/desconectar e estado | MANTER | Operação básica da ponte |
| ESC/POS | MANTER COMO IMPLEMENTAÇÃO PRÓPRIA | Linguagem necessária para o recibo |
| QR Code no recibo | MANTER | Parte do recibo oficial |
| Codificação de caracteres | MANTER, REDUZIDA | Necessária para português e acentuação |
| Corte e avanço de papel | MANTER COMO OPÇÕES TESTADAS | Dependem do modelo físico |
| BLE/GATT | EXCLUIR DA PRIMEIRA VERSÃO | Não substitui SPP nas impressoras alvo |
| USB, serial, AIDL/POS, HID | EXCLUIR | Não fazem parte do cenário atual |
| Wi-Fi, TCP, WebSocket e impressão em rede | EXCLUIR | Fora do escopo |
| CPCL, EPL, TSPL, ZPL e drivers específicos | EXCLUIR | Não necessários para o primeiro modelo ESC/POS |
| Google Play Billing, Premium e compra de licença | EXCLUIR | O Super Quina não venderá recursos de impressão dentro do APK |
| Tela de licença e limites de versão gratuita | EXCLUIR | Não fazem parte do produto |
| Editor de texto/documento e templates | EXCLUIR | O recibo vem pronto do site |
| Editor/corte de imagem e galeria | EXCLUIR | Não imprimiremos imagens arbitrárias |
| Visualizador PDF/PRN e impressão de documentos | EXCLUIR | Não haverá abertura de arquivos externos |
| Compartilhamento genérico e intents de impressão de terceiros | EXCLUIR | O fluxo parte do recibo autenticado do site |
| Terminal, emulador e telas de debug do produto | EXCLUIR DA INTERFACE FINAL | Ferramentas internas não devem aparecer ao usuário |
| Site Super Quina e autenticação | MANTER | O site continua sendo a interface e a fonte oficial dos dados |
| Venda/apostas, caixa e financeiro do site | MANTER NO SITE | São funções do produto web; não são a compra Premium do RawBT |
| Ledger de trabalhos de impressão | MANTER | Protege contra duplicidade e permite auditoria |
| Reimpressão explícita | MANTER | Deve ficar registrada como segunda via |

## Mudanças aplicadas no código ativo da branch

1. O plugin Capacitor foi movido de plugins/rawbt-printer para plugins/superquina-printer.
2. O pacote local foi renomeado para @superquina/printer-bridge.
3. A classe Android foi renomeada para SuperQuinaPrinterPlugin.
4. A ponte TypeScript foi renomeada para superquina-printer-bridge.ts e a função de acesso passou a getSuperQuinaPrinter().
5. O componente de impressão foi atualizado para usar o novo contrato.
6. O workflow de APK deixou de ser disparado pela branch antiga rawbt-inspired e acompanha o diretório novo do plugin.
7. O README do módulo descreve somente o produto Super Quina e lista explicitamente o que fica fora do escopo.

## Arquitetura final pretendida

Site Super Quina autenticado
→ endpoint de recibo oficial confirmado
→ encoder ESC/POS próprio
→ plugin Capacitor SuperQuinaPrinter
→ Bluetooth Classic RFCOMM/SPP
→ impressora térmica.

O APK não faz venda, pagamento, cálculo de prêmio, criação autônoma de recibo ou abertura de documentos. O servidor permanece responsável por autenticação, pagamentos, conteúdo do recibo e estado do trabalho de impressão.

## Limite jurídico e de integridade

O ZIP de referência e sua exportação decompilada permanecem material de auditoria, não código do produto. Não removemos avisos de copyright/licença, não alteramos o APK de terceiro para ocultar sua origem e não copiamos sua interface proprietária. A limpeza foi feita no código ativo do Super Quina, com implementação própria.

## Validação ainda necessária

- Atualizar/regenerar o package-lock.json com a nova dependência local.
- Rodar instalação limpa, typecheck, lint e testes.
- Sincronizar Capacitor e compilar APK Android.
- Testar pareamento, reconexão, permissão Bluetooth, 58 mm/80 mm, acentos, QR Code, avanço e corte na impressora física.
- Confirmar que nenhum menu de edição, documento, galeria, compra ou licença aparece no APK final.
- Não considerar impressão concluída apenas porque o socket aceitou os bytes.
