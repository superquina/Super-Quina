> **Registro histórico:** esta auditoria foi feita antes da consolidação do repositório. A única branch oficial atual é `main`. As referências a `recovery/super-quina` e às branches usadas na comparação descrevem somente o contexto histórico de 2026-11-04; não são instruções para o fluxo atual.

# Auditoria seletiva — recovery/super-quina

Data da comparação: 2026-11-04
Repositório: `jpveiculos/Super-Quina`
Branch de destino/base protegida: `main`
Branch sob avaliação: `recovery/super-quina`

## Regra de identidade e aproveitamento

A branch de recuperação é apenas fonte de ideias e código genérico. É proibido importar identidade, marca, textos, imagens, rotas, regras de negócio ou qualquer vestígio de outros jogos/sites. Não copiar arquivos inteiros nem fazer merge/cherry-pick da branch. Toda lógica candidata deve ser adaptada à arquitetura e às regras vigentes da Super Quina e passar por busca de referências históricas antes de aprovação.

## Resultado estrutural da comparação

Comparação GitHub: `main...recovery/super-quina`.

- Estado: `diverged`.
- `recovery/super-quina` está 11 commits à frente e 144 commits atrás de `main`.
- A comparação retornou 11 arquivos alterados.
- Isso representa 11 commits exclusivos em relação ao ancestral comum, não o total histórico de commits da branch.
- Não fazer merge. A diferença de 144 commits atrás indica que a recuperação não é uma atualização linear da branch de trabalho.

## Arquivos alterados e avaliação preliminar

| Arquivo | Alteração observada | Avaliação |
|---|---|---|
| `.github/workflows/quality.yml` | Inclui a branch recovery nos eventos de CI. | Ideia operacional simples; não é necessário importar para setup sem motivo. |
| `prisma/migrations/20261102000000_pix_purchase_intent/migration.sql` | Adiciona `Purchase.numericIntent JSONB`. O arquivo não existe na branch setup com esse caminho. | Não aplicar isoladamente. Reconciliar com o schema e o histórico completo de migrations antes de qualquer decisão. |
| `prisma/schema.prisma` | Divergência estrutural; arquivo recovery tem 372 linhas e setup tem 405. | Risco alto de regressão por diferença de modelo. Comparar modelos e relações individualmente. |
| `src/app/admin/page.tsx` | Recovery remove a seção administrativa de regras/multiplicadores e altera texto que descrevia resultados independentes para resultado numérico único. | Não importar. A remoção pode eliminar funcionalidade existente na setup. |
| `src/app/api/cashier/purchases/cash/route.ts` | Troca `repetitionCount` por `participationCount` no contrato de compra. | Mudança de contrato; precisa ser comparada com UI, serviço, testes e regras atuais antes de qualquer adaptação. |
| `src/app/api/cashier/purchases/create/route.ts` | Mesma alteração de contrato e fluxo de criação/checkout Pix. | Não copiar isoladamente; exige compatibilidade ponta a ponta. |
| `src/app/api/player/purchases/route.test.ts` | Remove dados simulados de `numericIntent` e altera expectativas dos testes. | Não importar sem alinhar os testes com o comportamento vigente da setup. |
| `src/app/api/player/purchases/route.ts` | Altera contrato de participação e fluxo de resposta da compra. | Exige análise conjunta com serviço, banco e formulário. |
| `src/components/purchases/numeric-game-purchase-form.tsx` | Recovery remove geração aleatória e reduz/alterar partes do fluxo de compra; setup mantém recursos adicionais, inclusive geração aleatória e fluxo de várias entradas. | Não importar; aparenta regressão de experiência/funcionalidade. |
| `src/modules/payments/confirm-payment.ts` | Implementa estratégia diferente para bloqueio e alocação das rodadas; recovery não apresenta o mesmo bloqueio explícito inicial de compra/pagamento existente na setup e usa validações/estado de intenção diferentes. | Alto risco financeiro e de concorrência. Não copiar sem revisão transacional e testes concorrentes. |
| `src/modules/purchases/create-numeric-purchase.ts` | Alterações extensas no fluxo de criação, intenção e alocação da compra. | Alto risco. Exige diff integral e testes de idempotência, reserva de rodada, pagamento e consistência de valores. |

## Busca preliminar por vestígios históricos

Nos conteúdos dos arquivos alterados que foram inspecionados nesta etapa, não foram identificadas referências explícitas às marcas/termos proibidos dos projetos anteriores. Esta verificação é limitada aos arquivos alterados e não certifica o repositório inteiro. Antes de qualquer reaproveitamento, executar busca global na branch candidata e no patch adaptado.

## Conclusão deste bloco

**Nenhum código foi aprovado para integração nesta etapa.**

A branch recovery contém mudanças úteis como material de estudo, mas está divergente e substancialmente atrás da setup. Há diferenças que podem remover funcionalidades atuais e diferenças no fluxo financeiro que exigem cautela. A comparação preliminar recomenda não fazer merge, cherry-pick ou substituição de arquivos.

