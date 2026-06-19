import express from "express";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";
import cron from "node-cron";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const app = express();
app.use(express.json());

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Panel CRM ────────────────────────────────────────────────────────────────
app.use("/panel", express.static(join(__dirname, "public", "panel")));

// ─── Clients ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Constants ────────────────────────────────────────────────────────────────
const WA_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const TENANT_ID = process.env.TENANT_ID; // UUID del tenant Feeling Vilanova
const CRM_SECRET = process.env.CRM_SECRET_KEY;

if (!TENANT_ID) {
  console.error("ERROR: TENANT_ID no configurado (debe ser el UUID del tenant en Supabase)");
  process.exit(1);
}

// ─── System Prompt Base ───────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `
Eres Gregory, el asistente virtual de Feeling Vilanova Grand Marina, el pub-restaurante con la terraza musical más bonita de Vilanova i la Geltrú, con vistas al Puerto Gran Marina y al Mediterráneo.

DATOS DEL LOCAL:
- Nombre: Feeling Vilanova Grand Marina
- Descripción: Taberna de ambiente irlandés con terraza musical y vistas al mar, abierto 365 días
- Dirección: Moll de Ponent 3-4, Rambla del Port de Grand Marina, 08800 Vilanova i la Geltrú, Barcelona
- Teléfono: (+34) 938 15 79 87 / (+34) 606 16 20 11
- Email: info@feelingvilanova.com
- Web: www.feelingvilanova.com
- Instagram: @feelingvilanova (agenda de eventos y DJ actualizada cada semana)

HORARIOS (abierto los 365 días del año):
- Domingo a Jueves: 09:00 – 02:30
- Viernes, Sábados y vísperas de festivos: 09:00 – 03:00

CARTA COMPLETA:
Para picar: Patatas bravas 7€ | Croquetas 7€ | Nachos guacamole 8€ | Nachos pulled pork 9€ | Huevos estrellados jamón ibérico 9,20€ | Pinchos morunos | Tabla de quesos | Tabla jamón y pinchos.
Hamburguesas tradicionales: Básico 6,50€ | Con queso 7€ | Con bacon 7,20€ | Bacon & queso 7,50€.
Hamburguesas premium: Feeling 11,50€ | Mexicana 11,50€ | Champi 12€ | Golden 11,20€ | Ibérica 12,90€ | Pulled Pork 12,20€ | Chicken Club 11,90€ | Vegi 12,90€.
Burri Burger (burritos): Atún vegetal 9€ | Pollo crispy 10,50€ | Pulled pork 10,50€ | Mexicano 11€.
Frankfurts: desde 5,20€. Sándwiches: desde 6,90€.
Carnes: Entrecot a la plancha 12,50€ | Costillas ribs 14,50€ | Secreto ibérico confitado 13,50€ | Pollo estilo Kentucky 11,50€.
Ensaladas: De la casa 6,90€ | César 7,50€ | Queso de cabra 7,50€.
Pescado: Salmón a la plancha 13,90€ | Bacalao confitado 14,50€.
Menú del Día (lun–sáb): 4 pasos + pan + bebida — 17,90€. Medio menú: 11,80€.
Menú de Grupos: consultar disponibilidad llamando al local.

SERVICIOS Y AMBIENTE:
- Desayunos y brunch desde las 09:00
- Vermut los fines de semana
- Comidas, cenas y copas toda la semana
- Cócteles y combinados (carta disponible en el local)
- DJ en directo: viernes, sábados, domingos y vísperas de festivos
- Pedidos a domicilio disponibles
- Eventos privados y menús para grupos (requiere reserva y consulta previa)
- Club Feeling VIP con tarjeta de fidelización
- Terraza musical con vistas al mar y al puerto
- WiFi gratuito

PROMOCIONES SEMANALES:
- Martes: 2x1 en hamburguesas
- Gin&tonic por 5€

