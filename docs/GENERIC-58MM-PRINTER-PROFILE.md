# Perfil genérico — mini impressoras térmicas ESC/POS 58 mm

Atualizado em 2026-11-08. Branch: `feature/rawbt-inspired-printer-core`.

## Equipamento de referência identificado pelo autoteste

O aplicativo permanece genérico, sem vínculo com fabricante. O autoteste enviado pelo usuário identifica a unidade como:

- Modelo impresso no autoteste: **OY-580IP** (atenção: difere da identificação verbal anterior OY-581P).
- Firmware: V3.2F.
- Nome Bluetooth: `KPrinter_4765`.
- Interface: Bluetooth e USB Print.
- Densidade indicada: 3.
- Desligamento automático: 10 minutos.
- Modo atual: ASCII print mode, page 3.
- Código de página padrão: page 3 = **PC860**.

## Tabelas de caracteres listadas no autoteste

| Índice | Tabela |
|---:|---|
| 0 | PC437 |
| 1 | Katakana |
| 2 | PC850 |
| 3 | PC860 |
| 4 | PC863 |
| 5 | PC865 |
| 6 | West Europe |
| 7 | Greek |
| 8 | Hebrew |
| 9 | East Europe |
| 10 | Iran |
| 11 | WPC1252 |
| 12 | PC866 |
| 13 | PC852 |
| 14 | PC858 |
| 15 | IranII |
| 16 | Latvian |
| 17 | Arabic |
| 18 | WPC1251 |
| 19 | PC747 |
| 20 | WPC1257 |
| 21 | Vietnam |
| 22 | PC864 |
| 23 | PC1001 |
| 24 | PC857 Turkey |
| 25 | PC862 Hebrew |
| 26 | PC928 Greek |
| 27 | PC869 Greek |
| 28 | PC851 Greek |
| 29 | PC737 Greek |
| 30 | PC874 |
| 31 | WPC1256 |
| 32 | WPC1258 |

**Decisão técnica:** o perfil não envia comando ESC t para trocar a tabela. A impressora já informa page 3 / PC860 como padrão; manteremos esse padrão até um teste impresso confirmar se WPC1252 (índice 11) melhora a representação dos caracteres usados no recibo.

## Configuração inicial

Arquivo: `src/modules/printing/escpos/generic-58mm-profile.ts`.

- Papel nominal: 58 mm.
- Linguagem: ESC/POS.
- Transporte previsto: Bluetooth Classic SPP/RFCOMM.
- Font A: 32 colunas como preset inicial.
- Font B: 42 colunas como preset inicial.
- Uma cópia por trabalho de impressão.
- Sem comando de corte automático.
- Code page: mantém o padrão da impressora (page 3 / PC860).

**Importante:** o autoteste confirma o modelo e as tabelas disponíveis, mas não informa a largura imprimível em pontos nem o número de colunas das fontes. 32/42 colunas continuam sendo presets, não medidas confirmadas da OY-580IP. ESC/POS e Bluetooth SPP também não garantem comportamento idêntico em todos os modelos.

## Próximas validações

1. Confirmar fisicamente se o modelo impresso OY-580IP é o mesmo equipamento que foi chamado de OY-581P.
2. Imprimir uma amostra de recibo com page 3 / PC860 e conferir acentos.
3. Comparar uma amostra com WPC1252 (índice 11), caso PC860 não represente corretamente os caracteres portugueses.
4. Medir largura e quebra de linha para confirmar Font A/B.
5. Validar conexão SPP e impressão pelo APK Android.

O retorno de bytes escritos confirma aceitação pelo socket, não impressão física confirmada.

## Estado

- [x] Perfil genérico criado, sem dependência de marca.
- [x] Autoteste da unidade analisado; identificação impressa OY-580IP.
- [x] Code page padrão identificada como page 3 / PC860.
- [x] WPC1252 identificada na tabela como índice 11.
- [ ] Largura e colunas reais medidas.
- [ ] Acentos validados em PC860 e, se necessário, WPC1252.
- [ ] SPP validado no Android.
- [ ] Build Android e teste físico concluídos.
