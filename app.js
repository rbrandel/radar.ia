'use strict';
/* Radar de IA: lógica da página. Os dados vêm do data.json (com cópia de segurança dentro do index.html). */
(function () {
    const DAY_MS = 86400000;
    const VOTE_KEY = 'radar_ai_votes_v2';
    const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const DEFAULT_CATEGORIES = [
        { id: 'modelos', name: 'Modelos', short: 'Modelos', color: '#3b82f6' },
        { id: 'agentes', name: 'Agentes e Assistentes', short: 'Agentes', color: '#f97316' },
        { id: 'voz', name: 'Voz e Áudio', short: 'Voz', color: '#10b981' },
        { id: 'video', name: 'Vídeo e Imagem', short: 'Vídeo', color: '#eab308' }
    ];
    const DEFAULT_PROFILES = [
        { id: 'todos', name: 'Todos os Perfis', icon: '🌐' },
        { id: 'dev', name: 'Dev & Infra', icon: '👨‍💻' },
        { id: 'negocios', name: 'Negócios & Gestão', icon: '💼' },
        { id: 'criativo', name: 'Criadores & Mídia', icon: '🎨' }
    ];
    const LICENSE_LABEL = { aberto: 'Código aberto', proprietario: 'Proprietário', 'nao-informada': 'Licença não informada' };
    const PROFILE_LABEL = { dev: 'Dev', negocios: 'Negócios', criativo: 'Criativo' };
    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const FILTER_TABS = ['panorama', 'lancamentos'];

    let appData = null;
    let windowDays = 21;
    let radarPoints = [];
    let dailySeries = [];

    const state = {
        currentTab: 'panorama',
        selectedCategory: 'todas',
        selectedProfile: 'todos',
        searchQuery: '',
        openOnly: false,
        selectedItem: null,
        selectedDay: null,
        votes: {}
    };

    /* Enquete com Supabase (só se o config.js estiver preenchido; senão vale o voto local). */
    const DB = window.RadarDB && window.RadarDB.enabled ? window.RadarDB : null;
    const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
    const remote = { totals: null, myVote: null, busy: false, error: '', seq: 0 };

    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
    const fmtNumber = (n) => Number(n).toLocaleString('pt-BR');
    const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    function safeUrl(u) {
        try {
            const x = new URL(u);
            return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
        } catch (e) {
            return '';
        }
    }

    /* Datas: sempre ao meio-dia no horário local, para não "voltar um dia" no Brasil (UTC-3). */
    function parseISO(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
        return d.getMonth() === +m[2] - 1 ? d : null;
    }
    function toISO(d) {
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function addDays(iso, n) {
        const d = parseISO(iso);
        d.setDate(d.getDate() + n);
        return toISO(d);
    }
    function daysBetween(a, b) {
        return Math.round((parseISO(a) - parseISO(b)) / DAY_MS);
    }
    function fmtDay(iso) {
        const d = parseISO(iso);
        return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] : '';
    }

    /* ---------- dados ---------- */
    function normalize(raw) {
        const d = raw && typeof raw === 'object' ? raw : {};
        const items = (Array.isArray(d.lancamentos) ? d.lancamentos : [])
            .filter((it) => it && typeof it.n === 'string' && parseISO(it.d));
        items.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
        const list = (v, padrao) => (Array.isArray(v) && v.length ? v : padrao);
        return Object.assign({}, d, {
            categorias: list(d.categorias, DEFAULT_CATEGORIES),
            perfis: list(d.perfis, DEFAULT_PROFILES),
            candidatos_semana: list(d.candidatos_semana, []),
            diretorios_volume: list(d.diretorios_volume, []),
            fontes: list(d.fontes, []),
            especialista: d.especialista && typeof d.especialista === 'object' ? d.especialista : {},
            lancamentos: items
        });
    }

    function readFallback() {
        try {
            return JSON.parse($('radar-fallback').textContent);
        } catch (e) {
            return null;
        }
    }

    function refISO() {
        if (parseISO(appData.data_checagem)) return appData.data_checagem;
        if (appData.lancamentos[0]) return appData.lancamentos[0].d;
        return toISO(new Date());
    }

    function setSync(live) {
        const text = $('syncText');
        const badge = $('dataSyncBadge');
        if (!text || !badge) return;
        text.textContent = live ? 'Dados atualizados' : 'Cópia embutida (sem conexão)';
        badge.className = 'flex items-center gap-1.5 text-xs font-mono-code border px-3 py-1.5 rounded-lg ' +
            (live ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-amber-950/80 border-amber-800 text-amber-300');
        const dot = badge.querySelector('span');
        if (dot) dot.className = 'h-2 w-2 rounded-full animate-pulse ' + (live ? 'bg-emerald-400' : 'bg-amber-400');
    }

    async function loadAppData() {
        let live = true;
        try {
            if (location.protocol === 'file:') throw new Error('abrindo como arquivo local');
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            const resp = await fetch('data.json', { cache: 'no-cache', signal: ctrl.signal });
            clearTimeout(timer);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const json = await resp.json();
            if (!Array.isArray(json.lancamentos)) throw new Error('formato inesperado');
            appData = normalize(json);
        } catch (error) {
            console.warn('Usando a cópia embutida dos dados:', error.message);
            live = false;
            appData = normalize(readFallback());
        }
        setSync(live);
        init();
    }

    function getCategory(id) {
        return appData.categorias.find((c) => c.id === id) || { id, name: id, color: '#94a3b8' };
    }

    function getFilteredData() {
        const q = plain(state.searchQuery);
        return appData.lancamentos.filter((item) => {
            if (state.selectedCategory !== 'todas' && item.c !== state.selectedCategory) return false;
            if (state.selectedProfile !== 'todos' && item.p !== state.selectedProfile) return false;
            if (state.openOnly && item.l !== 'aberto') return false;
            if (!q) return true;
            return plain([item.n, item.o, item.s, item.a, item.t, item.f && item.f.n].join(' ')).includes(q);
        });
    }

    /* ---------- inicialização ---------- */
    function init() {
        windowDays = Number(appData.janela_dias) > 0 ? Number(appData.janela_dias) : 21;
        document.querySelectorAll('[data-window]').forEach((el) => { el.textContent = String(windowDays); });
        $('headerEdicao').textContent = appData.edicao || '';
        $('headerAutor').textContent = appData.especialista.nome || 'Rodrigo Brandelero';
        state.selectedDay = appData.lancamentos[0] ? appData.lancamentos[0].d : refISO();
        state.selectedItem = appData.lancamentos[0] || null;
        renderVolume();
        renderSources();
        renderAuthorMeta();
        updateApp();
        refreshVotes();
    }

    function updateApp() {
        const filtered = getFilteredData();
        if (!filtered.includes(state.selectedItem)) state.selectedItem = filtered[0] || null;
        renderFilters();
        renderVoting();
        renderKPIs(filtered);
        renderRadarReadout();
        renderResults(filtered);
        drawRadar(filtered);
        drawDailyChart(filtered);
        renderDayReadout(filtered);
    }

    /* ---------- filtros ---------- */
    function chip(label, selected, classesOn, classesOff, onClick, extraHTML) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        btn.className = 'px-3.5 min-h-[44px] rounded-full text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ' + (selected ? classesOn : classesOff);
        btn.innerHTML = extraHTML;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function renderFilters() {
        const catBox = $('categoryChips');
        catBox.innerHTML = '';
        const on = 'bg-white text-slate-950 shadow-sm';
        const off = 'bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700';
        catBox.appendChild(chip('Todas', state.selectedCategory === 'todas', on, off,
            () => { state.selectedCategory = 'todas'; updateApp(); },
            '<span>Todas Categorias</span><span class="text-xs opacity-75 font-mono-code">(' + appData.lancamentos.length + ')</span>'));
        appData.categorias.forEach((cat) => {
            const count = appData.lancamentos.filter((i) => i.c === cat.id).length;
            catBox.appendChild(chip(cat.name, state.selectedCategory === cat.id, on, off,
                () => { state.selectedCategory = cat.id; updateApp(); },
                '<span class="w-2 h-2 rounded-full" style="background-color:' + esc(cat.color) + '"></span><span>' + esc(cat.name) +
                '</span><span class="text-xs opacity-75 font-mono-code">(' + count + ')</span>'));
        });

        const profBox = $('profileChips');
        profBox.innerHTML = '';
        appData.perfis.forEach((p) => {
            const btn = chip(p.name, state.selectedProfile === p.id, 'bg-indigo-600 text-white shadow-sm',
                'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white',
                () => { state.selectedProfile = p.id; updateApp(); },
                '<span>' + esc(p.icon) + '</span><span>' + esc(p.name) + '</span>');
            btn.className = btn.className.replace('rounded-full', 'rounded-xl').replace('px-3.5', 'px-3');
            profBox.appendChild(btn);
        });
    }

    /* ---------- enquete ---------- */
    /* Semana ISO da data de checagem (ex.: 2026-W44). A enquete recomeça a cada semana. */
    function isoWeek(iso) {
        const d = parseISO(iso);
        if (!d) return '';
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
        const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
        return t.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    }
    const votingRound = () => isoWeek(refISO());
    const remoteActive = () => !!DB && !!appData && appData.candidatos_semana.length > 0 && !!votingRound();

    async function refreshVotes() {
        if (!remoteActive()) return;
        const seq = ++remote.seq;
        const ids = appData.candidatos_semana.map((c) => String(c.id)).filter((id) => ID_RE.test(id));
        if (!ids.length) return;
        try {
            const r = await DB.estado(votingRound(), ids);
            if (seq !== remote.seq) return; /* chegou uma resposta mais nova: ignora esta */
            remote.totals = r && r.totais && typeof r.totais === 'object' ? r.totais : {};
            remote.myVote = r && typeof r.meu_voto === 'string' ? r.meu_voto : null;
            remote.error = '';
        } catch (e) {
            if (seq !== remote.seq) return;
            console.warn('Enquete: não consegui ler os totais:', e.message);
            remote.error = 'Não consegui carregar os totais agora.';
        }
        renderVoting();
    }

    async function toggleRemote(id) {
        if (remote.busy) return;
        if (!ID_RE.test(String(id))) {
            remote.error = 'Esta opção não tem um identificador válido para votação.';
            return renderVoting();
        }
        remote.busy = true;
        remote.error = '';
        renderVoting();
        const remover = remote.myVote === id;
        try {
            if (remover) await DB.remover(votingRound()); else await DB.votar(votingRound(), id);
            remote.myVote = remover ? null : id;
            remote.busy = false;
            await refreshVotes();
        } catch (e) {
            console.warn('Enquete:', e.message);
            remote.error = e.status === 429 ? 'Muitas tentativas agora. Tente de novo em alguns minutos.'
                : e.code === 'anonymous_provider_disabled' ? 'A enquete ainda não está ativa neste site.'
                : 'Não consegui registrar o voto agora. Tente de novo em instantes.';
        } finally {
            remote.busy = false;
            renderVoting();
        }
    }

    function loadVotes() {
        try {
            const v = JSON.parse(localStorage.getItem(VOTE_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (e) {
            return {};
        }
    }
    function saveVotes() {
        try { localStorage.setItem(VOTE_KEY, JSON.stringify(state.votes)); } catch (e) { /* sem armazenamento: o voto vale só nesta visita */ }
    }
    function toggleVote(id) {
        if (remoteActive()) return toggleRemote(id);
        if (state.votes[id]) delete state.votes[id]; else state.votes[id] = 1;
        saveVotes();
        renderVoting();
    }

    function renderVoting() {
        const candidates = appData.candidatos_semana;
        const topCard = $('topWinnerCard');
        const list = $('votingCandidatesList');
        const scores = $('topWinnerScores');
        if (!candidates.length) {
            topCard.innerHTML = '<p class="text-xs text-slate-400">Sem destaque definido nesta edição.</p>';
            list.innerHTML = '';
            if (scores) scores.innerHTML = '';
            return;
        }
        const winner = candidates[0];
        topCard.innerHTML =
            '<h3 class="text-lg font-extrabold text-white leading-snug">' + esc(winner.name) + '</h3>' +
            '<span class="text-xs text-indigo-300 font-mono-code block">Desenvolvido por ' + esc(winner.org) + '</span>' +
            '<p class="text-xs text-slate-300 leading-relaxed pt-1">Destaque escolhido pela curadoria do Radar nesta edição.</p>';

        const n = winner.notas && typeof winner.notas === 'object' ? winner.notas : null;
        if (scores) {
            const rows = n ? [['Inovação', n.inovacao, 'text-indigo-400'], ['Usabilidade', n.usabilidade, 'text-emerald-400'],
                ['Impacto Dev', n.impacto_dev, 'text-purple-400'], ['Custo-Benefício', n.custo_beneficio, 'text-amber-400']]
                .filter((r) => r[1] != null) : [];
            scores.innerHTML = rows.length ? '<div class="grid grid-cols-2 gap-2 pt-1">' + rows.map((r) =>
                '<div class="bg-slate-950/70 border border-slate-800 rounded-xl p-2 text-center"><span class="text-xs text-slate-400 font-mono-code uppercase block">' +
                esc(r[0]) + '</span><span class="text-xs font-bold ' + r[2] + '">' + esc(r[1]) + ' / 10</span></div>').join('') + '</div>' : '';
        }

        const online = remoteActive();
        const scope = $('votingScope');
        const note = $('votingNote');
        const status = $('votingStatus');
        if (scope) scope.textContent = online ? 'Enquete informal' : 'Enquete neste aparelho';
        if (note) {
            note.textContent = online
                ? 'Um voto por pessoa e por semana; você pode trocar ou retirar. Não pedimos nome nem e-mail: o site guarda só um identificador anônimo neste aparelho. Enquete informal, sem verificação de identidade.'
                : 'Seu voto fica salvo só neste aparelho e não entra em ranking.';
        }
        if (status) status.textContent = online ? (remote.busy ? 'Registrando seu voto...' : remote.error) : '';

        list.innerHTML = candidates.map((c) => {
            const voted = online ? remote.myVote === c.id : !!state.votes[c.id];
            const total = online && remote.totals ? Number(remote.totals[c.id]) || 0 : null;
            const sub = esc(c.badge || c.org) + (total == null ? '' : ' · ' + fmtNumber(total) + (total === 1 ? ' voto' : ' votos'));
            const wait = online && remote.busy;
            return '<div class="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 pl-3 flex items-center justify-between gap-2">' +
                '<div class="space-y-0.5 min-w-0"><span class="text-sm font-bold text-white block">' + esc(c.name) + '</span>' +
                '<span class="text-xs text-slate-400 font-mono-code block">' + sub + '</span></div>' +
                '<button type="button" data-vote="' + esc(c.id) + '" aria-pressed="' + voted + '"' + (wait ? ' disabled aria-busy="true"' : '') +
                ' class="px-3 min-h-[44px] rounded-lg text-xs font-bold transition-all flex items-center gap-1 flex-shrink-0 disabled:opacity-60 ' +
                (voted ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-indigo-600 text-slate-100') + '">' +
                (voted ? '✓ Meu voto' : '⚡ Votar') + '</button></div>';
        }).join('');
    }

    /* ---------- indicadores ---------- */
    function renderKPIs(filtered) {
        const ref = refISO();
        const last7 = filtered.filter((i) => { const d = daysBetween(ref, i.d); return d >= 0 && d <= 7; }).length;
        const open = filtered.filter((i) => i.l === 'aberto').length;
        const orgs = new Set(filtered.map((i) => i.o)).size;
        const tile = (label, value, color, hint, extra) =>
            '<div class="' + (extra || '') + ' bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">' +
            '<span class="text-xs font-mono-code text-slate-400">' + label + '</span>' +
            '<div class="text-3xl font-extrabold ' + color + ' mt-1">' + value + '</div>' +
            '<span class="text-xs text-slate-400 mt-1">' + hint + '</span></div>';
        $('kpiContainer').innerHTML =
            tile('Total no Filtro', filtered.length, 'text-white', 'Lançamentos', 'col-span-2 sm:col-span-1') +
            tile('Últimos 7 dias', last7, 'text-indigo-400', 'Recentes') +
            tile('Código Aberto', open, 'text-emerald-400', 'Pesos/Livre') +
            tile('Organizações', orgs, 'text-amber-400', 'Labs/Empresas');
    }

    /* ---------- radar ---------- */
    function setupCanvas(canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, width: rect.width, height: rect.height };
    }

    function drawRadar(filtered) {
        const canvas = $('radarCanvas');
        if (!canvas || canvas.offsetParent === null) return;
        const { ctx, width, height } = setupCanvas(canvas);
        const cx = width / 2;
        const cy = height / 2;
        const maxR = Math.min(width, height) * 0.43;
        ctx.clearRect(0, 0, width, height);

        [1 / 3, 2 / 3, 1].forEach((ratio) => {
            const r = maxR * ratio;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
            ctx.font = '12px "JetBrains Mono", monospace';
            ctx.fillText(Math.round(windowDays * ratio) + 'd', cx + 5, cy - r + 14);
        });

        ctx.beginPath();
        ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
        ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.font = '12px "Bricolage Grotesque", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText('MODELOS', cx - maxR + 8, cy - maxR + 18);
        ctx.textAlign = 'right';
        ctx.fillText('AGENTES', cx + maxR - 8, cy - maxR + 18);
        ctx.textAlign = 'left';
        ctx.fillText('VOZ / ÁUDIO', cx - maxR + 8, cy + maxR - 10);
        ctx.textAlign = 'right';
        ctx.fillText('VÍDEO / IMG', cx + maxR - 8, cy + maxR - 10);
        ctx.textAlign = 'left';

        const ref = refISO();
        const baseAngle = { modelos: 1.25, agentes: 1.75, voz: 0.75, video: 0.25 };
        radarPoints = [];
        filtered.forEach((item, index) => {
            const days = daysBetween(ref, item.d);
            const norm = Math.min(Math.max(days / windowDays, 0.12), 1);
            const r = norm * maxR;
            const spread = (((index * 41) % 50) - 25) * (Math.PI / 180);
            const angle = (baseAngle[item.c] != null ? baseAngle[item.c] : 0) * Math.PI + spread;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            radarPoints.push({ x, y, item });
            const selected = item === state.selectedItem;
            const cat = getCategory(item.c);
            ctx.beginPath();
            ctx.arc(x, y, selected ? 9 : 6, 0, Math.PI * 2);
            ctx.fillStyle = cat.color;
            ctx.fill();
            if (selected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, 13, 0, Math.PI * 2);
                ctx.strokeStyle = cat.color;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        });
    }

    function selectItem(item) {
        state.selectedItem = item;
        renderRadarReadout();
        drawRadar(getFilteredData());
    }

    function renderRadarReadout() {
        const box = $('radarReadout');
        const item = state.selectedItem;
        if (!item) {
            box.innerHTML = '<p class="text-xs text-slate-400">Nenhum lançamento para os filtros escolhidos.</p>';
            return;
        }
        const cat = getCategory(item.c);
        box.innerHTML =
            '<div class="space-y-1.5">' +
            '<div class="flex items-center justify-between gap-2">' +
            '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider text-slate-950" style="background-color:' + esc(cat.color) + '">' + esc(cat.name) + '</span>' +
            '<span class="text-xs font-mono-code text-slate-400">' + esc(fmtDay(item.d)) + '</span></div>' +
            '<div class="flex items-baseline justify-between gap-2"><h3 class="text-base font-bold text-white">' + esc(item.n) + '</h3>' +
            '<span class="text-xs font-mono-code text-indigo-300 text-right">' + esc(item.o !== 'Não informada' ? item.o : 'Comunidade') + '</span></div>' +
            '<p class="text-sm text-slate-300 leading-relaxed">' + esc(item.s) + '</p></div>' +
            '<div class="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">' +
            '<span class="text-xs text-slate-400 font-mono-code">Perfil: ' + esc(PROFILE_LABEL[item.p] || item.p) + '</span>' +
            '<button type="button" data-focus="' + esc(item.n) + '" class="px-3 min-h-[44px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">Ver detalhes →</button></div>';
    }

    /* ---------- volume diário ---------- */
    function buildSeries(filtered) {
        const ref = refISO();
        const series = [];
        for (let i = windowDays - 1; i >= 0; i--) {
            const iso = addDays(ref, -i);
            series.push({ iso, label: fmtDay(iso), value: filtered.filter((it) => it.d === iso).length });
        }
        return series;
    }

    function drawDailyChart(filtered) {
        const canvas = $('dailyCanvas');
        if (!canvas || canvas.offsetParent === null) return;
        const { ctx, width, height } = setupCanvas(canvas);
        const padX = 12;
        const padTop = 22;
        const padBottom = 26;
        const chartH = height - padTop - padBottom;
        const chartW = width - padX * 2;
        dailySeries = buildSeries(filtered);
        const n = dailySeries.length;
        const step = chartW / n;
        const max = Math.max(1, ...dailySeries.map((d) => d.value));
        const labelEvery = Math.max(1, Math.ceil(46 / step));
        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, height - padBottom + 0.5);
        ctx.lineTo(width - padX, height - padBottom + 0.5);
        ctx.stroke();

        dailySeries.forEach((day, i) => {
            const barW = Math.max(3, step - Math.min(8, step * 0.35));
            const x = padX + i * step + (step - barW) / 2;
            const barH = (day.value / max) * chartH;
            const selected = day.iso === state.selectedDay;
            ctx.fillStyle = selected ? '#a5b4fc' : '#3b82f6';
            ctx.fillRect(x, height - padBottom - barH, barW, Math.max(barH, day.value ? 2 : 0));
            if (day.value > 0) {
                ctx.fillStyle = '#e2e8f0';
                ctx.font = '12px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(String(day.value), x + barW / 2, height - padBottom - barH - 5);
            }
            if ((n - 1 - i) % labelEvery === 0) {
                ctx.fillStyle = selected ? '#e2e8f0' : '#94a3b8';
                ctx.font = '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(day.label, Math.min(Math.max(x + barW / 2, 22), width - 22), height - 8);
            }
        });
        ctx.textAlign = 'left';
        const total = dailySeries.reduce((s, d) => s + d.value, 0);
        canvas.setAttribute('aria-label', 'Gráfico de barras com o volume diário de lançamentos nos últimos ' + windowDays + ' dias: ' + total + ' no total. Toque em uma barra para ver o dia.');
    }

    function renderDayReadout(filtered) {
        const box = $('dayReadout');
        const day = state.selectedDay;
        const items = filtered.filter((i) => i.d === day);
        const head = '<p class="text-xs font-mono-code text-indigo-300 mb-2">' + esc(fmtDay(day)) + ' · ' + items.length + (items.length === 1 ? ' lançamento' : ' lançamentos') + '</p>';
        if (!items.length) {
            box.innerHTML = head + '<p class="text-sm text-slate-400">Nenhum lançamento registrado neste dia. Toque em outra barra do gráfico.</p>';
            return;
        }
        box.innerHTML = head + '<ul class="space-y-1">' + items.map((i) =>
            '<li><button type="button" data-focus="' + esc(i.n) + '" class="w-full text-left min-h-[44px] px-2 rounded-lg hover:bg-slate-900 flex items-center justify-between gap-3">' +
            '<span class="text-sm text-slate-100">' + esc(i.n) + '</span><span class="text-xs text-slate-400 font-mono-code">' + esc(i.o) + '</span></button></li>').join('') + '</ul>';
    }

    /* ---------- lista de lançamentos ---------- */
    function sourceLink(item) {
        const url = item.f && safeUrl(item.f.u);
        if (!url) return '<span class="text-xs text-slate-400 font-mono-code">Fonte não informada</span>';
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 min-h-[44px] text-xs font-semibold text-indigo-300 hover:text-indigo-200 underline underline-offset-2">' +
            'Fonte: ' + esc(item.f.n) + ' <span aria-hidden="true">↗</span><span class="sr-only">(abre em nova aba)</span></a>';
    }

    function cardHTML(item) {
        const cat = getCategory(item.c);
        const block = (label, text, color) => text ?
            '<div class="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3"><span class="text-xs font-mono-code font-semibold uppercase tracking-wider ' + color + '">' + label + '</span>' +
            '<p class="text-sm text-slate-200 leading-relaxed mt-1">' + esc(text) + '</p></div>' : '';
        return '<article class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 hover:border-slate-700 transition-colors">' +
            '<div class="flex items-start justify-between gap-3"><div class="flex items-center gap-2 min-w-0">' +
            '<span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:' + esc(cat.color) + '"></span>' +
            '<span class="text-xs font-mono-code text-slate-300 uppercase">' + esc(cat.name) + '</span></div>' +
            '<span class="text-xs font-mono-code text-slate-400 text-right">' + esc(item.o || 'Comunidade') + '</span></div>' +
            '<h3 class="text-lg font-bold text-white leading-snug">' + esc(item.n) + '</h3>' +
            '<p class="text-sm text-slate-300 leading-relaxed">' + esc(item.s) + '</p>' +
            block('Vantagem', item.a, 'text-emerald-400') + block('Dica de uso', item.t, 'text-amber-300') +
            '<div class="flex flex-wrap items-center gap-2">' +
            '<span class="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-200">' + esc(LICENSE_LABEL[item.l] || 'Licença não informada') + '</span>' +
            '<span class="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-200">' + esc(PROFILE_LABEL[item.p] || item.p) + '</span></div>' +
            '<div class="border-t border-slate-800 pt-1">' + sourceLink(item) + '</div></article>';
    }

    function renderResults(filtered) {
        const cards = $('cardsList');
        const empty = $('emptyResults');
        $('resultsCount').textContent = 'Exibindo ' + filtered.length + (filtered.length === 1 ? ' lançamento' : ' lançamentos');
        if (!filtered.length) {
            cards.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        const byDate = {};
        filtered.forEach((item) => { (byDate[item.d] = byDate[item.d] || []).push(item); });
        cards.innerHTML = Object.keys(byDate).sort().reverse().map((date) =>
            '<div class="space-y-3"><div class="flex items-center gap-2"><span class="text-xs font-mono-code text-indigo-300">' + esc(fmtDay(date)) + '</span>' +
            '<div class="h-px flex-1 bg-slate-800"></div></div><div class="space-y-3">' + byDate[date].map(cardHTML).join('') + '</div></div>').join('');
    }

    /* ---------- volume, fontes e autor ---------- */
    function renderVolume() {
        const dirs = appData.diretorios_volume.filter((d) => Number(d.count) > 0);
        if (dirs.length) {
            const top = dirs.reduce((a, b) => (Number(b.count) > Number(a.count) ? b : a));
            const avg = Math.round(dirs.reduce((s, d) => s + Number(d.count), 0) / dirs.length);
            $('volumeTop').textContent = fmtNumber(top.count) + (top.plus ? '+' : '');
            $('volumeTopLabel').textContent = 'Ferramentas de IA cadastradas no ' + top.name;
            $('volumeAvg').textContent = '≈ ' + fmtNumber(avg);
            $('volumeAvgLabel').textContent = 'Média dos ' + dirs.length + ' diretórios listados';
        }
        $('directoriesList').innerHTML = dirs.map((d) =>
            '<div class="flex items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">' +
            '<span class="text-sm text-slate-200">' + esc(d.name) + '</span>' +
            '<span class="text-xs font-mono-code text-indigo-300">' + fmtNumber(d.count) + (d.plus ? '+' : '') + '</span></div>').join('');
        $('volumeNote').textContent = appData.diretorios_nota || '';
    }

    function sourceCard(name, type, desc, status, ok, url) {
        const href = safeUrl(url);
        return '<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">' +
            '<div class="flex items-center justify-between gap-2"><h3 class="text-sm font-bold text-white">' + esc(name) + '</h3>' +
            '<span class="text-xs px-2 py-0.5 rounded-full font-mono-code ' + (ok ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-slate-700 text-slate-200') + '">' + esc(status) + '</span></div>' +
            '<p class="text-xs text-slate-400 font-mono-code">' + esc(type) + '</p>' +
            '<p class="text-sm text-slate-300 leading-relaxed">' + esc(desc) + '</p>' +
            (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center min-h-[44px] text-xs font-semibold text-indigo-300 underline underline-offset-2">Abrir fonte <span aria-hidden="true">&nbsp;↗</span><span class="sr-only">(abre em nova aba)</span></a>' : '') + '</div>';
    }

    function renderSources() {
        const used = {};
        appData.lancamentos.forEach((it) => {
            if (!it.f || !safeUrl(it.f.u)) return;
            const k = it.f.n + '|' + it.f.u;
            used[k] = used[k] || { name: it.f.n, url: it.f.u, count: 0 };
            used[k].count++;
        });
        const list = Object.keys(used).map((k) => used[k]).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        $('sourcesList').innerHTML = list.length ? list.map((s) =>
            sourceCard(s.name, 'Página pública', s.count + (s.count === 1 ? ' lançamento' : ' lançamentos') + ' desta edição vêm desta fonte.', 'Consulta manual', true, s.url)).join('')
            : '<p class="text-sm text-slate-400">Nenhum lançamento com fonte nesta edição.</p>';
        $('sourcesPlanned').innerHTML = appData.fontes.map((s) =>
            sourceCard(s.name, s.type || '', s.desc || '', s.status || 'Prevista', !!s.ok, s.url)).join('');
    }

    function renderAuthorMeta() {
        const a = appData.especialista;
        if ($('displayAuthorName') && a.nome) $('displayAuthorName').textContent = a.nome;
        if ($('displayAuthorRole') && a.cargo) $('displayAuthorRole').textContent = a.cargo;
        if ($('cardAuthorName') && a.nome) $('cardAuthorName').textContent = a.nome;
        const bio = $('displayAuthorBio');
        if (bio && Array.isArray(a.bio) && a.bio.length) bio.innerHTML = a.bio.map((p) => '<p>' + esc(p) + '</p>').join('');
    }

    /* ---------- navegação ---------- */
    function syncStickyOffset() {
        const header = document.querySelector('header');
        const bar = $('filterBar');
        if (header && bar) bar.style.top = header.offsetHeight + 'px';
    }

    function switchTab(tab) {
        if (!$('view-' + tab)) return;
        state.currentTab = tab;
        document.querySelectorAll('section[id^="view-"]').forEach((s) => s.classList.add('hidden'));
        $('view-' + tab).classList.remove('hidden');
        document.querySelectorAll('.tab-btn').forEach((btn) => {
            const active = btn.dataset.tab === tab;
            btn.classList.toggle('active', active);
            btn.classList.toggle('text-indigo-400', active);
            btn.classList.toggle('text-slate-400', !active);
            if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
        });
        const bar = $('filterBar');
        if (bar) bar.classList.toggle('hidden', FILTER_TABS.indexOf(tab) === -1);
        window.scrollTo(0, 0);
        if (appData && tab === 'panorama') {
            const filtered = getFilteredData();
            drawRadar(filtered);
            drawDailyChart(filtered);
        }
    }

    function focusCard(name) {
        state.searchQuery = name;
        state.selectedCategory = 'todas';
        state.selectedProfile = 'todos';
        const input = $('searchInput');
        if (input) input.value = name;
        switchTab('lancamentos');
        updateApp();
    }

    /* ---------- formulário de contato (Formspree) ---------- */
    function initContact() {
        const form = $('contactForm');
        if (!form) return;
        const box = $('contactFeedback');
        const btn = $('contactSubmitBtn');
        const show = (ok, msg) => {
            box.className = 'rounded-xl p-3 text-sm border ' + (ok ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200' : 'bg-red-950/80 border-red-500/40 text-red-200');
            box.textContent = msg;
        };
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            box.className = 'hidden';
            const fd = new FormData(form);
            if (fd.get('_gotcha')) return; // campo-armadilha preenchido: é robô
            const name = String(fd.get('name') || '').trim();
            const email = String(fd.get('email') || '').trim();
            const whats = String(fd.get('whatsapp') || '').trim();
            const fail = (msg, id) => { show(false, msg); const el = $(id); if (el) el.focus(); };
            if (!name || !email || !whats) return fail('Preencha nome, e-mail e WhatsApp.', !name ? 'contactName' : !email ? 'contactEmail' : 'contactWhats');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Informe um e-mail válido.', 'contactEmail');
            if (whats.replace(/\D/g, '').length < 8) return fail('Informe um WhatsApp válido, com DDD.', 'contactWhats');
            if (!fd.get('consent')) return fail('Marque a caixa de consentimento para enviar a mensagem.', 'contactConsent');
            if (/SEU_ID/.test(form.getAttribute('action') || '')) {
                return show(false, 'O formulário ainda não está configurado neste site. Fale comigo pelo e-mail, LinkedIn ou Instagram desta página.');
            }
            btn.disabled = true;
            btn.querySelector('[data-label]').textContent = 'Enviando...';
            try {
                const resp = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: fd });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                form.reset();
                show(true, 'Mensagem enviada com sucesso. O especialista Rodrigo Brandelero retornará o contato em breve.');
            } catch (error) {
                console.error(error);
                show(false, 'Não foi possível enviar agora. Tente de novo em alguns minutos ou use o e-mail desta página.');
            } finally {
                btn.disabled = false;
                btn.querySelector('[data-label]').textContent = 'Enviar Contato';
            }
        });
    }

    /* ---------- eventos ---------- */
    function pointerIndex(canvas, ev) {
        const r = canvas.getBoundingClientRect();
        return { x: ev.clientX - r.left, y: ev.clientY - r.top, width: r.width };
    }

    document.addEventListener('DOMContentLoaded', () => {
        state.votes = loadVotes();

        document.addEventListener('click', (e) => {
            const go = e.target.closest('[data-tab],[data-go]');
            if (go) return switchTab(go.dataset.tab || go.dataset.go);
            const vote = e.target.closest('[data-vote]');
            if (vote) return toggleVote(vote.dataset.vote);
            const focus = e.target.closest('[data-focus]');
            if (focus) return focusCard(focus.dataset.focus);
        });

        const search = $('searchInput');
        if (search) search.addEventListener('input', (e) => { state.searchQuery = e.target.value; updateApp(); });

        const open = $('btnOpenOnly');
        if (open) {
            open.addEventListener('click', () => {
                state.openOnly = !state.openOnly;
                open.setAttribute('aria-pressed', String(state.openOnly));
                ['bg-indigo-600', 'text-white', 'border-indigo-500'].forEach((c) => open.classList.toggle(c, state.openOnly));
                updateApp();
            });
        }

        const radar = $('radarCanvas');
        if (radar) {
            radar.addEventListener('click', (ev) => {
                const p = pointerIndex(radar, ev);
                let best = null;
                let bestD = Infinity;
                radarPoints.forEach((pt) => {
                    const d = Math.hypot(pt.x - p.x, pt.y - p.y);
                    if (d < bestD) { bestD = d; best = pt; }
                });
                if (best && bestD <= 24) selectItem(best.item);
            });
            radar.addEventListener('keydown', (ev) => {
                const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
                if (!(ev.key in keys) || !radarPoints.length) return;
                ev.preventDefault();
                const i = radarPoints.findIndex((pt) => pt.item === state.selectedItem);
                const next = (i + keys[ev.key] + radarPoints.length) % radarPoints.length;
                selectItem(radarPoints[next].item);
            });
        }

        const daily = $('dailyCanvas');
        if (daily) {
            daily.addEventListener('click', (ev) => {
                if (!dailySeries.length) return;
                const p = pointerIndex(daily, ev);
                const step = (p.width - 24) / dailySeries.length;
                const i = Math.min(dailySeries.length - 1, Math.max(0, Math.floor((p.x - 12) / step)));
                state.selectedDay = dailySeries[i].iso;
                const filtered = getFilteredData();
                drawDailyChart(filtered);
                renderDayReadout(filtered);
            });
        }

        initContact();
        syncStickyOffset();
        switchTab('panorama');

        let timer = null;
        const onResize = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                syncStickyOffset();
                if (appData) { const f = getFilteredData(); drawRadar(f); drawDailyChart(f); }
            }, 120);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncStickyOffset);

        loadAppData();
    });
})();
