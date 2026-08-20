-- =====================================================================
--  ALMACÉN CPQ · COLUMBITO
--  PASO 1 · ACCESO: crear perfiles y entrar a la plataforma
--
--  Este es el paso que hoy le falta a la app. Ahora mismo los perfiles
--  se guardan en el navegador de cada equipo: si usted crea el suyo en
--  la computadora, en el celular no existe. Con esto, la cuenta es una
--  sola y sirve desde cualquier aparato.
--
--  PostgreSQL 15+ sobre Supabase.
--  Orden: 01_acceso → 02_esquema → 03_triggers → 04_permisos → 05_realtime → 06_datos
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

create or replace function sin_tildes(t text)
returns text language sql immutable parallel safe as
$$ select lower(public.unaccent('public.unaccent', coalesce(t,''))) $$;

do $$ begin
  create type puesto_app as enum
    ('almacenero','obra','jefatura','compras','supervisor','capataz','admin');
exception when duplicate_object then null; end $$;

-- =====================================================================
--  1. LOS PERFILES
--
--  La contraseña NO vive aquí. La guarda el servicio de autenticación de
--  Supabase, cifrada, en una tabla a la que ni siquiera esta base tiene
--  acceso directo. Guardarla en una columna sería regalarla ante
--  cualquier fuga, y hoy la app la tiene en texto plano en el navegador.
-- =====================================================================
create table if not exists perfiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  fotocheck       text not null,
  nombre          text not null,
  celular         text,
  puesto          puesto_app not null default 'supervisor',
  area            text,
  activo          boolean not null default true,
  aprobado        boolean not null default true,
  ultimo_acceso   timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  eliminado_en    timestamptz,
  version         bigint not null default 1,

  constraint perfiles_fotocheck_unico unique (fotocheck),
  constraint perfiles_fotocheck_ok check (fotocheck ~ '^[0-9]{3,12}$'),
  constraint perfiles_nombre_ok check (length(trim(nombre)) >= 5)
);

comment on table perfiles is
  'Un perfil por persona, atado a su cuenta de acceso. El puesto queda pegado aquí:
   nadie elige con qué puesto entra, lo decide su cuenta.';
comment on column perfiles.aprobado is
  'Los puestos de obra y logística —almacenero, obra, jefatura, compras— nacen sin
   aprobar y el administrador los habilita. Supervisores y capataces entran directo.
   Si prefiere que todos entren directo, cambie fn_nuevo_perfil más abajo.';

create index if not exists ix_perfiles_vivos on perfiles (puesto) where eliminado_en is null;

-- =====================================================================
--  2. EL CORREO FALSO
--
--  El servicio de acceso de Supabase trabaja con correo y contraseña,
--  pero en obra nadie tiene correo de empresa: tienen fotocheck. Se le
--  arma uno interno con el número —1352992@columbito.local— que nunca
--  se envía a ningún lado y que la gente jamás ve. Ellos escriben su
--  fotocheck; la app arma el correo por detrás.
-- =====================================================================
create or replace function correo_de_fotocheck(fc text)
returns text language sql immutable as
$$ select regexp_replace(coalesce(fc,''), '\D', '', 'g') || '@columbito.local' $$;

create or replace function fotocheck_de_correo(correo text)
returns text language sql immutable as
$$ select split_part(coalesce(correo,''), '@', 1) $$;

-- =====================================================================
--  3. EL PERFIL SE CREA SOLO AL REGISTRARSE
--
--  Cuando alguien se da de alta, Supabase escribe en auth.users. Este
--  disparador toma esa fila y arma su perfil con lo que la app mandó
--  (nombre, puesto, celular). Así no hay forma de tener una cuenta sin
--  perfil, ni un perfil sin cuenta.
-- =====================================================================
create or replace function fn_nuevo_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p puesto_app;
  fc text;
