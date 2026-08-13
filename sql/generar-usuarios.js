/* =====================================================================
   ALMACÉN CPQ · Generador de las cuentas de acceso

   Este archivo SÍ va al repo. El SQL que produce NO: lleva las huellas de
   las contraseñas y el repo es público. Sale a `sql/local/`, que está en
   el .gitignore.

   Uso:
     node sql/generar-usuarios.js
     → sql/local/almacen_usuarios_110826.sql

   Ese archivo se pega en Supabase → SQL Editor y después se puede borrar.
   La app arma la huella igual que acá: sha256(sal + "::" + clave).
   ===================================================================== */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const huella = (sal, clave) =>
  "s1:" + crypto.createHash("sha256").update(sal + "::" + clave).digest("hex");

/* =====================================================================
   LAS CONTRASEÑAS NO VAN EN ESTE ARCHIVO.

   Este archivo sí va al repo, y el repo es público. Antes tenía la
   contraseña del administrador escrita acá en texto plano — peor todavía
   que la huella que tanto cuidamos de no subir.

   Ahora se leen de `sql/local/claves.json`, que el .gitignore no deja
   subir. Formato:

     { "_inicial": "la que sea", "joshua.amasifuen": "…", "luis": "…" }

   Quien no esté nombrado ahí sale con `_inicial`. Si el archivo no está,
   se corta: mejor que falle a que genere el padrón entero con una clave
   de ejemplo que alguien después da por buena.
   ===================================================================== */
let CLAVES;
try{
  CLAVES = JSON.parse(fs.readFileSync(path.join(__dirname, "local", "claves.json"), "utf8"));
}catch(e){
  console.error("Falta sql/local/claves.json — ahí van las contraseñas, fuera del repo.");
  console.error('Ejemplo:  { "_inicial": "…", "joshua.amasifuen": "…", "luis": "…" }');
  process.exit(1);
}
const CLAVE_INICIAL = CLAVES._inicial;
if(!CLAVE_INICIAL){
  console.error('sql/local/claves.json necesita "_inicial".');
  process.exit(1);
}

/* El id va escrito, NO sale de la posición en la lista.
   Si saliera de la posición, meter una cuenta en medio le correría el id a
   todas las de abajo: al volver a correr esto, cada una entraría como fila
   nueva y quedarían dos cuentas por persona. Es exactamente lo que pasó con
   luis.focon el 12/08. Para agregar a alguien: número siguiente, y listo. */
const CUENTAS = [
  { id:"alm-u01", usuario:"joshua.amasifuen", nombre:"Joshua Amasifuén",
    cargo:"Almacenero / Administrador del sistema", rol:"almacenero", area:"",
    esAdmin:true },

  /* Segundo administrador. Con rol `admin` los permisos son "*": entra a
     todo sin tener que cambiar de modo. */
  { id:"alm-u17", usuario:"luis", nombre:"Luis", cargo:"Administrador de la app",
    rol:"admin", area:"", esAdmin:true },

  { id:"alm-u02", usuario:"valerie",   nombre:"Valerie",              cargo:"Administradora de Obra",  rol:"obra",       area:"" },
  { id:"alm-u03", usuario:"compras",   nombre:"Asistente de Compras", cargo:"Asistente de Logística",  rol:"compras",    area:"" },
  { id:"alm-u04", usuario:"logistica", nombre:"Jefa de Logística",    cargo:"Jefatura de Logística",   rol:"jefatura",   area:"" },

  /* Supervisores y capataces. Antes los creaba cada celular por su cuenta
     (V37), y al sincronizar el mismo puesto salía repetido una vez por
     equipo. Ahora se crean acá, una sola vez, con un id fijo. */
  { id:"alm-u05", usuario:"supervisor.civil",            nombre:"Supervisor Civil",             cargo:"Supervisor Civil",             rol:"supervisor", area:"Civil" },
  { id:"alm-u06", usuario:"supervisor.electrico",        nombre:"Supervisor Eléctrico",         cargo:"Supervisor Eléctrico",         rol:"supervisor", area:"Eléctrico" },
  { id:"alm-u07", usuario:"supervisor.electrico.junior", nombre:"Supervisor Eléctrico Junior",  cargo:"Supervisor Eléctrico Junior",  rol:"supervisor", area:"Eléctrico" },
  { id:"alm-u08", usuario:"supervisor.mecanico",         nombre:"Supervisor Mecánico",          cargo:"Supervisor Mecánico",          rol:"supervisor", area:"Mecánico" },
  { id:"alm-u09", usuario:"supervisor.seguridad",        nombre:"Supervisor de Seguridad",      cargo:"Supervisor de Seguridad",      rol:"supervisor", area:"Seguridad" },
  { id:"alm-u10", usuario:"supervisor.calidad",          nombre:"Supervisor de Calidad",        cargo:"Supervisor de Calidad",        rol:"supervisor", area:"Calidad" },
  { id:"alm-u11", usuario:"capataz.1", nombre:"Capataz 1", cargo:"Capataz de obra", rol:"capataz", area:"" },
  { id:"alm-u12", usuario:"capataz.2", nombre:"Capataz 2", cargo:"Capataz de obra", rol:"capataz", area:"" }
];

