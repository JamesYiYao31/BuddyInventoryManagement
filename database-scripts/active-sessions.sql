-- Single active session per auth user (client token in localStorage only).
-- Run in Supabase SQL editor after review.

CREATE TABLE IF NOT EXISTS public.active_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  session_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own active session"
  ON public.active_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own active session"
  ON public.active_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own active session"
  ON public.active_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own active session"
  ON public.active_sessions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
