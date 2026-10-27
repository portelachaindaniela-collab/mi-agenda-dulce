create table public.dulce_familias (
  id uuid primary key default gen_random_uuid(),
  codigo_hash text unique not null,
  ics_token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  nombre text,
  creada timestamptz not null default now()
);
create table public.dulce_mensajes (
  id bigint generated always as identity primary key,
  familia_id uuid not null references public.dulce_familias on delete cascade,
  de text not null check (de in ('mama', 'chica')),
  texto text not null check (char_length(texto) between 1 and 2000),
  leido boolean not null default false,
  creado timestamptz not null default now()
);
create index dulce_mensajes_familia_id_idx on public.dulce_mensajes (familia_id, id);
create table public.dulce_uso (
  familia_id uuid not null references public.dulce_familias on delete cascade,
  dia date not null,
  cantidad int not null default 0,
  primary key (familia_id, dia)
);
create table public.dulce_agenda (
  familia_id uuid primary key references public.dulce_familias on delete cascade,
  datos jsonb not null default '{}',
  actualizado timestamptz not null default now()
);
alter table public.dulce_familias enable row level security;
alter table public.dulce_mensajes enable row level security;
alter table public.dulce_uso enable row level security;
alter table public.dulce_agenda enable row level security;
comment on table public.dulce_familias is 'Mi Agenda Dulce (app de Valentina): sin políticas, solo la función agenda-dulce (service role) lee y escribe.';
