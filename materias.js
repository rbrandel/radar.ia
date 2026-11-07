'use strict';
/* Radar de IA: matérias (news).
 * Camada de dados (Supabase, com reserva em noticias.json) e leitor de Markdown seguro.
 * Usada pela capa e pela aba Matérias (novidades.js), pela página da matéria (materia.js) e pela área de publicação (admin.js).
 * Sem bibliotecas externas. Todo texto vindo do banco é escapado antes de ir para a página. */
(function () {
    const TIMEOUT_MS = 8000;
    const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

    /* Base para achar noticias.json e as páginas quando a matéria é aberta de uma subpasta (páginas geradas em materias/). */
    const baseMeta = document.querySelector('meta[name="radar-base"]');
    const BASE = baseMeta ? String(baseMeta.getAttribute('content') || '') : '';

    const CATEGORIAS = {
        plataforma: { nome: 'Plataforma da semana', emoji: '🧭', de: '#4f46e5', ate: '#7c3aed', texto: '#c7d2fe' },
        guia: { nome: 'Guia prático', emoji: '🛠️', de: '#047857', ate: '#0f766e', texto: '#a7f3d0' },
        novidade: { nome: 'Novidade', emoji: '📰', de: '#b45309', ate: '#c2410c', texto: '#fde68a' },
        analise: { nome: 'Análise', emoji: '🔎', de: '#1d4ed8', ate: '#4338ca', texto: '#bfdbfe' },
        bastidores: { nome: 'Bastidores', emoji: '🎬', de: '#9d174d', ate: '#6d28d9', texto: '#fbcfe8' }
    };
    function categoria(id) {
        const c = CATEGORIAS[id];
        if (c) return Object.assign({ id: id }, c);
        const nome = String(id || 'novidade').replace(/-/g, ' ');
        return { id: id, nome: nome.charAt(0).toUpperCase() + nome.slice(1), emoji: '📄', de: '#334155', ate: '#1e293b', texto: '#cbd5e1' };
    }
    const categoriasConhecidas = () => Object.keys(CATEGORIAS).map(categoria);

    /* ---------- endereços ---------- */
    function safeHttp(u) {
        try {
            const x = new URL(String(u || '').trim());
            return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
        } catch (e) {
            return '';
        }
    }
    /* Links permitidos dentro do texto: http(s) e caminhos do próprio site (matéria, página inicial e arquivos de materiais). */
    const LOCAL_RE = /^(materia\.html\?m=[a-z0-9-]{1,80}|index\.html(#[a-z]{3,20})?|materiais\/[A-Za-z0-9._-]{1,100})$/;
    function safeLink(u) {
        const s = String(u || '').trim();
        if (LOCAL_RE.test(s)) return { href: BASE + s, externo: false };
        const h = safeHttp(s);
        return h ? { href: h, externo: true } : null;
    }

    /* ---------- texto e datas ---------- */
    function slugify(texto) {
        return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
    }
    function parseData(v) {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    function dataLonga(v) {
        const d = parseData(v);
        if (!d) return '';
        const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
        const g = (t) => Number((p.find((x) => x.type === t) || {}).value);
        return g('day') + ' de ' + MESES[g('month') - 1] + ' de ' + g('year');
    }
    function dataCurta(v) {
        const d = parseData(v);
        return d ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '';
    }
    /* "2026-11-04" (só data, sem fuso) para "4 de novembro de 2026". */
    function diaLongo(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        return m && +m[2] >= 1 && +m[2] <= 12 ? Number(m[3]) + ' de ' + MESES[+m[2] - 1] + ' de ' + m[1] : '';
    }
    function tempoLeitura(corpo) {
        const palavras = String(corpo || '').replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round(palavras / 200));
    }

    /* ---------- Markdown seguro ----------
     * Aceita: títulos (#, ##, ###), parágrafos, listas, citações, linha (---), blocos de código com botão Copiar,
     * **negrito**, *itálico*, `código`, [texto](link) e ![texto](https://imagem). HTML escrito no texto aparece como texto. */
    const INLINE_RE = /`([^`\n]+)`|(!?)\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;
    const CLS_LINK = 'text-indigo-300 underline underline-offset-2 hover:text-indigo-200';

    function inline(raw, semLinks) {
        const s = String(raw == null ? '' : raw);
        let out = '';
        let last = 0;
        let m;
        /* Expressão nova a cada chamada: a função se chama de novo (link dentro de negrito) e uma expressão global compartilhada perderia a posição. */
        const re = new RegExp(INLINE_RE.source, 'g');
        while ((m = re.exec(s)) !== null) {
            out += esc(s.slice(last, m.index));
            last = m.index + m[0].length;
            if (m[1] != null) {
                out += '<code class="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-200 text-[0.9em] font-mono-code break-words">' + esc(m[1]) + '</code>';
            } else if (m[4] != null) {
                if (m[2] === '!') {
                    const src = safeHttp(m[4]);
                    out += src && /^https:/.test(src)
                        ? '<img src="' + esc(src) + '" alt="' + esc(m[3]) + '" loading="lazy" class="rounded-xl my-4 max-w-full h-auto border border-slate-800">'
                        : esc(m[0]);
                } else {
                    const link = semLinks ? null : safeLink(m[4]);
                    if (!link) {
                        out += esc(m[3]);
                    } else {
                        out += '<a href="' + esc(link.href) + '" class="' + CLS_LINK + '"' + (link.externo ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
                            inline(m[3], true) + (link.externo ? '<span class="sr-only"> (abre em nova aba)</span>' : '') + '</a>';
                    }
                }
            } else if (m[5] != null) {
                out += '<strong class="font-semibold text-white">' + inline(m[5], semLinks) + '</strong>';
            } else {
                out += '<em>' + inline(m[6], semLinks) + '</em>';
            }
        }
        return out + esc(s.slice(last));
    }

    function blocoCodigo(codigo, lang) {
        const rotulo = !lang || lang === 'text' || lang === 'txt' ? 'Copie e cole' : lang;
        return '<div class="my-4 rounded-xl border border-slate-700 bg-slate-950 overflow-hidden">' +
            '<div class="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-slate-800 bg-slate-900">' +
            '<span class="text-xs font-mono-code text-slate-400">' + esc(rotulo) + '</span>' +
            '<button type="button" data-copiar class="min-h-[44px] px-3 text-xs font-semibold text-indigo-300 hover:text-white">Copiar</button></div>' +
            '<pre class="p-3 sm:p-4 text-sm leading-relaxed text-slate-100 whitespace-pre-wrap break-words font-mono-code"><code>' + esc(codigo) + '</code></pre></div>';
    }

    const RE_ITEM = /^\s*([-*+]|\d+[.)])\s+(\S.*)$/;
    const RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
    const RE_CERCA = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
    const RE_TITULO = /^(#{1,4})\s+(\S.*?)\s*#*\s*$/;
    const RE_CITACAO = /^\s*>/;
    const comecaBloco = (l) => RE_TITULO.test(l) || RE_CERCA.test(l) || RE_CITACAO.test(l) || RE_ITEM.test(l) || RE_HR.test(l);

    function blocos(texto, nivelCitacao) {
        const linhas = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').split('\n');
        const usados = {};
        const out = [];
        let i = 0;
        while (i < linhas.length) {
            const l = linhas[i];
            if (!l.trim()) { i++; continue; }

            let m = RE_CERCA.exec(l);
            if (m) {
                const buf = [];
                const fecha = new RegExp('^\\s*' + m[1] + '\\s*$');
                i++;
                while (i < linhas.length && !fecha.test(linhas[i])) buf.push(linhas[i++]);
                i++;
                out.push(blocoCodigo(buf.join('\n'), m[2]));
                continue;
            }
            m = RE_TITULO.exec(l);
            if (m) {
                const n = Math.min(Math.max(m[1].length, 2), 4);
                const base = slugify(m[2].replace(/[*`[\]()]/g, '')) || 'secao';
                let id = base;
                for (let k = 2; usados[id]; k++) id = base + '-' + k;
                usados[id] = true;
                const cls = n === 2 ? 'mt-10 mb-3 text-xl sm:text-2xl font-bold text-white scroll-mt-24' : n === 3 ? 'mt-6 mb-2 text-lg font-semibold text-white scroll-mt-24' : 'mt-5 mb-2 text-base font-semibold text-slate-100 scroll-mt-24';
                out.push('<h' + n + ' id="' + esc(id) + '" class="' + cls + '">' + inline(m[2]) + '</h' + n + '>');
                i++;
                continue;
            }
            if (RE_HR.test(l)) { out.push('<hr class="my-8 border-slate-800">'); i++; continue; }
            if (RE_CITACAO.test(l)) {
                const buf = [];
                while (i < linhas.length && RE_CITACAO.test(linhas[i])) buf.push(linhas[i++].replace(/^\s*>\s?/, ''));
                out.push('<blockquote class="my-4 border-l-4 border-indigo-500/60 pl-4 text-slate-300">' + (nivelCitacao ? inline(buf.join(' ')) : blocos(buf.join('\n'), 1)) + '</blockquote>');
                continue;
            }
            m = RE_ITEM.exec(l);
            if (m) {
                const ordenada = /\d/.test(m[1]);
                const itens = [];
                while (i < linhas.length) {
                    const li = linhas[i];
                    const mi = RE_ITEM.exec(li);
                    if (mi && /\d/.test(mi[1]) === ordenada) { itens.push(mi[2]); i++; continue; }
                    if (!li.trim()) {
                        let j = i;
                        while (j < linhas.length && !linhas[j].trim()) j++;
                        const prox = j < linhas.length ? RE_ITEM.exec(linhas[j]) : null;
                        if (prox && /\d/.test(prox[1]) === ordenada) { i = j; continue; }
                        break;
                    }
                    if (/^\s{2,}\S/.test(li) && !mi && itens.length) { itens[itens.length - 1] += ' ' + li.trim(); i++; continue; }
                    break;
                }
                const tag = ordenada ? 'ol' : 'ul';
                out.push('<' + tag + ' class="my-3 pl-5 space-y-1.5 text-slate-200 leading-relaxed ' + (ordenada ? 'list-decimal' : 'list-disc') + '">' +
                    itens.map((t) => '<li>' + inline(t) + '</li>').join('') + '</' + tag + '>');
                continue;
            }
            const buf = [];
            while (i < linhas.length && linhas[i].trim() && !(buf.length && comecaBloco(linhas[i]))) buf.push(linhas[i++].trim());
            out.push('<p class="my-3 text-slate-200 leading-relaxed">' + inline(buf.join(' ')) + '</p>');
        }
        return out.join('');
    }
    const markdown = (texto) => blocos(texto, 0);

    /* Liga os botões "Copiar" dos blocos de código dentro de uma área. */
    function ativarCopiar(raiz) {
        if (!raiz || raiz.dataset.copiarAtivo) return;
        raiz.dataset.copiarAtivo = '1';
        raiz.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('[data-copiar]');
            if (!btn) return;
            const pre = btn.closest('div').parentElement.querySelector('pre');
            const texto = pre ? pre.textContent : '';
            const antes = btn.textContent;
            try {
                await navigator.clipboard.writeText(texto);
                btn.textContent = 'Copiado';
            } catch (e) {
                const area = document.createElement('textarea');
                area.value = texto;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
                document.body.removeChild(area);
                btn.textContent = ok ? 'Copiado' : 'Selecione e copie';
            }
            setTimeout(() => { btn.textContent = antes; }, 2000);
        });
    }

    /* ---------- dados ---------- */
    function normalizar(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
        const slug = str(raw.slug, 80);
        if (!SLUG_RE.test(slug)) return null;
        const titulo = str(raw.titulo, 140).trim();
        if (!titulo) return null;
        const fontes = (Array.isArray(raw.fontes) ? raw.fontes : []).slice(0, 12).map((f) => {
            const u = f && typeof f === 'object' ? safeHttp(f.u) : '';
            return u ? { n: str(f.n, 160).trim() || u, u: u } : null;
        }).filter(Boolean);
        const capa = safeHttp(raw.capa_url);
        return {
            id: str(raw.id, 64),
            slug: slug,
            titulo: titulo,
            chamada: str(raw.chamada, 240).trim(),
            corpo: str(raw.corpo, 40000),
            categoria: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str(raw.categoria, 30)) ? raw.categoria : 'novidade',
            tags: (Array.isArray(raw.tags) ? raw.tags : []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 8).map((t) => t.trim().slice(0, 40)),
            capa_url: /^https:/.test(capa) ? capa : '',
            fontes: fontes,
            autor: str(raw.autor, 80).trim() || 'Rodrigo Brandelero',
            status: ['rascunho', 'publicado', 'arquivado'].indexOf(raw.status) >= 0 ? raw.status : 'publicado',
            publicada_em: parseData(raw.publicada_em) ? String(raw.publicada_em) : '',
            conferido_em: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.conferido_em || '')) ? raw.conferido_em : '',
            destaque: raw.destaque === true,
            criado_em: str(raw.criado_em, 40),
            atualizado_em: str(raw.atualizado_em, 40)
        };
    }

    function ordenar(lista) {
        return lista.slice().sort((a, b) => (b.destaque - a.destaque) || ((parseData(b.publicada_em) || 0) - (parseData(a.publicada_em) || 0)));
    }
    const jaPublicada = (m) => m.status === 'publicado' && !!parseData(m.publicada_em) && parseData(m.publicada_em) <= new Date();

    function config() {
        return window.RadarDB && window.RadarDB.enabled && window.RadarDB.config ? window.RadarDB.config : null;
    }
    const habilitado = () => !!config();

    async function pedir(url, headers) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(url, { headers: headers, signal: ctrl.signal });
            const text = await resp.text();
            let data = null;
            if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
            if (!resp.ok) {
                const err = new Error((data && (data.message || data.msg)) || 'HTTP ' + resp.status);
                err.status = resp.status;
                throw err;
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function lerSupabase(caminho) {
        const cfg = config();
        const dados = await pedir(cfg.url + caminho, { apikey: cfg.key, Accept: 'application/json' });
        if (!Array.isArray(dados)) throw new Error('resposta inesperada');
        return dados;
    }

    let cacheArquivo = null;
    async function lerArquivo() {
        if (location.protocol === 'file:') throw new Error('abrindo como arquivo local');
        if (!cacheArquivo) {
            const json = await pedir(BASE + 'noticias.json', { Accept: 'application/json' });
            if (!json || !Array.isArray(json.materias)) throw new Error('noticias.json em formato inesperado');
            cacheArquivo = json.materias.map((m) => normalizar(Object.assign({ status: 'publicado' }, m))).filter(Boolean);
        }
        return ordenar(cacheArquivo.filter(jaPublicada));
    }

    const COLUNAS_LISTA = 'slug,titulo,chamada,categoria,tags,capa_url,autor,publicada_em,conferido_em,destaque';

    /* Lista as matérias publicadas, sem o texto completo. fonte: "banco", "arquivo" (reserva) ou "indisponivel". */
    async function listar() {
        let motivo = '';
        if (habilitado()) {
            try {
                const linhas = await lerSupabase('/rest/v1/materias?select=' + COLUNAS_LISTA + '&status=eq.publicado&order=destaque.desc,publicada_em.desc&limit=100');
                return { itens: ordenar(linhas.map(normalizar).filter(Boolean).filter(jaPublicada)), fonte: 'banco', aviso: '' };
            } catch (e) {
                motivo = e.message;
                console.warn('Matérias: banco indisponível, usando noticias.json:', e.message);
            }
        }
        try {
            const itens = (await lerArquivo()).map((m) => Object.assign({}, m, { corpo: '' }));
            return { itens: itens, fonte: 'arquivo', aviso: motivo ? 'Mostrando a cópia salva das matérias (o banco não respondeu).' : '' };
        } catch (e) {
            return { itens: [], fonte: 'indisponivel', aviso: 'Não consegui carregar as matérias agora.' };
        }
    }

    /* Uma matéria publicada, com o texto completo. materia é null quando não existe (ou ainda não foi ao ar). */
    async function obter(slug) {
        if (!SLUG_RE.test(String(slug || ''))) return { materia: null, fonte: 'banco', aviso: '' };
        let motivo = '';
        if (habilitado()) {
            try {
                const linhas = await lerSupabase('/rest/v1/materias?select=*&slug=eq.' + encodeURIComponent(slug) + '&status=eq.publicado&limit=1');
                const m = linhas.map(normalizar).filter(Boolean).filter(jaPublicada)[0] || null;
                return { materia: m, fonte: 'banco', aviso: '' };
            } catch (e) {
                motivo = e.message;
                console.warn('Matéria: banco indisponível, usando noticias.json:', e.message);
            }
        }
        try {
            const m = (await lerArquivo()).find((x) => x.slug === slug) || null;
            return { materia: m, fonte: 'arquivo', aviso: motivo ? 'Mostrando a cópia salva desta matéria (o banco não respondeu).' : '' };
        } catch (e) {
            return { materia: null, fonte: 'indisponivel', aviso: 'Não consegui carregar a matéria agora.' };
        }
    }

    /* ---------- cartões ---------- */
    const hrefMateria = (m) => BASE + 'materia.html?m=' + encodeURIComponent(m.slug);
    const faixa = (c) => 'background:linear-gradient(135deg,' + c.de + ',' + c.ate + ')';
    const FOCO = ' focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300';

    /* variante: "grande" (destaque da capa), "compacto" (lateral da capa) ou normal (lista). */
    function cartao(m, variante) {
        const c = categoria(m.categoria);
        const data = m.publicada_em ? '<time datetime="' + esc(m.publicada_em) + '">' + esc(dataCurta(m.publicada_em)) + '</time>' : '';
        const conf = m.conferido_em ? ' · conferido em ' + esc(dataCurta(m.conferido_em + 'T12:00:00-03:00')) : '';
        if (variante === 'compacto') {
            return '<a href="' + esc(hrefMateria(m)) + '" class="group block rounded-2xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors' + FOCO + '">' +
                '<span class="text-xs font-mono-code font-semibold uppercase tracking-wider" style="color:' + c.texto + '"><span aria-hidden="true">' + c.emoji + '</span> ' + esc(c.nome) + '</span>' +
                '<h3 class="mt-1.5 text-base font-bold text-white leading-snug group-hover:text-indigo-200">' + esc(m.titulo) + '</h3>' +
                '<p class="mt-1 text-sm text-slate-300 leading-relaxed line-clamp-2">' + esc(m.chamada) + '</p>' +
                '<p class="mt-2 text-xs text-slate-400 font-mono-code">' + data + '</p></a>';
        }
        const grande = variante === 'grande';
        const topo = m.capa_url
            ? '<img src="' + esc(m.capa_url) + '" alt="" loading="lazy" class="w-full object-cover ' + (grande ? 'h-44 sm:h-56' : 'h-36') + '">'
            : '<div class="flex items-center justify-between gap-3 px-4 sm:px-5 ' + (grande ? 'h-32 sm:h-40' : 'h-24') + '" style="' + faixa(c) + '">' +
              '<span class="' + (grande ? 'text-5xl' : 'text-3xl') + '" aria-hidden="true">' + c.emoji + '</span>' +
              '<span class="text-xs font-mono-code font-semibold uppercase tracking-wider text-white/90 text-right">' + esc(c.nome) + '</span></div>';
        return '<a href="' + esc(hrefMateria(m)) + '" class="group flex flex-col h-full rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden hover:border-slate-600 transition-colors' + FOCO + '">' + topo +
            '<div class="p-4 sm:p-5 space-y-2 flex-1">' +
            (m.capa_url ? '<span class="text-xs font-mono-code font-semibold uppercase tracking-wider" style="color:' + c.texto + '">' + esc(c.nome) + '</span>' : '') +
            '<h3 class="' + (grande ? 'text-xl sm:text-2xl' : 'text-base') + ' font-bold text-white leading-snug group-hover:text-indigo-200">' + esc(m.titulo) + '</h3>' +
            '<p class="' + (grande ? 'text-base' : 'text-sm') + ' text-slate-300 leading-relaxed">' + esc(m.chamada) + '</p>' +
            '<p class="text-xs text-slate-400 font-mono-code">' + data + conf + '</p></div></a>';
    }

    window.RadarMaterias = Object.freeze({
        BASE: BASE, habilitado: habilitado, listar: listar, obter: obter,
        markdown: markdown, ativarCopiar: ativarCopiar, cartao: cartao,
        categoria: categoria, categorias: categoriasConhecidas,
        normalizar: normalizar, slugify: slugify, safeHttp: safeHttp, safeLink: safeLink, esc: esc,
        tempoLeitura: tempoLeitura, dataLonga: dataLonga, dataCurta: dataCurta, diaLongo: diaLongo,
        jaPublicada: jaPublicada, hrefMateria: hrefMateria
    });
})();
