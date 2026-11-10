# Benchmark: impressão térmica Bluetooth no iPhone

Data da análise: 2026-10-31  
Projeto: Super Quina  
Impressora observada: EY-58T1  
Aplicativo de referência: eLabel (Xiamen Rongta Technology)

## Objetivo
Imprimir o recibo do Super Quina diretamente na impressora térmica Bluetooth a partir do iPhone, sem AirPrint, sem abrir o eLabel para montar o documento e sem alterar o fluxo de confirmação do pagamento.

## Evidências já observadas
- O eLabel encontra a EY-58T1 e informa estado **Conectado**.
- O perfil exibido pelo eLabel é **203 dpi / TSPL (padrão)**.
- As configurações do aplicativo mostram modo de impressão térmica.
- O iPhone não encontra a impressora na busca AirPrint. Isso é esperado para uma impressora Bluetooth que não anuncia AirPrint.
- O projeto web usa Next.js 16, React 19 e não declara atualmente Capacitor ou Expo no package.json.

## Benchmark das alternativas

| Alternativa | iPhone/Safari | Acesso Bluetooth | Esforço | Parecer |
|---|---|---|---|---|
| Web Bluetooth direto no site | Não suportado nativamente pelo Safari/iOS | Não | Baixo no papel, inviável no iPhone atual | Rejeitar |
| AirPrint / window.print | Só encontra impressoras AirPrint/rede compatível | Não acessa Bluetooth genérico | Baixo | Rejeitar para EY-58T1 |
| Compartilhar PDF/imagem com eLabel | Depende de importação e ação manual no app | O eLabel controla a impressora | Médio | Contingência |
| Aplicativo iOS nativo ou camada compatível | Depende do protocolo e SDK da impressora | Potencialmente sim | Alto | Investigar se impressão Bluetooth direta continuar requisito |

Este benchmark é uma referência técnica específica do dispositivo; não comprova que a impressão Bluetooth esteja implementada.
