# La base de datos · Almacén CPQ

## Para qué es

Hoy la página guarda todo dentro del navegador de cada equipo. Por eso su cuenta creada en
la computadora no existe en el celular, y el ingreso que registra usted no lo ve la
Administradora de Obra.

Con esta base, la cuenta es una sola y todos ven lo mismo al momento.

## Los archivos, en orden

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_acceso.sql` | Los perfiles y el ingreso con fotocheck |
| 2 | `02_esquema.sql` | Consolidado, materiales, pedidos, guías, herramientas y kardex |
| 3 | `03_triggers.sql` | Lápidas, suma atómica, correlativos y el filtro de Obra |
| 4 | `04_permisos.sql` | Qué ve y qué toca cada puesto |
| 5 | `05_realtime.sql` | Tiempo real, sincronización sin señal y choques |
| 6 | `06_datos.sql` | Sus 608 renglones del consolidado, unidades y la guía EG07-282 |
| 7 | `07_conectar_la_app.js` | El trozo que se pega **en la página**, no en el SQL Editor |

15 tablas · 10 disparadores · 9 transmitiendo en vivo · 728 registros.

---

# CÓMO CONECTAR

## 1. Cree el proyecto

Entre a **supabase.com** y cree una cuenta. El plan gratis alcanza de sobra para esta obra.
Cree un proyecto: póngale `almacen-columbito`, elija la región más cercana y guarde la
contraseña de la base que le pida — no es la suya, es la del servidor.

Espere unos dos minutos a que termine de armarse.

## 2. Ejecute los seis scripts

En el menú de la izquierda, **SQL Editor** → *New query*.

Abra `01_acceso.sql`, copie todo, péguelo y pulse **Run**. Debe decir *Success*.
Repita con el 02, 03, 04, 05 y 06, **en ese orden**.

El orden importa: cada script usa lo que creó el anterior. Si uno falla, no siga — léalo,
corrija y vuelva a ejecutarlo.

Al terminar, pegue esto y ejecútelo para comprobar:

```sql
select 'unidades' t, count(*) from unidades
union all select 'alias', count(*) from unidad_alias
union all select 'consolidado', count(*) from consolidado
union all select 'herramientas', count(*) from herramientas
union all select 'guia_lineas', count(*) from guia_lineas;
```

Debe darle 21 unidades, 81 alias, 608 renglones de consolidado, 3 herramientas y 5 líneas
de guía.

## 3. Copie sus dos claves

**Settings → API**. Ahí hay dos datos:

- **Project URL** — algo como `https://abcdefgh.supabase.co`
- **anon public** — una clave larga que empieza por `eyJ...`

Esa clave es pública a propósito: no da acceso a nada por sí sola, porque quien manda son
los permisos del script 4. La otra clave que verá, la *service_role*, **no la use nunca en
la página**: esa se salta todos los permisos.

## 4. Péguelas en la página

Abra `07_conectar_la_app.js` y cambie las dos primeras líneas:

```js
const URL_BASE = "https://abcdefgh.supabase.co";
const CLAVE_PUBLICA = "eyJhbGciOi...";
```

Copie ese archivo a `2 PAGINA WEB/scripts/` y agréguelo en `index.html`, antes de los otros
dos scripts.

## 5. Encienda el tiempo real

**Database → Replication → supabase_realtime**. Marque las tablas: `consolidado`,
`materiales`, `requerimientos`, `requerimiento_items`, `guias`, `guia_lineas`,
`movimientos`, `herramientas` y `prestamos`.

El script 5 ya intenta activarlas; esto es por si su proyecto pide hacerlo a mano.

## 6. Regístrese y hágase administrador

Abra la página, toque **Crear mi perfil** y regístrese con su fotocheck **1352992**.

Vuelva al SQL Editor y ejecute una sola vez:

```sql
update perfiles set puesto = 'admin', aprobado = true where fotocheck = '1352992';
```

Desde ahí ya habilita a los demás desde su panel.

## 7. Compruebe que quedó conectado

Abra la página en la computadora y en el celular al mismo tiempo, con dos cuentas
distintas. Registre un ingreso en una: debe aparecer en la otra sin recargar.

---

## Cosas que conviene saber

**El fotocheck como usuario.** El servicio de acceso trabaja con correo, pero en obra nadie
tiene correo de empresa. La página arma uno interno con el número —`1352992@columbito.local`—
que no existe, no recibe nada y nadie ve. La persona escribe su fotocheck; el correo lo
arma la página por detrás.

**Quién entra directo y quién espera.** Supervisores y capataces entran apenas se registran.
Almacenero, obra, jefatura y compras nacen esperando su visto bueno, para que nadie se dé de
alta como Jefe de Logística y apruebe sus propias compras. Para cambiarlo, la última línea
de `fn_nuevo_perfil` en el script 1.

**Las contraseñas.** En esta base **no hay columna de contraseña**. Las guarda cifradas el
servicio de acceso, y ni la base ni nadie con acceso a ella puede leerlas. Hoy la página las
guarda en texto plano en el navegador: al pasar a esto, cambie la que está usando.

**Sin señal.** En la mina se corta la cobertura. Lo que se registre queda guardado en el
celular y sube solo cuando vuelve la señal. Cada operación lleva una clave que hace que
reintentar sea seguro: no duplica el movimiento.

**Cuánto cuesta.** El plan gratis da 500 MB y 50.000 usuarios activos al mes. Para esta obra
sobra. Si algún día se queda corto, el siguiente plan está alrededor de 25 dólares al mes.
Conviene que la cuenta sea de la empresa y no personal: de eso depende quién puede apagarla.