## Próximas verificações

- [ ] Obter e revisar o diff integral de `create-numeric-purchase.ts` entre as duas branches.
- [ ] Revisar o diff integral de `confirm-payment.ts`, incluindo locks, idempotência, alocação e estados de pagamento.
- [ ] Comparar todos os modelos/enumerações do `schema.prisma` e a cadeia de migrations, sem aplicar migrations.
- [ ] Verificar se o contrato `participationCount` é compatível com as regras aprovadas na setup ou se é apenas uma nomenclatura diferente.
- [ ] Verificar CI/testes do HEAD de ambas as branches; comparação de código não comprova build verde.
- [ ] Fazer varredura global por marcas, nomes, textos, assets, rotas e regras de jogos antigos.
- [ ] Só então classificar cada ideia como reaproveitável, descartada ou dependente de adaptação.

## Limites respeitados

Nenhum código funcional foi alterado. Nenhuma migration foi aplicada. Nenhum dado ou banco foi alterado. Nenhum merge/cherry-pick foi executado. A branch `main` não foi modificada.


## Parecer final de valor — revisão aprofundada em 2026-11-04

A branch `recovery/super-quina` foi avaliada com o critério de que a branch `main` já está em estágio avançado e só deve receber melhorias realmente relevantes.

### Pontos que pareceram interessantes, mas não justificam integração

1. **Validação explícita da intenção numérica:** a recovery valida versão, quantidade de participações e conteúdo de `numericIntent`. A setup já valida a intenção persistida, números, alocação, snapshot de regras e reconciliação do total com o pagamento. Não foi demonstrada uma lacuna exclusiva que justifique importar o fluxo recovery.
2. **Bloqueio de rodadas na confirmação Pix:** a recovery comenta a necessidade de alinhar o protocolo de locks entre criação, confirmação e fechamento de rodada. A ideia é correta e importante. Porém, a setup já bloqueia pagamento/compra e rodadas dentro da transação serializável, usa ordenação determinística e valida a elegibilidade das rodadas com critérios mais específicos. A recovery não demonstrou superioridade suficiente para substituir essa implementação.
3. **Tratamento de idempotência e repetição:** ambas as versões possuem tratamento de repetição e conflito de serialização. Não foi encontrada vantagem exclusiva e comprovada na recovery.

### Vantagens observadas na setup em relação à recovery

- A setup lê a configuração vigente de multiplicadores e cria snapshot das regras; a recovery usa diretamente os multiplicadores aprovados fixos no serviço de criação.
- A setup preserva compra confirmada em dinheiro/carteira quando o scheduler está entre rodadas, registrando alocação pendente para reconciliação posterior; a recovery exige rodadas suficientes e falha a compra confirmada quando não encontra todas.
- A confirmação Pix da setup bloqueia explicitamente os registros de compra e pagamento antes de decidir; a recovery apresentada não mantém o mesmo bloqueio explícito no início da transação.
- A setup verifica consistência entre intenção, participações provisórias, valores e quantidade confirmada, mantendo compatibilidade com o modelo atual.

### Decisão recomendada

**Não integrar nenhuma alteração da recovery nesta fase.** O material avaliado não oferece ganho funcional suficientemente importante para justificar risco de regressão ou custo de revalidação perto do encerramento do projeto.

A branch pode ser considerada candidata a arquivamento/exclusão, mas somente depois de:
- confirmar que não há outros commits/arquivos exclusivos ainda não examinados com funcionalidade relevante;
- concluir a varredura global de identidade/vestígios de projetos antigos;
- confirmar CI e estado dos commits necessários para recuperação, se houver;
- obter autorização explícita do responsável antes de excluir a branch.

A branch `recovery/super-quina` não deve ser excluída automaticamente por esta auditoria.

### Escopo da revisão

A revisão aprofundada concentrou-se nos serviços de criação de compra numérica e confirmação de pagamento Pix, além das diferenças já listadas no primeiro bloco. Não equivale a auditoria integral de todos os arquivos exclusivos da recovery. Nenhum código funcional foi integrado ou modificado.


## Encerramento da avaliação da branch — 2026-11-04

Decisão do responsável pelo projeto: encerrar o trabalho de avaliação da branch `recovery/super-quina` e deixá-la separada, marcada como candidata à exclusão.

- Não aproveitar código da branch nesta fase.
- Não realizar merge ou cherry-pick.
- Não continuar novas auditorias nela, salvo se surgir uma necessidade concreta.
- Preservar a branch temporariamente como referência recuperável até a exclusão autorizada.
- Na data desta auditoria, a antiga branch `setup/super-quina` era a base ativa. Atualmente, a única branch oficial é `main`.
- A exclusão remota da branch recovery **não foi executada** neste encerramento; permanece pendente de ação/autorização específica.

Status: **AVALIAÇÃO ENCERRADA — AGUARDANDO EXCLUSÃO**.
