/* =====================================================================
   ALMACÉN CPQ · LA NUBE

   Este archivo es el puente con Supabase. Va ANTES que los otros dos
   porque ellos le preguntan si hay conexión antes de guardar.

   Cómo trabaja:

     · Si la persona entró con una cuenta de la base, todo lo que haga
       se guarda allá y le llega a los demás al momento.
     · Si no —porque todavía no se registró, o porque en la mina se cayó
       la señal— la app sigue funcionando contra el navegador, igual que
       hasta ahora, y lo pendiente se sube cuando vuelve.

   No reemplaza el guardado local: lo acompaña. Una app de almacén que
   deja de servir cuando no hay señal no sirve en una mina.

   El paquete traía 07_conectar_la_app.js como módulo con import/export.
   Aquí va como archivo normal porque los otros dos scripts comparten
   variables globales; mezclar los dos estilos rompe ese reparto.
   ===================================================================== */

var NUBE_URL = "https://lotfscfgkgsnqwwnftoo.supabase.co";
var NUBE_CLAVE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvdGZzY2Zna2dzbnF3d25mdG9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDI2NDQsImV4cCI6MjA5ODYxODY0NH0.TWIqxxYvxrfiWdqEcQZQ8VyOqzbMOHxuEC-_VUJkAOA";

/* Las nueve tablas que el paquete sincroniza, en el orden en que deben
   viajar: los padres antes que los hijos, si no la base rechaza al hijo
   por apuntar a algo que todavía no existe. */
var NUBE_TABLAS = ["unidades","unidad_alias","consolidado","materiales",
                   "requerimientos","requerimiento_items","guias","guia_lineas",
                   "herramientas","prestamos","movimientos",
                   "requerimiento_borradores"];

var Nube = {
  sesion: null,        /* lo que devuelve el servicio de acceso */
  perfil: null,        /* la fila de perfiles de esta persona */
  estado: "sin entrar",
  ws: null,
  latido: null,
  refs: {},            /* id de la base ↔ id local, para no duplicar */
  alCambiar: null      /* la app pone aquí qué hacer cuando llega algo */
};

/* ---------------------------------------------------------------------
   Lo básico: hablar con la base
   --------------------------------------------------------------------- */
function nubeCorreo(fc){
  return String(fc).replace(/\D/g, "") + "@columbito.local";
}

/* =====================================================================
   LA CONTRASEÑA CORTA

   Supabase no acepta contraseñas de menos de 6 caracteres: el panel
   directamente se niega a bajar el mínimo. Pero en obra la gente usa
   claves de cuatro o cinco dígitos, como en el otro aplicativo, y no
   vamos a obligar a nadie a cambiar su costumbre por una regla de la
   plataforma.

   Se le agrega una cola fija antes de mandarla. La persona escribe
   "12345" y el servidor recibe "12345·almacen-cpq", que ya pasa el
   mínimo. La cola es siempre la misma, así que al entrar coincide.

   Que quede claro qué mejora y qué no: la cola satisface la regla de
   longitud, no hace la clave más difícil de adivinar. Una de cinco
   dígitos sigue siendo de cinco dígitos. Lo que sí gana frente al otro
   aplicativo es que aquí la contraseña viaja cifrada y se guarda
   cifrada: ni la base ni nadie con acceso a ella puede leerla, mientras
   que allá está en texto plano dentro de la fila del usuario.
   ===================================================================== */
var NUBE_COLA_CLAVE = "·almacen-cpq";

function nubeClave(clave){
  return String(clave == null ? "" : clave) + NUBE_COLA_CLAVE;
}

function nubeCabeceras(){
  var h = {"apikey": NUBE_CLAVE, "Content-Type": "application/json"};
  h.Authorization = "Bearer " + ((Nube.sesion && Nube.sesion.access_token) || NUBE_CLAVE);
  return h;
}

function nubeHay(){ return !!(Nube.sesion && Nube.sesion.access_token); }

