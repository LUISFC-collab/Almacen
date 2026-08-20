-- =====================================================================
--  ALMACÉN CPQ · COMPLETAR EL CABLEADO
--
--  El paquete 01–06 deja nueve tablas en tiempo real y nueve con lápida
--  y sello de versión, pero no son las mismas nueve. Este script cierra
--  la diferencia, para que ninguna baja se pierda y ningún equipo se
--  quede con una versión vieja de algo que otro ya cambió.
--
--  Qué faltaba, exactamente:
--
--    · perfiles      tenía lápida y versión, pero NO transmitía. Un
--                    permiso aprobado en la laptop no llegaba al celular
--                    hasta volver a entrar.
--    · movimientos   transmitía, pero NO tenía lápida ni versión. Un
--                    movimiento borrado desaparecía sin dejar marca, y
--                    un celular que estuvo sin señal lo revivía al subir.
--    · unidades      ni una cosa ni la otra. Son las tablas que deciden
--      unidad_alias  cómo se llama cada unidad: si un equipo agrega
--                    «mts» y otro no lo recibe, el inventario se parte.
--
--  Ejecutar después de 06_datos.sql. Se puede repetir sin daño.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  1. MOVIMIENTOS · lápida y sello
--     El kardex no se edita, se anula con un contraasiento. Aun así
--     necesita las dos columnas: sin `eliminado_en` una baja no viaja,
--     y sin `version` no hay forma de pedir «solo lo nuevo».
-- ---------------------------------------------------------------------
alter table movimientos add column if not exists eliminado_en   timestamptz;
alter table movimientos add column if not exists version        bigint not null default 1;
alter table movimientos add column if not exists actualizado_en timestamptz not null default now();

drop trigger if exists trg_sellar on movimientos;
create trigger trg_sellar before update on movimientos
for each row execute function fn_sellar();

drop trigger if exists trg_lapida on movimientos;
create trigger trg_lapida before delete on movimientos
for each row execute function fn_lapida();

create index if not exists ix_mov_vivos on movimientos (fecha desc) where eliminado_en is null;

-- ---------------------------------------------------------------------
--  2. UNIDADES Y ALIAS · lápida y sello
--     Estas dos no llevan `id`: su clave es el texto. fn_lapida busca
--     por `id` y aquí no serviría, así que va una versión que recibe el
--     nombre de la columna clave como argumento del disparador.
-- ---------------------------------------------------------------------
alter table unidades     add column if not exists eliminado_en   timestamptz;
alter table unidades     add column if not exists version        bigint not null default 1;
alter table unidades     add column if not exists actualizado_en timestamptz not null default now();

alter table unidad_alias add column if not exists eliminado_en   timestamptz;
alter table unidad_alias add column if not exists version        bigint not null default 1;
alter table unidad_alias add column if not exists actualizado_en timestamptz not null default now();

