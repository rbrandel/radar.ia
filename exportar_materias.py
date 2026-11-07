#!/usr/bin/env python3
"""Guarda no noticias.json uma cópia das matérias que estão no ar no Supabase.

Para que serve: o site lê as matérias do Supabase e, se ele não responder (projeto pausado, fora do ar), mostra
a cópia salva no noticias.json. Este script mantém essa cópia em dia. Roda sozinho todo dia (aba Actions do
GitHub) e também à mão.

Usa só a chave PÚBLICA do config.js, a mesma que o site usa: só enxerga o que o público já vê (matérias publicadas
cuja data já chegou). Rascunhos, agendadas e arquivadas nunca entram. Só usa a biblioteca padrão do Python.

Segurança da cópia: se o Supabase responder vazio e o noticias.json já tiver matérias, o script NÃO apaga a cópia
(pode ser um erro). Para esvaziar de propósito, use --permitir-vazio.

Uso:  python3 exportar_materias.py            grava o noticias.json se algo mudou
      python3 exportar_materias.py --simular  mostra o que mudaria, sem gravar
"""
import argparse
import datetime
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
from manter_ativo import ler_config, normalizar_url  # noqa: E402  (mesmo leitor do config.js)

ARQUIVO = AQUI / "noticias.json"
COLUNAS = "slug,titulo,chamada,corpo,categoria,tags,capa_url,fontes,autor,publicada_em,conferido_em,destaque"
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
EXEMPLO_RE = re.compile(r"https://(seu-?projeto|meu-?projeto|codigo(-do-projeto)?|projeto|abcdefghijklmnopqrst|x{4,})\.supabase\.co")


def limpar(linha):
    """Devolve a matéria no formato do noticias.json, ou None se a linha não for válida."""
    if not isinstance(linha, dict):
        return None
    slug = linha.get("slug")
    titulo = linha.get("titulo")
    if not isinstance(slug, str) or not SLUG_RE.match(slug) or len(slug) > 80:
        return None
    if not isinstance(titulo, str) or not titulo.strip():
        return None
    fontes = []
    for f in linha.get("fontes") or []:
        if isinstance(f, dict) and isinstance(f.get("u"), str) and re.match(r"^https?://", f["u"]):
            fontes.append({"n": str(f.get("n") or f["u"])[:160], "u": f["u"]})
    tags = [t for t in (linha.get("tags") or []) if isinstance(t, str) and t.strip()][:8]
    return {
        "slug": slug,
        "titulo": titulo,
        "chamada": linha.get("chamada") or "",
        "corpo": linha.get("corpo") or "",
        "categoria": linha.get("categoria") or "novidade",
        "tags": tags,
        "capa_url": linha.get("capa_url") or None,
        "fontes": fontes[:12],
        "autor": linha.get("autor") or "Rodrigo Brandelero",
        "publicada_em": linha.get("publicada_em"),
        "conferido_em": linha.get("conferido_em"),
        "destaque": linha.get("destaque") is True,
    }


def buscar(url, chave):
    consulta = "/rest/v1/materias?select=%s&status=eq.publicado&order=publicada_em.desc&limit=500" % COLUNAS
    req = urllib.request.Request(url + consulta, method="GET", headers={"apikey": chave, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Atualiza o noticias.json com as matérias publicadas no Supabase.")
    ap.add_argument("--simular", action="store_true", help="mostra o que mudaria e não grava")
    ap.add_argument("--permitir-vazio", action="store_true", help="aceita esvaziar o noticias.json se o Supabase vier sem matérias")
    args = ap.parse_args(argv)

    url_bruta, chave = ler_config()
    if not url_bruta and not chave:
        print("config.js sem Supabase configurado: nada a fazer.")
        return 0
    url = normalizar_url(url_bruta)
    if EXEMPLO_RE.fullmatch(url or ""):
        print("::warning::config.js ainda tem um endereço de EXEMPLO em supabaseUrl; não consultei o Supabase.")
        return 0
    if not url or not chave:
        print("::warning::config.js com supabaseUrl/supabaseKey inválidos; não consultei o Supabase.")
        return 0
    if chave.startswith("sb_secret_"):
        print("::error::supabaseKey é uma chave SECRETA. Troque pela publishable e gere outra secreta no Supabase.")
        return 1

    try:
        linhas = buscar(url, chave)
    except urllib.error.HTTPError as e:
        print("::error::O Supabase respondeu HTTP %d. A cópia noticias.json não foi alterada. Confira se o projeto não está pausado e se o 03-materias.sql foi executado." % e.code)
        return 1
    except Exception as e:  # rede, DNS, tempo esgotado, resposta que não é JSON
        print("::error::Não consegui ler as matérias do Supabase (%s). A cópia noticias.json não foi alterada." % e)
        return 1
    if not isinstance(linhas, list):
        print("::error::Resposta inesperada do Supabase (não é uma lista). A cópia noticias.json não foi alterada.")
        return 1

    materias = []
    for linha in linhas:
        m = limpar(linha)
        if m is None:
            print("::warning::Ignorei uma linha inválida (endereço ou título fora do padrão).")
        else:
            materias.append(m)

    antigo = {}
    if ARQUIVO.exists():
        try:
            antigo = json.loads(ARQUIVO.read_text(encoding="utf-8"))
        except ValueError:
            print("::warning::O noticias.json atual não é um JSON válido; vou substituí-lo.")
    antigas = antigo.get("materias") if isinstance(antigo, dict) and isinstance(antigo.get("materias"), list) else []

    if not materias and antigas and not args.permitir_vazio:
        print("::error::O Supabase veio sem matérias publicadas, mas o noticias.json tem %d. Não apaguei a cópia (pode ser um erro). Se for de propósito, rode com --permitir-vazio." % len(antigas))
        return 1

    def forma(lista):
        return json.dumps(lista, sort_keys=True, ensure_ascii=False)

    if forma(materias) == forma(antigas):
        print("noticias.json já está em dia (%d matéria(s))." % len(materias))
        return 0

    slugs_novos = {m["slug"] for m in materias}
    slugs_antigos = {m.get("slug") for m in antigas if isinstance(m, dict)}
    print("Mudou: +%d nova(s), -%d fora do ar, total %d." % (len(slugs_novos - slugs_antigos), len(slugs_antigos - slugs_novos), len(materias)))
    if args.simular:
        print("(simulação: nada foi gravado)")
        return 0

    agora = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    ARQUIVO.write_text(json.dumps({"gerado_em": agora, "materias": materias}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("noticias.json atualizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