INSTRUCCIONES:
1. Responde SIEMPRE en el idioma del cliente (castellano, catalán o inglés principalmente)
2. Mensajes cortos y cálidos, máximo 3 párrafos
3. Usa emojis con moderación, transmite ambiente mediterráneo y acogedor
4. Para eventos, agenda de DJ o novedades, remite siempre a @feelingvilanova en Instagram
5. Para anotar una reserva necesitas: nombre completo, fecha, hora y número de comensales
6. NUNCA digas que la reserva está confirmada — di SIEMPRE: "¡Perfecto! En breve te confirmaremos tu reserva 😊"
7. No inventes información que no esté en estos datos; si no lo sabes, invita a llamar al local
8. Para grupos o eventos privados, indica que el equipo les contactará para personalizar

CATEGORIZA cada consulta al inicio de tu respuesta con uno de estos tags (será eliminado antes de enviarse al cliente):
[FAQ:horario] [FAQ:menu] [FAQ:precio] [FAQ:reserva] [FAQ:eventos] [FAQ:ubicacion] [FAQ:bebidas] [FAQ:grupos] [FAQ:domicilio] [FAQ:otro]

GESTIÓN DE RESERVAS — coloca el tag ANTES de tu respuesta amigable:
- Anotar: [ACTION:CREATE_RESERVATION] {"client_name":"...","date":"YYYY-MM-DD","time":"HH:MM","num_guests":N,"service":"...","notes":"..."}
- Modificar: [ACTION:MODIFY_RESERVATION] {"reservation_id":"...","date":"...","time":"...","num_guests":N,"notes":"..."}
- Cancelar: [ACTION:CANCEL_RESERVATION] {"reservation_id":"..."}
- Ver reservas: [ACTION:GET_RESERVATIONS] {}
- Escalar: [ACTION:ESCALATE] {"reason":"..."}
`.trim();

// ─── Agent Settings Cache ─────────────────────────────────────────────────────
let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_TTL = 5 * 60 * 1000;

async function getAgentSettings() {
  if (_settingsCache && Date.now() - _settingsCacheAt < SETTINGS_TTL) return _settingsCache;
  const { data } = await supabase
    .from("agent_settings")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .maybeSingle();
  _settingsCache = data || { agent_name: "Gregory", tone: "amigable, profesional y cálido", extra_context: "", avatar_url: "" };
  _settingsCacheAt = Date.now();
  return _settingsCache;
}

async function buildSystemPrompt() {
  const s = await getAgentSettings();
  let prompt = BASE_SYSTEM_PROMPT.replace(
    "Eres Gregory, el asistente virtual",
    `Eres ${s.agent_name}, el asistente virtual`
  );
  if (s.tone) {
    prompt = prompt.replace(
      "Mensajes cortos y cálidos, máximo 3 párrafos",
      `Mensajes cortos y ${s.tone}, máximo 3 párrafos`
    );
  }
  if (s.extra_context) {
    prompt += `\n\nINFORMACIÓN ADICIONAL DEL NEGOCIO:\n${s.extra_context}`;
  }
  return prompt;
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendWAMessage(to, text) {
  const res = await fetch(WA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) console.error("WA error:", await res.json());
}

// ─── Sesiones ─────────────────────────────────────────────────────────────────
async function upsertSession(phone, updates = {}) {
  const { error } = await supabase.from("chat_sessions").upsert(
    {
      tenant_id: TENANT_ID,
      phone_number: phone,
      last_message: new Date().toISOString(),
      ...updates,
    },
    { onConflict: "tenant_id,phone_number" }
  );
  if (error) console.error(`[upsertSession] ERROR phone=${phone}:`, JSON.stringify(error));
}

async function getSession(phone) {
  const { data } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone)
    .single();
  return data;
}

// ─── Historial ────────────────────────────────────────────────────────────────
async function getHistory(phone) {
  const { data } = await supabase
    .from("conversation_memory")
    .select("role, content")
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone)
    .order("created_at", { ascending: true })
    .limit(20);
  // Los mensajes del admin no se pasan al modelo
  return (data || []).filter((m) => m.role !== "admin");
}

async function saveMessage(phone, role, content) {
  const { error } = await supabase.from("conversation_memory").insert({
    tenant_id: TENANT_ID,
    phone_number: phone,
    role,
    content,
  });
  if (error) console.error(`[saveMessage] ERROR phone=${phone} role=${role}:`, JSON.stringify(error));
}

async function upsertClient(phone, name) {
  await supabase.from("clients").upsert(
    {
      tenant_id: TENANT_ID,
      phone_number: phone,
      ...(name && { name }),
      last_contact: new Date().toISOString(),
    },
    { onConflict: "tenant_id,phone_number" }
  );
}

// ─── Reservas ─────────────────────────────────────────────────────────────────
async function createReservation(phone, p) {
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      tenant_id: TENANT_ID,
      phone_number: phone,
      client_name: p.client_name,
      date: p.date,
      time: p.time,
      num_guests: p.num_guests || 1,
      service: p.service || "Reserva",
      status: "pending_confirmation",
      notes: p.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function modifyReservation(id, p) {
  const updates = {};
  if (p.date) updates.date = p.date;
  if (p.time) updates.time = p.time;
  if (p.num_guests) updates.num_guests = p.num_guests;
  if (p.service) updates.service = p.service;
  if (p.notes !== undefined) updates.notes = p.notes;
  const { error } = await supabase
    .from("reservations")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", TENANT_ID);
  if (error) throw error;
}

async function cancelReservation(id) {
  await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("tenant_id", TENANT_ID);
}

async function getReservations(phone) {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("reservations")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone)
    .in("status", ["pending_confirmation", "confirmed"])
    .gte("date", today)
    .order("date", { ascending: true });
  return data || [];
}

// ─── FAQ Logging ──────────────────────────────────────────────────────────────
async function logFAQ(phone, question, category) {
  await supabase.from("faq_log").insert({
    tenant_id: TENANT_ID,
    phone_number: phone,
    question: question.substring(0, 500),
    category: category || "otro",
  });
}

// ─── Action Executor ──────────────────────────────────────────────────────────
async function executeActions(aiText, phone, userText) {
  const actionRegex = /\[ACTION:(\w+)\]\s*(\{[^}]*\})?/g;
  const faqRegex = /\[FAQ:(\w+)\]/;
  let match;
  let clean = aiText;

  const faqMatch = faqRegex.exec(aiText);
  if (faqMatch) {
    await logFAQ(phone, userText, faqMatch[1]);
    clean = clean.replace(faqMatch[0], "").trim();
  }

  while ((match = actionRegex.exec(aiText)) !== null) {
    const action = match[1];
    let params = {};
    try { params = match[2] ? JSON.parse(match[2]) : {}; } catch {}
    clean = clean.replace(match[0], "").trim();

    try {
      switch (action) {
        case "CREATE_RESERVATION": {
          await createReservation(phone, params);
          await upsertClient(phone, params.client_name);
          // Marcar sesión como pendiente → alerta amarilla en el CRM
          await upsertSession(phone, {
            client_name: params.client_name,
            status: "needs_confirmation",
          });
          console.log(`Reserva pendiente — ${params.client_name} (${phone})`);
          break;
        }
        case "MODIFY_RESERVATION":
          await modifyReservation(params.reservation_id, params);
          break;
        case "CANCEL_RESERVATION":
          await cancelReservation(params.reservation_id);
          break;
        case "GET_RESERVATIONS": {
          const list = await getReservations(phone);
          if (list.length > 0) {
            const formatted = list
              .map(
                (r) =>
                  `• ${r.date} a las ${r.time} — ${r.num_guests} pers. — ${r.service} (ID: ${r.id}) [${r.status === "pending_confirmation" ? "pendiente de confirmar" : "confirmada"}]`
              )
              .join("\n");
            clean += `\n\nTus reservas:\n${formatted}`;
          }
          break;
        }
        case "ESCALATE":
          await supabase.from("escalations").insert({
            tenant_id: TENANT_ID,
            phone_number: phone,
            reason: params.reason,
            status: "pending",
          });
          await upsertSession(phone, { status: "admin_mode" });
          if (process.env.OWNER_PHONE) {
            await sendWAMessage(
              process.env.OWNER_PHONE,
              `⚠️ Escalamiento — Gregory\nCliente: ${phone}\nMotivo: ${params.reason}`
            );
          }
          break;
      }
    } catch (err) {
      console.error(`Action ${action} error:`, err.message);
    }
  }

  return clean.trim();
}

// ─── Core Handler ─────────────────────────────────────────────────────────────
async function handleMessage(phone, text) {
  const session = await getSession(phone);

  // Admin intercediendo → guardar mensaje pero no responder con IA
  if (session?.status === "admin_mode") {
    await saveMessage(phone, "user", text);
    await supabase
      .from("chat_sessions")
      .update({
        last_message: new Date().toISOString(),
        unread_count: (session.unread_count || 0) + 1,
      })
      .eq("tenant_id", TENANT_ID)
      .eq("phone_number", phone);
    console.log(`[ADMIN MODE] Mensaje guardado sin respuesta IA — ${phone}`);
    return;
  }

  await saveMessage(phone, "user", text);
  await upsertSession(phone);

  const history = await getHistory(phone);

  const systemPrompt = await buildSystemPrompt();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [...history, { role: "user", content: text }],
  });

  const aiText = response.content[0].text;
  const finalText = await executeActions(aiText, phone, text);

  await saveMessage(phone, "assistant", finalText);
  await sendWAMessage(phone, finalText);
}

// ─── CRM Auth ─────────────────────────────────────────────────────────────────
function crmAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!CRM_SECRET || token !== CRM_SECRET) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// ─── CRM: Sesiones ────────────────────────────────────────────────────────────
app.get("/crm/sessions", crmAuth, async (req, res) => {
  const { status, limit = 100 } = req.query;
  let query = supabase
    .from("chat_sessions")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .order("last_message", { ascending: false })
    .limit(parseInt(limit));
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/crm/session/:phone", crmAuth, async (req, res) => {
  const { phone } = req.params;
  const [sessionRes, historyRes, reservationsRes] = await Promise.all([
    supabase.from("chat_sessions").select("*").eq("tenant_id", TENANT_ID).eq("phone_number", phone).single(),
    supabase.from("conversation_memory").select("*").eq("tenant_id", TENANT_ID).eq("phone_number", phone).order("created_at", { ascending: true }),
    supabase.from("reservations").select("*").eq("tenant_id", TENANT_ID).eq("phone_number", phone).order("created_at", { ascending: false }),
  ]);
  res.json({
    session: sessionRes.data,
    history: historyRes.data || [],
    reservations: reservationsRes.data || [],
  });
});

app.post("/crm/session/:phone/intervene", crmAuth, async (req, res) => {
  const { phone } = req.params;
  const { error } = await supabase
    .from("chat_sessions")
    .update({ status: "admin_mode", unread_count: 0 })
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/crm/session/:phone/release", crmAuth, async (req, res) => {
  const { phone } = req.params;
  const { error } = await supabase
    .from("chat_sessions")
    .update({ status: "active", unread_count: 0 })
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/crm/message", crmAuth, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "Faltan campos: phone, message" });
  await sendWAMessage(phone, message);
  await saveMessage(phone, "admin", message);
  await supabase
    .from("chat_sessions")
    .update({ last_message: new Date().toISOString(), unread_count: 0 })
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", phone);
  res.json({ ok: true });
});

// ─── CRM: Reservas ────────────────────────────────────────────────────────────
app.get("/crm/reservations", crmAuth, async (req, res) => {
  const { status, date_from, date_to, limit = 100 } = req.query;
  let query = supabase
    .from("reservations")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .order("date", { ascending: true })
    .order("time", { ascending: true })
    .limit(parseInt(limit));
  if (status) query = query.eq("status", status);
  if (date_from) query = query.gte("date", date_from);
  if (date_to) query = query.lte("date", date_to);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin confirma la reserva — envía WA al cliente y libera la sesión
app.put("/crm/reservation/:id/confirm", crmAuth, async (req, res) => {
  const { id } = req.params;
  const { custom_message } = req.body;

  const { data: reservation, error } = await supabase
    .from("reservations")
    .update({ status: "confirmed" })
    .eq("id", id)
    .eq("tenant_id", TENANT_ID)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const waMsg =
    custom_message ||
    `✅ ¡Hola ${reservation.client_name}! Tu reserva en Feeling Vilanova está confirmada 🎉\n\n📅 ${reservation.date} a las ${reservation.time?.substring(0, 5)}\n👥 ${reservation.num_guests} persona${reservation.num_guests > 1 ? "s" : ""}\n🍽️ ${reservation.service}\n\n¡Te esperamos! 🌊`;

  await sendWAMessage(reservation.phone_number, waMsg);
  await saveMessage(reservation.phone_number, "admin", waMsg);

  // Liberar la sesión de vuelta al agente IA
  await supabase
    .from("chat_sessions")
    .update({ status: "active", last_message: new Date().toISOString(), unread_count: 0 })
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", reservation.phone_number);

  res.json({ ok: true, reservation });
});

// Admin anula la reserva — la ELIMINA de la base de datos y notifica al cliente
app.put("/crm/reservation/:id/cancel", crmAuth, async (req, res) => {
  const { id } = req.params;
  const { custom_message } = req.body;

  // Obtener datos antes de eliminar
  const { data: reservation, error: fetchError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", TENANT_ID)
    .single();

  if (fetchError || !reservation) return res.status(404).json({ error: "Reserva no encontrada" });

  // Notificar al cliente por WhatsApp
  const waMsg =
    custom_message ||
    `Hola ${reservation.client_name}, lamentablemente no hemos podido confirmar tu reserva para el ${reservation.date} a las ${reservation.time?.substring(0, 5)}. Para más información llámanos al 606 16 20 11. ¡Hasta pronto! 🙏`;

  await sendWAMessage(reservation.phone_number, waMsg);
  await saveMessage(reservation.phone_number, "admin", waMsg);

  // ELIMINAR la reserva de la base de datos
  await supabase
    .from("reservations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", TENANT_ID);

  // Liberar la sesión
  await supabase
    .from("chat_sessions")
    .update({ status: "active", last_message: new Date().toISOString(), unread_count: 0 })
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", reservation.phone_number);

  res.json({ ok: true });
});

// ─── CRM: Analytics ───────────────────────────────────────────────────────────
app.get("/crm/analytics/faq", crmAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("faq_log")
    .select("category, question")
    .eq("tenant_id", TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return res.status(500).json({ error: error.message });

  const counts = {};
  for (const row of data || []) {
    counts[row.category] = (counts[row.category] || 0) + 1;
  }
  const breakdown = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([category, count]) => ({ category, count }));

  res.json({ total: data?.length || 0, breakdown });
});

app.get("/crm/analytics/reservations", crmAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("reservations")
    .select("status, date, num_guests, service")
    .eq("tenant_id", TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  const byStatus = {};
  const byService = {};
  let totalGuests = 0;

  for (const r of data || []) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byService[r.service] = (byService[r.service] || 0) + 1;
    totalGuests += r.num_guests || 0;
  }

  res.json({ total: data?.length || 0, byStatus, byService, totalGuests });
});

// ─── CRM: Editar reserva ─────────────────────────────────────────────────────
app.put("/crm/reservation/:id/edit", crmAuth, async (req, res) => {
  const { id } = req.params;
  const { date, time, num_guests, service, notes } = req.body;
  const updates = {};
  if (date !== undefined) updates.date = date;
  if (time !== undefined) updates.time = time;
  if (num_guests !== undefined) updates.num_guests = parseInt(num_guests);
  if (service !== undefined) updates.service = service;
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabase
    .from("reservations")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", TENANT_ID)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── CRM: Agent Settings ─────────────────────────────────────────────────────
app.get("/crm/settings", crmAuth, async (req, res) => {
  const s = await getAgentSettings();
  res.json(s);
});

app.put("/crm/settings", crmAuth, async (req, res) => {
  const { agent_name, tone, extra_context, avatar_url } = req.body;
  const payload = { tenant_id: TENANT_ID, updated_at: new Date().toISOString() };
  if (agent_name !== undefined) payload.agent_name = agent_name;
  if (tone !== undefined) payload.tone = tone;
  if (extra_context !== undefined) payload.extra_context = extra_context;
  if (avatar_url !== undefined) payload.avatar_url = avatar_url;

  const { data, error } = await supabase
    .from("agent_settings")
    .upsert(payload, { onConflict: "tenant_id" })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  _settingsCache = null; // invalidar caché
  res.json(data);
});

// ─── CRM: Overview (tab Principal) ───────────────────────────────────────────
app.get("/crm/analytics/overview", crmAuth, async (req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  const [sessRes, resRes, cliRes, faqRes] = await Promise.all([
    supabase.from("chat_sessions").select("status").eq("tenant_id", TENANT_ID),
    supabase.from("reservations").select("status, num_guests, created_at").eq("tenant_id", TENANT_ID),
    supabase.from("clients").select("created_at").eq("tenant_id", TENANT_ID),
    supabase.from("faq_log").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID),
  ]);

  const sessions = sessRes.data || [];
  const reservations = resRes.data || [];
  const clients = cliRes.data || [];
  const mISO = monthStart.toISOString();

  const monthRes = reservations.filter(r => r.created_at >= mISO);
  const monthCli = clients.filter(c => c.created_at >= mISO);

  res.json({
    totalChats: sessions.length,
    activeChats: sessions.filter(s => s.status === "active").length,
    pendingConfirmation: sessions.filter(s => s.status === "needs_confirmation").length,
    adminMode: sessions.filter(s => s.status === "admin_mode").length,
    totalReservations: reservations.length,
    confirmedThisMonth: monthRes.filter(r => r.status === "confirmed").length,
    pendingThisMonth: monthRes.filter(r => r.status === "pending_confirmation").length,
    totalGuests: reservations.reduce((s, r) => s + (r.num_guests || 0), 0),
    totalClients: clients.length,
    newClientsThisMonth: monthCli.length,
    totalFAQ: faqRes.count || 0,
  });
});

// ─── CRM: Metrics (tab Métricas) ──────────────────────────────────────────────
app.get("/crm/analytics/metrics", crmAuth, async (req, res) => {
  const { period = "month" } = req.query;
  const now = new Date();
  let dateFrom;

  if (period === "week") {
    dateFrom = new Date(now); dateFrom.setDate(now.getDate() - 7);
  } else if (period === "6months") {
    dateFrom = new Date(now); dateFrom.setMonth(now.getMonth() - 6);
  } else {
    dateFrom = new Date(now); dateFrom.setDate(now.getDate() - 30);
  }

  const [resData, faqData, cliData] = await Promise.all([
    supabase.from("reservations").select("*").eq("tenant_id", TENANT_ID).gte("created_at", dateFrom.toISOString()),
    supabase.from("faq_log").select("category").eq("tenant_id", TENANT_ID).gte("created_at", dateFrom.toISOString()),
    supabase.from("clients").select("phone_number, name, created_at").eq("tenant_id", TENANT_ID),
  ]);

  const reservations = resData.data || [];
  const clients = cliData.data || [];

  // Agrupar reservas por bucket temporal
  const buckets = {};
  for (const r of reservations) {
    const d = new Date(r.created_at);
    let key;
    if (period === "week") key = d.toISOString().split("T")[0];
    else if (period === "6months") key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    else {
      const ws = new Date(d); ws.setDate(d.getDate() - d.getDay()); key = ws.toISOString().split("T")[0];
    }
    if (!buckets[key]) buckets[key] = { confirmed: 0, pending: 0, cancelled: 0, guests: 0 };
    if (r.status === "confirmed") buckets[key].confirmed++;
    else if (r.status === "pending_confirmation") buckets[key].pending++;
    else buckets[key].cancelled++;
    buckets[key].guests += r.num_guests || 0;
  }

  // Clientes frecuentes (con más de 1 reserva)
  const allResByPhone = {};
  const { data: allRes } = await supabase.from("reservations").select("phone_number, client_name").eq("tenant_id", TENANT_ID);
  for (const r of allRes || []) allResByPhone[r.phone_number] = (allResByPhone[r.phone_number] || 0) + 1;
  const frequentClients = clients
    .filter(c => (allResByPhone[c.phone_number] || 0) > 1)
    .map(c => ({ name: c.name, phone: c.phone_number, reservations: allResByPhone[c.phone_number] || 0 }))
    .sort((a, b) => b.reservations - a.reservations)
    .slice(0, 10);

  // Breakdown por servicio
  const byService = {};
  for (const r of reservations) byService[r.service || "Otros"] = (byService[r.service || "Otros"] || 0) + 1;

  // FAQ breakdown
  const faqCounts = {};
  for (const f of faqData.data || []) faqCounts[f.category] = (faqCounts[f.category] || 0) + 1;

  res.json({
    period,
    timeline: Object.entries(buckets).sort(([a],[b])=>a.localeCompare(b)).map(([date,d])=>({date,...d})),
    totalReservations: reservations.length,
    confirmed: reservations.filter(r=>r.status==="confirmed").length,
    pending: reservations.filter(r=>r.status==="pending_confirmation").length,
    cancelled: reservations.filter(r=>!["confirmed","pending_confirmation"].includes(r.status)).length,
    totalGuests: reservations.reduce((s,r)=>s+(r.num_guests||0),0),
    avgGuests: reservations.length ? Math.round(reservations.reduce((s,r)=>s+(r.num_guests||0),0)/reservations.length*10)/10 : 0,
    byService: Object.entries(byService).sort(([,a],[,b])=>b-a).map(([service,count])=>({service,count})),
    frequentClients,
    faqBreakdown: Object.entries(faqCounts).sort(([,a],[,b])=>b-a).map(([category,count])=>({category,count})),
  });
});

// ─── Test Chat (sin WhatsApp) ────────────────────────────────────────────────
const TEST_PHONE = "test_demo_crm";

// Enviar mensaje al agente y recibir respuesta directamente
app.post("/test/message", crmAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Falta message" });

  const session = await getSession(TEST_PHONE);
  await saveMessage(TEST_PHONE, "user", message);
  await upsertSession(TEST_PHONE, { client_name: "Test Demo", status: "active" });

  const history = await getHistory(TEST_PHONE);
  const systemPrompt = await buildSystemPrompt();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [...history, { role: "user", content: message }],
  });

  const aiText = response.content[0].text;
  const finalText = await executeActions(aiText, TEST_PHONE, message);

  await saveMessage(TEST_PHONE, "assistant", finalText);

  // Devolver historial completo actualizado
  const { data: updated } = await supabase
    .from("conversation_memory")
    .select("role, content, created_at")
    .eq("tenant_id", TENANT_ID)
    .eq("phone_number", TEST_PHONE)
    .order("created_at", { ascending: true });

  res.json({ response: finalText, history: updated || [] });
});

// Limpiar conversación de test
app.delete("/test/messages", crmAuth, async (req, res) => {
  await supabase.from("conversation_memory").delete()
    .eq("tenant_id", TENANT_ID).eq("phone_number", TEST_PHONE);
  await supabase.from("chat_sessions").delete()
    .eq("tenant_id", TENANT_ID).eq("phone_number", TEST_PHONE);
  res.json({ ok: true });
});

// ─── WhatsApp Webhook ─────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    console.log("Webhook verificado");
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== "text") return;
    const phone = msg.from;
    const text = msg.text.body;
    console.log(`Mensaje de ${phone}: ${text}`);
    await handleMessage(phone, text);
  } catch (err) {
    console.error("Error webhook:", err.message);
  }
});

app.get("/health", (_, res) =>
  res.json({ status: "ok", agent: "Gregory", business: "Feeling Vilanova Grand Marina", tenant: TENANT_ID })
);

// ─── Cron: Recordatorios 24h antes (10:00 AM) ────────────────────────────────
cron.schedule(
  "0 10 * * *",
  async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];

    const { data } = await supabase
      .from("reservations")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .eq("date", dateStr)
      .eq("status", "confirmed");

    if (!data?.length) return;

    for (const r of data) {
      const msg = `👋 ¡Hola ${r.client_name}! Te recordamos tu reserva en Feeling Vilanova mañana:\n\n📅 ${r.date} a las ${r.time?.substring(0, 5)}\n👥 ${r.num_guests} persona${r.num_guests > 1 ? "s" : ""}\n🍽️ ${r.service}\n\nSi necesitas cambiar algo, escríbenos aquí. ¡Hasta mañana! 🌊`;
      await sendWAMessage(r.phone_number, msg);
    }
    console.log(`Recordatorios enviados: ${data.length} reservas para ${dateStr}`);
  },
  { timezone: "Europe/Madrid" }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🎵 Agente Gregory — Feeling Vilanova | Puerto: ${PORT} | Tenant: ${TENANT_ID}`)
);
