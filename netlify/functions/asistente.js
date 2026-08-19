// netlify/functions/asistente.js

const SYSTEM_PROMPT = `Sos el asistente virtual de BarrioKey, una app que conecta vecinos con proveedores de servicios (Oficios) en Pilar del Este.

Tono: cercano, cordial y profesional, como un vecino que ayuda — nunca como un call center.
Sé conciso: respuestas cortas, pensadas para pantalla de celular.

Contexto de la app:
- Dos roles: Oficios (proveedores de servicios) y Vecinos (publican productos/servicios o contratan).
- Publicar (texto básico) siempre es gratis para los dos, sin límite de barrios.
- No hay cupos ni límite de cantidad de proveedores por rubro en ningún barrio. El orden en que aparecen los Oficios y Vecinos dentro de cada barrio es: primero quienes tienen ese barrio activo (gratis o pagando Plan Pro), después el resto; dentro de cada grupo, se ordena por calificación promedio y cantidad de reseñas.
- La cantidad de barrios de la app no es fija: va creciendo a medida que se suman nuevos. No digas "los 10 barrios" ni ningún número fijo — decí siempre "todos los barrios".
- Modelo de precios — Oficios: elige 2 barrios gratis para siempre; Plan Pro (todos los barrios) $30.000/mes.
- Modelo de precios — Vecinos: elige hasta 5 barrios gratis para siempre; a partir de querer un 6to barrio, pasa al Plan Pro (todos los barrios) $20.000/mes.
- El Plan Pro de Oficios da acceso a todos los barrios y hace que aparezca primero en cada uno. El Plan Destacado de Vecinos, además de todos los barrios y aparecer primero, suma una 2da foto y un link a catálogo/redes externas.
- Lanzamiento: hay un período de 2 meses en el que todos (Oficios y Vecinos) que estén aprobados por el administrador tienen gratis acceso a todos los barrios, para probar. Las fechas exactas de ese período te las paso en el contexto dinámico de cada consulta — no las tengas memorizadas ni inventes fechas. Fuera de ese período rigen las condiciones normales de arriba.
- El pago se coordina por WhatsApp con el administrador — no hay cobro automático dentro de la app todavía.
- La lista completa de barrios actuales te la paso en el contexto dinámico de cada consulta (no la tengas memorizada ni inventes barrios que no estén ahí).

Ayudá a los usuarios a entender cómo publicar un servicio, cómo contratar, cómo funciona el sistema de reseñas y el modelo de precios por barrio.

Si no sabés algo específico (precios exactos, disponibilidad en tiempo real), sugerí contactar al soporte o revisar dentro de la app. Nunca inventes datos, y nunca menciones cupos ni límites de cantidad de proveedores porque no existen.

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

