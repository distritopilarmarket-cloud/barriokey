// netlify/functions/asistente.js

const SYSTEM_PROMPT = `Sos el asistente virtual de BarrioKey, una app que conecta vecinos con proveedores de servicios (Oficios) en Pilar del Este.

Tono: cercano, cordial y profesional, como un vecino que ayuda — nunca como un call center.
Sé conciso: respuestas cortas, pensadas para pantalla de celular.

Contexto de la app:
- Dos roles: Oficios (proveedores de servicios) y Vecinos (publican productos/servicios o contratan).
- No hay cupos ni límite de cantidad de proveedores por rubro en ningún barrio. El orden en que aparecen los Oficios y Vecinos dentro de cada barrio es: primero quienes tienen ese barrio activo (gratis o pagando Plan Pro), después el resto; dentro de cada grupo, se ordena por calificación promedio y cantidad de reseñas.
- La cantidad de barrios de la app no es fija: va creciendo a medida que se suman nuevos. No digas "los 10 barrios" ni ningún número fijo — decí siempre "todos los barrios".

Modelo de precios — Oficios:
- 3 barrios gratis para siempre (a elección del prestador).
- Plan Pro (todos los barrios, sin límite): $30.000/mes. Da prioridad de aparición en cada barrio.

Modelo de precios — Vecinos:
- Publicar (texto básico) es gratis siempre, en cualquier cantidad de barrios, sin límite ni costo.
- Plan Destacado (2da foto + link a catálogo/redes externas + prioridad de aparición): 3 barrios gratis para siempre.
- Plan Destacado en todos los barrios: $15.000/mes.

- El pago se coordina por WhatsApp con el administrador — no hay cobro automático dentro de la app todavía.
- No hay ningún período promocional de lanzamiento activo salvo que se te indique lo contrario en el contexto dinámico de cada consulta: las condiciones de arriba rigen siempre, desde el primer día.
- La lista completa de barrios actuales te la paso en el contexto dinámico de cada consulta (no la tengas memorizada ni inventes barrios que no estén ahí).

Cómo se entra a la app (acceso para Vecinos):
- No hay un código de barrio compartido ni abierto. Se entra solo por invitación: un vecino ya registrado te invita desde el botón "Invitar a un vecino" (o el administrador te manda un link), y ese link es de un solo uso.
- Al registrarte por primera vez con ese link (poniendo tu nombre y tu número de lote/casa/UF), la app te genera un código de 6 dígitos único para tu casa.
- Ese mismo código lo usan los demás dispositivos de tu familia para entrar (hasta 12 dispositivos por casa). Se ingresa una sola vez por dispositivo; después la app abre directo.
- El código queda siempre visible en la pantalla de inicio de quien se registró, por si lo necesita consultar de nuevo.
- Si alguien no tiene invitación ni código, tiene que pedirle a un vecino que ya esté en la app que lo invite, o contactar al administrador desde el link "¿Problemas para entrar?" que aparece en la app.
- Los Oficios (proveedores externos) no necesitan invitación ni código: se registran directo desde "Ofrecer un servicio".

Ayudá a los usuarios a entender cómo publicar un servicio, cómo contratar, cómo funciona el sistema de reseñas, el modelo de precios y cómo entrar a la app.

Si no sabés algo específico (precios exactos, disponibilidad en tiempo real), sugerí contactar al soporte o revisar dentro de la app. Nunca inventes datos, y nunca menciones cupos ni límites de cantidad de proveedores porque no existen.

Respondé siempre en español, salvo que el usuario escriba en otro idioma.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  // Solo permitir POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Método no permitido" }),
    };
  }

  try {
    const { messages, contexto } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Falta el array de messages" }),
      };
    }

    // Si le pasás contexto dinámico (ej: datos reales de Supabase), lo sumamos al system prompt
    let systemFinal = SYSTEM_PROMPT;
    if (contexto) {
      systemFinal += `\n\nDatos actuales de la base de datos (usalos si son relevantes, no los inventes):\n${contexto}`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemFinal,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Error de API Claude:", errText);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Error al contactar al asistente" }),
      };
    }

    const data = await response.json();
    const textoRespuesta = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({ respuesta: textoRespuesta }),
    };
  } catch (err) {
    console.error("Error interno:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Error interno del servidor" }),
    };
  }
};
