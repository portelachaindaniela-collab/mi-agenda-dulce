create table public.dulce_push (
  id bigint generated always as identity primary key,
  familia_id uuid not null references public.dulce_familias on delete cascade,
  quien text not null check (quien in ('mama', 'chica')),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create index dulce_push_familia_idx on public.dulce_push (familia_id, quien) where activo;

create table public.dulce_novedades (
  id bigint generated always as identity primary key,
  familia_id uuid not null references public.dulce_familias on delete cascade,
  tipo text not null,
  texto text not null,
  leida boolean not null default false,
  creado timestamptz not null default now()
);
create index dulce_novedades_familia_idx on public.dulce_novedades (familia_id, id);

create table public.dulce_recordatorios (
  familia_id uuid not null references public.dulce_familias on delete cascade,
  dia date not null,
  turno text not null check (turno in ('1410', '1900')),
  primary key (familia_id, dia, turno)
);

alter table public.dulce_push enable row level security;
alter table public.dulce_novedades enable row level security;
alter table public.dulce_recordatorios enable row level security;

-- Recordatorios de Dino a Valentina: 14:10 y 19:00 de Argentina (UTC-3, sin horario de verano).
select cron.schedule('agenda-dulce-1410', '10 17 * * *', $c$select net.http_post(url := 'https://itultpcdafpxpgtblgfb.supabase.co/functions/v1/agenda-dulce', headers := jsonb_build_object('Content-Type', 'application/json', 'x-trabajador-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'trabajadores_secreto')), body := '{"accion":"recordatorio","turno":"1410"}'::jsonb)$c$);
select cron.schedule('agenda-dulce-1900', '0 22 * * *', $c$select net.http_post(url := 'https://itultpcdafpxpgtblgfb.supabase.co/functions/v1/agenda-dulce', headers := jsonb_build_object('Content-Type', 'application/json', 'x-trabajador-secreto', (select decrypted_secret from vault.decrypted_secrets where name = 'trabajadores_secreto')), body := '{"accion":"recordatorio","turno":"1900"}'::jsonb)$c$);
