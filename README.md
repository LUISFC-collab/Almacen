# Almacén — Consorcio CPQ · Mina Columbito

App de almacén de obra: inventario, herramientas, préstamos, requerimientos,
ingresos por guía, despachos y reporte diario.

**En línea:** https://luisfc-collab.github.io/Almacen/
**Demostración:** https://luisfc-collab.github.io/Almacen/demostracion.html

## Lo que cambió en esta versión (V44 · 11-08-2026)

Hasta la versión anterior **cada celular guardaba su propio almacén**. Si el
almacenero registraba un ingreso en su equipo, la Administradora de Obra no lo
veía en el suyo: eran almacenes distintos con el mismo nombre.

Ahora todos los equipos trabajan sobre **la misma información, en vivo**:

- Lo que uno registra les aparece a los demás en más o menos un segundo.
- Sin señal se sigue trabajando normal; lo hecho sube solo cuando vuelve.
- Las cuentas de acceso **ya no están escritas en el código**: viven en la base
  de datos. El aplicativo sale desnudo y se llena de la base al abrir.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | **La aplicación.** Pide usuario y contraseña. |
| `sync.js` | La sincronización entre equipos. Va aparte para poder revisarla sin bajar las 12 mil líneas de la app. |
| `fotos.js` · `heic2any.min.js` | Que entre cualquier foto (incluido el HEIC del iPhone) y que al pedirla deje elegir entre cámara y galería. |
| `config.js` | A qué base de datos habla esta página. **Es lo único que decide eso: no copiarlo de otro repo ni a otro repo.** |
| `sw.js` · `manifest.json` · `icon-*.png` | Lo que hace que se instale como app en el celular. |
| `demostracion.html` | Versión de demostración con datos de ejemplo. **No toca la base real**: guarda todo aparte en el propio celular. Sirve para mostrarle la app a jefatura sin darle acceso al almacén. |
| `sql/` | Las tablas de la base y las cuentas de acceso. |

## La base de datos

Proyecto Supabase **OREGON** (`lotfscfgkgsnqwwnftoo`). Las tablas del almacén
llevan el prefijo `alm_` y el sufijo `_create_110826`, para distinguirlas de un
vistazo de las demás tablas del proyecto.

Para montarla desde cero:

1. En **Supabase → SQL Editor**, correr `sql/almacen_create_110826.sql` — crea
   las 14 tablas.
2. En la computadora, `node sql/generar-usuarios.js`. Deja el SQL de las
   cuentas en `sql/local/`, que **no** va a GitHub.
3. Pegar ese archivo en el SQL Editor. Después se puede borrar.

**Las huellas de las contraseñas no van al repo.** El repo es público: por eso
el generador va versionado y su resultado no. Si hay que reponer un acceso
perdido, se vuelve a correr el paso 2 y 3.

Cada tabla lleva:

- `datos` (jsonb) con el registro completo, `id`, `ts`, `cell_at`,
  `created_at` y `updated_at` con trigger.
- **Tombstones**: los borrados se hacen apagando (`eliminado`, `elim_por`,
  `elim_ts`), no borrando. Una fila que desaparece no puede sincronizarse; en
  cambio apagada el borrado llega a todos los equipos y se puede deshacer.
- `replica identity full` y alta en la publicación `supabase_realtime`.
- RLS permisiva para `anon`.

### Cómo se resuelven los empates

Gana el `ts` más nuevo, que es **la hora de la acción**, no la de la subida.
Los correlativos son la excepción: nunca se pisan hacia abajo, y el código de
un material nuevo se saca del mayor que ya existe, no de un contador que cada
equipo lleva por su cuenta. Si no, dos almaceneros creando a la vez sacaban el
mismo `MAT-0013`.

### Las fotos

Van al bucket **`almacen-fotos`**, ordenadas por tabla:

