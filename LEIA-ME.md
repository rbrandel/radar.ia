# Radar de IA — como manter

Site estático (GitHub Pages): `index.html`, `app.js`, `styles.css` e `data.json`.
Não precisa de servidor nem de banco de dados. Os dados ficam no `data.json`.

## 1. Antes de publicar (só uma vez): ligar o formulário de contato ao Formspree

1. Crie o formulário em https://formspree.io e copie o ID (algo como `xyzabcde`).
2. Abra o `index.html`, procure `SEU_ID` e troque por esse ID:
   `action="https://formspree.io/f/xyzabcde"`
3. Enquanto o `SEU_ID` estiver lá, o formulário avisa "ainda não está configurado" e não envia nada.

## 2. Rotina semanal (todo domingo, 08:00 em Brasília)

1. Copie `novos.modelo.json` para `novos-AAAA-MM-DD.json` (a data do dia, por exemplo `novos-2026-11-08.json`).
2. Apague o item de exemplo e preencha os lançamentos reais. Cada item precisa de fonte (`f`) com link http(s).
3. Coloque o arquivo na raiz do repositório e faça o commit.
4. No domingo o GitHub Actions junta o arquivo ao `data.json`, apaga o `novos-*.json` usado e publica.
   Para rodar na hora: aba **Actions** → "Atualização Semanal do Radar de IA" → **Run workflow**.
5. Semana sem novidade: use um arquivo com `[]`. Isso registra que você checou e atualiza a edição.

Se o arquivo tiver erro (data no futuro, sem fonte, link inválido, licença ou categoria fora da lista), o fluxo
falha, fica vermelho na aba Actions e **nada é publicado**. A mensagem diz qual item e qual campo.

### Campos de cada item

| Chave | Conteúdo |
|---|---|
| `d` | data do lançamento, `AAAA-MM-DD` (não pode ser futura) |
| `n` | nome (até 120 caracteres) |
| `o` | empresa ou laboratório (até 120) |
| `c` | categoria: `modelos`, `agentes`, `voz`, `video` |
| `p` | perfil: `dev`, `negocios`, `criativo` |
| `l` | licença: `aberto`, `proprietario`, `nao-informada` |
| `s` | o que é (até 420) |
| `a` | vantagem (até 300) |
| `t` | dica de uso (até 440) |
| `f` | fonte: `{"n": "nome da fonte", "u": "https://..."}` |

Use `nao-informada` quando a fonte não disser a licença. Não chute.

## 3. Testar no seu computador antes de enviar

```
python3 mesclar.py novos-2026-11-08.json --simular
```

Mostra o que entraria e não grava nada. Sem `--simular`, grava no `data.json` e na cópia embutida do `index.html`.
Outras opções: `--hoje AAAA-MM-DD` (simula outro dia) e `--so-copia-embutida` (só refaz a cópia de segurança dentro do `index.html`).

## 4. Se você mudar o visual (classes Tailwind)

O `styles.css` é gerado e já vem pronto. Se você adicionar classes novas no `index.html` ou no `app.js`, gere de novo:

```
npm run build:css
```

e envie o `styles.css` atualizado.

## 5. Enquete com votos reais (Supabase)

A enquete "Vote na melhor IA" funciona de dois jeitos:

- **Sem Supabase** (padrão, `config.js` vazio): o voto fica só no aparelho de quem votou.
- **Com Supabase**: os votos são somados para todo mundo. Siga `supabase/GUIA-SUPABASE.md` (cerca de 20 minutos, plano grátis).

Arquivos desta parte:

| Arquivo | Para que serve |
|---|---|
| `config.js` | Endereço e chave **pública** do seu projeto Supabase. Vazio = sem Supabase. |
| `db.js` | Faz o site conversar com o Supabase (sem bibliotecas externas). |
| `supabase/01-enquete.sql` | Cria a tabela de votos e as regras de segurança. Você cola no SQL Editor do Supabase. |
| `supabase/02-assinantes-opcional.sql` | Opcional e ainda sem uso no site: lista de e-mails para um resumo semanal. |
| `manter_ativo.py` e `.github/workflows/manter-supabase-ativo.yml` | Consulta leve toda quinta para o Supabase grátis não pausar. Sem Supabase configurado, não faz nada. |

Cada candidato da enquete (`candidatos_semana` no `data.json`) precisa de um `id` curto em minúsculas, como `c1`. A enquete recomeça a cada semana.

## 6. Observações

- A janela do radar é de 21 dias. O que sai dela vai para `arquivo_historico.json`.
- `a-verificar.json` guarda itens retirados até que se ache uma fonte. Para voltar com um, complete o campo `f`
  e coloque o item num `novos-*.json`.
- Sem o Supabase ligado, a enquete "Vote na melhor IA" guarda o voto só no aparelho de quem votou e não tem total de votos.
  Com ele ligado (seção 5), é uma enquete informal: não verifica identidade.
- A página tem uma cópia dos dados dentro do `index.html`, usada se o `data.json` não carregar (abrir o arquivo direto no navegador ou sem conexão).
