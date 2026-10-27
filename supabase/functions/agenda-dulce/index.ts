import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backend de Mi Agenda Dulce: Dino (tutor con IA) y el chat entre mamá y la chica. No hay cuentas: cada familia tiene un
// código largo al azar que la app guarda; acá solo se compara su SHA-256 con dulce_familias. Las tablas no tienen
// políticas RLS, así que solo esta función (service role) las lee y escribe.

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = Deno.env.toObject();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELO = env.DINO_MODELO || "openai/gpt-oss-120b";
const MODELO_VISION = env.DINO_MODELO_VISION || "meta-llama/llama-4-scout-17b-16e-instruct";
const LIMITE_DIARIO = 250;
const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function sha256(texto: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function familiaDe(codigo: unknown) {
  if (typeof codigo !== "string" || codigo.length < 16 || codigo.length > 100) return null;
  const { data } = await db.from("dulce_familias").select("id,nombre,ics_token").eq("codigo_hash", await sha256(codigo)).maybeSingle();
  return data;
}

// Copia de la agenda del colegio que sube la app de la chica, para que mamá la vea en la app y en su calendario.
const lista = (v: unknown, max: number) => Array.isArray(v) ? v.slice(0, max) : [];
const fechaOk = (f: unknown) => typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
function limpiarAgenda(d: any) {
  return {
    tareas: lista(d?.tareas, 300).map((t: any) => ({ id: texto(t.id, 40), titulo: texto(t.titulo, 200), materia: texto(t.materia, 60), fecha: fechaOk(t.fecha), hecha: !!t.hecha })),
    examenes: lista(d?.examenes, 200).map((e: any) => ({ id: texto(e.id, 40), materia: texto(e.materia, 60), tema: texto(e.tema, 200), fecha: fechaOk(e.fecha), nota: typeof e.nota === "number" ? e.nota : null })),
    eventos: lista(d?.eventos, 200).map((e: any) => ({ id: texto(e.id, 40), titulo: texto(e.titulo, 200), fecha: fechaOk(e.fecha), tipo: texto(e.tipo, 20) })),
  };
}
const icsTexto = (t: string) => t.replace(/[\\;,]/g, c => "\\" + c).replace(/\r?\n/g, "\\n");
const masUnDia = (f: string) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
function armarIcs(nombre: string, agenda: any, actualizado: string) {
  const ahora = new Date(actualizado || Date.now()).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev: string[] = [];
  const poner = (id: string, fecha: string | null, titulo: string, alarma: boolean) => {
    if (!fecha) return;
    ev.push("BEGIN:VEVENT", `UID:${id}@agenda-dulce`, `DTSTAMP:${ahora}`, `DTSTART;VALUE=DATE:${fecha.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${masUnDia(fecha)}`, `SUMMARY:${icsTexto(titulo)}`, "TRANSP:TRANSPARENT");
    if (alarma) ev.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsTexto(titulo)}`, "TRIGGER:-PT6H", "END:VALARM");
    ev.push("END:VEVENT");
  };
  for (const t of agenda.tareas ?? []) poner("t-" + t.id, t.fecha, `${t.hecha ? "✅" : "📝"} ${t.materia ? t.materia + ": " : ""}${t.titulo}`, false);
  for (const e of agenda.examenes ?? []) poner("e-" + e.id, e.fecha, `📚 Examen${e.materia ? " de " + e.materia : ""}: ${e.tema}${e.nota != null ? " (nota " + e.nota + ")" : ""}`, e.nota == null);
  for (const e of agenda.eventos ?? []) poner("v-" + e.id, e.fecha, `⭐ ${e.titulo}`, false);
  const nom = icsTexto("Cole de " + (nombre || "Valentina"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mi Agenda Dulce//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${nom}`, "X-WR-TIMEZONE:America/Argentina/Buenos_Aires", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", ...ev, "END:VCALENDAR"]
    .join("\r\n");
}

const SISTEMA = (nombre: string, hoy: string) => `Sos Dino, un dinosaurio verde, simpático y un poco gracioso que vive adentro de la agenda de ${nombre || "una chica"} de 13 años, en Argentina. Hablás en español rioplatense (vos, tenés), con frases cortas, cálidas y algún emoji 🦖 de vez en cuando (no en cada frase). Hoy es ${hoy}.

Cómo ayudás con el colegio — esto es lo más importante:
- Sos un profe particular, NO un solucionador de tareas. Nunca des la respuesta final de un ejercicio, nunca escribas la tarea por ella (redacciones, resúmenes, cuestionarios, traducciones completas) y nunca resuelvas una prueba.
- En su lugar: preguntale qué entendió, explicá el concepto con palabras simples, dá una pista por vez, mostrá un ejemplo PARECIDO con otros números o con otro tema, y pedile que intente el paso siguiente. Cuando te muestre su respuesta, revisala: decile qué está bien y dónde mirar de nuevo, sin corregírselo vos.
- Si insiste con "pasame la respuesta" o "hacémelo", decile con buena onda que así no aprende y que la prueba la va a tener que hacer sola, y ofrecé la próxima pista. Celebrá cada avance.
- Para estudiar para un examen podés hacerle preguntas de práctica, armar un plan de estudio por días o explicarle con trucos para acordarse.
- Si te manda una foto (del pizarrón, una fotocopia, su cuaderno), primero contale qué ves y después ayudala con el mismo criterio.

También la ayudás con su emprendimiento de budines y muffins: precios, ideas de sabores, cómo anotar ventas, cómo calcular ganancias, ideas para vender (sin redes sociales con desconocidos ni dar datos personales). Ahí sí podés dar respuestas completas.

Tenés acceso a su agenda (te la paso abajo). Podés proponer acciones con las herramientas (agregar tarea, examen o evento, o mandarle un mensaje a mamá); ella las confirma con un botón, así que no digas que ya lo hiciste: decí que le dejaste el botón para confirmar. Usá fechas AAAA-MM-DD calculadas a partir de hoy.

Cuidados: es menor de edad. Nada de contenido para adultos, violencia gráfica, dietas o comentarios sobre el cuerpo. Si cuenta algo que la pone triste, que le da miedo, bullying, que alguien le pide fotos o datos, o que se quiere hacer daño, respondé con cariño y animala a hablarlo ya con mamá o un adulto de confianza (en Argentina puede llamar gratis a la Línea 102). No pidas ni guardes datos personales. Si no sabés algo, decilo.

Respondé corto (máximo unas 120 palabras) salvo que te pida una explicación larga.`;

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const HERRAMIENTAS = [
  fn("agregar_tarea", "Propone agregar una tarea del colegio.", { titulo: { type: "string" }, materia: { type: "string", description: "Nombre de la materia tal como aparece en su agenda" }, fecha: { type: "string", description: "AAAA-MM-DD de entrega" } }, ["titulo"]),
  fn("agregar_examen", "Propone agregar un examen.", { materia: { type: "string" }, tema: { type: "string" }, fecha: { type: "string", description: "AAAA-MM-DD" } }, ["tema"]),
  fn("agregar_evento", "Propone agregar un evento al calendario.", { titulo: { type: "string" }, fecha: { type: "string", description: "AAAA-MM-DD" }, tipo: { type: "string", enum: ["cumple", "salida", "cole", "negocio", "otro"] } }, ["titulo", "fecha"]),
  fn("mensaje_a_mama", "Propone mandarle un mensaje a mamá por el chat de la agenda.", { texto: { type: "string" } }, ["texto"]),
];

const texto = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";

async function preguntarDino(familia: { id: string; nombre: string | null }, body: any) {
  const dia = hoyAR();
  const { data: uso } = await db.from("dulce_uso").select("cantidad").eq("familia_id", familia.id).eq("dia", dia).maybeSingle();
  if ((uso?.cantidad ?? 0) >= LIMITE_DIARIO) return { texto: "Uf, hoy ya charlamos un montón y me quedé sin energía 🦖💤. ¡Mañana seguimos!", acciones: [] };
  await db.from("dulce_uso").upsert({ familia_id: familia.id, dia, cantidad: (uso?.cantidad ?? 0) + 1 });
  if (!env.GROQ_API_KEY) return { error: "Falta la clave de la IA" };

  const imagen = typeof body.imagen === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(body.imagen) && body.imagen.length < 4_000_000 ? body.imagen : null;
  const historial = (Array.isArray(body.historial) ? body.historial : []).slice(-16)
    .filter((m: any) => (m?.rol === "user" || m?.rol === "assistant") && typeof m.texto === "string")
    .map((m: any) => ({ role: m.rol, content: m.texto.slice(0, 3000) }));
  const pregunta = texto(body.mensaje, 4000) || (imagen ? "Mirá esta foto." : "");
  if (!pregunta) return { error: "Mensaje vacío" };

  const messages = [
    { role: "system", content: SISTEMA(texto(body.nombre, 40) || familia.nombre || "", dia) },
    { role: "system", content: "Su agenda ahora:\n" + texto(body.contexto, 6000) },
    ...historial,
    { role: "user", content: imagen ? [{ type: "text", text: pregunta }, { type: "image_url", image_url: { url: imagen } }] : pregunta },
  ];
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(imagen
      ? { model: MODELO_VISION, messages, temperature: 0.5, max_tokens: 900 }
      : { model: MODELO, messages, temperature: 0.5, max_tokens: 1500, tools: HERRAMIENTAS, tool_choice: "auto" }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    console.error("agenda-dulce IA", r.status, JSON.stringify(data).slice(0, 400));
    return { error: r.status === 429 ? "ocupado" : "ia", detalle: r.status };
  }
  const m = data?.choices?.[0]?.message ?? {};
  const acciones = (m.tool_calls ?? []).map((t: any) => {
    try { return { ...JSON.parse(t.function.arguments || "{}"), accion: t.function.name }; } catch { return null; }
  }).filter(Boolean);
  return { texto: String(m.content ?? "").trim(), acciones };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("ics") || "";
    if (!/^[a-f0-9]{32}$/.test(token)) return new Response("No encontrado", { status: 404 });
    const { data: f } = await db.from("dulce_familias").select("id,nombre").eq("ics_token", token).maybeSingle();
    if (!f) return new Response("No encontrado", { status: 404 });
    const { data: a } = await db.from("dulce_agenda").select("datos,actualizado").eq("familia_id", f.id).maybeSingle();
    return new Response(armarIcs(f.nombre ?? "", a?.datos ?? {}, a?.actualizado), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = await req.json().catch(() => ({}));
  const familia = await familiaDe(body.codigo);
  if (!familia) return json({ error: "codigo" }, 401);

  try {
    switch (body.accion) {
      case "hola":
        return json({ ok: true, nombre: familia.nombre });
      case "mensajes": {
        const desde = Number(body.desde) || 0;
        let q = db.from("dulce_mensajes").select("id,de,texto,leido,creado").eq("familia_id", familia.id);
        q = desde ? q.gt("id", desde).order("id").limit(200) : q.order("id", { ascending: false }).limit(150);
        const { data, error } = await q;
        if (error) throw error;
        return json({ mensajes: desde ? data : (data ?? []).reverse() });
      }
      case "enviar": {
        const de = body.de === "mama" ? "mama" : "chica";
        const t = texto(body.texto, 2000).trim();
        if (!t) return json({ error: "Mensaje vacío" }, 400);
        const { data, error } = await db.from("dulce_mensajes").insert({ familia_id: familia.id, de, texto: t }).select("id,de,texto,leido,creado").single();
        if (error) throw error;
        return json({ mensaje: data });
      }
      case "leidos": {
        const lector = body.de === "mama" ? "mama" : "chica";
        await db.from("dulce_mensajes").update({ leido: true }).eq("familia_id", familia.id).neq("de", lector).eq("leido", false);
        return json({ ok: true });
      }
      case "sincronizar": {
        const { error } = await db.from("dulce_agenda").upsert({ familia_id: familia.id, datos: limpiarAgenda(body.datos), actualizado: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }
      case "agenda": {
        const { data } = await db.from("dulce_agenda").select("datos,actualizado").eq("familia_id", familia.id).maybeSingle();
        return json({ agenda: data?.datos ?? null, actualizado: data?.actualizado ?? null, ics: `${env.SUPABASE_URL}/functions/v1/agenda-dulce?ics=${familia.ics_token}` });
      }
      case "dino":
        return json(await preguntarDino(familia, body));
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    console.error("agenda-dulce", e);
    return json({ error: "servidor" }, 500);
  }
});