```
almacen-fotos/materiales/<id del material>/foto-<huella>.jpg
almacen-fotos/herramientas/<id>/foto-<huella>.jpg
almacen-fotos/guias/<id>/foto-<huella>.jpg
…una carpeta por cada tabla
```

En el registro queda solo el enlace. Antes cada foto viajaba en base64
adentro: un material con foto pesaba unas 60 KB y eso se bajaba entero cada
vez que alguien tocaba cualquier cosa de ese material.

El nombre sale del contenido de la foto, así que la misma imagen subida dos
veces cae en la misma ruta y la segunda no pesa nada. El bucket deja **crear
pero no pisar ni borrar**: una foto subida no se puede destruir desde la app.

**Formatos.** El iPhone guarda en HEIC y ningún Android lo abre. La app lo
convierte a JPG antes de tocarlo, y si un formato no se reconoce de entrada
igual intenta la conversión antes de darse por vencida. Al pedir una foto
pregunta si tomarla con la cámara o buscarla en el celular.

### Por qué no se pierde nada

Las huellas de lo ya enviado viven **solo en memoria, a propósito**. Si el
celular se apaga a media subida, al abrir de nuevo arranca sin ellas: todo se
vuelve a comparar contra el servidor y lo que faltó viaja solo. Los borrados
hechos sin señal son el único caso que no se puede recalcular —el registro ya
no está—, así que esos quedan anotados en una cola hasta que el servidor los
acuse.

## Cuentas

Las contraseñas **no están en este repositorio**, que es público. Viven en
`sql/local/claves.json`, que el .gitignore no deja subir:

```json
{ "_inicial": "…", "joshua.amasifuen": "…", "luis": "…" }
```

Quien no esté nombrado ahí sale con `_inicial`. **Cada uno la cambia desde la
app en su primer ingreso.**

En la **demostración** las cuentas son las mismas y la clave es `demo2026`
—o directamente el botón "Entrar sin usuario"—. Son cuentas de mentira sobre
datos de mentira: no abren nada del almacén real.

Están todas en la base. **Dos administradores:**

| Usuario | Cargo |
|---|---|
| `joshua.amasifuen` | Almacenero / Administrador del sistema |
| `luis` | Administrador de la app (acceso total) |
| `valerie` | Administradora de Obra |
| `compras` | Asistente de Logística |
| `logistica` | Jefatura de Logística |
| `supervisor.civil` · `supervisor.electrico` · `supervisor.electrico.junior` · `supervisor.mecanico` · `supervisor.seguridad` · `supervisor.calidad` | Supervisores de obra |
| `capataz.1` · `capataz.2` | Capataces (solo consultan el material) |

## Para que se vea como app en el celular

Una vez abierta en el navegador:

- **Android (Chrome):** menú de tres puntos → "Agregar a pantalla de inicio".
- **iPhone (Safari):** botón de compartir → "Añadir a pantalla de inicio".

Queda con su ícono, se abre a pantalla completa y funciona sin señal.

## Antes de repartir el enlace, hay que saber esto

**Quien tenga el enlace puede leer y escribir en la base**, aunque no pase por
la pantalla de ingreso. La contraseña decide qué ve y qué puede hacer *dentro
de la app*, pero la llave de la base va en el código de la página —como en
cualquier página web que habla con Supabase— y la base está abierta a esa
llave.

Para el uso previsto —una obra, gente conocida, el enlace repartido por
WhatsApp entre el equipo— es el mismo arreglo que ya tiene el parte de obra y
funciona. Lo que **no** conviene es publicar el enlace en un lugar abierto ni
tratar esto como un sistema con secreto. Si en algún momento hace falta que la
base cierre de verdad, el cambio es pasar el ingreso a las cuentas de Supabase
y ajustar las políticas RLS para que cada quien solo vea lo suyo. Es un trabajo
aparte y hay que decidirlo.

## Respaldos

El código fuente y las copias fechadas están en `Escritorio/Almacen CPQ/`.
