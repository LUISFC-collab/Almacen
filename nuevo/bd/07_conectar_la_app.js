/* =====================================================================
   ALMACÉN CPQ · COLUMBITO
   PASO 7 · CONECTAR LA APP CON LA BASE

   Esto reemplaza el trozo de la app que hoy guarda los perfiles en el
   navegador. Con esto, la cuenta es una sola: se crea en la computadora
   y sirve en el celular.

   Cómo se usa:
   1. En Supabase, panel del proyecto → Settings → API. Copie las dos
      líneas de abajo desde ahí.
   2. Pegue este archivo dentro de la app, antes de su propio script.
   ===================================================================== */

const URL_BASE = "https://XXXXXXXX.supabase.co";   /* ← el suyo */
const CLAVE_PUBLICA = "eyJhbGciOi...";             /* ← la anon key */

/* La biblioteca de Supabase, servida desde su propio proyecto */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const base = createClient(URL_BASE, CLAVE_PUBLICA);

/* En obra nadie tiene correo de empresa: tienen fotocheck. Se le arma
   uno interno que nunca se envía a ningún lado y que nadie ve. */
const correoDe = (fc) => String(fc).replace(/\D/g, "") + "@columbito.local";

/* ---------------------------------------------------------------------
   CREAR PERFIL
   Lo que hoy hace el botón «Crear mi perfil», pero contra la base.
   --------------------------------------------------------------------- */
export async function crearPerfil({ nombre, puesto, celular, fotocheck, clave }) {
  const fc = String(fotocheck).replace(/\D/g, "");
  if (fc.length < 3) throw new Error("Escriba el número de su fotocheck.");
  if (String(nombre).trim().length < 5) throw new Error("Escriba su nombre completo.");
  if (!clave) throw new Error("Escriba una contraseña.");

  /* se avisa antes de intentar, para no llenar el formulario en vano */
  const { data: libre } = await base.rpc("fotocheck_libre", { fc });
  if (libre === false) throw new Error("Ese fotocheck ya tiene un perfil. Entre con su contraseña.");

  const { data, error } = await base.auth.signUp({
    email: correoDe(fc),
    password: clave,
    options: { data: { nombre: String(nombre).trim(), puesto, celular, fotocheck: fc } }
  });
  if (error) {
    if (/already registered/i.test(error.message))
      throw new Error("Ese fotocheck ya tiene un perfil. Entre con su contraseña.");
    if (/at least/i.test(error.message))
      throw new Error("La contraseña es muy corta para el servidor. Use al menos seis caracteres.");
    throw new Error(error.message);
  }

  /* el disparador de la base ya creó su perfil */
  return await miPerfil();
}

/* ---------------------------------------------------------------------
   ENTRAR
   --------------------------------------------------------------------- */
export async function entrar(fotocheck, clave) {
  const fc = String(fotocheck).replace(/\D/g, "");
  const { error } = await base.auth.signInWithPassword({
    email: correoDe(fc),
    password: clave
  });
  if (error) {
    if (/invalid login/i.test(error.message))
      throw new Error("El fotocheck o la contraseña no coinciden.");
    throw new Error(error.message);
  }

  const perfil = await miPerfil();
  if (!perfil) throw new Error("Su cuenta existe pero no tiene perfil. Avise al administrador.");
  if (!perfil.activo)   throw new Error("Su cuenta está desactivada.");
  if (!perfil.aprobado) throw new Error("Su cuenta espera el visto bueno del administrador.");

  await base.from("perfiles").update({ ultimo_acceso: new Date().toISOString() })
            .eq("id", perfil.id);
  return perfil;
}

export async function salir() { await base.auth.signOut(); }

export async function miPerfil() {
  const { data: { user } } = await base.auth.getUser();
  if (!user) return null;
  const { data } = await base.from("perfiles").select("*").eq("id", user.id).single();
  return data || null;
}

/* La sesión queda guardada: al volver a abrir la app entra sola */
export function alCambiarSesion(hacer) {
  base.auth.onAuthStateChange(async (evento) => {
    hacer(evento === "SIGNED_IN" ? await miPerfil() : null);
  });
}

/* ---------------------------------------------------------------------
   MOVER STOCK
   Nunca se escribe el stock: se manda el cambio y la base suma.
   La clave de idempotencia evita que un reintento duplique el movimiento.
   --------------------------------------------------------------------- */
export async function moverStock({ materialId, delta, tipo, documento, persona, frente, guiaId }) {
  const idempotencia = crypto.randomUUID();
  const { data, error } = await base.rpc("update_add_stock", {
    p_material_id: materialId,
    p_delta: delta,
    p_tipo: tipo,
    p_documento: documento || null,
    p_persona: persona || null,
    p_frente: frente || null,
    p_guia_id: guiaId || null,
    p_idempotencia: idempotencia
  });
  if (error) throw new Error(error.message);   /* «No alcanza el stock de…» */
  return data;
}

/* ---------------------------------------------------------------------
   TIEMPO REAL
   Lo que registra el almacén aparece en el celular de Obra sin recargar.
   --------------------------------------------------------------------- */
export function escuchar(tabla, alCambiar) {
  return base.channel("vivo:" + tabla)
    .on("postgres_changes", { event: "*", schema: "public", table: tabla }, alCambiar)
    .subscribe();
}

/* ---------------------------------------------------------------------
   SIN SEÑAL
   En la mina se corta la cobertura. Lo que no subió se guarda y se
   reintenta; la clave de idempotencia hace que reintentar sea seguro.
   --------------------------------------------------------------------- */
const COLA = "cola_sin_senal";
const leerCola  = () => { try { return JSON.parse(localStorage.getItem(COLA)) || []; } catch { return []; } };
const grabarCola = (c) => localStorage.setItem(COLA, JSON.stringify(c));

export function encolar(operacion, carga) {
  const c = leerCola();
  c.push({ idempotencia: crypto.randomUUID(), operacion, carga, fecha: Date.now() });
  grabarCola(c);
}

export async function subirPendientes() {
  const c = leerCola();
  if (!c.length) return { subidos: 0, fallaron: 0 };
  let subidos = 0; const quedan = [];
  for (const p of c) {
    try {
      await base.rpc("aplicar_pendiente", {
        p_idempotencia: p.idempotencia,
        p_tabla: p.carga.tabla,
        p_operacion: p.operacion,
        p_carga: p.carga
      });
      subidos++;
    } catch { quedan.push(p); }
  }
  grabarCola(quedan);
  return { subidos, fallaron: quedan.length };
}

/* se reintenta solo cuando vuelve la señal */
window.addEventListener("online", subirPendientes);

export { base };
