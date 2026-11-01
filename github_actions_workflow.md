name: Atualização Semanal do Radar de IA

on:
  schedule:
    # Executa todo domingo às 11:00 UTC (08:00 Horário de Brasília)
    - cron: '0 11 * * 0'
  workflow_dispatch:
    # Permite disparar manualmente pela aba Actions do GitHub a qualquer momento

jobs:
  update-radar:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout do Repositório
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configurar Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: Executar Mesclagem Semanal
        run: |
          # Localizar o arquivo novos-*.json mais recente
          NEW_FILE=$(ls -t novos-*.json 2>/dev/null | head -n 1)

          if [ -z "$NEW_FILE" ]; then
            echo "⚠️ Nenhum arquivo 'novos-*.json' encontrado para processar."
            exit 0
          fi

          echo "🚀 Processando arquivo da semana: $NEW_FILE"
          python3 mesclar.py "$NEW_FILE"

          # Remover o arquivo temporário de novos lançamentos após mesclar
          rm -f "$NEW_FILE"

      - name: Salvar e Publicar Alterações no Git
        run: |
          git config --global user.name "Radar AI Bot"
          git config --global user.email "bot@radardeia.local"

          git add data.json arquivo_historico.json
          
          if git diff --staged --quiet; then
            echo "ℹ️ Nenhuma alteração detectada no data.json."
          else
            git commit -m "chore(auto): atualização semanal do Radar de IA [skip ci]"
            git push origin main
            echo "✨ Dados do Radar de IA atualizados e publicados com sucesso!"
          fi