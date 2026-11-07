'use strict';
/* Radar de IA: área de publicação das matérias (admin.html).
 * Entra por link enviado ao e-mail (Supabase Auth, sem senha), lista, cria e edita matérias, agenda a publicação
 * e mostra o histórico de versões com "Restaurar no editor".
 * Só funciona para quem está na tabela "administradores" (regras no banco, 03-materias.sql): mesmo que alguém
 * abra esta página, o banco recusa qualquer gravação de quem não é administrador.
 * Sem bibliotecas externas, só fetch, para a política de segurança da página continuar fechada. */
(function () {
    const M = window.RadarMaterias;
    const cfg = window.RadarDB && window.RadarDB.config ? window.RadarDB.config : null;
    const $ = (id) => document.getElementById(id);
    const SESSION_KEY = 'radar_admin_sessao_v1';
    const TIMEOUT_MS = 15000;
    const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const VISTAS = ['vSemConfig', 'vLogin', 'vNegado', 'vLista', 'vEditor'];
    const CAMPOS_CONTEUDO = ['titulo', 'chamada', 'corpo', 'categoria', 'tags', 'capa_url', 'fontes', 'autor', 'conferido_em', 'destaque'];
    const ROTULOS = {
        titulo: 'título', slug: 'endereço', chamada: 'chamada', corpo: 'texto', categoria: 'categoria', tags: 'tags', capa_url: 'imagem de capa',
        fontes: 'fontes', autor: 'autor', status: 'situação', publicada_em: 'data de publicação', conferido_em: 'conferido em', destaque: 'destaque'
    };
    const esc = M ? M.esc : (s) => String(s);

    let sessao = null;
    let vistaAtual = '';
    const estado = { lista: [], filtro: 'todas', id: '', carregada: null, sujo: false, slugManual: false, ocupado: false, aba: 'editar', historico: [] };

    const agora = () => Math.floor(Date.now() / 1000);
    const dataHora = (v) => {
        const d = new Date(v);
        return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
    };
    const noFuturo = (v) => { const d = new Date(v); return !isNaN(d.getTime()) && d > new Date(); };
    const jaNoAr = (m) => !!m && m.status === 'publicado' && !!m.publicada_em && !noFuturo(m.publicada_em);

    /* ---------- mensagens e telas ---------- */
    function aviso(msg, tipo) {
        const el = $('aviso');
        if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
        el.textContent = msg;
        el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        el.className = 'mb-4 rounded-xl border px-4 py-3 text-sm ' + (tipo === 'erro' ? 'border-red-500/50 bg-red-950/50 text-red-100'
            : tipo === 'ok' ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-100' : 'border-slate-600 bg-slate-900 text-slate-100');
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    function vista(id) {
        vistaAtual = id;
        VISTAS.forEach((v) => $(v).classList.toggle('hidden', v !== id));
        $('carregando').classList.add('hidden');
        $('btnSair').classList.toggle('hidden', !sessao);
        const alvo = $(id).querySelector('h2');
        if (alvo) { alvo.setAttribute('tabindex', '-1'); alvo.focus(); }
    }

    function ocupar(ligado, texto) {
        $('carregando').textContent = texto || 'Carregando...';
        $('carregando').classList.toggle('hidden', !ligado);
        if (ligado) VISTAS.forEach((v) => $(v).classList.add('hidden'));
    }

    /* ---------- chamadas ao Supabase ---------- */
    async function http(metodo, caminho, opc) {
        const o = opc || {};
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const headers = { apikey: cfg.key, Accept: 'application/json' };
        if (o.token) headers.Authorization = 'Bearer ' + o.token;
        if (o.body !== undefined) headers['Content-Type'] = 'application/json';
        if (o.prefer) headers.Prefer = o.prefer;
        let resp;
        let texto;
        try {
            resp = await fetch(cfg.url + caminho, { method: metodo, headers: headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: ctrl.signal });
            texto = await resp.text();
        } catch (e) {
            const err = new Error(e && e.name === 'AbortError' ? 'tempo esgotado' : 'sem conexão');
            err.rede = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }
        let dados = null;
        if (texto) { try { dados = JSON.parse(texto); } catch (e) { dados = null; } }
        if (!resp.ok) {
            const err = new Error((dados && (dados.message || dados.msg || dados.error_description)) || 'HTTP ' + resp.status);
            err.status = resp.status;
            err.code = String((dados && (dados.code || dados.error_code)) || '');
            throw err;
        }
        return dados;
    }

    function lerSessaoGuardada() {
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            if (s && s.p === cfg.url && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && Number(s.expires_at) > 0) return s;
        } catch (e) { /* sem armazenamento ou dado corrompido: pede login */ }
        return null;
    }
    function guardar(s) {
        sessao = s;
        try {
            if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* a sessão vale só nesta visita */ }
    }
    function deAuth(d, anterior) {
        if (!d || typeof d.access_token !== 'string' || typeof d.refresh_token !== 'string') throw new Error('resposta de login inesperada');
        const exp = Number(d.expires_at) > 0 ? Number(d.expires_at) : agora() + (Number(d.expires_in) || 3600);
        const u = d.user || {};
        return {
            p: cfg.url, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: exp,
            user_id: u.id || (anterior && anterior.user_id) || '', email: u.email || (anterior && anterior.email) || ''
        };
    }

    let renovando = null;
    function renovar() {
        if (renovando) return renovando;
        renovando = (async () => {
            try {
                const d = await http('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: sessao.refresh_token } });
                guardar(deAuth(d, sessao));
            } catch (e) {
                if (e.status && e.status < 500 && e.status !== 429) { guardar(null); e.sessaoEncerrada = true; }
                throw e;
            }
        })();
        const limpar = () => { renovando = null; };
        renovando.then(limpar, limpar);
        return renovando;
    }

    async function api(metodo, caminho, opc) {
        const o = opc || {};
        if (!sessao) { const e = new Error('sessão encerrada'); e.sessaoEncerrada = true; throw e; }
        if (sessao.expires_at - 60 <= agora()) await renovar();
        try {
            return await http(metodo, caminho, Object.assign({}, o, { token: sessao.access_token }));
        } catch (e) {
            if (e.status !== 401) throw e;
            await renovar();
            return http(metodo, caminho, Object.assign({}, o, { token: sessao.access_token }));
        }
    }

    function mensagemErro(e, contexto) {
        const msg = String((e && e.message) || '');
        if (e && e.conflito) return 'Esta matéria foi alterada em outro lugar (outra aba ou aparelho) depois que você a abriu. Copie o que escreveu, recarregue esta página e confira antes de salvar de novo.';
        if (e && e.rede) return 'O Supabase não respondeu (' + msg + '). Confira a internet e tente de novo. Seu texto continua aqui.';
        if (e && (e.sessaoEncerrada || e.status === 401)) return 'Sua sessão expirou. Seu texto continua aqui: copie-o, recarregue a página e entre de novo.';
        if (e && (e.code === '23505' || /duplicate key/i.test(msg))) return 'Já existe uma matéria com esse endereço. Escolha outro.';
        if (/já foi ao ar/i.test(msg)) return 'O endereço de uma matéria que já foi ao ar não pode mudar. Volte o endereço original.';
        if (/materias_publicada_completa/.test(msg)) return 'Para publicar, a matéria precisa de chamada (mínimo 10 caracteres), texto (mínimo 50) e data de publicação.';
        if (/check constraint/i.test(msg)) return 'Algum campo passou do limite que o banco aceita (' + msg + ').';
        if (e && (e.code === '42501' || e.status === 403)) return 'O banco recusou a operação. Confira se este e-mail está na lista de administradores (passo 4 do supabase/GUIA-MATERIAS.md).';
        return contexto + ' (' + msg + ')';
    }
    function falhou(e, contexto) {
        console.warn('[Radar admin]', contexto, e);
        aviso(mensagemErro(e, contexto), 'erro');
        if (vistaAtual !== 'vEditor') {
            if (e && (e.sessaoEncerrada || e.status === 401)) { guardar(null); vista('vLogin'); }
            else if (!vistaAtual) vista('vLogin');
        }
    }

    /* ---------- entrar e sair ---------- */
    function lerHash() {
        const h = String(location.hash || '').replace(/^#/, '');
        if (!h) return null;
        const p = new URLSearchParams(h);
        return p.get('access_token') || p.get('error') || p.get('error_code') ? p : null;
    }

    async function entrarPeloLink(p) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sem histórico */ }
        if (p.get('error') || p.get('error_code')) {
            vista('vLogin');
            aviso(p.get('error_code') === 'otp_expired'
                ? 'O link expirou ou já foi usado. Peça um novo.'
                : 'Não consegui entrar por esse link (' + (p.get('error_description') || p.get('error') || 'erro') + '). Peça um novo.', 'erro');
            return;
        }
        const token = p.get('access_token');
        const provisoria = {
            p: cfg.url, access_token: token || '', refresh_token: p.get('refresh_token') || '',
            expires_at: Number(p.get('expires_at')) > 0 ? Number(p.get('expires_at')) : agora() + (Number(p.get('expires_in')) || 3600), user_id: '', email: ''
        };
        try {
            if (!provisoria.refresh_token) throw new Error('link incompleto');
            const u = await http('GET', '/auth/v1/user', { token: token });
            provisoria.user_id = (u && u.id) || '';
            provisoria.email = (u && u.email) || '';
            guardar(provisoria);
        } catch (e) {
            vista('vLogin');
            aviso('Não consegui concluir o login por esse link. Peça um novo.', 'erro');
            return;
        }
        await iniciarComSessao();
    }

    async function pedirLink(email) {
        const volta = location.origin + location.pathname;
        await http('POST', '/auth/v1/otp?redirect_to=' + encodeURIComponent(volta), { body: { email: email, create_user: false } });
    }

    async function sair() {
        const s = sessao;
        guardar(null);
        if (s) { try { await http('POST', '/auth/v1/logout?scope=local', { token: s.access_token }); } catch (e) { /* já saiu aqui; o servidor limpa depois */ } }
        estado.sujo = false;
        vista('vLogin');
        aviso('Você saiu.', 'info');
    }

    async function iniciarComSessao() {
        ocupar(true, 'Verificando o acesso...');
        $('quemSou').textContent = (sessao && sessao.email) || 'Radar de IA';
        let admin;
        try {
            admin = await api('POST', '/rest/v1/rpc/sou_admin', { body: {} });
        } catch (e) {
            ocupar(false);
            vistaAtual = '';
            falhou(e, 'Não consegui verificar o acesso');
            return;
        }
        if (admin !== true) { aviso(''); vista('vNegado'); return; }
        await carregarLista();
    }

    /* ---------- lista ---------- */
    function situacao(m) {
        if (m.status === 'arquivado') return 'arquivada';
        if (m.status === 'rascunho') return 'rascunho';
        return noFuturo(m.publicada_em) ? 'agendada' : 'no-ar';
    }
    const SIT = {
        'no-ar': { rotulo: 'No ar', cls: 'bg-emerald-950 text-emerald-200 border-emerald-700' },
        agendada: { rotulo: 'Agendada', cls: 'bg-amber-950 text-amber-200 border-amber-700' },
        rascunho: { rotulo: 'Rascunho', cls: 'bg-slate-800 text-slate-200 border-slate-600' },
        arquivada: { rotulo: 'Arquivada', cls: 'bg-red-950 text-red-200 border-red-800' }
    };

    async function carregarLista() {
        ocupar(true, 'Carregando as matérias...');
        try {
            estado.lista = await api('GET', '/rest/v1/materias?select=id,slug,titulo,categoria,status,publicada_em,destaque,atualizado_em&order=atualizado_em.desc&limit=200');
        } catch (e) {
            ocupar(false);
            if (vistaAtual === 'vEditor') vista('vEditor');
            else { estado.lista = []; $('listaVazia').textContent = 'Não consegui carregar a lista agora. Recarregue a página para tentar de novo.'; vista('vLista'); renderLista(); }
            falhou(e, 'Não consegui carregar as matérias');
            return;
        }
        if (!Array.isArray(estado.lista)) estado.lista = [];
        estado.sujo = false;
        $('listaVazia').textContent = 'Nenhuma matéria aqui ainda.';
        vista('vLista');
        renderLista();
    }

    function renderLista() {
        const contagem = { todas: estado.lista.length, 'no-ar': 0, agendada: 0, rascunho: 0, arquivada: 0 };
        estado.lista.forEach((m) => { contagem[situacao(m)]++; });
        const filtros = [['todas', 'Todas'], ['no-ar', 'No ar'], ['agendada', 'Agendadas'], ['rascunho', 'Rascunhos'], ['arquivada', 'Arquivadas']];
        const barra = $('listaFiltros');
        barra.innerHTML = '';
        filtros.forEach((f) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-pressed', estado.filtro === f[0] ? 'true' : 'false');
            btn.className = 'px-3.5 min-h-[44px] rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-2 ' +
                (estado.filtro === f[0] ? 'bg-white text-slate-950' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700');
            btn.innerHTML = '<span>' + f[1] + '</span><span class="text-xs opacity-75 font-mono-code">(' + contagem[f[0]] + ')</span>';
            btn.addEventListener('click', () => { estado.filtro = f[0]; renderLista(); });
            barra.appendChild(btn);
        });
        const itens = estado.lista.filter((m) => estado.filtro === 'todas' || situacao(m) === estado.filtro);
        $('listaResumo').textContent = itens.length + (itens.length === 1 ? ' matéria' : ' matérias');
        $('listaVazia').classList.toggle('hidden', itens.length > 0);
        $('listaMaterias').innerHTML = itens.map((m) => {
            const s = situacao(m);
            const c = M.categoria(m.categoria);
            const quando = s === 'no-ar' ? 'no ar desde ' + dataHora(m.publicada_em) : s === 'agendada' ? 'vai ao ar em ' + dataHora(m.publicada_em) : 'editada em ' + dataHora(m.atualizado_em);
            return '<li class="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">' +
                '<div class="min-w-0 space-y-1">' +
                '<div class="flex flex-wrap items-center gap-2"><span class="px-2 py-0.5 rounded-full border text-xs font-mono-code font-semibold ' + SIT[s].cls + '">' + SIT[s].rotulo + '</span>' +
                (m.destaque ? '<span class="px-2 py-0.5 rounded-full border border-indigo-700 bg-indigo-950 text-indigo-200 text-xs font-mono-code font-semibold">Destaque</span>' : '') + '</div>' +
                '<h3 class="text-base font-bold text-white break-words">' + esc(m.titulo) + '</h3>' +
                '<p class="text-xs text-slate-400 font-mono-code">' + esc(c.nome) + ' · ' + esc(quando) + '</p></div>' +
                '<div class="flex gap-2">' +
                (s === 'no-ar' ? '<a href="' + esc(M.hrefMateria(m)) + '" target="_blank" rel="noopener noreferrer" class="btn inline-flex items-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100">Ver no site<span class="sr-only"> (abre em nova aba)</span></a>' : '') +
                '<button type="button" data-editar="' + esc(m.id) + '" class="btn bg-indigo-600 hover:bg-indigo-500 text-white">Editar<span class="sr-only">: ' + esc(m.titulo) + '</span></button></div></li>';
        }).join('');
    }

    /* ---------- editor: preencher e ler o formulário ---------- */
    function paraCampoData(iso) {
        const d = new Date(iso);
        if (!iso || isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function opcoesCategoria(atual) {
        const ids = M.categorias().map((c) => c.id);
        if (atual && ids.indexOf(atual) < 0) ids.push(atual);
        $('fCategoria').innerHTML = ids.map((id) => '<option value="' + esc(id) + '">' + esc(M.categoria(id).emoji + ' ' + M.categoria(id).nome) + '</option>').join('');
        $('fCategoria').value = atual || 'novidade';
    }

    function linhaFonte(nome, url) {
        const linha = document.createElement('div');
        linha.setAttribute('data-fonte', '');
        linha.className = 'grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-start';
        const n = document.createElement('input');
        n.className = 'campo';
        n.maxLength = 160;
        n.placeholder = 'Nome da fonte';
        n.setAttribute('data-f', 'n');
        n.setAttribute('aria-label', 'Nome da fonte');
        n.value = nome || '';
        const u = document.createElement('input');
        u.className = 'campo font-mono-code text-sm';
        u.type = 'url';
        u.maxLength = 500;
        u.placeholder = 'https://...';
        u.setAttribute('data-f', 'u');
        u.setAttribute('aria-label', 'Endereço da fonte');
        u.value = url || '';
        const r = document.createElement('button');
        r.type = 'button';
        r.setAttribute('data-remover-fonte', '');
        r.className = 'btn bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100';
        r.textContent = 'Remover';
        r.setAttribute('aria-label', 'Remover esta fonte');
        linha.appendChild(n);
        linha.appendChild(u);
        linha.appendChild(r);
        return linha;
    }
    function renderFontes(fontes) {
        const box = $('fontesEditor');
        box.innerHTML = '';
        (Array.isArray(fontes) ? fontes : []).slice(0, 12).forEach((f) => { if (f && typeof f === 'object') box.appendChild(linhaFonte(f.n, f.u)); });
        atualizarLimiteFontes();
    }
    function atualizarLimiteFontes() {
        $('btnAddFonte').disabled = $('fontesEditor').children.length >= 12;
    }

    function atualizarContadores() {
        $('cTitulo').textContent = $('fTitulo').value.length;
        $('cChamada').textContent = $('fChamada').value.length;
    }

    function atualizarBotoes() {
        const m = estado.carregada;
        const live = jaNoAr(m);
        $('btnPublicar').classList.toggle('hidden', live);
        const futura = $('fPublicada').value && noFuturo($('fPublicada').value);
        $('btnPublicar').textContent = futura ? 'Agendar publicação' : 'Publicar agora';
        const link = $('linkVer');
        link.classList.toggle('hidden', !live);
        link.classList.toggle('inline-flex', live);
        if (live) link.href = M.hrefMateria(m);
        $('editorStatus').textContent = textoStatus();
    }

    function textoStatus() {
        const m = estado.carregada;
        const partes = [];
        if (!m) partes.push('Nova matéria, ainda não salva');
        else partes.push(SIT[situacao(m)].rotulo, 'última gravação em ' + dataHora(m.atualizado_em));
        if (estado.sujo) partes.push('alterações não salvas');
        return partes.join(' · ');
    }

    function preencher(m) {
        estado.id = m ? m.id : '';
        estado.carregada = m || null;
        estado.sujo = false;
        estado.slugManual = !!m;
        estado.historico = [];
        $('editorTitulo').textContent = m ? 'Editar matéria' : 'Nova matéria';
        $('fTitulo').value = m ? m.titulo : '';
        $('fSlug').value = m ? m.slug : '';
        /* Mesma regra do banco: depois que a data de publicação chega, o endereço fica travado. */
        $('fSlug').disabled = !!m && !!m.publicada_em && !noFuturo(m.publicada_em);
        $('dSlug').textContent = $('fSlug').disabled
            ? 'Esta matéria já foi ao ar, então o endereço não muda mais (os links compartilhados continuam funcionando).'
            : 'Só letras minúsculas, números e hífen. Depois que a matéria for ao ar, não muda mais.';
        $('fChamada').value = m ? m.chamada : '';
        opcoesCategoria(m ? m.categoria : 'novidade');
        $('fTags').value = m && Array.isArray(m.tags) ? m.tags.join(', ') : '';
        $('fCorpo').value = m ? m.corpo : '';
        renderFontes(m ? m.fontes : []);
        $('fStatus').value = m ? m.status : 'rascunho';
        $('fPublicada').value = m ? paraCampoData(m.publicada_em) : '';
        $('fConferido').value = m && m.conferido_em ? m.conferido_em : '';
        $('fAutor').value = m ? m.autor : 'Rodrigo Brandelero';
        $('fCapa').value = m && m.capa_url ? m.capa_url : '';
        $('fDestaque').checked = !!(m && m.destaque);
        atualizarContadores();
        atualizarBotoes();
    }

    /* Lê o formulário como está (sem validar), para a pré-visualização. */
    function lerBruto() {
        const tags = $('fTags').value.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
        const fontes = Array.prototype.map.call($('fontesEditor').querySelectorAll('[data-fonte]'), (l) => ({
            n: l.querySelector('[data-f="n"]').value.trim(), u: l.querySelector('[data-f="u"]').value.trim()
        }));
        return {
            titulo: $('fTitulo').value.trim(), slug: $('fSlug').value.trim(), chamada: $('fChamada').value.trim(), corpo: $('fCorpo').value,
            categoria: $('fCategoria').value, tags: tags, fontes: fontes, status: $('fStatus').value, publicada_em: $('fPublicada').value,
            conferido_em: $('fConferido').value, autor: $('fAutor').value.trim(), capa_url: $('fCapa').value.trim(), destaque: $('fDestaque').checked
        };
    }

    function bytes(s) { return new TextEncoder().encode(s).length; }

    /* Valida e monta o que vai para o banco. Devolve {dados} ou {erro, campo}. */
    function coletar(publicar) {
        const b = lerBruto();
        const falha = (erro, campo) => ({ erro: erro, campo: campo });
        const status = publicar ? 'publicado' : b.status;

        if (b.titulo.length < 3 || b.titulo.length > 140) return falha('O título precisa ter de 3 a 140 caracteres.', 'fTitulo');
        if (!SLUG_RE.test(b.slug) || b.slug.length > 80) return falha('O endereço só pode ter letras minúsculas sem acento, números e hífen (até 80 caracteres). Exemplo: do-excel-ao-dashboard.', 'fSlug');
        if (b.chamada.length > 240) return falha('A chamada passou de 240 caracteres.', 'fChamada');
        if (b.corpo.length > 40000) return falha('O texto passou de 40.000 caracteres.', 'fCorpo');
        if (status === 'publicado') {
            if (b.chamada.length < 10) return falha('Para publicar, a chamada precisa ter pelo menos 10 caracteres.', 'fChamada');
            if (b.corpo.trim().length < 50) return falha('Para publicar, o texto precisa ter pelo menos 50 caracteres.', 'fCorpo');
        }

        const vistas = {};
        const tags = [];
        for (let i = 0; i < b.tags.length; i++) {
            const t = b.tags[i];
            if (t.length > 40) return falha('Cada tag pode ter até 40 caracteres.', 'fTags');
            if (!vistas[t.toLowerCase()]) { vistas[t.toLowerCase()] = true; tags.push(t); }
        }
        if (tags.length > 8) return falha('Use no máximo 8 tags.', 'fTags');
        if (bytes(tags.join(',')) > 300) return falha('As tags juntas passaram do limite. Use menos tags ou tags mais curtas.', 'fTags');

        const fontes = [];
        const linhas = $('fontesEditor').querySelectorAll('[data-fonte]');
        for (let i = 0; i < b.fontes.length; i++) {
            const f = b.fontes[i];
            if (!f.n && !f.u) continue;
            const campo = linhas[i].querySelector('[data-f="u"]');
            if (!f.u) { campo.id = campo.id || 'fonteUrl' + i; return falha('Falta o endereço da fonte ' + (i + 1) + '.', campo.id); }
            const href = M.safeHttp(f.u);
            if (!href) { campo.id = campo.id || 'fonteUrl' + i; return falha('O endereço da fonte ' + (i + 1) + ' não é válido. Ele precisa começar com https://.', campo.id); }
            let nome = f.n;
            if (!nome) { try { nome = new URL(href).hostname.replace(/^www\./, ''); } catch (e) { nome = href; } }
            fontes.push({ n: nome.slice(0, 160), u: href });
        }
        if (fontes.length > 12) return falha('Use no máximo 12 fontes.', 'btnAddFonte');

        let capa = null;
        if (b.capa_url) {
            const href = M.safeHttp(b.capa_url);
            if (!href || !/^https:\/\/[^\s<>"']+$/.test(href) || href.length > 500) return falha('A imagem de capa precisa ser um endereço https:// válido (até 500 caracteres).', 'fCapa');
            capa = href;
        }

        if (b.autor.length > 80) return falha('O nome do autor passou de 80 caracteres.', 'fAutor');

        /* Data de publicação: mantém o valor original se o campo não foi mexido (o campo não guarda os segundos). */
        let publicada = null;
        if (b.publicada_em) {
            const orig = estado.carregada && estado.carregada.publicada_em;
            const d = new Date(b.publicada_em);
            if (isNaN(d.getTime())) return falha('A data de publicação não é válida.', 'fPublicada');
            publicada = orig && paraCampoData(orig) === b.publicada_em ? orig : d.toISOString();
        }

        return {
            dados: {
                slug: b.slug, titulo: b.titulo, chamada: b.chamada, corpo: b.corpo, categoria: b.categoria, tags: tags, capa_url: capa,
                fontes: fontes, autor: b.autor || 'Rodrigo Brandelero', status: status, publicada_em: publicada,
                conferido_em: b.conferido_em || null, destaque: b.destaque
            }
        };
    }

    /* ---------- editor: abrir, salvar, voltar ---------- */
    function mostrarEditor() {
        abrirAba('editar');
        vista('vEditor');
    }

    async function abrirEditor(id) {
        aviso('');
        if (!id) {
            preencher(null);
            mostrarEditor();
            return;
        }
        ocupar(true, 'Abrindo a matéria...');
        try {
            const linhas = await api('GET', '/rest/v1/materias?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
            if (!Array.isArray(linhas) || !linhas.length) throw new Error('matéria não encontrada');
            preencher(linhas[0]);
            mostrarEditor();
        } catch (e) {
            ocupar(false);
            vista('vLista');
            falhou(e, 'Não consegui abrir a matéria');
        }
    }

    async function salvar(publicar) {
        if (estado.ocupado) return;
        aviso('');
        const r = coletar(publicar);
        if (r.erro) {
            aviso(r.erro, 'erro');
            const el = $(r.campo);
            if (el) { if (abaAtual() !== 'editar') abrirAba('editar'); el.focus(); }
            return;
        }
        const d = r.dados;
        const m = estado.carregada;
        if (publicar && !confirm(d.publicada_em && noFuturo(d.publicada_em)
            ? 'Agendar esta matéria para ' + dataHora(d.publicada_em) + '? Ela aparece no site a partir desse horário.'
            : 'Publicar agora? A matéria passa a aparecer no site e na capa.')) return;
        if (d.status === 'arquivado' && m && m.status === 'publicado' && !confirm('Arquivar tira esta matéria do ar. O histórico continua guardado. Continuar?')) return;

        estado.ocupado = true;
        $('btnSalvar').disabled = true;
        $('btnPublicar').disabled = true;
        try {
            let linha;
            if (!estado.id) {
                const res = await api('POST', '/rest/v1/materias', { body: d, prefer: 'return=representation' });
                linha = Array.isArray(res) ? res[0] : res;
            } else {
                /* Só grava se ninguém mexeu na matéria desde que você a abriu (outra aba, outro aparelho). */
                const res = await api('PATCH', '/rest/v1/materias?id=eq.' + encodeURIComponent(estado.id) + '&atualizado_em=eq.' + encodeURIComponent(m.atualizado_em),
                    { body: d, prefer: 'return=representation' });
                if (!Array.isArray(res) || !res.length) { const e = new Error('conflito'); e.conflito = true; throw e; }
                linha = res[0];
            }
            if (!linha || !linha.id) throw new Error('resposta inesperada do banco');
            const aba = abaAtual();
            preencher(linha);
            abrirAba(aba);
            aviso(linha.status === 'publicado' ? (noFuturo(linha.publicada_em) ? 'Salva e agendada para ' + dataHora(linha.publicada_em) + '.' : 'Salva. A matéria está no ar.') : 'Salva. Uma nova versão entrou no histórico.', 'ok');
        } catch (e) {
            falhou(e, 'Não consegui salvar');
        } finally {
            estado.ocupado = false;
            $('btnSalvar').disabled = false;
            $('btnPublicar').disabled = false;
        }
    }

    async function voltar() {
        if (estado.sujo && !confirm('Há alterações que não foram salvas. Sair mesmo assim?')) return;
        estado.sujo = false;
        aviso('');
        await carregarLista();
    }

    /* ---------- abas do editor ---------- */
    const ABAS = { editar: ['abaEditar', 'painelEditar'], previa: ['abaPrevia', 'painelPrevia'], historico: ['abaHistorico', 'painelHistorico'] };
    const abaAtual = () => estado.aba;

    function abrirAba(nome) {
        estado.aba = nome;
        Object.keys(ABAS).forEach((k) => {
            const ativa = k === nome;
            const botao = $(ABAS[k][0]);
            botao.setAttribute('aria-selected', ativa ? 'true' : 'false');
            botao.setAttribute('tabindex', ativa ? '0' : '-1');
            botao.className = 'min-h-[44px] px-4 text-sm font-semibold border-b-2 ' + (ativa ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-white');
            $(ABAS[k][1]).classList.toggle('hidden', !ativa);
        });
        if (nome === 'previa') renderPrevia();
        if (nome === 'historico') carregarHistorico();
    }

    function renderPrevia() {
        const b = lerBruto();
        const base = M.normalizar({
            slug: SLUG_RE.test(b.slug) ? b.slug : 'previa', titulo: b.titulo || 'Título da matéria', chamada: b.chamada, corpo: b.corpo,
            categoria: b.categoria, tags: b.tags, capa_url: b.capa_url, fontes: b.fontes, autor: b.autor,
            publicada_em: b.publicada_em ? new Date(b.publicada_em).toISOString() : new Date().toISOString(), conferido_em: b.conferido_em, status: 'publicado', destaque: b.destaque
        });
        if (!base) { $('previaArea').textContent = 'Não consegui montar a pré-visualização.'; return; }
        const c = M.categoria(base.categoria);
        const meta = [base.autor, M.dataLonga(base.publicada_em), M.tempoLeitura(base.corpo) + ' min de leitura'];
        if (base.conferido_em) meta.push('Conferido em ' + M.diaLongo(base.conferido_em));
        const semLink = (html) => html.replace(/^<a /, '<div ').replace(/<\/a>$/, '</div>');
        $('previaArea').innerHTML =
            '<p class="text-xs text-slate-400 font-mono-code mb-2">Como aparece na capa do site</p>' +
            '<div class="max-w-xl mb-8">' + semLink(M.cartao(base, 'grande')) + '</div>' +
            '<p class="text-xs text-slate-400 font-mono-code mb-4 pt-4 border-t border-slate-800">Como aparece na página da matéria</p>' +
            '<article><header class="space-y-3">' +
            '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono-code font-semibold border border-slate-700" style="color:' + c.texto + '">' + esc(c.emoji + ' ' + c.nome) + '</span>' +
            '<h1 class="text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">' + esc(base.titulo) + '</h1>' +
            '<p class="text-base sm:text-lg text-slate-300 leading-relaxed">' + esc(base.chamada) + '</p>' +
            '<p class="text-xs text-slate-400 font-mono-code leading-relaxed">' + esc(meta.join(' · ')) + '</p></header>' +
            (base.capa_url ? '<div class="mt-5"><img src="' + esc(base.capa_url) + '" alt="" class="w-full max-h-80 object-cover rounded-2xl border border-slate-800"></div>' : '') +
            '<div class="mt-4 text-base">' + M.markdown(base.corpo) + '</div>' +
            (base.fontes.length ? '<section class="mt-10"><h2 class="text-lg font-bold text-white">Fontes</h2><ol class="mt-3 space-y-2 list-decimal pl-5 text-sm text-slate-300">' +
                base.fontes.map((f) => '<li>' + esc(f.n) + ' <span class="font-mono-code text-slate-400 break-all">' + esc(f.u) + '</span></li>').join('') + '</ol></section>' : '') +
            '</article>';
        M.ativarCopiar($('previaArea'));
    }

    /* ---------- histórico ---------- */
    function mudancas(atual, anterior) {
        if (!anterior) return 'Primeira versão.';
        const mudou = Object.keys(ROTULOS).filter((k) => JSON.stringify(atual[k]) !== JSON.stringify(anterior[k]));
        return mudou.length ? 'Mudou: ' + mudou.map((k) => ROTULOS[k]).join(', ') + '.' : 'Sem mudança no conteúdo.';
    }

    async function carregarHistorico() {
        const estadoEl = $('historicoEstado');
        const lista = $('historicoLista');
        lista.innerHTML = '';
        if (!estado.id) { estadoEl.textContent = 'Salve a matéria pela primeira vez para começar o histórico.'; return; }
        estadoEl.textContent = 'Carregando o histórico...';
        const id = estado.id;
        try {
            const linhas = await api('GET', '/rest/v1/materias_historico?select=id,versao,acao,dados,alterado_em&materia_id=eq.' + encodeURIComponent(id) + '&order=versao.desc&limit=100');
            if (id !== estado.id) return;
            estado.historico = Array.isArray(linhas) ? linhas : [];
        } catch (e) {
            estadoEl.textContent = 'Não consegui carregar o histórico agora.';
            falhou(e, 'Não consegui carregar o histórico');
            return;
        }
        const h = estado.historico;
        estadoEl.textContent = h.length ? h.length + (h.length === 1 ? ' versão guardada' : ' versões guardadas') : 'Ainda não há versões guardadas.';
        lista.innerHTML = h.map((v, i) => {
            const dados = v.dados && typeof v.dados === 'object' ? v.dados : {};
            const ant = h[i + 1] && h[i + 1].dados;
            return '<li class="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">' +
                '<div class="flex flex-wrap items-center justify-between gap-2">' +
                '<p class="text-sm font-semibold text-white">Versão ' + esc(v.versao) + ' <span class="font-normal text-slate-400">· ' + (v.acao === 'criada' ? 'criada' : 'editada') + ' em ' + esc(dataHora(v.alterado_em)) + '</span>' +
                (i === 0 ? ' <span class="ml-1 px-2 py-0.5 rounded-full border border-emerald-700 bg-emerald-950 text-emerald-200 text-xs font-mono-code">Atual</span>' : '') + '</p>' +
                (i === 0 ? '' : '<button type="button" data-restaurar="' + esc(v.versao) + '" class="btn bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100">Restaurar no editor<span class="sr-only"> a versão ' + esc(v.versao) + '</span></button>') + '</div>' +
                '<p class="text-xs text-slate-300">' + esc(mudancas(dados, ant)) + '</p>' +
                '<details class="text-xs text-slate-300"><summary class="cursor-pointer min-h-[44px] flex items-center text-indigo-300">Ver o conteúdo desta versão</summary>' +
                '<p class="mt-1 font-semibold text-white">' + esc(dados.titulo) + '</p><p class="text-slate-300">' + esc(dados.chamada) + '</p>' +
                '<pre class="mt-2 p-3 rounded-lg bg-slate-950 border border-slate-800 whitespace-pre-wrap break-words font-mono-code text-xs max-h-72 overflow-auto">' + esc(dados.corpo) + '</pre></details></li>';
        }).join('');
    }

    /* Traz o conteúdo de uma versão antiga para o formulário. Não grava nada: só vale depois de "Salvar". */
    function restaurar(versao) {
        const v = estado.historico.find((x) => String(x.versao) === String(versao));
        if (!v || !v.dados) return;
        const d = v.dados;
        if (estado.sujo && !confirm('O editor tem alterações não salvas. Elas serão trocadas pela versão ' + v.versao + '. Continuar?')) return;
        $('fTitulo').value = d.titulo || '';
        $('fChamada').value = d.chamada || '';
        $('fCorpo').value = d.corpo || '';
        opcoesCategoria(d.categoria || 'novidade');
        $('fTags').value = Array.isArray(d.tags) ? d.tags.join(', ') : '';
        $('fCapa').value = d.capa_url || '';
        renderFontes(d.fontes);
        $('fAutor').value = d.autor || 'Rodrigo Brandelero';
        $('fConferido').value = d.conferido_em || '';
        $('fDestaque').checked = d.destaque === true;
        atualizarContadores();
        marcarSujo();
        abrirAba('editar');
        aviso('Versão ' + v.versao + ' carregada no editor. Nada foi alterado no banco ainda: revise e clique em "Salvar" para gravar como uma versão nova. O endereço e a situação (rascunho, publicada) continuam como estão.', 'info');
    }

    /* ---------- formatação do texto ---------- */
    function formatar(tipo) {
        const ta = $('fCorpo');
        const ini = ta.selectionStart;
        const fim = ta.selectionEnd;
        const v = ta.value;
        const sel = v.slice(ini, fim);
        let novo;
        let a;
        let b;
        const envolver = (abre, fecha, vazio) => {
            const txt = sel || vazio;
            novo = v.slice(0, ini) + abre + txt + fecha + v.slice(fim);
            a = ini + abre.length;
            b = a + txt.length;
        };
        if (tipo === 'negrito') envolver('**', '**', 'texto em negrito');
        else if (tipo === 'italico') envolver('*', '*', 'texto em itálico');
        else if (tipo === 'link') {
            const txt = sel || 'texto do link';
            const alvo = 'https://endereco';
            novo = v.slice(0, ini) + '[' + txt + '](' + alvo + ')' + v.slice(fim);
            a = ini + txt.length + 3;
            b = a + alvo.length;
        } else if (tipo === 'codigo') {
            const antes = ini > 0 && v.charAt(ini - 1) !== '\n' ? '\n' : '';
            const depois = fim < v.length && v.charAt(fim) !== '\n' ? '\n' : '';
            const txt = sel || 'texto para copiar';
            novo = v.slice(0, ini) + antes + '```\n' + txt + '\n```' + depois + v.slice(fim);
            a = ini + antes.length + 4;
            b = a + txt.length;
        } else {
            const iniLinha = ini === 0 ? 0 : v.lastIndexOf('\n', ini - 1) + 1;
            const idxFim = v.indexOf('\n', fim);
            const fimLinha = idxFim < 0 ? v.length : idxFim;
            const prefixo = tipo === 'titulo' ? '## ' : '- ';
            const linhas = v.slice(iniLinha, fimLinha).split('\n').map((l) => (l.trim() ? prefixo + (tipo === 'titulo' ? l.replace(/^#{1,4}\s+/, '') : l) : l));
            const bloco = linhas.join('\n');
            novo = v.slice(0, iniLinha) + bloco + v.slice(fimLinha);
            a = iniLinha;
            b = iniLinha + bloco.length;
        }
        ta.value = novo;
        ta.focus();
        ta.setSelectionRange(a, b);
        marcarSujo();
    }

    function marcarSujo() {
        estado.sujo = true;
        atualizarContadores();
        $('editorStatus').textContent = textoStatus();
    }

    /* ---------- eventos ---------- */
    function ligarEventos() {
        $('formLogin').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const email = $('loginEmail').value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { aviso('Digite um e-mail válido.', 'erro'); $('loginEmail').focus(); return; }
            const btn = $('btnEnviarLink');
            btn.disabled = true;
            aviso('');
            try {
                await pedirLink(email);
                $('loginPasso2').classList.remove('hidden');
                aviso('Pedido enviado. Se este e-mail estiver autorizado, o link chega em instantes.', 'ok');
            } catch (e) {
                if (e.rede) aviso('O Supabase não respondeu. Confira a internet e tente de novo.', 'erro');
                else if (e.status === 429) aviso('Muitos pedidos seguidos. Espere alguns minutos antes de pedir outro link.', 'erro');
                else if (e.status >= 500) aviso('O Supabase não conseguiu enviar o e-mail agora (' + e.message + '). Tente de novo em alguns minutos.', 'erro');
                else { $('loginPasso2').classList.remove('hidden'); aviso('Pedido enviado. Se este e-mail estiver autorizado, o link chega em instantes.', 'ok'); }
            } finally {
                btn.disabled = false;
            }
        });

        $('formCodigo').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const codigo = $('loginCodigo').value.replace(/\s+/g, '');
            const email = $('loginEmail').value.trim();
            if (!/^\d{6,10}$/.test(codigo)) { aviso('Digite o código numérico que veio no e-mail.', 'erro'); $('loginCodigo').focus(); return; }
            if (!email) { aviso('Digite o e-mail no campo de cima.', 'erro'); $('loginEmail').focus(); return; }
            try {
                const d = await http('POST', '/auth/v1/verify', { body: { type: 'email', email: email, token: codigo } });
                guardar(deAuth(d));
                aviso('');
                await iniciarComSessao();
            } catch (e) {
                aviso(e.rede ? 'O Supabase não respondeu. Tente de novo.' : 'Código inválido ou expirado. Peça um novo link.', 'erro');
            }
        });

        $('btnSair').addEventListener('click', () => {
            if (estado.sujo && !confirm('Há alterações que não foram salvas. Sair mesmo assim?')) return;
            sair();
        });
        $('btnNova').addEventListener('click', () => abrirEditor(''));
        $('listaMaterias').addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-editar]');
            if (btn) abrirEditor(btn.getAttribute('data-editar'));
        });
        $('btnVoltar').addEventListener('click', voltar);
        $('btnSalvar').addEventListener('click', () => salvar(false));
        $('btnPublicar').addEventListener('click', () => salvar(true));
        $('formEditor').addEventListener('submit', (ev) => { ev.preventDefault(); salvar(false); });

        $('formEditor').addEventListener('input', (ev) => {
            const alvo = ev.target;
            if (alvo.id === 'fTitulo' && !estado.slugManual && !$('fSlug').disabled) $('fSlug').value = M.slugify(alvo.value);
            if (alvo.id === 'fSlug') estado.slugManual = true;
            if (alvo.id === 'fPublicada') atualizarBotoes();
            if (alvo.id === 'fCorpo' || alvo.closest('#fontesEditor') || /^f[A-Z]/.test(alvo.id || '')) marcarSujo();
        });
        $('formEditor').addEventListener('change', (ev) => {
            if (ev.target.id === 'fPublicada') atualizarBotoes();
            marcarSujo();
        });

        $('btnAddFonte').addEventListener('click', () => {
            const box = $('fontesEditor');
            if (box.children.length >= 12) return;
            const linha = linhaFonte('', '');
            box.appendChild(linha);
            atualizarLimiteFontes();
            marcarSujo();
            linha.querySelector('input').focus();
        });
        $('fontesEditor').addEventListener('click', (ev) => {
            const r = ev.target.closest('[data-remover-fonte]');
            if (!r) return;
            r.closest('[data-fonte]').remove();
            atualizarLimiteFontes();
            marcarSujo();
            $('btnAddFonte').focus();
        });

        document.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', () => formatar(b.getAttribute('data-fmt'))));

        Object.keys(ABAS).forEach((k) => {
            const botao = $(ABAS[k][0]);
            botao.setAttribute('aria-controls', ABAS[k][1]);
            $(ABAS[k][1]).setAttribute('role', 'tabpanel');
            $(ABAS[k][1]).setAttribute('aria-labelledby', ABAS[k][0]);
            botao.addEventListener('click', () => abrirAba(k));
            botao.addEventListener('keydown', (ev) => {
                const ordem = Object.keys(ABAS);
                const i = ordem.indexOf(k);
                const j = ev.key === 'ArrowRight' ? (i + 1) % ordem.length : ev.key === 'ArrowLeft' ? (i + ordem.length - 1) % ordem.length : -1;
                if (j < 0) return;
                ev.preventDefault();
                abrirAba(ordem[j]);
                $(ABAS[ordem[j]][0]).focus();
            });
        });

        $('historicoLista').addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-restaurar]');
            if (btn) restaurar(btn.getAttribute('data-restaurar'));
        });

        document.addEventListener('keydown', (ev) => {
            if (vistaAtual === 'vEditor' && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); salvar(false); }
        });
        window.addEventListener('beforeunload', (ev) => {
            if (vistaAtual === 'vEditor' && estado.sujo) { ev.preventDefault(); ev.returnValue = ''; }
        });
    }

    async function iniciar() {
        if (!M) {
            $('carregando').textContent = 'Não consegui carregar o script das matérias (materias.js). Confira se o arquivo foi enviado ao site.';
            return;
        }
        ligarEventos();
        if (!cfg) { vista('vSemConfig'); return; }
        if (!/^https?:$/.test(location.protocol)) {
            aviso('Abra esta página pelo endereço do site (https://...), não pelo arquivo salvo no computador: o login por e-mail precisa disso.', 'info');
        }
        const hash = lerHash();
        if (hash) { await entrarPeloLink(hash); return; }
        sessao = lerSessaoGuardada();
        if (!sessao) { vista('vLogin'); return; }
        await iniciarComSessao();
    }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
