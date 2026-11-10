# Status da ponte Bluetooth do Super Quina

Atualizado em 2026-11-08  
Branch: feature/rawbt-inspired-printer-core

## Entrega desta etapa

Foi criado o pacote local inicial `plugins/rawbt-printer`, com:

- API TypeScript para listar dispositivos pareados, conectar, enviar bytes Base64, desconectar e consultar conexão;
- implementação Android nativa baseada em Bluetooth clássico RFCOMM/SPP;
- UUID serial padrão SPP;
- permissão runtime BLUETOOTH_CONNECT no Android 12+;
- listagem restrita a dispositivos já pareados;
- execução de conexão e escrita fora da thread principal;
- serialização das operações em executor único;
- tentativa de conexão RFCOMM segura e fallback inseguro (somente após falha normal, não após timeout);\n- timeout de 15 segundos aplicado a cada tentativa RFCOMM, segura e insegura; timeout encerra a tentativa e não aciona fallback adicional;
- limite de tamanho de payload para evitar envio excessivo;
- erros técnicos categorizados para a camada de interface.

## O que não foi incluído

- BLE/GATT;
- varredura de dispositivos próximos;
- USB, Wi-Fi/TCP, WebSocket ou serial;
- impressão genérica de arquivos, PDF, Word ou imagens;
- serviço Android de impressão genérico do sistema;
- confirmação de pagamento ou montagem de valores financeiros.

## Integração no branch

- `@capacitor/core`, `@capacitor/android` e `@capacitor/cli` estão declarados na versão 7.4.3; o pacote local `@superquina/rawbt-printer` está listado como dependência `file:`.
- O pacote declara `capacitor.android.src = android`, permitindo ao Capacitor localizar o módulo nativo durante `cap sync`.
- A classe nativa registra o nome `SuperQuinaPrinter`; a ponte TypeScript do app usa o mesmo identificador.
- A plataforma `android/` não está versionada no branch. O workflow gera o projeto temporariamente no CI por `npx cap add android` e sincroniza o pacote local.
- A tela de seleção/conexão/teste e o cliente do recibo oficial já existem no branch; a validação de runtime ainda depende do CI e de aparelho físico.

## Próxima validação

1. concluir lint e testes automatizados;
2. gerar a plataforma Android e sincronizar o plugin no CI;
3. compilar `assembleDebug` e publicar o APK como artefato;
4. instalar o APK em Android físico e testar a impressora SPP real.

## Limitações conhecidas que precisam de teste

- Algumas impressoras SPP exigem fluxo de autenticação específico ou não aceitam o UUID padrão; a tentativa segura/insegura não garante compatibilidade com todos os firmwares.
- O endereço Bluetooth MAC é usado como identificador local do dispositivo pareado; versões futuras do Android podem restringir sua exposição, exigindo validação no SDK-alvo.
- `bytesWritten` indica que o OutputStream aceitou os bytes, não que o papel foi fisicamente impresso.
- Uma falha de escrita pode deixar resultado físico incerto; o ledger deve marcar UNKNOWN e nunca reenviar automaticamente.
- O suporte a QR, code page, largura, avanço e corte depende do modelo/firmware e do perfil ESC/POS selecionado.

## Estado de validação

- [x] Código fonte inicial da ponte criado.
- [x] Timeout de 15 segundos aplicado individualmente às tentativas RFCOMM segura e insegura; timeout não dispara fallback adicional.
- [x] Contrato TypeScript documentado.
- [x] Permissões mínimas de manifesto declaradas no módulo.
- [x] Dependências Capacitor declaradas no app e pacote local incluído.
- [x] Registro do plugin nativo alinhado como `SuperQuinaPrinter` na camada Android e TypeScript.
- [ ] Plataforma Android gerada e plugin sincronizado com sucesso no CI.
- [x] TypeScript validation executada no workflow atual.
- [ ] Lint, testes e build Android concluídos.
- [ ] Testes em emulador/dispositivo Android.
- [ ] Teste físico com impressora Bluetooth SPP.
- [ ] Fluxo automático/reimpressão integrado ao PrintJob.

Nenhum APK foi compilado ou validado nesta etapa.
