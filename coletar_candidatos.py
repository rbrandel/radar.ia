#!/usr/bin/env python3
"""Monta o lembrete de sábado do Radar de IA.

Coleta, em fontes públicas, candidatos a lançamentos da última semana (OpenRouter, Hugging Face e GitHub)
e monta o texto do lembrete a partir de rotina/PEDIDO-SABADO.md. É só uma lista bruta de candidatos:
quem escolhe, confere e escreve os itens é a curadoria (você e o Claude).

Uso:
  python3 coletar_candidatos.py                      grava corpo-lembrete.md com a janela dos últimos 7 dias
  python3 coletar_candidatos.py --saida outro.md     escolhe o arquivo de saída
  python3 coletar_candidatos.py --hoje 2026-11-07    simula outro dia (o sábado da checagem)
  python3 coletar_candidatos.py --sem-rede           não consulta a internet (só o texto do pedido)

Uma fonte fora do ar nunca derruba o lembrete: ela aparece no fim da lista, como "não respondeu".
Só usa a biblioteca padrão do Python 3.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
MODELO = os.path.join(AQUI, "rotina", "PEDIDO-SABADO.md")
BR = datetime.timezone(datetime.timedelta(hours=-3))  # o Brasil não tem horário de verão desde 2019
TIMEOUT = 25
MAX_DESC = 160
MAX_CANDIDATOS = 45000  # o corpo de uma issue aceita até 65 mil caracteres
UA = "radar-ia-coletor/1.0"
GITHUB_TOPICOS = ("llm", "ai-agents", "mcp-server", "agents")


def hoje_brasilia():
    return datetime.datetime.now(BR).date()


def fmt(d):
    return d.strftime("%d/%m/%Y")


def curto(d):
    return d.strftime("%d/%m")


def limpa(txt, n=MAX_DESC):
    """Texto de terceiros em uma linha só, sem nada que vire menção, referência ou bloco de código."""
    s = re.sub(r"\s+", " ", str(txt or "")).strip()
    s = s.replace("`", "'").replace("@", "").replace("#", "")
    if len(s) > n:
        s = s[: n - 1].rstrip() + "…"
    return s


def http_json(url, token=None):
    cab = {"User-Agent": UA, "Accept": "application/json"}
    if token:
        cab["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=cab)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def data_iso(txt):
    try:
        return datetime.date.fromisoformat(str(txt)[:10])
    except ValueError:
        return None


def usd_por_milhao(valor):
    try:
        v = float(valor) * 1_000_000
    except (TypeError, ValueError):
        return None
    return ("US$ %.2f" % v).replace(".", ",")


def numero(n):
    try:
        return f"{int(n):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "0"


# ---------------------------------------------------------------- fontes
def coletar_openrouter(inicio, fim):
    """Modelos que entraram no catálogo do OpenRouter na janela (o campo 'created' vem em segundos)."""
    dados = http_json("https://openrouter.ai/api/v1/models")
    itens = []
    for m in dados.get("data", []):
        try:
            criado = datetime.datetime.fromtimestamp(float(m.get("created")), BR).date()
        except (TypeError, ValueError, OSError, OverflowError):
            continue
        if not (inicio <= criado <= fim) or not m.get("id"):
            continue
        preco = m.get("pricing") or {}
        entrada, saida = usd_por_milhao(preco.get("prompt")), usd_por_milhao(preco.get("completion"))
        partes = []
        if m.get("context_length"):
            partes.append("contexto %s tokens" % numero(m["context_length"]))
        if entrada and saida:
            partes.append("%s entrada / %s saída por 1M tokens" % (entrada, saida))
        itens.append({"ordem": criado, "nome": limpa(m.get("name") or m["id"], 80),
                      "url": "https://openrouter.ai/" + urllib.parse.quote(str(m["id"]), safe="/:"),
                      "data": criado, "detalhe": " · ".join(partes), "desc": limpa(m.get("description"))})
    itens.sort(key=lambda i: i["ordem"], reverse=True)
    return itens[:20]


def coletar_huggingface(inicio, fim):
    """Modelos em alta no Hugging Face que foram criados na janela."""
    lista = None
    for ordem in ("trendingScore", "likes7d", "likes"):
        url = "https://huggingface.co/api/models?" + urllib.parse.urlencode(
            {"sort": ordem, "direction": "-1", "limit": "100"})
        try:
            lista = http_json(url)
            break
        except urllib.error.HTTPError as e:
            if e.code != 400:
                raise
    if not isinstance(lista, list):
        raise RuntimeError("resposta inesperada")
    itens = []
    for m in lista:
        criado = data_iso(m.get("createdAt"))
        mid = m.get("id") or m.get("modelId")
        if not mid or not criado or not (inicio <= criado <= fim):
            continue
        detalhe = "%s · %s curtidas · %s downloads" % (m.get("pipeline_tag") or "modelo",
                                                        numero(m.get("likes")), numero(m.get("downloads")))
        itens.append({"ordem": int(m.get("likes") or 0), "nome": limpa(mid, 80),
                      "url": "https://huggingface.co/" + urllib.parse.quote(str(mid), safe="/"),
                      "data": criado, "detalhe": detalhe, "desc": ""})
    itens.sort(key=lambda i: i["ordem"], reverse=True)
    return itens[:15]


def coletar_github(inicio, fim, token):
    """Repositórios novos de IA com mais estrelas, por tópico."""
    vistos = {}
    for topico in GITHUB_TOPICOS:
        q = "topic:%s created:%s..%s stars:>=30" % (topico, inicio.isoformat(), fim.isoformat())
        url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode(
            {"q": q, "sort": "stars", "order": "desc", "per_page": "15"})
        for r in http_json(url, token).get("items", []):
            if r.get("full_name"):
                vistos.setdefault(r["full_name"], r)
    itens = []
    for nome, r in vistos.items():
        criado = data_iso(r.get("created_at"))
        itens.append({"ordem": int(r.get("stargazers_count") or 0), "nome": limpa(nome, 80),
                      "url": "https://github.com/" + urllib.parse.quote(nome, safe="/"),
                      "data": criado, "detalhe": "%s estrelas · %s" % (numero(r.get("stargazers_count")),
                                                                         r.get("language") or "linguagem não informada"),
                      "desc": limpa(r.get("description"))})
    itens.sort(key=lambda i: i["ordem"], reverse=True)
    return itens[:15]


# ---------------------------------------------------------------- texto
def linhas(itens, vazio):
    if not itens:
        return ["- " + vazio]
    saida = []
    for i in itens:
        quando = " · " + curto(i["data"]) if i.get("data") else ""
        detalhe = " · " + i["detalhe"] if i.get("detalhe") else ""
        desc = " — " + i["desc"] if i.get("desc") else ""
        saida.append("- %s (%s)%s%s%s" % (i["nome"], i["url"], quando, detalhe, desc))
    return saida


def montar_candidatos(inicio, fim, sem_rede, token):
    if sem_rede:
        return "Coleta automática desligada nesta execução. Procure na web os lançamentos da janela."
    fontes = [
        ("OpenRouter, modelos novos no catálogo", lambda: coletar_openrouter(inicio, fim),
         "nenhum modelo novo no catálogo nesta janela."),
        ("Hugging Face, modelos em alta criados na janela", lambda: coletar_huggingface(inicio, fim),
         "nenhum modelo em alta foi criado nesta janela (o ranking de tendências costuma mostrar modelos mais antigos)."),
        ("GitHub, repositórios novos com mais estrelas (%s)" % ", ".join(GITHUB_TOPICOS),
         lambda: coletar_github(inicio, fim, token), "nenhum repositório novo com 30 estrelas ou mais."),
    ]
    blocos, falhas = [], []
    for titulo, coletar, vazio in fontes:
        try:
            itens = coletar()
        except Exception as e:  # uma fonte fora do ar não pode derrubar o lembrete
            falhas.append("%s (%s)" % (titulo.split(",")[0], limpa(e, 80)))
            continue
        blocos.append("\n".join([titulo + ":"] + linhas(itens, vazio)))
    if not blocos:
        blocos.append("Nenhuma fonte respondeu. Procure na web os lançamentos da janela.")
    texto = "\n\n".join(blocos)
    if falhas:
        texto += "\n\nFontes que não responderam nesta execução: " + "; ".join(falhas) + "."
    if len(texto) > MAX_CANDIDATOS:
        texto = texto[:MAX_CANDIDATOS].rstrip() + "\n(lista cortada por tamanho)"
    return texto


def montar_corpo(hoje, sem_rede=False, token=None):
    fim = hoje
    inicio = hoje - datetime.timedelta(days=7)
    domingo = hoje + datetime.timedelta(days=1)
    candidatos = montar_candidatos(inicio, fim, sem_rede, token)
    try:
        with open(MODELO, "r", encoding="utf-8") as f:
            corpo = f.read()
    except OSError:
        corpo = "Lembrete de sábado do Radar de IA: peça ao Claude os lançamentos de {{INICIO}} a {{FIM}}.\n\n{{CANDIDATOS}}\n"
    # {{CANDIDATOS}} por último: o texto de terceiros nunca é reprocessado.
    for chave, valor in (("{{INICIO}}", fmt(inicio)), ("{{FIM}}", fmt(fim)), ("{{DATA_ARQUIVO}}", domingo.isoformat())):
        corpo = corpo.replace(chave, valor)
    return corpo.replace("{{CANDIDATOS}}", candidatos)


def main():
    ap = argparse.ArgumentParser(description="Monta o lembrete de sábado do Radar de IA.")
    ap.add_argument("--saida", default="corpo-lembrete.md")
    ap.add_argument("--hoje", help="AAAA-MM-DD: simula esse dia (o sábado da checagem)")
    ap.add_argument("--sem-rede", action="store_true", help="não consulta a internet")
    args = ap.parse_args()
    if args.hoje:
        hoje = data_iso(args.hoje)
        if not hoje:
            sys.exit("--hoje precisa estar no formato AAAA-MM-DD")
    else:
        hoje = hoje_brasilia()
    corpo = montar_corpo(hoje, args.sem_rede, os.environ.get("GITHUB_TOKEN") or None)
    with open(args.saida, "w", encoding="utf-8") as f:
        f.write(corpo if corpo.endswith("\n") else corpo + "\n")
    print("Lembrete gravado em %s (%d caracteres), janela %s a %s." % (
        args.saida, len(corpo), fmt(hoje - datetime.timedelta(days=7)), fmt(hoje)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
