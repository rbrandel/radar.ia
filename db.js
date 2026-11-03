'use strict';
/* Radar de IA: conexão opcional com o Supabase, usada só pela enquete "Vote na melhor IA".
 * Sem configuração (config.js vazio), RadarDB.enabled é false e o site usa o voto local.
 * Não usa bibliotecas externas, só fetch, para a política de segurança da página continuar fechada. */
(function () {
    const cfg = window.RADAR_CONFIG && typeof window.RADAR_CONFIG === 'object' ? window.RADAR_CONFIG : {};
    const rawUrl = String(cfg.supabaseUrl || '').trim();
    const key = String(cfg.supabaseKey || '').trim();

    /* Aceita os erros de colagem mais comuns: sem "https://", com "/" ou "/rest/v1/" no fim, letras maiúsculas,
     * ou o endereço do painel (supabase.com/dashboard/project/CODIGO). Devolve https://CODIGO.supabase.co ou ''. */
    function normalizeUrl(raw) {
        let s = String(raw || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim(); /* tira aspas coladas junto */
        if (!s) return '';
        if (/^[a-z0-9]{20}$/i.test(s)) return 'https://' + s.toLowerCase() + '.supabase.co'; /* só o "Project ID" */
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
        try {
            const u = new URL(s);
            if (u.protocol !== 'https:') return '';
            if (/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)) return 'https://' + u.hostname;
            if (/^(www\.)?supabase\.com$/.test(u.hostname)) {
                const m = /\/project\/([a-z0-9]{6,40})(\/|$)/i.exec(u.pathname);
                if (m) return 'https://' + m[1].toLowerCase() + '.supabase.co';
            }
        } catch (e) { /* endereço mal formado */ }
        return '';
    }
    const url = normalizeUrl(rawUrl);
    /* Endereços de exemplo (de guias e mensagens) que alguém pode colar sem trocar pelo do seu projeto. */
    const isExampleUrl = (u) => /^https:\/\/(seu-?projeto|meu-?projeto|codigo(-do-projeto)?|projeto|abcdefghijklmnopqrst|x{4,})\.supabase\.co$/.test(u);
    const SESSION_KEY = 'radar_ai_sessao_v1';
    const TIMEOUT_MS = 10000;

    /* Proteção para quem está começando: recusa a chave secreta, que nunca pode ir para o site. */
    function keyIsSecret(k) {
        if (/^sb_secret_/i.test(k)) return true;
        const parts = k.split('.');
        if (parts.length === 3 && /^eyJ/.test(k)) {
            try {
                return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role';
            } catch (e) {
                return false;
            }
        }
        return false;
    }

    let problem = '';
    if (rawUrl || key) {
        if (!rawUrl) problem = 'supabaseUrl está vazia (cole o "Project URL" do painel do Supabase).';
        else if (!url) problem = 'supabaseUrl inválida. O valor recebido foi ' + JSON.stringify(rawUrl.slice(0, 90)) + '. O certo é só o endereço, como https://abcdefghijklmnopqrst.supabase.co (copie o "Project URL" do painel).';
        else if (isExampleUrl(url)) problem = 'supabaseUrl é um endereço de EXEMPLO (' + JSON.stringify(rawUrl.slice(0, 90)) + '). Troque pelo "Project URL" do seu projeto (painel do Supabase, botão Connect).';
        else if (!key) problem = 'supabaseKey está vazia (cole a chave "publishable" do painel).';
        else if (!/^[A-Za-z0-9._-]{20,}$/.test(key)) problem = 'supabaseKey inválida: confira se copiou a chave publishable inteira, sem espaços nem aspas dentro.';
        else if (keyIsSecret(key)) problem = 'essa é uma chave SECRETA. Use só a chave publishable (sb_publishable_...) e gere outra chave secreta no Supabase, porque esta ficou exposta.';
    }
    if (problem) console.error('[Radar] Supabase desligado: ' + problem);
    const enabled = !!url && !!key && !problem;

    /* ---------- sessão anônima (guardada neste aparelho) ---------- */
    let session = null; /* { p, access_token, refresh_token, expires_at (segundos), user_id } */
    function loadSession() {
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            if (s && s.p === url && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && Number(s.expires_at) > 0) return s;
        } catch (e) { /* sem armazenamento ou dado corrompido: começa sem sessão */ }
        return null;
    }
    function saveSession(s) {
        session = s;
        try {
            if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* a sessão vale só nesta visita */ }
    }
    if (enabled) session = loadSession();

    const nowSec = () => Math.floor(Date.now() / 1000);

    function fromAuth(d) {
        if (!d || typeof d.access_token !== 'string' || typeof d.refresh_token !== 'string') throw new Error('resposta de login inesperada');
        const exp = Number(d.expires_at) > 0 ? Number(d.expires_at) : nowSec() + (Number(d.expires_in) || 3600);
        return { p: url, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: exp, user_id: (d.user && d.user.id) || '' };
    }

    /* ---------- chamadas HTTP ---------- */
    async function request(path, body, token) {
        const headers = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
            const text = await resp.text();
            let data = null;
            if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
            if (!resp.ok) {
                const err = new Error((data && (data.message || data.msg || data.error_description)) || 'HTTP ' + resp.status);
                err.status = resp.status;
                err.code = (data && (data.error_code || data.code)) || '';
                throw err;
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function refresh() {
        saveSession(fromAuth(await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })));
    }
    async function signIn() {
        saveSession(fromAuth(await request('/auth/v1/signup', { data: {} })));
    }

    /* Garante uma sessão válida. criar=false só renova uma sessão que já existe (não cria usuário novo). */
    let pending = null;
    function ensureSession(criar, forcar) {
        if (!enabled) return Promise.resolve(null);
        if (pending) return pending;
        pending = (async () => {
            if (session && !forcar && session.expires_at - 60 > nowSec()) return session;
            if (session) {
                try {
                    await refresh();
                    return session;
                } catch (e) {
                    if (e.status && e.status < 500 && e.status !== 429) saveSession(null); else throw e;
                }
            }
            if (!criar) return null;
            await signIn();
            return session;
        })();
        const limpar = () => { pending = null; };
        pending.then(limpar, limpar);
        return pending;
    }

    const rpc = (fn, args, token) => request('/rest/v1/rpc/' + fn, args, token);

    /* Totais da rodada e o voto de quem pergunta. Sem sessão, devolve só os totais. */
    async function estado(rodada, candidatos) {
        const args = { p_rodada: rodada, p_candidatos: candidatos };
        const s = await ensureSession(false);
        try {
            return await rpc('estado_votos', args, s && s.access_token);
        } catch (e) {
            if (s && e.status === 401) return rpc('estado_votos', args);
            throw e;
        }
    }

    async function comSessao(fn, args) {
        let s = await ensureSession(true);
        if (!s) s = await ensureSession(true);
        if (!s) throw new Error('sem sessão');
        try {
            return await rpc(fn, args, s.access_token);
        } catch (e) {
            if (e.status !== 401) throw e;
            s = await ensureSession(true, true);
            if (!s) throw e;
            return rpc(fn, args, s.access_token);
        }
    }

    window.RadarDB = Object.freeze({
        enabled: enabled,
        estado: estado,
        votar: (rodada, candidato) => comSessao('votar', { p_rodada: rodada, p_candidato: candidato }),
        remover: (rodada) => comSessao('remover_voto', { p_rodada: rodada })
    });
})();
