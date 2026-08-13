/* =====================================================================
   ALMACÉN CPQ · Mina Columbito
   Tablas del almacén online — proyecto OREGON (lotfscfgkgsnqwwnftoo)

   Creadas el 11/08/2026. Todas llevan el sufijo _create_110826 para
   distinguirlas de un vistazo de las tablas originales del proyecto.

   Cada tabla guarda el registro completo en `datos` (jsonb). Así la app
   puede agregarle campos a un material o a un requerimiento sin que haya
   que volver a tocar la base.

   Reglas de la casa:
     · `ts` arbitra quién gana cuando dos equipos tocan lo mismo.
     · Los borrados se hacen apagando (`eliminado`), no borrando: una fila
       que desaparece no puede sincronizarse, y así el borrado viaja a
       todos los equipos y se puede deshacer.
     · RLS permisiva para `anon`, replica identity full y alta en la
       publicación supabase_realtime.

   Correr en: Supabase → SQL Editor. Avisa de "destructive operations"
   por los `drop ... if exists`; es esperado.
   ===================================================================== */

create or replace function public.alm_touch_110826()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

do $bloque$
declare
  n text;
  t text;
  tablas text[] := array[
    'usuarios', 'solicitudes', 'personal', 'materiales', 'herramientas',
    'requerimientos', 'movimientos', 'notificaciones', 'historial',
    'auditoria', 'guias', 'proveedores', 'despachos', 'estado'
  ];
begin
  foreach n in array tablas loop
    t := 'alm_' || n || '_create_110826';

    execute format($ddl$
      create table if not exists public.%I (
        id          text primary key,
        datos       jsonb       not null default '{}'::jsonb,
        ts          timestamptz not null default now(),
        eliminado   boolean     not null default false,
        elim_por    text,
        elim_ts     timestamptz,
        cell_at     text,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )$ddl$, t);

    execute format('create index if not exists %I on public.%I (ts desc)',        t || '_ts_idx',   t);
    execute format('create index if not exists %I on public.%I (updated_at desc)', t || '_upd_idx',  t);
    execute format('create index if not exists %I on public.%I (eliminado)',       t || '_elim_idx', t);

    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.alm_touch_110826()',
      t || '_touch', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated
         using (true) with check (true)',
      t || '_anon', t);

    execute format('grant all on public.%I to anon, authenticated', t);
    execute format('alter table public.%I replica identity full', t);

    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$bloque$;

/* =====================================================================
   FOTOS Y ADJUNTOS

   Antes cada foto viajaba en base64 dentro del propio registro: un
   material con foto pesaba unas 60 KB y eso se bajaba entero cada vez
   que alguien tocaba cualquier cosa de ese material. Ahora la foto se
   sube una vez al bucket y en el registro solo queda el enlace.

   Se ordenan por tabla:  almacen-fotos/<tabla>/<id del registro>/<campo>.jpg

   El bucket es público de lectura porque la app muestra las fotos con un
   <img> común y corriente. `anon` puede leer y subir, pero NO pisar ni
   borrar: una foto subida no se puede destruir desde la app.
   ===================================================================== */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('almacen-fotos', 'almacen-fotos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "alm_fotos_leer_110826"  on storage.objects;
drop policy if exists "alm_fotos_subir_110826" on storage.objects;

create policy "alm_fotos_leer_110826" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'almacen-fotos');

create policy "alm_fotos_subir_110826" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'almacen-fotos');

/* Comprobación: deben salir 14 tablas y el bucket. */
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'alm\_%\_create\_110826'
order by table_name;

select id, public, file_size_limit from storage.buckets where id = 'almacen-fotos';
