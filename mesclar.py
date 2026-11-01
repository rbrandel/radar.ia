#!/usr/bin/env python3
"""
Script de Atualização Semanal - Radar de IA
Autor: Rodrigo Brandelero
Uso: python3 mesclar.py novos-2026-11-01.json

Executa a mesclagem dos novos lançamentos ao `data.json`, valida campos obrigatórios,
muda a data de checagem, arquiva lançamentos antigos (>21 dias) e gera estatísticas.
"""

import sys
import json
import os
from datetime import datetime, timedelta

DATA_FILE = "data.json"
ARCHIVE_FILE = "arquivo_historico.json"
DIST_DIR = "dist"

REQUIRED_FIELDS = ["d", "n", "o", "c", "p", "l", "s", "a", "t"]
VALID_CATEGORIES = ["modelos", "agentes", "voz", "video"]
VALID_PROFILES = ["dev", "negocios", "criativo"]

def load_json(filepath):
    if not os.path.exists(filepath):
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def validate_item(item, index):
    for field in REQUIRED_FIELDS:
        if field not in item or not str(item[field]).strip():
            raise ValueError(f"Item #{index+1} ({item.get('n', 'Sem Nome')}): Campo '{field}' ausente ou vazio.")
    
    if item["c"] not in VALID_CATEGORIES:
        raise ValueError(f"Item '{item['n']}': Categoria '{item['c']}' inválida. Use uma de: {VALID_CATEGORIES}")
        
    if item["p"] not in VALID_PROFILES:
        raise ValueError(f"Item '{item['n']}': Perfil '{item['p']}' inválido. Use um de: {VALID_PROFILES}")

def main():
    if len(sys.argv) < 2:
        print("❌ Erro: Informe o arquivo com os novos lançamentos.")
        print("   Exemplo: python3 mesclar.py novos-2026-11-01.json")
        sys.exit(1)

    new_file = sys.argv[1]
    new_items = load_json(new_file)
    
    if not new_items or not isinstance(new_items, list):
        print(f"❌ Erro: O arquivo '{new_file}' deve conter uma lista JSON válida de lançamentos.")
        sys.exit(1)

    base_data = load_json(DATA_FILE)
    if not base_data:
        print(f"❌ Erro: O arquivo base '{DATA_FILE}' não foi encontrado.")
        sys.exit(1)

    print(f"🔍 Validando {len(new_items)} novos lançamentos...")
    for idx, item in enumerate(new_items):
        validate_item(item, idx)

    # Identificar itens duplicados por nome
    existing_names = {item["n"].lower(): item for item in base_data["lancamentos"]}
    added_count = 0
    updated_count = 0

    for item in new_items:
        key = item["n"].lower()
        if key in existing_names:
            # Atualiza existente
            idx = base_data["lancamentos"].index(existing_names[key])
            base_data["lancamentos"][idx] = item
            updated_count += 1
        else:
            base_data["lancamentos"].insert(0, item)
            added_count += 1

    # Ordenar por data decrescente
    base_data["lancamentos"].sort(key=lambda x: x["d"], reverse=True)

    # Definir nova data de checagem como a data do lançamento mais recente
    latest_date_str = base_data["lancamentos"][0]["d"]
    latest_date = datetime.strptime(latest_date_str, "%Y-%m-%d")
    
    months_pt = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", 
                 "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
    
    base_data["data_checagem"] = latest_date_str
    base_data["edicao"] = f"{latest_date.day} de {months_pt[latest_date.month - 1]} de {latest_date.year}"

    # Limpeza / Arquivamento de itens mais antigos que 21 dias (janela expandida)
    cutoff_date = latest_date - timedelta(days=21)
    active_items = []
    archived_items = load_json(ARCHIVE_FILE) or []

    for item in base_data["lancamentos"]:
        item_date = datetime.strptime(item["d"], "%Y-%m-%d")
        if item_date < cutoff_date:
            archived_items.append(item)
        else:
            active_items.append(item)

    base_data["lancamentos"] = active_items

    # Salvar alterações
    save_json(DATA_FILE, base_data)
    save_json(ARCHIVE_FILE, archived_items)

    # Sincronizar diretório dist se existir
    if os.path.exists(DIST_DIR):
        save_json(os.path.join(DIST_DIR, DATA_FILE), base_data)

    print("\n✨ Atualização Concluída com Sucesso!")
    print(f"📅 Nova Edição: {base_data['edicao']}")
    print(f"➕ Novos Lançamentos Adicionados: {added_count}")
    print(f"🔄 Lançamentos Atualizados: {updated_count}")
    print(f"📦 Total de Lançamentos Ativos no Radar: {len(active_items)}")
    print(f"🗄️ Lançamentos Arquivados (>21 dias): {len(archived_items)}")

    # Imprimir Resumo para Redes Sociais
    open_source_count = sum(1 for i in active_items if i.get("l") == "aberto")
    print("\n--------------------------------------------------")
    print("📊 MÉTRICAS PARA LEGENDA / REDES SOCIAIS:")
    print(f"• Total de Lançamentos Mapeados: {len(active_items)}")
    print(f"• Ferramentas/Modelos Open Source: {open_source_count}")
    print(f"• Organizações Diferentes: {len(set(i['o'] for i in active_items))}")
    print("--------------------------------------------------\n")

if __name__ == "__main__":
    main()
