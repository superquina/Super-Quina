# Decisão técnica — confirmação, vinculação e emissão atômica do recibo

Data: 2026-11-02  
Branch oficial atual: `main`  
Status: regra aprovada. O fluxo novo grava uma intenção numérica sem participações/roundIds antes do pagamento; a confirmação Pix cria e vincula as participações às rodadas válidas na mesma transação. Compras pendentes antigas com participações provisórias continuam suportadas durante a transição.

## Regra inviolável

Um recibo e seu QR Code de consulta representam uma compra já vinculada, de forma definitiva, às rodadas indicadas no próprio recibo. É proibido disponibilizar recibo antes de todas as participações estarem vinculadas a rodadas válidas e a confirmação estar concluída.

Nunca se emite um recibo provisório para depois procurar, trocar ou corrigir as rodadas. O QR Code de recibo não pode representar uma intenção de compra nem uma participação ainda não confirmada.

## Ordem única de confirmação

A confirmação deve acontecer em uma única transação PostgreSQL, com isolamento Serializable e locks determinísticos:

1. Bloquear a compra e o pagamento e verificar idempotência.
2. Confirmar que o pagamento foi autenticado pelo Mercado Pago ou que o recebimento CASH/débito WALLET está sendo efetivado nesta mesma transação.
3. Ler o relógio do banco com `clock_timestamp()` depois de obter os locks relevantes.
4. Consultar e bloquear as rodadas candidatas ainda válidas.
5. Selecionar a quantidade solicitada de rodadas futuras, ordenadas pelo instante do sorteio, excluindo rodada fechada, cancelada, com cutoff alcançado ou sorteio já ocorrido.
6. Criar/confirmar participações e linhas numéricas já ligadas aos IDs definitivos das rodadas.
7. Verificar a quantidade de participações, linhas, valores e vínculos.
8. Atualizar pagamento/compra, registrar efeitos financeiros, gerar código único do recibo e gravar auditoria.
9. Retornar o resultado somente depois do commit.

A ordem lógica é: pagamento válido → rodadas revalidadas → participações e linhas persistidas → recibo associado → commit → disponibilização do QR Code.

## Falha e concorrência

- Qualquer erro antes do commit deve abortar a transação inteira.
- Em conflito de serialização/deadlock ou disputa de fechamento, repetir todo o processo em transação nova, com novo relógio, locks e seleção.
- Retry é limitado; nunca reutilizar seleção nem horário da tentativa anterior.
- Se uma rodada se tornar inválida durante a disputa, selecionar a próxima rodada futura válida.
- Se não houver quantidade suficiente de rodadas, não confirmar localmente nem emitir recibo. Registrar a aprovação externa e permitir reconciliação automática posterior.
- Webhook, consulta de status e agendador devem convergir para a mesma função idempotente.

## Intenção antes do pagamento — contrato-alvo

A intenção PIX pendente armazena números, rateio, quantidade de participações (1 a 10), versão e snapshot da regra e dados necessários à cobrança. O contrato não cria participações, linhas numéricas, roundIds ou receiptCode antes da confirmação.

A quantidade não seleciona nem reserva rodadas. As APIs e telas pendentes não devem expor IDs, códigos ou horários de rodadas como se já estivessem atribuídos. O QR Code Pix do provedor é distinto do QR Code de consulta do recibo.

**Nota de compatibilidade:** compras PIX antigas ainda podem conter placeholders PENDING vinculados a roundIds. A confirmação mantém o caminho legado para esses registros. Novas compras usam NumericPurchaseIntent e não criam participações antes da aprovação.

## CASH e WALLET

CASH só confirma quando o cambista registra o recebimento. WALLET só confirma quando o débito do saldo é realizado com sucesso. Seleção de rodadas, participações/linhas, recebimento ou débito, comissão, recibo e auditoria devem ser atômicos.

## Critérios de aceite

- PIX pendente não disponibiliza recibo nem QR de consulta.
- PIX aprovado só disponibiliza recibo após participações confirmadas em rodadas válidas.
- Falha antes do commit não deixa recibo consultável nem efeitos financeiros parciais.
- Retry seleciona novamente com horário e locks novos.
- Corrida com cutoff/fechamento/sorteio não cria participação retroativa.
- CASH/WALLET revertem integralmente em falha.
- Webhook duplicado, polling e scheduler simultâneos produzem uma única confirmação e um único recibo.
- Sem rodadas válidas, compra permanece localmente pendente para reconciliação automática.
- Agendador mantém até dez rodadas futuras, slots de 30 minutos e UTC−03:00.

## Limites operacionais

Trabalhar somente em `main`. Não criar branches paralelas. Alterações em produção, migrations e deploy continuam dependendo de autorização e validação próprias.
