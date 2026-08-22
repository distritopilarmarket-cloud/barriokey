// Proxy protegido para TODAS las acciones de escritura/lectura del Panel
// (verificar, aprobar, destacar, borrar, editar, config, etc).
// Verifica la clave del Panel server-side y recién ahí usa la clave
// "service_role" (que nunca viaja al navegador) para tocar Supabase.
//
// Requiere las mismas variables de entorno que clave-admin.js:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const TABLAS_PERMITIDAS = ['prestadores', 'vecinos', 'resenas', 'pedidos', 'config_app'];
const METODOS_PERMITIDOS = ['GET', 'PATCH', 'DELETE', 'POST'];

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

  const { clave, tabla, metodo, filtro, datos } = body;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Verificar la clave del Panel (server-side, con service_role)
    const rGet = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/config_admin?select=clave&limit=1', { headers });
    const filas = await rGet.json();
    const claveGuardada = filas && filas[0] ? String(filas[0].clave) : null;
    if (!claveGuardada || String(clave || '') !== claveGuardada) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Clave incorrecta' }) };
    }

    // 2) Validar tabla y método contra la lista blanca
    if (!TABLAS_PERMITIDAS.includes(tabla)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Tabla no permitida' }) };
    }
    if (!METODOS_PERMITIDOS.includes(metodo)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Método no permitido' }) };
    }

    // 3) Ejecutar la acción real contra Supabase con la clave service_role
    let url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + tabla;
    if (filtro) url += '?' + filtro;
    const reqHeaders = Object.assign({}, headers);
    if (metodo === 'PATCH' || metodo === 'POST') reqHeaders.Prefer = 'return=representation';

    const r = await fetch(url, {
      method: metodo,
      headers: reqHeaders,
      body: (metodo === 'PATCH' || metodo === 'POST') ? JSON.stringify(datos || {}) : undefined,
    });
    if (!r.ok) {
      const txt = await r.text();
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: txt || ('HTTP ' + r.status) }) };
    }
    const texto = await r.text();
    const resultado = texto ? JSON.parse(texto) : null;
    return { statusCode: 200, body: JSON.stringify({ ok: true, data: resultado }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Error de conexión: ' + (e && e.message ? e.message : '') }) };
  }
};
