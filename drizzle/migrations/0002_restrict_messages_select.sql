DROP POLICY IF EXISTS "Anyone can read messages" ON public.messages;
REVOKE SELECT ON public.messages FROM anon, authenticated;
GRANT ALL ON public.messages TO service_role;