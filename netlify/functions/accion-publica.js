// Acciones públicas (sin clave de Panel) pero controladas server-side,
// para que la app no necesite permiso abierto de escritura en Supabase.
// Cada acción solo puede tocar exactamente los campos que necesita, nada más.
//
// Requiere las mismas variables de entorno que clave-admin.js:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  // Preflight: el navegador/app pregunta permiso antes del POST real.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Falta configurar SUPABASE_URL / SUPABASE_SERVICE_KEY en Netlify' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'JSON inválido' }) }; }

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
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Datos inválidos' }) };
      }
      const patch = { reportado: true, reporte_motivo: String(motivo || '').slice(0, 300), reportado_en: new Date().toISOString() };
      const r = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(patch) });
      if (!r.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'marcarCalificado') {
      const { id } = body;
      if (!id) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Falta id' }) };
      const r = await fetch(base + 'pedidos?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify({ calificado: true }) });
      if (!r.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'crearPedido') {
      const { datos } = body;
      if (!datos) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Faltan datos' }) };
      const r = await fetch(base + 'pedidos', { method: 'POST', headers: Object.assign({}, headers, { Prefer: 'return=representation' }), body: JSON.stringify(datos) });
      if (!r.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await r.text() }) };
      const data = await r.json();
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
    }

    if (accion === 'misPedidos') {
      const { dispositivo } = body;
      if (!dispositivo) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Falta dispositivo' }) };
      const r = await fetch(base + 'pedidos?dispositivo=eq.' + encodeURIComponent(dispositivo) + '&select=*&order=creado_en.desc&limit=100', { headers });
      if (!r.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await r.text() }) };
      const data = await r.json();
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data }) };
    }

    if (accion === 'vencerPro') {
      const { tabla, id, campoVence, campoBarrios, valorPrevio } = body;
      if (!['prestadores', 'vecinos'].includes(tabla) || !id) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Datos inválidos' }) };
      }
      // Solo revierte (nunca otorga) — riesgo mínimo de abuso.
      const patch = {};
      patch[campoBarrios] = valorPrevio || '';
      patch[campoVence] = null;
      const r = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(patch) });
      if (!r.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await r.text() }) };
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'editarPropio') {
      // Edición de la propia publicación. Dos casos:
      //  1) Ya es Pro: puede tocar foto, foto2, link, descripción/qué ofrece, novedad.
      //  2) Todavía NO es Pro pero pide pasar a Plan Pro (patch.pro_pendiente === true):
      //     solo puede tocar foto2, link y el propio flag pro_pendiente. Nada más.
      const { tipo, id, patch } = body;
      if (!id || !patch || (tipo !== 'o' && tipo !== 'v')) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };
      }
      const tabla = tipo === 'o' ? 'prestadores' : 'vecinos';

      const esPedidoUpgrade = Object.prototype.hasOwnProperty.call(patch, 'pro_pendiente') && patch.pro_pendiente === true;
      const permitidos = esPedidoUpgrade
        ? ['foto2', 'link', 'pro_pendiente', 'foto_sin_revisar']
        : ['foto', 'foto2', 'link', 'foto_sin_revisar', 'novedad_texto', 'novedad_fecha'];
      if (!esPedidoUpgrade) permitidos.push(tipo === 'o' ? 'descripcion' : 'que');
      const datos = {};
      for (const k of permitidos) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) datos[k] = patch[k];
      }
      if (!Object.keys(datos).length) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Nada para actualizar' }) };
      }

      // Si NO es un pedido de upgrade, verificar server-side que ya tiene Plan Pro activo.
      if (!esPedidoUpgrade) {
        const rGet = await fetch(base + tabla + '?select=*&id=eq.' + encodeURIComponent(id), { headers });
        if (!rGet.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rGet.text() }) };
        const rows = await rGet.json();
        const rec = rows && rows[0];
        if (!rec) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Publicación no encontrada' }) };

        let esPro = false;
        if (tipo === 'o') {
          const n = String(rec.barriosAprobados || '').split(',').map(x => x.trim()).filter(Boolean).length;
          esPro = n > 2;
        } else {
          esPro = !!(rec.destacado_hasta && new Date(rec.destacado_hasta) > new Date());
        }
        if (!esPro) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'La edición requiere Plan Pro activo' }) };
      }

      const rPatch = await fetch(base + tabla + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers, body: JSON.stringify(datos) });
      if (!rPatch.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rPatch.text() }) };
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (accion === 'crearInvitacion') {
      // Un vecino ya registrado genera un link de invitación nuevo para su barrio.
      const { barrio, dispositivo } = body;
      if (!barrio) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Falta barrio' }) };

      // Buscar el nombre del vecino que invita, para que quede trazado en el Panel.
      let creadoPorNombre = null;
      if (dispositivo) {
        try {
          const rLote = await fetch(base + 'lote_registros?select=lote&barrio=eq.' + encodeURIComponent(barrio) + '&dispositivo=eq.' + encodeURIComponent(dispositivo), { headers });
          const filasLote = rLote.ok ? await rLote.json() : [];
          const lote = filasLote && filasLote[0] && filasLote[0].lote;
          if (lote) {
            const rFam = await fetch(base + 'familias?select=nombre&barrio=eq.' + encodeURIComponent(barrio) + '&lote=eq.' + encodeURIComponent(lote), { headers });
            const filasFam = rFam.ok ? await rFam.json() : [];
            if (filasFam && filasFam[0]) creadoPorNombre = filasFam[0].nombre;
          }
        } catch (e) { /* si falla, seguimos sin nombre */ }
      }

      const token = generarToken();
      const rPost = await fetch(base + 'invitaciones', {
        method: 'POST',
        headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
        body: JSON.stringify({ token, barrio, usado: false, creado_por_dispositivo: dispositivo || null, creado_por_nombre: creadoPorNombre, creado_en: new Date().toISOString() }),
      });
      if (!rPost.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rPost.text() }) };
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, token }) };
    }

    if (accion === 'registrarInvitado') {
      // El titular se registra usando un link de invitación. Genera su código de familia (único).
      const { token, nombre, apellido, lote, dispositivo } = body;
      if (!token || !nombre || !lote || !dispositivo) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };
      }
      const loteNorm = String(parseInt(String(lote).trim(), 10));
      if (!loteNorm || loteNorm === 'NaN') {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Lote inválido' }) };
      }

      // 1) Validar que la invitación existe y no fue usada (salvo que sea multiuso)
      const rInv = await fetch(base + 'invitaciones?select=*&token=eq.' + encodeURIComponent(token), { headers });
      if (!rInv.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rInv.text() }) };
      const invFilas = await rInv.json();
      const inv = invFilas && invFilas[0];
      if (!inv) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Invitación no encontrada' }) };
      if (inv.usado && !inv.multiuso) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Esta invitación ya fue usada' }) };

      const barrio = inv.barrio;

      // 2) Generar código de familia único (6 dígitos)
      let codigo = null;
      for (let i = 0; i < 15; i++) {
        const candidato = String(Math.floor(100000 + Math.random() * 900000));
        const rChk = await fetch(base + 'familias?select=id&codigo_familia=eq.' + candidato, { headers });
        const filas = rChk.ok ? await rChk.json() : [];
        if (!filas || !filas.length) { codigo = candidato; break; }
      }
      if (!codigo) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'No se pudo generar el código, probá de nuevo' }) };

      // 3) Crear el registro de familia
      const nombreCompleto = String(nombre).trim() + (apellido ? ' ' + String(apellido).trim() : '');
      const rFam = await fetch(base + 'familias', {
        method: 'POST',
        headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
        body: JSON.stringify({
          barrio, lote: loteNorm, nombre: nombreCompleto,
          codigo_familia: codigo, token_invitacion: token,
          creado_en: new Date().toISOString(),
        }),
      });
      if (!rFam.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rFam.text() }) };

      // 4) Marcar la invitación como usada (solo si NO es multiuso — el multiuso nunca se gasta)
      if (!inv.multiuso) {
        await fetch(base + 'invitaciones?token=eq.' + encodeURIComponent(token), {
          method: 'PATCH', headers, body: JSON.stringify({ usado: true, usado_en: new Date().toISOString() }),
        });
      }

      // 5) Registrar el dispositivo del titular (como cualquier miembro de la familia)
      await fetch(base + 'lote_registros', {
        method: 'POST', headers,
        body: JSON.stringify({ barrio, lote: loteNorm, dispositivo, creado_en: new Date().toISOString() }),
      });

      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, barrio, lote: loteNorm, codigo }) };
    }

    if (accion === 'validarCodigoFamilia') {
      // Un miembro de una familia ya creada ingresa el código de 6 dígitos.
      const { codigo, dispositivo } = body;
      if (!codigo || !dispositivo) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Datos incompletos' }) };

      const rFam = await fetch(base + 'familias?select=*&codigo_familia=eq.' + encodeURIComponent(String(codigo).trim()), { headers });
      if (!rFam.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rFam.text() }) };
      const filas = await rFam.json();
      const fam = filas && filas[0];
      if (!fam) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Código incorrecto' }) };

      const { barrio, lote } = fam;

      const rDisp = await fetch(base + 'lote_registros?select=dispositivo&barrio=eq.' + encodeURIComponent(barrio) + '&lote=eq.' + encodeURIComponent(lote), { headers });
      const existentes = rDisp.ok ? await rDisp.json() : [];
      const yaRegistrado = (existentes || []).some(x => x.dispositivo === dispositivo);

      if (!yaRegistrado) {
        const limite = 12;
        if ((existentes || []).length >= limite) {
          return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'limite', barrio, lote }) };
        }
        await fetch(base + 'lote_registros', {
          method: 'POST', headers,
          body: JSON.stringify({ barrio, lote, dispositivo, creado_en: new Date().toISOString() }),
        });
      }

      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, barrio, lote }) };
    }

    if (accion === 'chequearRecuperacion') {
      // Un dispositivo pregunta si el administrador ya aprobó su pedido de recuperar
      // la edición de una publicación Pro. Si hay alguno aprobado, lo devuelve y lo
      // marca como "aplicado" para no volver a entregarlo de nuevo.
      const { dispositivo } = body;
      if (!dispositivo) return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Falta dispositivo' }) };

      const rGet = await fetch(
        base + 'consultas_acceso?select=*&dispositivo=eq.' + encodeURIComponent(dispositivo) + '&motivo=eq.recuperacion&estado=eq.aprobada',
        { headers }
      );
      if (!rGet.ok) return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: await rGet.text() }) };
      const filas = await rGet.json();

      for (const f of (filas || [])) {
        await fetch(base + 'consultas_acceso?id=eq.' + encodeURIComponent(f.id), {
          method: 'PATCH', headers, body: JSON.stringify({ estado: 'aplicada' }),
        });
      }

      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true, data: filas }) };
    }

    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Acción desconocida' }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ ok: false, error: 'Error de conexión: ' + (e && e.message ? e.message : '') }) };
  }
};

function generarToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let t = '';
  for (let i = 0; i < 12; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}
