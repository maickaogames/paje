-- 1) Messages: writes must only happen through the trusted server function
--    (service_role, which bypasses RLS). Remove any client write privileges and
--    make the deny explicit with restrictive policies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.messages FROM anon, authenticated;
GRANT SELECT ON public.messages TO anon, authenticated;
GRANT ALL ON public.messages TO service_role;

DROP POLICY IF EXISTS "No client inserts on messages" ON public.messages;
CREATE POLICY "No client inserts on messages"
ON public.messages
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "No client updates on messages" ON public.messages;
CREATE POLICY "No client updates on messages"
ON public.messages
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (false);

DROP POLICY IF EXISTS "No client deletes on messages" ON public.messages;
CREATE POLICY "No client deletes on messages"
ON public.messages
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (false);

-- 2) Storage: chat images are delivered exclusively through server-generated
--    signed URLs, so no direct client read access is needed.
DROP POLICY IF EXISTS "Public read chat images" ON storage.objects;