create or replace function fn_lapida_clave()
returns trigger language plpgsql as $lap$
declare col text := tg_argv[0]; val text;
begin
  if old.eliminado_en is not null then return old; end if;
  val := to_jsonb(old) ->> col;
  execute format('update %I set eliminado_en = now(), version = version + 1,
                  actualizado_en = now() where %I = $1', tg_table_name, col)
  using val;
  return null;      -- se cancela el borrado físico
end $lap$;

comment on function fn_lapida_clave is
  'Igual que fn_lapida, para las tablas cuya clave es un texto y no un id.';

drop trigger if exists trg_sellar on unidades;
create trigger trg_sellar before update on unidades
for each row execute function fn_sellar();

drop trigger if exists trg_lapida on unidades;
create trigger trg_lapida before delete on unidades
for each row execute function fn_lapida_clave('codigo');

drop trigger if exists trg_sellar on unidad_alias;
create trigger trg_sellar before update on unidad_alias
for each row execute function fn_sellar();

drop trigger if exists trg_lapida on unidad_alias;
create trigger trg_lapida before delete on unidad_alias
for each row execute function fn_lapida_clave('alias');

-- ---------------------------------------------------------------------
--  3. TIEMPO REAL · las que faltaban
--     `replica identity full` es lo que hace que el aviso lleve también
--     la fila vieja. Sin eso, al borrar llega un aviso sin datos y el
--     otro equipo no sabe qué sacar de su lista.
-- ---------------------------------------------------------------------
do $rt$ declare t text; begin
  foreach t in array array['perfiles','unidades','unidad_alias'] loop
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then null;
    end;
    execute format('alter table %I replica identity full;', t);
  end loop;
end $rt$;

-- movimientos ya estaba en la publicación; solo se asegura la identidad
alter table movimientos replica identity full;

-- ---------------------------------------------------------------------
--  4. QUE GANE LO ÚLTIMO CARGADO
--
--     `guardar_con_version` hace lo contrario: si alguien cambió la fila
--     antes que usted, corta con CHOQUE y no guarda. Eso protege de
--     pisar el trabajo ajeno, pero deja al que llega tarde sin poder
--     grabar, que en obra —donde el celular sube cuando vuelve la
--     señal— significa perder el registro.
--
--     Esta guarda siempre, sin mirar la versión, y devuelve qué versión
--     había antes. El movimiento anterior sigue en el kardex y la fila
--     anterior ya viajó en el aviso de tiempo real: nada queda a ciegas.
--
--     Se usa en lugar de guardar_con_version cuando la regla que quiere
--     es «manda lo último», no «manda el primero».
-- ---------------------------------------------------------------------
create or replace function guardar_ultimo_gana(p_tabla text, p_id uuid, p_cambios jsonb)
returns jsonb language plpgsql as $ug$
declare fila jsonb; v bigint;
begin
  execute format('select version from %I where id = $1 for update', p_tabla) into v using p_id;
  if v is null then raise exception 'La fila ya no existe en %.', p_tabla; end if;

  execute format('update %I set (%s) = (select %s from jsonb_populate_record(null::%I,$1)) where id=$2',
    p_tabla,
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    (select string_agg(quote_ident(k), ',') from jsonb_object_keys(p_cambios) k),
    p_tabla) using p_cambios, p_id;

  execute format('select to_jsonb(t) from %I t where t.id = $1', p_tabla) into fila using p_id;
  return jsonb_build_object('fila', fila, 'version_pisada', v);
end $ug$;

comment on function guardar_ultimo_gana is
  'Guarda sin discutir: manda lo último que llega. Devuelve la fila y qué versión pisó.
   Para cuando prefiere no perder el registro tardío antes que proteger el temprano.';

commit;


-- =====================================================================
--  COMPROBACIÓN
--  Pegue esto aparte y ejecútelo: las doce primeras filas deben decir
--  «si» en las tres columnas. `correlativos` queda fuera a propósito
--  —ver la nota del final.
-- =====================================================================
-- select c.relname as tabla,
--        case when a.attname is not null then 'si' else 'NO' end as lapida,
--        case when v.attname is not null then 'si' else 'NO' end as version,
--        case when p.prrelid is not null then 'si' else 'NO' end as tiempo_real
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
-- left join pg_attribute a on a.attrelid = c.oid and a.attname = 'eliminado_en' and a.attnum > 0
-- left join pg_attribute v on v.attrelid = c.oid and v.attname = 'version'      and v.attnum > 0
-- left join pg_publication_rel p on p.prrelid = c.oid
--      and p.prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
-- where c.relkind = 'r'
--   and c.relname in ('perfiles','consolidado','materiales','requerimientos',
--                     'requerimiento_items','guias','guia_lineas','herramientas',
--                     'prestamos','movimientos','unidades','unidad_alias','correlativos')
-- order by 1;


-- =====================================================================
--  LAS DOS QUE QUEDAN FUERA, Y POR QUÉ
--
--  correlativos  Es un contador: una fila por prefijo con un número que
--                solo sube. No se sincroniza a propósito — el número lo
--                da la base justamente para que dos equipos sin señal no
--                generen el mismo. Ponerlo en tiempo real avisaría a
--                toda la obra cada vez que alguien saca un correlativo,
--                sin que nadie lo use.
--
--  sync_cola     Es la bandeja de salida de CADA equipo: lo que ese
--                celular hizo sin señal y todavía no subió. Transmitirla
--                mandaría a los demás trabajo que aún no ocurrió, y que
--                puede no ocurrir si la operación falla al aplicarse.
--                Se vacía sola cuando vuelve la cobertura.
-- =====================================================================
