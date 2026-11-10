# Reconstrucao do aplicativo de impressao — Super Quina

Esta pasta e a area de trabalho para receber e organizar o projeto reconstruido a partir do APK RawBT 7.0.2, usando JADX 1.5.6.

## Estado de entrada

- O APK RawBT original foi identificado como referencia tecnica.
- A decompilacao foi reportada com 2.593 arquivos Java, 955 XML, recursos e estrutura Gradle.
- O ZIP `RawBT_reconstruido_atualizado(1).zip` foi recebido e inventariado em 09/11/2026.
- O pacote contém duas exportações quase duplicadas: cada uma com 2.593 Java e 955 XML, além dos recursos extraídos e do APK original.
- A auditoria detalhada está em `AUDIT-ZIP-RAWBT-2026-11-09.md`.
- O ZIP original foi analisado nesta etapa; a importação integral dos milhares de arquivos binários/textuais para o GitHub ainda não foi realizada. Não confundir a documentação de inventário com o código-fonte já versionado.

## Organizacao prevista

```
android/rawbt-reconstruction/
  README.md                 # este guia e estado da importacao
  source/                   # fontes extraidos do JADX (somente referencia)
  resources/                # XML, imagens e recursos extraidos
  gradle/                   # wrapper e configuracao, se presentes
  reports/
    inventory.md            # inventario de pacotes, classes e recursos
    buildability.md         # erros de compilacao e dependencias
    license-review.md       # origem/licenca de cada componente reutilizado
```

## Produto que vamos construir

O objetivo principal e um APK Super Quina proprio que abra o site dentro de uma WebView e ofereca uma ponte nativa Bluetooth Classic SPP para a impressora termica. Se a incorporacao do site completo nao for viavel, o APK sera somente a ponte de impressao que o site atual aciona.

## Regras tecnicas

1. O site continua sendo a fonte oficial de autenticacao, recibo e estado do pagamento.
2. O APK nao confirma pagamento, nao calcula premios e nao cria recibos financeiros por conta propria.
3. A ponte Bluetooth recebe somente o conteudo de impressao autorizado pelo site.
4. Primeiro alvo: Bluetooth Classic RFCOMM/SPP e ESC/POS, validado na impressora fisica.
5. Nao copiar codigo, recursos, marca, pacote ou endpoints proprietarios do RawBT sem licenca que permita isso. O RawBT sera referencia arquitetural; a implementacao Super Quina sera propria.
6. Nao fazer bypass de licenca, marca d'agua ou mecanismo de protecao do aplicativo de referencia.
7. Nao considerar o APK pronto antes de compilar, instalar e testar a impressao real.

## Proximas etapas

- Importar o ZIP reconstruido e gerar inventario completo.
- Identificar dependencias, modulos, manifest, servicos Android, intents e pontos de entrada.
- Separar o que e observacao arquitetural do que pode ser reutilizado legalmente.
- Definir a arquitetura final: APK com WebView + ponte Bluetooth ou APK-ponte independente.
- Implementar, compilar e validar em aparelho Android e impressora real.
