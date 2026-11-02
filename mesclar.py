#!/usr/bin/env python3
"""
Atualização semanal do Radar de IA.

Uso:
  python3 mesclar.py novos-2026-11-08.json            junta os lançamentos novos ao data.json
  python3 mesclar.py novos-a.json novos-b.json        vários arquivos, na ordem informada
  python3 mesclar.py novos-2026-11-08.json --simular  mostra o resultado sem gravar nada
  python3 mesclar.py novos-2026-11-08.json --hoje 2026-11-08   usa essa data como dia da checagem
  python3 mesclar.py --so-copia-embutida              só refaz a cópia de segurança dentro do index.html

O arquivo de novos é uma lista JSON (veja novos.modelo.json). Uma lista vazia ([]) registra
"checei e não houve novidade": só a data da checagem muda.

Regras (se algo falhar, NADA é gravado):
  - todos os campos são obrigatórios: d, n, o, c, p, l, s, a, t e f (fonte: {"n": nome, "u": endereço});
  - a data (d) precisa existir e não pode ser depois de hoje;
  - itens com "_exemplo": true são ignorados (é o caso do novos.modelo.json);
  - a edição e a data de checagem são o dia da execução (horário de Brasília), não a data do item mais novo;
  - o que ficar mais velho que a janela (21 dias) vai para arquivo_historico.json.
Só usa a biblioteca padrão do Python 3.
"""
import copy
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "data.json")
ARCHIVE_FILE = os.path.join(HERE, "arquivo_historico.json")
INDEX_FILE = os.path.join(HERE, "index.html")

JANELA_PADRAO = 21
CAMPOS = ["d", "n", "o", "c", "p", "l", "s", "a", "t", "f"]
CATEGORIAS = ["modelos", "agentes", "voz", "video"]
PERFIS = ["dev", "negocios", "criativo"]
LICENCAS = ["aberto", "proprietario", "nao-informada"]
LIMITES = {"n": 120, "o": 120, "s": 420, "a": 300, "t": 440}
MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
         "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
RE_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_URL = re.compile(r"^https?://[^\s<>\"']+$", re.I)
RE_COPIA = re.compile(r'(<script type="application/json" id="radar-fallback">)(.*?)(</script>)', re.S)


def hoje_brasilia():
    # O Brasil não tem horário de verão desde 2019: UTC-3 fixo.
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).date()


def ler_json(caminho, padrao=None):
    if not os.path.exists(caminho):
        if padrao is not None:
            return padrao
        sys.exit("Arquivo não encontrado: " + caminho)
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        sys.exit("%s não é um JSON válido (linha %d, coluna %d): %s" % (os.path.basename(caminho), e.lineno, e.colno, e.msg))


def gravar_json(caminho, dados):
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(dados, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, caminho)


def data_valida(texto):
    if not isinstance(texto, str) or not RE_DATA.match(texto):
        return None
    try:
        return datetime.date.fromisoformat(texto)
    except ValueError:
        return None


def limpar_texto(v):
    return re.sub(r"\s+", " ", v).strip() if isinstance(v, str) else v


def chave(item):
    return (str(item.get("n", "")).strip().casefold(), str(item.get("o", "")).strip().casefold())