/* ---------------------------------------------------------------------
   RENOVAR EL PASE

   El pase que da el servicio de acceso dura una hora. Cuando vence, la
   app se quedaba muda: el equipo volvía a «solo en este equipo» y todo
   lo del resto de la tarde se iba a la cola sin que nadie se enterara.
   En obra eso son cuatro horas de trabajo que no salieron del celular.

   Junto al pase viene un vale para pedir otro. Aquí se usa: si el
   servidor contesta que el pase venció, se pide uno nuevo y se repite
   la petición una sola vez. Una sola, porque si el vale también venció
   hay que entrar de nuevo y reintentar en bucle solo taparía el
   problema.
   --------------------------------------------------------------------- */
var nubeRenovando = null;

function nubeRenovar(){
  if(nubeRenovando) return nubeRenovando;
  var vale = Nube.sesion && Nube.sesion.refresh_token;
  if(!vale) return Promise.reject(new Error("No hay con qué renovar la sesión."));

  nubeRenovando = fetch(NUBE_URL + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: {"apikey": NUBE_CLAVE, "Content-Type": "application/json"},
    body: JSON.stringify({refresh_token: vale})
  }).then(function(r){
    if(!r.ok) throw new Error("La sesión venció y no se pudo renovar.");
    return r.json();
  }).then(function(s){
    Nube.sesion = s;
    Nube.estado = "en línea";
    try{ localStorage.setItem("almacen_nube_sesion", JSON.stringify(s)); }catch(e){}
    nubeRenovando = null;
    return s;
  }).catch(function(e){
    nubeRenovando = null;
    Nube.sesion = null; Nube.perfil = null; Nube.estado = "sin entrar";
    try{ localStorage.removeItem("almacen_nube_sesion"); }catch(e2){}
    throw e;
  });
  return nubeRenovando;
}

function nubePedir(ruta, opciones, yaReintento){
  var o = Object.assign({}, opciones || {});
  o.headers = Object.assign(nubeCabeceras(), (opciones && opciones.headers) || {});
  return fetch(NUBE_URL + ruta, o).then(function(r){
    return r.text().then(function(t){
      var d = null;
      try{ d = t ? JSON.parse(t) : null; }catch(e){ d = t; }
      if(!r.ok){
        var msg = (d && (d.message || d.error_description || d.msg)) || ("HTTP " + r.status);
        /* el pase venció: se renueva y se repite, una sola vez */
        var venció = (r.status === 401 || r.status === 403) &&
                     ruta.indexOf("/auth/v1/token") < 0 &&
                     !yaReintento && Nube.sesion && Nube.sesion.refresh_token;
        if(venció){
          return nubeRenovar().then(function(){
            return nubePedir(ruta, opciones, true);
          });
        }
        throw new Error(msg);
      }
      return d;
    });
  });
}

/* ---------------------------------------------------------------------
   ENTRAR

   El servicio de acceso trabaja con correo; en obra tienen fotocheck.
   Se le arma uno interno que nunca sale a ningún lado.
   --------------------------------------------------------------------- */
function nubeEntrar(fotocheck, clave){
  return nubePedir("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({email: nubeCorreo(fotocheck), password: nubeClave(clave)})
  }).then(function(s){
    Nube.sesion = s;
    return nubeMiPerfil();
  }).then(function(p){
    if(!p) throw new Error("Su cuenta existe pero no tiene perfil. Avise al administrador.");
    if(!p.activo) throw new Error("Su cuenta está desactivada.");
    if(!p.aprobado) throw new Error("Su cuenta espera el visto bueno del administrador.");
    Nube.perfil = p;
    Nube.estado = "en línea";
    try{ localStorage.setItem("almacen_nube_sesion", JSON.stringify(Nube.sesion)); }catch(e){}
    return p;
  }).catch(function(e){
    Nube.sesion = null; Nube.perfil = null; Nube.estado = "sin entrar";
    throw e;
  });
}

function nubeCrearPerfil(datos){
  return nubePedir("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email: nubeCorreo(datos.fotocheck),
      password: nubeClave(datos.clave),
      data: {nombre: datos.nombre, puesto: datos.puesto, celular: datos.celular,
             fotocheck: String(datos.fotocheck).replace(/\D/g, "")}
    })
  }).then(function(){
    return nubeEntrar(datos.fotocheck, datos.clave);
  });
}

