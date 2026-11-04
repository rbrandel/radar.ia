# Radar de IA — como manter

Site estático (GitHub Pages): `index.html`, `app.js`, `styles.css` e `data.json`.
Não precisa de servidor nem de banco de dados. Os dados ficam no `data.json`.

## 1. Antes de publicar (só uma vez): ligar o formulário de contato ao Formspree

1. Crie o formulário em https://formspree.io e copie o ID (algo como `xyzabcde`).
2. Abra o `index.html`, procure `SEU_ID` e troque por esse ID:
   `action="https://formspree.io/f/xyzabcde"`
3. Enquanto o `SEU_ID` estiver lá, o formulário avisa "ainda não está configurado" e não envia nada.

## 2. Rotina semanal (sábado você gera, domingo 08:00 em Brasília publica)

### 2.1 Lembrete de sábado (automático)

Todo sábado, 08:00 em Brasília, o GitHub abre uma **issue** neste repositório chamada
"Radar de IA: gerar a atualização de sábado (data)" e atribui a você, então chega e-mail e aviso no app do GitHub.
A issue já traz:

- o **pedido pronto** para colar no Claude (janela de 7 dias, regras do texto, o que devolver);
- uma **lista de candidatos** coletada de OpenRouter (modelos novos no catálogo), Hugging Face (modelos em alta criados na semana) e GitHub (repositórios novos de IA com mais estrelas).

A lista é ponto de partida: pode ter ruído e pode faltar coisa. O Claude cruza com as páginas oficiais antes de escolher.
Se uma fonte estiver fora do ar, a issue sai mesmo assim e avisa qual não respondeu. Lembretes antigos que ficaram abertos são fechados sozinhos.

Fluxo de sábado (cerca de 15 minutos):

1. Abra a issue e copie o bloco "Pedido" (botão de copiar no canto do bloco).
2. Cole no Claude e anexe o `data.json` e o `novos.modelo.json` (se tiver, o `a-verificar.json` também).
3. Confira as fontes que o Claude indicar. Salve o resultado como `novos-AAAA-MM-DD.json`, com a data do **domingo** seguinte.
4. Envie o arquivo para a raiz do repositório antes de domingo 08:00 e feche a issue.

Para ligar (uma vez): copie para o repositório `coletar_candidatos.py`, `rotina/PEDIDO-SABADO.md` e
`.github/workflows/lembrete-sabado.yml`; em **Settings → General → Features**, confirme que **Issues** está marcado; e teste em
**Actions → "Lembrete de sábado do Radar de IA" → Run workflow**. Se quiser ver só o texto, rode no computador
`python3 coletar_candidatos.py --sem-rede`.

Cuidados:

- O horário do GitHub pode atrasar alguns minutos. Repositório sem nenhuma atividade por 60 dias tem os agendamentos pausados; o envio semanal já conta como atividade.
- Para o aviso chegar, deixe ligadas as notificações do GitHub (**Settings → Notifications**) para issues atribuídas a você.
- A lista é só candidatos. Nada dela vai para o site sem passar pelo `novos-*.json` e pela sua conferência.
- Para mudar o que o Claude recebe, edite `rotina/PEDIDO-SABADO.md`. As marcas `{{INICIO}}`, `{{FIM}}`, `{{DATA_ARQUIVO}}` e `{{CANDIDATOS}}` são trocadas pelo script.
- Para mudar as fontes ou os tópicos do GitHub, edite `coletar_candidatos.py` (a lista `GITHUB_TOPICOS` e as funções `coletar_*`).

### 2.2 Publicação (domingo)

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

Arquivos do lembrete de sábado (seção 2.1):

| Arquivo | Para que serve |
|---|---|
| `.github/workflows/lembrete-sabado.yml` | Todo sábado, 08:00 em Brasília, abre a issue de lembrete atribuída a você. Também roda à mão. |
| `coletar_candidatos.py` | Busca candidatos da semana (OpenRouter, Hugging Face, GitHub) e monta o texto da issue. Só usa a biblioteca padrão do Python. |
| `rotina/PEDIDO-SABADO.md` | Modelo da issue: os passos de sábado e o pedido pronto para o Claude. |

Cada candidato da enquete (`candidatos_semana` no `data.json`) precisa de um `id` curto em minúsculas, como `c1`. A enquete recomeça a cada semana.

## 6. Observações

- A janela do radar é de 21 dias. O que sai dela vai para `arquivo_historico.json`.
- `a-verificar.json` guarda itens retirados até que se ache uma fonte. Para voltar com um, complete o campo `f`
  e coloque o item num `novos-*.json`.
- Sem o Supabase ligado, a enquete "Vote na melhor IA" guarda o voto só no aparelho de quem votou e não tem total de votos.
  Com ele ligado (seção 5), é uma enquete informal: não verifica identidade.
- A página tem uma cópia dos dados dentro do `index.html`, usada se o `data.json` não carregar (abrir o arquivo direto no navegador ou sem conexão).
