-- ─── FEELING VILANOVA GRAND MARINA — Schema Supabase ─────────────────────────
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query

-- 1. Memoria conversacional
CREATE TABLE IF NOT EXISTS conversation_memory (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'admin')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_tenant_phone
  ON conversation_memory(tenant_id, phone_number, created_at DESC);

-- 2. Sesiones de chat (estado para el panel CRM)
--    status:
--      active              → conversación normal con el agente IA
--      needs_confirmation  → se anotó una reserva, el admin debe confirmarla (alerta amarilla en CRM)
--      admin_mode          → admin intercedió, el agente IA está pausado
--      closed              → conversación archivada
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number  TEXT NOT NULL,
  client_name   TEXT,
  status        TEXT DEFAULT 'active'
                  CHECK (status IN ('active', 'needs_confirmation', 'admin_mode', 'closed')),
  last_message  TIMESTAMPTZ DEFAULT NOW(),
  unread_count  INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone_number)
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_status
  ON chat_sessions(tenant_id, status, last_message DESC);

-- 3. Clientes
CREATE TABLE IF NOT EXISTS clients (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number TEXT NOT NULL,
  name         TEXT,
  email        TEXT,
  notes        TEXT,
  last_contact TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone_number)
);

-- 4. Reservas
--    status:
--      pending_confirmation → anotada por el agente, pendiente de confirmar por el admin
--      confirmed            → confirmada por el admin (se envía email + WA al cliente)
--      cancelled            → cancelada
--      completed            → completada (marcable manualmente)
CREATE TABLE IF NOT EXISTS reservations (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number TEXT NOT NULL,
  client_name  TEXT NOT NULL,
  email        TEXT,
  date         DATE NOT NULL,
  time         TIME NOT NULL,
  num_guests   INTEGER DEFAULT 1,
  service      TEXT NOT NULL DEFAULT 'Reserva',
  status       TEXT DEFAULT 'pending_confirmation'
                 CHECK (status IN ('pending_confirmation', 'confirmed', 'cancelled', 'completed')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_phone
  ON reservations(tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_date
  ON reservations(tenant_id, date, status);

-- 5. Escalamientos a humano
CREATE TABLE IF NOT EXISTS escalations (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number TEXT NOT NULL,
  reason       TEXT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Registro de preguntas frecuentes (analytics para el CRM)
--    Permite ver cuáles son las consultas más habituales de los clientes
CREATE TABLE IF NOT EXISTS faq_log (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'feeling_vilanova',
  phone_number TEXT NOT NULL,
  question     TEXT NOT NULL,
  category     TEXT CHECK (category IN (
    'horario', 'menu', 'precio', 'reserva', 'eventos',
    'ubicacion', 'bebidas', 'grupos', 'domicilio', 'otro'
  )),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_faq_tenant_category
  ON faq_log(tenant_id, category, created_at DESC);

-- ─── Verificación ─────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
