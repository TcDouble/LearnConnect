const SUPABASE_URL = 'https://voqpgofzhuuzlensefxm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_sphkh_yP-0gByVFvrxPmmA_UULc8fxb';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function splitFullName(fullName) {
    const parts = fullName.trim().split(/\s+/);
    const firstname = parts.shift() || '';
    const lastname = parts.join(' ') || '';
    return { firstname, lastname };
}
