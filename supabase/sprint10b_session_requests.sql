-- ══════════════════════════════════════════════════════════════
-- Sprint 10b — session_requests
-- Website lead capture from the Request a Session modal
-- Run this in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_requests (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at         timestamptz DEFAULT now(),

  -- Step 1: What are they looking for?
  -- Values: 'mirror' | 'live' | 'explore' | 'other'
  interest_type      text        NOT NULL,

  -- Step 2: The decision they're facing (qualification signal)
  decision_summary   text,

  -- Step 3: Contact details
  name               text        NOT NULL,
  email              text        NOT NULL,
  whatsapp           text,
  additional_context text,

  -- Internal ops fields — never shown to user
  status             text        NOT NULL DEFAULT 'pending',
  -- 'pending' → new request, not yet reviewed
  -- 'reviewed' → someone has read it
  -- 'accepted' → session booked or token sent
  -- 'declined' → not a fit right now
  -- 'waitlisted' → fit but no capacity

  responded_at       timestamptz,
  notes              text        -- internal ops notes, not surfaced to user
);

-- ── INDEXES ────────────────────────────────────────────────────
-- Speed up the admin view (sort by newest first, filter by status)
CREATE INDEX IF NOT EXISTS idx_session_requests_created_at
  ON session_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_requests_status
  ON session_requests (status);

CREATE INDEX IF NOT EXISTS idx_session_requests_email
  ON session_requests (email);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────
-- The website uses the anon key to INSERT only.
-- No SELECT/UPDATE/DELETE from the browser — ever.
ALTER TABLE session_requests ENABLE ROW LEVEL SECURITY;

-- Allow the website (anon role) to insert new requests
CREATE POLICY "Website can insert session requests"
  ON session_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Only service_role (your backend / Supabase dashboard) can read
-- No SELECT policy for anon → submissions are write-only from browser
-- Use Supabase dashboard or a server-side route to read them

-- ── USAGE NOTES ────────────────────────────────────────────────
-- 1. In the website HTML, replace:
--      SUPABASE_URL     → your project URL (e.g. https://xxxx.supabase.co)
--      SUPABASE_ANON_KEY → your anon public key (safe to expose)
--
-- 2. To read submissions: Supabase dashboard → Table Editor → session_requests
--    Or query via service role key from your backend.
--
-- 3. Suggested admin query to triage pending requests:
--
--    SELECT id, created_at, interest_type, name, email, whatsapp,
--           left(decision_summary, 120) AS decision_preview, status
--    FROM   session_requests
--    WHERE  status = 'pending'
--    ORDER  BY created_at DESC;
--
-- 4. To mark as reviewed (run from dashboard or server):
--
--    UPDATE session_requests
--    SET    status = 'accepted', responded_at = now(), notes = 'Token sent via email'
--    WHERE  id = 'xxxx-xxxx-xxxx-xxxx';
