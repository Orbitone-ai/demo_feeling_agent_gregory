-- ─── MIGRACIÓN: Agente Gregory — Feeling Vilanova ────────────────────────────
-- Proyecto Supabase: Orbitone_ControlAgents
-- Seguro de ejecutar sobre tablas existentes (usa IF NOT EXISTS en todo)
--
-- ANTES DE EJECUTAR: obtén el UUID del tenant de Feeling Vilanova con:
--   SELECT DISTINCT tenant_id FROM brand_profiles WHERE client_name ILIKE '%feeling%';
-- Ese UUID va en la variable de entorno TENANT_ID del agente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. clients — unique constraint necesario para upsert ────────────────────
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_tenant_phone_unique
    UNIQUE (tenant_id, phone_number);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN others THEN NULL;
END $$;

-- ─── 2. conversation_memory — añadir 'admin' al CHECK de role ────────────────
DO $$
DECLARE r RECORD;
BEGIN
  -- Eliminar constraint existente sobre la columna role (si existe)
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'conversation_memory' AND c.contype = 'c'
  LOOP
    EXECUTE 'ALTER TABLE conversation_memory DROP CONSTRAINT IF EXISTS ' || r.conname;
  END LOOP;
END $$;

ALTER TABLE conversation_memory
  ADD CONSTRAINT conversation_memory_role_check
  CHECK (role IN ('user', 'assistant', 'admin'));

-- ─── 3. reservations — añadir columnas faltantes ─────────────────────────────
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS email      TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS date       DATE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS time       TIME;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS num_guests INTEGER DEFAULT 1;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS service    TEXT    DEFAULT 'Reserva';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Columna status: si ya existe, actualizar constraint; si no, crear con default correcto
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending_confirmation';

-- Actualizar el CHECK de status (eliminar el anterior si existe y recrear)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'reservations' AND c.contype = 'c' AND a.attname = 'status'
  LOOP
    EXECUTE 'ALTER TABLE reservations DROP CONSTRAINT IF EXISTS ' || r.conname;
  END LOOP;
END $$;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('pending_confirmation', 'confirmed', 'cancelled', 'completed'));

-- Índices para reservas
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_phone
  ON reservations(tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_date
  ON reservations(tenant_id, date, status);

-- ─── 4. chat_sessions — tabla nueva para el panel CRM ────────────────────────
--   active              → conversación normal con el agente IA
--   needs_confirmation  → reserva anotada, admin debe confirmar (alerta amarilla)
--   admin_mode          → admin intercedió, agente IA pausado
--   closed              → conversación archivada
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
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

-- ─── 5. faq_log — registro de preguntas frecuentes (analytics) ───────────────
CREATE TABLE IF NOT EXISTS faq_log (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL,
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

-- ─── Verificación final ───────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('clients', 'conversation_memory', 'reservations', 'chat_sessions', 'faq_log')
ORDER BY table_name, ordinal_position;
