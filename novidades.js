'use strict';
/* Radar de IA: chamadas das matérias na capa e aba Matérias (busca e filtro por categoria).
 * Os dados vêm de materias.js (Supabase, com reserva em noticias.json). */
(function () {
    const M = window.RadarMaterias;
    if (!M) return;
    const $ = (id) => document.getElementById(id);
    const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const state = { itens: [], categoria: 'todas', busca: '' };

    function renderCapa(itens, aviso) {
        const box = $('novidadesCapa');
        const lista = $('novidadesLista');
        if (!box || !lista) return;
        $('novidadesAviso').textContent = aviso || '';
        if (!itens.length) { box.classList.add('hidden'); return; }
        const [destaque, ...resto] = itens.slice(0, 3);
        lista.innerHTML = '<div class="' + (resto.length ? 'md:col-span-2' : 'md:col-span-3') + '">' + M.cartao(destaque, 'grande') + '</div>' +
            (resto.length ? '<div class="md:col-span-1 grid grid-cols-1 gap-4 content-start">' + resto.map((m) => M.cartao(m, 'compacto')).join('') + '</div>' : '');
        box.classList.remove('hidden');
    }

    function filtrar() {
        const q = plain(state.busca);
        return state.itens.filter((m) => {
            if (state.categoria !== 'todas' && m.categoria !== state.categoria) return false;
            return !q || plain([m.titulo, m.chamada, m.tags.join(' '), M.categoria(m.categoria).nome].join(' ')).includes(q);
        });
    }

    function chip(rotulo, ativo, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        btn.className = 'px-3.5 min-h-[44px] rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ' +
            (ativo ? 'bg-white text-slate-950 shadow-sm' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700');
        btn.innerHTML = rotulo;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function renderLista() {
        const chips = $('materiasChips');
        const ids = [];
        state.itens.forEach((m) => { if (ids.indexOf(m.categoria) < 0) ids.push(m.categoria); });
        chips.innerHTML = '';
        if (ids.length > 1) {
            chips.appendChild(chip('<span>Todas</span><span class="text-xs opacity-75 font-mono-code">(' + state.itens.length + ')</span>', state.categoria === 'todas', () => { state.categoria = 'todas'; renderLista(); }));
            ids.forEach((id) => {
                const c = M.categoria(id);
                const n = state.itens.filter((m) => m.categoria === id).length;
                chips.appendChild(chip('<span aria-hidden="true">' + c.emoji + '</span><span>' + M.esc(c.nome) + '</span><span class="text-xs opacity-75 font-mono-code">(' + n + ')</span>',
                    state.categoria === id, () => { state.categoria = id; renderLista(); }));
            });
        }
        const lista = filtrar();
        $('materiasContagem').textContent = 'Exibindo ' + lista.length + (lista.length === 1 ? ' matéria' : ' matérias');
        $('materiasLista').innerHTML = lista.map((m) => M.cartao(m)).join('');
        $('materiasVazio').classList.toggle('hidden', lista.length > 0);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const busca = $('materiasBusca');
        if (busca) busca.addEventListener('input', (e) => { state.busca = e.target.value; renderLista(); });
        M.listar().then((r) => {
            state.itens = r.itens;
            renderCapa(r.itens, r.aviso);
            renderLista();
            if ($('materiasAviso')) $('materiasAviso').textContent = r.aviso || '';
            if (!r.itens.length) $('materiasContagem').textContent = r.fonte === 'indisponivel' ? 'Não consegui carregar as matérias agora.' : 'Ainda não há matérias publicadas.';
        });
    });
})();