/* Las que ya trae `05_datos_iniciales.sql` del esquema relacional. Están con
   nombre y apellido de verdad, no con el puesto genérico. Se las repite acá
   solo para ponerles contraseña: ese esquema no guarda ninguna. */
const CUENTAS_ESQUEMA = [
  { id:"alm-u13", usuario:"carlos.rios",  nombre:"Carlos Ríos",  cargo:"Supervisor Eléctrico",      rol:"supervisor",  area:"Eléctrico" },
  { id:"alm-u14", usuario:"luis.paredes", nombre:"Luis Paredes", cargo:"Supervisor Mecánico",       rol:"supervisor",  area:"Mecánico" },
  { id:"alm-u15", usuario:"ana.quispe",   nombre:"Ana Quispe",   cargo:"Supervisora Civil",         rol:"supervisor",  area:"Civil" },
  { id:"alm-u16", usuario:"marco.tello",  nombre:"Marco Tello",  cargo:"Almacenero de turno noche", rol:"almacenero",  area:"" }
];

const CREADO = "2026-08-11T00:00:00.000Z";

/* Un solo padrón para las dos bases. La sal se calcula UNA vez por cuenta y
   se usa en los dos archivos: así la misma contraseña sirve en cualquiera de
   los dos esquemas, y no hay que acordarse de cuál es cuál. */
const TODAS = CUENTAS.concat(CUENTAS_ESQUEMA).map(c => {
  /* Sal al azar por cuenta: dos personas con la misma clave no comparten
     huella, y una huella sola no sirve para adivinar la otra. */
  const sal = crypto.randomBytes(9).toString("base64url");
  if(!c.id) throw new Error("La cuenta " + c.usuario + " no tiene id escrito.");
  return Object.assign({}, c, { sal, hash: huella(sal, CLAVES[c.usuario] || CLAVE_INICIAL) });
});

/* Dos cuentas con el mismo id o el mismo usuario serían dos filas que la app
   no sabe distinguir. Mejor que falle acá que descubrirlo en la obra. */
["id", "usuario"].forEach(campo => {
  const vistos = {};
  TODAS.forEach(c => {
    if(vistos[c[campo]]) throw new Error("Repetido en " + campo + ": " + c[campo]);
    vistos[c[campo]] = 1;
  });
});

