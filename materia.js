'use strict';
/* Radar de IA: página de uma matéria (materia.html?m=endereco-da-materia). */
(function () {
    const M = window.RadarMaterias;
    const $ = (id) => document.getElementById(id);
    if (!M) return;

    function qualMateria() {
        const meta = document.querySelector('meta[name="radar-materia"]');
        const fixa = meta ? String(meta.getAttribute('content') || '') : '';
        return fixa || new URLSearchParams(location.search).get('m') || '';
    }

    function meta(nome, valor, atributo) {
        const attr = atributo || 'name';
        let el = document.head.querySelector('meta[' + attr + '="' + nome + '"]');
        if (!el) {
            el = document.createElement('meta');
            el.setAttribute(attr, nome);
            document.head.appendChild(el);
        }
        el.setAttribute('content', valor);
    }

    function naoEncontrada(aviso) {
        $('estado').textContent = aviso || 'Matéria não encontrada. Ela pode ter sido movida ou ainda não ter sido publicada.';
        $('estado').classList.remove('hidden');
        document.title = 'Matéria não encontrada | Radar de IA';
    }

    function link(m) {
        const u = new URL(location.href);
        u.hash = '';
        u.search = '';
        const pagina = document.querySelector('meta[name="radar-materia"]');
        return pagina ? u.href : u.href + '?m=' + encodeURIComponent(m.slug);
    }

    function mostrar(m, aviso) {
        const c = M.categoria(m.categoria);
        document.title = m.titulo + ' | Radar de IA';
        meta('description', m.chamada || m.titulo);
        meta('og:title', m.titulo, 'property');
        meta('og:description', m.chamada || m.titulo, 'property');
        meta('og:type', 'article', 'property');
        meta('og:site_name', 'Radar de IA', 'property');
        if (m.capa_url) meta('og:image', m.capa_url, 'property');

        const cat = $('materiaCategoria');
        cat.textContent = c.emoji + ' ' + c.nome;
        cat.style.color = c.texto;
        $('materiaTitulo').textContent = m.titulo;
        $('materiaChamada').textContent = m.chamada;
        const partes = [m.autor];
        if (m.publicada_em) partes.push(M.dataLonga(m.publicada_em));
        partes.push(M.tempoLeitura(m.corpo) + ' min de leitura');
        if (m.conferido_em) partes.push('Conferido em ' + M.diaLongo(m.conferido_em));
        $('materiaMeta').textContent = partes.join(' · ');

        $('materiaCapa').innerHTML = m.capa_url
            ? '<img src="' + M.esc(m.capa_url) + '" alt="" class="w-full max-h-80 object-cover rounded-2xl border border-slate-800">'
            : '';
        $('materiaAviso').textContent = aviso || '';

        const corpo = $('materiaCorpo');
        corpo.innerHTML = M.markdown(m.corpo);
        M.ativarCopiar(corpo);

        if (m.fontes.length) {
            $('materiaFontesLista').innerHTML = m.fontes.map((f) =>
                '<li><a href="' + M.esc(f.u) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center min-h-[44px] text-indigo-300 underline underline-offset-2 hover:text-indigo-200 break-words">' +
                M.esc(f.n) + '<span class="sr-only"> (abre em nova aba)</span></a></li>').join('');
            $('materiaFontes').classList.remove('hidden');
        }

        const url = link(m);
        $('linkLinkedin').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
        $('linkWhatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(m.titulo + ' ' + url);
        $('btnCopiarLink').addEventListener('click', async () => {
            const st = $('copiarStatus');
            try {
                await navigator.clipboard.writeText(url);
                st.textContent = 'Link copiado.';
            } catch (e) {
                st.textContent = 'Não consegui copiar. Copie o endereço da barra do navegador.';
            }
        });

        $('estado').classList.add('hidden');
        $('materia').classList.remove('hidden');
    }

    function relacionadas(atual) {
        M.listar().then((r) => {
            const outras = r.itens.filter((x) => x.slug !== atual.slug)
                .sort((a, b) => (b.categoria === atual.categoria) - (a.categoria === atual.categoria)).slice(0, 2);
            if (!outras.length) return;
            $('relacionadasLista').innerHTML = outras.map((x) => M.cartao(x)).join('');
            $('relacionadas').classList.remove('hidden');
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const slug = qualMateria();
        if (!slug) return naoEncontrada('Nenhuma matéria foi indicada no endereço.');
        const r = await M.obter(slug);
        if (!r.materia) return naoEncontrada(r.aviso);
        mostrar(r.materia, r.aviso);
        relacionadas(r.materia);
    });
})();
