#!/usr/bin/env python3
"""Mantém o projeto do Supabase ativo (o plano grátis pausa depois de 1 semana sem uso).

Lê o endereço e a chave pública do config.js e faz uma consulta leve de leitura (a mesma que o site faz).
Se o config.js estiver vazio, não faz nada. Uso: python3 manter_ativo.py
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

AQUI = Path(__file__).resolve().parent


def ler_config():
    texto = (AQUI / "config.js").read_text(encoding="utf-8") if (AQUI / "config.js").exists() else ""
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)           # tira comentários /* ... */
    texto = re.sub(r"(?m)(^|\s)//.*$", r"\1", texto)                # tira comentários de linha (o // de https:// fica)
    def campo(nome):
        m = re.search(nome + r"""\s*:\s*(["'])(.*?)\1""", texto)
        return m.group(2).strip() if m else ""
    return campo("supabaseUrl"), campo("supabaseKey")


def normalizar_url(bruto):
    """Mesma tolerância do db.js: aceita sem https://, com / ou /rest/v1/ no fim, ou o endereço do painel."""
    s = (bruto or "").strip()
    if not s:
        return ""
    if re.fullmatch(r"[a-z0-9]{20}", s, re.I):           # só o "Project ID"
        return "https://%s.supabase.co" % s.lower()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", s, re.I):
        s = "https://" + s
    try:
        u = urlparse(s)
        host = (u.hostname or "").lower()
    except ValueError:
        return ""
    if u.scheme.lower() != "https":
        return ""
    if re.fullmatch(r"[a-z0-9-]+\.supabase\.co", host):
        return "https://" + host
    if host in ("supabase.com", "www.supabase.com"):
        m = re.search(r"/project/([a-z0-9]{6,40})(/|$)", u.path, re.I)
        if m:
            return "https://%s.supabase.co" % m.group(1).lower()
    return ""


def main():
    url_bruta, chave = ler_config()
    if not url_bruta and not chave:
        print("config.js sem Supabase configurado: nada a fazer.")
        return 0
    url = normalizar_url(url_bruta)
    if re.fullmatch(r"https://(seu-?projeto|meu-?projeto|codigo(-do-projeto)?|projeto|abcdefghijklmnopqrst|x{4,})\.supabase\.co", url):
        print("::warning::config.js ainda tem um endereço de EXEMPLO em supabaseUrl; não consultei o Supabase.")
        return 0
    if not url or not chave:
        print("::warning::config.js com supabaseUrl/supabaseKey inválidos; não consultei o Supabase.")
        return 0
    if chave.startswith("sb_secret_"):
        print("::error::supabaseKey é uma chave SECRETA. Troque pela publishable e gere outra secreta no Supabase.")
        return 1
    corpo = json.dumps({"p_rodada": "0000-W00", "p_candidatos": ["ping"]}).encode()
    req = urllib.request.Request(url + "/rest/v1/rpc/estado_votos", data=corpo, method="POST",
                                 headers={"apikey": chave, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print("Supabase respondeu (HTTP %d). Projeto ativo." % resp.status)
        return 0
    except urllib.error.HTTPError as e:
        # Qualquer resposta HTTP prova que o projeto está de pé; só avisa se não for sucesso.
        print("::warning::Supabase respondeu HTTP %d. Confira se o projeto não está pausado (painel do Supabase) e se o 01-enquete.sql foi executado." % e.code)
        return 0 if e.code < 500 else 1
    except Exception as e:  # rede, DNS, tempo esgotado
        print("::warning::Não consegui falar com o Supabase: %s" % e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
