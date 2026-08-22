// Verifica o cambia la clave del Panel de administración SIN exponerla nunca
// al navegador. Usa la clave "service_role" de Supabase, que solo vive acá
// (variable de entorno en Netlify), nunca en el código de la app.
//
// Configurar en Netlify → Site settings → Environment variables:
//   SUPABASE_URL          = https://xxxx.supabase.co   (la misma que ya usás)
//   SUPABASE_SERVICE_KEY  = la clave "service_role" (Supabase → Settings → API)
//                           OJO: es distinta de la "anon public" que usa la app.
//                           Nunca compartir ni pegar esta clave en index.html.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar SUPABASE_URL / SUPABASE_SERVICE_KEY en Netlify' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { accion, clave, claveActual, claveNueva } = body;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // Trae la clave guardada (esto corre en el servidor, nunca llega al navegador)
    const rGet = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/config_admin?select=clave&limit=1', { headers });
    const filas = await rGet.json();
    const claveGuardada = filas && filas[0] ? String(filas[0].clave) : null;
    if (!claveGuardada) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'No se encontró la clave configurada' }) };
    }

    if (accion === 'validar') {
      const ok = String(clave || '') === claveGuardada;
      return { statusCode: 200, body: JSON.stringify({ ok }) };
    }

    if (accion === 'cambiar') {
      if (String(claveActual || '') !== claveGuardada) {
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'La clave actual no coincide' }) };
      }
      if (!claveNueva || String(claveNueva).length < 4) {
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'La clave nueva debe tener al menos 4 caracteres' }) };
      }
      const rPatch = await fetch(
        SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/config_admin?clave=eq.' + encodeURIComponent(claveGuardada),
        { method: 'PATCH', headers, body: JSON.stringify({ clave: String(claveNueva) }) }
      );
      if (!rPatch.ok) {
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'No se pudo actualizar' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Acción desconocida' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error de conexión: ' + (e && e.message ? e.message : '') }) };
  }
};