/* ---------------------------------------------------------------------
   ENTRAR, Y SI LA BASE NO LO CONOCE, DARLO DE ALTA

   Hasta ahora, si la persona existía en la lista de este equipo pero no
   en la base, la app la dejaba entrar «solo en este equipo» sin decir
   gran cosa. Trabajaba todo el día creyendo que estaba en línea y nada
   llegaba a las tablas: es exactamente lo que venía pasando.

   Ahora, cuando la contraseña que escribió es la correcta según este
   equipo y la base simplemente no tiene esa cuenta todavía, se le crea
   allá con esas mismas credenciales y se entra en línea. La persona no
   tiene que hacer ningún trámite aparte, que en obra nadie hace.
   --------------------------------------------------------------------- */
function nubeAltaSiHaceFalta(datos){
  return nubeEntrar(datos.fotocheck, datos.clave).catch(function(e){
    var m = String((e && e.message) || "");
    /* solo si la base dice «no conozco esa cuenta». Si dice que la
       contraseña no coincide, o que espera aprobación, eso se respeta. */
    if(!/invalid login credentials|invalid_grant|credentials/i.test(m)) throw e;
    return nubeCrearPerfil(datos);
  });
}

/* ---------------------------------------------------------------------
   EL REQUERIMIENTO A MEDIO ARMAR

   Una fila por persona. Se guarda lo que lleva escrito para que pueda
   seguir en otro aparato: empieza en el celular en el frente y termina
   en la laptop de la oficina.
   --------------------------------------------------------------------- */
function nubeEquipo(){
  var a = navigator.userAgent || "";
  return /Mobi|Android|iPhone|iPad/i.test(a) ? "celular" : "laptop";
}

function nubeGuardarBorrador(contenido){
  if(!nubeHay()) return Promise.resolve(null);
  return nubePedir("/rest/v1/rpc/guardar_borrador", {
    method: "POST",
    body: JSON.stringify({p_contenido: contenido || {}, p_equipo: nubeEquipo()})
  });
}

function nubeTraerBorrador(){
  if(!nubeHay() || !Nube.perfil) return Promise.resolve(null);
  return nubePedir("/rest/v1/requerimiento_borradores?dueno=eq." + Nube.perfil.id +
                   "&eliminado_en=is.null&select=*&limit=1", {method: "GET"})
    .then(function(f){ return (f && f[0]) || null; })
    .catch(function(){ return null; });
}

/* Al registrar el requerimiento el borrador ya no sirve. Se da de baja,
   y el disparador de lápida lo deja marcado en vez de borrarlo: así el
   otro aparato se entera de que ya no está en lugar de revivirlo. */
function nubeSoltarBorrador(){
  if(!nubeHay() || !Nube.perfil) return Promise.resolve(null);
  return nubePedir("/rest/v1/requerimiento_borradores?dueno=eq." + Nube.perfil.id,
                   {method: "DELETE"}).catch(function(){ return null; });
}

function nubeMiPerfil(){
  if(!nubeHay()) return Promise.resolve(null);
  return nubePedir("/auth/v1/user", {method: "GET"}).then(function(u){
    if(!u || !u.id) return null;
    return nubePedir("/rest/v1/perfiles?id=eq." + u.id + "&select=*", {method: "GET"});
  }).then(function(f){ return (f && f[0]) || null; })
    .catch(function(){ return null; });
}

function nubeSalir(){
  if(nubeHay()) nubePedir("/auth/v1/logout", {method: "POST"}).catch(function(){});
  Nube.sesion = null; Nube.perfil = null; Nube.estado = "sin entrar";
  nubeCallarse();
  try{ localStorage.removeItem("almacen_nube_sesion"); }catch(e){}
}

/* Al abrir la app se reusa la sesión guardada, si sigue viva */
function nubeRecordar(){
  var g = null;
  try{ g = JSON.parse(localStorage.getItem("almacen_nube_sesion") || "null"); }catch(e){}
  if(!g || !g.access_token) return Promise.resolve(null);
  Nube.sesion = g;
  return nubeMiPerfil().then(function(p){
    if(p){ Nube.perfil = p; Nube.estado = "en línea"; return p; }
    /* el pase guardado ya venció: se cambia por uno nuevo con el vale,
       que es lo normal al abrir la app a la mañana siguiente */
    return nubeRenovar().then(function(){
      return nubeMiPerfil().then(function(p2){
        if(p2){ Nube.perfil = p2; Nube.estado = "en línea"; return p2; }
        return null;
      });
    }).catch(function(){
      Nube.sesion = null;
      try{ localStorage.removeItem("almacen_nube_sesion"); }catch(e){}
      return null;
    });
  });
}