const filas = TODAS.map(c => {
  const reg = {
    id: c.id, usuario: c.usuario, nombre: c.nombre, cargo: c.cargo, area: c.area || "",
    rol: c.rol, esAdmin: !!c.esAdmin, sal: c.sal,
    hash: c.hash, hashAlt: null,
    activo: true, creado: CREADO, ultimoAcceso: null, foto: null,
    dni: "", celular: "", correo: "", permisosExtra: [],
    _ts: CREADO
  };
  return "  ('" + reg.id + "', '" + JSON.stringify(reg).replace(/'/g, "''") +
         "'::jsonb, '" + CREADO + "', false, 'siembra')";
});

const sql = `/* =====================================================================
   ALMACÉN CPQ · Cuentas de acceso
   Generado por sql/generar-usuarios.js — NO subir a GitHub.

   Correr DESPUÉS de almacen_create_110826.sql, en Supabase → SQL Editor.

   Vuelve a poner la contraseña de cada cuenta a la de la lista, así que
   sirve también para reponer un acceso perdido: basta con borrar esa fila
   y volver a correr esto.
   ===================================================================== */

insert into public.alm_usuarios_create_110826 (id, datos, ts, eliminado, cell_at) values
${filas.join(",\n")}
on conflict (id) do update
  set datos = excluded.datos, ts = excluded.ts, eliminado = false;

select datos->>'usuario' as usuario, datos->>'nombre' as nombre,
       datos->>'rol' as rol, (datos->>'esAdmin')::boolean as admin
from public.alm_usuarios_create_110826
where not eliminado
order by 1;
`;

/* =====================================================================
   Y el mismo padrón para el esquema relacional (sql/base-relacional/).

   Ese esquema NO guarda contraseñas: espera que el acceso lo maneje el
   servicio de autenticación de Supabase, y eso obliga a que cada persona
   vuelva a establecer la suya. Mientras eso no se decida, la app entra con
   el sistema que ya tiene, así que hay que darle dónde guardarlo: se le
   agregan las dos columnas y se cargan las cuentas que le faltan.

   Las contraseñas no se pisan nunca (`coalesce`): si alguien ya cambió la
   suya, volver a correr esto no se la devuelve a la inicial. Para reponer
   un acceso perdido hay que vaciarle antes la huella a esa cuenta:
     update usuarios set sal = null, hash = null where usuario = 'quien.sea';
   ===================================================================== */
const comilla = v => (v === null || v === undefined || v === "") ? "null" : "'" + String(v).replace(/'/g, "''") + "'";

const filasRel = TODAS.map(c =>
  "  (" + [comilla(c.usuario), comilla(c.nombre), comilla(c.cargo), comilla(c.area),
           comilla(c.rol) + "::rol_app", c.esAdmin ? "true" : "false",
           comilla(c.sal), comilla(c.hash)].join(", ") + ")");

const sqlRel = `/* =====================================================================
   ALMACÉN CPQ · Cuentas para el esquema relacional
   Generado por sql/generar-usuarios.js — NO subir a GitHub.

   Correr DESPUÉS de 01..05 de sql/base-relacional/.
   ===================================================================== */

alter table usuarios add column if not exists sal  text;
alter table usuarios add column if not exists hash text;

comment on column usuarios.sal  is
  'Sal de la contraseña, mientras el acceso no pase al servicio de autenticación de Supabase.';
comment on column usuarios.hash is
  'Huella de la contraseña: sha256(sal || \x27::\x27 || clave). Nunca la contraseña.';

insert into usuarios (usuario, nombre, cargo, area, rol, es_admin, sal, hash) values
${filasRel.join(",\n")}
on conflict (usuario) do update set
  nombre   = excluded.nombre,
  cargo    = excluded.cargo,
  area     = excluded.area,
  rol      = excluded.rol,
  es_admin = excluded.es_admin,
  /* nunca se le devuelve a nadie la contraseña inicial */
  sal      = coalesce(usuarios.sal,  excluded.sal),
  hash     = coalesce(usuarios.hash, excluded.hash);

select usuario, nombre, rol, es_admin,
       case when hash is null then 'SIN CLAVE' else 'con clave' end as acceso
from usuarios
where eliminado_en is null
order by 1;
`;

const dir = path.join(__dirname, "local");
fs.mkdirSync(dir, { recursive: true });

const salida = path.join(dir, "almacen_usuarios_110826.sql");
fs.writeFileSync(salida, sql, "utf8");

const salidaRel = path.join(dir, "06_cuentas_relacional.sql");
fs.writeFileSync(salidaRel, sqlRel, "utf8");

console.log("Listo:");
console.log("  " + salida + "   (tablas jsonb alm_*)");
console.log("  " + salidaRel + "   (esquema relacional)");
console.log(TODAS.length + " cuentas. Clave inicial (menos el administrador): " + CLAVE_INICIAL);
