// Mantiene despierto el proyecto de Supabase.
//
// El plan gratis pausa el proyecto tras 7 días sin pedidos externos (los
// cron jobs de pg_cron corren adentro de la base y no cuentan). Vercel llama
// a este endpoint una vez por día (ver "crons" en vercel.json) y hace una
// lectura real contra Postgres por la API REST, con la anon key — la misma
// que ya viaja en el bundle público, así que no expone nada nuevo.

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(500).json({ ok: false, error: 'Faltan SUPABASE_URL / SUPABASE_ANON_KEY' });
  }

  try {
    // businesses tiene lectura pública (policy businesses_select).
    const r = await fetch(`${url}/rest/v1/businesses?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, status: r.status, error: await r.text() });
    }
    return res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err) });
  }
}
