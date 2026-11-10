# Especificação funcional — Super Quina

Status: regras vigentes do produto. Esta especificação descreve exclusivamente o Super Quina.

## 1. Produto
- Jogo exclusivamente numérico.
- Cada palpite contém exatamente cinco algarismos, de `00000` a `99999`; zeros à esquerda são significativos.
- Não existem placas, formatos de placas, resultados de placas ou compatibilidade com Joga Placas.
- Áreas do sistema: público, jogador, cambista e administrador.

## 2. Participações
- Uma compra pode conter de 1 a 10 participações consecutivas.
- A quantidade representa quantas vezes o conjunto de números concorre; não representa escolha de códigos ou horários de rodadas.
- A interface informa somente a quantidade. Não mostra nem reserva rodadas antes da confirmação.
- Os números e valores são validados no servidor. O total é calculado no servidor em centavos inteiros.

## 3. Rodadas e sorteio
- Cada rodada tem um único resultado numérico de cinco algarismos.
- O agendador mantém até 48 rodadas futuras, com intervalos de 30 minutos, cobrindo aproximadamente as próximas 24 horas.
- O limite de 1 a 10 participações por compra é independente da quantidade de rodadas futuras mantidas pelo agendador.
- Fuso operacional fixo: UTC−03:00 (`Etc/GMT+3`).
- Fechamento, sorteio e apuração são etapas distintas.
- O sorteio deve ser uniforme no intervalo de 00000 a 99999 e preservar zeros à esquerda.
- Rodadas fechadas/sorteadas não podem receber participações retroativas.

## 4. Pagamentos e confirmação
- Única integração externa de negócio: Mercado Pago, para cobrança Pix e confirmação.
- QR Code Pix não é recibo nem prova suficiente de pagamento.
- Pix só é confirmado após validação autêntica do estado e dos dados da cobrança no Mercado Pago.
- Webhook, consulta de status e reconciliação devem convergir para o mesmo processo idempotente.
- CASH só confirma quando o cambista registra o recebimento.
- WALLET só confirma quando o débito é efetivado.
- Valores, débitos, créditos e comissões usam centavos inteiros e operações transacionais/idempotentes.

## 5. Regra de confirmação e recibo
- A compra Pix pendente representa uma intenção: números, valor, quantidade de participações, snapshot da regra e dados necessários à cobrança.
- Antes da confirmação, não deve existir participação válida, linha numérica, rodada atribuída, código de recibo ou QR de consulta de recibo.
- Após confirmação financeira, uma única transação deve revalidar o horário pelo relógio do banco, selecionar as próximas rodadas futuras válidas, criar participações e linhas numéricas, confirmar a compra/pagamento, registrar efeitos financeiros aplicáveis e gerar o recibo.
- Em CASH e WALLET, recebimento/débito, seleção de rodadas, participações, comissão e recibo devem ser atômicos.
- Conflito de concorrência exige retry da transação inteira, com novo horário e nova seleção de rodadas.
- Se não houver rodadas válidas após as tentativas limitadas, não confirmar localmente, não criar participações e não emitir recibo. A aprovação externa deve permanecer registrada para reconciliação automática.
- O recibo tem código único `SQ-` e QR Code interno de consulta. Só fica disponível depois do commit bem-sucedido.
- A consulta pública lê os dados oficiais do servidor e considera somente participações confirmadas.

## 6. Resultados e prêmios
- Estados devem distinguir rodada aguardando sorteio, resultado aguardando publicação, resultado publicado, participação premiada e não premiada.
- Não declarar derrota antes da publicação e apuração oficial.
- A apuração considera apenas participações confirmadas e usa o snapshot de regras registrado na compra.
- Créditos de prêmio devem ser transacionais e idempotentes.

## 7. Segurança e operação
- Autorização e propriedade dos registros são verificadas no servidor.
- Eventos financeiros, alterações administrativas e reconciliações devem ser auditáveis.
- Não expor segredos em código, documentação ou logs.
- Não importar usuários, apostas, vendas, sorteios, resultados, prêmios, saldos ou comissões de outro sistema.
- Não alterar `main`, banco de produção, infraestrutura, domínio ou DNS, nem fazer merge/deploy sem autorização explícita.

## 8. Fonte de implementação
A especificação define o comportamento esperado; não prova que cada requisito esteja testado. O estado implementado deve ser verificado nos módulos, rotas e testes existentes antes de qualquer alteração. Correções devem ser incrementais e preservar fluxos já implementados.
