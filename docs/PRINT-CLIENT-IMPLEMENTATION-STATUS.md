# Cliente de impressão oficial — estado da implementação

## Implementado
Arquivo: `src/modules/printing/client/print-official-purchase-receipt.ts`.

O fluxo de cliente:
1. Reserva o PrintJob pela rota autenticada `POST /api/purchases/{purchaseId}/print-jobs/auto`.
2. Busca o DTO oficial exclusivamente em `GET /api/player/purchases/{purchaseId}/receipt`.
3. Codifica o DTO confirmado em ESC/POS usando o perfil genérico inicial de 58 mm.
4. Confere se o dispositivo conectado corresponde ao dispositivo selecionado.
5. Marca `SENDING` antes da transmissão e `SENT` após o socket aceitar os bytes.
6. Registra falha pré-envio como `FAILED` e resultado incerto como `UNKNOWN`; não repete automaticamente.
7. A reserva automática só permite envio quando foi criada na chamada atual; um trabalho `RESERVED` preexistente não pode ser reenviado automaticamente.

## Encoder ESC/POS
Arquivo: `src/modules/printing/escpos/encode-thermal-receipt.ts`.

- Gera QR Code ESC/POS (GS ( k), modelo 2, correção média) com a URL oficial de verificação do recibo.
- Formata emissão e horário do sorteio em `America/Sao_Paulo`, não UTC.
- Mantém PC860 como tabela padrão da impressora, sem enviar `ESC t` até validar a representação de acentos no equipamento.
- O perfil genérico ativa o QR Code e mantém uma única cópia por trabalho.
- Foram adicionados testes unitários para sequência QR e datas em São Paulo; eles foram adicionados, mas sua execução no CI ainda está pendente.

## Equipamento de referência
O autoteste fotografado informa **OY-580IP**, firmware V3.2F, Bluetooth `KPrinter_4765`, page 3 / PC860 e WPC1252 no índice 11. O perfil permanece genérico e não fica preso à marca ou ao modelo. Colunas 32/42 são presets provisórios.

## Limitações ainda existentes
- A tela `ThermalBluetoothPrinter` já está integrada ao modal do recibo oficial do jogador: lista dispositivos pareados, atualiza a lista, conecta, imprime e desconecta.
- A ponte TypeScript e a classe Android registram o plugin com o mesmo identificador `SuperQuinaPrinter`; o pacote local declara `capacitor.android.src = "android"` para descoberta pelo Capacitor.
- Dependências `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` e pacote local `@superquina/rawbt-printer` foram adicionadas ao `package.json`. O projeto Android será gerado no CI por `npx cap add android`; ainda não há plataforma Android versionada no branch.
- Foi criado `.github/workflows/android-printer-apk.yml` para instalar dependências, gerar a plataforma Android, sincronizar o plugin, compilar `assembleDebug` e publicar o APK como artefato. O workflow foi executado no HEAD anterior e o TypeScript passou, mas o lint falhou por dois efeitos React na tela da impressora. A correção foi enviada à branch; a nova execução precisa concluir lint, testes, sincronização Capacitor e compilação antes de existir um APK validado.
- O comando ESC/POS de QR é padronizado, mas precisa ser validado no firmware real; o autoteste mostra QR interno, o que não garante suporte a todos os comandos GS ( k).

## Observação operacional
`SENT` significa que os bytes foram aceitos pelo socket Bluetooth. Isso não confirma que o papel saiu corretamente. Em resultado incerto, o sistema não tenta novamente automaticamente.
