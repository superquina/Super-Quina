# Auditoria do ZIP RawBT reconstruido — 09/11/2026

## Arquivo recebido e validado

- Arquivo: `RawBT_reconstruido_atualizado(1).zip`
- Tamanho: 20.439.637 bytes (aprox. 19,5 MiB)
- SHA-256: `5cfe3c5d0a16b725630f08dec3f3f555908b958ec6da7c14c069347c0329901c`
- Entradas ZIP: 9.889 (incluindo diretórios)
- Conteúdo descompactado: 56.105.030 bytes
- Caminhos absolutos/traversal detectados: nenhum.

## Inventário confirmado

O ZIP contém as seguintes áreas:

| Pasta | Conteúdo |
|---|---|
| `fontes_web/` | HTML, CSS e JavaScript da interface de demonstração |
| `apk_extraido/` | APK extraído: manifesto, DEX, recursos, assets e bibliotecas |
| `codigo_nativo_jadx/` | Exportação do JADX 1.5.6 |
| `codigo_nativo_decompilado/` | Segunda exportação decompilada, quase duplicada |
| `analise_nativa/` | Relatório técnico e inventário de classes/strings |
| `documentacao/` | Inventário e guia de arquivos editáveis |
| `RawBT-original.apk` | APK de referência original |

### Contagem real de arquivos

Cada uma das duas exportações de código contém:
- 2.593 arquivos Java;
- 955 arquivos XML;
- 139 PNG;
- 58 WebP;
- outros recursos e metadados.

As duas exportações não devem ser somadas como se fossem 5.186 classes independentes. Elas representam duas saídas quase duplicadas: 3.853 arquivos têm conteúdo idêntico; três arquivos Java diferem entre as exportações. A versão JADX foi escolhida como referência principal, e a segunda deve ser preservada apenas para comparação de divergências.

## Estrutura nativa confirmada

O manifesto reconstruído declara dois serviços diferentes:
1. `ru.a402d.rawbtprinter.RawBtPrintService`, serviço próprio do RawBT;
2. `ru.a402d.rawbtprinter.printservice.RawBtService`, serviço Android Print Framework, protegido por `BIND_PRINT_SERVICE` e associado a `@xml/printservice`.

A classe `RawBtService` estende `android.printservice.PrintService` e encaminha trabalhos para a camada interna `IRawBtPrintService`. A classe `rawbt.sdk.AbstractRawBtPrintService` mantém fila de impressão, execução assíncrona e callbacks de progresso/erro/conclusão.

A exportação também contém classes para:
- Bluetooth clássico e BLE;
- pareamento/seleção de dispositivos;
- USB e serial;
- persistência de perfis de impressoras;
- drivers ESC/POS, CPCL, EPL, TSPL, ZPL e famílias específicas;
- comandos de texto, imagem, código de barras e QR Code.

A presença de uma classe ou driver na exportação não prova compatibilidade com a nossa impressora. O transporte e o perfil precisam ser testados fisicamente.

## Limitações do projeto Gradle exportado

A exportação JADX inclui `settings.gradle`, `build.gradle` e `app/build.gradle`, mas:
- não inclui `gradlew` nem `gradle/wrapper/`;
- o bloco de dependências de `app/build.gradle` está como `// TODO: dependencies`;
- não foi confirmado que o código decompilado compile;
- há seis problemas/avisos pontuais relatados no README da exportação, mas o ZIP não fornece um relatório inequívoco que associe os seis itens a seis arquivos específicos.

Conclusão: é uma base de análise/decompilação, não um projeto pronto para gerar APK. Não devemos substituir o projeto Android do Super Quina por essa exportação.

## Diretriz para o nosso APK

A implementação Super Quina será independente. O RawBT serve para estudar a arquitetura e os comportamentos necessários, sem copiar código proprietário, identidade visual, pacote, endpoints ou contornar licenças.

Arquitetura alvo:
1. Capacitor/WebView abre o site Super Quina hospedado;
2. o servidor continua responsável por login, pagamentos e recibos oficiais;
3. o plugin Android próprio conecta por Bluetooth Classic RFCOMM/SPP;
4. o app envia bytes ESC/POS preparados para o recibo autorizado;
5. o servidor registra o estado do trabalho e evita reenvio automático quando o resultado for incerto.

O site dentro da WebView já está configurado no projeto Capacitor por URL hospedada. Isso não empacota o site para uso offline. Se a WebView integrada não for adequada, manteremos o APK como ponte Bluetooth acionada pelo site no navegador.

## Próximas ações

1. Manter a exportação JADX como referência principal e registrar as três divergências da exportação secundária.
2. Mapear apenas os fluxos relevantes: seleção Bluetooth, conexão SPP, perfil térmico, codificação, QR e transmissão.
3. Comparar esse mapa com o plugin Capacitor que já existe em `plugins/rawbt-printer/`.
4. Remover caminhos paralelos e manter um único fluxo de impressão no Super Quina.
5. Compilar e testar em Android físico com a impressora real. A escrita no socket não prova, sozinha, que o papel foi impresso.

## Estado desta entrega

- ZIP recebido, aberto e inventariado.
- Integridade estrutural do ZIP verificada.
- Arquitetura do serviço de impressão identificada no código e no manifesto.
- Nenhuma classe proprietária foi copiada para o código executável do Super Quina.
- Nenhum APK novo foi compilado ou testado nesta etapa.
