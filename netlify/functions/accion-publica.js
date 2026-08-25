// Acciones públicas (sin clave de Panel) pero controladas server-side,
// para que la app no necesite permiso abierto de escritura en Supabase.
// Cada acción solo puede tocar exactamente los campos que necesita, nada más.
//
// Requiere las mismas variables de entorno que clave-admin.js:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

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

  const { accion } = body;
  const base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    if (accion === 'reportar') {
      const { tabla, id, motivo } = body;
      if (!['vecinos', 'resenas'].includes(tabla) || !id) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Datos inválidos' }) };
      }
      const patch = { reportado: true, reporte_motivo: String(motivo || '').slice(0, 300), reportado_en: new Date().toISOString() };
      const r = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(patch) });
      if (!r.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'marcarCalificado') {
      const { id } = body;
      if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Falta id' }) };
      const r = await fetch(base + 'pedidos?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify({ calificado: true }) });
      if (!r.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'crearPedido') {
      const { datos } = body;
      if (!datos) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Faltan datos' }) };
      const r = await fetch(base + 'pedidos', { method: 'POST', headers: Object.assign({}, headers, { Prefer: 'return=representation' }), body: JSON.stringify(datos) });
      if (!r.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await r.text() }) };
      const data = await r.json();
      return { statusCode: 200, body: JSON.stringify({ ok: true, data }) };
    }

    if (accion === 'misPedidos') {
      const { dispositivo } = body;
      if (!dispositivo) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Falta dispositivo' }) };
      const r = await fetch(base + 'pedidos?dispositivo=eq.' + encodeURIComponent(dispositivo) + '&select=*&order=creado_en.desc&limit=100', { headers });
      if (!r.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await r.text() }) };
      const data = await r.json();
      return { statusCode: 200, body: JSON.stringify({ ok: true, data }) };
    }

    if (accion === 'vencerPro') {
      const { tabla, id, campoVence, campoBarrios, valorPrevio } = body;
      if (!['prestadores', 'vecinos'].includes(tabla) || !id) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Datos inválidos' }) };
      }
      // Solo revierte (nunca otorga) — riesgo mínimo de abuso.
      const patch = {};
      patch[campoBarrios] = valorPrevio || '';
      patch[campoVence] = null;
      const r = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(patch) });
      if (!r.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'editarPropio') {
      // Edición de la propia publicación (solo Plan Pro activo, verificado server-side).
      // Solo permite tocar: foto, foto2, link y descripción/qué ofrece. Nada más.
      const { tipo, id, patch } = body;
      if (!id || !patch || (tipo !== 'o' && tipo !== 'v')) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };
      }
      const tabla = tipo === 'o' ? 'prestadores' : 'vecinos';

      const permitidos = ['foto', 'foto2', 'link'];
      permitidos.push(tipo === 'o' ? 'descripcion' : 'que');
      const datos = {};
      for (const k of permitidos) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) datos[k] = patch[k];
      }
      if (!Object.keys(datos).length) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Nada para actualizar' }) };
      }

      // Verificar server-side que tiene Plan Pro activo antes de permitir la edición
      const rGet = await fetch(base + tabla + '?select=*&id=eq.' + encodeURIComponent(id), { headers });
      if (!rGet.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await rGet.text() }) };
      const rows = await rGet.json();
      const rec = rows && rows[0];
      if (!rec) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'Publicación no encontrada' }) };

      let esPro = false;
      if (tipo === 'o') {
        const n = String(rec.barriosAprobados || '').split(',').map(x => x.trim()).filter(Boolean).length;
        esPro = n > 2;
      } else {
        esPro = !!(rec.destacado_hasta && new Date(rec.destacado_hasta) > new Date());
      }
      if (!esPro) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'La edición requiere Plan Pro activo' }) };

      const rPatch = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(datos) });
      if (!rPatch.ok) return { statusCode: 200, body: JSON.stringify({ ok: false, error: await rPatch.text() }) };
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Acción desconocida' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Error de conexión: ' + (e && e.message ? e.message : '') }) };
  }
};
