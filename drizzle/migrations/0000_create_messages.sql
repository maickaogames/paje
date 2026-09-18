CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  peer_id text NOT NULL,
  nickname text NOT NULL,
  avatar_url text,
  content text NOT NULL DEFAULT '',
  image_url text,
  link_preview jsonb
);

GRANT SELECT ON public.messages TO anon;
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read messages"
ON public.messages FOR SELECT
TO anon, authenticated
USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

CREATE POLICY "Public read chat images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'chat-images');