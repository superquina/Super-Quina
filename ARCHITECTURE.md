# Arquitetura — Super Quina

## Aplicação
Um único aplicativo Next.js full-stack na raiz:
- src/app: páginas, layouts e rotas HTTP.
- src/components: interface reutilizável.
- src/domain: regras puras e rateio.
- src/modules: compras, pagamentos, números, sorteio e apuração.
- src/lib: autenticação e infraestrutura.
- prisma/schema.prisma: modelo persistente.
- prisma/migrations: histórico versionado.
- src/generated/prisma: cliente gerado; não editar manualmente.

## Modelo numérico
Cada rodada tem um único resultado textual de cinco algarismos. NumericParticipationLine armazena número, rateio, snapshot de regras, prêmio e crédito. O schema final não contém GameMode, PlateFormat, ParticipationLine nem resultados de placas.

## Financeiro
Purchase, PurchaseParticipation, Payment, LedgerEntry, CashierCommission, Withdrawal, usuários e auditoria permanecem. Jogadores usam Pix/carteira; cambistas usam Pix/dinheiro. Recibos dependem de confirmação de pagamento. Créditos de prêmios usam chave idempotente por linha numérica.

## Agendador e gestão de rodadas
- A criação de rodadas é exclusiva do `POST /api/internal/round-scheduler`, protegido por `ROUND_SCHEDULER_SECRET`.
- O endpoint administrativo `/api/admin/rounds` é somente leitura; criação manual de rodadas não faz parte do produto.
- O painel administrativo consulta rodadas existentes e mantém os controles operacionais de fechamento, sorteio e apuração.
## Agendador
POST /api/internal/round-scheduler, protegido por ROUND_SCHEDULER_SECRET. Mantém até dez rodadas futuras em intervalos de 30 minutos e processa abertura, fechamento, sorteio e reconciliação Pix. A hospedagem precisa chamar o endpoint a cada minuto; o cron externo não é criado pelo código.

## Banco
A branch é destinada a serviço e banco novos. A migration 20261101020000_numeric_only_cleanup remove estruturas legadas de placas. Não executar a sequência em banco legado do Joga Placas.