/* ---------------------------------------------------------------------
   TRAER LO QUE HAY

   Se baja entero la primera vez. Son unos pocos cientos de renglones:
   pedir cambios incrementales aquí complicaría el código para ahorrar
   un segundo que nadie nota.
   --------------------------------------------------------------------- */
function nubeTraerTodo(){
  if(!nubeHay()) return Promise.resolve(null);
  var traido = {};
  return NUBE_TABLAS.reduce(function(cadena, t){
    return cadena.then(function(){
      return nubePedir("/rest/v1/" + t + "?select=*&eliminado_en=is.null&limit=5000", {method: "GET"})
        .then(function(filas){ traido[t] = filas || []; })
        .catch(function(){ traido[t] = null; });   /* sin permiso para esa tabla */
    });
  }, Promise.resolve()).then(function(){
    Nube.ultima = new Date().toISOString();
    return traido;
  });
}

/* ---------------------------------------------------------------------
   GUARDAR

   Un requerimiento son dos tablas: la cabecera y sus puntos. Se manda
   la cabecera, la base devuelve su id, y con ese id van los puntos.
   --------------------------------------------------------------------- */
function nubeGuardarRequerimiento(r){
  if(!nubeHay()) return Promise.resolve(null);
  var cab = {
    codigo: r.codigo, fecha: r.fecha, solicitante: r.solicitante,
    area: r.area || null, frente: r.frente || null, estado: r.estado || "pendiente",
    proyecto: r.proyecto || null
  };
  if(Nube.perfil) cab.levantado_por = Nube.perfil.id;

  return nubePedir("/rest/v1/requerimientos?on_conflict=codigo", {
    method: "POST",
    headers: {"Prefer": "resolution=merge-duplicates,return=representation"},
    body: JSON.stringify(cab)
  }).then(function(filas){
    var id = filas && filas[0] && filas[0].id;
    if(!id) throw new Error("La base no devolvió el pedido guardado.");
    r.nubeId = id;
    /* los puntos se reemplazan enteros: es más simple y más seguro que
       adivinar cuál cambió, y son cinco o seis por pedido */
    return nubePedir("/rest/v1/requerimiento_items?requerimiento_id=eq." + id, {method: "DELETE"})
      .catch(function(){})
      .then(function(){
        if(!r.items.length) return null;
        return nubePedir("/rest/v1/requerimiento_items", {
          method: "POST",
          body: JSON.stringify(r.items.map(function(i, k){
            return {requerimiento_id: id, orden: k + 1, descripcion: i.desc,
                    unidad: i.und || "und", cantidad: num(i.cant),
                    solicitante: i.sol || null, frente: i.frente || null,
                    observaciones: i.obs || null,
                    fecha_requerida: i.fechaObra || null,
                    validado: !!i.validado,
                    motivo_devolucion: i.motivo || null,
                    devuelto_en: i.devuelto ? (i.devueltoEn || new Date().toISOString()) : null};
          }))
        });
      });
  });
}

function nubeQuitarRequerimiento(r){
  if(!nubeHay() || !r) return Promise.resolve(null);
  /* DELETE no borra: el disparador lo convierte en lápida, y así los
     celulares que estaban sin señal se enteran de la baja */
  return nubePedir("/rest/v1/requerimientos?codigo=eq." + encodeURIComponent(r.codigo),
                   {method: "DELETE"}).catch(function(){ return null; });
}

/* El stock nunca se escribe: se manda el cambio y la base suma. Así dos
   personas entregando a la vez no se pisan la una a la otra. */
function nubeMoverStock(materialId, delta, tipo, extra){
  if(!nubeHay()) return Promise.resolve(null);
  var e = extra || {};
  return nubePedir("/rest/v1/rpc/update_add_stock", {
    method: "POST",
    body: JSON.stringify({
      p_material_id: materialId, p_delta: delta, p_tipo: tipo,
      p_documento: e.documento || null, p_persona: e.persona || null,
      p_frente: e.frente || null, p_guia_id: e.guiaId || null,
      p_idempotencia: e.idempotencia || (Date.now() + "-" + Math.random().toString(36).slice(2))
    })
  });
}