def validar_item(bruto, rotulo, hoje, janela):
    """Devolve (item_limpo, erros, avisos)."""
    erros, avisos = [], []
    if not isinstance(bruto, dict):
        return None, ["%s: cada lançamento precisa ser um objeto { ... }." % rotulo], avisos
    item = {}
    for k, v in bruto.items():
        if str(k).startswith("_"):
            continue
        if k not in CAMPOS:
            avisos.append("%s: campo desconhecido \"%s\" foi ignorado." % (rotulo, k))
            continue
        item[k] = limpar_texto(v)
    nome = item.get("n") if isinstance(item.get("n"), str) and item.get("n") else "sem nome"
    rotulo = "%s (%s)" % (rotulo, nome)

    for k in CAMPOS:
        if k not in item or item[k] in ("", None, {}):
            erros.append("%s: o campo \"%s\" está ausente ou vazio." % (rotulo, k))
    if erros:
        return item, erros, avisos

    for k in ("d", "n", "o", "c", "p", "l", "s", "a", "t"):
        if not isinstance(item[k], str):
            erros.append("%s: o campo \"%s\" precisa ser texto." % (rotulo, k))
    if erros:
        return item, erros, avisos

    for k, maximo in LIMITES.items():
        if len(item[k]) > maximo:
            erros.append("%s: \"%s\" tem %d caracteres; o máximo é %d." % (rotulo, k, len(item[k]), maximo))
    if item["c"] not in CATEGORIAS:
        erros.append("%s: categoria \"%s\" inválida. Use: %s." % (rotulo, item["c"], ", ".join(CATEGORIAS)))
    if item["p"] not in PERFIS:
        erros.append("%s: perfil \"%s\" inválido. Use: %s." % (rotulo, item["p"], ", ".join(PERFIS)))
    if item["l"] not in LICENCAS:
        erros.append("%s: licença \"%s\" inválida. Use: %s (\"nao-informada\" quando a fonte não diz)." % (rotulo, item["l"], ", ".join(LICENCAS)))

    d = data_valida(item["d"])
    if d is None:
        erros.append("%s: a data \"%s\" não existe ou não está no formato AAAA-MM-DD." % (rotulo, item["d"]))
    elif d > hoje:
        erros.append("%s: a data %s é depois de hoje (%s). Confira o ano e o mês." % (rotulo, item["d"], hoje.isoformat()))
    elif d < hoje - datetime.timedelta(days=janela):
        avisos.append("%s: a data %s está fora da janela de %d dias; o item irá direto para o arquivo." % (rotulo, item["d"], janela))

    f = item["f"]
    if not isinstance(f, dict) or not str(f.get("n", "")).strip() or not str(f.get("u", "")).strip():
        erros.append("%s: a fonte (f) precisa ter {\"n\": nome da fonte, \"u\": endereço}." % rotulo)
    else:
        item["f"] = {"n": limpar_texto(str(f["n"])), "u": str(f["u"]).strip()}
        if not RE_URL.match(item["f"]["u"]):
            erros.append("%s: o endereço da fonte precisa começar com http:// ou https://." % rotulo)
    return item, erros, avisos


