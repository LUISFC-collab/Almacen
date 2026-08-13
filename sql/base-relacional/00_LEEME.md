# Base de datos · Almacén Minero

Consorcio CPQ · Mina Columbito
Generado el 12/08/2026 a partir de la aplicación

## Para qué es esto

Hoy la app guarda todo dentro del navegador de cada celular. Por eso, si usted registra un
ingreso en su equipo, la Administradora de Obra no lo ve en el suyo: cada uno tiene su propio
almacén por separado.

Estos archivos son la base de datos que resuelve eso. Una vez cargada, todos los equipos ven
lo mismo, al momento, y sigue funcionando cuando no hay señal.

## Los archivos, en orden

Se ejecutan uno tras otro. El orden importa: cada uno usa lo que creó el anterior.

> **Ojo con el orden: los datos van ANTES de la seguridad.**
>
> `03_seguridad_rls.sql` activa `force row level security`, que aplica las
> políticas **incluso al dueño de las tablas**, y todas se apoyan en
> `auth.uid()`. Si se corre antes de cargar los datos, las inserciones de
> `05` quedan bloqueadas y el archivo entero se cae. El orden correcto es
> **01 → 02 → 05 → 06 → 03 → 04**.

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_esquema.sql` | Las 25 tablas con sus 349 columnas, tipos, claves e índices |
| 2 | `02_triggers.sql` | Lápidas, suma atómica, correlativos, el filtro de Obra y los avisos automáticos |
| 3 | `05_datos_iniciales.sql` | Sus datos de hoy: 616 registros. **No está en el repo** — ver `05_datos_iniciales.md` |
| 4 | `06_cuentas_relacional.sql` | Las 16 cuentas con su contraseña. Lo arma `node sql/generar-usuarios.js` |
| 5 | `03_seguridad_rls.sql` | Qué puede ver y tocar cada cargo, aplicado dentro de la base |
| 6 | `04_realtime.sql` | Tiempo real, sincronización sin señal, choques y tareas de reloj |

## Esto todavía NO es la base de la app

Es importante no confundirse: **la app que está en línea hoy no habla con
estas tablas**. Corre sobre las tablas `alm_*_create_110826`, que son otras.
Cargar estos archivos no le cambia nada a la app, ni para bien ni para mal.

Falta una pieza para poder cambiarla, y no es chica: este diseño **no guarda
contraseñas**. La tabla `usuarios` tiene `auth_uid`, que apunta al servicio de
autenticación de Supabase, y todas las políticas de seguridad preguntan
`auth.uid()`. Con la llave pública que usa la app hoy, `auth.uid()` es nulo y
la base no deja ver ni escribir absolutamente nada.

O sea que para mudar la app a este esquema hay que, antes:

1. Dar de alta a las 16 personas en el servicio de autenticación de Supabase.
   **Cada una establece su contraseña una vez más.** No se pueden migrar las
   de ahora: de una huella no se saca la contraseña, para eso está.
2. Enlazar cada cuenta con su fila (`usuarios.auth_uid`).
3. Reescribir la sincronización de la app, que hoy manda el registro entero
   en un `jsonb` y tendría que pasar a 25 tablas con columnas de verdad y a
   las funciones de suma atómica.

Mientras eso no se decida, `06_cuentas_relacional.sql` le agrega a `usuarios`
las columnas `sal` y `hash` para que las cuentas queden cargadas con la misma
contraseña que ya usan. Así el padrón es uno solo en las dos bases y la mudanza
no arranca de cero.

Y `base-de-datos-almacen.html`, que es el documento para revisar todo esto sin abrir un solo
archivo SQL. Ábralo con doble clic.

## Qué datos se cargan

| Tabla | Registros |
|---|---|
| Usuarios | 8 |
| Personal de obra | 5 |
| Materiales | 142 |
| Herramientas | 8 |
| Consolidado de obra | 445 |

**Las fotos no vienen.** En la app están guardadas como texto dentro del mismo registro y pesan
más que todos los datos juntos. En una base de verdad van a un almacén de archivos aparte y en
la tabla queda solo la dirección. Eso hay que armarlo cuando decida el servicio.

## Cómo cargarla

### En Supabase (lo recomendado)

El proyecto ya existe: **OREGON** (`lotfscfgkgsnqwwnftoo`). Ahí ya conviven las
tablas `alm_*_create_110826` de la app y las 26 tablas que el proyecto tenía de
antes. Se comprobó una por una: **ninguno de estos 25 nombres choca** con algo
que ya esté.

1. Entre a **SQL Editor**.
2. Pegue y ejecute los archivos **en el orden de la tabla de arriba**
   (01 → 02 → 05 → 06 → 03 → 04), uno por uno.
3. Va a avisar de "destructive operations" en `02_triggers.sql`: son los
   `drop trigger if exists` de sus propios triggers. Es esperado.
4. Compruebe con la consulta del final de `05_datos_iniciales.sql`.

### En un PostgreSQL propio

```bash
psql -h SERVIDOR -U USUARIO -d almacen -f 01_esquema.sql
psql -h SERVIDOR -U USUARIO -d almacen -f 02_triggers.sql
psql -h SERVIDOR -U USUARIO -d almacen -f 03_seguridad_rls.sql
psql -h SERVIDOR -U USUARIO -d almacen -f 04_realtime.sql
psql -h SERVIDOR -U USUARIO -d almacen -f 05_datos_iniciales.sql
```

Las partes de `auth.uid()` son de Supabase. En un Postgres propio hay que reemplazarlas por la
forma en que ese servidor identifique al usuario conectado.

## Las tres ideas de fondo

**Lápida.** Nada se borra. Al eliminar se marca la fila y se queda. Si se borrara de verdad, el
celular que estuvo sin señal nunca se enteraría de la baja y el registro reviviría en la
siguiente sincronización.

**Versión.** Cada fila lleva un contador que sube en cada cambio. El celular pide solo lo que
cambió desde la última vez que se conectó, en vez de descargar todo.

**Suma atómica.** El stock nunca se escribe con un número calculado en el celular. Se manda el
cambio —más 40, menos 12— y la base suma. Es lo único que evita que dos personas registrando a
la vez se pisen. Si el stock fuera a quedar negativo, la operación entera se cae y el almacenero
ve el error.

## Lo que la base hace por su cuenta

- Numera los materiales, las herramientas, los requerimientos y las guías. El celular ya no
  inventa números: dos equipos sin señal generarían el mismo.
- Impide que alguien que no sea la Administradora de Obra mande un pedido a logística, aunque
  llame a la API directamente sin pasar por la app.
- Avisa cuando un material baja del mínimo, cuando una herramienta no volvió a la hora y cuando
  una guía lleva más de siete días sin llegar.
- Guarda el antes y el después de cada cambio en la auditoría, que nadie puede borrar. Ni el
  administrador.

## Lo que falta decidir antes de producción

**Las fotos.** Dónde se guardan y por cuánto tiempo.

**Las contraseñas.** La app las guarda con su propio sistema. Al pasar a Supabase conviene que
el acceso lo maneje su servicio de autenticación, con el fotocheck como identificador. Eso
implica que cada persona establezca su contraseña una vez más.

**Quién es el dueño de la cuenta.** Una base con tiempo real es un servicio mensual, y de quién
sea la cuenta depende quién puede apagarla. Convendría que sea una cuenta de la empresa y no
personal.

**El registro abierto.** Hoy cualquiera con el enlace puede crear su perfil, incluso como
Almacenero o Jefe de Logística. En la base ya está la estructura para exigir aprobación; hay que
decidir si se activa.

## Limpieza pendiente

Para pasar estos archivos al SQL Editor se subieron al bucket `almacen-fotos`,
en la carpeta `_carga/`, con extensión `.pdf`. Ya no hacen falta. Se borran con:

```sql
delete from storage.objects
where bucket_id = 'almacen-fotos' and name like '_carga/%';
```
