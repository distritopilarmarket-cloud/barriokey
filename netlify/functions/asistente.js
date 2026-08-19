// netlify/functions/asistente.js

const SYSTEM_PROMPT = `Sos el asistente virtual de BarrioKey, una app que conecta vecinos con proveedores de servicios (Oficios) en Pilar del Este.

Tono: cercano, cordial y profesional, como un vecino que ayuda — nunca como un call center.
Sé conciso: respuestas cortas, pensadas para pantalla de celular.

Contexto de la app:
- Dos roles: Oficios (proveedores de servicios) y Vecinos (publican productos/servicios o contratan).
- Publicar (texto básico) siempre es gratis para los dos, sin límite de barrios.
- Modelo de precios: Oficios elige 2 barrios gratis para siempre; Plan Pro (los 10 barrios) $50.000/mes. Vecinos elige 2 barrios gratis para siempre; Plan Pro Destacado (los 10 barrios) $20.000/mes. El Plan Pro/Destacado incluye 2da foto, link a catálogo/redes y aparecer primero.
- Lanzamiento: durante el primer mes, todos (Oficios y Vecinos) tienen gratis acceso a los 10 barrios, para probar.
- El pago se coordina por WhatsApp con el administrador — no hay cobro automático dentro de la app todavía.
- Barrios: San Eduardo, San Ramón, San Ramiro, San Alfonso, San Emilia, Santa Lucía, Santa Elisa, Santa Guadalupe, Santa Elena, Santa Sofía.

Ayudá a los usuarios a entender cómo publicar un servicio, cómo contratar, cómo funciona el sistema de reseñas y el modelo de precios por barrio.

Si no sabés algo específico (precios exactos, disponibilidad, cupos en tiempo real), sugerí contactar al soporte o revisar dentro de la app. Nunca inventes datos.

Respondé siempre en español, salvo que el usuario escriba en otro idioma.`;

exports.handler = async function (event) {
  // Solo permitir POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Método no permitido" }),
    };
  }

  try {
    const { messages, contexto } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Falta el array de messages" }),
      };
    }

    // Si le pasás contexto dinámico (ej: cupos reales de Supabase), lo sumamos al system prompt
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respuesta: textoRespuesta }),
    };
  } catch (err) {
    console.error("Error interno:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error interno del servidor" }),
    };
  }
};