begin
  fc := fotocheck_de_correo(new.email);
  begin
    p := coalesce((new.raw_user_meta_data ->> 'puesto')::puesto_app, 'supervisor');
  exception when others then p := 'supervisor';
  end;

  insert into perfiles (id, fotocheck, nombre, celular, puesto, area, aprobado)
  values (
    new.id,
    fc,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), 'Sin nombre'),
    new.raw_user_meta_data ->> 'celular',
    p,
    new.raw_user_meta_data ->> 'area',
    /* los puestos que mueven material o plata esperan visto bueno */
    p not in ('almacenero','obra','jefatura','compras','admin')
  );
  return new;
end $$;

drop trigger if exists trg_nuevo_perfil on auth.users;
create trigger trg_nuevo_perfil
after insert on auth.users
for each row execute function fn_nuevo_perfil();

-- =====================================================================
--  4. QUIÉN SOY  ·  se usa en todas las reglas de permisos
-- =====================================================================
create or replace function mi_perfil()
returns perfiles language sql stable security definer as
$$ select * from perfiles
    where id = auth.uid() and activo and aprobado and eliminado_en is null $$;

create or replace function mi_puesto()
returns puesto_app language sql stable security definer as
$$ select puesto from perfiles
    where id = auth.uid() and activo and aprobado and eliminado_en is null $$;

create or replace function yo()
returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function soy(variadic p puesto_app[])
returns boolean language sql stable as $$ select mi_puesto() = any(p) $$;

-- =====================================================================
--  5. COMPROBAR ANTES DE REGISTRAR
--     La app pregunta esto mientras la persona escribe, para avisarle
--     al momento en vez de dejarla llenar todo y fallar al final.
-- =====================================================================
create or replace function fotocheck_libre(fc text)
returns boolean language sql stable security definer as
$$ select not exists (
     select 1 from perfiles
      where fotocheck = regexp_replace(coalesce(fc,''), '\D', '', 'g')
        and eliminado_en is null) $$;

-- =====================================================================
--  6. EL ADMINISTRADOR HABILITA
-- =====================================================================
create or replace function aprobar_perfil(p_id uuid, p_aprobar boolean default true)
returns perfiles language plpgsql security definer as $$
declare r perfiles%rowtype;
begin
  if mi_puesto() <> 'admin' then
    raise exception 'Solo el administrador habilita cuentas.';
  end if;
  update perfiles set aprobado = p_aprobar, actualizado_en = now(), version = version + 1
   where id = p_id returning * into r;
  return r;
end $$;

create or replace function cambiar_puesto(p_id uuid, p_puesto puesto_app)
returns perfiles language plpgsql security definer as $$
declare r perfiles%rowtype;
begin
  if mi_puesto() <> 'admin' then
    raise exception 'Solo el administrador cambia el puesto de una cuenta.';
  end if;
  update perfiles set puesto = p_puesto, actualizado_en = now(), version = version + 1
   where id = p_id returning * into r;
  return r;
end $$;

-- =====================================================================
--  7. PERMISOS SOBRE LOS PROPIOS PERFILES
-- =====================================================================
alter table perfiles enable row level security;
alter table perfiles force row level security;

create policy perfil_veo_el_mio on perfiles for select
  using (id = auth.uid() or soy('admin','obra','jefatura'));

create policy perfil_edito_el_mio on perfiles for update
  using (id = auth.uid() or soy('admin'))
  with check (
    soy('admin')
    or (id = auth.uid()
        and puesto = (select puesto from perfiles where id = auth.uid())
        and aprobado = (select aprobado from perfiles where id = auth.uid()))
  );

comment on policy perfil_edito_el_mio on perfiles is
  'Cada uno corrige su nombre o su celular. El puesto y la aprobación solo los cambia
   el administrador: si no, cualquiera se ascendería a jefatura.';

create policy perfil_nadie_borra on perfiles for delete using (false);

-- =====================================================================
--  8. EL PRIMER ADMINISTRADOR
--
--  Problema del huevo y la gallina: nadie puede aprobar al primero.
--  Regístrese desde la app con su fotocheck y su contraseña, y después
--  ejecute esta línea una sola vez, cambiando el número por el suyo.
-- =====================================================================
-- update perfiles
--    set puesto = 'admin', aprobado = true
--  where fotocheck = '1352992';
