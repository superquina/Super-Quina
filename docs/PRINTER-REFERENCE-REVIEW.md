# Revisão das referências de impressão térmica

Data: 08/11/2026  
Projeto: Super Quina — branch `feature/rawbt-inspired-printer-core`

## Critério de seleção

O aplicativo Super Quina não deve virar um aplicativo genérico de impressão. O site continua sendo a fonte oficial do recibo, da autorização de impressão e do histórico. Do material de terceiros, aproveitamos apenas padrões técnicos comprováveis de transporte Bluetooth, ESC/POS, perfis e compatibilidade. Não copiamos interface proprietária nem incorporamos dependências sem necessidade/licença revisada.

## Inventário recuperado das análises anteriores

Os registros anteriores preservaram os nomes abaixo, mas não preservaram os URLs de todos os repositórios. Para não atribuir um projeto incorreto, links não confirmados são identificados como pendentes de recuperação.

| Referência | URL confirmada | Contribuição anotada / decisão |
|---|---|---|
| RawBT Print Service 7.0.2 (APK testado pelo usuário) | APK local: `rawbt-print-service-7-0-2(1).apk`; URL do repositório não recuperada | Referência prática principal. O usuário testou a impressora Goldensky MTP5 com esse app e obteve impressão funcional. Aproveitar seleção de impressora, transporte e fluxo de impressão; excluir editores de documento/imagem, galeria e recursos genéricos. |
| Open ESC/POS Print Service | https://github.com/farminos/open-escpos-print-service | PrintService Android para ESC/POS e CPCL, Bluetooth/TCP. Útil como referência de integração com o framework Android, mas **não** adotar como caminho do Super Quina: o teste anterior baseado em PrintService compilava, mas o botão não imprimia. Licença GPLv3 exige avaliação antes de qualquer incorporação. |
| DantSu ESC/POS ThermalPrinter Android | https://github.com/DantSu/ESCPOS-ThermalPrinter-Android | Biblioteca ESC/POS com transporte Bluetooth/TCP/USB, dimensões de impressora, codificação configurável, QR e códigos de barras. Referência técnica forte para encoder, charset e capacidades; não é necessário adicionar a biblioteca inteira porque o Super Quina já mantém encoder próprio e precisa de um fluxo de recibo estritamente controlado. Licença MIT, ainda assim revisar antes de copiar código. |
| DPThermal Android | URL exata não recuperada | Anotações anteriores associaram o projeto a fila, integração com site e histórico. Usar apenas esses conceitos de fluxo; não assumir implementação ou licença sem localizar o repositório original. |
| Android-Thermal-Bluetooth-Print | URL exata não recuperada | Referência de impressão térmica Bluetooth Android citada na análise anterior. Código, licença e detalhes de implementação precisam ser reconfirmados pelo URL original. |
| Printama | URL exata não recuperada | Referência anterior para configuração e formatação de impressão. Não copiar interface nem presumir suporte de protocolo sem recuperar o repositório. |
| PrinterKit | URL exata não recuperada | Nome preservado no inventário anterior; não há detalhe técnico ou licença suficiente no registro atual para atribuir uma implementação específica. |
| Impressora universal Bluetooth (usuário GitHub: vasarely-ops) | URL exata não recuperada | Referência anotada para SPP, persistência/reconexão, ESC/POS, QR/barcode/imagens. Evitar AIDL/POS, largura fixa de 384 dots e CP437 como única codificação. |
| Kasabeh | URL exata não recuperada | Referência anotada anteriormente para compatibilidade; faltam URL e evidência técnica específica para comparação de código. |

**Limite da auditoria histórica:** os nomes acima foram recuperados das notas anteriores. Não foi possível recuperar os URLs nem os arquivos-fonte de todos os itens. Portanto, não afirmamos ter reaberto ou revalidado todos esses repositórios nesta revisão.

## Arquitetura escolhida para o Super Quina

1. **Fonte do recibo:** API autenticada do Super Quina entrega apenas recibo oficial de compra confirmada.
2. **Controle de duplicidade:** reserva automática única por compra; estados unidirecionais `RESERVED → SENDING → SENT/UNKNOWN`. Uma falha após iniciar o envio nunca dispara repetição automática.
3. **Encoder:** módulo ESC/POS próprio, puro e testável, separado do transporte. Perfis determinam papel, colunas, mapa de caracteres, QR, avanço e corte.
4. **Transporte:** plugin Capacitor nativo usando Bluetooth Classic RFCOMM/SPP (`00001101-0000-1000-8000-00805F9B34FB`) e lista de dispositivos já pareados. Sem descoberta desnecessária, BLE ou AIDL/POS nesta primeira versão.
5. **Proteção de buffer:** envio serializado em blocos de 256 bytes, com flush e pausa de 30 ms entre blocos. O intervalo é uma configuração inicial conservadora, não garantia universal; precisa de teste na MTP5.
6. **Perfis:** salvos por endereço Bluetooth no aparelho, não em uma configuração global compartilhada entre impressoras.
7. **Teste sem risco financeiro:** página ESC/POS de teste envia texto simples, seleção de fonte e régua com a largura configurada diretamente ao dispositivo, sem criar ou alterar job de recibo.
8. **Interface:** apenas selecionar, conectar, desconectar, escolher papel/perfil, testar e imprimir recibo oficial. Sem editor, imagens, arquivos ou impressão genérica.

## Estado das atualizações nesta branch

- [x] Remover registro e caminho de PrintService/Print Framework.
- [x] Remover a antiga atividade que instruía o usuário a ativar um serviço de impressão inexistente.
- [x] Salvar perfis por endereço Bluetooth.
- [x] Acrescentar página de teste sem reserva de recibo.
- [x] Fracionar envio Bluetooth para impressoras com buffer pequeno.
- [x] Aplicar fonte ESC/POS A/B conforme perfil e colunas.
- [x] Permitir que a falha de obtenção do recibo seja registrada como `RECEIPT_UNAVAILABLE` na API, sem deixar o job preso em `RESERVED`.
- [x] Manter uma cópia por ação e não repetir automaticamente quando o resultado físico for incerto.
- [x] Expandir testes automatizados do encoder para cobrir a seleção de fonte A/B.
- [ ] Criar testes automatizados do fluxo de estados e das rotas de impressão.
- [ ] Executar typecheck, lint, testes e build Android no HEAD final.
- [ ] Instalar o APK e validar na Goldensky MTP5: 58/80 mm, acentos, QR, avanço, largura, desconexão e recibo completo.

## Decisão

A arquitetura mais sólida para este caso é **encoder ESC/POS próprio + plugin nativo Bluetooth SPP + reserva de impressão autenticada no servidor**. DantSu é a referência mais útil para capacidades ESC/POS e charset; Open ESC/POS é referência histórica de PrintService, mas o caminho PrintService foi rejeitado para este projeto. O RawBT 7.0.2 permanece a referência de comportamento que o usuário já comprovou na impressora real.

O APK não deve ser declarado concluído até passar nos testes automatizados e na impressora física. O fato de o socket aceitar os bytes não comprova que o papel saiu.
