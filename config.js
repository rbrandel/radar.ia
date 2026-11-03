/* Radar de IA: ligação com o Supabase (opcional).
 *
 * Enquanto os dois campos abaixo estiverem VAZIOS, o site funciona normalmente e a enquete
 * guarda o voto só no aparelho de quem votou. Quando você preencher, a enquete passa a ter
 * votos reais, somados para todo mundo. Passo a passo: supabase/GUIA-SUPABASE.md
 *
 * Aqui entra SOMENTE a chave pública (publishable, começa com sb_publishable_).
 * NUNCA coloque a chave secreta (sb_secret_...) nem a "service_role": este arquivo é público.
 */
window.RADAR_CONFIG = {
    supabaseUrl: "https://kmzfynvrzyqgrguqdwxm.supabase.co",   // exemplo: "https://abcdefghijklmnopqrst.supabase.co"
    supabaseKey: "sb_publishable_njSKVgKcCpEMfdCA09wxhg_givufUKn"    // exemplo: "sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
};
