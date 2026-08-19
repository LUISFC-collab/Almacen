-- =====================================================================
--  ALMACÉN CPQ · DATOS INICIALES
--  Mina Columbito · exportado de la app el 15/08/2026
--
--  Ejecutar después de 04_realtime.sql
-- =====================================================================

begin;
set session_replication_role = replica;   -- los disparadores no corren al cargar


-- ---------- UNIDADES DE MEDIDA ----------

insert into unidades (codigo, nombre) values ('und', 'Unidad') on conflict do nothing;
insert into unidades (codigo, nombre) values ('par', 'Par') on conflict do nothing;
insert into unidades (codigo, nombre) values ('jgo', 'Juego') on conflict do nothing;
insert into unidades (codigo, nombre) values ('doc', 'Docena') on conflict do nothing;
insert into unidades (codigo, nombre) values ('mll', 'Millar') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m', 'Metro') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m2', 'Metro cuadrado') on conflict do nothing;
insert into unidades (codigo, nombre) values ('m3', 'Metro cúbico') on conflict do nothing;
insert into unidades (codigo, nombre) values ('rll', 'Rollo') on conflict do nothing;
insert into unidades (codigo, nombre) values ('var', 'Varilla') on conflict do nothing;
insert into unidades (codigo, nombre) values ('pln', 'Plancha') on conflict do nothing;
insert into unidades (codigo, nombre) values ('kg', 'Kilogramo') on conflict do nothing;
insert into unidades (codigo, nombre) values ('t', 'Tonelada') on conflict do nothing;
insert into unidades (codigo, nombre) values ('L', 'Litro') on conflict do nothing;
insert into unidades (codigo, nombre) values ('gal', 'Galón') on conflict do nothing;
insert into unidades (codigo, nombre) values ('cja', 'Caja') on conflict do nothing;
insert into unidades (codigo, nombre) values ('bls', 'Bolsa') on conflict do nothing;
insert into unidades (codigo, nombre) values ('paq', 'Paquete') on conflict do nothing;
insert into unidades (codigo, nombre) values ('bld', 'Balde') on conflict do nothing;
insert into unidades (codigo, nombre) values ('sac', 'Saco') on conflict do nothing;
insert into unidades (codigo, nombre) values ('tbo', 'Tubo') on conflict do nothing;

-- Las formas raras que trae el Excel de la obra. Cada una apunta a su
-- unidad buena, así «Mts», «MTS» y «mtr» dejan de ser tres unidades.
insert into unidad_alias (alias, codigo) values ('u', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('un', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('uni', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unid', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unidad', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('unidades', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pza', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pzas', 'und') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pares', 'par') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('jgos', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('jgs', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('juego', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('juegos', 'jgo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('docena', 'doc') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('docenas', 'doc') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('millar', 'mll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('millares', 'mll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mt', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mtr', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mtrs', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('mts', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metro', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metros', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('ml', 'm') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metrocuadrado', 'm2') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('metrocubico', 'm3') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('rollo', 'rll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('rollos', 'rll') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('varilla', 'var') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('varillas', 'var') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('plancha', 'pln') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('planchas', 'pln') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilo', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilos', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilogramo', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('kilogramos', 'kg') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tn', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tonelada', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('toneladas', 't') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('lt', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('lts', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('litro', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('litros', 'L') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('galon', 'gal') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('galones', 'gal') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('caja', 'cja') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('cajas', 'cja') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('bolsa', 'bls') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('bolsas', 'bls') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('paquete', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('paquetes', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pack', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('packs', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('pq', 'paq') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('balde', 'bld') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('baldes', 'bld') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('saco', 'sac') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('sacos', 'sac') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tubo', 'tbo') on conflict do nothing;
insert into unidad_alias (alias, codigo) values ('tubos', 'tbo') on conflict do nothing;

-- ---------- CONSOLIDADO · 12 renglones ----------

insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-001', 'Contenedores de 20 pies', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-002', 'Radio de comunicación con señal interna de MY', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-003', 'Escritorios', 'und', 5) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-004', 'Sillas para escritorios', 'und', 5) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-005', 'Martillo para demolición, marca HILTI', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-006', 'Parihuela de madera', 'und', 4) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-007', 'Cilindro negro con tapa de geomembrana', 'und', 1) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-008', 'Separadores Artesco index', 'und', 7) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-009', 'Armella cerrada de 1/2', 'und', 20) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-010', 'Candado de 20 mm', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-011', 'Escoba', 'und', 3) on conflict (codigo) do nothing;
insert into consolidado (codigo, descripcion, unidad, requerido) values ('R01-012', 'Recogedor', 'und', 3) on conflict (codigo) do nothing;

-- ---------- MATERIALES EN EL ALMACÉN · 3 ----------

insert into materiales (nombre, unidad, stock, consolidado_id) values ('Escoba', 'und', 2, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Escoba') limit 1));
insert into materiales (nombre, unidad, stock, consolidado_id) values ('Recogedor', 'und', 1, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Recogedor') limit 1));
insert into materiales (nombre, unidad, stock, consolidado_id) values ('Candado de 20 mm', 'und', 0, (select id from consolidado where sin_tildes(descripcion) = sin_tildes('Candado de 20 mm') limit 1));

-- ---------- HERRAMIENTAS · 3 ----------

insert into herramientas (nombre) values ('Amoladora 7"');
insert into herramientas (nombre) values ('Taladro percutor');
insert into herramientas (nombre) values ('Llave de torque 1/2"');

-- ---------- LA GUÍA EN CAMINO · EG07-282 ----------

insert into guias (serie, correlativo, fecha, punto_partida, punto_llegada, peso_bruto_kgm, estado) values ('EG07', 282, '2026-08-13', 'AV. 13 DE JULIO NRO. 322 - CAJAMARCA - CAJAMARCA - CAJAMARCA', 'SEDE PRODUCTIVA MINERA YANACOCHA - ENCAÑADA - CAJAMARCA - CAJAMARCA', 15, 'en_camino');
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 1, 'Separadores Artesco index', 'und', 7, (select id from consolidado where codigo = 'R01-008'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 2, 'Armella cerrada de 1/2', 'und', 20, (select id from consolidado where codigo = 'R01-009'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 3, 'Candado de 20 mm', 'und', 3, (select id from consolidado where codigo = 'R01-010'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 4, 'Escoba', 'und', 3, (select id from consolidado where codigo = 'R01-011'));
insert into guia_lineas (guia_id, orden, descripcion, unidad, cantidad, consolidado_id) values ((select id from guias where correlativo = 282), 5, 'Recogedor', 'und', 3, (select id from consolidado where codigo = 'R01-012'));

-- ---------- CORRELATIVOS ----------
insert into correlativos (prefijo, valor) values ('EG07', 282), ('REQ', 0)
on conflict (prefijo) do update set valor = greatest(correlativos.valor, excluded.valor);

set session_replication_role = default;
commit;

-- =====================================================================
--  Comprobación
-- =====================================================================
--  select 'unidades' t, count(*) from unidades
--  union all select 'alias', count(*) from unidad_alias
--  union all select 'consolidado', count(*) from consolidado
--  union all select 'materiales', count(*) from materiales
--  union all select 'herramientas', count(*) from herramientas
--  union all select 'guia_lineas', count(*) from guia_lineas;
