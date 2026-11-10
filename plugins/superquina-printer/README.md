# Ponte de impressão Bluetooth — Super Quina

## Finalidade
Módulo Android nativo mínimo para conectar o site Super Quina a impressoras térmicas Bluetooth Classic SPP.

## Funções incluídas
- Listar dispositivos Bluetooth já pareados no Android.
- Abrir as configurações Bluetooth do sistema para pareamento.
- Conectar e desconectar por RFCOMM/SPP.
- Enviar bytes ESC/POS preparados pelo encoder do Super Quina.
- Informar estado da conexão e erros de transporte.

## Fora do escopo
Este módulo não é um aplicativo genérico de impressão. Não inclui vendas, compras, licenças, assinaturas, anúncios, editor de imagem, recorte, galeria, editor de documentos, PDF, visualizador de arquivos, modelos, compartilhamento genérico, impressão de arquivos arbitrários, USB, BLE, Wi-Fi, TCP, drivers de outras linguagens ou interface de terminal.

## Segurança e limites
- O servidor Super Quina continua responsável por login, pagamentos e autorização do recibo.
- O encoder do site prepara o conteúdo ESC/POS; a ponte apenas transporta os bytes.
- O módulo não recebe credenciais nem confirma pagamentos.
- Um envio aceito pelo socket não confirma a saída física do papel.
- Não repetir automaticamente quando o resultado da transmissão for incerto.
