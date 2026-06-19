# Agente Gregory — Feeling Vilanova Grand Marina
**by Orbitone AI** — WhatsApp AI Agent con panel CRM

---

## Funcionalidades

- Responde mensajes de WhatsApp 24/7 con Claude (Anthropic)
- Conoce toda la carta, horarios, servicios y promociones de Feeling Vilanova
- Gestión de reservas: anotar, modificar, cancelar
- Flujo de confirmación manual: el agente **nunca confirma** directamente — el admin lo hace desde el CRM
- Modo intercesión: el admin puede pausar el agente y escribir manualmente al cliente
- Alertas en CRM cuando hay reservas pendientes de confirmar
- Recordatorios automáticos 24h antes de cada reserva (10:00 AM)
- Analytics de preguntas frecuentes (FAQ) y estadísticas de reservas
- Soporte en castellano, catalán e inglés

---

## Flujo de reservas

```
Cliente escribe → Gregory anota la reserva (status: pending_confirmation)
                → Responde: "En breve te confirmaremos tu reserva 😊"
                → CRM muestra el chat en AMARILLO con alerta

Admin ve la alerta en CRM → Intercede en el chat (admin_mode)
                          → Confirma o ajusta la reserva
                          → Envía confirmación por WA + email automático al cliente
                          → Libera el chat (vuelve al agente IA)
```

---

## API del panel CRM

Todas las rutas requieren el header:
```
Authorization: Bearer <CRM_SECRET_KEY>
```

### Sesiones

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/crm/sessions` | Lista todos los chats. `?status=needs_confirmation` filtra alertas |
| GET | `/crm/session/:phone` | Historial completo + reservas de un cliente |
| POST | `/crm/session/:phone/intervene` | Activa modo admin (pausa la IA) |
| POST | `/crm/session/:phone/release` | Reactiva el agente IA |
| POST | `/crm/message` | Envía un mensaje manual por WA `{phone, message}` |

### Reservas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/crm/reservations` | Lista reservas. Filtros: `?status=`, `?date_from=`, `?date_to=` |
| PUT | `/crm/reservation/:id/confirm` | Confirma reserva → WA + email al cliente |
| PUT | `/crm/reservation/:id/cancel` | Cancela reserva → notifica al cliente |

### Analytics

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/crm/analytics/faq` | Preguntas más frecuentes por categoría |
| GET | `/crm/analytics/reservations` | Stats: total, por estado, por servicio, comensales |

---

## Deploy en Railway

### 1. Sube el código a GitHub
```bash
git init && git add . && git commit -m "Agente Gregory — Feeling Vilanova"
git remote add origin https://github.com/tu-usuario/gregory-feeling
git push -u origin main
```

### 2. Crea el proyecto en Railway
Railway → New Project → Deploy from GitHub → selecciona el repositorio

### 3. Configura las variables de entorno
Railway → Settings → Variables → añade todas las del `.env.example`

### 4. Obtén la URL pública
Tu webhook URL: `https://tu-url.railway.app/webhook`

---

## Configurar Supabase

1. Supabase Dashboard → SQL Editor → New Query
2. Pega el contenido de `schema.sql` y ejecuta

---

## Configurar Meta (WhatsApp Business API)

1. developers.facebook.com → Tu App → WhatsApp → Configuración → Webhooks
2. URL de callback: `https://tu-url.railway.app/webhook`
3. Token de verificación: valor de `WHATSAPP_VERIFY_TOKEN`
4. Suscríbete al campo: `messages`

---

## Categorías de FAQ (analytics)

| Categoría | Qué cubre |
|-----------|-----------|
| `horario` | Preguntas sobre horarios de apertura |
| `menu` | Carta, platos, opciones |
| `precio` | Precios de platos o menús |
| `reserva` | Hacer, modificar o cancelar reservas |
| `eventos` | DJ, actuaciones, agenda semanal |
| `ubicacion` | Cómo llegar, dirección, parking |
| `bebidas` | Cócteles, vinos, combinados |
| `grupos` | Menús para grupos o eventos privados |
| `domicilio` | Pedidos a domicilio |
| `otro` | Resto de consultas |