def embutir_copia(dados):
    """Grava no index.html a cópia dos dados usada quando o data.json não carrega."""
    if not os.path.exists(INDEX_FILE):
        return False
    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        html = f.read()
    if len(RE_COPIA.findall(html)) != 1:
        print("AVISO: o bloco <script id=\"radar-fallback\"> não foi encontrado no index.html; a cópia embutida não foi atualizada.")
        return False
    carga = json.dumps(dados, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    novo = RE_COPIA.sub(lambda m: m.group(1) + carga + m.group(3), html, count=1)
    tmp = INDEX_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(novo)
    os.replace(tmp, INDEX_FILE)
    return True


def main(argv):
    args = argv[1:]
    if "-h" in args or "--help" in args:
        print(__doc__)
        return 0

    def opcao(nome):
        if nome in args:
            i = args.index(nome)
            if i + 1 >= len(args):
                sys.exit("A opção %s precisa de um valor." % nome)
            return args[i + 1]
        return None

    simular = "--simular" in args
    so_copia = "--so-copia-embutida" in args
    texto_hoje = opcao("--hoje")
    if texto_hoje:
        hoje = data_valida(texto_hoje)
        if hoje is None:
            sys.exit("--hoje precisa ser uma data real no formato AAAA-MM-DD.")
    else:
        hoje = hoje_brasilia()

    valores = {texto_hoje} if texto_hoje else set()
    arquivos = [a for a in args if not a.startswith("--") and a not in valores]

    dados = ler_json(DATA_FILE)
    if not isinstance(dados, dict):
        sys.exit("data.json precisa ser um objeto JSON { ... }.")
    if not isinstance(dados.get("lancamentos"), list):
        dados["lancamentos"] = []

    if so_copia:
        if embutir_copia(dados):
            print("Cópia embutida do index.html atualizada com o data.json atual.")
        return 0

    if not arquivos:
        print(__doc__)
        return 2

    janela = int(dados.get("janela_dias") or JANELA_PADRAO)

    # 1) lê e valida tudo antes de mexer em qualquer coisa
    novos, erros, avisos, ignorados = [], [], [], 0
    for arq in arquivos:
        lista = ler_json(arq)
        if isinstance(lista, dict) and isinstance(lista.get("lancamentos"), list):
            lista = lista["lancamentos"]
        if not isinstance(lista, list):
            erros.append("%s: precisa conter uma lista JSON de lançamentos ([ ... ])." % os.path.basename(arq))
            continue
        for i, bruto in enumerate(lista):
            if isinstance(bruto, dict) and bruto.get("_exemplo"):
                ignorados += 1
                continue
            item, e, a = validar_item(bruto, "%s, item %d" % (os.path.basename(arq), i + 1), hoje, janela)
            erros += e
            avisos += a
            if not e:
                novos.append(item)
    for a in avisos:
        print("AVISO: " + a)
    if erros:
        for e in erros:
            print("ERRO:  " + e)
        print("\nNada foi alterado. Corrija o(s) arquivo(s) de novos e rode de novo.")
        return 1
    if ignorados:
        print("(%d item(ns) de exemplo ignorado(s))" % ignorados)

    # 2) junta, sem repetir (mesmo nome e mesma organização = atualiza o texto)
    base = copy.deepcopy(dados)
    existentes = {chave(it): i for i, it in enumerate(base["lancamentos"])}
    adicionados = atualizados = 0
    for item in novos:
        k = chave(item)
        if k in existentes:
            base["lancamentos"][existentes[k]] = item
            atualizados += 1
        else:
            base["lancamentos"].insert(0, item)
            existentes = {chave(it): i for i, it in enumerate(base["lancamentos"])}
            adicionados += 1
    base["lancamentos"].sort(key=lambda x: x["d"], reverse=True)

    # 3) edição e checagem = dia da execução
    base["data_checagem"] = hoje.isoformat()
    base["edicao"] = "%d de %s de %d" % (hoje.day, MESES[hoje.month - 1], hoje.year)
    base["janela_dias"] = janela

    # 4) o que passou da janela vai para o arquivo
    corte = hoje - datetime.timedelta(days=janela)
    ativos, saem = [], []
    for it in base["lancamentos"]:
        d = data_valida(it.get("d"))
        (saem if (d is not None and d < corte) else ativos).append(it)
    base["lancamentos"] = ativos
    arquivo = ler_json(ARCHIVE_FILE, [])
    if not isinstance(arquivo, list):
        arquivo = []
    ja = {(str(x.get("n", "")).casefold(), x.get("d"), str(x.get("o", "")).casefold()) for x in arquivo}
    for it in saem:
        if (it["n"].casefold(), it["d"], it["o"].casefold()) not in ja:
            arquivo.append(it)
    arquivo.sort(key=lambda x: x.get("d", ""), reverse=True)

    sem_fonte = [it["n"] for it in ativos if not isinstance(it.get("f"), dict)]
    if sem_fonte:
        print("AVISO: %d item(ns) ativo(s) sem fonte: %s" % (len(sem_fonte), "; ".join(sem_fonte)))

    if not simular:
        gravar_json(DATA_FILE, base)
        gravar_json(ARCHIVE_FILE, arquivo)
        embutir_copia(base)

    abertos = sum(1 for i in ativos if i.get("l") == "aberto")
    ult7 = sum(1 for i in ativos if (hoje - data_valida(i["d"])).days <= 7)
    print("\n%sEdição: %s (checagem em %s)" % ("[SIMULAÇÃO] " if simular else "", base["edicao"], base["data_checagem"]))
    print("  novos: %d | atualizados: %d | enviados ao arquivo: %d" % (adicionados, atualizados, len(saem)))
    print("  ativos no radar: %d | arquivados no total: %d" % (len(ativos), len(arquivo)))
    print("\n--------------------------------------------------")
    print("MÉTRICAS PARA LEGENDA / REDES SOCIAIS:")
    print("• Lançamentos na janela de %d dias: %d (últimos 7 dias: %d)" % (janela, len(ativos), ult7))
    print("• Código aberto: %d" % abertos)
    print("• Organizações diferentes: %d" % len({i["o"] for i in ativos}))
    print("--------------------------------------------------")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
