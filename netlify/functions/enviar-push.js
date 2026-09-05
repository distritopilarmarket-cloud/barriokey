// netlify/functions/enviar-push.js
// BarrioKey — envío de notificaciones push por barrio (Firebase Cloud Messaging v1)
//
// Variables de entorno que hay que cargar en Netlify:
//
//   FIREBASE_SERVICE_ACCOUNT -> el .json COMPLETO de la cuenta de servicio, pegado tal cual
//                               (es la forma más simple: no hay que recortar nada)
//   SUPABASE_URL             -> https://bovnkvqqrswfatgmrjtj.supabase.co
//   SUPABASE_SERVICE_KEY     -> la service_role key de Supabase (NO la anon)
//   CLAVE_PUSH               -> una contraseña que inventes, la misma que va en el panel admin
//
// (Alternativa, si preferís separarlas: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
//  FIREBASE_PRIVATE_KEY. La función acepta cualquiera de las dos formas.)

const crypto = require('crypto');

/* Lee las credenciales de Firebase: del .json completo, o de las tres variables sueltas */
function credencialesFirebase() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (bruto && bruto.trim().startsWith('{')) {
    try {
      const j = JSON.parse(bruto);
      return {
        projectId: j.project_id,
        clientEmail: j.client_email,
        privateKey: (j.private_key || '').replace(/\\n/g, '\n'),
      };
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido');
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

const FB          = credencialesFirebase();
const PROJECT_ID  = FB.projectId;
const CLIENT_MAIL = FB.clientEmail;
const PRIVATE_KEY = FB.privateKey;
const SB_URL      = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY      = process.env.SUPABASE_SERVICE_KEY;
const CLAVE_PUSH  = process.env.CLAVE_PUSH;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const responder = (code, obj) => ({
  statusCode: code,
  headers: { ...CORS, 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

/* ---------- Supabase (con service_role, ignora RLS) ---------- */
async function sb(path, opciones = {}) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    method: opciones.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      ...(opciones.prefer ? { Prefer: opciones.prefer } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + texto);
  return texto ? JSON.parse(texto) : null;
}

/* ---------- Token de Google (JWT firmado con la clave privada) ---------- */
let cacheToken = { valor: null, vence: 0 };

async function tokenGoogle() {
  if (cacheToken.valor && Date.now() < cacheToken.vence) return cacheToken.valor;

  const ahora = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sinFirmar =
    b64({ alg: 'RS256', typ: 'JWT' }) + '.' +
    b64({
      iss: CLIENT_MAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: ahora,
      exp: ahora + 3600,
    });

  const firma = crypto.createSign('RSA-SHA256').update(sinFirmar).sign(PRIVATE_KEY, 'base64url');
  const jwt = sinFirmar + '.' + firma;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('No se pudo autenticar con Google: ' + JSON.stringify(j));

  cacheToken = { valor: j.access_token, vence: Date.now() + 50 * 60 * 1000 };
  return j.access_token;
}

/* ---------- Envío a un dispositivo ---------- */
async function enviarUno(tokenDispositivo, titulo, cuerpo, accessToken) {
  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: tokenDispositivo,
          notification: { title: titulo, body: cuerpo },
          android: { priority: 'HIGH', notification: { sound: 'default' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    }
  );
  if (r.ok) return { ok: true };
  const texto = await r.text();
  // 404 / UNREGISTERED = la app se desinstaló o el token venció
  const muerto = r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(texto);
  return { ok: false, muerto, texto };
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return responder(405, { error: 'Solo POST' });

  let datos;
  try { datos = JSON.parse(event.body || '{}'); }
  catch (e) { return responder(400, { error: 'JSON inválido' }); }

  if (!CLAVE_PUSH || datos.clave !== CLAVE_PUSH) return responder(401, { error: 'No autorizado' });

  const barrio = (datos.barrio || '').trim();
  const titulo = (datos.titulo || 'BarrioKey').trim();
  const cuerpo = (datos.cuerpo || '').trim();
  const origen = datos.origen || 'manual';
  const refId  = datos.ref_id || null;

  if (!barrio) return responder(400, { error: 'Falta el barrio' });
  if (!cuerpo) return responder(400, { error: 'Falta el texto del aviso' });
  if (cuerpo.length > 180) return responder(400, { error: 'El texto no puede pasar de 180 caracteres' });

  try {
    /* 1. Modo del barrio y tope diario */
    const cfg = await sb('push_config?barrio=eq.' + encodeURIComponent(barrio) + '&select=*');
    const config = (cfg && cfg[0]) || { modo: 'manual', tope_diario: 3 };

    if (origen !== 'manual' && config.modo !== 'auto') {
      // El barrio está en manual: se guarda pendiente, no se manda
      await sb('push_cola', {
        method: 'POST',
        body: { barrio, titulo, cuerpo, origen, ref_id: refId, estado: 'pendiente' },
        prefer: 'return=minimal',
      });
      return responder(200, { ok: true, enviados: 0, guardado: 'pendiente',
        mensaje: 'El barrio está en modo manual: el aviso quedó en la cola.' });
    }

    /* 2. Tope diario */
    const desde = new Date(); desde.setHours(0, 0, 0, 0);
    const hoy = await sb('push_cola?barrio=eq.' + encodeURIComponent(barrio) +
      '&estado=eq.enviado&enviado_en=gte.' + desde.toISOString() + '&select=id');
    if ((hoy || []).length >= (config.tope_diario || 3)) {
      return responder(429, { error: 'Ya se mandaron ' + (config.tope_diario || 3) +
        ' avisos hoy en ' + barrio + '. Probá mañana.' });
    }

    /* 3. Dispositivos del barrio */
    const campo = (origen === 'novedad_comercio') ? 'avisos_comercios' : 'avisos_barrio';
    const dispositivos = await sb('dispositivos?barrio=eq.' + encodeURIComponent(barrio) +
      '&' + campo + '=eq.true&select=id,token');

    if (!dispositivos || !dispositivos.length) {
      return responder(200, { ok: true, enviados: 0, mensaje: 'Todavía no hay celulares registrados en ' + barrio });
    }

    /* 4. Enviar */
    const accessToken = await tokenGoogle();
    let enviados = 0;
    const muertos = [];

    for (const d of dispositivos) {
      const res = await enviarUno(d.token, titulo, cuerpo, accessToken);
      if (res.ok) enviados++;
      else if (res.muerto) muertos.push(d.id);
    }

    /* 5. Limpiar tokens muertos */
    for (const id of muertos) {
      try { await sb('dispositivos?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' }); } catch (e) {}
    }

    /* 6. Registrar en el historial */
    await sb('push_cola', {
      method: 'POST',
      body: { barrio, titulo, cuerpo, origen, ref_id: refId,
              estado: 'enviado', enviados, enviado_en: new Date().toISOString() },
      prefer: 'return=minimal',
    });

    return responder(200, { ok: true, enviados, total: dispositivos.length, limpiados: muertos.length });

  } catch (e) {
    return responder(500, { error: String(e.message || e) });
  }
};