/* ---------------------------------------------------------------------
   TIEMPO REAL

   Lo que registra el almacén aparece en el celular de Obra sin recargar.
   Se abre un solo canal para las once tablas: uno por tabla gastaría
   once conexiones para lo mismo.
   --------------------------------------------------------------------- */
function nubeEscuchar(){
  if(!nubeHay() || Nube.ws) return;
  var url = NUBE_URL.replace(/^https/, "wss") + "/realtime/v1/websocket?apikey=" +
            NUBE_CLAVE + "&vsn=1.0.0";
  var ws;
  try{ ws = new WebSocket(url); }catch(e){ return; }
  Nube.ws = ws;

  ws.onopen = function(){
    ws.send(JSON.stringify({
      topic: "realtime:almacen", event: "phx_join", ref: "1",
      payload: {config: {
        broadcast: {ack: false}, presence: {key: ""},
        postgres_changes: NUBE_TABLAS.map(function(t){
          return {event: "*", schema: "public", table: t};
        })
      }}
    }));
    /* sin el latido el servidor corta la conexión al minuto */
    Nube.latido = setInterval(function(){
      try{ ws.send(JSON.stringify({topic: "phoenix", event: "heartbeat", ref: "h", payload: {}})); }
      catch(e){}
    }, 25000);
  };

  ws.onmessage = function(ev){
    var m;
    try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.event !== "postgres_changes") return;
    var d = m.payload && m.payload.data;
    if(!d) return;
    if(typeof Nube.alCambiar === "function") Nube.alCambiar(d.table, d.type, d.record || d.old_record);
  };

  ws.onclose = function(){
    Nube.ws = null;
    clearInterval(Nube.latido);
    /* se reintenta: en la mina la señal va y viene todo el día */
    if(nubeHay()) setTimeout(nubeEscuchar, 5000);
  };
  ws.onerror = function(){ try{ ws.close(); }catch(e){} };
}

function nubeCallarse(){
  clearInterval(Nube.latido);
  if(Nube.ws){ try{ Nube.ws.close(); }catch(e){} Nube.ws = null; }
}

/* ---------------------------------------------------------------------
   LO QUE NO SUBIÓ

   En la mina se corta la cobertura a media mañana. Lo que se hizo sin
   señal queda anotado y se reintenta solo cuando vuelve. La clave de
   idempotencia hace que reintentar no duplique nada.
   --------------------------------------------------------------------- */
var NUBE_COLA = "almacen_cola_nube";

function nubeEncolar(op, carga){
  var c = [];
  try{ c = JSON.parse(localStorage.getItem(NUBE_COLA) || "[]"); }catch(e){}
  c.push({op: op, carga: carga, fecha: Date.now(),
          idempotencia: Date.now() + "-" + Math.random().toString(36).slice(2)});
  try{ localStorage.setItem(NUBE_COLA, JSON.stringify(c)); }catch(e){}
}

function nubeSubirPendientes(){
  if(!nubeHay()) return Promise.resolve({subidos: 0, quedan: 0});
  var c = [];
  try{ c = JSON.parse(localStorage.getItem(NUBE_COLA) || "[]"); }catch(e){}
  if(!c.length) return Promise.resolve({subidos: 0, quedan: 0});

  var quedan = [], subidos = 0;
  return c.reduce(function(cadena, p){
    return cadena.then(function(){
      var accion = p.op === "requerimiento" ? nubeGuardarRequerimiento(p.carga)
                 : p.op === "quitar"        ? nubeQuitarRequerimiento(p.carga)
                 : Promise.resolve(null);
      return accion.then(function(){ subidos++; })
                   .catch(function(){ quedan.push(p); });
    });
  }, Promise.resolve()).then(function(){
    try{ localStorage.setItem(NUBE_COLA, JSON.stringify(quedan)); }catch(e){}
    return {subidos: subidos, quedan: quedan.length};
  });
}

function nubePendientes(){
  try{ return (JSON.parse(localStorage.getItem(NUBE_COLA) || "[]")).length; }
  catch(e){ return 0; }
}

window.addEventListener("online", function(){ nubeSubirPendientes(); });
