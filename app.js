/* =====================================================================
   ALMACEN CPQ · El motor

   Toda la logica de la app: pedidos, inventario, herramientas, prestamos,
   stock, reportes, permisos y el flujo de estados. Es lo mismo en
   computadora y en celular, y se arregla UNA vez.

   Lo que cambia entre un equipo y otro —como se acomoda la pantalla— va
   en computadora.js y celular.js, que se leen despues de este archivo y
   pueden envolver lo que haga falta.
   ===================================================================== */
"use strict";

/* =====================================================================
   1. ESQUEMA DE DATOS  (estructurado para sincronizar luego con
      Google Sheets / Excel / Firebase / Supabase: cada registro lleva
      id, fechas y autor, y ninguna tabla depende del orden del arreglo)
   ===================================================================== */
const CLAVE = "almacen_v3";
const CLAVE_SESION = "almacen_sesion_v3";
const CLAVES_VIEJAS = ["almacen_minero_v2", "almacen_minero_v1"];

let db = null, sesion = null;
const fotos = {}, adjuntos = {};
let itemsReq = [];

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function ahora(){ return new Date().toISOString(); }
/* Los sellos de tiempo se guardan en UTC; los reportes del día trabajan en hora local. */
function diaLocal(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d)) return String(iso).slice(0,10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
}

function esquema(){
  return {
    version:3,
    usuarios:[], solicitudes:[], personal:[],
    materiales:[], herramientas:[], requerimientos:[],
    movimientos:[], notificaciones:[], historial:[],
    consolidado:{archivo:"", cargado:null, items:[]},
    correlativos:{MAT:0, HER:0, REQ:0},
    config:{destinatarios:"Administración · Jefatura de Logística · Gerencia General", obra:""}
  };
}

function codigo(prefijo){
  db.correlativos[prefijo] = (db.correlativos[prefijo] || 0) + 1;
  return prefijo + "-" + String(db.correlativos[prefijo]).padStart(4, "0");
}
function codigoReq(){
  db.correlativos.REQ = (db.correlativos.REQ || 0) + 1;
  return "REQ-" + new Date().getFullYear() + "-" + String(db.correlativos.REQ).padStart(3, "0");
}

function normalizar(d){
  const base = esquema();
  Object.keys(base).forEach(k => { if(d[k] === undefined) d[k] = base[k]; });
  ["usuarios","solicitudes","personal","materiales","herramientas",
   "requerimientos","movimientos","notificaciones","historial"].forEach(k => {
    if(!Array.isArray(d[k])) d[k] = [];
  });
  if(!d.consolidado || !Array.isArray(d.consolidado.items)) d.consolidado = base.consolidado;
  if(!d.correlativos) d.correlativos = base.correlativos;
  if(!d.config) d.config = base.config;

  d.correlativos.MAT = Math.max(d.correlativos.MAT || 0, d.materiales.length);
  d.correlativos.HER = Math.max(d.correlativos.HER || 0, d.herramientas.length);
  d.correlativos.REQ = Math.max(d.correlativos.REQ || 0, d.requerimientos.length);

  let nm = 0, nh = 0;
  d.materiales.forEach(m => {
    if(!m.codigo) m.codigo = "MAT-" + String(++nm).padStart(4,"0");
    if(!m.categoria) m.categoria = "General";
    if(m.foto === undefined) m.foto = null;
    if(m.obs === undefined) m.obs = "";
    if(m.creado === undefined) m.creado = ahora();
    if(m.minimo === undefined) m.minimo = 0;
  });
  d.herramientas.forEach(h => {
    if(!h.codigo) h.codigo = "HER-" + String(++nh).padStart(4,"0");
    if(h.marca === undefined) h.marca = "";
    if(h.modelo === undefined) h.modelo = "";
    if(h.serie === undefined) h.serie = "";
    if(h.foto === undefined) h.foto = null;
    if(h.categoria === undefined) h.categoria = "Herramienta";
    if(h.prestamo === undefined) h.prestamo = null;
    if(h.estado === undefined) h.estado = "disponible";
  });
  d.requerimientos.forEach(r => {
    if(!Array.isArray(r.notas)) r.notas = [];
    if(!Array.isArray(r.historial)) r.historial = [];
    if(r.obra === undefined) r.obra = "";
    if(r.pdf === undefined) r.pdf = null;
  });
  d.version = 3;
  return d;
}

function cargar(){
  let crudo = localStorage.getItem(CLAVE);
  if(!crudo) for(var i = 0; i < CLAVES_VIEJAS.length; i++){
    crudo = localStorage.getItem(CLAVES_VIEJAS[i]);
    if(crudo) break;
  }
  try{ if(crudo) return normalizar(JSON.parse(crudo)); }
  catch(e){ console.error("Datos ilegibles:", e); }
  return esquema();
}

function guardar(){
  try{ localStorage.setItem(CLAVE, JSON.stringify(db)); return true; }
  catch(e){
    snack("Almacenamiento lleno. Descargue un respaldo y depure registros antiguos.", "err");
    return false;
  }
}

/* --------- registro de actividad (logs) --------- */
function log(modulo, accion, detalle, refId){
  db.historial.unshift({
    id:uid(), fecha:ahora(), modulo, accion, detalle:detalle || "", refId:refId || null,
    usuarioId: sesion ? sesion.usuarioId : null,
    usuario: usuarioActual() ? usuarioActual().nombre : "sistema"
  });
  if(db.historial.length > 900) db.historial.length = 900;
}

/* =====================================================================
   2. ROLES Y PERMISOS
   ===================================================================== */
const ROLES = {
  admin:{
    nombre:"Administrador de la app", corto:"Administrador", permisos:"*",
    resumen:"Acceso total: todos los módulos, gestión de usuarios, solicitudes de acceso y actividad de todo el equipo."
  },
  almacenero:{
    nombre:"Almacenero", corto:"Almacenero",
    permisos:["pedidos.ver","pedidos.todos","pedidos.crear","pedidos.excel","pedidos.consolidar","pedidos.recibir",
              "pedidos.atender","recepcion","guias","entregas","inventario","inventario.editar","herramientas","prestamos",
              "equipos","consolidado","consolidado.editar","movimientos","kardex","personal","reportes",
              "notificaciones","historial.propio","fotos"],
    resumen:"Recibe los pedidos de los supervisores, los envía a logística, y maneja inventario, herramientas, préstamos, ingresos por guía, consolidado y reportes."
  },
  obra:{
    nombre:"Administradora de Obra", corto:"Adm. de Obra",
    permisos:["pedidos.ver","pedidos.todos","pedidos.crear","pedidos.excel","pedidos.recibir","pedidos.consolidar",
              "pedidos.atender","pedidos.priorizar","recepcion","guias","entregas","inventario","inventario.editar",
              "herramientas","prestamos","equipos","consolidado","consolidado.editar","movimientos","kardex",
              "personal","reportes","dashboard","indicadores","analitica","compras.ver","notificaciones",
              "historial.propio","fotos"],
    resumen:"Recibe y consolida los pedidos de los supervisores para enviarlos a logística, además de todo lo del almacenero e indicadores."
  },
  supervisor:{
    nombre:"Supervisor de disciplina", corto:"Supervisor",
    permisos:["pedidos.ver","pedidos.crear","pedidos.excel","inventario","consolidado",
              "notificaciones","historial.propio","fotos","recepcion"],
    resumen:"Registra sus requerimientos diarios (a mano o desde Excel) y los envía a la Administradora de Obra y al Almacén. Ve solo sus propios pedidos, el inventario y el consolidado."
  },
  compras:{
    nombre:"Asistente de Logística (Compras)", corto:"Compras",
    permisos:["pedidos.ver","pedidos.todos","compras","compras.ver","cotizaciones","proveedores","guias",
              "consolidado","consolidado.editar","notificaciones","historial.propio","fotos","kardex"],
    resumen:"Órdenes de compra, despachos, guías de remisión en PDF y actualización de estados."
  },
  jefatura:{
    nombre:"Jefa de Logística", corto:"Jefatura",
    permisos:["pedidos.ver","pedidos.todos","pedidos.aprobar","pedidos.priorizar","compras","compras.ver",
              "compras.aprobar","cotizaciones","proveedores","inventario","inventario.editar","kardex",
              "movimientos","consolidado","dashboard","indicadores","analitica","reportes","recepcion","guias",
              "notificaciones","historial.propio","fotos"],
    resumen:"Supervisar el flujo, aprobar o rechazar requerimientos, indicadores, reportes y tiempos de atención."
  }
};

const PANTALLAS = {
  inicio:        {titulo:"Inicio",                  icono:"inicio",     perm:null},
  pedidos:       {titulo:"Pedidos",                 icono:"pedidos",    perm:"pedidos.ver"},
  inventario:    {titulo:"Inventario",              icono:"inventario", perm:"inventario"},
  consolidado:   {titulo:"Consolidado de obra",     icono:"tabla",      perm:"consolidado"},
  herramientas:  {titulo:"Herramientas",            icono:"llave",      perm:"herramientas"},
  compras:       {titulo:"Compras y despachos",     icono:"carrito",    perm:"compras.ver"},
  movimientos:   {titulo:"Movimientos",             icono:"camion",     perm:"movimientos"},
  notificaciones:{titulo:"Notificaciones",          icono:"campana",    perm:"notificaciones"},
  historial:     {titulo:"Historial",               icono:"reloj",      perm:"historial.propio"},
  indicadores:   {titulo:"Indicadores",             icono:"grafico",    perm:"indicadores"},
  reportes:      {titulo:"Reportes",                icono:"documento",  perm:"reportes"},
  personal:      {titulo:"Personal de obra",        icono:"personas",   perm:"personal"},
  admin:         {titulo:"Panel de administración", icono:"escudo",     perm:"usuarios"},
  mas:           {titulo:"Más",                     icono:"mas",        perm:null},
  login:         {titulo:"Iniciar sesión",          icono:"inicio",     perm:null},
  solicitud:     {titulo:"Solicitud de acceso",     icono:"usuario",    perm:null}
};

const MENU = ["inicio","pedidos","inventario","consolidado","mas"];

function usuarioActual(){ return sesion ? db.usuarios.find(u => u.id === sesion.usuarioId) : null; }

function rolEfectivo(){
  const u = usuarioActual();
  if(!u) return null;
  return (u.esAdmin && sesion.modo === "admin") ? "admin" : u.rol;
}

/* Permisos que suma cada disciplina de supervisión (sección 3 del alcance). */
const EXTRA_DISCIPLINA = {
  "Civil":     ["recepcion"],
  "Mecánico":  ["herramientas", "prestamos", "equipos", "recepcion"],
  "Eléctrico": ["materiales.electricos", "recepcion"]
};

function puede(permiso){
  const rol = rolEfectivo();
  if(!rol) return false;
  const p = ROLES[rol].permisos;
  if(p === "*") return true;
  if(p.indexOf(permiso) >= 0) return true;

  const u = usuarioActual();
  if(!u) return false;
  if(rol === "supervisor"){
    const ex = EXTRA_DISCIPLINA[u.area] || [];
    if(ex.indexOf(permiso) >= 0) return true;
  }
  return Array.isArray(u.permisosExtra) && u.permisosExtra.indexOf(permiso) >= 0;
}

/* =====================================================================
   3. ICONOGRAFÍA (SVG en línea, trazo 24x24)
   ===================================================================== */
const ICONOS = {
  inicio:'<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  pedidos:'<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9.5 4h5v2.5h-5z"/><path d="M9 11.5h6M9 15.5h4"/>',
  inventario:'<path d="M3.5 8.2 12 4l8.5 4.2-8.5 4.2z"/><path d="M3.5 8.2v7.6L12 20l8.5-4.2V8.2"/><path d="M12 12.4V20"/>',
  tabla:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
  llave:'<path d="M19.5 5.2a4.4 4.4 0 0 1-5.6 5.6l-7 7a2.2 2.2 0 0 1-3.1-3.1l7-7a4.4 4.4 0 0 1 5.6-5.6l-2.5 2.5 1.5 1.5z"/>',
  carrito:'<circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/><path d="M3 4.5h2.2l2.4 10.5h10L20 8H6.2"/>',
  camion:'<rect x="2.5" y="7" width="11" height="9" rx="1.5"/><path d="M13.5 10h3.8l3.2 3.2V16h-7z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/>',
  campana:'<path d="M6.5 10a5.5 5.5 0 1 1 11 0c0 3.6 1.5 5 1.5 5h-14s1.5-1.4 1.5-5z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  reloj:'<circle cx="12" cy="12" r="8.2"/><path d="M12 7.2V12l3 2"/>',
  grafico:'<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.4" height="6"/><rect x="10.3" y="7.5" width="3.4" height="10.5"/><rect x="15.6" y="10" width="3.4" height="8"/>',
  documento:'<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 13h6M9 16.5h4"/>',
  personas:'<circle cx="9" cy="8.5" r="3.2"/><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a6 6 0 0 0-2-4.3"/>',
  escudo:'<path d="M12 3.2 19 6v6c0 4.2-3 7.3-7 8.8-4-1.5-7-4.6-7-8.8V6z"/><path d="M9.2 12.2l2 2 3.6-3.8"/>',
  mas:'<circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  usuario:'<circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  salir:'<path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3"/><path d="M10 8.5 6 12l4 3.5"/><path d="M6 12h9"/>',
  camara:'<path d="M3.5 8.5h3L8 6.5h8l1.5 2h3v10h-17z"/><circle cx="12" cy="13.5" r="3.4"/>',
  pdf:'<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 16.8v-3.4h1.2a1.2 1.2 0 0 1 0 2.3H8.6M13 16.8v-3.4h1a1.7 1.7 0 0 1 0 3.4z"/>',
  agregar:'<path d="M12 5.5v13M5.5 12h13"/>',
  cerrar:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check:'<path d="M5 12.5 9.8 17.3 19 7.5"/>',
  buscar:'<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-4.6-4.6"/>',
  editar:'<path d="M4.5 19.5h3.6L19 8.6a1.8 1.8 0 0 0 0-2.6l-1-1a1.8 1.8 0 0 0-2.6 0L4.5 15.9z"/>',
  borrar:'<path d="M4.5 6.8h15M9.5 6.8V4.5h5v2.3M6.5 6.8 7.6 20h8.8l1.1-13.2"/>',
  bloquear:'<circle cx="12" cy="12" r="8.2"/><path d="M6.4 6.4l11.2 11.2"/>',
  cambiar:'<path d="M4.5 8.5h13l-3.2-3.2M19.5 15.5h-13l3.2 3.2"/>',
  descargar:'<path d="M12 4v11M8 11.5l4 4 4-4"/><path d="M4.5 20h15"/>',
  subir:'<path d="M12 20V9M8 12.5l4-4 4 4"/><path d="M4.5 4.5h15"/>',
  compartir:'<circle cx="18" cy="6" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.7 15.7 7.3M8.3 13.3l7.4 3.4"/>',
  alerta:'<path d="M12 4.2 2.8 20h18.4z"/><path d="M12 10v4.2M12 17.2h.01"/>',
  caja:'<rect x="3.5" y="6.5" width="17" height="13" rx="2"/><path d="M3.5 10.5h17M12 6.5v13"/>',
  volver:'<path d="M15 5 8 12l7 7"/>',
  flecha:'<path d="M9 5l7 7-7 7"/>'
};

function ico(nombre, tam, clase){
  return '<svg class="ico ' + (clase || "") + '" viewBox="0 0 24 24" width="' + (tam || 22) +
    '" height="' + (tam || 22) + '" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONOS[nombre] || "") + "</svg>";
}

/* =====================================================================
   4. UTILIDADES DE INTERFAZ
   ===================================================================== */
const $  = id => document.getElementById(id);
const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));

function esc(t){
  return String(t == null ? "" : t)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function num(v){ const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; }
function hoyISO(){
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
}
function fecha(iso){
  const d = new Date(iso);
  return d.toLocaleDateString("es-PE",{day:"2-digit",month:"2-digit",year:"2-digit"}) + " " +
         d.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
}
function soloFecha(iso){
  if(!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString("es-PE",{day:"2-digit",month:"2-digit",year:"2-digit"});
}
function horas(desde, hasta){ return (new Date(hasta) - new Date(desde)) / 3600000; }
function duracion(h){
  if(h == null || isNaN(h)) return "—";
  if(h < 1)  return Math.max(1, Math.round(h * 60)) + " min";
  if(h < 24) return (Math.round(h * 10) / 10) + " h";
  return (Math.round(h / 24 * 10) / 10) + " días";
}
function hace(iso){
  const h = horas(iso, ahora());
  if(h < 1) return "hace " + Math.max(1, Math.round(h * 60)) + " min";
  if(h < 24) return "hace " + Math.round(h) + " h";
  if(h < 48) return "ayer";
  return soloFecha(iso);
}
function iniciales(nombre){
  return String(nombre || "?").split(/\s+/).slice(0,2).map(p => p[0] || "").join("").toUpperCase();
}
function sinTildes(s){
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
}

function snack(msg, tipo){
  const t = $("snack");
  t.textContent = msg;
  t.className = "snack ver " + (tipo || "");
  if(navigator.vibrate) navigator.vibrate(tipo === "err" ? [35,50,35] : 12);
  clearTimeout(snack._t);
  snack._t = setTimeout(()=> t.className = "snack", 3000);
}

/* --------- hoja inferior --------- */
function hoja(titulo, cuerpo, botones){
  $("hoja-cab").textContent = titulo;
  $("hoja-cuerpo").innerHTML = cuerpo;
  $("hoja-pie").innerHTML = "";
  (botones || [{txt:"Cerrar", clase:"btn-cont"}]).forEach(b => {
    const el = document.createElement("button");
    el.className = "btn " + (b.clase || "btn-cont");
    el.textContent = b.txt;
    el.addEventListener("click", ()=>{ cerrarHoja(); if(b.fn) b.fn(); });
    $("hoja-pie").appendChild(el);
  });
  $("hoja").classList.add("abierta");
}
function cerrarHoja(){ $("hoja").classList.remove("abierta"); }
$("hoja").addEventListener("click", e => { if(e.target.id === "hoja") cerrarHoja(); });

function confirmar(titulo, texto, textoOk){
  return new Promise(res => {
    hoja(titulo, '<p style="margin:4px 0 12px;color:var(--tinta-sec)">' + esc(texto) + "</p>", [
      {txt:"Cancelar", clase:"btn-cont", fn:()=> res(false)},
      {txt:textoOk || "Confirmar", clase:"btn-pri", fn:()=> res(true)}
    ]);
  });
}
function pedirTexto(titulo, etiqueta, valor){
  return new Promise(res => {
    hoja(titulo, "<label>" + esc(etiqueta) + '</label><input type="text" id="hoja-input" value="' + esc(valor || "") + '">',
      [{txt:"Cancelar", clase:"btn-cont", fn:()=> res(null)},
       {txt:"Aceptar", clase:"btn-pri", fn:()=> res(($("hoja-input") || {}).value)}]);
    setTimeout(()=>{ const i = $("hoja-input"); if(i) i.focus(); }, 90);
  });
}

/* --------- modales --------- */
function abrirModal(id){
  $(id).classList.add("abierto");
  const c = $(id).querySelector(".cuerpo");
  if(c) c.scrollTop = 0;
}
function cerrarModal(id){ $(id).classList.remove("abierto"); }

/* --------- visor de imágenes --------- */
document.addEventListener("click", e => {
  const src = e.target.dataset && e.target.dataset.zoom;
  if(!src) return;
  const v = document.createElement("div");
  v.id = "visor";
  v.innerHTML = '<img src="' + src + '" alt="evidencia"><button class="cerrar">Cerrar</button>';
  v.addEventListener("click", ()=> v.remove());
  document.body.appendChild(v);
});

/* =====================================================================
   5. ARCHIVOS PESADOS (PDF) EN IndexedDB
   ===================================================================== */
const Archivos = (function(){
  let bd = null;
  function abrir(){
    return new Promise((res, rej)=>{
      if(bd) return res(bd);
      const r = indexedDB.open("almacen_archivos", 1);
      r.onupgradeneeded = ()=> r.result.createObjectStore("archivos");
      r.onsuccess = ()=>{ bd = r.result; res(bd); };
      r.onerror = ()=> rej(r.error);
    });
  }
  return {
    async guardar(id, blob){
      const d = await abrir();
      return new Promise((res, rej)=>{
        const t = d.transaction("archivos", "readwrite");
        t.objectStore("archivos").put(blob, id);
        t.oncomplete = ()=> res(id);
        t.onerror = ()=> rej(t.error);
      });
    },
    async leer(id){
      const d = await abrir();
      return new Promise((res, rej)=>{
        const t = d.transaction("archivos", "readonly");
        const p = t.objectStore("archivos").get(id);
        p.onsuccess = ()=> res(p.result || null);
        p.onerror = ()=> rej(p.error);
      });
    },
    async borrar(id){
      const d = await abrir();
      return new Promise(res=>{
        const t = d.transaction("archivos", "readwrite");
        t.objectStore("archivos").delete(id);
        t.oncomplete = ()=> res(true);
      });
    }
  };
})();

async function verPDF(ref){
  if(!ref) return;
  const blob = await Archivos.leer(ref.id);
  if(!blob) return snack("El PDF ya no está disponible en este dispositivo.", "err");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(()=> URL.revokeObjectURL(url), 60000);
}

/* =====================================================================
   6. FOTOS Y ADJUNTOS
   ===================================================================== */
function comprimir(archivo, maxLado, calidad){
  maxLado = maxLado || 720; calidad = calidad || 0.65;
  return new Promise((resolve, reject)=>{
    const lector = new FileReader();
    lector.onerror = reject;
    lector.onload = ()=>{
      const img = new Image();
      img.onerror = reject;
      img.onload = ()=>{
        const k = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

function initFoto(id){
  const inp = $(id), prev = $(id + "-prev");
  if(!inp || !prev) return;
  inp.addEventListener("change", async ()=>{
    const archivo = inp.files[0];
    if(!archivo) return limpiarFoto(id);
    prev.innerHTML = '<span class="ayuda">Procesando imagen…</span>';
    try{
      const datos = await comprimir(archivo);
      fotos[id] = datos;
      prev.innerHTML = '<img src="' + datos + '" class="thumb" data-zoom="' + datos + '" alt="vista previa">' +
        '<span class="ayuda" style="margin:0">Foto lista</span>' +
        '<button class="quitar" data-quitar="' + id + '">Quitar</button>';
    }catch(e){
      fotos[id] = null;
      prev.innerHTML = '<span class="ayuda err" style="margin:0">No se pudo leer la imagen</span>';
    }
  });
}

function limpiarFoto(id){
  fotos[id] = null;
  const i = $(id); if(i) i.value = "";
  const p = $(id + "-prev"); if(p) p.innerHTML = "";
}

function initArchivo(id){
  const inp = $(id), prev = $(id + "-prev");
  if(!inp || !prev) return;
  inp.addEventListener("change", async ()=>{
    const archivo = inp.files[0];
    if(!archivo) return limpiarArchivo(id);
    if(archivo.type !== "application/pdf"){
      prev.innerHTML = '<span class="ayuda err" style="margin:0">Solo se aceptan archivos PDF</span>';
      inp.value = "";
      return;
    }
    if(archivo.size > 12 * 1024 * 1024){
      prev.innerHTML = '<span class="ayuda err" style="margin:0">El PDF supera 12 MB</span>';
      inp.value = "";
      return;
    }
    const ref = {id:uid(), nombre:archivo.name, tam:archivo.size, tipo:"application/pdf"};
    try{
      await Archivos.guardar(ref.id, archivo);
      adjuntos[id] = ref;
      prev.innerHTML = '<span class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--mal)">' +
        ico("pdf", 28) + "</span>" +
        '<span class="ayuda" style="margin:0"><b>' + esc(ref.nombre) + "</b><br>" +
        Math.round(ref.tam / 1024) + " KB</span>" +
        '<button class="quitar" data-quitar-arch="' + id + '">Quitar</button>';
    }catch(e){
      prev.innerHTML = '<span class="ayuda err" style="margin:0">No se pudo guardar el PDF</span>';
    }
  });
}

function limpiarArchivo(id){
  adjuntos[id] = null;
  const i = $(id); if(i) i.value = "";
  const p = $(id + "-prev"); if(p) p.innerHTML = "";
}

document.addEventListener("click", e => {
  const t = e.target.closest ? e.target.closest("[data-quitar],[data-quitar-arch]") : null;
  if(!t) return;
  if(t.dataset.quitar) limpiarFoto(t.dataset.quitar);
  if(t.dataset.quitarArch) limpiarArchivo(t.dataset.quitarArch);
});

/* =====================================================================
   7. EXCEL — lectura y escritura sin librerías externas
   ===================================================================== */
function letraCol(i){
  let s = ""; i++;
  while(i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function indiceCol(letras){
  let n = 0;
  for(let i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
  return n - 1;
}
function escXML(t){
  return String(t == null ? "" : t)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");
}

async function inflar(bytes, metodo){
  if(metodo === 0) return bytes;
  if(typeof DecompressionStream === "undefined")
    throw new Error("Este navegador no puede abrir .xlsx comprimidos. Guarde el archivo como CSV.");
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

function abrirZip(buffer){
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
  let fin = -1;
  for(let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--){
    if(dv.getUint32(i, true) === 0x06054b50){ fin = i; break; }
  }
  if(fin < 0) throw new Error("El archivo no parece un Excel válido.");
  const total = dv.getUint16(fin + 10, true);
  let off = dv.getUint32(fin + 16, true);
  const archivos = {}, dec = new TextDecoder();
  for(let n = 0; n < total; n++){
    if(dv.getUint32(off, true) !== 0x02014b50) break;
    const metodo   = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nomLen   = dv.getUint16(off + 28, true);
    const extLen   = dv.getUint16(off + 30, true);
    const comLen   = dv.getUint16(off + 32, true);
    const local    = dv.getUint32(off + 42, true);
    archivos[dec.decode(u8.subarray(off + 46, off + 46 + nomLen))] = {metodo, compSize, local};
    off += 46 + nomLen + extLen + comLen;
  }
  return {dv, u8, archivos};
}

async function leerDelZip(zip, nombre){
  const e = zip.archivos[nombre];
  if(!e) return null;
  const nomLen = zip.dv.getUint16(e.local + 26, true);
  const extLen = zip.dv.getUint16(e.local + 28, true);
  const ini = e.local + 30 + nomLen + extLen;
  return new TextDecoder().decode(await inflar(zip.u8.subarray(ini, ini + e.compSize), e.metodo));
}

async function leerXLSX(archivo){
  const zip = abrirZip(await archivo.arrayBuffer());
  const compartidas = [];
  const ss = await leerDelZip(zip, "xl/sharedStrings.xml");
  if(ss){
    const doc = new DOMParser().parseFromString(ss, "application/xml");
    Array.prototype.forEach.call(doc.getElementsByTagName("si"), si => {
      let t = "";
      Array.prototype.forEach.call(si.getElementsByTagName("t"), n => { t += n.textContent; });
      compartidas.push(t);
    });
  }
  let hoja = "xl/worksheets/sheet1.xml";
  if(!zip.archivos[hoja]) hoja = Object.keys(zip.archivos).filter(n => /^xl\/worksheets\/.+\.xml$/.test(n))[0];
  if(!hoja) throw new Error("El Excel no tiene hojas legibles.");

  const doc = new DOMParser().parseFromString(await leerDelZip(zip, hoja), "application/xml");
  const filas = [];
  Array.prototype.forEach.call(doc.getElementsByTagName("row"), row => {
    const fila = [];
    Array.prototype.forEach.call(row.getElementsByTagName("c"), c => {
      const ref = (c.getAttribute("r") || "").replace(/\d+/g, "");
      const col = ref ? indiceCol(ref) : fila.length;
      const tipo = c.getAttribute("t");
      let val = "";
      if(tipo === "inlineStr"){
        Array.prototype.forEach.call(c.getElementsByTagName("t"), n => { val += n.textContent; });
      }else{
        const v = c.getElementsByTagName("v")[0];
        val = v ? v.textContent : "";
        if(tipo === "s") val = compartidas[+val] || "";
      }
      fila[col] = val;
    });
    filas.push(fila);
  });
  return filas;
}

function leerCSV(texto){
  const primera = texto.split("\n")[0] || "";
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ";" : ",";
  const filas = [];
  let campo = "", fila = [], comillas = false;
  for(let i = 0; i < texto.length; i++){
    const ch = texto[i];
    if(comillas){
      if(ch === '"' && texto[i+1] === '"'){ campo += '"'; i++; }
      else if(ch === '"') comillas = false;
      else campo += ch;
    }else if(ch === '"') comillas = true;
    else if(ch === sep){ fila.push(campo); campo = ""; }
    else if(ch === "\n"){ fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if(ch !== "\r") campo += ch;
  }
  if(campo !== "" || fila.length){ fila.push(campo); filas.push(fila); }
  return filas;
}

async function leerTabla(archivo){
  if(/\.csv$/i.test(archivo.name)) return leerCSV(await archivo.text());
  return leerXLSX(archivo);
}

function crc32(u8){
  let tabla = crc32.t;
  if(!tabla){
    tabla = crc32.t = new Uint32Array(256);
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      tabla[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for(let i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ tabla[(crc ^ u8[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function armarZip(archivos){
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0, n = 0;
  archivos.forEach(a => {
    const datos = enc.encode(a.texto), nom = enc.encode(a.nombre), crc = crc32(datos);
    const lh = new Uint8Array(30 + nom.length), dl = new DataView(lh.buffer);
    dl.setUint32(0, 0x04034b50, true); dl.setUint16(4, 20, true);
    dl.setUint32(14, crc, true); dl.setUint32(18, datos.length, true);
    dl.setUint32(22, datos.length, true); dl.setUint16(26, nom.length, true);
    lh.set(nom, 30);
    partes.push(lh, datos);

    const ch = new Uint8Array(46 + nom.length), dc = new DataView(ch.buffer);
    dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true);
    dc.setUint32(16, crc, true); dc.setUint32(20, datos.length, true);
    dc.setUint32(24, datos.length, true); dc.setUint16(28, nom.length, true);
    dc.setUint32(42, offset, true);
    ch.set(nom, 46);
    central.push(ch);
    offset += lh.length + datos.length;
    n++;
  });
  const tamCentral = central.reduce((s, c)=> s + c.length, 0);
  const fin = new Uint8Array(22), df = new DataView(fin.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, n, true); df.setUint16(10, n, true);
  df.setUint32(12, tamCentral, true); df.setUint32(16, offset, true);
  return new Blob(partes.concat(central, [fin]),
    {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

/* estilos: 0 normal · 1 encabezado azul · 2 relleno verde (completado) */
function hojaXML(filas, estilos){
  const cuerpo = filas.map((f, i)=>{
    const r = i + 1;
    const s = estilos && estilos[i] ? ' s="' + estilos[i] + '"' : "";
    const celdas = (f || []).map((v, c)=>{
      const ref = letraCol(c) + r;
      if(typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"' + s + "><v>" + v + "</v></c>";
      if(v === "" || v == null) return s ? '<c r="' + ref + '"' + s + "/>" : "";
      return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXML(v) + "</t></is></c>";
    }).join("");
    return '<row r="' + r + '">' + celdas + "</row>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    cuerpo + "</sheetData></worksheet>";
}

function crearXLSX(hojas){
  const nombres = hojas.map((h, i)=> (h.nombre || ("Hoja" + (i+1))).replace(/[\[\]\*\/\\\?:]/g, "").slice(0,31));
  const archivos = [
    {nombre:"[Content_Types].xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      hojas.map((h, i)=> '<Override PartName="/xl/worksheets/sheet' + (i+1) +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") +
      "</Types>"},
    {nombre:"_rels/.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/workbook.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      nombres.map((n, i)=> '<sheet name="' + escXML(n) + '" sheetId="' + (i+1) + '" r:id="rId' + (i+1) + '"/>').join("") +
      "</sheets></workbook>"},
    {nombre:"xl/_rels/workbook.xml.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map((h, i)=> '<Relationship Id="rId' + (i+1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        (i+1) + '.xml"/>').join("") +
      '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/styles.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF123566"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF14603C"/><name val="Calibri"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E4F7"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
      "</styleSheet>"}
  ];
  hojas.forEach((h, i)=> archivos.push({nombre:"xl/worksheets/sheet" + (i+1) + ".xml", texto:hojaXML(h.filas, h.estilos)}));
  return armarZip(archivos);
}

function descargarBlob(nombre, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 1500);
}
function descargarTexto(nombre, contenido, mime){
  descargarBlob(nombre, new Blob([contenido], {type:mime || "text/plain;charset=utf-8"}));
}
async function compartirArchivo(nombre, blob, titulo, texto){
  try{
    const archivo = new File([blob], nombre, {type:blob.type});
    if(navigator.canShare && navigator.canShare({files:[archivo]})){
      await navigator.share({files:[archivo], title:titulo, text:texto});
      return true;
    }
  }catch(e){ if(e && e.name === "AbortError") return true; }
  return false;
}

/* =====================================================================
   8. SEGURIDAD Y SESIÓN
   ===================================================================== */
async function hashClave(clave, sal){
  const txt = sal + "::" + clave;
  if(window.crypto && crypto.subtle){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return "s1:" + Array.prototype.map.call(new Uint8Array(buf), b => b.toString(16).padStart(2,"0")).join("");
  }
  let h = 5381;
  for(let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return "f1:" + h.toString(16);
}

/* =====================================================================
   V44 · EL APLICATIVO SALE DESNUDO

   Antes esta parte creaba las cuentas dentro del propio celular: el
   usuario, el cargo y la huella de la contraseña venían escritos en el
   código. Eso ya no va. Las cuentas viven en la base de datos y el
   aplicativo las baja al abrir (ver sync.js y sql/).

   Por qué importa:
     · Un solo padrón. Si se da de baja a alguien, se da de baja en todos
       los equipos, no en el que se acordaron de abrir.
     · Cuando alguien cambia su contraseña, se queda cambiada. Antes el
       arranque volvía a escribir la huella del código encima.
     · El código es público (está en GitHub): ahí no va ninguna huella
       de contraseña.

   Se conserva `nuevoUsuario` porque el administrador sigue creando
   cuentas desde la app; esas sí suben a la base como cualquier registro.
   ===================================================================== */

async function nuevoUsuario(nombre, usuario, clave, rol, cargo, foto, esAdmin, area){
  const sal = uid();
  return {
    id:uid(), nombre, usuario:String(usuario).toLowerCase().trim(), cargo:cargo || "",
    area: area || "", rol, esAdmin: !!esAdmin, sal, hash: await hashClave(clave, sal), hashAlt:null,
    foto: foto || null, activo:true, creado:ahora(), ultimoAcceso:null
  };
}

/* Disciplinas de obra: una cuenta de supervisor por cada una. Las cuentas
   están en la base; acá solo queda la lista de disciplinas, que la usan los
   filtros y los reportes. */
const DISCIPLINAS = ["Civil", "Eléctrico", "Mecánico"];

/* Ya no se siembra nada: las cuentas bajan de la base. Se dejan las
   funciones vacías porque el arranque las llama. */
async function sembrarSupervisores(){ }
async function sembrar(){ }

/* Lo único que se sigue haciendo con las cuentas al arrancar es enderezar
   cargos viejos, para que nadie quede sin pantallas por un rol que ya no
   existe. Nunca se toca la contraseña de nadie. */
function migrarAdmin(){
  const map = {supervisora:"obra"};
  db.usuarios.forEach(u => {
    if(map[u.rol]) u.rol = map[u.rol];
    if(!ROLES[u.rol]) u.rol = "almacenero";
  });
}

async function entrar(usuario, clave){
  const u = db.usuarios.find(x => x.usuario === String(usuario).toLowerCase().trim());
  if(!u){
    const s = db.solicitudes.find(x => x.usuario === String(usuario).toLowerCase().trim() && x.estado === "pendiente");
    if(s) return {ok:false, msg:"Su solicitud de acceso todavía está pendiente de aprobación."};
    return {ok:false, msg:"Usuario o contraseña incorrectos."};
  }
  if(!u.activo) return {ok:false, msg:"Su cuenta está desactivada. Comuníquese con el administrador."};
  const h = await hashClave(clave, u.sal);
  if(h !== u.hash && h !== u.hashAlt) return {ok:false, msg:"Usuario o contraseña incorrectos."};

  u.ultimoAcceso = ahora();
  sesion = {usuarioId:u.id, modo:"normal", desde:ahora()};
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  log("sesion", "Inicio de sesión", u.usuario);
  guardar();
  return {ok:true, usuario:u};
}

function salir(){
  if(sesion) log("sesion", "Cierre de sesión", "");
  guardar();
  sesion = null;
  localStorage.removeItem(CLAVE_SESION);
  cerrarDrawer();
  $$(".modal").forEach(m => m.classList.remove("abierto"));
  $("appbar").classList.add("oculto");
  $("fab").classList.remove("visible");
  $$(".pantalla").forEach(p => p.classList.remove("activa"));
  $("scr-login").classList.add("activa");
  $("lg-clave").value = "";
  $("lg-error").textContent = "";
}

/* =====================================================================
   9. NAVEGACIÓN
   ===================================================================== */
let pantalla = "login";

function pantallasPermitidas(){
  return Object.keys(PANTALLAS).filter(k => {
    if(k === "login" || k === "solicitud") return false;
    const p = PANTALLAS[k];
    return !p.perm || puede(p.perm);
  });
}

function ir(destino, panel){
  if(!sesion){ return; }
  const p = PANTALLAS[destino];
  if(p && p.perm && !puede(p.perm)){
    return snack("Su rol no tiene acceso a esa sección.", "err");
  }
  pantalla = destino;
  $$(".pantalla").forEach(s => s.classList.toggle("activa", s.id === "scr-" + destino));
  $("titulo").textContent = p ? p.titulo : "";
  $("btn-volver").classList.toggle("oculto", MENU.indexOf(destino) >= 0);
  if(panel) segmento(destino, panel);
  const scr = $("scr-" + destino);
  if(scr) scr.scrollTop = 0;
  cerrarDrawer();
  pintarFab(destino);
  refrescar(destino);
  pintarDrawer();
}

function segmento(grupo, panel){
  const seg = document.querySelector('[data-seg="' + grupo + '"]');
  if(!seg) return;
  const paneles = $$('[data-seg="' + grupo + '"] button').map(b => b.dataset.pan);
  $$('[data-seg="' + grupo + '"] button').forEach(b => b.classList.toggle("on", b.dataset.pan === panel));
  paneles.forEach(x => { const el = $("pan-" + x); if(el) el.classList.toggle("oculto", x !== panel); });
}

function panelActivo(grupo){
  const b = document.querySelector('[data-seg="' + grupo + '"] button.on');
  return b ? b.dataset.pan : "";
}

const FABS = {
  pedidos:      {perm:"pedidos.crear",      txt:"Nuevo pedido",   fn:()=> abrirRequerimiento()},
  inventario:   {perm:"inventario.editar",  txt:"Nuevo producto", fn:()=> abrirProducto("material")},
  herramientas: {perm:"herramientas",       txt:"Nueva",          fn:()=> abrirProducto("herramienta")},
  personal:     {perm:"personal",           txt:"Nuevo operador", fn:()=> abrirOperador()},
  consolidado:  {perm:"consolidado.editar", txt:"Cargar Excel",   fn:()=> $("co-archivo").click()}
};

function pintarFab(destino){
  const f = FABS[destino];
  const fab = $("fab");
  if(f && puede(f.perm)){
    $("fab-txt").textContent = f.txt;
    $("fab-ico").innerHTML = ico(destino === "consolidado" ? "subir" : "agregar", 22);
    fab.classList.add("visible");
    fab.onclick = f.fn;
  }else{
    fab.classList.remove("visible");
    fab.onclick = null;
  }
}

/* --------- drawer (menú dentro del perfil) --------- */
function abrirDrawer(){
  pintarDrawer();
  $("drawer").classList.add("abierto");
  $("velo").classList.add("abierto");
}
function cerrarDrawer(){
  $("drawer").classList.remove("abierto");
  $("velo").classList.remove("abierto");
}
$("velo").addEventListener("click", cerrarDrawer);
$("btn-perfil").addEventListener("click", abrirDrawer);

function fotoHTML(usuario, tam){
  if(usuario && usuario.foto) return '<img src="' + usuario.foto + '" alt="">';
  return "<span>" + iniciales(usuario ? usuario.nombre : "?") + "</span>";
}

function pintarDrawer(){
  const u = usuarioActual();
  if(!u) return;
  const rol = rolEfectivo();
  $("dr-foto").innerHTML = fotoHTML(u);
  $("dr-nombre").textContent = u.nombre;
  $("dr-rol").textContent = (u.cargo ? u.cargo + " · " : "") + ROLES[rol].corto;

  const sinLeer = noLeidas();
  const extras = pantallasPermitidas().filter(k => MENU.indexOf(k) < 0);
  let html = "";

  MENU.forEach(k => {
    if(k !== "mas" && PANTALLAS[k].perm && !puede(PANTALLAS[k].perm)) return;
    html += '<button class="op' + (pantalla === k ? " on" : "") + '" data-ir="' + k + '">' +
      ico(PANTALLAS[k].icono, 21) + PANTALLAS[k].titulo + "</button>";
  });

  html += '<div class="sep"></div>';
  html += '<button class="op" data-ir="notificaciones">' + ico("campana", 21) + "Notificaciones" +
    (sinLeer ? '<span class="glob">' + sinLeer + "</span>" : "") + "</button>";
  html += '<button class="op" data-ir="mi-perfil">' + ico("usuario", 21) + "Mi información</button>";
  html += '<div class="sep"></div>';
  html += '<button class="op salir" id="dr-salir">' + ico("salir", 21) + "Cerrar sesión</button>";
  $("dr-lista").innerHTML = html;

  $$("#dr-lista [data-ir]").forEach(b => b.addEventListener("click", ()=>{
    if(b.dataset.ir === "mi-perfil"){ cerrarDrawer(); verPerfil(); }
    else ir(b.dataset.ir);
  }));
  $("dr-salir").addEventListener("click", async ()=>{
    cerrarDrawer();
    if(await confirmar("Cerrar sesión", "Volverá a la pantalla de inicio de sesión.", "Cerrar sesión")) salir();
  });
}

function verPerfil(){
  const u = usuarioActual();
  const rol = rolEfectivo();
  hoja("Mi información",
    '<div style="text-align:center;margin-bottom:12px"><div style="width:88px;height:88px;border-radius:999px;overflow:hidden;margin:0 auto 10px;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700">' +
    fotoHTML(u) + "</div></div>" +
    '<div class="dato"><span>Nombre</span><b>' + esc(u.nombre) + "</b></div>" +
    '<div class="dato"><span>Usuario</span><b>' + esc(u.usuario) + "</b></div>" +
    '<div class="dato"><span>Cargo</span><b>' + esc(u.cargo || "—") + "</b></div>" +
    '<div class="dato"><span>Rol</span><b>' + esc(ROLES[u.rol].nombre) + "</b></div>" +
    '<div class="dato"><span>Viendo como</span><b>' + esc(ROLES[rol].nombre) + "</b></div>" +
    '<div class="dato"><span>Alta</span><b>' + soloFecha(u.creado) + "</b></div>" +
    '<p style="margin:12px 0 4px;color:var(--tinta-sec);font-size:13px">' + esc(ROLES[rol].resumen) + "</p>",
    [{txt:"Cambiar foto", clase:"btn-cont", fn:()=> $("pf-foto").click()},
     {txt:"Cerrar sesión", clase:"btn-mal", fn:salir}]);
}

/* --------- cambio de modo --------- */
$("btn-modo").addEventListener("click", ()=>{
  const u = usuarioActual();
  if(!u || !u.esAdmin) return;
  sesion.modo = sesion.modo === "admin" ? "normal" : "admin";
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  log("sesion", "Cambio de modo", sesion.modo === "admin" ? "Administrador" : "Almacenero");
  guardar();
  aplicarRol();
  snack(sesion.modo === "admin" ? "Modo administrador activado" : "Modo almacenero activado", "ok");
});

function aplicarRol(){
  const u = usuarioActual();
  const rol = rolEfectivo();
  $("btn-modo").classList.toggle("oculto", !u.esAdmin);
  $("btn-modo").classList.toggle("admin", sesion.modo === "admin");
  $("btn-modo").innerHTML = ico("cambiar", 15) + "Cambiar modo";
  $("subtitulo").textContent = ROLES[rol].nombre;
  $("avatar-txt").innerHTML = u.foto ? '<img src="' + u.foto + '" alt="">' : iniciales(u.nombre);
  ir("inicio");
}

function iniciarApp(){
  $("scr-login").classList.remove("activa");
  $("scr-solicitud").classList.remove("activa");
  $("appbar").classList.remove("oculto");
  aplicarRol();
}

$("btn-volver").addEventListener("click", ()=> ir("mas"));

/* =====================================================================
   10. NOTIFICACIONES
   ===================================================================== */
function notificar(n){
  const aviso = {
    id:uid(), fecha:ahora(),
    roles:n.roles || [], usuarios:n.usuarios || [],
    titulo:n.titulo, cuerpo:n.cuerpo, refTipo:n.refTipo || "", refId:n.refId || null,
    prioridad:n.prioridad || "Normal", leidaPor:[],
    emisor: usuarioActual() ? usuarioActual().nombre : "sistema"
  };
  db.notificaciones.unshift(aviso);
  if(db.notificaciones.length > 400) db.notificaciones.length = 400;

  if(paraMi(aviso) && "Notification" in window && Notification.permission === "granted"){
    try{ new Notification(aviso.titulo, {body:aviso.cuerpo, icon:"icon-192.png"}); }catch(e){}
  }
  return aviso;
}

function paraMi(n){
  const u = usuarioActual();
  if(!u) return false;
  if(n.usuarios && n.usuarios.indexOf(u.id) >= 0) return true;
  if(n.roles && (n.roles.indexOf(u.rol) >= 0 || (u.esAdmin && n.roles.indexOf("admin") >= 0))) return true;
  return false;
}

function misNotificaciones(){ return db.notificaciones.filter(paraMi); }

function noLeidas(){
  const u = usuarioActual();
  if(!u) return 0;
  return misNotificaciones().filter(n => n.leidaPor.indexOf(u.id) < 0).length;
}

function pintarBadge(){
  const n = noLeidas();
  const b = $("badge");
  b.textContent = n > 9 ? "9+" : n;
  b.classList.toggle("hay", n > 0);
}

function pintarNotificaciones(){
  const u = usuarioActual();
  const lista = misNotificaciones();
  $("no-lista").innerHTML = lista.length
    ? lista.map(n => {
        const nueva = n.leidaPor.indexOf(u.id) < 0;
        const cl = n.prioridad === "Urgente" ? "mal" : (n.prioridad === "Alta" ? "alerta" : "");
        return '<button class="fila" data-noti="' + n.id + '" style="' + (nueva ? "border-left:4px solid var(--pri)" : "opacity:.72") + '">' +
          '<span class="mini ' + cl + '">' + ico("campana", 20) + "</span>" +
          '<span class="txt"><b>' + esc(n.titulo) + "</b><small>" + esc(n.cuerpo) + "</small></span>" +
          '<span class="der"><small>' + hace(n.fecha) + "</small></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("campana", 40) + "Sin notificaciones por ahora.</div>";

  $$("#no-lista [data-noti]").forEach(b => b.addEventListener("click", ()=>{
    const n = db.notificaciones.find(x => x.id === b.dataset.noti);
    if(n.leidaPor.indexOf(u.id) < 0){ n.leidaPor.push(u.id); guardar(); pintarBadge(); }
    if(n.refTipo === "requerimiento" && n.refId && db.requerimientos.some(r => r.id === n.refId)) detalleReq(n.refId);
    else hoja(n.titulo, '<p style="white-space:pre-line;margin:4px 0 8px">' + esc(n.cuerpo) + "</p>" +
      '<div class="dato"><span>Fecha</span><b>' + fecha(n.fecha) + "</b></div>" +
      '<div class="dato"><span>Origen</span><b>' + esc(n.emisor) + "</b></div>");
    pintarNotificaciones();
  }));

  const u2 = usuarioActual();
  if(lista.some(n => n.leidaPor.indexOf(u2.id) < 0)){
    lista.forEach(n => { if(n.leidaPor.indexOf(u2.id) < 0) n.leidaPor.push(u2.id); });
    guardar();
    setTimeout(pintarBadge, 400);
  }
}

/* =====================================================================
   11. REFRESCO DE PANTALLAS
   ===================================================================== */
function refrescar(destino){
  pintarBadge();
  if(destino === "inicio")         pintarInicio();
  if(destino === "pedidos")        pintarPedidos();
  if(destino === "inventario")     pintarInventario();
  if(destino === "consolidado")    pintarConsolidado();
  if(destino === "herramientas")   { pintarHerramientas(); pintarPrestamos(); }
  if(destino === "compras")        { pintarPorAtender(); llenarCompras(); }
  if(destino === "movimientos")    { llenarMateriales("in-material"); llenarMateriales("sa-material"); llenarPersonal("sa-persona"); pintarKardex(); }
  if(destino === "notificaciones") pintarNotificaciones();
  if(destino === "historial")      pintarHistorial();
  if(destino === "indicadores")    pintarIndicadores();
  if(destino === "reportes")       prepararReportes();
  if(destino === "personal")       pintarPersonal();
  if(destino === "admin")          { pintarSolicitudes(); pintarUsuarios(); pintarActividad(); }
  if(destino === "mas")            pintarMas();
}

/* =====================================================================
   12. INICIO
   ===================================================================== */
const ESTADOS = {
  solicitado: {texto:"Solicitado",  chip:"info"},
  consolidado:{texto:"Consolidado", chip:"lila"},
  aprobado:   {texto:"Aprobado",    chip:"ok"},
  en_compra:  {texto:"En compra",   chip:"alerta"},
  despachado: {texto:"Despachado",  chip:"alerta"},
  recibido:   {texto:"Recibido",    chip:"ok"},
  rechazado:  {texto:"Rechazado",   chip:"mal"}
};
const TIPOMOV = {
  ingreso:   {texto:"Ingreso",    icono:"caja",   clase:"ok"},
  salida:    {texto:"Salida",     icono:"camion", clase:"alerta"},
  prestamo:  {texto:"Préstamo",   icono:"llave",  clase:"lila"},
  devolucion:{texto:"Devolución", icono:"cambiar",clase:""}
};

function pintarInicio(){
  const u = usuarioActual(), rol = rolEfectivo();
  $("ini-saludo").innerHTML =
    '<div style="display:flex;align-items:center;gap:12px">' +
    '<div style="width:52px;height:52px;border-radius:999px;overflow:hidden;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center;font-weight:700">' +
    fotoHTML(u) + "</div><div style='min-width:0'>" +
    '<div style="font-size:12px;color:var(--tinta-sec);font-weight:600">' + esc(saludo()) + "</div>" +
    '<div style="font-size:18px;font-weight:600;line-height:1.2">' + esc(u.nombre) + "</div>" +
    '<div style="font-size:12.5px;color:var(--tinta-sec)">' + esc(ROLES[rol].nombre) + "</div></div></div>";

  const req = misPedidos();
  const abiertos = req.filter(r => ["recibido","rechazado"].indexOf(r.estado) < 0);
  const m = [];
  if(puede("pedidos.ver")) m.push({v:abiertos.length, t:puede("pedidos.todos") ? "Pedidos en curso" : "Mis pedidos en curso", c:""});
  if(puede("pedidos.consolidar")) m.push({v:req.filter(r => r.estado === "solicitado").length, t:"Por enviar a logística", c:"alerta"});
  if(puede("pedidos.aprobar")) m.push({v:req.filter(r => r.estado === "solicitado" || r.estado === "consolidado").length, t:"Por aprobar", c:"alerta"});
  if(puede("compras")) m.push({v:req.filter(r => r.estado === "aprobado").length, t:"Por comprar", c:"alerta"});
  if(puede("inventario")){
    m.push({v:db.materiales.length, t:"Artículos", c:""});
    m.push({v:db.materiales.filter(x => estadoStock(x) !== "disponible").length, t:"Stock crítico", c:"mal"});
  }
  if(puede("herramientas")) m.push({v:db.herramientas.filter(h => h.estado === "prestada").length, t:"Herr. prestadas", c:""});
  if(puede("consolidado") && db.consolidado.items.length) m.push({v:avanceConsolidado().avance + "%", t:"Avance de obra", c:"ok"});
  if(rolEfectivo() === "admin") m.push({v:db.solicitudes.filter(s => s.estado === "pendiente").length, t:"Solicitudes", c:"alerta"});
  $("ini-metricas").innerHTML = m.slice(0,6).map(x =>
    '<div class="metrica ' + x.c + '"><b>' + x.v + "</b><span>" + x.t + "</span></div>").join("");

  const a = [];
  if(puede("pedidos.crear")) a.push({ic:"pedidos", t:"Nuevo pedido", fn:"req"});
  if(puede("inventario.editar")) a.push({ic:"inventario", t:"Nuevo producto", fn:"prod"});
  if(puede("prestamos")) a.push({ic:"llave", t:"Prestar herramienta", fn:"prest"});
  if(puede("compras")) a.push({ic:"carrito", t:"Orden de compra", ir:"compras|cOrden"});
  if(puede("compras")) a.push({ic:"pdf", t:"Subir guía PDF", ir:"compras|cGuia"});
  if(puede("pedidos.aprobar")) a.push({ic:"check", t:"Aprobar pedidos", ir:"pedidos|"});
  if(puede("consolidado")) a.push({ic:"tabla", t:"Consolidado", ir:"consolidado|"});
  if(puede("reportes")) a.push({ic:"documento", t:"Reporte del día", ir:"reportes|"});
  $("ini-accesos").innerHTML = a.slice(0,6).map((x,i) =>
    '<button class="metrica" data-acceso="' + i + '" style="display:flex;align-items:center;gap:10px;text-align:left">' +
    '<span style="width:38px;height:38px;border-radius:11px;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center;flex:none">' +
    ico(x.ic, 20) + '</span><span style="font-size:13.5px;font-weight:600;line-height:1.25">' + x.t + "</span></button>").join("");
  $$("#ini-accesos [data-acceso]").forEach(b => b.addEventListener("click", ()=>{
    const x = a[+b.dataset.acceso];
    if(x.fn === "req") return abrirRequerimiento();
    if(x.fn === "prod") return abrirProducto("material");
    if(x.fn === "prest") return abrirPrestamo();
    const partes = x.ir.split("|");
    ir(partes[0], partes[1] || null);
  }));

  const act = db.historial.slice(0, 6);
  $("ini-actividad").innerHTML = act.length
    ? act.map(h => '<div class="fila"><span class="mini">' + ico(iconoModulo(h.modulo), 20) + "</span>" +
        '<span class="txt"><b>' + esc(h.accion) + "</b><small>" + esc(h.detalle || h.modulo) + "</small></span>" +
        '<span class="der"><small>' + hace(h.fecha) + "</small></span></div>").join("")
    : '<div class="vacio">' + ico("reloj", 40) + "Todavía no hay actividad registrada.</div>";
}

function saludo(){
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : (h < 19 ? "Buenas tardes" : "Buenas noches");
}
function iconoModulo(m){
  return {pedidos:"pedidos", inventario:"inventario", herramientas:"llave", compras:"carrito",
          movimientos:"camion", usuarios:"personas", sesion:"usuario", consolidado:"tabla",
          solicitudes:"escudo", personal:"personas"}[m] || "reloj";
}

/* =====================================================================
   13. PEDIDOS (REQUERIMIENTOS)
   ===================================================================== */
let filtroPedidos = "", filtroArea = "";

function misPedidos(){
  const u = usuarioActual();
  return puede("pedidos.todos") ? db.requerimientos : db.requerimientos.filter(r => r.solicitanteId === u.id);
}

function pintarFiltrosPedidos(){
  const f = [["","Todos"],["solicitado","Por enviar"],["consolidado","En logística"],["aprobado","Aprobados"],
             ["en_compra","En compra"],["despachado","Despachados"],["recibido","Recibidos"],["rechazado","Rechazados"]];
  $("pe-filtros").innerHTML = f.map(x =>
    '<button class="' + (filtroPedidos === x[0] ? "on" : "") + '" data-est="' + x[0] + '">' + x[1] + "</button>").join("");
  $$("#pe-filtros button").forEach(b => b.addEventListener("click", ()=>{
    filtroPedidos = b.dataset.est;
    pintarPedidos();
  }));

  const areas = [];
  misPedidos().forEach(r => { const a = r.disciplina || r.area; if(a && areas.indexOf(a) < 0) areas.push(a); });
  const cont = $("pe-areas");
  if(puede("pedidos.todos") && areas.length > 1){
    cont.classList.remove("oculto");
    cont.innerHTML = '<button class="' + (filtroArea === "" ? "on" : "") + '" data-area="">Todas las áreas</button>' +
      areas.map(a => '<button class="' + (filtroArea === a ? "on" : "") + '" data-area="' + esc(a) + '">' + esc(a) + "</button>").join("");
    $$("#pe-areas button").forEach(b => b.addEventListener("click", ()=>{
      filtroArea = b.dataset.area;
      pintarPedidos();
    }));
  }else{
    cont.classList.add("oculto");
    cont.innerHTML = "";
  }
}

function pintarPedidos(){
  pintarFiltrosPedidos();
  const base = misPedidos();
  const lista = base.filter(r => (!filtroPedidos || r.estado === filtroPedidos) &&
                                 (!filtroArea || (r.disciplina || r.area) === filtroArea));
  $("pe-lista").innerHTML = lista.length
    ? lista.map(filaReq).join("")
    : '<div class="vacio">' + ico("pedidos", 40) +
      (base.length ? "Ningún pedido con ese filtro."
        : "Todavía no hay pedidos.<br>Cree el primero con el botón <b>Nuevo pedido</b>.") + "</div>";
  $$("#pe-lista [data-req]").forEach(b => b.addEventListener("click", ()=> detalleReq(b.dataset.req)));
}

function filaReq(r){
  const est = ESTADOS[r.estado];
  const n = r.items.length;
  const pri = r.prioridad === "Urgente" ? "mal" : (r.prioridad === "Alta" ? "alerta" : "");
  return '<button class="fila" data-req="' + r.id + '">' +
    '<span class="mini ' + pri + '">' + ico("pedidos", 20) + "</span>" +
    '<span class="txt"><b>' + esc(r.codigo) + " · " + esc(r.items[0].desc) + (n > 1 ? " +" + (n-1) : "") + "</b>" +
    "<small>" + esc(r.solicitante) + ((r.disciplina || r.area) ? " · " + esc(r.disciplina || r.area) : "") +
    " · " + soloFecha(r.fecha) + "</small></span>" +
    '<span class="der"><span class="chip ' + est.chip + '">' + est.texto + "</span>" +
    (r.pdf ? '<small>PDF</small>' : "") + "</span></button>";
}

function historia(r, estado, nota){
  r.historial.push({estado, fecha:ahora(), usuario:usuarioActual().nombre, nota:nota || ""});
  r.estado = estado;
}

function detalleReq(id){
  const r = db.requerimientos.find(x => x.id === id);
  if(!r) return;
  const dato = (k,v) => v ? '<div class="dato"><span>' + k + "</span><b>" + esc(v) + "</b></div>" : "";

  let html = dato("Estado", ESTADOS[r.estado].texto) + dato("Obra", r.obra) +
    dato("Solicitante", r.solicitante + (r.solicitanteCargo ? " · " + r.solicitanteCargo : "")) +
    dato("Área / disciplina", r.disciplina || r.area) + dato("Prioridad", r.prioridad) + dato("Registrado", fecha(r.fecha)) +
    dato("Necesario para", r.necesario ? soloFecha(r.necesario) : "") + dato("Justificación", r.obs);

  html += '<div class="sech" style="margin:16px 0 6px">Materiales (' + r.items.length + ")</div>";
  html += r.items.map(it =>
    '<div class="fila" style="box-shadow:none;border:1px solid var(--borde)">' +
    '<span class="mini">' + (it.foto ? '<img src="' + it.foto + '" data-zoom="' + it.foto + '" alt="">' : ico("caja", 20)) + "</span>" +
    '<span class="txt"><b>' + esc(it.desc) + "</b>" + (it.obs ? "<small>" + esc(it.obs) + "</small>" : "") + "</span>" +
    '<span class="der"><b>' + it.cant + " " + esc(it.unidad) + "</b></span></div>").join("");

  if(r.oc) html += '<div class="sech" style="margin:16px 0 6px">Orden de compra</div>' +
    dato("N° OC", r.oc.numero) + dato("Proveedor", r.oc.proveedor) +
    dato("Monto", r.oc.monto ? "S/ " + Number(r.oc.monto).toFixed(2) : "") +
    dato("Entrega prometida", r.oc.entrega ? soloFecha(r.oc.entrega) : "") + dato("Registró", r.oc.usuario);

  if(r.despacho) html += '<div class="sech" style="margin:16px 0 6px">Guía de remisión</div>' +
    dato("N° guía", r.despacho.guia) + dato("Transportista", r.despacho.transporte) + dato("Registró", r.despacho.usuario);

  if(r.recepcion) html += '<div class="sech" style="margin:16px 0 6px">Recepción</div>' +
    dato("Recibió", r.recepcion.usuario) + dato("Fecha", fecha(r.recepcion.fecha)) + dato("Observaciones", r.recepcion.obs);

  html += '<div class="sech" style="margin:16px 0 6px">Seguimiento</div>' +
    r.historial.map(h => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
      ESTADOS[h.estado].texto + "</b><small>" + fecha(h.fecha) + " · " + esc(h.usuario) +
      (h.nota ? " · " + esc(h.nota) : "") + "</small></span></div>").join("");

  if(r.notas.length) html += '<div class="sech" style="margin:16px 0 6px">Coordinación</div>' +
    r.notas.map(n => '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(n.usuario) +
      "</b><small>" + fecha(n.fecha) + " · " + esc(n.texto) + "</small></span></div>").join("");

  const imgs = [r.foto, r.oc && r.oc.foto, r.despacho && r.despacho.foto, r.recepcion && r.recepcion.foto].filter(Boolean);
  if(imgs.length) html += '<div style="display:flex;gap:8px;margin:14px 0 4px;flex-wrap:wrap">' +
    imgs.map(f => '<img src="' + f + '" class="thumb" data-zoom="' + f + '" alt="evidencia">').join("") + "</div>";

  const pdfs = [];
  if(r.pdf) pdfs.push({ref:r.pdf, et:"Guía del requerimiento"});
  if(r.despacho && r.despacho.pdf) pdfs.push({ref:r.despacho.pdf, et:"Guía de remisión"});
  if(pdfs.length) html += pdfs.map((p,i) =>
    '<button class="fila" data-pdf="' + i + '" style="margin-top:10px"><span class="mini mal">' + ico("pdf", 20) + "</span>" +
    '<span class="txt"><b>' + esc(p.et) + "</b><small>" + esc(p.ref.nombre) + "</small></span>" +
    '<span class="der">' + ico("flecha", 18) + "</span></button>").join("");

  /* Estados en los que cada rol puede actuar (flujo v5) */
  const ENVIAR   = ["pendiente","solicitado","revisado","entrega_parcial","sin_stock"];
  const APROBAR  = ["enviado_logistica","consolidado","pendiente","solicitado","revisado"];
  const COMPRAR  = ["aprobado","compra_aprobada"];
  const GUIA     = ["en_compra","compra_proceso","compra_aprobada","aprobado"];

  const acciones = [];
  if(puede("pedidos.consolidar") && ENVIAR.indexOf(r.estado) >= 0)
    acciones.push({txt:"Enviar a logística", clase:"btn-pri", fn:()=> cambiarEstadoReq(r.id, "enviado_logistica")});
  if(puede("pedidos.aprobar") && APROBAR.indexOf(r.estado) >= 0){
    acciones.push({txt:"Dar visto bueno", clase:"btn-ok", fn:()=> cambiarEstadoReq(r.id, "aprobado")});
    acciones.push({txt:"Rechazar", clase:"btn-mal", fn:()=> rechazarReq(r.id)});
  }
  if(puede("compras") && COMPRAR.indexOf(r.estado) >= 0)
    acciones.push({txt:"Registrar artículos", clase:"btn-pri", fn:()=> ir("articulos")});
  if(puede("compras") && GUIA.indexOf(r.estado) >= 0)
    acciones.push({txt:"Subir guía", clase:"btn-cont", fn:()=> ir("guias")});
  acciones.push({txt:"Agregar nota", clase:"btn-cont", fn:()=> agregarNota(r.id)});
  acciones.push({txt:"Cerrar", clase:"btn-cont"});

  hoja(r.codigo, html, acciones);
  $$("#hoja-cuerpo [data-pdf]").forEach(b => b.addEventListener("click", ()=> verPDF(pdfs[+b.dataset.pdf].ref)));
}

function cambiarEstadoReq(id, estado){
  const r = db.requerimientos.find(x => x.id === id);
  historia(r, estado);
  log("pedidos", "Requerimiento " + ESTADOS[estado].texto.toLowerCase(), r.codigo, r.id);
  if(estado === "aprobado"){
    notificar({roles:["compras","admin"], titulo:"Requerimiento aprobado: " + r.codigo,
      cuerpo:"Fecha: " + soloFecha(r.fecha) + "\nObra: " + (r.obra || "—") + "\nPrioridad: " + r.prioridad +
        "\nMateriales: " + resumenItems(r), refTipo:"requerimiento", refId:r.id, prioridad:r.prioridad});
    notificar({usuarios:[r.solicitanteId], titulo:"Su pedido fue aprobado: " + r.codigo,
      cuerpo:"Pasa a compras para su atención.", refTipo:"requerimiento", refId:r.id});
  }
  if(estado === "consolidado" || estado === "enviado_logistica"){
    notificar({roles:["jefatura","compras","admin"],
      titulo:"Requerimiento enviado a logística: " + r.codigo,
      cuerpo:"Fecha: " + soloFecha(r.fecha) + "\nObra: " + (r.obra || "—") +
             "\nÁrea: " + (r.disciplina || r.area || "—") + "\nPrioridad: " + r.prioridad +
             "\nSolicitante: " + r.solicitante + "\nMateriales: " + resumenItems(r),
      refTipo:"requerimiento", refId:r.id, prioridad:r.prioridad});
    notificar({usuarios:[r.solicitanteId], titulo:"Su pedido fue enviado a logística: " + r.codigo,
      cuerpo:"Revisado por " + usuarioActual().nombre + ".", refTipo:"requerimiento", refId:r.id});
  }
  if(!guardar()) return;
  snack("Requerimiento " + ESTADOS[estado].texto.toLowerCase() + ".", "ok");
  refrescar(pantalla);
}

async function rechazarReq(id){
  const motivo = await pedirTexto("Rechazar requerimiento", "Motivo del rechazo");
  if(motivo == null) return;
  const r = db.requerimientos.find(x => x.id === id);
  historia(r, "rechazado", motivo);
  log("pedidos", "Requerimiento rechazado", r.codigo + " · " + motivo, r.id);
  notificar({usuarios:[r.solicitanteId], titulo:"Su pedido fue rechazado: " + r.codigo,
    cuerpo:motivo || "Sin motivo indicado.", refTipo:"requerimiento", refId:r.id});
  if(!guardar()) return;
  snack("Requerimiento rechazado.", "ok");
  refrescar(pantalla);
}

async function agregarNota(id){
  const texto = await pedirTexto("Nota de coordinación", "Escriba la nota");
  if(!texto) return;
  const r = db.requerimientos.find(x => x.id === id);
  r.notas.push({usuario:usuarioActual().nombre, fecha:ahora(), texto});
  log("pedidos", "Nota agregada", r.codigo, r.id);
  if(guardar()) snack("Nota agregada.", "ok");
}

function resumenItems(r){
  return r.items.map(i => i.desc + " (" + i.cant + " " + i.unidad + ")").join(", ");
}

/* --------- modal: nuevo requerimiento --------- */
function abrirRequerimiento(){
  if(!puede("pedidos.crear")) return snack("Su rol no registra pedidos.", "err");
  limpiarRequerimiento();
  const u = usuarioActual();
  $("mr-obra").value = db.config.obra || "";
  $("mr-area").value = u.area || "";
  $("mr-quien").textContent = u.nombre + (u.cargo ? " · " + u.cargo : "");
  $("mr-excel").classList.toggle("oculto", !puede("pedidos.excel"));
  abrirModal("modal-requerimiento");
}

function limpiarRequerimiento(){
  itemsReq = [];
  ["mr-obra","mr-area","mr-necesario","mr-desc","mr-cant","mr-unidad","mr-iobs","mr-obs"].forEach(i => { if($(i)) $(i).value = ""; });
  $("mr-prioridad").value = "Normal";
  if($("mr-importe")) $("mr-importe").innerHTML = "";
  limpiarFoto("mr-ifoto"); limpiarFoto("mr-foto"); limpiarArchivo("mr-pdf");
  pintarItemsReq();
}

$("mr-agregar").addEventListener("click", ()=>{
  const desc = $("mr-desc").value.trim(), cant = num($("mr-cant").value);
  if(!desc) return snack("Escriba el material.", "err");
  if(cant <= 0) return snack("Indique la cantidad.", "err");
  itemsReq.push({desc, cant, unidad:$("mr-unidad").value.trim() || "und",
                 obs:$("mr-iobs").value.trim(), foto:fotos["mr-ifoto"] || null});
  $("mr-desc").value = ""; $("mr-cant").value = ""; $("mr-unidad").value = ""; $("mr-iobs").value = "";
  limpiarFoto("mr-ifoto");
  pintarItemsReq();
  snack("Material agregado al pedido.", "ok");
});

/* --------- carga del pedido desde Excel --------- */
const COLS_PEDIDO = [
  {clave:"desc",      alias:["descripcion","material","item","detalle","producto","articulo","insumo"]},
  {clave:"cant",      alias:["cantidad","cant","qty","solicitado"]},
  {clave:"unidad",    alias:["unidad","und","um","medida"]},
  {clave:"obs",       alias:["observaciones","observacion","detalle tecnico","marca","referencia","nota"]},
  {clave:"area",      alias:["area","disciplina","especialidad","frente"]},
  {clave:"prioridad", alias:["prioridad","urgencia"]},
  {clave:"necesario", alias:["necesario para","fecha necesaria","fecha","requerido para"]}
];

function fechaExcel(v){
  if(!v) return "";
  if(/^\d{4}-\d{2}-\d{2}/.test(v)) return String(v).slice(0,10);
  const n = parseFloat(v);
  if(!isNaN(n) && n > 20000 && n < 90000)
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0,10);
  const p = String(v).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if(p) return (p[3].length === 2 ? "20" + p[3] : p[3]) + "-" + p[2].padStart(2,"0") + "-" + p[1].padStart(2,"0");
  return "";
}

$("mr-plantilla").addEventListener("click", ()=>{
  const u = usuarioActual();
  const filas = [
    ["Descripción","Cantidad","Unidad","Observaciones","Área","Prioridad","Necesario para"],
    ["Perno hexagonal 5/8 x 3", 24, "und", "Acero galvanizado", u.area || "Civil", "Alta", hoyISO()],
    ["Cable NYY 3x10", 120, "m", "", u.area || "Eléctrico", "Normal", ""],
    ["", "", "", "", "", "", ""]
  ];
  descargarBlob("plantilla_requerimiento.xlsx", crearXLSX([{nombre:"Requerimiento", filas}]));
  snack("Plantilla descargada. Llénela en Excel y súbala.", "ok");
});

$("mr-subir").addEventListener("click", ()=> $("mr-archivo").click());

$("mr-archivo").addEventListener("change", async ()=>{
  const archivo = $("mr-archivo").files[0];
  if(!archivo) return;
  $("mr-importe").className = "ayuda";
  $("mr-importe").textContent = "Leyendo " + archivo.name + "…";
  try{
    const res = importarPedido(await leerTabla(archivo));
    $("mr-importe").className = "ayuda";
    $("mr-importe").innerHTML = "<b>" + res.cargados + "</b> material(es) cargados de <b>" + esc(archivo.name) + "</b>" +
      (res.ignoradas ? " · " + res.ignoradas + " fila(s) sin descripción omitidas" : "") +
      "<br>Revise la lista y pulse <b>Registrar</b>.";
    snack(res.cargados + " materiales cargados del Excel.", "ok");
  }catch(e){
    $("mr-importe").className = "ayuda err";
    $("mr-importe").textContent = e.message || "No se pudo leer el archivo.";
    snack("No se pudo leer el archivo.", "err");
  }
  $("mr-archivo").value = "";
});

function importarPedido(filas){
  if(!filas.length) throw new Error("El archivo está vacío.");
  let iCab = -1, mapa = {};
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    const prueba = {};
    (filas[i] || []).forEach((celda, c)=>{
      const t = sinTildes(celda);
      COLS_PEDIDO.forEach(col => { if(col.alias.indexOf(t) >= 0 && prueba[col.clave] === undefined) prueba[col.clave] = c; });
    });
    if(prueba.desc !== undefined){ iCab = i; mapa = prueba; break; }
  }
  if(iCab < 0) throw new Error('No se encontró la columna "Descripción" o "Material". Use la plantilla.');

  const dato = (f, k) => mapa[k] === undefined ? "" : String(f[mapa[k]] == null ? "" : f[mapa[k]]).trim();
  let cargados = 0, ignoradas = 0, primera = null;

  for(let i = iCab + 1; i < filas.length; i++){
    const f = filas[i] || [];
    const desc = dato(f, "desc");
    if(!desc){ if(f.some(v => String(v || "").trim())) ignoradas++; continue; }
    itemsReq.push({
      desc, cant:num(dato(f, "cant")) || 1, unidad:dato(f, "unidad") || "und",
      obs:dato(f, "obs"), foto:null
    });
    if(!primera) primera = f;
    cargados++;
  }
  if(!cargados) throw new Error("No se encontró ninguna fila con material.");

  if(primera){
    const area = dato(primera, "area");
    const nec  = fechaExcel(dato(primera, "necesario"));
    const pri  = sinTildes(dato(primera, "prioridad"));
    if(area && !$("mr-area").value) $("mr-area").value = area;
    if(nec && !$("mr-necesario").value) $("mr-necesario").value = nec;
    if(pri.indexOf("urgen") === 0) $("mr-prioridad").value = "Urgente";
    else if(pri.indexOf("alta") === 0) $("mr-prioridad").value = "Alta";
  }
  pintarItemsReq();
  return {cargados, ignoradas};
}

function pintarItemsReq(){
  $("mr-items").innerHTML = itemsReq.length
    ? itemsReq.map((it, i) =>
        '<div class="fila"><span class="mini">' +
        (it.foto ? '<img src="' + it.foto + '" data-zoom="' + it.foto + '" alt="">' : ico("caja", 20)) + "</span>" +
        '<span class="txt"><b>' + esc(it.desc) + "</b><small>" + it.cant + " " + esc(it.unidad) +
        (it.obs ? " · " + esc(it.obs) : "") + "</small></span>" +
        '<button class="quitar" data-quitaritem="' + i + '" style="margin:0">Quitar</button></div>').join("")
    : '<div class="vacio" style="padding:18px">Agregue al menos un material al pedido.</div>';
  $$("[data-quitaritem]").forEach(b => b.addEventListener("click", ()=>{
    itemsReq.splice(+b.dataset.quitaritem, 1);
    pintarItemsReq();
  }));
}

function registrarRequerimiento(){
  if(!itemsReq.length) return snack("Agregue al menos un material.", "err");
  const u = usuarioActual();
  const r = {
    id:uid(), codigo:codigoReq(), fecha:ahora(),
    solicitante:u.nombre, solicitanteId:u.id, solicitanteCargo:u.cargo || "",
    disciplina:$("mr-area").value.trim() || u.area || "",
    obra:$("mr-obra").value.trim(), area:$("mr-area").value.trim() || u.area || "",
    prioridad:$("mr-prioridad").value, necesario:$("mr-necesario").value,
    items:itemsReq.slice(), obs:$("mr-obs").value.trim(),
    foto:fotos["mr-foto"] || null, pdf:adjuntos["mr-pdf"] || null,
    estado:"solicitado", oc:null, despacho:null, recepcion:null, notas:[], historial:[]
  };
  historia(r, "solicitado");
  db.requerimientos.unshift(r);
  if(r.obra) db.config.obra = r.obra;

  /* V42 · La Administradora de Obra es el primer filtro de TODO requerimiento.
     Venga de un supervisor, de un capataz o del propio almacenero, primero
     pasa por ella; nadie llega a logística sin su visto bueno.
     Solo lo que ella misma levanta sale directo. */
  const esObra = u.rol === "obra" || u.rol === "admin";
  const esSupervisor = u.rol === "supervisor";
  const destino = esObra ? ["jefatura","compras","admin"]
                : (esSupervisor ? ["obra","almacenero","admin"] : ["obra","admin"]);

  log("pedidos", "Requerimiento creado", r.codigo + " · " + r.items.length + " ítems", r.id);
  notificar({
    roles:destino,
    titulo:"Nuevo requerimiento " + r.codigo + (r.disciplina ? " · " + r.disciplina : ""),
    cuerpo:"Fecha: " + soloFecha(r.fecha) + "\nObra: " + (r.obra || "—") +
           "\nÁrea: " + (r.disciplina || r.area || "—") + "\nPrioridad: " + r.prioridad +
           "\nSolicitante: " + r.solicitante + (u.cargo ? " (" + u.cargo + ")" : "") +
           "\nMateriales: " + resumenItems(r),
    refTipo:"requerimiento", refId:r.id, prioridad:r.prioridad
  });

  if(!guardar()) return;
  cerrarModal("modal-requerimiento");
  limpiarRequerimiento();
  snack("Pedido " + r.codigo + " enviado a " + (esObra ? "logística." : "la Administradora de Obra."), "ok");
  ir("pedidos");
}
$("mr-registrar").addEventListener("click", registrarRequerimiento);
$("mr-registrar2").addEventListener("click", registrarRequerimiento);

/* =====================================================================
   14. INVENTARIO
   ===================================================================== */
function estadoStock(m){
  if(m.stock <= 0) return "agotado";
  if(m.stock <= m.minimo) return "bajo";
  return "disponible";
}
const ESTADO_STOCK = {
  disponible:{txt:"Disponible", chip:"ok"},
  bajo:      {txt:"Bajo stock", chip:"alerta"},
  agotado:   {txt:"Agotado",    chip:"mal"}
};

let filtroInv = "";
$("iv-buscar").addEventListener("input", pintarInventario);
$("iv-filtros").addEventListener("click", e => {
  if(e.target.dataset.est === undefined) return;
  filtroInv = e.target.dataset.est;
  $$("#iv-filtros button").forEach(b => b.classList.toggle("on", b === e.target));
  pintarInventario();
});

function pintarInventario(){
  const q = sinTildes($("iv-buscar").value);
  let lista = db.materiales.slice().sort((a,b)=> a.nombre.localeCompare(b.nombre));
  if(filtroInv) lista = lista.filter(m => estadoStock(m) === filtroInv);
  if(q) lista = lista.filter(m => sinTildes(m.nombre + " " + m.codigo + " " + m.categoria + " " + (m.ubicacion || "")).indexOf(q) >= 0);

  $("iv-lista").innerHTML = lista.length
    ? lista.map(m => {
        const e = ESTADO_STOCK[estadoStock(m)];
        return '<button class="fila" data-mat="' + m.id + '">' +
          '<span class="mini ' + e.chip + '">' + (m.foto ? '<img src="' + m.foto + '" alt="">' : ico("caja", 20)) + "</span>" +
          '<span class="txt"><b>' + esc(m.nombre) + "</b><small>" + esc(m.codigo) +
          " · mín. " + m.minimo + " " + esc(m.unidad) + (m.categoria ? " · " + esc(m.categoria) : "") + "</small></span>" +
          '<span class="der"><b>' + m.stock + " " + esc(m.unidad) + "</b>" +
          '<span class="chip ' + e.chip + '"><span class="punto-est"></span>' + e.txt + "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("inventario", 40) +
      (db.materiales.length ? "Ningún artículo coincide con la búsqueda."
        : "Inventario vacío.<br>Registre el primer producto con el botón <b>Nuevo producto</b>.") + "</div>";

  $$("#iv-lista [data-mat]").forEach(b => b.addEventListener("click", ()=> detalleMaterial(b.dataset.mat)));
}

function detalleMaterial(id){
  const m = db.materiales.find(x => x.id === id);
  if(!m) return;
  const e = ESTADO_STOCK[estadoStock(m)];
  const movs = db.movimientos.filter(x => x.itemId === m.id).slice(0, 6);
  let html = (m.foto ? '<img src="' + m.foto + '" data-zoom="' + m.foto + '" style="width:100%;height:170px;object-fit:cover;border-radius:14px;margin-bottom:12px" alt="">' : "") +
    '<div class="dato"><span>Código</span><b>' + esc(m.codigo) + "</b></div>" +
    '<div class="dato"><span>Categoría</span><b>' + esc(m.categoria || "—") + "</b></div>" +
    '<div class="dato"><span>Stock</span><b>' + m.stock + " " + esc(m.unidad) + "</b></div>" +
    '<div class="dato"><span>Stock mínimo</span><b>' + m.minimo + " " + esc(m.unidad) + "</b></div>" +
    '<div class="dato"><span>Estado</span><b><span class="chip ' + e.chip + '">' + e.txt + "</span></b></div>" +
    (m.obs ? '<div class="dato"><span>Observaciones</span><b>' + esc(m.obs) + "</b></div>" : "");
  if(movs.length) html += '<div class="sech" style="margin:16px 0 6px">Últimos movimientos</div>' +
    movs.map(x => '<div class="linea"><span class="pt"></span><span class="txt"><b>' + TIPOMOV[x.tipo].texto +
      " " + (x.tipo === "salida" ? "−" : "+") + x.cantidad + " " + esc(x.unidad) + "</b><small>" +
      fecha(x.fecha) + " · " + esc(x.persona || x.registro || "") + "</small></span></div>").join("");

  const acc = [];
  if(puede("movimientos")) acc.push({txt:"Registrar salida", clase:"btn-pri", fn:()=> ir("movimientos", "mSalida")});
  if(puede("inventario.editar")) acc.push({txt:"Editar", clase:"btn-cont", fn:()=> abrirProducto("material", m.id)});
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja(m.nombre, html, acc);
}

/* --------- modal: producto --------- */
let editandoProducto = null;

function abrirProducto(tipo, id){
  if(!puede("inventario.editar") && !puede("herramientas")) return snack("Sin permiso para registrar artículos.", "err");
  limpiarProducto();
  editandoProducto = id || null;
  $("mp-tipo").value = tipo;
  $("mp-tipo").disabled = !!id;
  cambiarTipoProducto();
  if(id){
    const it = tipo === "material" ? db.materiales.find(x => x.id === id) : db.herramientas.find(x => x.id === id);
    if(it){
      $("mp-titulo").textContent = "Editar artículo";
      $("mp-nombre").value = it.nombre;
      $("mp-codigo").value = it.codigo;
      $("mp-categoria").value = it.categoria || "";
      $("mp-unidad").value = it.unidad || "und";
      $("mp-obs").value = it.obs || "";
      if(tipo === "material"){
        $("mp-cantidad").value = it.stock;
        $("mp-minimo").value = it.minimo;
      }else{
        $("mp-cantidad").value = 1;
        $("mp-marca").value = it.marca || "";
        $("mp-modelo").value = it.modelo || "";
        $("mp-serie").value = it.serie || "";
      }
      if(it.foto){
        fotos["mp-foto"] = it.foto;
        $("mp-foto-prev").innerHTML = '<img src="' + it.foto + '" class="thumb" data-zoom="' + it.foto +
          '" alt=""><span class="ayuda" style="margin:0">Foto actual</span>';
      }
    }
  }else{
    $("mp-titulo").textContent = "Nuevo producto";
    $("mp-codigo").value = "Se genera automáticamente";
  }
  abrirModal("modal-producto");
}

function limpiarProducto(){
  editandoProducto = null;
  ["mp-nombre","mp-categoria","mp-cantidad","mp-unidad","mp-obs","mp-marca","mp-modelo","mp-serie"].forEach(i => { if($(i)) $(i).value = ""; });
  $("mp-minimo").value = 5;
  $("mp-codigo").value = "Se genera automáticamente";
  $("mp-tipo").disabled = false;
  limpiarFoto("mp-foto");
}

function cambiarTipoProducto(){
  const esMat = $("mp-tipo").value === "material";
  $("mp-solo-material").classList.toggle("oculto", !esMat);
  $("mp-solo-herramienta").classList.toggle("oculto", esMat);
}
$("mp-tipo").addEventListener("change", cambiarTipoProducto);

function registrarProducto(){
  const tipo = $("mp-tipo").value;
  const nombre = $("mp-nombre").value.trim();
  if(!nombre) return snack("Escriba el nombre del artículo.", "err");
  const unidad = $("mp-unidad").value.trim() || "und";
  const cant = num($("mp-cantidad").value);

  if(tipo === "material"){
    let m = editandoProducto ? db.materiales.find(x => x.id === editandoProducto) : null;
    if(!m){
      if(db.materiales.some(x => sinTildes(x.nombre) === sinTildes(nombre)))
        return snack("Ya existe un material con ese nombre.", "err");
      m = {id:uid(), codigo:codigo("MAT"), stock:0, creado:ahora(), creadoPor:usuarioActual().id};
      db.materiales.push(m);
      if(cant > 0){
        m.stock = cant;
        registrarMov({tipo:"ingreso", itemId:m.id, item:nombre, cantidad:cant, unidad, saldo:cant,
                      persona:"", area:"", documento:"", obs:"Registro inicial del artículo",
                      foto1:null, foto2:fotos["mp-foto"] || null});
      }
    }else if(cant !== m.stock && cant >= 0){
      m.stock = cant;
    }
    Object.assign(m, {
      nombre, categoria:$("mp-categoria").value.trim() || "General", unidad,
      minimo:num($("mp-minimo").value), obs:$("mp-obs").value.trim(),
      foto:fotos["mp-foto"] || m.foto || null, actualizado:ahora()
    });
    log("inventario", editandoProducto ? "Artículo editado" : "Artículo registrado", m.codigo + " · " + m.nombre, m.id);
  }else{
    let h = editandoProducto ? db.herramientas.find(x => x.id === editandoProducto) : null;
    if(!h){
      h = {id:uid(), codigo:codigo("HER"), estado:"disponible", asignadaA:null, prestamo:null,
           creado:ahora(), creadoPor:usuarioActual().id};
      db.herramientas.push(h);
    }
    Object.assign(h, {
      nombre, categoria:$("mp-categoria").value.trim() || "Herramienta", unidad,
      marca:$("mp-marca").value.trim(), modelo:$("mp-modelo").value.trim(), serie:$("mp-serie").value.trim(),
      obs:$("mp-obs").value.trim(), foto:fotos["mp-foto"] || h.foto || null, actualizado:ahora()
    });
    log("herramientas", editandoProducto ? "Herramienta editada" : "Herramienta registrada", h.codigo + " · " + h.nombre, h.id);
  }

  if(!guardar()) return;
  cerrarModal("modal-producto");
  const cod = tipo === "material"
    ? (editandoProducto ? "" : db.materiales[db.materiales.length-1].codigo)
    : (editandoProducto ? "" : db.herramientas[db.herramientas.length-1].codigo);
  limpiarProducto();
  snack(cod ? "Registrado con código " + cod : "Artículo actualizado.", "ok");
  refrescar(pantalla);
}
$("mp-registrar").addEventListener("click", registrarProducto);
$("mp-registrar2").addEventListener("click", registrarProducto);

/* =====================================================================
   15. HERRAMIENTAS Y PRÉSTAMOS
   ===================================================================== */
const ESTADO_HERR = {
  disponible:{txt:"Disponible", chip:"ok"},
  prestada:  {txt:"Prestada",   chip:"alerta"},
  baja:      {txt:"De baja",    chip:"mal"}
};

function pintarHerramientas(){
  $("he-lista").innerHTML = db.herramientas.length
    ? db.herramientas.map(h => {
        const e = ESTADO_HERR[h.estado] || ESTADO_HERR.disponible;
        const p = h.prestamo ? db.personal.find(x => x.id === h.prestamo.personaId) : null;
        return '<button class="fila" data-her="' + h.id + '">' +
          '<span class="mini ' + e.chip + '">' + (h.foto ? '<img src="' + h.foto + '" alt="">' : ico("llave", 20)) + "</span>" +
          '<span class="txt"><b>' + esc(h.nombre) + "</b><small>" + esc(h.codigo) +
          (h.marca ? " · " + esc(h.marca) : "") + (h.serie ? " · S/N " + esc(h.serie) : "") +
          (p ? " · " + esc(p.nombre) : "") + "</small></span>" +
          '<span class="der"><span class="chip ' + e.chip + '"><span class="punto-est"></span>' + e.txt + "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("llave", 40) + "Sin herramientas registradas.<br>Use el botón <b>Nueva</b>.</div>";
  $$("#he-lista [data-her]").forEach(b => b.addEventListener("click", ()=> detalleHerramienta(b.dataset.her)));
}

function pintarPrestamos(){
  const activos = db.herramientas.filter(h => h.estado === "prestada" && h.prestamo);
  $("he-prestamos").innerHTML = activos.length
    ? activos.map(h => {
        const p = db.personal.find(x => x.id === h.prestamo.personaId);
        const vencido = h.prestamo.devolucion && h.prestamo.devolucion < hoyISO();
        return '<button class="fila" data-her="' + h.id + '">' +
          '<span class="mini ' + (vencido ? "mal" : "lila") + '">' +
          (h.prestamo.fotoResponsable ? '<img src="' + h.prestamo.fotoResponsable + '" alt="">' : ico("usuario", 20)) + "</span>" +
          '<span class="txt"><b>' + esc(p ? p.nombre : "—") + "</b><small>" + esc(h.codigo + " · " + h.nombre) +
          " · salida " + soloFecha(h.prestamo.salida) + "</small></span>" +
          '<span class="der"><span class="chip ' + (vencido ? "mal" : "info") + '">' +
          (h.prestamo.devolucion ? (vencido ? "Vencido" : "Vence " + soloFecha(h.prestamo.devolucion)) : "Sin fecha") +
          "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("check", 40) + "No hay herramientas prestadas.</div>";
  $$("#he-prestamos [data-her]").forEach(b => b.addEventListener("click", ()=> detalleHerramienta(b.dataset.her)));
}

function detalleHerramienta(id){
  const h = db.herramientas.find(x => x.id === id);
  if(!h) return;
  const e = ESTADO_HERR[h.estado] || ESTADO_HERR.disponible;
  const p = h.prestamo ? db.personal.find(x => x.id === h.prestamo.personaId) : null;
  const dato = (k,v) => v ? '<div class="dato"><span>' + k + "</span><b>" + esc(v) + "</b></div>" : "";

  let html = (h.foto ? '<img src="' + h.foto + '" data-zoom="' + h.foto + '" style="width:100%;height:170px;object-fit:cover;border-radius:14px;margin-bottom:12px" alt="">' : "") +
    dato("Código", h.codigo) + dato("Categoría", h.categoria) + dato("Marca", h.marca) +
    dato("Modelo", h.modelo) + dato("N° de serie", h.serie) +
    '<div class="dato"><span>Estado</span><b><span class="chip ' + e.chip + '">' + e.txt + "</span></b></div>" +
    dato("Observaciones", h.obs);

  if(h.prestamo){
    html += '<div class="sech" style="margin:16px 0 6px">Préstamo vigente</div>' +
      dato("Responsable", p ? p.nombre : "—") +
      dato("Fecha de salida", soloFecha(h.prestamo.salida)) +
      dato("Devolución prevista", h.prestamo.devolucion ? soloFecha(h.prestamo.devolucion) : "Sin fecha") +
      dato("Entregó", h.prestamo.usuario) + dato("Observaciones", h.prestamo.obs);
    const fs = [h.prestamo.fotoResponsable, h.prestamo.fotoHerramienta].filter(Boolean);
    if(fs.length) html += '<div style="display:flex;gap:8px;margin:12px 0 4px">' +
      fs.map(f => '<img src="' + f + '" class="thumb" data-zoom="' + f + '" alt="">').join("") + "</div>";
  }

  const acc = [];
  if(puede("prestamos") && h.estado === "disponible") acc.push({txt:"Prestar", clase:"btn-pri", fn:()=> abrirPrestamo(h.id)});
  if(puede("prestamos") && h.estado === "prestada")   acc.push({txt:"Registrar devolución", clase:"btn-ok", fn:()=> devolverHerramienta(h.id)});
  if(puede("herramientas")) acc.push({txt:"Editar", clase:"btn-cont", fn:()=> abrirProducto("herramienta", h.id)});
  if(puede("herramientas") && h.estado === "baja") acc.push({txt:"Reactivar", clase:"btn-cont", fn:()=>{
    h.estado = "disponible"; log("herramientas", "Herramienta reactivada", h.codigo, h.id);
    if(guardar()){ snack("Herramienta reactivada.", "ok"); refrescar("herramientas"); }
  }});
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja(h.codigo + " · " + h.nombre, html, acc);
}

function abrirPrestamo(id){
  if(!puede("prestamos")) return snack("Sin permiso para registrar préstamos.", "err");
  if(!db.personal.length) return snack("Registre primero al personal de obra.", "err");
  limpiarPrestamo();
  const disp = db.herramientas.filter(h => h.estado === "disponible");
  $("mt-herramienta").innerHTML = disp.length
    ? disp.map(h => '<option value="' + h.id + '">' + esc(h.codigo + " · " + h.nombre) + "</option>").join("")
    : '<option value="">No hay herramientas disponibles</option>';
  if(id) $("mt-herramienta").value = id;
  llenarPersonal("mt-persona");
  $("mt-salida").value = hoyISO();
  abrirModal("modal-prestamo");
}

function limpiarPrestamo(){
  ["mt-obs","mt-devolucion"].forEach(i => { if($(i)) $(i).value = ""; });
  limpiarFoto("mt-foto1"); limpiarFoto("mt-foto2");
}

function registrarPrestamo(){
  const h = db.herramientas.find(x => x.id === $("mt-herramienta").value);
  const p = db.personal.find(x => x.id === $("mt-persona").value);
  if(!h) return snack("Seleccione una herramienta disponible.", "err");
  if(!p) return snack("Seleccione al responsable.", "err");
  if(!fotos["mt-foto1"]) return snack("Tome la foto del responsable recibiendo la herramienta.", "err");

  h.estado = "prestada";
  h.asignadaA = p.id;
  h.prestamo = {
    personaId:p.id, responsable:p.nombre, salida:$("mt-salida").value || hoyISO(),
    devolucion:$("mt-devolucion").value || "", obs:$("mt-obs").value.trim(),
    fotoResponsable:fotos["mt-foto1"] || null, fotoHerramienta:fotos["mt-foto2"] || null,
    usuario:usuarioActual().nombre, fecha:ahora()
  };
  registrarMov({tipo:"prestamo", itemId:h.id, item:h.codigo + " · " + h.nombre, cantidad:1, unidad:"und",
    saldo:"", persona:p.nombre, area:p.area || "", documento:"", obs:h.prestamo.obs,
    foto1:h.prestamo.fotoResponsable, foto2:h.prestamo.fotoHerramienta});
  log("herramientas", "Préstamo registrado", h.codigo + " → " + p.nombre, h.id);

  if(!guardar()) return;
  cerrarModal("modal-prestamo");
  limpiarPrestamo();
  snack("Herramienta prestada a " + p.nombre + ".", "ok");
  refrescar(pantalla);
}
$("mt-registrar").addEventListener("click", registrarPrestamo);
$("mt-registrar2").addEventListener("click", registrarPrestamo);

async function devolverHerramienta(id){
  const h = db.herramientas.find(x => x.id === id);
  const p = h.prestamo ? db.personal.find(x => x.id === h.prestamo.personaId) : null;
  hoja("Devolución de " + h.nombre,
    '<div class="campo"><label>Estado en que se devuelve</label><select id="dv-estado">' +
    '<option value="Operativa">Operativa</option><option value="Observada">Observada</option>' +
    '<option value="Dada de baja">Dada de baja</option></select></div>' +
    '<div class="campo"><label>Observaciones</label><textarea id="dv-obs" placeholder="Daños, desgaste, faltantes"></textarea></div>',
    [{txt:"Cancelar", clase:"btn-cont"},
     {txt:"Registrar", clase:"btn-ok", fn:()=>{
        const estado = ($("dv-estado") || {}).value || "Operativa";
        const obs = ($("dv-obs") || {}).value || "";
        h.estado = estado === "Dada de baja" ? "baja" : "disponible";
        registrarMov({tipo:"devolucion", itemId:h.id, item:h.codigo + " · " + h.nombre, cantidad:1, unidad:"und",
          saldo:"", persona:p ? p.nombre : "", area:estado, documento:"", obs, foto1:null, foto2:null});
        h.asignadaA = null; h.prestamo = null;
        log("herramientas", "Devolución registrada", h.codigo + " · " + estado, h.id);
        if(guardar()){ snack("Devolución registrada (" + estado + ").", "ok"); refrescar(pantalla); }
     }}]);
  setTimeout(()=>{
    const s = $("dv-estado");
    if(s) s.parentElement.insertAdjacentHTML("beforebegin", "");
  }, 10);
}

/* =====================================================================
   16. MOVIMIENTOS, KARDEX Y PERSONAL
   ===================================================================== */
function registrarMov(mov){
  mov.id = uid();
  mov.fecha = ahora();
  mov.registro = usuarioActual() ? usuarioActual().nombre : "";
  mov.registroId = sesion ? sesion.usuarioId : null;
  db.movimientos.unshift(mov);
  return mov;
}

function llenarMateriales(idSel){
  const sel = $(idSel);
  if(!sel) return;
  const previo = sel.value;
  sel.innerHTML = '<option value="">— Seleccione material —</option>' +
    db.materiales.slice().sort((a,b)=> a.nombre.localeCompare(b.nombre))
      .map(m => '<option value="' + m.id + '">' + esc(m.codigo + " · " + m.nombre) + " (" + m.stock + " " + esc(m.unidad) + ")</option>").join("");
  if(previo && sel.querySelector('[value="' + previo + '"]')) sel.value = previo;
}

function llenarPersonal(idSel){
  const sel = $(idSel);
  if(!sel) return;
  const previo = sel.value;
  if(!db.personal.length){ sel.innerHTML = '<option value="">Registre personal de obra</option>'; return; }
  sel.innerHTML = '<option value="">— Seleccione persona —</option>' +
    db.personal.slice().sort((a,b)=> a.nombre.localeCompare(b.nombre))
      .map(p => '<option value="' + p.id + '">' + esc(p.nombre + (p.area ? " · " + p.area : "")) + "</option>").join("");
  if(previo && sel.querySelector('[value="' + previo + '"]')) sel.value = previo;
}

$("in-guardar").addEventListener("click", ()=>{
  const m = db.materiales.find(x => x.id === $("in-material").value);
  const cant = num($("in-cantidad").value);
  if(!m) return snack("Seleccione un material.", "err");
  if(cant <= 0) return snack("Ingrese una cantidad mayor a cero.", "err");
  m.stock = +(m.stock + cant).toFixed(2);
  registrarMov({tipo:"ingreso", itemId:m.id, item:m.nombre, cantidad:cant, unidad:m.unidad, saldo:m.stock,
    persona:$("in-proveedor").value.trim(), area:"", documento:$("in-documento").value.trim(),
    obs:$("in-obs").value.trim(), foto1:null, foto2:fotos["in-foto"] || null});
  log("movimientos", "Ingreso registrado", m.codigo + " +" + cant + " " + m.unidad, m.id);
  if(!guardar()) return;
  snack("Ingreso registrado · stock " + m.stock + " " + m.unidad, "ok");
  ["in-cantidad","in-proveedor","in-documento","in-obs"].forEach(i => $(i).value = "");
  $("in-material").value = "";
  limpiarFoto("in-foto");
  refrescar("movimientos");
});

$("sa-guardar").addEventListener("click", ()=>{
  const m = db.materiales.find(x => x.id === $("sa-material").value);
  const p = db.personal.find(x => x.id === $("sa-persona").value);
  const cant = num($("sa-cantidad").value);
  if(!m) return snack("Seleccione un material.", "err");
  if(cant <= 0) return snack("Ingrese una cantidad mayor a cero.", "err");
  if(cant > m.stock) return snack("Stock insuficiente: hay " + m.stock + " " + m.unidad + ".", "err");
  if(!p) return snack("Seleccione a quién se entrega.", "err");
  m.stock = +(m.stock - cant).toFixed(2);
  registrarMov({tipo:"salida", itemId:m.id, item:m.nombre, cantidad:cant, unidad:m.unidad, saldo:m.stock,
    persona:p.nombre, area:$("sa-area").value.trim(), documento:"", obs:$("sa-obs").value.trim(),
    foto1:fotos["sa-foto1"] || null, foto2:null});
  log("movimientos", "Salida registrada", m.codigo + " −" + cant + " " + m.unidad + " → " + p.nombre, m.id);
  if(!guardar()) return;
  snack("Salida registrada · queda " + m.stock + " " + m.unidad, "ok");
  ["sa-cantidad","sa-area","sa-obs"].forEach(i => $(i).value = "");
  $("sa-material").value = ""; $("sa-persona").value = "";
  limpiarFoto("sa-foto1");
  refrescar("movimientos");
});

let filtroKardex = "";
$("kx-filtros").addEventListener("click", e => {
  if(e.target.dataset.tipo === undefined) return;
  filtroKardex = e.target.dataset.tipo;
  $$("#kx-filtros button").forEach(b => b.classList.toggle("on", b === e.target));
  pintarKardex();
});
$("kx-texto").addEventListener("input", pintarKardex);

function filtrarKardex(){
  const q = sinTildes($("kx-texto").value);
  return db.movimientos.filter(m => {
    if(filtroKardex && m.tipo !== filtroKardex) return false;
    if(q && sinTildes([m.item, m.persona, m.area, m.obs, m.documento, m.registro].join(" ")).indexOf(q) < 0) return false;
    return true;
  });
}

function filaMov(m){
  const t = TIPOMOV[m.tipo] || TIPOMOV.ingreso;
  const cant = (m.tipo === "prestamo" || m.tipo === "devolucion")
    ? "1 und" : (m.tipo === "salida" ? "−" : "+") + m.cantidad + " " + m.unidad;
  return '<button class="fila" data-mov="' + m.id + '"><span class="mini ' + t.clase + '">' + ico(t.icono, 20) + "</span>" +
    '<span class="txt"><b>' + esc(m.item) + "</b><small>" + t.texto + (m.persona ? " · " + esc(m.persona) : "") + "</small></span>" +
    '<span class="der"><b>' + esc(cant) + "</b><small>" + fecha(m.fecha) + "</small></span></button>";
}

function pintarKardex(){
  const filas = filtrarKardex();
  $("kx-lista").innerHTML = filas.length
    ? filas.slice(0, 200).map(filaMov).join("")
    : '<div class="vacio">' + ico("camion", 40) +
      (db.movimientos.length ? "Ningún movimiento coincide con el filtro." : "Todavía no hay movimientos.") + "</div>";
  $$("#kx-lista [data-mov]").forEach(b => b.addEventListener("click", ()=> detalleMov(b.dataset.mov)));
}

function detalleMov(id){
  const m = db.movimientos.find(x => x.id === id);
  if(!m) return;
  const dato = (k,v) => v ? '<div class="dato"><span>' + k + "</span><b>" + esc(v) + "</b></div>" : "";
  let html = dato("Fecha", fecha(m.fecha)) + dato("Tipo", TIPOMOV[m.tipo].texto) + dato("Artículo", m.item) +
    dato("Cantidad", m.cantidad + " " + m.unidad) + (m.saldo === "" ? "" : dato("Saldo", m.saldo + " " + m.unidad)) +
    dato(m.tipo === "ingreso" ? "Proveedor" : "Responsable", m.persona) + dato("Área", m.area) +
    dato("Documento", m.documento) + dato("Registró", m.registro) + dato("Observaciones", m.obs);
  const fs = [m.foto1, m.foto2].filter(Boolean);
  if(fs.length) html += '<div style="display:flex;gap:8px;margin:12px 0 4px">' +
    fs.map(f => '<img src="' + f + '" class="thumb" style="width:48%;height:120px" data-zoom="' + f + '" alt="">').join("") + "</div>";
  hoja(TIPOMOV[m.tipo].texto, html);
}

$("kx-csv").addEventListener("click", ()=>{
  const filas = filtrarKardex();
  if(!filas.length) return snack("No hay movimientos para exportar.", "err");
  descargarBlob("kardex_" + hoyISO() + ".xlsx", crearXLSX([{nombre:"Kardex", filas:
    [["Fecha","Tipo","Artículo","Cantidad","Unidad","Saldo","Responsable","Área","Documento","Registró","Observaciones"]]
      .concat(filas.map(m => [fecha(m.fecha), TIPOMOV[m.tipo].texto, m.item,
        m.tipo === "salida" ? -m.cantidad : m.cantidad, m.unidad, m.saldo === "" ? "" : m.saldo,
        m.persona || "", m.area || "", m.documento || "", m.registro || "", m.obs || ""]))}]));
  snack("Kardex exportado (" + filas.length + " movimientos).", "ok");
});

/* --------- personal de obra --------- */
function pintarPersonal(){
  $("pr-lista").innerHTML = db.personal.length
    ? db.personal.map(p => {
        const n = db.herramientas.filter(h => h.asignadaA === p.id).length;
        return '<button class="fila" data-per="' + p.id + '">' +
          '<span class="mini">' + (p.foto ? '<img src="' + p.foto + '" alt="">' : ico("usuario", 20)) + "</span>" +
          '<span class="txt"><b>' + esc(p.nombre) + "</b><small>" +
          esc([p.cargo, p.area, p.dni ? "DNI " + p.dni : ""].filter(Boolean).join(" · ") || "Sin datos") + "</small></span>" +
          (n ? '<span class="der"><span class="chip alerta">' + n + " herr.</span></span>" : "") + "</button>";
      }).join("")
    : '<div class="vacio">' + ico("personas", 40) + "Sin personal registrado.<br>Use el botón <b>Nuevo operador</b>.</div>";
  $$("#pr-lista [data-per]").forEach(b => b.addEventListener("click", ()=> detallePersona(b.dataset.per)));
}

function detallePersona(id){
  const p = db.personal.find(x => x.id === id);
  const herr = db.herramientas.filter(h => h.asignadaA === p.id);
  let html = (p.foto ? '<div style="text-align:center;margin-bottom:12px"><img src="' + p.foto + '" data-zoom="' + p.foto +
      '" style="width:96px;height:96px;border-radius:999px;object-fit:cover" alt=""></div>' : "") +
    '<div class="dato"><span>DNI</span><b>' + esc(p.dni || "—") + "</b></div>" +
    '<div class="dato"><span>Área</span><b>' + esc(p.area || "—") + "</b></div>" +
    '<div class="dato"><span>Cargo</span><b>' + esc(p.cargo || "—") + "</b></div>";
  if(herr.length) html += '<div class="sech" style="margin:16px 0 6px">Herramientas a su cargo</div>' +
    herr.map(h => '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(h.nombre) +
      "</b><small>" + esc(h.codigo) + "</small></span></div>").join("");
  hoja(p.nombre, html, [
    {txt:"Editar", clase:"btn-cont", fn:()=> abrirOperador(p.id)},
    {txt:"Eliminar", clase:"btn-mal", fn:async ()=>{
      if(herr.length) return snack("Tiene herramientas sin devolver.", "err");
      if(!await confirmar("Eliminar operador", "Se eliminará a " + p.nombre + ". Los movimientos se conservan.", "Eliminar")) return;
      /* Se apaga, no se borra: una fila que desaparece no puede viajar a los
         otros equipos y el operador reaparecería en el siguiente sondeo. */
      if(window.almBorrar) almBorrar("personal", p.id, (usuarioActual() || {}).nombre);
      else db.personal = db.personal.filter(x => x.id !== p.id);
      log("personal", "Operador eliminado", p.nombre);
      if(guardar()){ snack("Operador eliminado.", "ok"); pintarPersonal(); }
    }},
    {txt:"Cerrar", clase:"btn-cont"}]);
}

function abrirOperador(id){
  limpiarOperador();
  if(id){
    const p = db.personal.find(x => x.id === id);
    $("mo-id").value = p.id; $("mo-nombre").value = p.nombre;
    $("mo-dni").value = p.dni || ""; $("mo-area").value = p.area || ""; $("mo-cargo").value = p.cargo || "";
    if(p.foto){
      fotos["mo-foto"] = p.foto;
      $("mo-foto-prev").innerHTML = '<img src="' + p.foto + '" class="thumb" alt=""><span class="ayuda" style="margin:0">Foto actual</span>';
    }
  }
  abrirModal("modal-personal");
}
function limpiarOperador(){
  ["mo-id","mo-nombre","mo-dni","mo-area","mo-cargo"].forEach(i => { if($(i)) $(i).value = ""; });
  limpiarFoto("mo-foto");
}
function registrarOperador(){
  const nombre = $("mo-nombre").value.trim(), dni = $("mo-dni").value.trim();
  if(!nombre) return snack("Escriba el nombre.", "err");
  if(dni && !/^\d{8}$/.test(dni)) return snack("El DNI debe tener 8 dígitos.", "err");
  const id = $("mo-id").value;
  const datos = {nombre, dni, area:$("mo-area").value.trim(), cargo:$("mo-cargo").value.trim()};
  if(id){
    const p = db.personal.find(x => x.id === id);
    Object.assign(p, datos);
    if(fotos["mo-foto"]) p.foto = fotos["mo-foto"];
    log("personal", "Operador editado", nombre, id);
  }else{
    if(dni && db.personal.some(p => p.dni === dni)) return snack("Ya existe un operador con ese DNI.", "err");
    const p = Object.assign({id:uid(), foto:fotos["mo-foto"] || null, creado:ahora()}, datos);
    db.personal.push(p);
    log("personal", "Operador registrado", nombre, p.id);
  }
  if(!guardar()) return;
  cerrarModal("modal-personal");
  limpiarOperador();
  snack("Operador guardado.", "ok");
  refrescar(pantalla);
}
$("mo-registrar").addEventListener("click", registrarOperador);
$("mo-registrar2").addEventListener("click", registrarOperador);

/* =====================================================================
   17. COMPRAS, GUÍA DE REMISIÓN E INGRESO
   ===================================================================== */
function pintarPorAtender(){
  const lista = db.requerimientos.filter(r => ["aprobado","en_compra","despachado"].indexOf(r.estado) >= 0);
  $("cp-lista").innerHTML = lista.length
    ? lista.map(r => {
        const dias = Math.floor(horas(r.fecha, ahora()) / 24);
        return '<button class="fila" data-req="' + r.id + '"><span class="mini">' + ico("carrito", 20) + "</span>" +
          '<span class="txt"><b>' + esc(r.codigo + " · " + r.items[0].desc) + "</b><small>" +
          esc(r.solicitante) + " · " + dias + " días" + (r.oc ? " · OC " + esc(r.oc.numero) : "") + "</small></span>" +
          '<span class="der"><span class="chip ' + ESTADOS[r.estado].chip + '">' + ESTADOS[r.estado].texto + "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("check", 40) + "No hay requerimientos esperando compra.</div>";
  $$("#cp-lista [data-req]").forEach(b => b.addEventListener("click", ()=> detalleReq(b.dataset.req)));
}

function llenarCompras(){
  const aprob = db.requerimientos.filter(r => r.estado === "aprobado");
  $("oc-req").innerHTML = aprob.length
    ? '<option value="">— Seleccione requerimiento —</option>' +
      aprob.map(r => '<option value="' + r.id + '">' + esc(r.codigo + " · " + r.items[0].desc) + "</option>").join("")
    : '<option value="">No hay requerimientos aprobados</option>';

  const enC = db.requerimientos.filter(r => r.estado === "en_compra" || r.estado === "aprobado");
  $("gu-req").innerHTML = enC.length
    ? '<option value="">— Seleccione requerimiento —</option>' +
      enC.map(r => '<option value="' + r.id + '">' + esc(r.codigo + (r.oc ? " · OC " + r.oc.numero : "")) + "</option>").join("")
    : '<option value="">No hay requerimientos en compra</option>';
}

$("oc-guardar").addEventListener("click", ()=>{
  if(!puede("compras")) return snack("Su rol no registra órdenes de compra.", "err");
  const r = db.requerimientos.find(x => x.id === $("oc-req").value);
  if(!r) return snack("Seleccione un requerimiento aprobado.", "err");
  const numero = $("oc-numero").value.trim();
  if(!numero) return snack("Escriba el número de la orden de compra.", "err");

  r.oc = {numero, proveedor:$("oc-proveedor").value.trim(), monto:num($("oc-monto").value),
          entrega:$("oc-entrega").value, foto:fotos["oc-foto"] || null,
          usuario:usuarioActual().nombre, fecha:ahora()};
  historia(r, "en_compra", "OC " + numero);
  log("compras", "Orden de compra registrada", r.codigo + " · " + numero, r.id);
  notificar({usuarios:[r.solicitanteId], roles:["jefatura","admin"],
    titulo:"Compra en proceso: " + r.codigo,
    cuerpo:"OC " + numero + (r.oc.proveedor ? " · " + r.oc.proveedor : "") +
           (r.oc.entrega ? "\nEntrega prometida: " + soloFecha(r.oc.entrega) : ""),
    refTipo:"requerimiento", refId:r.id});
  if(!guardar()) return;
  snack("Orden de compra registrada.", "ok");
  ["oc-numero","oc-proveedor","oc-monto","oc-entrega"].forEach(i => $(i).value = "");
  limpiarFoto("oc-foto");
  refrescar("compras");
});

$("gu-guardar").addEventListener("click", ()=>{
  if(!puede("compras")) return snack("Su rol no registra guías de remisión.", "err");
  const r = db.requerimientos.find(x => x.id === $("gu-req").value);
  if(!r) return snack("Seleccione un requerimiento.", "err");
  const guia = $("gu-numero").value.trim();
  if(!guia) return snack("Escriba el número de guía.", "err");
  if(!adjuntos["gu-pdf"]) return snack("Adjunte la guía de remisión en PDF.", "err");

  r.despacho = {guia, transporte:$("gu-transporte").value.trim(), pdf:adjuntos["gu-pdf"],
                foto:fotos["gu-foto"] || null, usuario:usuarioActual().nombre, fecha:ahora()};
  historia(r, "despachado", "Guía " + guia);

  let ingresados = 0;
  if($("gu-inventario").checked){
    r.items.forEach(it => {
      let m = db.materiales.find(x => sinTildes(x.nombre) === sinTildes(it.desc));
      if(!m){
        m = {id:uid(), codigo:codigo("MAT"), nombre:it.desc, categoria:"General", unidad:it.unidad,
             stock:0, minimo:0, obs:"", foto:it.foto || null, creado:ahora()};
        db.materiales.push(m);
      }
      m.stock = +(m.stock + it.cant).toFixed(2);
      registrarMov({tipo:"ingreso", itemId:m.id, item:m.nombre, cantidad:it.cant, unidad:m.unidad,
        saldo:m.stock, persona:r.oc ? r.oc.proveedor : "", area:"", documento:guia,
        obs:"Ingreso por guía de " + r.codigo, foto1:null, foto2:r.despacho.foto});
      ingresados++;
    });
    r.recepcion = {usuario:usuarioActual().nombre, fecha:ahora(), guia, obs:"Ingreso automático desde la guía", foto:r.despacho.foto};
    historia(r, "recibido", "Ingreso al inventario");
  }

  log("compras", "Guía de remisión registrada", r.codigo + " · " + guia + " · " + ingresados + " ítems al inventario", r.id);
  notificar({usuarios:[r.solicitanteId], roles:["jefatura","admin"],
    titulo:"Pedido atendido: " + r.codigo,
    cuerpo:"Guía " + guia + "\n" + (ingresados ? ingresados + " ítem(s) ingresaron al inventario." : "Pendiente de recepción en almacén."),
    refTipo:"requerimiento", refId:r.id});

  if(!guardar()) return;
  snack("Guía registrada" + (ingresados ? " e inventario actualizado." : "."), "ok");
  ["gu-numero","gu-transporte"].forEach(i => $(i).value = "");
  limpiarArchivo("gu-pdf"); limpiarFoto("gu-foto");
  refrescar("compras");
});

/* =====================================================================
   18. CONSOLIDADO DE OBRA
   ===================================================================== */
const COLS_CONSOLIDADO = [
  {clave:"desc",      alias:["descripcion","material","item","detalle","producto","articulo","insumo"]},
  {clave:"unidad",    alias:["unidad","und","um","medida"]},
  {clave:"requerido", alias:["cantidad","cant","requerido","total","metrado","solicitado"]},
  {clave:"comprado",  alias:["comprado","comprados","adquirido","atendido"]},
  {clave:"entregado", alias:["entregado","entregados","despachado","instalado"]},
  {clave:"categoria", alias:["categoria","rubro","partida","tipo","grupo"]}
];

$("co-archivo").addEventListener("change", async ()=>{
  const archivo = $("co-archivo").files[0];
  if(!archivo) return;
  snack("Leyendo " + archivo.name + "…");
  try{
    const filas = await leerTabla(archivo);
    const res = importarConsolidado(filas, archivo.name);
    snack(res.cargados + " materiales cargados del consolidado.", "ok");
    ir("consolidado");
  }catch(e){
    snack(e.message || "No se pudo leer el archivo.", "err");
  }
  $("co-archivo").value = "";
});

function importarConsolidado(filas, nombreArchivo){
  if(!filas.length) throw new Error("El archivo está vacío.");
  let iCab = -1, mapa = {};
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    const prueba = {};
    (filas[i] || []).forEach((celda, c)=>{
      const t = sinTildes(celda);
      COLS_CONSOLIDADO.forEach(col => { if(col.alias.indexOf(t) >= 0 && prueba[col.clave] === undefined) prueba[col.clave] = c; });
    });
    if(prueba.desc !== undefined){ iCab = i; mapa = prueba; break; }
  }
  if(iCab < 0) throw new Error('No se encontró la columna "Descripción" o "Material" en el Excel.');

  const dato = (f, k) => mapa[k] === undefined ? "" : String(f[mapa[k]] == null ? "" : f[mapa[k]]).trim();
  const items = [];
  for(let i = iCab + 1; i < filas.length; i++){
    const f = filas[i] || [];
    const desc = dato(f, "desc");
    if(!desc) continue;
    items.push({
      id:uid(), desc, unidad:dato(f, "unidad") || "und",
      requerido:num(dato(f, "requerido")) || 0,
      comprado:num(dato(f, "comprado")) || 0,
      entregado:num(dato(f, "entregado")) || 0,
      categoria:dato(f, "categoria") || "General"
    });
  }
  if(!items.length) throw new Error("No se encontró ninguna fila con material.");

  db.consolidado = {archivo:nombreArchivo, cargado:ahora(), items, usuario:usuarioActual().nombre};
  log("consolidado", "Consolidado cargado", nombreArchivo + " · " + items.length + " materiales");
  guardar();
  return {cargados:items.length};
}

function estadoConsolidado(it){
  if(it.entregado >= it.requerido && it.requerido > 0) return "entregado";
  if(it.comprado >= it.requerido && it.requerido > 0) return "comprado";
  return "pendiente";
}
const ESTADO_CONS = {
  pendiente:{txt:"Por comprar", chip:"mal"},
  comprado: {txt:"Comprado",    chip:"alerta"},
  entregado:{txt:"Entregado",   chip:"ok"}
};

function avanceConsolidado(){
  const it = db.consolidado.items;
  const req = it.reduce((s,x)=> s + x.requerido, 0);
  const ent = it.reduce((s,x)=> s + Math.min(x.entregado, x.requerido || x.entregado), 0);
  return {
    total:it.length,
    comprados:it.filter(x => estadoConsolidado(x) !== "pendiente").length,
    pendientes:it.filter(x => estadoConsolidado(x) === "pendiente").length,
    entregados:it.filter(x => estadoConsolidado(x) === "entregado").length,
    avance: req > 0 ? Math.round(ent / req * 100) : 0
  };
}

let filtroCons = "";
$("co-buscar").addEventListener("input", pintarConsolidado);
$("co-filtros").addEventListener("click", e => {
  if(e.target.dataset.f === undefined) return;
  filtroCons = e.target.dataset.f;
  $$("#co-filtros button").forEach(b => b.classList.toggle("on", b === e.target));
  pintarConsolidado();
});

function pintarConsolidado(){
  const cargado = db.consolidado.items.length > 0;
  $("co-carga").innerHTML = cargado
    ? '<div class="card plano" style="display:flex;align-items:center;gap:12px">' +
      '<span class="mini" style="width:42px;height:42px;border-radius:12px;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center">' +
      ico("tabla", 20) + "</span><div style='flex:1;min-width:0'><b style='font-size:14px'>" + esc(db.consolidado.archivo || "Consolidado") +
      "</b><br><small style='color:var(--tinta-sec);font-size:12px'>" + db.consolidado.items.length + " materiales · cargado " +
      hace(db.consolidado.cargado) + "</small></div>" +
      (puede("consolidado.editar") ? '<button class="btn btn-mini btn-cont" id="co-recargar">Reemplazar</button>' : "") + "</div>"
    : '<div class="vacio">' + ico("tabla", 40) + "Aún no se ha cargado el consolidado de obra.<br>" +
      (puede("consolidado.editar") ? "Use el botón <b>Cargar Excel</b>." : "Solicítelo al almacenero.") + "</div>";
  if($("co-recargar")) $("co-recargar").addEventListener("click", ()=> $("co-archivo").click());

  $("co-buscar").parentElement.classList.toggle("oculto", !cargado);
  $("co-filtros").classList.toggle("oculto", !cargado);

  if(!cargado){ $("co-lista").innerHTML = ""; $("co-resumen").innerHTML = ""; return; }

  const q = sinTildes($("co-buscar").value);
  let lista = db.consolidado.items;
  if(filtroCons) lista = lista.filter(x => estadoConsolidado(x) === filtroCons);
  if(q) lista = lista.filter(x => sinTildes(x.desc + " " + x.categoria).indexOf(q) >= 0);

  $("co-lista").innerHTML = lista.length
    ? lista.slice(0, 300).map(it => {
        const e = ESTADO_CONS[estadoConsolidado(it)];
        const pct = it.requerido > 0 ? Math.min(100, Math.round(it.entregado / it.requerido * 100)) : 0;
        return '<button class="fila" data-cons="' + it.id + '"><span class="mini ' + e.chip + '">' + ico("caja", 20) + "</span>" +
          '<span class="txt"><b>' + esc(it.desc) + "</b><small>" + esc(it.categoria) + " · req. " + it.requerido + " " +
          esc(it.unidad) + " · comp. " + it.comprado + " · entr. " + it.entregado + "</small>" +
          '<span class="barra" style="margin:6px 0 0"><span class="via" style="display:block"><span class="lleno" style="display:block;width:' +
          pct + '%"></span></span></span></span>' +
          '<span class="der"><span class="chip ' + e.chip + '">' + e.txt + "</span><small>" + pct + "%</small></span></button>";
      }).join("")
    : '<div class="vacio">Ningún material coincide con el filtro.</div>';
  $$("#co-lista [data-cons]").forEach(b => b.addEventListener("click", ()=> detalleConsolidado(b.dataset.cons)));

  const a = avanceConsolidado();
  $("co-resumen").innerHTML =
    '<div class="card acento" style="margin-top:14px">' +
    '<div class="sech" style="margin:0 0 10px">Resumen del consolidado</div>' +
    '<div class="dato"><span>Total materiales</span><b>' + a.total + "</b></div>" +
    '<div class="dato"><span>Comprados</span><b>' + a.comprados + "</b></div>" +
    '<div class="dato"><span>Pendientes</span><b>' + a.pendientes + "</b></div>" +
    '<div class="dato"><span>Entregados</span><b>' + a.entregados + "</b></div>" +
    '<div class="barra ok" style="margin-top:12px"><div class="rot"><span>Avance de obra</span><b>' + a.avance + "%</b></div>" +
    '<div class="via"><div class="lleno" style="width:' + a.avance + '%"></div></div></div>' +
    (puede("consolidado") ? '<button class="btn btn-cont btn-mini" id="co-exportar" style="width:100%;margin-top:12px">Exportar consolidado</button>' : "") +
    "</div>";
  if($("co-exportar")) $("co-exportar").addEventListener("click", exportarConsolidado);
}

function detalleConsolidado(id){
  const it = db.consolidado.items.find(x => x.id === id);
  if(!it) return;
  const e = ESTADO_CONS[estadoConsolidado(it)];
  const html = '<div class="dato"><span>Categoría</span><b>' + esc(it.categoria) + "</b></div>" +
    '<div class="dato"><span>Requerido</span><b>' + it.requerido + " " + esc(it.unidad) + "</b></div>" +
    '<div class="dato"><span>Comprado</span><b>' + it.comprado + " " + esc(it.unidad) + "</b></div>" +
    '<div class="dato"><span>Entregado</span><b>' + it.entregado + " " + esc(it.unidad) + "</b></div>" +
    '<div class="dato"><span>Estado</span><b><span class="chip ' + e.chip + '">' + e.txt + "</span></b></div>" +
    (puede("consolidado.editar")
      ? '<div class="dos" style="margin-top:14px"><div class="campo"><label>Comprado</label><input type="number" id="co-i-comp" min="0" step="0.01" value="' + it.comprado + '"></div>' +
        '<div class="campo"><label>Entregado</label><input type="number" id="co-i-ent" min="0" step="0.01" value="' + it.entregado + '"></div></div>'
      : "");

  const acc = [];
  if(puede("consolidado.editar")){
    acc.push({txt:"Guardar avance", clase:"btn-pri", fn:()=>{
      it.comprado = num(($("co-i-comp") || {}).value);
      it.entregado = num(($("co-i-ent") || {}).value);
      log("consolidado", "Avance actualizado", it.desc + " · comp " + it.comprado + " · entr " + it.entregado);
      if(guardar()){ snack("Avance actualizado.", "ok"); pintarConsolidado(); }
    }});
    acc.push({txt:"Pedir este material", clase:"btn-cont", fn:()=>{
      abrirRequerimiento();
      $("mr-desc").value = it.desc;
      $("mr-cant").value = Math.max(0, it.requerido - it.comprado) || it.requerido;
      $("mr-unidad").value = it.unidad;
    }});
  }
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja(it.desc, html, acc);
}

function exportarConsolidado(){
  const a = avanceConsolidado();
  const filas = [["Material","Categoría","Unidad","Requerido","Comprado","Entregado","Pendiente","Estado","Avance %"]]
    .concat(db.consolidado.items.map(it => [
      it.desc, it.categoria, it.unidad, it.requerido, it.comprado, it.entregado,
      Math.max(0, +(it.requerido - it.comprado).toFixed(2)), ESTADO_CONS[estadoConsolidado(it)].txt,
      it.requerido > 0 ? Math.min(100, Math.round(it.entregado / it.requerido * 100)) : 0]))
    .concat([[], ["RESUMEN"], ["Total materiales", a.total], ["Comprados", a.comprados],
             ["Pendientes", a.pendientes], ["Entregados", a.entregados], ["Avance %", a.avance]]);
  descargarBlob("consolidado_" + hoyISO() + ".xlsx", crearXLSX([{nombre:"Consolidado", filas}]));
  snack("Consolidado exportado.", "ok");
}

/* =====================================================================
   19. SOLICITUDES DE ACCESO
   ===================================================================== */
$("lg-solicitar").addEventListener("click", ()=>{
  $("scr-login").classList.remove("activa");
  $("scr-solicitud").classList.add("activa");
});
$("so-cancelar").addEventListener("click", volverALogin);

function volverALogin(){
  $("scr-solicitud").classList.remove("activa");
  $("scr-login").classList.add("activa");
  ["so-nombre","so-dni","so-correo","so-celular","so-usuario","so-clave","so-clave2"].forEach(i => { if($(i)) $(i).value = ""; });
  $("so-area-tipo").value = "";
  $("so-campo-cargo").classList.add("oculto");
  limpiarFoto("so-foto");
}

/* Cargos disponibles al solicitar acceso, con el rol y el área que reciben. */
const CARGOS = {
  administrativa:[
    {cargo:"Almacenero",                rol:"almacenero", area:"Almacén"},
    {cargo:"Compras",                   rol:"compras",    area:"Logística"},
    {cargo:"Administrador(a) de Obra",  rol:"obra",       area:"Obra"},
    {cargo:"Jefe(a) Logístico",         rol:"jefatura",   area:"Logística"}
  ],
  supervision:[
    {cargo:"Supervisor Civil",     rol:"supervisor", area:"Civil"},
    {cargo:"Supervisor Mecánico",  rol:"supervisor", area:"Mecánico"},
    {cargo:"Supervisor Eléctrico", rol:"supervisor", area:"Eléctrico"}
  ]
};
function todosLosCargos(){ return CARGOS.administrativa.concat(CARGOS.supervision); }
function cargoPorNombre(n){ return todosLosCargos().find(c => c.cargo === n) || null; }

$("so-area-tipo").addEventListener("change", ()=>{
  const tipo = $("so-area-tipo").value;
  const lista = CARGOS[tipo] || [];
  $("so-campo-cargo").classList.toggle("oculto", !lista.length);
  $("so-cargo-sel").innerHTML = lista.map(c => '<option value="' + esc(c.cargo) + '">' + esc(c.cargo) + "</option>").join("");
});

$("so-enviar").addEventListener("click", async ()=>{
  const nombre  = $("so-nombre").value.trim();
  const dni     = $("so-dni").value.trim();
  const correo  = $("so-correo").value.trim();
  const celular = $("so-celular").value.replace(/\s+/g, "");
  const tipo    = $("so-area-tipo").value;
  const cargo   = $("so-cargo-sel").value;
  const usuario = $("so-usuario").value.trim().toLowerCase();
  const clave   = $("so-clave").value, clave2 = $("so-clave2").value;

  if(!nombre) return snack("Escriba su nombre completo.", "err");
  if(!/^\d{8}$/.test(dni)) return snack("El DNI debe tener 8 dígitos.", "err");
  if(!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo)) return snack("Escriba un correo válido.", "err");
  if(!/^\d{6,12}$/.test(celular)) return snack("Escriba un número de celular válido.", "err");
  if(!tipo) return snack("Seleccione el área.", "err");
  if(!cargo) return snack("Seleccione su cargo.", "err");
  if(!/^[a-z0-9._-]{4,}$/.test(usuario)) return snack("Usuario: mínimo 4 caracteres, sin espacios ni tildes.", "err");
  if(db.usuarios.some(u => u.usuario === usuario) || db.solicitudes.some(s => s.usuario === usuario && s.estado === "pendiente"))
    return snack("Ese usuario ya está tomado o tiene una solicitud pendiente.", "err");
  if(db.usuarios.some(u => u.dni === dni)) return snack("Ya existe un usuario con ese DNI.", "err");
  if(clave.length < 6) return snack("La contraseña debe tener al menos 6 caracteres.", "err");
  if(clave !== clave2) return snack("Las contraseñas no coinciden.", "err");

  const def = cargoPorNombre(cargo);
  const sal = uid();
  db.solicitudes.unshift({
    id:uid(), nombre, dni, correo, celular, areaTipo:tipo, cargo,
    rol:def ? def.rol : "supervisor", area:def ? def.area : "", usuario, sal,
    hash: await hashClave(clave, sal),
    foto:fotos["so-foto"] || null, fecha:ahora(), estado:"pendiente", revisadoPor:"", motivo:""
  });
  db.historial.unshift({id:uid(), fecha:ahora(), modulo:"solicitudes", accion:"Solicitud de acceso enviada",
    detalle:nombre + " (" + usuario + ")", usuario:nombre, usuarioId:null, refId:null});
  notificar({roles:["admin"], titulo:"Nueva solicitud de acceso",
    cuerpo:nombre + " · " + cargo + "\nDNI: " + dni + " · " + correo + " · " + celular +
           "\nUsuario solicitado: " + usuario, refTipo:"solicitud"});
  if(!guardar()) return;
  volverALogin();
  hoja("Solicitud enviada",
    "<p style='margin:4px 0 10px'>Su solicitud quedó registrada. El administrador la revisará y habilitará su ingreso.</p>" +
    '<div class="dato"><span>Usuario solicitado</span><b>' + esc(usuario) + "</b></div>" +
    '<div class="dato"><span>Estado</span><b><span class="chip alerta">Pendiente</span></b></div>');
});

/* =====================================================================
   20. PANEL DE ADMINISTRACIÓN
   ===================================================================== */
function pintarSolicitudes(){
  const lista = db.solicitudes;
  $("ad-solicitudes").innerHTML = lista.length
    ? lista.map(s => {
        const chip = s.estado === "pendiente" ? "alerta" : (s.estado === "aprobada" ? "ok" : "mal");
        return '<div class="card"><div style="display:flex;align-items:center;gap:12px">' +
          '<span class="mini" style="width:46px;height:46px;border-radius:12px;overflow:hidden;background:var(--sup-var);color:var(--pri);display:flex;align-items:center;justify-content:center">' +
          (s.foto ? '<img src="' + s.foto + '" style="width:100%;height:100%;object-fit:cover" data-zoom="' + s.foto + '" alt="">' : ico("usuario", 20)) + "</span>" +
          "<div style='flex:1;min-width:0'><b style='font-size:15px'>" + esc(s.nombre) + "</b>" +
          "<div style='font-size:12.5px;color:var(--tinta-sec)'>" + esc(s.cargo) + "</div></div>" +
          '<span class="chip ' + chip + '">' + s.estado[0].toUpperCase() + s.estado.slice(1) + "</span></div>" +
          '<div class="dato" style="margin-top:8px"><span>Usuario solicitado</span><b>' + esc(s.usuario) + "</b></div>" +
          (s.dni ? '<div class="dato"><span>DNI</span><b>' + esc(s.dni) + "</b></div>" : "") +
          (s.correo ? '<div class="dato"><span>Correo</span><b>' + esc(s.correo) + "</b></div>" : "") +
          (s.celular ? '<div class="dato"><span>Celular</span><b>' + esc(s.celular) + "</b></div>" : "") +
          '<div class="dato"><span>Fecha</span><b>' + fecha(s.fecha) + "</b></div>" +
          (s.motivo ? '<div class="dato"><span>Motivo</span><b>' + esc(s.motivo) + "</b></div>" : "") +
          (s.estado === "pendiente"
            ? '<div class="btns" style="margin-top:10px"><button class="btn btn-mal" data-rech="' + s.id + '">Rechazar</button>' +
              '<button class="btn btn-ok" data-aprob="' + s.id + '">Aprobar</button></div>'
            : "") + "</div>";
      }).join("")
    : '<div class="vacio">' + ico("escudo", 40) + "No hay solicitudes de acceso.</div>";

  $$("[data-aprob]").forEach(b => b.addEventListener("click", ()=> aprobarSolicitud(b.dataset.aprob)));
  $$("[data-rech]").forEach(b => b.addEventListener("click", ()=> rechazarSolicitud(b.dataset.rech)));
}

function aprobarSolicitud(id){
  const s = db.solicitudes.find(x => x.id === id);
  if(!s) return;
  /* V46 · Una solicitud se aprueba UNA vez.
     Sin esto, cada toque del botón creaba otra cuenta con el mismo usuario:
     de una sola solicitud de luis.focon salieron nueve cuentas, y con la
     sincronización las nueve viajaron a todos los equipos. */
  if(s.estado !== "pendiente")
    return snack("Esa solicitud ya fue " + s.estado + ".", "err");
  if(db.usuarios.some(u => u.usuario === s.usuario))
    return snack("Ya existe una cuenta con el usuario " + s.usuario + ".", "err");
  const cargos = todosLosCargos();
  const dato = (k,v) => v ? '<div class="dato"><span>' + k + "</span><b>" + esc(v) + "</b></div>" : "";
  hoja("Aprobar a " + s.nombre,
    dato("DNI", s.dni) + dato("Correo", s.correo) + dato("Celular", s.celular) +
    dato("Cargo solicitado", s.cargo) + dato("Usuario", s.usuario) +
    "<p style='margin:12px 0 8px;color:var(--tinta-sec);font-size:13px'>Confirme el cargo. Los permisos se asignan solos.</p>" +
    '<div class="campo"><label>Cargo</label><select id="ap-cargo">' +
    cargos.map(c => '<option value="' + esc(c.cargo) + '"' + (c.cargo === s.cargo ? " selected" : "") + ">" +
      esc(c.cargo) + "</option>").join("") + "</select></div>" +
    '<div class="ayuda" id="ap-resumen"></div>',
    [{txt:"Cancelar", clase:"btn-cont"},
     {txt:"Aprobar acceso", clase:"btn-ok", fn:()=>{
        /* La hoja puede quedar abierta y recibir otro toque, o llegar la
           aprobación de otro equipo por sincronización mientras está abierta.
           Se vuelve a comprobar acá, que es donde se crea la cuenta. */
        if(s.estado !== "pendiente")
          return snack("Esa solicitud ya fue " + s.estado + ".", "err");
        if(db.usuarios.some(u => u.usuario === s.usuario))
          return snack("Ya existe una cuenta con el usuario " + s.usuario + ".", "err");
        const def = cargoPorNombre(($("ap-cargo") || {}).value) || cargoPorNombre(s.cargo) || {rol:"supervisor", area:""};
        const u = {
          id:uid(), nombre:s.nombre, usuario:s.usuario, cargo:def.cargo || s.cargo, area:def.area || s.area || "",
          dni:s.dni || "", correo:s.correo || "", celular:s.celular || "",
          rol:def.rol, esAdmin:false, sal:s.sal, hash:s.hash, hashAlt:null, foto:s.foto || null,
          activo:true, creado:ahora(), ultimoAcceso:null, permisosExtra:[]
        };
        db.usuarios.push(u);
        s.estado = "aprobada";
        s.revisadoPor = usuarioActual().nombre;
        s.revisado = ahora();
        auditar("usuarios", "Solicitud aprobada", {refId:u.id, antes:"pendiente", despues:"aprobada",
          comentario:s.nombre + " ingresa como " + u.cargo});
        if(guardar()){ snack(s.nombre + " ya puede ingresar como " + u.cargo + ".", "ok"); refrescar("admin"); }
     }}]);
  setTimeout(()=>{
    const sel = $("ap-cargo");
    const pinta = ()=>{
      const def = cargoPorNombre(sel.value);
      $("ap-resumen").textContent = def ? ROLES[def.rol].resumen : "";
    };
    if(sel){ sel.addEventListener("change", pinta); pinta(); }
  }, 60);
}

async function rechazarSolicitud(id){
  const s = db.solicitudes.find(x => x.id === id);
  const motivo = await pedirTexto("Rechazar solicitud", "Motivo (opcional)");
  if(motivo === null) return;
  s.estado = "rechazada";
  s.motivo = motivo || "";
  s.revisadoPor = usuarioActual().nombre;
  log("solicitudes", "Solicitud rechazada", s.nombre + (motivo ? " · " + motivo : ""), s.id);
  if(guardar()){ snack("Solicitud rechazada.", "ok"); refrescar("admin"); }
}

function pintarUsuarios(){
  const yo = usuarioActual();
  $("ad-usuarios").innerHTML = db.usuarios.map(u => {
    return '<button class="fila" data-usr="' + u.id + '">' +
      '<span class="mini">' + (u.foto ? '<img src="' + u.foto + '" alt="">' : ico(u.esAdmin ? "escudo" : "usuario", 20)) + "</span>" +
      '<span class="txt"><b>' + esc(u.nombre) + (u.id === yo.id ? " (usted)" : "") + "</b><small>" +
      esc(u.usuario + " · " + ROLES[u.rol].nombre) + "</small></span>" +
      '<span class="der"><span class="chip ' + (u.activo ? "ok" : "mal") + '">' + (u.activo ? "Activo" : "Inactivo") + "</span>" +
      (u.ultimoAcceso ? "<small>" + hace(u.ultimoAcceso) + "</small>" : "<small>sin ingresos</small>") + "</span></button>";
  }).join("");
  $$("#ad-usuarios [data-usr]").forEach(b => b.addEventListener("click", ()=> gestionarUsuario(b.dataset.usr)));
}

function gestionarUsuario(id){
  const u = db.usuarios.find(x => x.id === id);
  const yo = usuarioActual();
  const html = '<div class="dato"><span>Usuario</span><b>' + esc(u.usuario) + "</b></div>" +
    '<div class="dato"><span>Cargo</span><b>' + esc(u.cargo || "—") + "</b></div>" +
    '<div class="dato"><span>Rol</span><b>' + esc(ROLES[u.rol].nombre) + "</b></div>" +
    '<div class="dato"><span>Estado</span><b>' + (u.activo ? "Activo" : "Desactivado") + "</b></div>" +
    '<div class="dato"><span>Creado</span><b>' + soloFecha(u.creado) + "</b></div>" +
    '<div class="dato"><span>Último ingreso</span><b>' + (u.ultimoAcceso ? fecha(u.ultimoAcceso) : "—") + "</b></div>" +
    "<p style='margin:12px 0 4px;color:var(--tinta-sec);font-size:13px'>" + esc(ROLES[u.rol].resumen) + "</p>";

  const acc = [{txt:"Editar", clase:"btn-cont", fn:()=> abrirUsuario(u.id)}];
  if(u.id !== yo.id){
    acc.push({txt:u.activo ? "Desactivar" : "Activar", clase:u.activo ? "btn-mal" : "btn-ok", fn:()=>{
      u.activo = !u.activo;
      log("usuarios", u.activo ? "Usuario activado" : "Usuario desactivado", u.nombre, u.id);
      if(guardar()){ snack(u.activo ? "Usuario activado." : "Usuario desactivado.", "ok"); pintarUsuarios(); }
    }});
    acc.push({txt:"Eliminar", clase:"btn-mal", fn:async ()=>{
      if(!await confirmar("Eliminar usuario", "Se eliminará la cuenta de " + u.nombre + ". Su historial se conserva.", "Eliminar")) return;
      /* Se apaga, no se borra (ver personal): así la baja llega a todos. */
      if(window.almBorrar) almBorrar("usuarios", u.id, (usuarioActual() || {}).nombre);
      else db.usuarios = db.usuarios.filter(x => x.id !== u.id);
      log("usuarios", "Usuario eliminado", u.nombre, u.id);
      if(guardar()){ snack("Usuario eliminado.", "ok"); pintarUsuarios(); }
    }});
  }
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja(u.nombre, html, acc);
}

function abrirUsuario(id){
  limpiarUsuario();
  $("mu-rol").innerHTML = Object.keys(ROLES).filter(k => k !== "admin")
    .map(k => '<option value="' + k + '">' + ROLES[k].nombre + "</option>").join("");
  if(id){
    const u = db.usuarios.find(x => x.id === id);
    $("mu-titulo").textContent = "Editar usuario";
    $("mu-id").value = u.id;
    $("mu-nombre").value = u.nombre;
    $("mu-cargo").value = u.cargo || "";
    $("mu-area").value = u.area || "";
    $("mu-usuario").value = u.usuario;
    $("mu-rol").value = u.rol;
    if(u.foto){
      fotos["mu-foto"] = u.foto;
      $("mu-foto-prev").innerHTML = '<img src="' + u.foto + '" class="thumb" alt=""><span class="ayuda" style="margin:0">Foto actual</span>';
    }
  }else{
    $("mu-titulo").textContent = "Nuevo usuario";
  }
  mostrarPermisosRol();
  abrirModal("modal-usuario");
}
function limpiarUsuario(){
  ["mu-id","mu-nombre","mu-cargo","mu-area","mu-usuario","mu-clave"].forEach(i => { if($(i)) $(i).value = ""; });
  limpiarFoto("mu-foto");
}
function mostrarPermisosRol(){
  const r = ROLES[$("mu-rol").value];
  $("mu-permisos").textContent = r ? r.resumen : "";
}
$("mu-rol").addEventListener("change", mostrarPermisosRol);

async function registrarUsuario(){
  if(rolEfectivo() !== "admin") return snack("Solo el administrador gestiona usuarios.", "err");
  const id = $("mu-id").value;
  const nombre = $("mu-nombre").value.trim();
  const usuario = $("mu-usuario").value.trim().toLowerCase();
  const clave = $("mu-clave").value;
  const rol = $("mu-rol").value;
  if(!nombre) return snack("Escriba el nombre completo.", "err");
  if(!/^[a-z0-9._-]{4,}$/.test(usuario)) return snack("Usuario: mínimo 4 caracteres, sin espacios ni tildes.", "err");
  if(db.usuarios.some(u => u.usuario === usuario && u.id !== id)) return snack("Ese usuario ya existe.", "err");

  if(id){
    const u = db.usuarios.find(x => x.id === id);
    /* Lo mismo al editar: no se puede renombrar a alguien encima de otro. */
    if(db.usuarios.some(x => x.usuario === usuario && x.id !== id))
      return snack("Ya existe una cuenta con el usuario " + usuario + ".", "err");
    Object.assign(u, {nombre, usuario, cargo:$("mu-cargo").value.trim(), area:$("mu-area").value.trim(), rol});
    if(fotos["mu-foto"]) u.foto = fotos["mu-foto"];
    if(clave){
      if(clave.length < 6) return snack("La contraseña debe tener al menos 6 caracteres.", "err");
      u.sal = uid(); u.hash = await hashClave(clave, u.sal); u.hashAlt = null;
    }
    log("usuarios", "Usuario editado", nombre + " · " + ROLES[rol].nombre, u.id);
  }else{
    if(clave.length < 6) return snack("La contraseña debe tener al menos 6 caracteres.", "err");
    /* V46 · Dos cuentas con el mismo usuario no se pueden distinguir al
       entrar: el login se queda con la primera que encuentra, y la otra
       persona nunca podría ingresar aunque su contraseña esté bien. */
    if(db.usuarios.some(x => x.usuario === usuario))
      return snack("Ya existe una cuenta con el usuario " + usuario + ".", "err");
    const u = await nuevoUsuario(nombre, usuario, clave, rol, $("mu-cargo").value.trim(),
      fotos["mu-foto"] || null, false, $("mu-area").value.trim());
    db.usuarios.push(u);
    log("usuarios", "Usuario creado", nombre + " · " + ROLES[rol].nombre, u.id);
  }
  if(!guardar()) return;
  cerrarModal("modal-usuario");
  limpiarUsuario();
  snack("Usuario guardado.", "ok");
  refrescar("admin");
}
$("mu-registrar").addEventListener("click", registrarUsuario);
$("mu-registrar2").addEventListener("click", registrarUsuario);
$("ad-nuevo").addEventListener("click", ()=> abrirUsuario());

function pintarActividad(){
  $("ad-actividad").innerHTML = db.historial.length
    ? db.historial.slice(0, 120).map(h =>
        '<div class="fila"><span class="mini">' + ico(iconoModulo(h.modulo), 20) + "</span>" +
        '<span class="txt"><b>' + esc(h.accion) + "</b><small>" + esc(h.usuario) +
        (h.detalle ? " · " + esc(h.detalle) : "") + "</small></span>" +
        '<span class="der"><small>' + hace(h.fecha) + "</small></span></div>").join("")
    : '<div class="vacio">Sin actividad registrada.</div>';
}

/* =====================================================================
   21. HISTORIAL
   ===================================================================== */
let filtroHist = "";
$("hi-buscar").addEventListener("input", pintarHistorial);

function pintarHistorial(){
  const u = usuarioActual();
  const todo = rolEfectivo() === "admin";
  const mods = ["", "pedidos", "inventario", "herramientas", "compras", "movimientos", "consolidado", "personal", "sesion"];
  $("hi-filtros").innerHTML = mods.map(m =>
    '<button class="' + (filtroHist === m ? "on" : "") + '" data-mod="' + m + '">' +
    (m === "" ? "Todo" : m[0].toUpperCase() + m.slice(1)) + "</button>").join("");
  $$("#hi-filtros button").forEach(b => b.addEventListener("click", ()=>{
    filtroHist = b.dataset.mod;
    pintarHistorial();
  }));

  const q = sinTildes($("hi-buscar").value);
  let lista = db.historial.filter(h => todo || h.usuarioId === u.id);
  if(filtroHist) lista = lista.filter(h => h.modulo === filtroHist);
  if(q) lista = lista.filter(h => sinTildes(h.accion + " " + h.detalle + " " + h.usuario).indexOf(q) >= 0);

  $("hi-lista").innerHTML = lista.length
    ? '<div class="ayuda" style="margin:0 4px 10px">' + (todo ? "Historial completo del equipo" : "Su historial") +
      " · " + lista.length + " registros</div>" +
      lista.slice(0, 200).map(h =>
        '<div class="fila"><span class="mini">' + ico(iconoModulo(h.modulo), 20) + "</span>" +
        '<span class="txt"><b>' + esc(h.accion) + "</b><small>" + esc(h.usuario) +
        (h.detalle ? " · " + esc(h.detalle) : "") + "</small></span>" +
        '<span class="der"><small>' + hace(h.fecha) + "</small></span></div>").join("")
    : '<div class="vacio">' + ico("reloj", 40) + "Sin registros en el historial.</div>";
}

/* =====================================================================
   22. INDICADORES
   ===================================================================== */
function tiemposAtencion(){
  const cerrados = db.requerimientos.filter(r => r.estado === "recibido");
  const prom = arr => arr.length ? arr.reduce((a,b)=> a + b, 0) / arr.length : null;
  const tramo = (de, a) => {
    const v = [];
    db.requerimientos.forEach(r => {
      const h1 = r.historial.find(h => h.estado === de), h2 = r.historial.find(h => h.estado === a);
      if(h1 && h2) v.push(horas(h1.fecha, h2.fecha));
    });
    return prom(v);
  };
  return {
    cerrados:cerrados.length,
    total:prom(cerrados.map(r => horas(r.fecha, r.historial[r.historial.length-1].fecha))),
    aprobacion:tramo("solicitado","aprobado"), compra:tramo("aprobado","en_compra"),
    despacho:tramo("en_compra","despachado"), recepcion:tramo("despachado","recibido")
  };
}

function pintarIndicadores(){
  const req = db.requerimientos, t = tiemposAtencion();
  const abiertos = req.filter(r => ["recibido","rechazado"].indexOf(r.estado) < 0);
  const atrasados = abiertos.filter(r => r.necesario && r.necesario < hoyISO()).length;
  const a = db.consolidado.items.length ? avanceConsolidado() : null;

  $("kpi-metricas").innerHTML =
    '<div class="metrica"><b>' + req.length + "</b><span>Pedidos totales</span></div>" +
    '<div class="metrica"><b>' + abiertos.length + "</b><span>En curso</span></div>" +
    '<div class="metrica ' + (atrasados ? "mal" : "ok") + '"><b>' + atrasados + "</b><span>Fuera de fecha</span></div>" +
    '<div class="metrica ok"><b>' + duracion(t.total) + "</b><span>Atención promedio</span></div>" +
    (a ? '<div class="metrica ok"><b>' + a.avance + "%</b><span>Avance de obra</span></div>" +
         '<div class="metrica mal"><b>' + a.pendientes + "</b><span>Por comprar</span></div>" : "");

  const total = req.length || 1;
  $("kpi-estados").innerHTML = Object.keys(ESTADOS).map(k => {
    const n = req.filter(r => r.estado === k).length;
    const cl = k === "rechazado" ? "mal" : (k === "recibido" ? "ok" : (k === "consolidado" ? "lila" :
      (k === "en_compra" || k === "despachado" ? "alerta" : "")));
    return '<div class="barra ' + cl + '"><div class="rot"><span>' + ESTADOS[k].texto + "</span><b>" + n + "</b></div>" +
      '<div class="via"><div class="lleno" style="width:' + Math.round(n / total * 100) + '%"></div></div></div>';
  }).join("");

  $("kpi-tiempos").innerHTML =
    '<div class="dato"><span>Solicitud → aprobación</span><b>' + duracion(t.aprobacion) + "</b></div>" +
    '<div class="dato"><span>Aprobación → orden de compra</span><b>' + duracion(t.compra) + "</b></div>" +
    '<div class="dato"><span>Orden de compra → despacho</span><b>' + duracion(t.despacho) + "</b></div>" +
    '<div class="dato"><span>Despacho → recepción</span><b>' + duracion(t.recepcion) + "</b></div>" +
    '<div class="dato"><span>Ciclo completo</span><b>' + duracion(t.total) + "</b></div>" +
    '<div class="dato"><span>Pedidos cerrados</span><b>' + t.cerrados + "</b></div>";

  const dias = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
    dias.push({et:d.toLocaleDateString("es-PE",{weekday:"short"}).slice(0,2),
               n:db.movimientos.filter(m => diaLocal(m.fecha) === iso).length});
  }
  const max = Math.max(1, ...dias.map(d => d.n));
  $("kpi-dias").innerHTML = dias.map(d =>
    '<div class="col"><span class="val">' + d.n + '</span><div class="bar" style="height:' +
    Math.round(d.n / max * 76) + 'px"></div><span class="et">' + d.et + "</span></div>").join("");

  const bajos = db.materiales.filter(m => estadoStock(m) !== "disponible");
  $("kpi-bajo").innerHTML = bajos.length
    ? bajos.map(m => {
        const e = ESTADO_STOCK[estadoStock(m)];
        return '<div class="fila"><span class="mini ' + e.chip + '">' + ico("alerta", 20) + "</span>" +
          '<span class="txt"><b>' + esc(m.nombre) + "</b><small>" + esc(m.codigo) + " · mín. " + m.minimo + " " + esc(m.unidad) + "</small></span>" +
          '<span class="der"><b>' + m.stock + " " + esc(m.unidad) + '</b><span class="chip ' + e.chip + '">' + e.txt + "</span></span></div>";
      }).join("")
    : '<div class="vacio">' + ico("check", 40) + "Ningún material por debajo del mínimo.</div>";
}

/* =====================================================================
   23. REPORTES
   ===================================================================== */
let reporteTexto = "";

function prepararReportes(){
  if(!$("rp-fecha").value) $("rp-fecha").value = hoyISO();
  if(!$("rp-para").value) $("rp-para").value = db.config.destinatarios || "";
}

function datosDelDia(dia){
  const movs = db.movimientos.filter(m => diaLocal(m.fecha) === dia);
  const reqs = db.requerimientos.filter(r => r.historial.some(h => diaLocal(h.fecha) === dia));
  const bajos = db.materiales.filter(m => estadoStock(m) !== "disponible");
  const prestadas = db.herramientas.filter(h => h.estado === "prestada");
  return {movs, reqs, bajos, prestadas};
}

$("rp-generar").addEventListener("click", ()=>{
  const dia = $("rp-fecha").value || hoyISO();
  const d = datosDelDia(dia), t = tiemposAtencion();
  const u = usuarioActual();
  const cuenta = tipo => d.movs.filter(m => m.tipo === tipo).length;
  const fmt = new Date(dia + "T12:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const L = ["REPORTE DIARIO DE ALMACÉN", fmt,
    "Generado por: " + u.nombre + " (" + ROLES[rolEfectivo()].nombre + ")",
    "Dirigido a: " + ($("rp-para").value.trim() || db.config.destinatarios), "",
    "MOVIMIENTOS DEL DÍA: " + d.movs.length,
    "  Ingresos: " + cuenta("ingreso"), "  Salidas: " + cuenta("salida"),
    "  Préstamos: " + cuenta("prestamo"), "  Devoluciones: " + cuenta("devolucion"), ""];
  if(d.movs.length){
    L.push("DETALLE:");
    d.movs.forEach(m => L.push("  " + fecha(m.fecha) + " | " + TIPOMOV[m.tipo].texto + " | " + m.item + " | " +
      (m.tipo === "salida" ? "-" : "+") + m.cantidad + " " + m.unidad + " | " + (m.persona || "—")));
    L.push("");
  }
  L.push("PEDIDOS CON MOVIMIENTO: " + d.reqs.length);
  d.reqs.forEach(r => L.push("  " + r.codigo + " | " + ESTADOS[r.estado].texto + " | " + resumenItems(r)));
  L.push("");
  if(db.consolidado.items.length){
    const a = avanceConsolidado();
    L.push("CONSOLIDADO DE OBRA: " + a.total + " materiales | comprados " + a.comprados +
           " | pendientes " + a.pendientes + " | entregados " + a.entregados + " | avance " + a.avance + "%", "");
  }
  L.push("STOCK CRÍTICO: " + d.bajos.length);
  d.bajos.forEach(m => L.push("  " + m.codigo + " " + m.nombre + ": " + m.stock + " " + m.unidad + " (mín " + m.minimo + ")"));
  L.push("");
  L.push("HERRAMIENTAS PRESTADAS: " + d.prestadas.length);
  d.prestadas.forEach(h => L.push("  " + h.codigo + " " + h.nombre + " → " + (h.prestamo ? h.prestamo.responsable : "—")));
  L.push("", "TIEMPO PROMEDIO DE ATENCIÓN: " + duracion(t.total) + " (" + t.cerrados + " pedidos cerrados)");

  reporteTexto = L.join("\n");
  $("rp-salida").innerHTML = '<div class="card"><div class="sech" style="margin:0 0 8px">Reporte del ' + soloFecha(dia) + "</div>" +
    '<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;margin:0;line-height:1.65">' +
    esc(reporteTexto) + "</pre></div>";
  guardarDestinatarios();
  snack("Resumen generado.", "ok");
});

function guardarDestinatarios(){
  db.config.destinatarios = $("rp-para").value.trim() || db.config.destinatarios;
  guardar();
}

function libroDelDia(dia){
  const d = datosDelDia(dia), t = tiemposAtencion(), u = usuarioActual();
  const cuenta = tipo => d.movs.filter(m => m.tipo === tipo).length;
  const fmt = new Date(dia + "T12:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const a = db.consolidado.items.length ? avanceConsolidado() : null;

  const resumen = [["REPORTE DIARIO DE ALMACÉN"], ["Fecha", fmt],
    ["Generado por", u.nombre + " (" + ROLES[rolEfectivo()].nombre + ")"],
    ["Dirigido a", $("rp-para").value.trim() || db.config.destinatarios],
    ["Emitido", fecha(ahora())], [],
    ["MOVIMIENTOS DEL DÍA", d.movs.length], ["Ingresos", cuenta("ingreso")], ["Salidas", cuenta("salida")],
    ["Préstamos", cuenta("prestamo")], ["Devoluciones", cuenta("devolucion")], [],
    ["PEDIDOS CON MOVIMIENTO", d.reqs.length],
    ["Pedidos en curso", db.requerimientos.filter(r => ["recibido","rechazado"].indexOf(r.estado) < 0).length],
    ["Tiempo promedio de atención", duracion(t.total)], ["Pedidos cerrados", t.cerrados], [],
    ["ALERTAS"], ["Materiales en stock crítico", d.bajos.length], ["Herramientas prestadas", d.prestadas.length]];
  if(a) resumen.push([], ["CONSOLIDADO DE OBRA"], ["Total materiales", a.total], ["Comprados", a.comprados],
    ["Pendientes", a.pendientes], ["Entregados", a.entregados], ["Avance %", a.avance]);

  const movimientos = [["Fecha","Tipo","Artículo","Cantidad","Unidad","Saldo","Responsable","Área","Documento","Registró","Observaciones"]]
    .concat(d.movs.map(m => [fecha(m.fecha), TIPOMOV[m.tipo].texto, m.item,
      m.tipo === "salida" ? -m.cantidad : m.cantidad, m.unidad, m.saldo === "" ? "" : m.saldo,
      m.persona || "", m.area || "", m.documento || "", m.registro || "", m.obs || ""]));

  const pedidos = [["Código","Estado","Obra","Solicitante","Prioridad","Materiales","N° OC","Proveedor","Monto S/","Guía","Días","Observaciones"]]
    .concat(d.reqs.map(r => [r.codigo, ESTADOS[r.estado].texto, r.obra || "", r.solicitante, r.prioridad,
      resumenItems(r), r.oc ? r.oc.numero : "", r.oc ? r.oc.proveedor : "", r.oc ? r.oc.monto : "",
      r.despacho ? r.despacho.guia : "", Math.round(horas(r.fecha, ahora()) / 24 * 10) / 10, r.obs || ""]));

  const inventario = [["Código","Artículo","Categoría","Stock","Unidad","Mínimo","Estado"]]
    .concat(db.materiales.map(m => [m.codigo, m.nombre, m.categoria, m.stock, m.unidad, m.minimo,
      ESTADO_STOCK[estadoStock(m)].txt]));

  const herramientas = [["Código","Herramienta","Marca","Modelo","Serie","Estado","Responsable","Salida","Devolución"]]
    .concat(db.herramientas.map(h => [h.codigo, h.nombre, h.marca, h.modelo, h.serie,
      (ESTADO_HERR[h.estado] || ESTADO_HERR.disponible).txt,
      h.prestamo ? h.prestamo.responsable : "", h.prestamo ? soloFecha(h.prestamo.salida) : "",
      h.prestamo && h.prestamo.devolucion ? soloFecha(h.prestamo.devolucion) : ""]));

  const hojas = [{nombre:"Resumen", filas:resumen}, {nombre:"Movimientos", filas:movimientos},
                 {nombre:"Pedidos", filas:pedidos}, {nombre:"Inventario", filas:inventario},
                 {nombre:"Herramientas", filas:herramientas}];
  if(a) hojas.push({nombre:"Consolidado", filas:
    [["Material","Categoría","Unidad","Requerido","Comprado","Entregado","Estado"]]
      .concat(db.consolidado.items.map(it => [it.desc, it.categoria, it.unidad, it.requerido,
        it.comprado, it.entregado, ESTADO_CONS[estadoConsolidado(it)].txt]))});
  return crearXLSX(hojas);
}

function nombreReporte(dia){ return "reporte_almacen_" + dia + ".xlsx"; }

$("rp-excel").addEventListener("click", ()=>{
  const dia = $("rp-fecha").value || hoyISO();
  guardarDestinatarios();
  descargarBlob(nombreReporte(dia), libroDelDia(dia));
  log("reportes", "Reporte diario descargado", dia);
  guardar();
  snack("Excel del día descargado.", "ok");
});

$("rp-compartir").addEventListener("click", async ()=>{
  const dia = $("rp-fecha").value || hoyISO();
  guardarDestinatarios();
  const blob = libroDelDia(dia);
  const ok = await compartirArchivo(nombreReporte(dia), blob, "Reporte diario de almacén",
    "Reporte del " + soloFecha(dia) + " para " + ($("rp-para").value.trim() || db.config.destinatarios) + ".");
  if(!ok){
    descargarBlob(nombreReporte(dia), blob);
    snack("Este navegador no comparte archivos: se descargó para adjuntarlo.", "ok");
  }
  log("reportes", "Reporte diario compartido", dia);
  guardar();
});

$("rp-texto").addEventListener("click", ()=>{
  if(!reporteTexto) $("rp-generar").click();
  descargarTexto("reporte_" + ($("rp-fecha").value || hoyISO()) + ".txt", reporteTexto);
  snack("Reporte en texto descargado.", "ok");
});

/* =====================================================================
   24. PANTALLA "MÁS"
   ===================================================================== */
function pintarMas(){
  const enMenu = MENU.concat(["notificaciones"]);
  const otras = pantallasPermitidas().filter(k => enMenu.indexOf(k) < 0);
  const desc = {
    herramientas:"Inventario, préstamos y devoluciones",
    compras:"Órdenes de compra y guías de remisión",
    movimientos:"Ingresos, salidas y kardex",
    historial:"Todo lo registrado en la app",
    indicadores:"Avance, tiempos y stock crítico",
    reportes:"Reporte diario para enviar",
    personal:"Operadores que reciben materiales",
    admin:"Solicitudes, usuarios y actividad"
  };
  $("mas-modulos").innerHTML = otras.map(k =>
    '<button class="fila" data-ir2="' + k + '"><span class="mini">' + ico(PANTALLAS[k].icono, 20) + "</span>" +
    '<span class="txt"><b>' + PANTALLAS[k].titulo + "</b><small>" + (desc[k] || "") + "</small></span>" +
    '<span class="der">' + ico("flecha", 18) + "</span></button>").join("");
  $$("#mas-modulos [data-ir2]").forEach(b => b.addEventListener("click", ()=> ir(b.dataset.ir2)));

  const kb = Math.round((localStorage.getItem(CLAVE) || "").length / 1024);
  $("mas-datos").innerHTML =
    '<button class="fila" id="ms-backup"><span class="mini">' + ico("descargar", 20) + "</span>" +
    '<span class="txt"><b>Descargar respaldo</b><small>Archivo .json con todo el sistema</small></span></button>' +
    '<button class="fila" id="ms-excel"><span class="mini">' + ico("tabla", 20) + "</span>" +
    '<span class="txt"><b>Exportar base a Excel</b><small>Una hoja por tabla, lista para Sheets</small></span></button>' +
    '<button class="fila" id="ms-restore"><span class="mini">' + ico("subir", 20) + "</span>" +
    '<span class="txt"><b>Restaurar respaldo</b><small>Reemplaza los datos actuales</small></span></button>' +
    (rolEfectivo() === "admin"
      ? '<button class="fila" id="ms-borrar"><span class="mini mal">' + ico("borrar", 20) + "</span>" +
        '<span class="txt"><b>Borrar datos operativos</b><small>Conserva usuarios y cuentas</small></span></button>' : "") +
    '<div class="card plano" style="font-size:12.5px;color:var(--tinta-sec)">' +
    db.requerimientos.length + " pedidos · " + db.materiales.length + " artículos · " +
    db.movimientos.length + " movimientos · " + kb + " KB usados</div>";

  $("mas-app").innerHTML =
    '<button class="fila" id="ms-notif"><span class="mini">' + ico("campana", 20) + "</span>" +
    '<span class="txt"><b>Activar avisos del sistema</b><small>Notificaciones en la pantalla del celular</small></span></button>' +
    '<button class="fila oculto" id="ms-instalar"><span class="mini">' + ico("descargar", 20) + "</span>" +
    '<span class="txt"><b>Instalar la aplicación</b><small>Se abre como app, sin navegador</small></span></button>';

  $("ms-backup").addEventListener("click", ()=>{
    descargarTexto("respaldo_almacen_" + hoyISO() + ".json", JSON.stringify(db), "application/json");
    snack("Respaldo descargado.", "ok");
  });
  $("ms-excel").addEventListener("click", exportarBase);
  $("ms-restore").addEventListener("click", ()=> $("ms-archivo").click());
  if($("ms-borrar")) $("ms-borrar").addEventListener("click", borrarDatos);
  $("ms-notif").addEventListener("click", async ()=>{
    if(!("Notification" in window)) return snack("Este navegador no admite avisos del sistema.", "err");
    const p = await Notification.requestPermission();
    snack(p === "granted" ? "Avisos activados." : "Avisos no autorizados.", p === "granted" ? "ok" : "err");
  });
  if(promptInstalar) $("ms-instalar").classList.remove("oculto");
  $("ms-instalar").addEventListener("click", async ()=>{
    if(!promptInstalar) return snack("Use el menú del navegador → Instalar aplicación.", "err");
    promptInstalar.prompt();
    await promptInstalar.userChoice;
    promptInstalar = null;
  });
}

function exportarBase(){
  const hojas = [
    {nombre:"Usuarios", filas:[["id","usuario","nombre","cargo","rol","activo","creado","ultimoAcceso"]]
      .concat(db.usuarios.map(u => [u.id, u.usuario, u.nombre, u.cargo || "", u.rol, u.activo ? "SI" : "NO", u.creado, u.ultimoAcceso || ""]))},
    {nombre:"Materiales", filas:[["id","codigo","nombre","categoria","unidad","stock","minimo","estado","observaciones"]]
      .concat(db.materiales.map(m => [m.id, m.codigo, m.nombre, m.categoria, m.unidad, m.stock, m.minimo, ESTADO_STOCK[estadoStock(m)].txt, m.obs || ""]))},
    {nombre:"Herramientas", filas:[["id","codigo","nombre","marca","modelo","serie","estado","responsable"]]
      .concat(db.herramientas.map(h => [h.id, h.codigo, h.nombre, h.marca, h.modelo, h.serie,
        (ESTADO_HERR[h.estado] || ESTADO_HERR.disponible).txt, h.prestamo ? h.prestamo.responsable : ""]))},
    {nombre:"Pedidos", filas:[["id","codigo","fecha","obra","solicitante","prioridad","estado","materiales","oc","guia"]]
      .concat(db.requerimientos.map(r => [r.id, r.codigo, r.fecha, r.obra || "", r.solicitante, r.prioridad,
        ESTADOS[r.estado].texto, resumenItems(r), r.oc ? r.oc.numero : "", r.despacho ? r.despacho.guia : ""]))},
    {nombre:"Movimientos", filas:[["id","fecha","tipo","articulo","cantidad","unidad","saldo","responsable","registro"]]
      .concat(db.movimientos.map(m => [m.id, m.fecha, m.tipo, m.item, m.cantidad, m.unidad, m.saldo, m.persona || "", m.registro || ""]))},
    {nombre:"Historial", filas:[["fecha","usuario","modulo","accion","detalle"]]
      .concat(db.historial.map(h => [h.fecha, h.usuario, h.modulo, h.accion, h.detalle || ""]))}
  ];
  if(db.consolidado.items.length) hojas.push({nombre:"Consolidado", filas:
    [["material","categoria","unidad","requerido","comprado","entregado"]]
      .concat(db.consolidado.items.map(it => [it.desc, it.categoria, it.unidad, it.requerido, it.comprado, it.entregado]))});
  descargarBlob("base_almacen_" + hoyISO() + ".xlsx", crearXLSX(hojas));
  snack("Base exportada a Excel.", "ok");
}

async function borrarDatos(){
  if(!await confirmar("Borrar datos operativos",
    "Se eliminan pedidos, artículos, herramientas, movimientos, consolidado e historial. Los usuarios se conservan.", "Borrar")) return;
  const usuarios = db.usuarios, solicitudes = db.solicitudes, config = db.config;
  db = esquema();
  db.usuarios = usuarios; db.solicitudes = solicitudes; db.config = config;
  log("sesion", "Datos operativos borrados", "");
  if(guardar()){ snack("Datos borrados.", "ok"); ir("inicio"); }
}

/* =====================================================================
   25. LOGIN Y ARRANQUE
   ===================================================================== */
$("lg-entrar").addEventListener("click", intentarEntrar);
$("lg-clave").addEventListener("keydown", e => { if(e.key === "Enter") intentarEntrar(); });
$("lg-usuario").addEventListener("keydown", e => { if(e.key === "Enter") $("lg-clave").focus(); });

async function intentarEntrar(){
  const r = await entrar($("lg-usuario").value, $("lg-clave").value);
  if(!r.ok){ $("lg-error").textContent = r.msg; return; }
  $("lg-error").textContent = "";
  $("lg-clave").value = "";
  iniciarApp();
}

/* foto de perfil */
$("dr-cambiar-foto").addEventListener("click", ()=> $("pf-foto").click());
$("pf-foto").addEventListener("change", async ()=>{
  const a = $("pf-foto").files[0];
  if(!a) return;
  try{
    const datos = await comprimir(a, 400, 0.75);
    const u = usuarioActual();
    u.foto = datos;
    log("sesion", "Foto de perfil actualizada", "");
    if(guardar()){
      snack("Foto de perfil actualizada.", "ok");
      $("avatar-txt").innerHTML = '<img src="' + datos + '" alt="">';
      pintarDrawer();
      if(pantalla === "inicio") pintarInicio();
    }
  }catch(e){ snack("No se pudo procesar la imagen.", "err"); }
  $("pf-foto").value = "";
});

let promptInstalar = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  promptInstalar = e;
  if($("ms-instalar")) $("ms-instalar").classList.remove("oculto");
});


(async function arranque(){
  db = cargar();
  await sembrar();
  await sembrarSupervisores();
  migrarAdmin();

  ["so-foto","mp-foto","mr-ifoto","mr-foto","mt-foto1","mt-foto2","mu-foto","mo-foto",
   "in-foto","sa-foto1","oc-foto","gu-foto"].forEach(initFoto);
  ["mr-pdf","gu-pdf"].forEach(initArchivo);

  $$("[data-foto]").forEach(b => { if(b.firstElementChild) b.firstElementChild.innerHTML = ico("camara", 20); });
  $$("[data-archivo]").forEach(b => {
    if(b.firstElementChild) b.firstElementChild.innerHTML = ico("pdf", 20);
    b.addEventListener("click", ()=> $(b.dataset.archivo).click());
  });
  $$("[data-foto]").forEach(b => b.addEventListener("click", ()=> $(b.dataset.foto).click()));

  $("logo-app").innerHTML = ico("inventario", 40);
  $("mr-quien-ico").innerHTML = ico("usuario", 22);
  $("btn-volver").innerHTML = ico("volver", 22);
  $("fab-ico").innerHTML = ico("agregar", 22);

  $$('[data-seg]').forEach(seg => seg.addEventListener("click", e => {
    if(e.target.dataset.pan){
      segmento(seg.dataset.seg, e.target.dataset.pan);
      refrescar(seg.dataset.seg);
    }
  }));

  $$("[data-cerrar-modal]").forEach(b => b.addEventListener("click", ()=>{
    const id = b.dataset.cerrarModal;
    cerrarModal(id);
    if(id === "modal-requerimiento") limpiarRequerimiento();
    if(id === "modal-producto") limpiarProducto();
    if(id === "modal-prestamo") limpiarPrestamo();
    if(id === "modal-usuario") limpiarUsuario();
    if(id === "modal-personal") limpiarOperador();
  }));

  const entrada = document.createElement("input");
  entrada.type = "file"; entrada.accept = "application/json"; entrada.id = "ms-archivo"; entrada.hidden = true;
  document.body.appendChild(entrada);
  entrada.addEventListener("change", ()=>{
    const a = entrada.files[0];
    if(!a) return;
    const lector = new FileReader();
    lector.onload = async ()=>{
      try{
        const datos = JSON.parse(lector.result);
        if(!datos.usuarios && !datos.materiales) throw new Error("estructura");
        if(await confirmar("Restaurar respaldo", "Se reemplazarán todos los datos actuales.", "Restaurar")){
          db = normalizar(datos);
          await sembrar();
          migrarAdmin();
          if(guardar()){
            snack("Datos restaurados.", "ok");
            if(!db.usuarios.some(x => sesion && x.id === sesion.usuarioId)) salir(); else aplicarRol();
          }
        }
      }catch(e){ snack("El archivo no es un respaldo válido.", "err"); }
      entrada.value = "";
    };
    lector.readAsText(a);
  });

  try{
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION) || "null");
    if(s && db.usuarios.some(u => u.id === s.usuarioId && u.activo)){
      sesion = s;
      iniciarApp();
      return;
    }
  }catch(e){}
  salir();
})();


/* =====================================================================
   ================  AMPLIACIÓN v4  ====================================
   Módulo aditivo: no reemplaza nada de lo anterior. Agrega estados de
   flujo, trazabilidad, atención de requerimientos con firma, panel
   logístico, dashboard gerencial, analítica y reportes ejecutivos.
   ===================================================================== */

/* ---------------------------------------------------------------
   V4.1  Esquema adicional y migración
   --------------------------------------------------------------- */
function normalizarV4(){
  if(!Array.isArray(db.proveedores)) db.proveedores = [];
  if(!Array.isArray(db.auditoria)) db.auditoria = [];
  const c = db.config;
  if(!c.empresa) c.empresa = "";
  if(!c.proyecto) c.proyecto = "";
  if(c.logo === undefined) c.logo = null;
  if(!Array.isArray(c.correos)) c.correos = [];
  if(!c.horaReporte) c.horaReporte = "18:00";
  if(!c.correlativoReq) c.correlativoReq = db.correlativos.REQ || 0;

  db.usuarios.forEach(u => {
    if(!Array.isArray(u.permisosExtra)) u.permisosExtra = [];
    if(u.dni === undefined) u.dni = "";
    if(u.correo === undefined) u.correo = "";
    if(u.celular === undefined) u.celular = "";
  });
  db.requerimientos.forEach(r => {
    if(!Array.isArray(r.cotizaciones)) r.cotizaciones = [];
    if(!Array.isArray(r.entregas)) r.entregas = [];
    if(r.revision === undefined) r.revision = null;
    if(r.proyecto === undefined) r.proyecto = r.obra || "";
    if(r.hora === undefined) r.hora = new Date(r.fecha).toTimeString().slice(0,5);
  });
}

/* ---------------------------------------------------------------
   V4.2  Estados del flujo (sección 10)
   Los estados antiguos se conservan para no romper los registros ya
   creados; los nuevos se suman al mismo diccionario.
   --------------------------------------------------------------- */
Object.assign(ESTADOS, {
  pendiente:        {texto:"Pendiente de revisión", chip:"info"},
  revisado:         {texto:"Revisado",              chip:"lila"},
  en_preparacion:   {texto:"En preparación",        chip:"alerta"},
  entrega_parcial:  {texto:"Entrega parcial",       chip:"alerta"},
  sin_stock:        {texto:"Sin stock",             chip:"mal"},
  enviado_logistica:{texto:"Enviado a logística",   chip:"lila"},
  compra_proceso:   {texto:"Compra en proceso",     chip:"alerta"},
  compra_aprobada:  {texto:"Compra aprobada",       chip:"ok"},
  material_recibido:{texto:"Material recibido",     chip:"ok"},
  entregado:        {texto:"Entregado",             chip:"ok"},
  cerrado:          {texto:"Cerrado",               chip:"ok"},
  observado:        {texto:"Observado",             chip:"alerta"},
  devuelto:         {texto:"Devuelto al solicitante", chip:"mal"}
});

/* Estados que cuentan como "en curso" para los tableros */
const ABIERTOS = ["pendiente","solicitado","revisado","en_preparacion","entrega_parcial","sin_stock",
                  "enviado_logistica","consolidado","aprobado","compra_aprobada","en_compra",
                  "compra_proceso","despachado","material_recibido","observado"];
const CERRADOS = ["entregado","cerrado","recibido","rechazado","devuelto"];

const PRIORIDADES = ["Baja","Media","Alta","Urgente"];
function chipPrioridad(p){
  return p === "Urgente" ? "mal" : (p === "Alta" ? "alerta" : (p === "Media" ? "info" : ""));
}

/* ---------------------------------------------------------------
   V4.3  Trazabilidad y auditoría (sección 11)
   --------------------------------------------------------------- */
let ipSesion = "";

async function detectarIP(){
  try{
    const ctrl = new AbortController();
    setTimeout(()=> ctrl.abort(), 2500);
    const r = await fetch("about:blank", {signal:ctrl.signal});
    const j = await r.json();
    ipSesion = j.ip || "";
  }catch(e){ ipSesion = ""; }
}

function dispositivo(){
  const ua = navigator.userAgent;
  if(/Android/i.test(ua)) return "Android";
  if(/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if(/Windows/i.test(ua)) return "Windows";
  if(/Mac/i.test(ua)) return "macOS";
  return "Otro";
}

/* Registro completo de una acción: queda en historial (visible) y en
   auditoría (inmutable, solo para el Administrador General). */
function auditar(modulo, accion, extra){
  extra = extra || {};
  const u = usuarioActual();
  const reg = {
    id:uid(), fecha:ahora(),
    usuarioId:u ? u.id : null, usuario:u ? u.nombre : "sistema",
    cargo:u ? (u.cargo || ROLES[u.rol].nombre) : "",
    modulo, accion,
    estadoAnterior:extra.antes || "", estadoNuevo:extra.despues || "",
    comentario:extra.comentario || "", refId:extra.refId || null,
    fotos:(extra.fotos || []).length, archivos:(extra.archivos || []).length,
    ip:ipSesion || "no disponible", dispositivo:dispositivo()
  };
  db.auditoria.unshift(reg);
  if(db.auditoria.length > 1500) db.auditoria.length = 1500;
  log(modulo, accion, extra.comentario || "", extra.refId || null);
  return reg;
}

/* ---------------------------------------------------------------
   V4.4  Pantallas nuevas
   --------------------------------------------------------------- */
function crearPantalla(id, contenido){
  if($("scr-" + id)) return $("scr-" + id);
  const s = document.createElement("section");
  s.className = "pantalla";
  s.id = "scr-" + id;
  s.innerHTML = contenido;
  document.querySelector("main").appendChild(s);
  return s;
}

crearPantalla("atencion",
  '<div class="filtros" id="at-filtros"></div><div id="at-lista"></div>');

crearPantalla("logistica",
  '<div class="seg" data-seg="logistica">' +
  '<button class="on" data-pan="lgFaltantes">Faltantes</button>' +
  '<button data-pan="lgCotiza">Cotizaciones</button>' +
  '<button data-pan="lgProv">Proveedores</button></div>' +
  '<div id="pan-lgFaltantes"><div id="lg-faltantes"></div></div>' +
  '<div class="oculto" id="pan-lgCotiza"><div id="lg-cotizaciones"></div></div>' +
  '<div class="oculto" id="pan-lgProv">' +
  '<div class="card"><div class="dos">' +
  '<div class="campo"><label>Proveedor</label><input type="text" id="pv-nombre" placeholder="Ferretería Andina SAC"></div>' +
  '<div class="campo"><label>RUC</label><input type="text" id="pv-ruc" inputmode="numeric" placeholder="20xxxxxxxxx"></div></div>' +
  '<div class="dos"><div class="campo"><label>Contacto</label><input type="text" id="pv-contacto" placeholder="Nombre y teléfono"></div>' +
  '<div class="campo"><label>Rubro</label><input type="text" id="pv-rubro" placeholder="Ferretería, eléctrico…"></div></div>' +
  '<button class="btn btn-ton" id="pv-guardar">Agregar proveedor</button></div>' +
  '<div id="lg-proveedores"></div></div>');

crearPantalla("dashboard",
  '<div class="metricas" id="dg-metricas"></div>' +
  '<div class="sech">Requerimientos por disciplina</div><div class="card" id="dg-disciplinas"></div>' +
  '<div class="sech">Estado del flujo</div><div class="card" id="dg-flujo"></div>' +
  '<div class="sech">Stock crítico</div><div id="dg-stock"></div>' +
  '<div class="sech">Herramientas</div><div class="card" id="dg-herramientas"></div>');

crearPantalla("analitica",
  '<div class="sech">Materiales más consumidos</div><div class="card" id="an-consumidos"></div>' +
  '<div class="sech">Próximos a agotarse</div><div id="an-agotarse"></div>' +
  '<div class="sech">Consumo por especialidad</div><div class="card" id="an-especialidad"></div>' +
  '<div class="sech">Consumo por supervisor</div><div class="card" id="an-supervisor"></div>' +
  '<div class="sech">Requerimientos por día</div><div class="card"><div class="dias" id="an-dias"></div></div>' +
  '<div class="sech">Compras por mes</div><div class="card" id="an-compras"></div>' +
  '<div class="sech">Herramientas y proveedores</div><div class="card" id="an-varios"></div>');

crearPantalla("auditoria",
  '<div class="campo"><input type="search" id="au-buscar" placeholder="Buscar por usuario, acción o comentario"></div>' +
  '<div class="ayuda" id="au-info" style="margin:0 4px 10px"></div>' +
  '<div id="au-lista"></div>' +
  '<button class="btn btn-cont" id="au-exportar" style="margin-top:12px">Exportar auditoría</button>');

crearPantalla("config",
  '<div class="card"><div class="sech" style="margin-top:0">Datos de la empresa</div>' +
  '<div class="campo"><label>Empresa</label><input type="text" id="cf-empresa" placeholder="Razón social"></div>' +
  '<div class="campo"><label>Proyecto / obra</label><input type="text" id="cf-proyecto" placeholder="Nombre del proyecto"></div>' +
  '<div class="campo"><label>Logo (aparece en el reporte)</label>' +
  '<button class="foto-btn" data-foto="cf-logo"><span id="cf-logo-ico"></span>Subir logo</button>' +
  '<input type="file" id="cf-logo" accept="image/*" hidden><div class="prev" id="cf-logo-prev"></div></div>' +
  '<button class="btn btn-pri" id="cf-guardar">Guardar configuración</button></div>' +
  '<div class="card"><div class="sech" style="margin-top:0">Envío del reporte diario</div>' +
  '<div class="campo"><label>Hora del recordatorio</label><input type="time" id="cf-hora"></div>' +
  '<div class="campo"><label>Agregar destinatario</label>' +
  '<div class="dos"><input type="text" id="cf-dest-nombre" placeholder="Gerente General">' +
  '<input type="email" id="cf-dest-correo" placeholder="correo@empresa.com"></div></div>' +
  '<button class="btn btn-ton" id="cf-dest-add">Agregar destinatario</button>' +
  '<div id="cf-destinatarios" style="margin-top:12px"></div>' +
  '<p class="ayuda" style="margin:10px 0 0">El envío por correo se prepara desde la app; el envío automático sin intervención requiere un servidor.</p></div>');

/* Registro en el mapa de pantallas y en el menú */
Object.assign(PANTALLAS, {
  atencion:  {titulo:"Requerimientos recibidos", icono:"caja",      perm:"pedidos.atender"},
  logistica: {titulo:"Logística y compras",      icono:"carrito",   perm:"compras.ver"},
  dashboard: {titulo:"Dashboard gerencial",      icono:"grafico",   perm:"dashboard"},
  analitica: {titulo:"Analítica",                icono:"grafico",   perm:"analitica"},
  auditoria: {titulo:"Auditoría",                icono:"escudo",    perm:"usuarios"},
  config:    {titulo:"Configuración",            icono:"ajustes",   perm:"usuarios"}
});
ICONOS.ajustes = '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.6M12 17.9v2.6M4.7 7.8l2.3 1.3M17 14.9l2.3 1.3M4.7 16.2l2.3-1.3M17 9.1l2.3-1.3"/>';
ICONOS.firma = '<path d="M3.5 17.5c3-6 5-6 6.5-3s3 3 4.5 0 3-3 6 1"/><path d="M3.5 20.5h17"/>';

/* ---------------------------------------------------------------
   V4.5  Consulta de stock del requerimiento (sección 6)
   --------------------------------------------------------------- */
function buscarMaterial(desc, codigo){
  if(codigo){
    const porCod = db.materiales.find(m => sinTildes(m.codigo) === sinTildes(codigo));
    if(porCod) return porCod;
  }
  return db.materiales.find(m => sinTildes(m.nombre) === sinTildes(desc)) || null;
}

function revisarStock(r){
  const lineas = r.items.map(it => {
    const m = buscarMaterial(it.desc, it.codigo);
    const stock = m ? m.stock : 0;
    const entregado = it.entregado || 0;
    const falta = Math.max(0, +(it.cant - entregado).toFixed(2));
    const puedeEntregar = Math.min(falta, stock);
    return {item:it, material:m, stock, falta, puedeEntregar,
            cubierto: puedeEntregar >= falta && falta > 0 ? true : falta === 0};
  });
  const total = lineas.length;
  const completos = lineas.filter(l => l.falta === 0 || l.puedeEntregar >= l.falta).length;
  return {lineas, total, completos, faltantes:total - completos,
          hayStockTotal: completos === total, hayStockParcial: completos > 0 && completos < total};
}

/* ---------------------------------------------------------------
   V4.6  Firma digital del responsable (sección 7)
   --------------------------------------------------------------- */
function pedirFirma(titulo){
  return new Promise(res => {
    hoja(titulo || "Firma del responsable",
      '<p class="ayuda" style="margin:0 0 8px">Firme con el dedo dentro del recuadro.</p>' +
      '<canvas id="fi-canvas" style="width:100%;height:170px;background:#fff;border:1.5px dashed var(--borde);border-radius:12px;touch-action:none"></canvas>' +
      '<button class="btn btn-cont btn-mini" id="fi-limpiar" style="margin-top:8px">Borrar firma</button>',
      [{txt:"Cancelar", clase:"btn-cont", fn:()=> res(null)},
       {txt:"Aceptar firma", clase:"btn-pri", fn:()=>{
          const c = pedirFirma._c;
          res(c && pedirFirma._trazos ? c.toDataURL("image/png") : null);
       }}]);

    setTimeout(()=>{
      const c = $("fi-canvas");
      if(!c) return res(null);
      const r = c.getBoundingClientRect();
      c.width = r.width * 2; c.height = r.height * 2;
      const g = c.getContext("2d");
      g.scale(2,2); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#1A1F27";
      pedirFirma._c = c; pedirFirma._trazos = false;
      let pintando = false;
      const punto = e => {
        const b = c.getBoundingClientRect();
        const t = e.touches ? e.touches[0] : e;
        return {x:t.clientX - b.left, y:t.clientY - b.top};
      };
      const ini = e => { pintando = true; pedirFirma._trazos = true; const p = punto(e); g.beginPath(); g.moveTo(p.x, p.y); e.preventDefault(); };
      const mov = e => { if(!pintando) return; const p = punto(e); g.lineTo(p.x, p.y); g.stroke(); e.preventDefault(); };
      const fin = ()=> { pintando = false; };
      c.addEventListener("mousedown", ini); c.addEventListener("mousemove", mov);
      window.addEventListener("mouseup", fin);
      c.addEventListener("touchstart", ini, {passive:false});
      c.addEventListener("touchmove", mov, {passive:false});
      c.addEventListener("touchend", fin);
      $("fi-limpiar").addEventListener("click", ()=>{
        g.clearRect(0, 0, c.width, c.height);
        pedirFirma._trazos = false;
      });
    }, 90);
  });
}

/* ---------------------------------------------------------------
   V4.7  Panel del almacenero: requerimientos recibidos (sección 7)
   --------------------------------------------------------------- */
let filtroAtencion = "";

function pintarAtencion(){
  const f = [["","Todos"],["pendiente","Pendientes"],["revisado","Revisados"],
             ["en_preparacion","En preparación"],["entrega_parcial","Entrega parcial"],
             ["sin_stock","Sin stock"],["entregado","Entregados"],["cerrado","Cerrados"]];
  $("at-filtros").innerHTML = f.map(x =>
    '<button class="' + (filtroAtencion === x[0] ? "on" : "") + '" data-f="' + x[0] + '">' + x[1] + "</button>").join("");
  $$("#at-filtros button").forEach(b => b.addEventListener("click", ()=>{
    filtroAtencion = b.dataset.f;
    pintarAtencion();
  }));

  const lista = db.requerimientos.filter(r =>
    (!filtroAtencion || r.estado === filtroAtencion) && CERRADOS.indexOf(r.estado) < 0 || (filtroAtencion && r.estado === filtroAtencion));

  $("at-lista").innerHTML = lista.length
    ? lista.map(r => {
        const s = revisarStock(r);
        const est = ESTADOS[r.estado] || ESTADOS.pendiente;
        return '<button class="fila" data-at="' + r.id + '">' +
          '<span class="mini ' + (s.hayStockTotal ? "ok" : (s.hayStockParcial ? "alerta" : "mal")) + '">' +
          ico("caja", 20) + "</span>" +
          '<span class="txt"><b>' + esc(r.codigo) + " · " + esc(r.items[0].desc) +
          (r.items.length > 1 ? " +" + (r.items.length - 1) : "") + "</b><small>" +
          esc(r.solicitante) + " · " + esc(r.disciplina || r.area || "—") + " · " +
          (s.hayStockTotal ? "stock completo" : s.faltantes + " sin stock") + "</small></span>" +
          '<span class="der"><span class="chip ' + est.chip + '">' + est.texto + "</span>" +
          '<span class="chip ' + chipPrioridad(r.prioridad) + '">' + esc(r.prioridad) + "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("caja", 40) + "No hay requerimientos por atender.</div>";

  $$("#at-lista [data-at]").forEach(b => b.addEventListener("click", ()=> atenderReq(b.dataset.at)));
}

function atenderReq(id){
  const r = db.requerimientos.find(x => x.id === id);
  if(!r) return;
  const s = revisarStock(r);
  const est = ESTADOS[r.estado] || ESTADOS.pendiente;

  let html = '<div class="dato"><span>Estado</span><b><span class="chip ' + est.chip + '">' + est.texto + "</span></b></div>" +
    '<div class="dato"><span>Solicitante</span><b>' + esc(r.solicitante) + "</b></div>" +
    '<div class="dato"><span>Área</span><b>' + esc(r.disciplina || r.area || "—") + "</b></div>" +
    '<div class="dato"><span>Proyecto</span><b>' + esc(r.proyecto || r.obra || "—") + "</b></div>" +
    '<div class="dato"><span>Prioridad</span><b><span class="chip ' + chipPrioridad(r.prioridad) + '">' + esc(r.prioridad) + "</span></b></div>" +
    '<div class="dato"><span>Registrado</span><b>' + fecha(r.fecha) + "</b></div>";

  html += '<div class="sech" style="margin:16px 0 6px">Revisión de stock</div>';
  html += s.lineas.map((l, i) => {
    const chip = l.falta === 0 ? "ok" : (l.puedeEntregar >= l.falta ? "ok" : (l.puedeEntregar > 0 ? "alerta" : "mal"));
    const txt = l.falta === 0 ? "Entregado" : (l.puedeEntregar >= l.falta ? "Hay stock" :
      (l.puedeEntregar > 0 ? "Parcial: " + l.puedeEntregar : "Sin stock"));
    return '<div class="fila" style="box-shadow:none;border:1px solid var(--borde)">' +
      '<span class="mini ' + chip + '">' + ico("caja", 18) + "</span>" +
      '<span class="txt"><b>' + esc(l.item.desc) + "</b><small>" +
      (l.item.codigo ? esc(l.item.codigo) + " · " : "") + "pide " + l.item.cant + " " + esc(l.item.unidad) +
      " · almacén " + l.stock + "</small></span>" +
      '<span class="der"><span class="chip ' + chip + '">' + txt + "</span></span></div>";
  }).join("");

  if(r.entregas.length){
    html += '<div class="sech" style="margin:16px 0 6px">Entregas registradas</div>' +
      r.entregas.map(e => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
        esc(e.tipo) + " · " + e.items + " ítem(s)</b><small>" + fecha(e.fecha) + " · " + esc(e.usuario) +
        " · recibió " + esc(e.recibe) + "</small></span></div>").join("");
    const firmas = r.entregas.filter(e => e.firma);
    if(firmas.length) html += '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
      firmas.map(e => '<img src="' + e.firma + '" data-zoom="' + e.firma +
        '" style="height:60px;background:#fff;border:1px solid var(--borde);border-radius:8px" alt="firma">').join("") + "</div>";
  }

  const acc = [];
  if(puede("pedidos.atender")){
    if(r.estado === "pendiente" || r.estado === "solicitado")
      acc.push({txt:"Marcar revisado", clase:"btn-ton", fn:()=> moverEstado(r.id, "revisado", "Revisión de stock realizada")});
    if(s.hayStockTotal && CERRADOS.indexOf(r.estado) < 0)
      acc.push({txt:"Preparar y entregar", clase:"btn-ok", fn:()=> registrarEntrega(r.id, "total")});
    if(!s.hayStockTotal && s.hayStockParcial && CERRADOS.indexOf(r.estado) < 0)
      acc.push({txt:"Entrega parcial", clase:"btn-pri", fn:()=> registrarEntrega(r.id, "parcial")});
    if(!s.hayStockTotal && CERRADOS.indexOf(r.estado) < 0)
      acc.push({txt:"Enviar faltantes a logística", clase:"btn-mal", fn:()=> enviarFaltantes(r.id)});
  }
  if(r.pdf) acc.push({txt:"Ver Excel/PDF", clase:"btn-cont", fn:()=> verPDF(r.pdf)});
  if(r.excel) acc.push({txt:"Descargar Excel", clase:"btn-cont", fn:()=> descargarExcelReq(r.id)});
  acc.push({txt:"Ficha completa", clase:"btn-cont", fn:()=> detalleReq(r.id)});
  acc.push({txt:"Cerrar", clase:"btn-cont"});

  hoja(r.codigo + " · atención", html, acc);
}

function moverEstado(id, nuevo, comentario){
  const r = db.requerimientos.find(x => x.id === id);
  const antes = r.estado;
  historia(r, nuevo, comentario || "");
  auditar("pedidos", "Cambio de estado", {refId:r.id, antes, despues:nuevo, comentario:comentario || ""});
  if(!guardar()) return;
  snack(r.codigo + ": " + (ESTADOS[nuevo] || {texto:nuevo}).texto.toLowerCase() + ".", "ok");
  refrescar(pantalla);
}

async function registrarEntrega(id, tipo){
  const r = db.requerimientos.find(x => x.id === id);
  const s = revisarStock(r);
  const quien = await pedirTexto("Entrega de materiales",
    "Nombre de quien recibe", r.solicitante);
  if(quien === null) return;
  const firma = await pedirFirma("Firma de " + (quien || "quien recibe"));

  let entregados = 0;
  s.lineas.forEach(l => {
    const cant = tipo === "total" ? l.falta : l.puedeEntregar;
    if(cant <= 0 || !l.material) return;
    l.material.stock = +(l.material.stock - cant).toFixed(2);
    l.item.entregado = +((l.item.entregado || 0) + cant).toFixed(2);
    registrarMov({tipo:"salida", itemId:l.material.id, item:l.material.nombre, cantidad:cant,
      unidad:l.material.unidad, saldo:l.material.stock, persona:quien || r.solicitante,
      area:r.disciplina || r.area || "", documento:r.codigo,
      obs:"Entrega de " + r.codigo, foto1:null, foto2:null});
    entregados++;
  });

  const faltan = r.items.some(it => (it.entregado || 0) < it.cant);
  const registro = {
    id:uid(), fecha:ahora(), tipo: faltan ? "Entrega parcial" : "Entrega total",
    items:entregados, recibe:quien || r.solicitante, firma:firma || null,
    usuario:usuarioActual().nombre
  };
  r.entregas.push(registro);

  const antes = r.estado;
  historia(r, faltan ? "entrega_parcial" : "entregado", registro.tipo + " · " + entregados + " ítem(s)");
  if(!faltan) historia(r, "cerrado", "Requerimiento atendido completo");

  auditar("pedidos", registro.tipo, {refId:r.id, antes, despues:r.estado,
    comentario:entregados + " ítem(s) a " + registro.recibe, fotos:firma ? [1] : []});
  notificar({usuarios:[r.solicitanteId], titulo:registro.tipo + ": " + r.codigo,
    cuerpo:entregados + " ítem(s) entregados a " + registro.recibe + "." +
      (faltan ? "\nQuedan materiales pendientes." : "\nRequerimiento cerrado."),
    refTipo:"requerimiento", refId:r.id});

  if(!guardar()) return;
  snack(registro.tipo + " registrada.", "ok");
  refrescar(pantalla);
}

function enviarFaltantes(id){
  const r = db.requerimientos.find(x => x.id === id);
  const s = revisarStock(r);
  const faltantes = s.lineas.filter(l => l.puedeEntregar < l.falta)
    .map(l => l.item.desc + " (" + (l.falta - l.puedeEntregar) + " " + l.item.unidad + ")");
  const antes = r.estado;
  r.faltantes = faltantes;
  historia(r, "enviado_logistica", "Faltantes: " + faltantes.join(", "));
  auditar("pedidos", "Faltantes enviados a logística", {refId:r.id, antes, despues:"enviado_logistica",
    comentario:faltantes.join(", ")});
  notificar({roles:["jefatura","compras","admin"],
    titulo:"Materiales faltantes: " + r.codigo,
    cuerpo:"Obra: " + (r.proyecto || r.obra || "—") + "\nÁrea: " + (r.disciplina || r.area || "—") +
           "\nPrioridad: " + r.prioridad + "\nFaltan: " + faltantes.join(", "),
    refTipo:"requerimiento", refId:r.id, prioridad:r.prioridad});
  notificar({usuarios:[r.solicitanteId], titulo:"Sus faltantes pasaron a logística: " + r.codigo,
    cuerpo:faltantes.join(", "), refTipo:"requerimiento", refId:r.id});
  if(!guardar()) return;
  snack("Faltantes enviados a logística.", "ok");
  refrescar(pantalla);
}

function descargarExcelReq(id){
  const r = db.requerimientos.find(x => x.id === id);
  const filas = [["Código","Material","Unidad","Cantidad","Entregado","Pendiente","Observaciones"]]
    .concat(r.items.map(it => [it.codigo || "", it.desc, it.unidad, it.cant, it.entregado || 0,
      Math.max(0, +(it.cant - (it.entregado || 0)).toFixed(2)), it.obs || ""]));
  descargarBlob(r.codigo + ".xlsx", crearXLSX([{nombre:"Requerimiento", filas:
    [["Requerimiento", r.codigo], ["Fecha", fecha(r.fecha)], ["Solicitante", r.solicitante],
     ["Área", r.disciplina || r.area || ""], ["Proyecto", r.proyecto || r.obra || ""],
     ["Prioridad", r.prioridad], ["Estado", (ESTADOS[r.estado] || {}).texto || r.estado], []].concat(filas)}]));
  auditar("pedidos", "Excel del requerimiento descargado", {refId:r.id, comentario:r.codigo});
  guardar();
  snack("Excel del requerimiento descargado.", "ok");
}

/* ---------------------------------------------------------------
   V4.8  Panel del Jefe Logístico (sección 9)
   --------------------------------------------------------------- */
function pintarLogistica(){
  const conFaltantes = db.requerimientos.filter(r =>
    ["enviado_logistica","consolidado","sin_stock","compra_proceso","compra_aprobada",
     "en_compra","aprobado","despachado","material_recibido"].indexOf(r.estado) >= 0);

  $("lg-faltantes").innerHTML = conFaltantes.length
    ? conFaltantes.map(r => {
        const est = ESTADOS[r.estado] || ESTADOS.pendiente;
        const falt = (r.faltantes || []).length;
        return '<button class="fila" data-lg="' + r.id + '"><span class="mini mal">' + ico("alerta", 20) + "</span>" +
          '<span class="txt"><b>' + esc(r.codigo) + " · " + esc(r.disciplina || r.area || "—") + "</b><small>" +
          (falt ? falt + " faltante(s): " + esc((r.faltantes || []).join(", ")) : esc(resumenItems(r))) + "</small></span>" +
          '<span class="der"><span class="chip ' + est.chip + '">' + est.texto + "</span>" +
          '<span class="chip ' + chipPrioridad(r.prioridad) + '">' + esc(r.prioridad) + "</span></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("check", 40) + "No hay requerimientos con faltantes.</div>";
  $$("#lg-faltantes [data-lg]").forEach(b => b.addEventListener("click", ()=> gestionLogistica(b.dataset.lg)));

  const conCot = db.requerimientos.filter(r => r.cotizaciones && r.cotizaciones.length);
  $("lg-cotizaciones").innerHTML = conCot.length
    ? conCot.map(r => '<div class="card"><b style="font-size:14.5px">' + esc(r.codigo) + "</b>" +
        '<div class="ayuda" style="margin:2px 0 8px">' + esc(r.disciplina || r.area || "") + "</div>" +
        r.cotizaciones.map(c => '<div class="dato"><span>' + esc(c.proveedor) + "</span><b>S/ " +
          Number(c.monto).toFixed(2) + (c.elegida ? " ✓" : "") + "</b></div>").join("") + "</div>").join("")
    : '<div class="vacio">' + ico("documento", 40) + "Sin cotizaciones registradas.</div>";

  $("lg-proveedores").innerHTML = db.proveedores.length
    ? db.proveedores.map(p => {
        const ocs = db.requerimientos.filter(r => r.oc && r.oc.proveedor === p.nombre);
        const tarde = ocs.filter(r => r.oc.entrega && r.despacho &&
          diaLocal(r.despacho.fecha) > r.oc.entrega).length;
        return '<div class="fila"><span class="mini">' + ico("camion", 20) + "</span>" +
          '<span class="txt"><b>' + esc(p.nombre) + "</b><small>" +
          esc([p.ruc ? "RUC " + p.ruc : "", p.rubro, p.contacto].filter(Boolean).join(" · ")) + "</small></span>" +
          '<span class="der"><small>' + ocs.length + " OC</small>" +
          (tarde ? '<span class="chip mal">' + tarde + " con retraso</span>" : '<span class="chip ok">al día</span>') +
          "</span></div>";
      }).join("")
    : '<div class="vacio">' + ico("camion", 40) + "Sin proveedores registrados.</div>";
}

function gestionLogistica(id){
  const r = db.requerimientos.find(x => x.id === id);
  const est = ESTADOS[r.estado] || ESTADOS.pendiente;
  let html = '<div class="dato"><span>Estado</span><b><span class="chip ' + est.chip + '">' + est.texto + "</span></b></div>" +
    '<div class="dato"><span>Solicitante</span><b>' + esc(r.solicitante) + "</b></div>" +
    '<div class="dato"><span>Área</span><b>' + esc(r.disciplina || r.area || "—") + "</b></div>" +
    '<div class="dato"><span>Prioridad</span><b>' + esc(r.prioridad) + "</b></div>";
  if((r.faltantes || []).length)
    html += '<div class="sech" style="margin:14px 0 6px">Faltantes</div>' +
      r.faltantes.map(f => '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(f) + "</b></span></div>").join("");
  if(r.cotizaciones.length)
    html += '<div class="sech" style="margin:14px 0 6px">Cotizaciones</div>' +
      r.cotizaciones.map(c => '<div class="dato"><span>' + esc(c.proveedor) + (c.elegida ? " (elegida)" : "") +
        "</span><b>S/ " + Number(c.monto).toFixed(2) + "</b></div>").join("");

  const acc = [];
  if(puede("cotizaciones")) acc.push({txt:"Agregar cotización", clase:"btn-cont", fn:()=> agregarCotizacion(r.id)});
  if(puede("compras.aprobar") && r.cotizaciones.length)
    acc.push({txt:"Aprobar compra", clase:"btn-ok", fn:()=> aprobarCompra(r.id)});
  if(puede("compras")) acc.push({txt:"Registrar OC", clase:"btn-pri", fn:()=> ir("compras", "cOrden")});
  if(puede("compras")) acc.push({txt:"Subir guía", clase:"btn-cont", fn:()=> ir("compras", "cGuia")});
  acc.push({txt:"Ficha completa", clase:"btn-cont", fn:()=> detalleReq(r.id)});
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja(r.codigo + " · logística", html, acc);
}

async function agregarCotizacion(id){
  const r = db.requerimientos.find(x => x.id === id);
  const prov = await pedirTexto("Cotización", "Proveedor");
  if(!prov) return;
  const monto = await pedirTexto("Cotización de " + prov, "Monto total en S/");
  if(monto === null) return;
  r.cotizaciones.push({id:uid(), proveedor:prov, monto:num(monto), fecha:ahora(),
    usuario:usuarioActual().nombre, elegida:false});
  if(!db.proveedores.some(p => sinTildes(p.nombre) === sinTildes(prov)))
    db.proveedores.push({id:uid(), nombre:prov, ruc:"", contacto:"", rubro:"", creado:ahora()});
  auditar("compras", "Cotización registrada", {refId:r.id, comentario:prov + " · S/ " + num(monto)});
  if(guardar()){ snack("Cotización registrada.", "ok"); refrescar(pantalla); }
}

function aprobarCompra(id){
  const r = db.requerimientos.find(x => x.id === id);
  const mejor = r.cotizaciones.slice().sort((a,b)=> a.monto - b.monto)[0];
  hoja("Aprobar compra de " + r.codigo,
    "<p class='ayuda' style='margin:0 0 10px'>Elija la cotización que se aprueba.</p>" +
    '<div class="campo"><label>Cotización</label><select id="ac-cot">' +
    r.cotizaciones.map(c => '<option value="' + c.id + '"' + (mejor && c.id === mejor.id ? " selected" : "") + ">" +
      esc(c.proveedor) + " · S/ " + Number(c.monto).toFixed(2) + "</option>").join("") + "</select></div>",
    [{txt:"Cancelar", clase:"btn-cont"},
     {txt:"Aprobar", clase:"btn-ok", fn:()=>{
        const cid = ($("ac-cot") || {}).value;
        r.cotizaciones.forEach(c => c.elegida = c.id === cid);
        const c = r.cotizaciones.find(x => x.id === cid);
        const antes = r.estado;
        historia(r, "compra_aprobada", c ? c.proveedor + " · S/ " + Number(c.monto).toFixed(2) : "");
        auditar("compras", "Compra aprobada", {refId:r.id, antes, despues:"compra_aprobada",
          comentario:c ? c.proveedor : ""});
        notificar({roles:["compras","admin"], titulo:"Compra aprobada: " + r.codigo,
          cuerpo:"Proveedor: " + (c ? c.proveedor : "—") + "\nMonto: S/ " + (c ? Number(c.monto).toFixed(2) : "—") +
                 "\nProceda con la orden de compra.", refTipo:"requerimiento", refId:r.id});
        if(guardar()){ snack("Compra aprobada.", "ok"); refrescar(pantalla); }
     }}]);
}

$("pv-guardar").addEventListener("click", ()=>{
  const nombre = $("pv-nombre").value.trim();
  if(!nombre) return snack("Escriba el nombre del proveedor.", "err");
  if(db.proveedores.some(p => sinTildes(p.nombre) === sinTildes(nombre))) return snack("Ese proveedor ya existe.", "err");
  db.proveedores.push({id:uid(), nombre, ruc:$("pv-ruc").value.trim(),
    contacto:$("pv-contacto").value.trim(), rubro:$("pv-rubro").value.trim(), creado:ahora()});
  auditar("compras", "Proveedor registrado", {comentario:nombre});
  if(!guardar()) return;
  ["pv-nombre","pv-ruc","pv-contacto","pv-rubro"].forEach(i => $(i).value = "");
  snack("Proveedor agregado.", "ok");
  pintarLogistica();
});

/* ---------------------------------------------------------------
   V4.9  Dashboard gerencial (sección 12)
   --------------------------------------------------------------- */
function pintarDashboard(){
  const hoy = hoyISO();
  const req = db.requerimientos;
  const delDia = req.filter(r => diaLocal(r.fecha) === hoy);
  const pendientes = req.filter(r => ABIERTOS.indexOf(r.estado) >= 0);
  const atendidos = req.filter(r => ["entregado","cerrado","recibido"].indexOf(r.estado) >= 0);
  const movsHoy = db.movimientos.filter(m => diaLocal(m.fecha) === hoy);
  const comprasProc = req.filter(r => ["compra_proceso","en_compra","compra_aprobada","aprobado"].indexOf(r.estado) >= 0);
  const criticos = db.materiales.filter(m => estadoStock(m) !== "disponible");
  const prestadas = db.herramientas.filter(h => h.estado === "prestada");

  $("dg-metricas").innerHTML =
    '<div class="metrica"><b>' + delDia.length + "</b><span>Requerimientos hoy</span></div>" +
    '<div class="metrica alerta"><b>' + pendientes.length + "</b><span>Pendientes</span></div>" +
    '<div class="metrica ok"><b>' + atendidos.length + "</b><span>Atendidos</span></div>" +
    '<div class="metrica"><b>' + comprasProc.length + "</b><span>Compras en curso</span></div>" +
    '<div class="metrica ok"><b>' + movsHoy.filter(m => m.tipo === "ingreso").length + "</b><span>Recibidos hoy</span></div>" +
    '<div class="metrica"><b>' + prestadas.length + "</b><span>Herr. prestadas</span></div>" +
    '<div class="metrica"><b>' + movsHoy.filter(m => m.tipo === "devolucion").length + "</b><span>Herr. devueltas hoy</span></div>" +
    '<div class="metrica mal"><b>' + criticos.length + "</b><span>Stock crítico</span></div>";

  const discs = {};
  req.forEach(r => {
    const d = r.disciplina || r.area || "Sin área";
    if(!discs[d]) discs[d] = {total:0, abiertos:0, entregados:0};
    discs[d].total++;
    if(ABIERTOS.indexOf(r.estado) >= 0) discs[d].abiertos++;
    if(["entregado","cerrado","recibido"].indexOf(r.estado) >= 0) discs[d].entregados++;
  });
  const maxD = Math.max(1, ...Object.keys(discs).map(k => discs[k].total));
  $("dg-disciplinas").innerHTML = Object.keys(discs).length
    ? Object.keys(discs).map(k =>
        '<div class="barra"><div class="rot"><span>' + esc(k) + "</span><b>" + discs[k].total +
        " · " + discs[k].abiertos + " abiertos</b></div>" +
        '<div class="via"><div class="lleno" style="width:' + Math.round(discs[k].total / maxD * 100) + '%"></div></div></div>').join("")
    : '<div class="ayuda" style="margin:0">Sin requerimientos registrados.</div>';

  const flujo = ["pendiente","revisado","en_preparacion","entrega_parcial","enviado_logistica",
                 "compra_proceso","compra_aprobada","material_recibido","entregado","cerrado"];
  const totalF = req.length || 1;
  $("dg-flujo").innerHTML = flujo.map(k => {
    const n = req.filter(r => r.estado === k).length;
    if(!n) return "";
    return '<div class="dato"><span>' + ESTADOS[k].texto + "</span><b>" + n +
      " (" + Math.round(n / totalF * 100) + "%)</b></div>";
  }).join("") || '<div class="ayuda" style="margin:0">Sin movimientos en el flujo.</div>';

  $("dg-stock").innerHTML = criticos.length
    ? criticos.slice(0, 12).map(m => {
        const e = ESTADO_STOCK[estadoStock(m)];
        return '<div class="fila"><span class="mini ' + e.chip + '">' + ico("alerta", 20) + "</span>" +
          '<span class="txt"><b>' + esc(m.nombre) + "</b><small>" + esc(m.codigo) + " · mín. " + m.minimo + "</small></span>" +
          '<span class="der"><b>' + m.stock + " " + esc(m.unidad) + '</b><span class="chip ' + e.chip + '">' + e.txt + "</span></span></div>";
      }).join("")
    : '<div class="vacio">' + ico("check", 40) + "Ningún material en estado crítico.</div>";

  const devueltas = db.movimientos.filter(m => m.tipo === "devolucion").length;
  $("dg-herramientas").innerHTML =
    '<div class="dato"><span>Total en inventario</span><b>' + db.herramientas.length + "</b></div>" +
    '<div class="dato"><span>Prestadas</span><b>' + prestadas.length + "</b></div>" +
    '<div class="dato"><span>Devoluciones acumuladas</span><b>' + devueltas + "</b></div>" +
    '<div class="dato"><span>De baja / dañadas</span><b>' + db.herramientas.filter(h => h.estado === "baja").length + "</b></div>";
}

/* ---------------------------------------------------------------
   V4.10  Analítica (sección 15)
   --------------------------------------------------------------- */
function analitica(){
  const salidas = db.movimientos.filter(m => m.tipo === "salida");
  const porMaterial = {};
  salidas.forEach(m => {
    porMaterial[m.item] = (porMaterial[m.item] || 0) + Number(m.cantidad || 0);
  });
  const consumidos = Object.keys(porMaterial).map(k => ({nombre:k, cant:porMaterial[k]}))
    .sort((a,b)=> b.cant - a.cant).slice(0, 8);

  const porSupervisor = {}, porEspecialidad = {};
  db.requerimientos.forEach(r => {
    porSupervisor[r.solicitante] = (porSupervisor[r.solicitante] || 0) + r.items.length;
    const d = r.disciplina || r.area || "Sin área";
    porEspecialidad[d] = (porEspecialidad[d] || 0) + r.items.length;
  });

  const porMes = {};
  db.requerimientos.filter(r => r.oc).forEach(r => {
    const k = r.oc.fecha.slice(0,7);
    porMes[k] = (porMes[k] || 0) + Number(r.oc.monto || 0);
  });

  const herrUso = {};
  db.movimientos.filter(m => m.tipo === "prestamo").forEach(m => {
    herrUso[m.item] = (herrUso[m.item] || 0) + 1;
  });

  const provRetraso = {};
  db.requerimientos.filter(r => r.oc && r.despacho && r.oc.entrega).forEach(r => {
    if(diaLocal(r.despacho.fecha) > r.oc.entrega)
      provRetraso[r.oc.proveedor] = (provRetraso[r.oc.proveedor] || 0) + 1;
  });

  return {consumidos, porSupervisor, porEspecialidad, porMes, herrUso, provRetraso};
}

function pintarAnalitica(){
  const a = analitica();
  const barra = (etiqueta, valor, max, clase) =>
    '<div class="barra ' + (clase || "") + '"><div class="rot"><span>' + esc(etiqueta) + "</span><b>" +
    valor + "</b></div><div class=\"via\"><div class=\"lleno\" style=\"width:" +
    Math.round(valor / (max || 1) * 100) + '%"></div></div></div>';

  const maxC = Math.max(1, ...a.consumidos.map(x => x.cant));
  $("an-consumidos").innerHTML = a.consumidos.length
    ? a.consumidos.map(x => barra(x.nombre, x.cant, maxC)).join("")
    : '<div class="ayuda" style="margin:0">Todavía no hay salidas registradas.</div>';

  const porAgotarse = db.materiales
    .filter(m => m.minimo > 0 && m.stock <= m.minimo * 1.5)
    .sort((a1,b1)=> (a1.stock / (a1.minimo || 1)) - (b1.stock / (b1.minimo || 1)))
    .slice(0, 10);
  $("an-agotarse").innerHTML = porAgotarse.length
    ? porAgotarse.map(m => {
        const e = ESTADO_STOCK[estadoStock(m)];
        return '<div class="fila"><span class="mini ' + e.chip + '">' + ico("caja", 20) + "</span>" +
          '<span class="txt"><b>' + esc(m.nombre) + "</b><small>" + esc(m.codigo) + " · mín. " + m.minimo + " " + esc(m.unidad) + "</small></span>" +
          '<span class="der"><b>' + m.stock + "</b><span class=\"chip " + e.chip + '">' + e.txt + "</span></span></div>";
      }).join("")
    : '<div class="vacio">' + ico("check", 36) + "Ningún material cerca del mínimo.</div>";

  const maxE = Math.max(1, ...Object.keys(a.porEspecialidad).map(k => a.porEspecialidad[k]));
  $("an-especialidad").innerHTML = Object.keys(a.porEspecialidad).length
    ? Object.keys(a.porEspecialidad).map(k => barra(k, a.porEspecialidad[k], maxE, "lila")).join("")
    : '<div class="ayuda" style="margin:0">Sin datos.</div>';

  const maxS = Math.max(1, ...Object.keys(a.porSupervisor).map(k => a.porSupervisor[k]));
  $("an-supervisor").innerHTML = Object.keys(a.porSupervisor).length
    ? Object.keys(a.porSupervisor).map(k => barra(k, a.porSupervisor[k], maxS, "ok")).join("")
    : '<div class="ayuda" style="margin:0">Sin datos.</div>';

  const dias = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10);
    dias.push({et:d.toLocaleDateString("es-PE",{weekday:"short"}).slice(0,2),
               n:db.requerimientos.filter(r => diaLocal(r.fecha) === iso).length});
  }
  const maxD = Math.max(1, ...dias.map(d => d.n));
  $("an-dias").innerHTML = dias.map(d =>
    '<div class="col"><span class="val">' + d.n + '</span><div class="bar" style="height:' +
    Math.round(d.n / maxD * 76) + 'px"></div><span class="et">' + d.et + "</span></div>").join("");

  const meses = Object.keys(a.porMes).sort();
  $("an-compras").innerHTML = meses.length
    ? meses.map(k => '<div class="dato"><span>' + k + "</span><b>S/ " + a.porMes[k].toFixed(2) + "</b></div>").join("")
    : '<div class="ayuda" style="margin:0">Sin órdenes de compra registradas.</div>';

  const herr = Object.keys(a.herrUso).sort((x,y)=> a.herrUso[y] - a.herrUso[x]).slice(0,5);
  const dañadas = db.herramientas.filter(h => h.estado === "baja");
  const provs = Object.keys(a.provRetraso);
  const t = tiemposAtencion();
  $("an-varios").innerHTML =
    '<div class="dato"><span>Tiempo promedio de atención</span><b>' + duracion(t.total) + "</b></div>" +
    '<div class="dato"><span>Requerimientos cerrados</span><b>' + t.cerrados + "</b></div>" +
    (herr.length ? herr.map(k => '<div class="dato"><span>' + esc(k) + "</span><b>" + a.herrUso[k] + " préstamos</b></div>").join("")
                 : '<div class="dato"><span>Herramientas más usadas</span><b>sin datos</b></div>') +
    '<div class="dato"><span>Herramientas dañadas / de baja</span><b>' + dañadas.length + "</b></div>" +
    (provs.length ? provs.map(p => '<div class="dato"><span>Retrasos de ' + esc(p) + "</span><b>" + a.provRetraso[p] + "</b></div>").join("")
                  : '<div class="dato"><span>Proveedores con retraso</span><b>ninguno</b></div>');
}

/* ---------------------------------------------------------------
   V4.11  Auditoría (sección 2 y 11)
   --------------------------------------------------------------- */
$("au-buscar").addEventListener("input", pintarAuditoria);

function pintarAuditoria(){
  const q = sinTildes($("au-buscar").value);
  const lista = db.auditoria.filter(a => !q ||
    sinTildes([a.usuario, a.accion, a.comentario, a.modulo].join(" ")).indexOf(q) >= 0);
  $("au-info").textContent = lista.length + " registros · IP y dispositivo de cada acción";
  $("au-lista").innerHTML = lista.length
    ? lista.slice(0, 200).map(a =>
        '<div class="card plano" style="padding:11px"><div style="display:flex;justify-content:space-between;gap:10px">' +
        "<b style='font-size:14px'>" + esc(a.accion) + "</b><small style='color:var(--tinta-sec)'>" + hace(a.fecha) + "</small></div>" +
        "<div style='font-size:12.5px;color:var(--tinta-sec);margin-top:3px'>" +
        esc(a.usuario) + (a.cargo ? " · " + esc(a.cargo) : "") + " · " + esc(a.modulo) + "</div>" +
        (a.estadoAnterior || a.estadoNuevo
          ? "<div style='font-size:12px;margin-top:4px'>" + esc(a.estadoAnterior || "—") + " → <b>" + esc(a.estadoNuevo || "—") + "</b></div>" : "") +
        (a.comentario ? "<div style='font-size:12.5px;margin-top:4px'>" + esc(a.comentario) + "</div>" : "") +
        "<div style='font-size:11px;color:var(--tinta-sec);margin-top:5px'>" + fecha(a.fecha) +
        " · IP " + esc(a.ip) + " · " + esc(a.dispositivo) +
        (a.fotos ? " · " + a.fotos + " foto(s)" : "") + "</div></div>").join("")
    : '<div class="vacio">' + ico("escudo", 40) + "Sin registros de auditoría.</div>";
}

$("au-exportar").addEventListener("click", ()=>{
  const filas = [["Fecha","Usuario","Cargo","Módulo","Acción","Estado anterior","Estado nuevo","Comentario","IP","Dispositivo"]]
    .concat(db.auditoria.map(a => [fecha(a.fecha), a.usuario, a.cargo, a.modulo, a.accion,
      a.estadoAnterior, a.estadoNuevo, a.comentario, a.ip, a.dispositivo]));
  descargarBlob("auditoria_" + hoyISO() + ".xlsx", crearXLSX([{nombre:"Auditoría", filas}]));
  snack("Auditoría exportada.", "ok");
});

/* ---------------------------------------------------------------
   V4.12  Configuración del sistema (sección 2 y 14)
   --------------------------------------------------------------- */
function pintarConfig(){
  const c = db.config;
  $("cf-empresa").value = c.empresa || "";
  $("cf-proyecto").value = c.proyecto || db.config.obra || "";
  $("cf-hora").value = c.horaReporte || "18:00";
  if(c.logo) $("cf-logo-prev").innerHTML = '<img src="' + c.logo + '" class="thumb" data-zoom="' + c.logo +
    '" alt="logo"><span class="ayuda" style="margin:0">Logo actual</span>';
  $("cf-destinatarios").innerHTML = (c.correos || []).length
    ? c.correos.map((d, i) => '<div class="fila"><span class="mini">' + ico("usuario", 20) + "</span>" +
        '<span class="txt"><b>' + esc(d.nombre) + "</b><small>" + esc(d.correo) + "</small></span>" +
        '<button class="quitar" data-dest="' + i + '" style="margin:0">Quitar</button></div>').join("")
    : '<div class="ayuda" style="margin:0">Sin destinatarios configurados.</div>';
  $$("[data-dest]").forEach(b => b.addEventListener("click", ()=>{
    c.correos.splice(+b.dataset.dest, 1);
    if(guardar()){ snack("Destinatario quitado.", "ok"); pintarConfig(); }
  }));
}

$("cf-guardar").addEventListener("click", ()=>{
  db.config.empresa = $("cf-empresa").value.trim();
  db.config.proyecto = $("cf-proyecto").value.trim();
  db.config.horaReporte = $("cf-hora").value || "18:00";
  if(fotos["cf-logo"]) db.config.logo = fotos["cf-logo"];
  auditar("configuracion", "Configuración actualizada",
    {comentario:db.config.empresa + " · " + db.config.proyecto + " · " + db.config.horaReporte});
  if(guardar()){ snack("Configuración guardada.", "ok"); pintarConfig(); }
});

$("cf-dest-add").addEventListener("click", ()=>{
  const nombre = $("cf-dest-nombre").value.trim(), correo = $("cf-dest-correo").value.trim();
  if(!nombre) return snack("Escriba el nombre del destinatario.", "err");
  if(!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo)) return snack("Escriba un correo válido.", "err");
  db.config.correos.push({nombre, correo});
  auditar("configuracion", "Destinatario agregado", {comentario:nombre + " <" + correo + ">"});
  if(!guardar()) return;
  $("cf-dest-nombre").value = ""; $("cf-dest-correo").value = "";
  snack("Destinatario agregado.", "ok");
  pintarConfig();
});

/* ---------------------------------------------------------------
   V4.13  Generador de Word (.docx) — mismo empaquetador ZIP del Excel
   --------------------------------------------------------------- */
function crearDOCX(bloques){
  const p = (texto, estilo)=>{
    const tam = estilo === "h1" ? 36 : (estilo === "h2" ? 26 : 20);
    const negrita = (estilo === "h1" || estilo === "h2") ? "<w:b/>" : "";
    const color = estilo === "h1" ? '<w:color w:val="1B4B8F"/>' : (estilo === "h2" ? '<w:color w:val="1B4B8F"/>' : "");
    return '<w:p><w:pPr><w:spacing w:before="' + (estilo === "h2" ? 240 : 60) + '" w:after="80"/></w:pPr>' +
      '<w:r><w:rPr>' + negrita + color + '<w:sz w:val="' + tam + '"/></w:rPr>' +
      '<w:t xml:space="preserve">' + escXML(texto) + "</w:t></w:r></w:p>";
  };
  const celda = (t, cab)=>
    '<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/>' +
    (cab ? '<w:shd w:val="clear" w:fill="D9E4F7"/>' : "") + "</w:tcPr>" +
    '<w:p><w:r><w:rPr>' + (cab ? "<w:b/>" : "") + '<w:sz w:val="18"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escXML(t) + "</w:t></w:r></w:p></w:tc>";
  const tabla = filas =>
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
    ["top","left","bottom","right","insideH","insideV"].map(b =>
      "<w:" + b + ' w:val="single" w:sz="4" w:space="0" w:color="C9D2E0"/>').join("") +
    "</w:tblBorders></w:tblPr>" +
    filas.map((f, i) => "<w:tr>" + f.map(c => celda(String(c == null ? "" : c), i === 0)).join("") + "</w:tr>").join("") +
    "</w:tbl><w:p/>";

  const cuerpo = bloques.map(b =>
    b.tipo === "tabla" ? tabla(b.filas) : p(b.texto, b.tipo)).join("");

  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    cuerpo + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';

  const archivos = [
    {nombre:"[Content_Types].xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"},
    {nombre:"_rels/.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"},
    {nombre:"word/_rels/document.xml.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'},
    {nombre:"word/document.xml", texto:doc}
  ];
  const blob = armarZip(archivos);
  return new Blob([blob], {type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

/* ---------------------------------------------------------------
   V4.14  Reporte diario ejecutivo (sección 13)
   --------------------------------------------------------------- */
function datosEjecutivos(dia){
  const req = db.requerimientos;
  const recibidos = req.filter(r => diaLocal(r.fecha) === dia);
  const atendidos = req.filter(r => r.historial.some(h =>
    diaLocal(h.fecha) === dia && ["entregado","cerrado","entrega_parcial","material_recibido"].indexOf(h.estado) >= 0));
  const pendientes = req.filter(r => ABIERTOS.indexOf(r.estado) >= 0);
  const compras = req.filter(r => (r.oc && diaLocal(r.oc.fecha) === dia) ||
    (r.cotizaciones || []).some(c => diaLocal(c.fecha) === dia));
  const movs = db.movimientos.filter(m => diaLocal(m.fecha) === dia);
  const entregados = movs.filter(m => m.tipo === "salida");
  const prestamos = movs.filter(m => m.tipo === "prestamo");
  const devoluciones = movs.filter(m => m.tipo === "devolucion");
  const incidencias = req.filter(r =>
    ["sin_stock","entrega_parcial","observado","rechazado","devuelto"].indexOf(r.estado) >= 0);
  const fotos = [];
  movs.forEach(m => { if(m.foto1) fotos.push({src:m.foto1, pie:m.item}); if(m.foto2) fotos.push({src:m.foto2, pie:m.item}); });
  recibidos.forEach(r => { if(r.foto) fotos.push({src:r.foto, pie:r.codigo}); });
  return {recibidos, atendidos, pendientes, compras, entregados, prestamos, devoluciones, incidencias, fotos, movs};
}

function reporteEjecutivoHTML(dia, observaciones){
  const d = datosEjecutivos(dia);
  const c = db.config;
  const u = usuarioActual();
  const fmt = new Date(dia + "T12:00:00").toLocaleDateString("es-PE",
    {weekday:"long", day:"2-digit", month:"long", year:"numeric"});
  const fila = (a,b) => "<tr><td>" + esc(a) + "</td><td>" + esc(b) + "</td></tr>";
  const tabla = (cab, filas) => filas.length
    ? "<table><thead><tr>" + cab.map(x => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" +
      filas.map(f => "<tr>" + f.map(x => "<td>" + esc(x) + "</td>").join("") + "</tr>").join("") + "</tbody></table>"
    : "<p class='v'>Sin registros.</p>";

  return "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'><title>Reporte diario " + dia + "</title><style>" +
    "*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#1A1F27;margin:0;padding:26px;font-size:12px}" +
    "header{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1B4B8F;padding-bottom:14px;margin-bottom:18px}" +
    "header img{height:58px;object-fit:contain}h1{font-size:19px;margin:0;color:#1B4B8F}" +
    ".sub{font-size:12px;color:#5B6672;margin-top:3px}" +
    "h2{font-size:13px;color:#1B4B8F;margin:18px 0 7px;border-bottom:1px solid #DCE3ED;padding-bottom:4px}" +
    "table{width:100%;border-collapse:collapse;margin-bottom:8px}" +
    "th,td{border:1px solid #DCE3ED;padding:5px 7px;text-align:left;font-size:11px;vertical-align:top}" +
    "th{background:#D9E4F7;color:#123566}" +
    ".kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}" +
    ".kpi{border:1px solid #DCE3ED;border-radius:8px;padding:8px 12px;min-width:104px}" +
    ".kpi b{display:block;font-size:19px;color:#1B4B8F}.kpi span{font-size:10px;color:#5B6672}" +
    ".v{color:#5B6672;font-style:italic;font-size:11px}" +
    ".fotos{display:flex;flex-wrap:wrap;gap:8px}.fotos figure{margin:0;width:150px}" +
    ".fotos img{width:100%;height:104px;object-fit:cover;border:1px solid #DCE3ED;border-radius:6px}" +
    ".fotos figcaption{font-size:9.5px;color:#5B6672;margin-top:3px}" +
    "footer{margin-top:22px;border-top:1px solid #DCE3ED;padding-top:8px;font-size:10px;color:#5B6672}" +
    "@page{margin:14mm}@media print{body{padding:0}}" +
    "</style></head><body>" +
    "<header>" + (c.logo ? "<img src='" + c.logo + "' alt='logo'>" : "") +
    "<div><h1>Reporte Diario de Almacén</h1><div class='sub'>" +
    esc(c.empresa || "") + (c.empresa && (c.proyecto || db.config.obra) ? " · " : "") +
    esc(c.proyecto || db.config.obra || "") + "</div>" +
    "<div class='sub'>" + fmt + " · Responsable: " + esc(u.nombre) + " (" + esc(u.cargo || ROLES[u.rol].nombre) + ")</div></div></header>" +

    "<div class='kpis'>" +
    "<div class='kpi'><b>" + d.recibidos.length + "</b><span>Requerimientos recibidos</span></div>" +
    "<div class='kpi'><b>" + d.atendidos.length + "</b><span>Atendidos</span></div>" +
    "<div class='kpi'><b>" + d.pendientes.length + "</b><span>Pendientes</span></div>" +
    "<div class='kpi'><b>" + d.compras.length + "</b><span>Compras del día</span></div>" +
    "<div class='kpi'><b>" + d.entregados.length + "</b><span>Entregas de material</span></div>" +
    "<div class='kpi'><b>" + d.prestamos.length + "</b><span>Herramientas prestadas</span></div>" +
    "<div class='kpi'><b>" + d.devoluciones.length + "</b><span>Devoluciones</span></div>" +
    "</div>" +

    "<h2>Requerimientos recibidos</h2>" +
    tabla(["Código","Área","Solicitante","Prioridad","Materiales","Estado"],
      d.recibidos.map(r => [r.codigo, r.disciplina || r.area || "—", r.solicitante, r.prioridad,
        resumenItems(r), (ESTADOS[r.estado] || {}).texto || r.estado])) +

    "<h2>Requerimientos atendidos</h2>" +
    tabla(["Código","Área","Estado","Entregas"],
      d.atendidos.map(r => [r.codigo, r.disciplina || r.area || "—",
        (ESTADOS[r.estado] || {}).texto || r.estado,
        (r.entregas || []).map(e => e.tipo + " a " + e.recibe).join(" / ") || "—"])) +

    "<h2>Pendientes</h2>" +
    tabla(["Código","Área","Estado","Días"],
      d.pendientes.map(r => [r.codigo, r.disciplina || r.area || "—",
        (ESTADOS[r.estado] || {}).texto || r.estado,
        Math.round(horas(r.fecha, ahora()) / 24 * 10) / 10])) +

    "<h2>Compras</h2>" +
    tabla(["Código","Proveedor","N° OC","Monto S/","Guía"],
      d.compras.map(r => [r.codigo, r.oc ? r.oc.proveedor : "—", r.oc ? r.oc.numero : "—",
        r.oc ? Number(r.oc.monto || 0).toFixed(2) : "—", r.despacho ? r.despacho.guia : "—"])) +

    "<h2>Materiales entregados</h2>" +
    tabla(["Hora","Material","Cantidad","Recibió","Área"],
      d.entregados.map(m => [hora(m.fecha), m.item, m.cantidad + " " + m.unidad,
        m.persona || "—", m.area || "—"])) +

    "<h2>Herramientas</h2>" +
    tabla(["Hora","Herramienta","Movimiento","Responsable"],
      d.prestamos.concat(d.devoluciones).map(m => [hora(m.fecha), m.item,
        TIPOMOV[m.tipo].texto, m.persona || "—"])) +

    "<h2>Incidencias</h2>" +
    tabla(["Código","Estado","Detalle"],
      d.incidencias.map(r => [r.codigo, (ESTADOS[r.estado] || {}).texto || r.estado,
        (r.faltantes || []).join(", ") || (r.historial.length ? r.historial[r.historial.length-1].nota : "") || "—"])) +

    (d.fotos.length ? "<h2>Fotografías del día</h2><div class='fotos'>" +
      d.fotos.slice(0, 12).map(f => "<figure><img src='" + f.src + "'><figcaption>" + esc(f.pie) + "</figcaption></figure>").join("") +
      "</div>" : "") +

    "<h2>Observaciones del administrador</h2>" +
    "<p>" + (observaciones ? esc(observaciones).replace(/\n/g, "<br>") : "<span class='v'>Sin observaciones.</span>") + "</p>" +

    "<footer>Generado por " + esc(u.nombre) + " el " + fecha(ahora()) +
    " · Sistema de Almacén" + (c.empresa ? " · " + esc(c.empresa) : "") + "</footer>" +
    "</body></html>";
}

function imprimirReporte(html){
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  document.body.appendChild(marco);
  const d = marco.contentWindow.document;
  d.open(); d.write(html); d.close();
  setTimeout(()=>{
    try{
      marco.contentWindow.focus();
      marco.contentWindow.print();
    }catch(e){
      const w = window.open("", "_blank");
      if(w){ w.document.write(html); w.document.close(); w.print(); }
      else snack("Permita las ventanas emergentes para generar el PDF.", "err");
    }
    setTimeout(()=> marco.remove(), 60000);
  }, 500);
}

function bloquesEjecutivos(dia, observaciones){
  const d = datosEjecutivos(dia);
  const c = db.config, u = usuarioActual();
  const fmt = new Date(dia + "T12:00:00").toLocaleDateString("es-PE",
    {weekday:"long", day:"2-digit", month:"long", year:"numeric"});
  const B = [];
  B.push({tipo:"h1", texto:"Reporte Diario de Almacén"});
  if(c.empresa) B.push({tipo:"p", texto:c.empresa});
  B.push({tipo:"p", texto:"Proyecto: " + (c.proyecto || db.config.obra || "—")});
  B.push({tipo:"p", texto:"Fecha: " + fmt});
  B.push({tipo:"p", texto:"Responsable: " + u.nombre + " (" + (u.cargo || ROLES[u.rol].nombre) + ")"});

  B.push({tipo:"h2", texto:"Resumen"});
  B.push({tipo:"tabla", filas:[["Indicador","Valor"],
    ["Requerimientos recibidos", d.recibidos.length], ["Atendidos", d.atendidos.length],
    ["Pendientes", d.pendientes.length], ["Compras del día", d.compras.length],
    ["Entregas de material", d.entregados.length], ["Herramientas prestadas", d.prestamos.length],
    ["Devoluciones", d.devoluciones.length], ["Incidencias", d.incidencias.length]]});

  B.push({tipo:"h2", texto:"Requerimientos recibidos"});
  B.push({tipo:"tabla", filas:[["Código","Área","Solicitante","Prioridad","Estado"]]
    .concat(d.recibidos.map(r => [r.codigo, r.disciplina || r.area || "—", r.solicitante, r.prioridad,
      (ESTADOS[r.estado] || {}).texto || r.estado]))});

  B.push({tipo:"h2", texto:"Materiales entregados"});
  B.push({tipo:"tabla", filas:[["Material","Cantidad","Recibió"]]
    .concat(d.entregados.map(m => [m.item, m.cantidad + " " + m.unidad, m.persona || "—"]))});

  B.push({tipo:"h2", texto:"Herramientas"});
  B.push({tipo:"tabla", filas:[["Herramienta","Movimiento","Responsable"]]
    .concat(d.prestamos.concat(d.devoluciones).map(m => [m.item, TIPOMOV[m.tipo].texto, m.persona || "—"]))});

  B.push({tipo:"h2", texto:"Incidencias"});
  B.push({tipo:"tabla", filas:[["Código","Estado","Detalle"]]
    .concat(d.incidencias.map(r => [r.codigo, (ESTADOS[r.estado] || {}).texto || r.estado,
      (r.faltantes || []).join(", ") || "—"]))});

  B.push({tipo:"h2", texto:"Observaciones del administrador"});
  B.push({tipo:"p", texto:observaciones || "Sin observaciones."});
  return B;
}

/* Tarjeta de reporte ejecutivo dentro de la pantalla Reportes */
(function ampliarReportes(){
  const cont = $("scr-reportes");
  if(!cont || $("re-obs")) return;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    '<div style="font-weight:600;font-size:15px;margin-bottom:4px">Reporte diario ejecutivo</div>' +
    '<p class="ayuda" style="margin:0 0 10px">Con logo, proyecto, responsable, requerimientos, compras, entregas, herramientas, incidencias y fotografías.</p>' +
    '<div class="campo"><label>Observaciones del administrador</label><textarea id="re-obs" placeholder="Comentarios del día"></textarea></div>' +
    '<div class="btns"><button class="btn btn-pri" id="re-pdf">PDF</button>' +
    '<button class="btn btn-sec" id="re-xls">Excel</button>' +
    '<button class="btn btn-cont" id="re-doc">Word</button></div>' +
    '<button class="btn btn-ton" id="re-enviar" style="margin-top:10px">Preparar envío a destinatarios</button>';
  cont.insertBefore(card, cont.children[2] || null);

  $("re-pdf").addEventListener("click", ()=>{
    const dia = $("rp-fecha").value || hoyISO();
    imprimirReporte(reporteEjecutivoHTML(dia, $("re-obs").value.trim()));
    auditar("reportes", "Reporte ejecutivo en PDF", {comentario:dia});
    guardar();
    snack("Se abrió el diálogo de impresión: elija «Guardar como PDF».", "ok");
  });

  $("re-xls").addEventListener("click", ()=>{
    const dia = $("rp-fecha").value || hoyISO();
    descargarBlob("reporte_ejecutivo_" + dia + ".xlsx", libroDelDia(dia));
    auditar("reportes", "Reporte ejecutivo en Excel", {comentario:dia});
    guardar();
    snack("Excel generado.", "ok");
  });

  $("re-doc").addEventListener("click", ()=>{
    const dia = $("rp-fecha").value || hoyISO();
    descargarBlob("reporte_ejecutivo_" + dia + ".docx", crearDOCX(bloquesEjecutivos(dia, $("re-obs").value.trim())));
    auditar("reportes", "Reporte ejecutivo en Word", {comentario:dia});
    guardar();
    snack("Documento Word generado.", "ok");
  });

  $("re-enviar").addEventListener("click", async ()=>{
    const dia = $("rp-fecha").value || hoyISO();
    const dest = db.config.correos || [];
    if(!dest.length) return snack("Configure los destinatarios en Configuración.", "err");
    const blob = libroDelDia(dia);
    const nombre = "reporte_almacen_" + dia + ".xlsx";
    const asunto = "Reporte diario de almacén " + soloFecha(dia) +
      (db.config.proyecto ? " · " + db.config.proyecto : "");
    const cuerpo = "Adjunto el reporte diario del " + soloFecha(dia) + ".\n\n" +
      "Generado por " + usuarioActual().nombre + ".\n" +
      "Destinatarios: " + dest.map(x => x.nombre).join(", ");
    const ok = await compartirArchivo(nombre, blob, asunto, cuerpo);
    if(!ok) descargarBlob(nombre, blob);
    const url = "mailto:" + dest.map(x => x.correo).join(",") +
      "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(cuerpo);
    setTimeout(()=>{ location.href = url; }, 600);
    auditar("reportes", "Reporte enviado a destinatarios",
      {comentario:dest.map(x => x.correo).join(", ")});
    guardar();
    snack("Archivo listo y correo preparado. Adjúntelo antes de enviar.", "ok");
  });
})();

/* Recordatorio a la hora configurada (sección 14) */
function revisarHoraReporte(){
  if(!sesion || !db.config.horaReporte) return;
  const ahoraHM = new Date().toTimeString().slice(0,5);
  if(ahoraHM !== db.config.horaReporte) return;
  if(db.config.ultimoAviso === hoyISO()) return;
  db.config.ultimoAviso = hoyISO();
  guardar();
  notificar({roles:["admin","obra","jefatura"], titulo:"Reporte diario pendiente de envío",
    cuerpo:"Son las " + db.config.horaReporte + ". Genere y envíe el reporte del día a " +
      (db.config.correos || []).map(c => c.nombre).join(", "), refTipo:"reporte"});
  snack("Recordatorio: toca enviar el reporte diario.", "ok");
}
setInterval(revisarHoraReporte, 60000);

/* ---------------------------------------------------------------
   V4.15  Integración con el resto de la aplicación
   --------------------------------------------------------------- */
const refrescarV3 = refrescar;
refrescar = function(destino){
  refrescarV3(destino);
  if(destino === "atencion")   pintarAtencion();
  if(destino === "logistica")  pintarLogistica();
  if(destino === "dashboard")  pintarDashboard();
  if(destino === "analitica")  pintarAnalitica();
  if(destino === "auditoria")  pintarAuditoria();
  if(destino === "config")     pintarConfig();
};

const pintarMasV3 = pintarMas;
pintarMas = function(){
  pintarMasV3();
  const enMenu = MENU.concat(["notificaciones"]);
  const nuevas = ["atencion","logistica","dashboard","analitica","auditoria","config"]
    .filter(k => PANTALLAS[k].perm && puede(PANTALLAS[k].perm) && enMenu.indexOf(k) < 0);
  const desc = {
    atencion:"Revisar stock, preparar y entregar",
    logistica:"Faltantes, cotizaciones y proveedores",
    dashboard:"Tablero gerencial del día",
    analitica:"Consumos, tiempos y tendencias",
    auditoria:"Registro completo de acciones",
    config:"Empresa, logo, destinatarios y hora"
  };
  /* evita que un módulo aparezca dos veces: el listado base ya pudo pintarlo */
  nuevas.forEach(k => {
    const dup = $("mas-modulos").querySelector('[data-ir2="' + k + '"]');
    if(dup) dup.remove();
  });
  const html = nuevas.map(k =>
    '<button class="fila" data-ir3="' + k + '"><span class="mini">' + ico(PANTALLAS[k].icono, 20) + "</span>" +
    '<span class="txt"><b>' + PANTALLAS[k].titulo + "</b><small>" + desc[k] + "</small></span>" +
    '<span class="der">' + ico("flecha", 18) + "</span></button>").join("");
  $("mas-modulos").insertAdjacentHTML("afterbegin", html);
  $$("#mas-modulos [data-ir3]").forEach(b => b.addEventListener("click", ()=> ir(b.dataset.ir3)));
};

/* Accesos directos nuevos en el inicio */
const pintarInicioV3 = pintarInicio;
pintarInicio = function(){
  pintarInicioV3();
  const extra = [];
  if(puede("pedidos.atender")) extra.push({k:"atencion", t:"Atender pedidos", ic:"caja"});
  if(puede("dashboard")) extra.push({k:"dashboard", t:"Dashboard", ic:"grafico"});
  if(puede("compras.ver")) extra.push({k:"logistica", t:"Logística", ic:"carrito"});
  if(!extra.length) return;
  $("ini-accesos").insertAdjacentHTML("afterbegin", extra.map(x =>
    '<button class="metrica" data-ir4="' + x.k + '" style="display:flex;align-items:center;gap:10px;text-align:left">' +
    '<span style="width:38px;height:38px;border-radius:11px;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center;flex:none">' +
    ico(x.ic, 20) + '</span><span style="font-size:13.5px;font-weight:600;line-height:1.25">' + x.t + "</span></button>").join(""));
  $$("#ini-accesos [data-ir4]").forEach(b => b.addEventListener("click", ()=> ir(b.dataset.ir4)));
};

/* Requerimiento: correlativo de 6 dígitos, proyecto y hora (secciones 4 y 5) */
codigoReq = function(){
  db.config.correlativoReq = (db.config.correlativoReq || 0) + 1;
  db.correlativos.REQ = db.config.correlativoReq;
  return "REQ-" + new Date().getFullYear() + "-" + String(db.config.correlativoReq).padStart(6, "0");
};

const registrarRequerimientoV3 = registrarRequerimiento;
registrarRequerimiento = function(){
  const antes = db.requerimientos.length;
  registrarRequerimientoV3();
  if(db.requerimientos.length === antes) return;
  const r = db.requerimientos[0];
  r.proyecto = r.obra || db.config.proyecto || "";
  r.hora = new Date(r.fecha).toTimeString().slice(0,5);
  r.cotizaciones = r.cotizaciones || [];
  r.entregas = r.entregas || [];
  if(r.estado === "solicitado"){ r.estado = "pendiente"; r.historial[0].estado = "pendiente"; }
  auditar("pedidos", "Requerimiento registrado",
    {refId:r.id, antes:"", despues:"pendiente",
     comentario:r.codigo + " · " + r.items.length + " ítem(s) · " + (r.disciplina || r.area || ""),
     fotos:r.items.filter(i => i.foto), archivos:r.pdf ? [r.pdf] : []});
  guardar();
};

/* La plantilla y el lector de Excel también aceptan la columna Código */
COLS_PEDIDO.push({clave:"codigo", alias:["codigo","cod","sku","item id"]});
const importarPedidoV3 = importarPedido;
importarPedido = function(filas){
  const antes = itemsReq.length;
  const res = importarPedidoV3(filas);
  let iCab = -1, col = -1;
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    (filas[i] || []).forEach((c, j)=>{
      const t = sinTildes(c);
      if(["codigo","cod","sku"].indexOf(t) >= 0 && col < 0){ col = j; iCab = i; }
    });
    if(col >= 0) break;
  }
  if(col >= 0){
    let k = antes;
    for(let i = iCab + 1; i < filas.length && k < itemsReq.length; i++){
      const v = (filas[i] || [])[col];
      const desc = itemsReq[k] ? itemsReq[k].desc : "";
      if(!desc) continue;
      if(v != null && String(v).trim()){ itemsReq[k].codigo = String(v).trim(); }
      k++;
    }
    pintarItemsReq();
  }
  return res;
};

/* Prioridades de 4 niveles (sección 4) */
(function ampliarPrioridades(){
  const sel = $("mr-prioridad");
  if(!sel) return;
  sel.innerHTML = PRIORIDADES.map(p => '<option value="' + p + '"' + (p === "Media" ? " selected" : "") + ">" + p + "</option>").join("");
})();

/* Arranque del módulo */
(async function arranqueV4(){
  const esperar = ()=> new Promise(r => setTimeout(r, 60));
  while(!db) await esperar();
  normalizarV4();
  guardar();
  detectarIP();
  $("cf-logo-ico").innerHTML = ico("camara", 20);
  initFoto("cf-logo");
  const b = document.querySelector('[data-foto="cf-logo"]');
  if(b) b.addEventListener("click", ()=> $("cf-logo").click());
  $$('[data-seg="logistica"]').forEach(seg => seg.addEventListener("click", e => {
    if(e.target.dataset.pan){ segmento("logistica", e.target.dataset.pan); pintarLogistica(); }
  }));
})();


/* =====================================================================
   ================  AMPLIACIÓN v5  ====================================
   Consolidado enlazado con los requerimientos y con las guías:
   los pedidos se suman al consolidado, las compras lo marcan como
   comprado y la guía verificada lo marca como completado (verde).
   ===================================================================== */

/* ---------------------------------------------------------------
   V5.1  El consolidado se alimenta de los requerimientos
   --------------------------------------------------------------- */
function claveConsolidado(desc, codigo){
  return sinTildes(codigo || "") + "|" + sinTildes(desc || "");
}

function buscarEnConsolidado(desc, codigo){
  const items = db.consolidado.items;
  if(codigo){
    const c = items.find(x => x.codigo && sinTildes(x.codigo) === sinTildes(codigo));
    if(c) return c;
  }
  return items.find(x => sinTildes(x.desc) === sinTildes(desc)) || null;
}

/* Suma los ítems de un requerimiento al consolidado (sección: "también
   se van a tener que agregar los requerimientos"). */
function agregarAlConsolidado(r){
  let nuevos = 0, sumados = 0;
  r.items.forEach(it => {
    let c = buscarEnConsolidado(it.desc, it.codigo);
    if(!c){
      c = {id:uid(), codigo:it.codigo || "", desc:it.desc, unidad:it.unidad || "und",
           categoria:r.disciplina || r.area || "General",
           requerido:0, comprado:0, entregado:0, origen:[], creado:ahora()};
      db.consolidado.items.push(c);
      nuevos++;
    }
    c.requerido = +(c.requerido + it.cant).toFixed(2);
    if(!Array.isArray(c.origen)) c.origen = [];
    if(c.origen.indexOf(r.codigo) < 0) c.origen.push(r.codigo);
    sumados++;
  });
  if(!db.consolidado.cargado) db.consolidado.cargado = ahora();
  if(!db.consolidado.archivo) db.consolidado.archivo = "Consolidado de obra";
  return {nuevos, sumados};
}

/* Al registrar un requerimiento se agrega automáticamente al consolidado */
const registrarRequerimientoV4 = registrarRequerimiento;
registrarRequerimiento = function(){
  const antes = db.requerimientos.length;
  registrarRequerimientoV4();
  if(db.requerimientos.length === antes) return;
  const r = db.requerimientos[0];
  const res = agregarAlConsolidado(r);
  auditar("consolidado", "Requerimiento agregado al consolidado",
    {refId:r.id, comentario:r.codigo + " · " + res.sumados + " ítem(s), " + res.nuevos + " nuevo(s)"});
  guardar();
  if(res.sumados) snack(res.sumados + " ítem(s) sumados al consolidado.", "ok");
};

/* ---------------------------------------------------------------
   V5.2  Estado de cada línea del consolidado
   --------------------------------------------------------------- */
function estadoConsolidadoV5(it){
  const req = it.requerido || 0;
  if(req > 0 && (it.entregado || 0) >= req) return "completado";
  if(req > 0 && (it.comprado || 0) >= req) return "comprado";
  if((it.comprado || 0) > 0 || (it.entregado || 0) > 0) return "parcial";
  return "pendiente";
}
Object.assign(ESTADO_CONS, {
  pendiente:{txt:"Por comprar", chip:"mal"},
  parcial:  {txt:"Parcial",     chip:"alerta"},
  comprado: {txt:"Comprado",    chip:"info"},
  completado:{txt:"Completado", chip:"ok"},
  entregado:{txt:"Completado",  chip:"ok"}
});
estadoConsolidado = estadoConsolidadoV5;

/* ---------------------------------------------------------------
   V5.3  Comparación con la guía (Excel) — sección de verificación
   --------------------------------------------------------------- */
const COLS_GUIA = [
  {clave:"codigo", alias:["codigo","cod","sku","item id","codigo material"]},
  {clave:"desc",   alias:["descripcion","material","item","detalle","producto","articulo","insumo"]},
  {clave:"cant",   alias:["cantidad","cant","qty","atendido","enviado","despachado","recibido"]},
  {clave:"unidad", alias:["unidad","und","um","medida"]}
];

function leerGuia(filas){
  if(!filas.length) throw new Error("El archivo está vacío.");
  let iCab = -1, mapa = {};
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    const prueba = {};
    (filas[i] || []).forEach((celda, c)=>{
      const t = sinTildes(celda);
      COLS_GUIA.forEach(col => { if(col.alias.indexOf(t) >= 0 && prueba[col.clave] === undefined) prueba[col.clave] = c; });
    });
    if(prueba.desc !== undefined || prueba.codigo !== undefined){ iCab = i; mapa = prueba; break; }
  }
  if(iCab < 0) throw new Error('La guía debe tener una columna "Código" o "Material".');
  const dato = (f, k) => mapa[k] === undefined ? "" : String(f[mapa[k]] == null ? "" : f[mapa[k]]).trim();
  const lineas = [];
  for(let i = iCab + 1; i < filas.length; i++){
    const f = filas[i] || [];
    const desc = dato(f, "desc"), cod = dato(f, "codigo");
    if(!desc && !cod) continue;
    lineas.push({codigo:cod, desc:desc || cod, unidad:dato(f, "unidad") || "und", cant:num(dato(f, "cant")) || 0});
  }
  if(!lineas.length) throw new Error("La guía no tiene filas con materiales.");
  return lineas;
}

/* accion: "comprado" (la compra se hizo) | "completado" (llegó a obra) */
function compararConsolidado(lineas, accion){
  const res = {coincidencias:[], sinCoincidir:[], marcados:0};
  lineas.forEach(l => {
    const c = buscarEnConsolidado(l.desc, l.codigo);
    if(!c){ res.sinCoincidir.push(l); return; }
    const cant = l.cant > 0 ? l.cant : Math.max(0, (c.requerido || 0) - (c[accion === "completado" ? "entregado" : "comprado"] || 0));
    if(accion === "completado"){
      c.entregado = +((c.entregado || 0) + cant).toFixed(2);
      if((c.comprado || 0) < c.entregado) c.comprado = c.entregado;
    }else{
      c.comprado = +((c.comprado || 0) + cant).toFixed(2);
    }
    c.verificado = ahora();
    res.coincidencias.push({linea:l, item:c, cant, estado:estadoConsolidado(c)});
    res.marcados++;
  });
  return res;
}

/* ---------------------------------------------------------------
   V5.4  Pantalla de guías y verificación
   --------------------------------------------------------------- */
crearPantalla("guias",
  '<div class="card acento" style="font-size:13px">' +
  'Suba la guía en PDF como evidencia y su detalle en Excel. El sistema lo compara con el consolidado ' +
  'y marca en verde lo que ya llegó completo.</div>' +

  '<div class="card">' +
  '<div class="campo"><label>Requerimiento relacionado (opcional)</label><select id="gv-req"></select></div>' +
  '<div class="campo"><label>N° de guía de remisión</label><input type="text" id="gv-numero" placeholder="T001-00234"></div>' +
  '<div class="campo"><label>Guía en PDF</label>' +
  '<button class="foto-btn" data-archivo="gv-pdf"><span id="gv-pdf-ico"></span>Adjuntar PDF</button>' +
  '<input type="file" id="gv-pdf" accept="application/pdf" hidden><div class="prev" id="gv-pdf-prev"></div></div>' +
  '<div class="campo"><label>Foto de la llegada a obra</label>' +
  '<button class="foto-btn" data-foto="gv-foto"><span id="gv-foto-ico"></span>Tomar foto</button>' +
  '<input type="file" id="gv-foto" accept="image/*" capture="environment" hidden><div class="prev" id="gv-foto-prev"></div></div>' +
  '<div class="campo"><label>Detalle de la guía en Excel</label>' +
  '<div class="btns"><button class="btn btn-cont" id="gv-plantilla">Plantilla</button>' +
  '<button class="btn btn-ton" id="gv-subir">Subir Excel</button></div>' +
  '<input type="file" id="gv-archivo" accept=".xlsx,.csv" hidden>' +
  '<div class="ayuda" id="gv-info" style="margin:9px 0 0"></div></div>' +
  '<div class="campo"><label>¿Qué se registra?</label><select id="gv-accion">' +
  '<option value="comprado">Compra realizada (marca como comprado)</option>' +
  '<option value="completado">Llegó a obra conforme (marca como completado)</option>' +
  '</select></div>' +
  '<button class="btn btn-pri" id="gv-verificar">Comparar con el consolidado</button>' +
  "</div>" +
  '<div id="gv-resultado"></div>' +
  '<div class="sech">Guías registradas</div><div id="gv-lista"></div>');

Object.assign(PANTALLAS, {
  guias:{titulo:"Guías y verificación", icono:"pdf", perm:"guias"}
});

let guiaLineas = null;

function pintarGuias(){
  const sel = $("gv-req");
  const abiertos = db.requerimientos.filter(r => CERRADOS.indexOf(r.estado) < 0);
  sel.innerHTML = '<option value="">— Sin requerimiento asociado —</option>' +
    abiertos.map(r => '<option value="' + r.id + '">' + esc(r.codigo + " · " + (r.disciplina || r.area || "")) + "</option>").join("");

  const guias = db.guias || [];
  $("gv-lista").innerHTML = guias.length
    ? guias.map(g => '<button class="fila" data-guia="' + g.id + '">' +
        '<span class="mini ' + (g.accion === "completado" ? "ok" : "info") + '">' + ico("pdf", 20) + "</span>" +
        '<span class="txt"><b>' + esc(g.numero || "Guía sin número") + "</b><small>" +
        (g.req ? esc(g.req) + " · " : "") + g.marcados + " ítem(s) · " + esc(g.usuario) + "</small></span>" +
        '<span class="der"><span class="chip ' + (g.accion === "completado" ? "ok" : "info") + '">' +
        (g.accion === "completado" ? "Verificada" : "Comprada") + "</span><small>" + hace(g.fecha) + "</small></span></button>").join("")
    : '<div class="vacio">' + ico("pdf", 40) + "Todavía no se han registrado guías.</div>";
  $$("#gv-lista [data-guia]").forEach(b => b.addEventListener("click", ()=> detalleGuia(b.dataset.guia)));
}

function detalleGuia(id){
  const g = (db.guias || []).find(x => x.id === id);
  if(!g) return;
  let html = '<div class="dato"><span>N° de guía</span><b>' + esc(g.numero || "—") + "</b></div>" +
    '<div class="dato"><span>Registrada</span><b>' + fecha(g.fecha) + "</b></div>" +
    '<div class="dato"><span>Por</span><b>' + esc(g.usuario) + "</b></div>" +
    '<div class="dato"><span>Acción</span><b>' + (g.accion === "completado" ? "Verificación de llegada" : "Registro de compra") + "</b></div>" +
    '<div class="dato"><span>Ítems marcados</span><b>' + g.marcados + "</b></div>" +
    (g.req ? '<div class="dato"><span>Requerimiento</span><b>' + esc(g.req) + "</b></div>" : "") +
    (g.sinCoincidir && g.sinCoincidir.length
      ? '<div class="sech" style="margin:14px 0 6px">No estaban en el consolidado</div>' +
        g.sinCoincidir.map(x => '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(x) + "</b></span></div>").join("")
      : "");
  if(g.foto) html += '<img src="' + g.foto + '" data-zoom="' + g.foto +
    '" style="width:100%;height:160px;object-fit:cover;border-radius:12px;margin-top:12px" alt="llegada">';
  const acc = [];
  if(g.pdf) acc.push({txt:"Ver PDF", clase:"btn-pri", fn:()=> verPDF(g.pdf)});
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja("Guía " + (g.numero || ""), html, acc);
}

$("gv-plantilla").addEventListener("click", ()=>{
  const filas = [["Código","Material","Unidad","Cantidad"],
    ["MAT-0001","Perno hexagonal 5/8 x 3","und",24],
    ["","Cemento portland","bls",30],
    ["","","",""]];
  descargarBlob("plantilla_guia.xlsx", crearXLSX([{nombre:"Guía", filas, estilos:[1]}]));
  snack("Plantilla de guía descargada.", "ok");
});

$("gv-subir").addEventListener("click", ()=> $("gv-archivo").click());

$("gv-archivo").addEventListener("change", async ()=>{
  const archivo = $("gv-archivo").files[0];
  if(!archivo) return;
  $("gv-info").className = "ayuda";
  $("gv-info").textContent = "Leyendo " + archivo.name + "…";
  try{
    guiaLineas = leerGuia(await leerTabla(archivo));
    $("gv-info").innerHTML = "<b>" + guiaLineas.length + "</b> línea(s) leídas de <b>" + esc(archivo.name) +
      "</b>. Pulse <b>Comparar con el consolidado</b>.";
  }catch(e){
    guiaLineas = null;
    $("gv-info").className = "ayuda err";
    $("gv-info").textContent = e.message || "No se pudo leer el archivo.";
  }
  $("gv-archivo").value = "";
});

$("gv-verificar").addEventListener("click", ()=>{
  if(!guiaLineas) return snack("Suba primero el Excel de la guía.", "err");
  if(!db.consolidado.items.length) return snack("Todavía no hay consolidado con el que comparar.", "err");
  const accion = $("gv-accion").value;
  const res = compararConsolidado(guiaLineas, accion);
  const r = db.requerimientos.find(x => x.id === $("gv-req").value);

  if(!Array.isArray(db.guias)) db.guias = [];
  const g = {
    id:uid(), fecha:ahora(), numero:$("gv-numero").value.trim(),
    pdf:adjuntos["gv-pdf"] || null, foto:fotos["gv-foto"] || null,
    accion, marcados:res.marcados, sinCoincidir:res.sinCoincidir.map(x => x.desc),
    req:r ? r.codigo : "", reqId:r ? r.id : null, usuario:usuarioActual().nombre
  };
  db.guias.unshift(g);

  if(r){
    if(!r.despacho) r.despacho = {guia:g.numero, transporte:"", pdf:g.pdf, foto:g.foto,
      usuario:g.usuario, fecha:g.fecha};
    const antes = r.estado;
    if(accion === "completado"){
      historia(r, "material_recibido", "Guía " + g.numero + " verificada en obra");
      notificar({usuarios:[r.solicitanteId], roles:["obra","almacenero","admin"],
        titulo:"Material recibido en obra: " + r.codigo,
        cuerpo:"Guía " + g.numero + " verificada. " + res.marcados + " ítem(s) marcados como completados.",
        refTipo:"requerimiento", refId:r.id});
    }else{
      historia(r, "compra_proceso", "Guía " + g.numero + " · compra registrada");
    }
    auditar("guias", accion === "completado" ? "Guía verificada en obra" : "Compra registrada por guía",
      {refId:r.id, antes, despues:r.estado, comentario:g.numero + " · " + res.marcados + " ítem(s)",
       archivos:g.pdf ? [g.pdf] : [], fotos:g.foto ? [1] : []});
  }else{
    auditar("guias", accion === "completado" ? "Guía verificada" : "Compra registrada por guía",
      {comentario:(g.numero || "sin número") + " · " + res.marcados + " ítem(s)"});
  }

  guardar();

  const a = avanceConsolidado();
  $("gv-resultado").innerHTML =
    '<div class="card"><div class="sech" style="margin:0 0 10px">Resultado de la comparación</div>' +
    '<div class="dato"><span>Líneas en la guía</span><b>' + guiaLineas.length + "</b></div>" +
    '<div class="dato"><span>Coincidieron con el consolidado</span><b>' + res.marcados + "</b></div>" +
    '<div class="dato"><span>No estaban en el consolidado</span><b>' + res.sinCoincidir.length + "</b></div>" +
    '<div class="dato"><span>Avance de obra</span><b>' + a.avance + "%</b></div></div>" +
    (res.coincidencias.length
      ? '<div class="sech">Marcados</div>' + res.coincidencias.map(c =>
          '<div class="fila"><span class="mini ' + ESTADO_CONS[c.estado].chip + '">' + ico("check", 20) + "</span>" +
          '<span class="txt"><b>' + esc(c.item.desc) + "</b><small>+" + c.cant + " " + esc(c.item.unidad) +
          " · " + c.item.comprado + "/" + c.item.requerido + " comprado · " + c.item.entregado + " en obra</small></span>" +
          '<span class="der"><span class="chip ' + ESTADO_CONS[c.estado].chip + '">' + ESTADO_CONS[c.estado].txt + "</span></span></div>").join("")
      : "") +
    (res.sinCoincidir.length
      ? '<div class="sech">Sin coincidencia</div>' + res.sinCoincidir.map(l =>
          '<div class="fila"><span class="mini mal">' + ico("alerta", 20) + "</span>" +
          '<span class="txt"><b>' + esc(l.desc) + "</b><small>" + (l.codigo ? esc(l.codigo) + " · " : "") +
          l.cant + " " + esc(l.unidad) + " — no está en el consolidado</small></span>" +
          '<button class="btn-mini btn-cont" data-agregar-cons="' + esc(l.desc) + '">Agregar</button></div>').join("")
      : "");

  $$("[data-agregar-cons]").forEach(b => b.addEventListener("click", ()=>{
    const l = guiaLineas.find(x => x.desc === b.dataset.agregarCons);
    if(!l) return;
    db.consolidado.items.push({id:uid(), codigo:l.codigo || "", desc:l.desc, unidad:l.unidad,
      categoria:"Agregado por guía", requerido:l.cant, comprado:l.cant,
      entregado:accion === "completado" ? l.cant : 0, origen:[g.numero || "guía"], creado:ahora()});
    if(guardar()){ snack(l.desc + " agregado al consolidado.", "ok"); b.closest(".fila").remove(); }
  }));

  guiaLineas = null;
  ["gv-numero"].forEach(i => $(i).value = "");
  limpiarArchivo("gv-pdf"); limpiarFoto("gv-foto");
  $("gv-info").textContent = "";
  snack(res.marcados + " ítem(s) marcados en el consolidado.", "ok");
  pintarGuias();
});

/* ---------------------------------------------------------------
   V5.5  Consolidado: exportación con los completados en verde
   --------------------------------------------------------------- */
exportarConsolidado = function(){
  const a = avanceConsolidado();
  const cab = ["Código","Material","Categoría","Unidad","Requerido","Comprado","Entregado",
               "Pendiente","Estado","Avance %","Origen","Verificado"];
  const filas = [cab], estilos = [1];
  db.consolidado.items.forEach(it => {
    const est = estadoConsolidado(it);
    filas.push([it.codigo || "", it.desc, it.categoria, it.unidad, it.requerido, it.comprado, it.entregado,
      Math.max(0, +((it.requerido || 0) - (it.comprado || 0)).toFixed(2)),
      ESTADO_CONS[est].txt,
      it.requerido > 0 ? Math.min(100, Math.round((it.entregado || 0) / it.requerido * 100)) : 0,
      (it.origen || []).join(", "), it.verificado ? soloFecha(it.verificado) : ""]);
    estilos.push(est === "completado" ? 2 : 0);
  });
  filas.push([], ["RESUMEN"], ["Total materiales", a.total], ["Comprados", a.comprados],
    ["Pendientes", a.pendientes], ["Completados", a.entregados], ["Avance %", a.avance]);
  while(estilos.length < filas.length) estilos.push(0);

  descargarBlob("consolidado_" + hoyISO() + ".xlsx",
    crearXLSX([{nombre:"Consolidado", filas, estilos}]));
  auditar("consolidado", "Consolidado exportado",
    {comentario:a.total + " materiales · " + a.entregados + " completados · " + a.avance + "%"});
  guardar();
  snack("Consolidado exportado con los completados en verde.", "ok");
};

/* El resumen cuenta los completados con la nueva regla */
avanceConsolidado = function(){
  const it = db.consolidado.items;
  const req = it.reduce((s,x)=> s + (x.requerido || 0), 0);
  const ent = it.reduce((s,x)=> s + Math.min(x.entregado || 0, x.requerido || x.entregado || 0), 0);
  return {
    total:it.length,
    comprados:it.filter(x => ["comprado","completado"].indexOf(estadoConsolidado(x)) >= 0).length,
    pendientes:it.filter(x => estadoConsolidado(x) === "pendiente").length,
    entregados:it.filter(x => estadoConsolidado(x) === "completado").length,
    avance: req > 0 ? Math.round(ent / req * 100) : 0
  };
};

/* ---------------------------------------------------------------
   V5.6  Compras: cada artículo con su foto
   --------------------------------------------------------------- */
crearPantalla("articulos",
  '<div class="card"><div class="campo"><label>Requerimiento en compra</label><select id="ar-req"></select></div>' +
  '<p class="ayuda" style="margin:0">Registre cada artículo comprado con su foto. Al terminar, suba la guía en <b>Guías y verificación</b>.</p></div>' +
  '<div id="ar-lista"></div>');
Object.assign(PANTALLAS, {articulos:{titulo:"Artículos comprados", icono:"carrito", perm:"compras"}});

function pintarArticulos(){
  const sel = $("ar-req");
  const lista = db.requerimientos.filter(r =>
    ["compra_aprobada","compra_proceso","aprobado","en_compra","enviado_logistica","consolidado"].indexOf(r.estado) >= 0);
  const previo = sel.value;
  sel.innerHTML = lista.length
    ? lista.map(r => '<option value="' + r.id + '">' + esc(r.codigo + " · " + (r.disciplina || r.area || "")) + "</option>").join("")
    : '<option value="">No hay requerimientos en compra</option>';
  if(previo && sel.querySelector('[value="' + previo + '"]')) sel.value = previo;

  const r = db.requerimientos.find(x => x.id === sel.value);
  if(!r){ $("ar-lista").innerHTML = '<div class="vacio">' + ico("carrito", 40) + "Seleccione un requerimiento.</div>"; return; }

  $("ar-lista").innerHTML = r.items.map((it, i) =>
    '<div class="fila"><span class="mini ' + (it.comprado ? "ok" : "") + '">' +
    (it.fotoCompra ? '<img src="' + it.fotoCompra + '" data-zoom="' + it.fotoCompra + '" alt="">' : ico("caja", 20)) + "</span>" +
    '<span class="txt"><b>' + esc(it.desc) + "</b><small>" + (it.codigo ? esc(it.codigo) + " · " : "") +
    it.cant + " " + esc(it.unidad) + (it.comprado ? " · comprado " + it.comprado : "") + "</small></span>" +
    '<button class="btn-mini ' + (it.fotoCompra ? "btn-cont" : "btn-ton") + '" data-art="' + i + '">' +
    (it.fotoCompra ? "Cambiar" : "Registrar") + "</button></div>").join("") +
    '<button class="btn btn-pri" id="ar-terminar" style="margin-top:12px">Marcar compra terminada</button>';

  $$("#ar-lista [data-art]").forEach(b => b.addEventListener("click", ()=> registrarArticulo(r.id, +b.dataset.art)));
  $("ar-terminar").addEventListener("click", ()=>{
    const faltan = r.items.filter(it => !it.comprado).length;
    if(faltan) return snack("Faltan " + faltan + " artículo(s) por registrar.", "err");
    const antes = r.estado;
    historia(r, "compra_proceso", "Todos los artículos comprados");
    auditar("compras", "Compra de artículos terminada", {refId:r.id, antes, despues:r.estado,
      comentario:r.items.length + " artículo(s) con foto"});
    notificar({roles:["jefatura","obra","almacenero","admin"], titulo:"Compra lista: " + r.codigo,
      cuerpo:"Los " + r.items.length + " artículos fueron comprados. Falta subir la guía de remisión.",
      refTipo:"requerimiento", refId:r.id});
    if(guardar()){ snack("Compra marcada como terminada.", "ok"); ir("guias"); }
  });
}

$("ar-req").addEventListener("change", pintarArticulos);

function registrarArticulo(reqId, i){
  const r = db.requerimientos.find(x => x.id === reqId);
  const it = r.items[i];
  hoja("Artículo comprado",
    '<div class="dato"><span>Material</span><b>' + esc(it.desc) + "</b></div>" +
    '<div class="dato"><span>Solicitado</span><b>' + it.cant + " " + esc(it.unidad) + "</b></div>" +
    '<div class="campo" style="margin-top:12px"><label>Cantidad comprada</label>' +
    '<input type="number" id="ar-cant" min="0" step="0.01" value="' + (it.comprado || it.cant) + '"></div>' +
    '<div class="campo"><label>Proveedor / factura</label><input type="text" id="ar-prov" value="' + esc(it.proveedor || "") + '"></div>' +
    '<div class="campo"><label>Foto del artículo</label>' +
    '<button class="foto-btn" id="ar-foto-btn"><span>' + ico("camara", 20) + "</span>Tomar foto</button>" +
    '<div class="prev" id="ar-foto-prev">' +
    (it.fotoCompra ? '<img src="' + it.fotoCompra + '" class="thumb" alt=""><span class="ayuda" style="margin:0">Foto actual</span>' : "") +
    "</div></div>",
    [{txt:"Cancelar", clase:"btn-cont"},
     {txt:"Guardar artículo", clase:"btn-pri", fn:()=>{
        it.comprado = num(($("ar-cant") || {}).value) || it.cant;
        it.proveedor = ($("ar-prov") || {}).value || "";
        if(fotos["ar-foto"]) it.fotoCompra = fotos["ar-foto"];
        const c = buscarEnConsolidado(it.desc, it.codigo);
        if(c){ c.comprado = +((c.comprado || 0) + it.comprado).toFixed(2); }
        auditar("compras", "Artículo comprado registrado", {refId:r.id,
          comentario:it.desc + " · " + it.comprado + " " + it.unidad + (it.fotoCompra ? " · con foto" : "")});
        limpiarFoto("ar-foto");
        if(guardar()){ snack("Artículo registrado.", "ok"); pintarArticulos(); }
     }}]);

  setTimeout(()=>{
    const b = $("ar-foto-btn");
    if(!b) return;
    let inp = $("ar-foto");
    if(!inp){
      inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.id = "ar-foto"; inp.hidden = true;
      document.body.appendChild(inp);
      initFoto("ar-foto");
    }
    b.addEventListener("click", ()=> inp.click());
  }, 80);
}

/* ---------------------------------------------------------------
   V5.7  Reporte diario exclusivo del Administrador General
   --------------------------------------------------------------- */
(function botonReporteAdmin(){
  const cont = $("scr-dashboard");
  if(!cont || $("dg-reporte")) return;
  const card = document.createElement("div");
  card.className = "card acento";
  card.id = "dg-reporte";
  card.innerHTML =
    '<div style="font-weight:700;font-size:15px;margin-bottom:3px">Reporte diario general</div>' +
    '<p class="ayuda" style="margin:0 0 11px">Informe completo de toda la obra. Lo genera la Administradora de Obra; ' +
    'el Administrador de la aplicación también puede consultarlo.</p>' +
    '<button class="btn btn-pri" id="dg-ver">Ver el reporte del día</button>' +
    '<div class="btns" style="margin-top:10px">' +
    '<button class="btn btn-cont btn-mini" id="dg-pdf">PDF</button>' +
    '<button class="btn btn-cont btn-mini" id="dg-xls">Excel</button>' +
    '<button class="btn btn-cont btn-mini" id="dg-doc">Word</button></div>';
  cont.insertBefore(card, cont.firstChild);

  /* El reporte diario es de la Administradora de Obra; el Administrador
     de la aplicación lo ve también por tener acceso total. */
  const PUEDE_REPORTE = ["admin"];
  const soloAdmin = ()=>{
    if(PUEDE_REPORTE.indexOf(rolEfectivo()) < 0){
      snack("Solo el Administrador de la aplicación accede a este reporte.", "err");
      return false;
    }
    return true;
  };

  $("dg-ver").addEventListener("click", ()=>{
    if(!soloAdmin()) return;
    const dia = hoyISO();
    const d = datosEjecutivos(dia);
    const a = db.consolidado.items.length ? avanceConsolidado() : null;
    const li = (k,v) => '<div class="dato"><span>' + k + "</span><b>" + v + "</b></div>";
    hoja("Reporte del " + soloFecha(dia),
      li("Requerimientos recibidos", d.recibidos.length) + li("Atendidos", d.atendidos.length) +
      li("Pendientes", d.pendientes.length) + li("Compras del día", d.compras.length) +
      li("Entregas de material", d.entregados.length) + li("Herramientas prestadas", d.prestamos.length) +
      li("Devoluciones", d.devoluciones.length) + li("Incidencias", d.incidencias.length) +
      (a ? li("Avance del consolidado", a.avance + "%") + li("Materiales completados", a.entregados + " de " + a.total) : "") +
      '<div class="sech" style="margin:16px 0 6px">Por disciplina</div>' +
      (()=>{
        const por = {};
        d.recibidos.forEach(r => { const k = r.disciplina || r.area || "Sin área"; por[k] = (por[k] || 0) + 1; });
        const ks = Object.keys(por);
        return ks.length ? ks.map(k => li(k, por[k])).join("") : '<div class="ayuda" style="margin:0">Sin requerimientos hoy.</div>';
      })() +
      '<div class="sech" style="margin:16px 0 6px">Últimas guías</div>' +
      ((db.guias || []).slice(0,4).map(g => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
        esc(g.numero || "Guía") + "</b><small>" + g.marcados + " ítem(s) · " + esc(g.usuario) + " · " + hace(g.fecha) +
        "</small></span></div>").join("") || '<div class="ayuda" style="margin:0">Sin guías registradas.</div>'),
      [{txt:"Descargar PDF", clase:"btn-pri", fn:()=> $("dg-pdf").click()},
       {txt:"Cerrar", clase:"btn-cont"}]);
    auditar("reportes", "Reporte diario general consultado", {comentario:dia});
    guardar();
  });

  $("dg-pdf").addEventListener("click", ()=>{
    if(!soloAdmin()) return;
    imprimirReporte(reporteEjecutivoHTML(hoyISO(), "Reporte general del Administrador."));
    auditar("reportes", "Reporte diario general en PDF", {comentario:hoyISO()});
    guardar();
  });
  $("dg-xls").addEventListener("click", ()=>{
    if(!soloAdmin()) return;
    descargarBlob("reporte_general_" + hoyISO() + ".xlsx", libroDelDia(hoyISO()));
    auditar("reportes", "Reporte diario general en Excel", {comentario:hoyISO()});
    guardar();
  });
  $("dg-doc").addEventListener("click", ()=>{
    if(!soloAdmin()) return;
    descargarBlob("reporte_general_" + hoyISO() + ".docx",
      crearDOCX(bloquesEjecutivos(hoyISO(), "Reporte general del Administrador.")));
    auditar("reportes", "Reporte diario general en Word", {comentario:hoyISO()});
    guardar();
  });
})();

/* ---------------------------------------------------------------
   V5.8  Inicio: la actividad reciente pasa a ser un botón
   --------------------------------------------------------------- */
const pintarInicioV4 = pintarInicio;
pintarInicio = function(){
  pintarInicioV4();
  const cont = $("ini-actividad");
  if(!cont) return;
  const n = db.historial.length;
  cont.innerHTML =
    '<button class="fila" id="ini-ver-actividad"><span class="mini">' + ico("reloj", 20) + "</span>" +
    '<span class="txt"><b>Actividad reciente</b><small>' +
    (n ? n + " registros · último " + hace(db.historial[0].fecha) : "Sin movimientos todavía") + "</small></span>" +
    '<span class="der">' + ico("flecha", 18) + "</span></button>";
  $("ini-ver-actividad").addEventListener("click", ()=> ir("historial"));
  const titulo = cont.previousElementSibling;
  if(titulo && titulo.classList.contains("sech")) titulo.innerHTML = "Actividad";
  /* el reporte diario general es de la Administradora de Obra (y del Administrador de la app) */
  const tarjeta = $("dg-reporte");
  if(tarjeta){ const uu = usuarioActual(); tarjeta.classList.toggle("oculto", !esCuentaAdmin()); }
};

/* ---------------------------------------------------------------
   V5.9  Integración
   --------------------------------------------------------------- */
const refrescarV4 = refrescar;
refrescar = function(destino){
  refrescarV4(destino);
  if(destino === "guias")     pintarGuias();
  if(destino === "articulos") pintarArticulos();
  if(destino === "dashboard"){
    const c = $("dg-reporte");
    if(c){ const u = usuarioActual(); c.classList.toggle("oculto", !esCuentaAdmin()); }
  }
};

const pintarMasV4 = pintarMas;
pintarMas = function(){
  pintarMasV4();
  const desc = {guias:"Subir guía PDF y verificar con el consolidado",
                articulos:"Registrar cada artículo comprado con foto"};
  const nuevas = ["guias","articulos"].filter(k => puede(PANTALLAS[k].perm));
  nuevas.forEach(k => {
    const dup = $("mas-modulos").querySelector('[data-ir2="' + k + '"],[data-ir3="' + k + '"]');
    if(dup) dup.remove();
  });
  $("mas-modulos").insertAdjacentHTML("afterbegin", nuevas.map(k =>
    '<button class="fila" data-ir5="' + k + '"><span class="mini">' + ico(PANTALLAS[k].icono, 20) + "</span>" +
    '<span class="txt"><b>' + PANTALLAS[k].titulo + "</b><small>" + desc[k] + "</small></span>" +
    '<span class="der">' + ico("flecha", 18) + "</span></button>").join(""));
  $$("#mas-modulos [data-ir5]").forEach(b => b.addEventListener("click", ()=> ir(b.dataset.ir5)));
};

(function arranqueV5(){
  if(!Array.isArray(db.guias)) db.guias = [];
  db.consolidado.items.forEach(it => { if(!Array.isArray(it.origen)) it.origen = []; });
  guardar();
  initArchivo("gv-pdf");
  initFoto("gv-foto");
  $("gv-pdf-ico").innerHTML = ico("pdf", 20);
  $("gv-foto-ico").innerHTML = ico("camara", 20);
  const bp = document.querySelector('[data-archivo="gv-pdf"]');
  if(bp) bp.addEventListener("click", ()=> $("gv-pdf").click());
  const bf = document.querySelector('[data-foto="gv-foto"]');
  if(bf) bf.addEventListener("click", ()=> $("gv-foto").click());
})();


/* =====================================================================
   ================  AMPLIACIÓN v6  ====================================
   El almacenero sube la guía y el sistema la verifica dos veces:
   contra lo que se pidió en el requerimiento (qué llegó, qué falta,
   qué vino de más) y contra el consolidado de obra (completados).
   ===================================================================== */

function buscarItemReq(r, desc, codigo){
  if(codigo){
    const c = r.items.find(i => i.codigo && sinTildes(i.codigo) === sinTildes(codigo));
    if(c) return c;
  }
  return r.items.find(i => sinTildes(i.desc) === sinTildes(desc)) || null;
}

/* Compara las líneas de la guía contra los ítems solicitados */
function compararRequerimiento(r, lineas){
  const usados = new Set();
  const noSolicitados = [];

  lineas.forEach(l => {
    const it = buscarItemReq(r, l.desc, l.codigo);
    if(!it){ noSolicitados.push(l); return; }
    const cant = l.cant > 0 ? l.cant : Math.max(0, it.cant - (it.recibido || 0));
    it.recibido = +((it.recibido || 0) + cant).toFixed(2);
    it.verificado = ahora();
    usados.add(it);
  });

  const detalle = r.items.map(it => {
    const rec = it.recibido || 0;
    let estado, chip;
    if(rec === 0){ estado = "Pendiente"; chip = "mal"; }
    else if(rec < it.cant){ estado = "Falta " + +(it.cant - rec).toFixed(2) + " " + it.unidad; chip = "alerta"; }
    else if(rec > it.cant){ estado = "Excedente " + +(rec - it.cant).toFixed(2) + " " + it.unidad; chip = "info"; }
    else { estado = "Conforme"; chip = "ok"; }
    return {item:it, solicitado:it.cant, recibido:rec, estado, chip, enGuia:usados.has(it)};
  });

  const conformes = detalle.filter(d => d.recibido >= d.item.cant).length;
  return {
    detalle, noSolicitados, conformes,
    total:r.items.length,
    completo: conformes === r.items.length,
    parcial: conformes > 0 && conformes < r.items.length
  };
}

function tablaVerificacion(v){
  return v.detalle.map(d =>
    '<div class="fila" style="box-shadow:none;border:1px solid var(--borde)">' +
    '<span class="mini ' + d.chip + '">' + ico(d.chip === "ok" ? "check" : "alerta", 18) + "</span>" +
    '<span class="txt"><b>' + esc(d.item.desc) + "</b><small>solicitado " + d.solicitado + " " +
    esc(d.item.unidad) + " · recibido " + d.recibido + "</small></span>" +
    '<span class="der"><span class="chip ' + d.chip + '">' + esc(d.estado) + "</span></span></div>").join("") +
    (v.noSolicitados.length
      ? '<div class="sech" style="margin:14px 0 6px">Vino en la guía pero no se pidió</div>' +
        v.noSolicitados.map(l => '<div class="fila" style="box-shadow:none;border:1px dashed var(--borde)">' +
          '<span class="mini info">' + ico("alerta", 18) + "</span>" +
          '<span class="txt"><b>' + esc(l.desc) + "</b><small>" + l.cant + " " + esc(l.unidad) + "</small></span>" +
          '<span class="der"><span class="chip info">No solicitado</span></span></div>').join("")
      : "");
}

/* ---------------------------------------------------------------
   V6.1  Nuevo verificador de guías (reemplaza el de v5)
   --------------------------------------------------------------- */
function verificarGuia(){
  if(!guiaLineas) return snack("Suba primero el Excel de la guía.", "err");
  const accion = $("gv-accion").value;
  const r = db.requerimientos.find(x => x.id === $("gv-req").value);

  if(!r && !db.consolidado.items.length)
    return snack("Elija el requerimiento o cargue el consolidado para poder comparar.", "err");

  /* 1) contra el requerimiento solicitado */
  const ver = r ? compararRequerimiento(r, guiaLineas) : null;
  /* 2) contra el consolidado de obra */
  const cons = db.consolidado.items.length ? compararConsolidado(guiaLineas, accion) : {marcados:0, sinCoincidir:[], coincidencias:[]};

  if(!Array.isArray(db.guias)) db.guias = [];
  const g = {
    id:uid(), fecha:ahora(), numero:$("gv-numero").value.trim(),
    pdf:adjuntos["gv-pdf"] || null, foto:fotos["gv-foto"] || null,
    accion, marcados:cons.marcados,
    sinCoincidir:cons.sinCoincidir.map(x => x.desc),
    req:r ? r.codigo : "", reqId:r ? r.id : null,
    usuario:usuarioActual().nombre,
    verificacion: ver ? {
      completo:ver.completo, parcial:ver.parcial, conformes:ver.conformes, total:ver.total,
      lineas:ver.detalle.map(d => ({desc:d.item.desc, solicitado:d.solicitado, recibido:d.recibido, estado:d.estado})),
      noSolicitados:ver.noSolicitados.map(l => l.desc + " (" + l.cant + " " + l.unidad + ")")
    } : null
  };
  db.guias.unshift(g);

  if(r){
    const antes = r.estado;
    r.recepcionGuia = {guia:g.numero, fecha:g.fecha, usuario:g.usuario,
                       completo:ver.completo, conformes:ver.conformes, total:ver.total};

    /* lo que llegó a obra entra al inventario para poder entregarlo */
    let ingresados = 0;
    if(accion === "completado"){
      guiaLineas.forEach(l => {
        const it = buscarItemReq(r, l.desc, l.codigo);
        if(!it || !(l.cant > 0)) return;
        let m = db.materiales.find(x => sinTildes(x.nombre) === sinTildes(it.desc));
        if(!m){
          m = {id:uid(), codigo:codigo("MAT"), nombre:it.desc,
               categoria:r.disciplina || r.area || "General", unidad:it.unidad,
               stock:0, minimo:0, obs:"", foto:it.fotoCompra || it.foto || null, creado:ahora()};
          db.materiales.push(m);
        }
        m.stock = +(m.stock + l.cant).toFixed(2);
        registrarMov({tipo:"ingreso", itemId:m.id, item:m.nombre, cantidad:l.cant, unidad:m.unidad,
          saldo:m.stock, persona:r.oc ? r.oc.proveedor : "", area:"", documento:g.numero,
          obs:"Ingreso por guía " + (g.numero || "") + " de " + r.codigo,
          foto1:null, foto2:g.foto || null});
        ingresados++;
      });
      g.ingresados = ingresados;
    }
    if(!r.despacho) r.despacho = {guia:g.numero, transporte:"", pdf:g.pdf, foto:g.foto,
      usuario:g.usuario, fecha:g.fecha};

    const nota = "Guía " + (g.numero || "") + " · " + ver.conformes + " de " + ver.total + " conformes" +
      (ver.noSolicitados.length ? " · " + ver.noSolicitados.length + " no solicitado(s)" : "");
    historia(r, "material_recibido", nota);

    auditar("guias", ver.completo ? "Guía verificada conforme" : "Guía verificada con diferencias",
      {refId:r.id, antes, despues:"material_recibido", comentario:nota,
       archivos:g.pdf ? [g.pdf] : [], fotos:g.foto ? [1] : []});

    notificar({usuarios:[r.solicitanteId], roles:["obra","jefatura","admin"],
      titulo:(ver.completo ? "Material recibido conforme: " : "Material recibido con diferencias: ") + r.codigo,
      cuerpo:"Guía " + (g.numero || "—") + "\n" + ver.conformes + " de " + ver.total + " ítems conformes." +
        (ver.completo ? "\nListo para entregar al solicitante." :
          "\nFaltan: " + ver.detalle.filter(d => d.recibido < d.item.cant)
            .map(d => d.item.desc + " (" + +(d.item.cant - d.recibido).toFixed(2) + " " + d.item.unidad + ")").join(", ")),
      refTipo:"requerimiento", refId:r.id, prioridad:r.prioridad});
  }else{
    auditar("guias", "Guía verificada contra el consolidado",
      {comentario:(g.numero || "sin número") + " · " + cons.marcados + " ítem(s)"});
  }

  guardar();

  const a = db.consolidado.items.length ? avanceConsolidado() : null;
  $("gv-resultado").innerHTML =
    '<div class="card"><div class="sech" style="margin:0 0 10px">Resultado de la verificación</div>' +
    (r ? '<div class="dato"><span>Requerimiento</span><b>' + esc(r.codigo) + "</b></div>" +
         '<div class="dato"><span>Ítems conformes</span><b>' + ver.conformes + " de " + ver.total + "</b></div>" +
         '<div class="dato"><span>Resultado</span><b><span class="chip ' + (ver.completo ? "ok" : "alerta") + '">' +
         (ver.completo ? "Conforme" : "Con diferencias") + "</span></b></div>" : "") +
    '<div class="dato"><span>Líneas en la guía</span><b>' + guiaLineas.length + "</b></div>" +
    (a ? '<div class="dato"><span>Marcados en el consolidado</span><b>' + cons.marcados + "</b></div>" +
         '<div class="dato"><span>Avance de obra</span><b>' + a.avance + "%</b></div>" : "") +
    "</div>" +
    (r ? '<div class="sech">Contra lo solicitado</div>' + tablaVerificacion(ver) : "") +
    (cons.coincidencias.length
      ? '<div class="sech">Marcados en el consolidado</div>' + cons.coincidencias.map(c =>
          '<div class="fila"><span class="mini ' + ESTADO_CONS[c.estado].chip + '">' + ico("check", 20) + "</span>" +
          '<span class="txt"><b>' + esc(c.item.desc) + "</b><small>+" + c.cant + " " + esc(c.item.unidad) +
          " · " + c.item.entregado + "/" + c.item.requerido + " en obra</small></span>" +
          '<span class="der"><span class="chip ' + ESTADO_CONS[c.estado].chip + '">' + ESTADO_CONS[c.estado].txt +
          "</span></span></div>").join("")
      : "") +
    (cons.sinCoincidir.length
      ? '<div class="sech">No estaban en el consolidado</div>' + cons.sinCoincidir.map(l =>
          '<div class="fila"><span class="mini mal">' + ico("alerta", 20) + "</span>" +
          '<span class="txt"><b>' + esc(l.desc) + "</b><small>" + l.cant + " " + esc(l.unidad) + "</small></span>" +
          '<button class="btn-mini btn-cont" data-agregar6="' + esc(l.desc) + '">Agregar</button></div>').join("")
      : "");

  const pendientesGuia = guiaLineas.slice();
  $$("[data-agregar6]").forEach(b => b.addEventListener("click", ()=>{
    const l = pendientesGuia.find(x => x.desc === b.dataset.agregar6);
    if(!l) return;
    db.consolidado.items.push({id:uid(), codigo:l.codigo || "", desc:l.desc, unidad:l.unidad,
      categoria:"Agregado por guía", requerido:l.cant, comprado:l.cant,
      entregado:accion === "completado" ? l.cant : 0, origen:[g.numero || "guía"], creado:ahora()});
    if(guardar()){ snack(l.desc + " agregado al consolidado.", "ok"); b.closest(".fila").remove(); }
  }));

  guiaLineas = null;
  $("gv-numero").value = "";
  limpiarArchivo("gv-pdf"); limpiarFoto("gv-foto");
  $("gv-info").textContent = "";
  snack(r ? (ver.completo ? "Guía verificada: recepción conforme." : "Guía verificada: hay diferencias.")
          : cons.marcados + " ítem(s) marcados en el consolidado.", ver && !ver.completo ? "err" : "ok");
  pintarGuias();
}

/* Sustituye el manejador anterior del botón sin tocar el resto */
(function reemplazarVerificador(){
  const viejo = $("gv-verificar");
  if(!viejo) return;
  const nuevo = viejo.cloneNode(true);
  viejo.parentNode.replaceChild(nuevo, viejo);
  nuevo.addEventListener("click", verificarGuia);
})();

/* ---------------------------------------------------------------
   V6.2  La ficha de la guía muestra la comparación completa
   --------------------------------------------------------------- */
detalleGuia = function(id){
  const g = (db.guias || []).find(x => x.id === id);
  if(!g) return;
  const v = g.verificacion;
  let html = '<div class="dato"><span>N° de guía</span><b>' + esc(g.numero || "—") + "</b></div>" +
    '<div class="dato"><span>Registrada</span><b>' + fecha(g.fecha) + "</b></div>" +
    '<div class="dato"><span>Subida por</span><b>' + esc(g.usuario) + "</b></div>" +
    (g.req ? '<div class="dato"><span>Requerimiento</span><b>' + esc(g.req) + "</b></div>" : "") +
    '<div class="dato"><span>Marcados en el consolidado</span><b>' + g.marcados + "</b></div>";

  if(v){
    html += '<div class="dato"><span>Verificación</span><b><span class="chip ' + (v.completo ? "ok" : "alerta") + '">' +
      (v.completo ? "Conforme" : "Con diferencias") + "</span></b></div>" +
      '<div class="sech" style="margin:14px 0 6px">Solicitado vs. recibido</div>' +
      v.lineas.map(l => '<div class="dato"><span>' + esc(l.desc) + "</span><b>" + l.recibido + " / " + l.solicitado +
        " · " + esc(l.estado) + "</b></div>").join("") +
      (v.noSolicitados.length
        ? '<div class="sech" style="margin:14px 0 6px">No solicitados</div>' +
          v.noSolicitados.map(x => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
            esc(x) + "</b></span></div>").join("")
        : "");
  }
  if(g.sinCoincidir && g.sinCoincidir.length)
    html += '<div class="sech" style="margin:14px 0 6px">Fuera del consolidado</div>' +
      g.sinCoincidir.map(x => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
        esc(x) + "</b></span></div>").join("");
  if(g.foto) html += '<img src="' + g.foto + '" data-zoom="' + g.foto +
    '" style="width:100%;height:160px;object-fit:cover;border-radius:12px;margin-top:12px" alt="llegada">';

  const acc = [];
  if(g.pdf) acc.push({txt:"Ver guía en PDF", clase:"btn-pri", fn:()=> verPDF(g.pdf)});
  if(g.reqId && db.requerimientos.some(r => r.id === g.reqId))
    acc.push({txt:"Ver requerimiento", clase:"btn-cont", fn:()=> detalleReq(g.reqId)});
  acc.push({txt:"Cerrar", clase:"btn-cont"});
  hoja("Guía " + (g.numero || ""), html, acc);
};

/* ---------------------------------------------------------------
   V6.3  El panel de atención muestra lo recibido por guía
   --------------------------------------------------------------- */
const atenderReqV5 = atenderReq;
atenderReq = function(id){
  atenderReqV5(id);
  const r = db.requerimientos.find(x => x.id === id);
  if(!r) return;
  const cuerpo = $("hoja-cuerpo");
  if(!cuerpo) return;

  const recibidos = r.items.filter(i => (i.recibido || 0) > 0);
  if(recibidos.length || r.recepcionGuia){
    const v = r.recepcionGuia;
    cuerpo.insertAdjacentHTML("beforeend",
      '<div class="sech" style="margin:16px 0 6px">Recepción por guía</div>' +
      (v ? '<div class="dato"><span>Guía</span><b>' + esc(v.guia || "—") + "</b></div>" +
           '<div class="dato"><span>Verificada</span><b>' + fecha(v.fecha) + " · " + esc(v.usuario) + "</b></div>" +
           '<div class="dato"><span>Resultado</span><b><span class="chip ' + (v.completo ? "ok" : "alerta") + '">' +
           v.conformes + " de " + v.total + (v.completo ? " · conforme" : " · con diferencias") + "</span></b></div>" : "") +
      r.items.map(it => {
        const rec = it.recibido || 0;
        const chip = rec >= it.cant ? "ok" : (rec > 0 ? "alerta" : "mal");
        return '<div class="dato"><span>' + esc(it.desc) + "</span><b>" + rec + " / " + it.cant + " " +
          esc(it.unidad) + ' <span class="chip ' + chip + '">' +
          (rec >= it.cant ? "recibido" : (rec > 0 ? "parcial" : "pendiente")) + "</span></b></div>";
      }).join(""));
  }

  /* acceso directo para subir la guía desde la misma ficha */
  if(puede("guias")){
    const pie = $("hoja-pie");
    const b = document.createElement("button");
    b.className = "btn btn-cont";
    b.textContent = "Subir guía";
    b.addEventListener("click", ()=>{
      cerrarHoja();
      ir("guias");
      setTimeout(()=>{ if($("gv-req")) $("gv-req").value = r.id; }, 200);
    });
    pie.insertBefore(b, pie.firstChild);
  }
};

/* ---------------------------------------------------------------
   V6.4  Acceso directo del almacenero en el inicio
   --------------------------------------------------------------- */
const pintarInicioV5 = pintarInicio;
pintarInicio = function(){
  pintarInicioV5();
  if(!puede("guias")) return;
  const cont = $("ini-accesos");
  if(!cont || cont.querySelector("[data-ir6]")) return;
  cont.insertAdjacentHTML("afterbegin",
    '<button class="metrica" data-ir6="guias" style="display:flex;align-items:center;gap:10px;text-align:left">' +
    '<span style="width:38px;height:38px;border-radius:11px;background:var(--pri-cont);color:var(--pri);display:flex;align-items:center;justify-content:center;flex:none">' +
    ico("pdf", 20) + '</span><span style="font-size:13.5px;font-weight:600;line-height:1.25">Subir y verificar guía</span></button>');
  cont.querySelector("[data-ir6]").addEventListener("click", ()=> ir("guias"));
};

/* Ítems del requerimiento: campo de recibido en la migración */
db.requerimientos.forEach(r => r.items.forEach(it => { if(it.recibido === undefined) it.recibido = 0; }));
guardar();


/* =====================================================================
   ================  AMPLIACIÓN v7  ====================================
   Reporte diario del Administrador de la aplicación: además de la
   operación de obra, resume TODO lo ocurrido dentro de la interfaz
   (quién entró, qué hizo cada usuario, en qué módulo y a qué hora)
   para poder enviárselo a la jefatura.
   ===================================================================== */

function actividadDelDia(dia){
  const aud = db.auditoria.filter(a => diaLocal(a.fecha) === dia);
  const his = db.historial.filter(h => diaLocal(h.fecha) === dia);
  const porUsuario = {}, porModulo = {};
  his.forEach(h => {
    porUsuario[h.usuario] = (porUsuario[h.usuario] || 0) + 1;
    porModulo[h.modulo] = (porModulo[h.modulo] || 0) + 1;
  });
  const sesiones = his.filter(h => h.modulo === "sesion" && h.accion === "Inicio de sesión");
  const usuariosActivos = Object.keys(porUsuario);
  const cambiosEstado = aud.filter(a => a.estadoNuevo);
  const conEvidencia = aud.filter(a => a.fotos || a.archivos);
  return {aud, his, porUsuario, porModulo, sesiones, usuariosActivos, cambiosEstado, conEvidencia,
          total:his.length};
}

const NOMBRE_MODULO = {
  pedidos:"Requerimientos", inventario:"Inventario", herramientas:"Herramientas",
  compras:"Compras", movimientos:"Movimientos", consolidado:"Consolidado",
  guias:"Guías", personal:"Personal", usuarios:"Usuarios", solicitudes:"Solicitudes de acceso",
  sesion:"Sesiones", reportes:"Reportes", configuracion:"Configuración"
};
const modNom = m => NOMBRE_MODULO[m] || m;

/* --------- sección para el informe imprimible (PDF) --------- */
function seccionActividadHTML(dia){
  const a = actividadDelDia(dia);
  const tabla = (cab, filas) => filas.length
    ? "<table><thead><tr>" + cab.map(x => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" +
      filas.map(f => "<tr>" + f.map(x => "<td>" + esc(x) + "</td>").join("") + "</tr>").join("") + "</tbody></table>"
    : "<p class='v'>Sin registros.</p>";

  return "<h2>Actividad en la aplicación</h2>" +
    "<div class='kpis'>" +
    "<div class='kpi'><b>" + a.total + "</b><span>Acciones registradas</span></div>" +
    "<div class='kpi'><b>" + a.usuariosActivos.length + "</b><span>Usuarios activos</span></div>" +
    "<div class='kpi'><b>" + a.sesiones.length + "</b><span>Inicios de sesión</span></div>" +
    "<div class='kpi'><b>" + a.cambiosEstado.length + "</b><span>Cambios de estado</span></div>" +
    "<div class='kpi'><b>" + a.conEvidencia.length + "</b><span>Con foto o archivo</span></div>" +
    "</div>" +

    "<h2>Actividad por usuario</h2>" +
    tabla(["Usuario","Acciones"], Object.keys(a.porUsuario)
      .sort((x,y)=> a.porUsuario[y] - a.porUsuario[x])
      .map(k => [k, a.porUsuario[k]])) +

    "<h2>Actividad por módulo</h2>" +
    tabla(["Módulo","Acciones"], Object.keys(a.porModulo)
      .sort((x,y)=> a.porModulo[y] - a.porModulo[x])
      .map(k => [modNom(k), a.porModulo[k]])) +

    "<h2>Detalle cronológico</h2>" +
    tabla(["Hora","Usuario","Módulo","Acción","Detalle"],
      a.his.slice().reverse().map(h => [hora(h.fecha), h.usuario, modNom(h.modulo),
        h.accion, h.detalle || "—"])) +

    (a.cambiosEstado.length
      ? "<h2>Trazabilidad de estados</h2>" +
        tabla(["Hora","Usuario","Acción","De","A","IP"],
          a.cambiosEstado.slice().reverse().map(x => [hora(x.fecha), x.usuario, x.accion,
            (ESTADOS[x.estadoAnterior] || {}).texto || x.estadoAnterior || "—",
            (ESTADOS[x.estadoNuevo] || {}).texto || x.estadoNuevo || "—", x.ip]))
      : "");
}

const reporteEjecutivoHTMLv6 = reporteEjecutivoHTML;
reporteEjecutivoHTML = function(dia, observaciones, conActividad){
  const base = reporteEjecutivoHTMLv6(dia, observaciones);
  if(conActividad === false) return base;
  return base.replace("<footer>", seccionActividadHTML(dia) + "<footer>");
};

/* --------- sección para el documento Word --------- */
const bloquesEjecutivosV6 = bloquesEjecutivos;
bloquesEjecutivos = function(dia, observaciones, conActividad){
  const B = bloquesEjecutivosV6(dia, observaciones);
  if(conActividad === false) return B;
  const a = actividadDelDia(dia);
  B.push({tipo:"h2", texto:"Actividad en la aplicación"});
  B.push({tipo:"tabla", filas:[["Indicador","Valor"],
    ["Acciones registradas", a.total], ["Usuarios activos", a.usuariosActivos.length],
    ["Inicios de sesión", a.sesiones.length], ["Cambios de estado", a.cambiosEstado.length]]});
  B.push({tipo:"h2", texto:"Actividad por usuario"});
  B.push({tipo:"tabla", filas:[["Usuario","Acciones"]]
    .concat(Object.keys(a.porUsuario).sort((x,y)=> a.porUsuario[y] - a.porUsuario[x])
      .map(k => [k, a.porUsuario[k]]))});
  B.push({tipo:"h2", texto:"Detalle cronológico"});
  B.push({tipo:"tabla", filas:[["Hora","Usuario","Módulo","Acción"]]
    .concat(a.his.slice().reverse().map(h => [hora(h.fecha), h.usuario, modNom(h.modulo), h.accion]))});
  return B;
};

/* --------- hoja "Actividad" en el Excel del día --------- */
const libroDelDiaV6 = libroDelDia;
libroDelDia = function(dia){
  const blob = libroDelDiaV6(dia);
  return blob; /* se conserva para otros usos; el Administrador usa libroAdmin */
};

function libroAdmin(dia){
  const a = actividadDelDia(dia);
  const hojas = [];

  /* reutiliza las hojas operativas del reporte del día */
  const resumen = [["REPORTE DIARIO · ADMINISTRACIÓN DE LA APLICACIÓN"],
    ["Fecha", new Date(dia + "T12:00:00").toLocaleDateString("es-PE",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})],
    ["Generado por", usuarioActual().nombre + " (Administrador de la aplicación)"],
    ["Empresa", db.config.empresa || "—"], ["Proyecto", db.config.proyecto || "—"],
    ["Emitido", fecha(ahora())], [],
    ["ACTIVIDAD EN LA APLICACIÓN"],
    ["Acciones registradas", a.total], ["Usuarios activos", a.usuariosActivos.length],
    ["Inicios de sesión", a.sesiones.length], ["Cambios de estado", a.cambiosEstado.length],
    ["Acciones con foto o archivo", a.conEvidencia.length], [],
    ["OPERACIÓN DE OBRA"]];
  const d = datosEjecutivos(dia);
  resumen.push(["Requerimientos recibidos", d.recibidos.length], ["Atendidos", d.atendidos.length],
    ["Pendientes", d.pendientes.length], ["Compras del día", d.compras.length],
    ["Entregas de material", d.entregados.length], ["Herramientas prestadas", d.prestamos.length],
    ["Devoluciones", d.devoluciones.length], ["Incidencias", d.incidencias.length]);
  if(db.consolidado.items.length){
    const c = avanceConsolidado();
    resumen.push([], ["CONSOLIDADO DE OBRA"], ["Total materiales", c.total], ["Comprados", c.comprados],
      ["Pendientes", c.pendientes], ["Completados", c.entregados], ["Avance %", c.avance]);
  }
  hojas.push({nombre:"Resumen", filas:resumen, estilos:[1]});

  hojas.push({nombre:"Actividad", filas:
    [["Hora","Usuario","Módulo","Acción","Detalle"]]
      .concat(a.his.slice().reverse().map(h => [hora(h.fecha), h.usuario, modNom(h.modulo),
        h.accion, h.detalle || ""])), estilos:[1]});

  hojas.push({nombre:"Por usuario", filas:
    [["Usuario","Acciones"]].concat(Object.keys(a.porUsuario)
      .sort((x,y)=> a.porUsuario[y] - a.porUsuario[x]).map(k => [k, a.porUsuario[k]])), estilos:[1]});

  hojas.push({nombre:"Trazabilidad", filas:
    [["Hora","Usuario","Cargo","Módulo","Acción","Estado anterior","Estado nuevo","Comentario","IP","Dispositivo"]]
      .concat(a.aud.slice().reverse().map(x => [hora(x.fecha), x.usuario, x.cargo, modNom(x.modulo),
        x.accion, (ESTADOS[x.estadoAnterior] || {}).texto || x.estadoAnterior || "",
        (ESTADOS[x.estadoNuevo] || {}).texto || x.estadoNuevo || "",
        x.comentario, x.ip, x.dispositivo])), estilos:[1]});

  hojas.push({nombre:"Requerimientos", filas:
    [["Código","Estado","Área","Solicitante","Prioridad","Materiales","Recibido por guía"]]
      .concat(db.requerimientos.map(r => [r.codigo, (ESTADOS[r.estado] || {}).texto || r.estado,
        r.disciplina || r.area || "", r.solicitante, r.prioridad, resumenItems(r),
        r.recepcionGuia ? r.recepcionGuia.conformes + "/" + r.recepcionGuia.total : ""])), estilos:[1]});

  hojas.push({nombre:"Movimientos", filas:
    [["Hora","Tipo","Artículo","Cantidad","Unidad","Responsable","Registró"]]
      .concat(d.movs.map(m => [hora(m.fecha), TIPOMOV[m.tipo].texto, m.item,
        m.tipo === "salida" ? -m.cantidad : m.cantidad, m.unidad, m.persona || "", m.registro || ""])), estilos:[1]});

  if(db.consolidado.items.length){
    const filas = [["Material","Requerido","Comprado","Entregado","Estado"]], estilos = [1];
    db.consolidado.items.forEach(it => {
      const est = estadoConsolidado(it);
      filas.push([it.desc, it.requerido, it.comprado, it.entregado, ESTADO_CONS[est].txt]);
      estilos.push(est === "completado" ? 2 : 0);
    });
    hojas.push({nombre:"Consolidado", filas, estilos});
  }
  return crearXLSX(hojas);
}

/* ---------------------------------------------------------------
   V7.2  Mi trabajo del día (el Administrador también es almacenero)
   --------------------------------------------------------------- */
function miTrabajoDelDia(dia){
  const u = usuarioActual();
  if(!u) return null;
  const mio = x => x.usuarioId === u.id || x.registroId === u.id || x.usuario === u.nombre;
  const movs = db.movimientos.filter(m => diaLocal(m.fecha) === dia && mio(m));
  const guias = (db.guias || []).filter(g => diaLocal(g.fecha) === dia && g.usuario === u.nombre);
  const entregas = [];
  db.requerimientos.forEach(r => (r.entregas || []).forEach(e => {
    if(diaLocal(e.fecha) === dia && e.usuario === u.nombre) entregas.push({req:r.codigo, e});
  }));
  const acciones = db.historial.filter(h => diaLocal(h.fecha) === dia && h.usuarioId === u.id);
  return {
    usuario:u, movs, guias, entregas, acciones,
    ingresos:movs.filter(m => m.tipo === "ingreso"),
    salidas:movs.filter(m => m.tipo === "salida"),
    prestamos:movs.filter(m => m.tipo === "prestamo"),
    devoluciones:movs.filter(m => m.tipo === "devolucion"),
    conformes:guias.filter(g => g.verificacion && g.verificacion.completo).length,
    firmas:entregas.filter(x => x.e.firma).length
  };
}

function seccionMiTrabajoHTML(dia){
  const t = miTrabajoDelDia(dia);
  if(!t) return "";
  const tabla = (cab, filas) => filas.length
    ? "<table><thead><tr>" + cab.map(x => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" +
      filas.map(f => "<tr>" + f.map(x => "<td>" + esc(x) + "</td>").join("") + "</tr>").join("") + "</tbody></table>"
    : "<p class='v'>Sin registros.</p>";
  return "<h2>Trabajo de almacén de " + esc(t.usuario.nombre) + "</h2>" +
    "<div class='kpis'>" +
    "<div class='kpi'><b>" + t.acciones.length + "</b><span>Acciones propias</span></div>" +
    "<div class='kpi'><b>" + t.ingresos.length + "</b><span>Ingresos registrados</span></div>" +
    "<div class='kpi'><b>" + t.salidas.length + "</b><span>Entregas de material</span></div>" +
    "<div class='kpi'><b>" + t.guias.length + "</b><span>Guías verificadas</span></div>" +
    "<div class='kpi'><b>" + t.prestamos.length + "</b><span>Préstamos</span></div>" +
    "<div class='kpi'><b>" + t.firmas.length + "</b><span>Entregas con firma</span></div>" +
    "</div>" +
    tabla(["Hora","Movimiento","Artículo","Cantidad","Responsable"],
      t.movs.slice().reverse().map(m => [hora(m.fecha), TIPOMOV[m.tipo].texto, m.item,
        (m.tipo === "salida" ? "-" : "+") + m.cantidad + " " + m.unidad, m.persona || "—"])) +
    (t.guias.length
      ? "<h2>Guías verificadas</h2>" +
        tabla(["Hora","Guía","Requerimiento","Resultado"],
          t.guias.map(g => [hora(g.fecha), g.numero || "—", g.req || "—",
            g.verificacion ? (g.verificacion.conformes + "/" + g.verificacion.total +
              (g.verificacion.completo ? " conforme" : " con diferencias")) : "—"]))
      : "");
}

/* --------- reporte diario del Administrador (funciona en ambos modos) --------- */
function cuentaEsAdmin(){
  const u = usuarioActual();
  if(u && u.esAdmin) return true;
  snack("Solo el Administrador de la aplicación genera este reporte.", "err");
  return false;
}

(function reemplazarReporteAdmin(){
  const ver = $("dg-ver"), pdf = $("dg-pdf"), xls = $("dg-xls"), doc = $("dg-doc");
  if(!ver) return;
  const nuevos = {};
  [["ver",ver],["pdf",pdf],["xls",xls],["doc",doc]].forEach(([k,b])=>{
    if(!b) return;
    const n = b.cloneNode(true);
    b.parentNode.replaceChild(n, b);
    nuevos[k] = n;
  });

  const esAdmin = cuentaEsAdmin;
  window.__reporteAdmin = nuevos;

  nuevos.ver.addEventListener("click", ()=>{
    if(!esAdmin()) return;
    const dia = hoyISO();
    const t = miTrabajoDelDia(dia);
    const a = actividadDelDia(dia);
    const d = datosEjecutivos(dia);
    const c = db.consolidado.items.length ? avanceConsolidado() : null;
    const li = (k,v) => '<div class="dato"><span>' + k + "</span><b>" + v + "</b></div>";
    const usuarios = Object.keys(a.porUsuario).sort((x,y)=> a.porUsuario[y] - a.porUsuario[x]);

    hoja("Reporte del " + soloFecha(dia),
      '<div class="sech" style="margin:0 0 6px">Mi trabajo como almacenero</div>' +
      li("Acciones propias", t.acciones.length) + li("Ingresos registrados", t.ingresos.length) +
      li("Entregas de material", t.salidas.length) + li("Guías verificadas", t.guias.length) +
      li("Préstamos de herramienta", t.prestamos.length) + li("Entregas con firma", t.firmas) +

      '<div class="sech" style="margin:16px 0 6px">Actividad en la aplicación</div>' +
      li("Acciones registradas", a.total) + li("Usuarios activos", a.usuariosActivos.length) +
      li("Inicios de sesión", a.sesiones.length) + li("Cambios de estado", a.cambiosEstado.length) +
      li("Con foto o archivo", a.conEvidencia.length) +

      (usuarios.length
        ? '<div class="sech" style="margin:16px 0 6px">Quién hizo qué</div>' +
          usuarios.map(u => li(u, a.porUsuario[u] + " acciones")).join("")
        : "") +

      '<div class="sech" style="margin:16px 0 6px">Operación de obra</div>' +
      li("Requerimientos recibidos", d.recibidos.length) + li("Atendidos", d.atendidos.length) +
      li("Pendientes", d.pendientes.length) + li("Compras", d.compras.length) +
      li("Entregas de material", d.entregados.length) + li("Herramientas prestadas", d.prestamos.length) +
      li("Incidencias", d.incidencias.length) +
      (c ? li("Avance del consolidado", c.avance + "%") + li("Materiales completados", c.entregados + " de " + c.total) : "") +

      '<div class="sech" style="margin:16px 0 6px">Últimos movimientos en la app</div>' +
      (a.his.slice(0, 8).map(h => '<div class="linea"><span class="pt"></span><span class="txt"><b>' +
        esc(h.accion) + "</b><small>" + hora(h.fecha) + " · " + esc(h.usuario) +
        (h.detalle ? " · " + esc(h.detalle) : "") + "</small></span></div>").join("") ||
        '<div class="ayuda" style="margin:0">Sin actividad registrada hoy.</div>'),

      [{txt:"Descargar Excel", clase:"btn-pri", fn:()=> nuevos.xls.click()},
       {txt:"PDF", clase:"btn-cont", fn:()=> nuevos.pdf.click()},
       {txt:"Enviar al jefe", clase:"btn-sec", fn:enviarReporteAdmin},
       {txt:"Cerrar", clase:"btn-cont"}]);

    auditar("reportes", "Reporte diario de la aplicación consultado", {comentario:dia});
    guardar();
  });

  nuevos.pdf.addEventListener("click", ()=>{
    if(!esAdmin()) return;
    imprimirReporte(reporteEjecutivoHTML(hoyISO(),
      "Reporte diario emitido por el Administrador de la aplicación."));
    auditar("reportes", "Reporte diario de la aplicación en PDF", {comentario:hoyISO()});
    guardar();
    snack("Elija «Guardar como PDF» en el diálogo de impresión.", "ok");
  });

  nuevos.xls.addEventListener("click", ()=>{
    if(!esAdmin()) return;
    descargarBlob("reporte_diario_" + hoyISO() + ".xlsx", libroAdmin(hoyISO()));
    auditar("reportes", "Reporte diario de la aplicación en Excel", {comentario:hoyISO()});
    guardar();
    snack("Excel del día descargado.", "ok");
  });

  nuevos.doc.addEventListener("click", ()=>{
    if(!esAdmin()) return;
    descargarBlob("reporte_diario_" + hoyISO() + ".docx",
      crearDOCX(bloquesEjecutivos(hoyISO(), "Reporte diario emitido por el Administrador de la aplicación.")));
    auditar("reportes", "Reporte diario de la aplicación en Word", {comentario:hoyISO()});
    guardar();
    snack("Documento Word descargado.", "ok");
  });
})();

/* --------- envío del reporte a la jefatura --------- */
async function enviarReporteAdmin(){
  const dia = hoyISO();
  const dest = db.config.correos || [];
  const blob = libroAdmin(dia);
  const nombre = "reporte_diario_" + dia + ".xlsx";
  const a = actividadDelDia(dia);
  const d = datosEjecutivos(dia);
  const asunto = "Reporte diario de almacén " + soloFecha(dia) +
    (db.config.proyecto ? " · " + db.config.proyecto : "");
  const cuerpo =
    "Adjunto el reporte del " + soloFecha(dia) + ".\n\n" +
    "Requerimientos recibidos: " + d.recibidos.length + "\n" +
    "Atendidos: " + d.atendidos.length + "  ·  Pendientes: " + d.pendientes.length + "\n" +
    "Entregas de material: " + d.entregados.length + "\n" +
    "Herramientas prestadas: " + d.prestamos.length + "\n" +
    (db.consolidado.items.length ? "Avance del consolidado: " + avanceConsolidado().avance + "%\n" : "") +
    "Acciones registradas en la aplicación: " + a.total + " (" + a.usuariosActivos.length + " usuarios)\n\n" +
    "Generado por " + usuarioActual().nombre + ".";

  const ok = await compartirArchivo(nombre, blob, asunto, cuerpo);
  if(!ok) descargarBlob(nombre, blob);
  if(dest.length){
    const url = "mailto:" + dest.map(x => x.correo).join(",") +
      "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(cuerpo);
    setTimeout(()=>{ location.href = url; }, 700);
  }
  auditar("reportes", "Reporte diario enviado",
    {comentario:dest.length ? dest.map(x => x.correo).join(", ") : "compartido sin destinatarios fijos"});
  guardar();
  snack(dest.length ? "Archivo listo y correo preparado; adjúntelo antes de enviar."
                    : "Archivo listo. Configure destinatarios en Configuración.", "ok");
}

/* ---------------------------------------------------------------
   V7.3  La misma tarjeta dentro de Reportes, para usarla en modo
   almacenero (el Dashboard solo existe en modo administrador).
   --------------------------------------------------------------- */
(function tarjetaReporteEnReportes(){
  const cont = $("scr-reportes");
  if(!cont || $("rd-admin")) return;
  const card = document.createElement("div");
  card.className = "card acento";
  card.id = "rd-admin";
  card.innerHTML =
    '<div style="font-weight:700;font-size:15px;margin-bottom:3px">Reporte diario del día</div>' +
    '<p class="ayuda" style="margin:0 0 11px">Su trabajo de almacén y todo lo ocurrido en la aplicación, ' +
    'listo para enviar a la jefatura.</p>' +
    '<button class="btn btn-pri" id="rd-ver">Ver el reporte del día</button>' +
    '<div class="btns" style="margin-top:10px">' +
    '<button class="btn btn-sec btn-mini" id="rd-enviar">Enviar</button>' +
    '<button class="btn btn-cont btn-mini" id="rd-xls">Excel</button>' +
    '<button class="btn btn-cont btn-mini" id="rd-pdf">PDF</button>' +
    '<button class="btn btn-cont btn-mini" id="rd-doc">Word</button></div>';
  cont.insertBefore(card, cont.firstChild);

  const R = ()=> window.__reporteAdmin || {};
  $("rd-ver").addEventListener("click", ()=> { if(R().ver) R().ver.click(); });
  $("rd-xls").addEventListener("click", ()=> { if(R().xls) R().xls.click(); });
  $("rd-pdf").addEventListener("click", ()=> { if(R().pdf) R().pdf.click(); });
  $("rd-doc").addEventListener("click", ()=> { if(R().doc) R().doc.click(); });
  $("rd-enviar").addEventListener("click", ()=>{ if(cuentaEsAdmin()) enviarReporteAdmin(); });
})();

/* Visible según la cuenta (no según el modo activo) */
const pintarInicioV6 = pintarInicio;
pintarInicio = function(){
  pintarInicioV6();
  const u = usuarioActual();
  const dash = $("dg-reporte"), rep = $("rd-admin");
  if(dash) dash.classList.toggle("oculto", !esCuentaAdmin());
  if(rep)  rep.classList.toggle("oculto", !esCuentaAdmin());
};

const refrescarV6 = refrescar;
refrescar = function(destino){
  refrescarV6(destino);
  const u = usuarioActual();
  const dash = $("dg-reporte"), rep = $("rd-admin");
  if(dash) dash.classList.toggle("oculto", !esCuentaAdmin());
  if(rep)  rep.classList.toggle("oculto", !esCuentaAdmin());
};

/* --------- recordatorio diario dirigido al Administrador --------- */
const revisarHoraReporteV4 = revisarHoraReporte;
revisarHoraReporte = function(){
  if(!sesion || !db.config.horaReporte) return;
  if(new Date().toTimeString().slice(0,5) !== db.config.horaReporte) return;
  if(db.config.ultimoAviso === hoyISO()) return;
  db.config.ultimoAviso = hoyISO();
  guardar();
  const a = actividadDelDia(hoyISO());
  notificar({roles:["admin"], titulo:"Reporte diario listo para enviar",
    cuerpo:"Hoy se registraron " + a.total + " acciones de " + a.usuariosActivos.length +
           " usuario(s). Genere el reporte desde el Dashboard y envíelo a " +
           ((db.config.correos || []).map(c => c.nombre).join(", ") || "la jefatura") + ".",
    refTipo:"reporte"});
  snack("Recordatorio: toca enviar el reporte diario.", "ok");
};


/* Hora corta y correcta para las columnas de los reportes */
function hora(iso){
  return new Date(iso).toLocaleTimeString("es-PE", {hour:"2-digit", minute:"2-digit"});
}


/* =====================================================================
   ================  AMPLIACIÓN v8  ====================================
   Hace visible el circuito para todos: quién pide, quién compra, quién
   verifica la guía y quién sube el material al almacén de mina.
   ===================================================================== */

/* El reporte impreso incluye también el trabajo propio de almacén */
const reporteEjecutivoHTMLv7 = reporteEjecutivoHTML;
reporteEjecutivoHTML = function(dia, observaciones, conActividad){
  const base = reporteEjecutivoHTMLv7(dia, observaciones, conActividad);
  if(conActividad === false) return base;
  const mio = seccionMiTrabajoHTML(dia);
  return mio ? base.replace("<h2>Actividad en la aplicación</h2>", mio + "<h2>Actividad en la aplicación</h2>") : base;
};

/* ---------------------------------------------------------------
   V8.1  Etapas del circuito
   --------------------------------------------------------------- */
const ETAPAS = [
  {txt:"Requerimiento",   quien:"Supervisor · Administración · Almacén",
   estados:["pendiente","solicitado","revisado","observado"]},
  {txt:"En logística",    quien:"Jefa de Logística",
   estados:["enviado_logistica","consolidado"]},
  {txt:"Visto bueno",     quien:"Jefa de Logística",
   estados:["aprobado","compra_aprobada"]},
  {txt:"Compra",          quien:"Área de Compras",
   estados:["en_compra","compra_proceso","despachado"]},
  {txt:"Guía verificada", quien:"Almacenero",
   estados:["material_recibido"]},
  {txt:"Entregado",       quien:"Almacenero",
   estados:["entrega_parcial","entregado","cerrado","recibido"]}
];

function etapaActual(r){
  for(let i = ETAPAS.length - 1; i >= 0; i--)
    if(ETAPAS[i].estados.indexOf(r.estado) >= 0) return i;
  return 0;
}

/* Qué falta hacer y a quién le toca */
function siguientePaso(r){
  const e = r.estado;
  if(e === "rechazado") return {quien:"—", texto:"Requerimiento rechazado. No continúa."};
  if(["pendiente","solicitado","revisado","observado"].indexOf(e) >= 0)
    return {quien:"Administradora de Obra", texto:"Revisar el pedido y enviarlo al área de logística."};
  if(["enviado_logistica","consolidado"].indexOf(e) >= 0)
    return {quien:"Jefa de Logística", texto:"Dar el visto bueno para que Compras pueda comprar."};
  if(["aprobado","compra_aprobada"].indexOf(e) >= 0)
    return {quien:"Área de Compras", texto:"Comprar y registrar cada artículo con su foto."};
  if(["en_compra","compra_proceso","despachado"].indexOf(e) >= 0)
    return {quien:"Almacenero", texto:"Recibir la guía, verificar que llegó completo y subirlo al inventario."};
  if(e === "material_recibido")
    return {quien:"Almacenero", texto:"Entregar el material al solicitante con su firma."};
  if(e === "entrega_parcial")
    return {quien:"Almacenero", texto:"Falta completar la entrega; el resto sigue pendiente."};
  return {quien:"—", texto:"Requerimiento cerrado."};
}

/* ---------------------------------------------------------------
   V8.2  Barra de etapas
   --------------------------------------------------------------- */
(function estilosFlujo(){
  if($("estilos-flujo")) return;
  const s = document.createElement("style");
  s.id = "estilos-flujo";
  s.textContent =
    ".flujo{display:flex;gap:4px;margin:10px 0 6px}" +
    ".flujo .paso{flex:1;text-align:center;position:relative}" +
    ".flujo .bolita{width:22px;height:22px;border-radius:999px;background:var(--sup-var);color:var(--tinta-sec);" +
      "font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 5px;border:2px solid var(--sup-var)}" +
    ".flujo .paso.hecho .bolita{background:var(--ok);border-color:var(--ok);color:#fff}" +
    ".flujo .paso.actual .bolita{background:var(--pri);border-color:var(--pri);color:#fff;box-shadow:0 0 0 4px rgba(27,75,143,.15)}" +
    ".flujo .et{font-size:9.5px;line-height:1.2;color:var(--tinta-sec);font-weight:600}" +
    ".flujo .paso.actual .et{color:var(--pri)}" +
    ".flujo .linea{position:absolute;top:11px;left:calc(50% + 14px);right:calc(-50% + 14px);height:2px;background:var(--sup-var)}" +
    ".flujo .paso.hecho .linea{background:var(--ok)}" +
    ".paso-actual{background:var(--pri-cont);border-radius:var(--r-s);padding:10px 12px;margin:8px 0 2px;font-size:12.5px}" +
    ".paso-actual b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--pri-osc);margin-bottom:2px}" +
    ".circuito{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}" +
    ".circuito::-webkit-scrollbar{display:none}" +
    ".circuito .c{flex:none;background:var(--sup);border:1px solid var(--borde);border-radius:var(--r-s);" +
      "padding:9px 11px;min-width:132px}" +
    ".circuito .c b{display:block;font-size:12.5px}" +
    ".circuito .c small{font-size:10.5px;color:var(--tinta-sec)}";
  document.head.appendChild(s);
})();

function barraFlujoHTML(r){
  const act = etapaActual(r);
  const rechazado = r.estado === "rechazado";
  const p = siguientePaso(r);
  return '<div class="flujo">' + ETAPAS.map((e, i)=>{
    const clase = rechazado ? "" : (i < act ? "hecho" : (i === act ? "actual" : ""));
    return '<div class="paso ' + clase + '">' +
      (i < ETAPAS.length - 1 ? '<span class="linea"></span>' : "") +
      '<span class="bolita">' + (i < act ? "✓" : (i + 1)) + "</span>" +
      '<span class="et">' + e.txt + "</span></div>";
  }).join("") + "</div>" +
  '<div class="paso-actual"><b>' + (rechazado ? "Sin continuidad" : "Ahora le toca a " + esc(p.quien)) + "</b>" +
  esc(p.texto) + "</div>";
}

/* ---------------------------------------------------------------
   V8.3  Se muestra en la ficha del requerimiento y en la de atención
   --------------------------------------------------------------- */
const detalleReqV7 = detalleReq;
detalleReq = function(id){
  detalleReqV7(id);
  const r = db.requerimientos.find(x => x.id === id);
  const cuerpo = $("hoja-cuerpo");
  if(!r || !cuerpo) return;
  cuerpo.insertAdjacentHTML("afterbegin", barraFlujoHTML(r));
};

const atenderReqV6 = atenderReq;
atenderReq = function(id){
  atenderReqV6(id);
  const r = db.requerimientos.find(x => x.id === id);
  const cuerpo = $("hoja-cuerpo");
  if(!r || !cuerpo) return;
  cuerpo.insertAdjacentHTML("afterbegin", barraFlujoHTML(r));
};

/* ---------------------------------------------------------------
   V8.4  Tarjeta con el circuito en la pantalla de Pedidos
   --------------------------------------------------------------- */
const CIRCUITO = [
  {t:"1. Pedido",        d:"Supervisor, capataz o el propio almacén"},
  {t:"2. A logística",   d:"La Administradora de Obra lo revisa y envía"},
  {t:"3. Visto bueno",   d:"Jefa de Logística aprueba"},
  {t:"4. Compra",        d:"Compras adquiere y fotografía"},
  {t:"5. Guía",          d:"Almacén verifica que llegó completo"},
  {t:"6. Inventario",    d:"Ingresa al almacén de mina"},
  {t:"7. Entrega",       d:"Se entrega con firma"}
];

function pintarCircuito(){
  const scr = $("scr-pedidos");
  if(!scr) return;
  let card = $("pe-circuito");
  if(!card){
    card = document.createElement("div");
    card.className = "card";
    card.id = "pe-circuito";
    scr.insertBefore(card, scr.firstChild);
  }
  const mios = db.requerimientos.filter(r => ABIERTOS.indexOf(r.estado) >= 0);
  const p = siguientePaso;
  const mios2 = mios.filter(r => {
    const q = p(r).quien;
    const rol = rolEfectivo();
    if(rol === "jefatura") return /Log/.test(q);
    if(rol === "compras")  return /Compras/.test(q);
    if(rol === "almacenero" || rol === "obra" || rol === "admin") return /Almac|Administraci/.test(q);
    return false;
  });
  card.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">' +
    '<b style="font-size:14px">Cómo avanza un pedido</b>' +
    (mios2.length ? '<span class="chip alerta">' + mios2.length + " esperan su acción</span>" : '<span class="chip ok">al día</span>') +
    "</div>" +
    '<div class="circuito">' + CIRCUITO.map(c =>
      '<div class="c"><b>' + c.t + "</b><small>" + c.d + "</small></div>").join("") + "</div>";
}

const pintarPedidosV7 = pintarPedidos;
pintarPedidos = function(){
  pintarPedidosV7();
  pintarCircuito();
};

/* ---------------------------------------------------------------
   V8.5  En la lista, cada pedido dice a quién le toca
   --------------------------------------------------------------- */
const filaReqV7 = filaReq;
filaReq = function(r){
  const base = filaReqV7(r);
  const p = siguientePaso(r);
  if(CERRADOS.indexOf(r.estado) >= 0) return base;
  return base.replace("</small></span>",
    "</small><small style='color:var(--pri);font-weight:600'>→ " + esc(p.quien) + "</small></span>");
};



/* =====================================================================
   ================  AMPLIACIÓN v9  ====================================
   Modo simulación: el Administrador puede ver la aplicación tal como la
   ve cada cargo, sin cambiar de usuario ni tocar los datos.
   ===================================================================== */

function simulando(){ return (sesion && sesion.simulando) ? sesion.simulando : null; }

/* El rol y los permisos pasan a ser los del cargo simulado */
const rolEfectivoV8 = rolEfectivo;
rolEfectivo = function(){
  const s = simulando();
  return s ? s.rol : rolEfectivoV8();
};

const puedeV8 = puede;
puede = function(permiso){
  const s = simulando();
  if(!s) return puedeV8(permiso);
  const p = ROLES[s.rol].permisos;
  if(p === "*") return true;
  if(p.indexOf(permiso) >= 0) return true;
  if(s.rol === "supervisor"){
    const extra = EXTRA_DISCIPLINA[s.area] || [];
    if(extra.indexOf(permiso) >= 0) return true;
  }
  return false;
};

/* Los tableros exclusivos del Administrador desaparecen durante la simulación */
function esCuentaAdmin(){
  const u = usuarioActual();
  return Boolean(u && u.esAdmin) && !simulando();
}
cuentaEsAdmin = function(){
  if(esCuentaAdmin()) return true;
  snack(simulando() ? "En simulación no está disponible: es exclusivo del Administrador."
                    : "Solo el Administrador de la aplicación genera este reporte.", "err");
  return false;
};

/* ---------------------------------------------------------------
   V9.1  Banda superior mientras se simula
   --------------------------------------------------------------- */
(function estilosSimulacion(){
  if($("estilos-sim")) return;
  const s = document.createElement("style");
  s.id = "estilos-sim";
  s.textContent =
    ".simbanda{background:var(--sec);color:#fff;padding:9px 12px;display:none;align-items:center;gap:10px;" +
      "font-size:12.5px;font-weight:600;flex:none;z-index:22;box-shadow:var(--s1)}" +
    ".simbanda.ver{display:flex;animation:entra .2s ease}" +
    ".simbanda .txt{flex:1;min-width:0;line-height:1.25}" +
    ".simbanda .txt small{display:block;font-weight:500;opacity:.9;font-size:11px}" +
    ".simbanda button{background:rgba(255,255,255,.22);color:#fff;border-radius:999px;padding:7px 13px;" +
      "font-size:12px;font-weight:700;flex:none}" +
    ".simbanda button:active{background:rgba(255,255,255,.36)}";
  document.head.appendChild(s);
})();

(function crearBanda(){
  if($("simbanda")) return;
  const b = document.createElement("div");
  b.className = "simbanda";
  b.id = "simbanda";
  b.innerHTML = '<span id="sim-ico"></span><span class="txt"><span id="sim-txt"></span>' +
    '<small>Está viendo la aplicación como este cargo. No se modifican datos.</small></span>' +
    '<button id="sim-salir">Salir</button>';
  const appbar = $("appbar");
  appbar.parentNode.insertBefore(b, appbar.nextSibling);
  $("sim-ico").innerHTML = ico("usuario", 20);
  $("sim-salir").addEventListener("click", salirSimulacion);
})();

function pintarBandaSimulacion(){
  const s = simulando();
  const b = $("simbanda");
  if(!b) return;
  b.classList.toggle("ver", !!s);
  if(s) $("sim-txt").textContent = "Simulación · " + s.etiqueta;
  const modo = $("btn-modo");
  if(modo) modo.classList.toggle("oculto", !!s || !(usuarioActual() && usuarioActual().esAdmin));
}

/* ---------------------------------------------------------------
   V9.2  Elegir el cargo a simular
   --------------------------------------------------------------- */
function opcionesSimulacion(){
  const o = [
    {rol:"almacenero", area:"Almacén",   etiqueta:"Almacenero"},
    {rol:"obra",       area:"Obra",      etiqueta:"Administradora de Obra"},
    {rol:"compras",    area:"Logística", etiqueta:"Asistente de Logística (Compras)"},
    {rol:"jefatura",   area:"Logística", etiqueta:"Jefa de Logística"}
  ];
  DISCIPLINAS.forEach(d => o.push({rol:"supervisor", area:d, etiqueta:"Supervisor " + d}));
  return o;
}

function abrirSimulacion(){
  const u = usuarioActual();
  if(!u || !u.esAdmin) return snack("Solo el Administrador puede simular cargos.", "err");
  const ops = opcionesSimulacion();
  hoja("Ver la app como otro cargo",
    '<p class="ayuda" style="margin:0 0 12px">Elija un cargo para recorrer la aplicación con sus permisos. ' +
    "Los datos no cambian y puede volver cuando quiera.</p>" +
    ops.map((o, i) =>
      '<button class="fila" data-sim="' + i + '"><span class="mini">' +
      ico(o.rol === "supervisor" ? "personas" : (o.rol === "compras" ? "carrito" :
          (o.rol === "jefatura" ? "escudo" : (o.rol === "obra" ? "tabla" : "inventario"))), 20) + "</span>" +
      '<span class="txt"><b>' + esc(o.etiqueta) + "</b><small>" + esc(ROLES[o.rol].resumen.slice(0, 78)) +
      "…</small></span><span class='der'>" + ico("flecha", 18) + "</span></button>").join(""),
    [{txt:"Cancelar", clase:"btn-cont"}]);

  setTimeout(()=>{
    $$("#hoja-cuerpo [data-sim]").forEach(b => b.addEventListener("click", ()=>{
      cerrarHoja();
      iniciarSimulacion(ops[+b.dataset.sim]);
    }));
  }, 60);
}

function iniciarSimulacion(o){
  sesion.simulando = {rol:o.rol, area:o.area, etiqueta:o.etiqueta, desde:ahora()};
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  auditar("sesion", "Modo simulación activado", {comentario:o.etiqueta});
  guardar();
  aplicarRol();
  pintarBandaSimulacion();
  snack("Viendo la app como " + o.etiqueta + ".", "ok");
}

function salirSimulacion(){
  if(!simulando()) return;
  const et = simulando().etiqueta;
  delete sesion.simulando;
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  auditar("sesion", "Modo simulación finalizado", {comentario:et});
  guardar();
  aplicarRol();
  pintarBandaSimulacion();
  snack("De vuelta en su cuenta.", "ok");
}

/* ---------------------------------------------------------------
   V9.3  Enganches con la interfaz
   --------------------------------------------------------------- */
const aplicarRolV8 = aplicarRol;
aplicarRol = function(){
  aplicarRolV8();
  pintarBandaSimulacion();
};

const pintarDrawerV8 = pintarDrawer;
pintarDrawer = function(){
  pintarDrawerV8();
  const u = usuarioActual();
  if(!u || !u.esAdmin) return;
  const lista = $("dr-lista");
  if(!lista || lista.querySelector("[data-simular]")) return;
  const sep = lista.querySelectorAll(".sep")[1] || lista.lastElementChild;
  const html = simulando()
    ? '<button class="op" data-simular="salir" style="color:var(--accent-d)">' + ico("cambiar", 21) +
      "Salir de la simulación</button>"
    : '<button class="op" data-simular="abrir">' + ico("cambiar", 21) + "Ver como otro cargo</button>";
  sep.insertAdjacentHTML("beforebegin", html);
  const b = lista.querySelector("[data-simular]");
  b.addEventListener("click", ()=>{
    cerrarDrawer();
    if(b.dataset.simular === "salir") salirSimulacion(); else abrirSimulacion();
  });
};

/* En el inicio, un acceso directo cuando es el Administrador */
const pintarInicioV7 = pintarInicio;
pintarInicio = function(){
  pintarInicioV7();
  const u = usuarioActual();
  const cont = $("ini-accesos");
  if(!cont || !u || !u.esAdmin || cont.querySelector("[data-sim9]")) return;
  const s = simulando();
  cont.insertAdjacentHTML("beforeend",
    '<button class="metrica" data-sim9="1" style="display:flex;align-items:center;gap:10px;text-align:left">' +
    '<span style="width:38px;height:38px;border-radius:11px;background:' +
    (s ? "var(--sec)" : "var(--pri-cont)") + ";color:" + (s ? "var(--sobre-sec)" : "var(--pri)") +
    ';display:flex;align-items:center;justify-content:center;flex:none">' + ico("cambiar", 20) +
    '</span><span style="font-size:13.5px;font-weight:600;line-height:1.25">' +
    (s ? "Salir de simulación" : "Ver como otro cargo") + "</span></button>");
  cont.querySelector("[data-sim9]").addEventListener("click", ()=>{
    if(simulando()) salirSimulacion(); else abrirSimulacion();
  });
};

/* La sesión guardada puede volver con una simulación activa */
(function restaurarBanda(){
  setTimeout(pintarBandaSimulacion, 300);
})();



/* =====================================================================
   ================  AMPLIACIÓN v10  ===================================
   Accesos rápidos convertidos en tareas del día, escritas en el idioma
   de cada cargo, y kardex de EPP por trabajador.
   ===================================================================== */

/* ---------------------------------------------------------------
   V10.1  Kardex de EPP
   --------------------------------------------------------------- */
const PALABRAS_EPP = /casco|guante|lente|gafa|botin|bota|zapato|chaleco|arnes|arnés|respirador|mascarilla|tapon|tapón|barbiquejo|mameluco|overol|protector|orejera|careta/i;

function esEPP(m){
  if(!m) return false;
  if(/epp|protecc|seguridad/i.test(m.categoria || "")) return true;
  return PALABRAS_EPP.test(m.nombre || "");
}

function salidasEPP(){
  return db.movimientos.filter(mov => {
    if(mov.tipo !== "salida") return false;
    const m = db.materiales.find(x => x.id === mov.itemId);
    return esEPP(m) || PALABRAS_EPP.test(mov.item || "");
  });
}

crearPantalla("epp",
  '<div class="card acento" style="font-size:13px">' +
  'Todo el EPP que se entregó a cada trabajador. Se reconoce por la categoría <b>EPP</b> ' +
  'o por el nombre (casco, guantes, lentes, botines…).</div>' +
  '<div class="metricas" id="epp-metricas"></div>' +
  '<div class="campo" style="margin-top:12px"><input type="search" id="epp-buscar" placeholder="Buscar por trabajador o artículo"></div>' +
  '<div class="seg" data-seg="epp"><button class="on" data-pan="eppPersonas">Por trabajador</button>' +
  '<button data-pan="eppMovs">Movimientos</button></div>' +
  '<div id="pan-eppPersonas"><div id="epp-personas"></div></div>' +
  '<div class="oculto" id="pan-eppMovs"><div id="epp-movs"></div></div>' +
  '<button class="btn btn-cont" id="epp-excel" style="margin-top:12px">Exportar kardex de EPP</button>');

Object.assign(PANTALLAS, {epp:{titulo:"Kardex de EPP", icono:"escudo", perm:"kardex"}});

function pintarEPP(){
  const q = sinTildes(($("epp-buscar") || {}).value || "");
  const todas = salidasEPP();
  const movs = q ? todas.filter(m => sinTildes(m.item + " " + (m.persona || "")).indexOf(q) >= 0) : todas;

  const porPersona = {};
  movs.forEach(m => {
    const p = m.persona || "Sin responsable";
    if(!porPersona[p]) porPersona[p] = {items:{}, total:0, ultima:m.fecha, area:m.area || ""};
    porPersona[p].items[m.item] = (porPersona[p].items[m.item] || 0) + Number(m.cantidad || 0);
    porPersona[p].total += Number(m.cantidad || 0);
    if(m.fecha > porPersona[p].ultima) porPersona[p].ultima = m.fecha;
  });
  const personas = Object.keys(porPersona).sort();

  $("epp-metricas").innerHTML =
    '<div class="metrica"><b>' + personas.length + "</b><span>Trabajadores atendidos</span></div>" +
    '<div class="metrica"><b>' + movs.length + "</b><span>Entregas de EPP</span></div>" +
    '<div class="metrica"><b>' + db.materiales.filter(esEPP).length + "</b><span>Artículos de EPP</span></div>" +
    '<div class="metrica mal"><b>' + db.materiales.filter(m => esEPP(m) && estadoStock(m) !== "disponible").length +
      "</b><span>EPP en stock crítico</span></div>";

  $("epp-personas").innerHTML = personas.length
    ? personas.map(p => {
        const d = porPersona[p];
        const det = Object.keys(d.items).map(k => k + " ×" + d.items[k]).join(" · ");
        return '<div class="fila"><span class="mini ok">' + ico("usuario", 20) + "</span>" +
          '<span class="txt"><b>' + esc(p) + "</b><small>" + esc(det) + "</small></span>" +
          '<span class="der"><b>' + d.total + "</b><small>" + hace(d.ultima) + "</small></span></div>";
      }).join("")
    : '<div class="vacio">' + ico("escudo", 40) +
      "Todavía no se ha entregado EPP.<br>Se registra al dar salida a cascos, guantes, lentes y similares.</div>";

  $("epp-movs").innerHTML = movs.length
    ? movs.slice(0, 200).map(filaMov).join("")
    : '<div class="vacio">Sin movimientos de EPP.</div>';
  $$("#epp-movs [data-mov]").forEach(b => b.addEventListener("click", ()=> detalleMov(b.dataset.mov)));
}

$("epp-buscar").addEventListener("input", pintarEPP);
$$('[data-seg="epp"]').forEach(seg => seg.addEventListener("click", e => {
  if(e.target.dataset.pan){ segmento("epp", e.target.dataset.pan); pintarEPP(); }
}));

$("epp-excel").addEventListener("click", ()=>{
  const movs = salidasEPP();
  if(!movs.length) return snack("Todavía no hay entregas de EPP.", "err");
  const porPersona = {};
  movs.forEach(m => {
    const p = m.persona || "Sin responsable";
    if(!porPersona[p]) porPersona[p] = {};
    porPersona[p][m.item] = (porPersona[p][m.item] || 0) + Number(m.cantidad || 0);
  });
  const resumen = [["Trabajador","Artículo de EPP","Cantidad"]];
  Object.keys(porPersona).sort().forEach(p =>
    Object.keys(porPersona[p]).forEach(k => resumen.push([p, k, porPersona[p][k]])));

  const detalle = [["Fecha","Trabajador","Área","Artículo","Cantidad","Unidad","Entregó","Observaciones"]]
    .concat(movs.map(m => [fecha(m.fecha), m.persona || "", m.area || "", m.item,
      m.cantidad, m.unidad, m.registro || "", m.obs || ""]));

  descargarBlob("kardex_epp_" + hoyISO() + ".xlsx", crearXLSX([
    {nombre:"Por trabajador", filas:resumen, estilos:[1]},
    {nombre:"Detalle", filas:detalle, estilos:[1]}
  ]));
  auditar("movimientos", "Kardex de EPP exportado", {comentario:movs.length + " entregas"});
  guardar();
  snack("Kardex de EPP exportado.", "ok");
});

const refrescarV9 = refrescar;
refrescar = function(destino){
  refrescarV9(destino);
  if(destino === "epp") pintarEPP();
};

/* ---------------------------------------------------------------
   V10.2  Accesos rápidos como tareas, según el cargo
   --------------------------------------------------------------- */
(function estilosTareas(){
  if($("estilos-tareas")) return;
  const s = document.createElement("style");
  s.id = "estilos-tareas";
  s.textContent =
    ".tareas{display:flex;flex-direction:column;gap:9px}" +
    ".tarea{display:flex;align-items:center;gap:12px;background:var(--sup);border-radius:var(--r-m);" +
      "padding:13px;box-shadow:var(--s1);width:100%;text-align:left;transition:transform .12s}" +
    ".tarea:active{transform:scale(.99)}" +
    ".tarea .n{width:42px;height:42px;border-radius:13px;background:var(--pri-cont);color:var(--pri);" +
      "display:flex;align-items:center;justify-content:center;flex:none}" +
    ".tarea.destacada .n{background:var(--sec);color:#fff}" +
    ".tarea .t{flex:1;min-width:0}" +
    ".tarea .t b{display:block;font-size:14.5px;font-weight:600}" +
    ".tarea .t small{display:block;font-size:12px;color:var(--tinta-sec);line-height:1.35}" +
    ".tarea .p{flex:none;color:var(--borde)}" +
    ".tarea .glob{background:var(--mal);color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:3px 8px;flex:none}";
  document.head.appendChild(s);
})();

/* Cuántos elementos esperan la acción de este cargo */
function pendientesDe(clave){
  const req = db.requerimientos;
  if(clave === "verificar") return req.filter(r => ["en_compra","compra_proceso","despachado"].indexOf(r.estado) >= 0).length;
  if(clave === "atender")   return req.filter(r => ["pendiente","solicitado","revisado","material_recibido","entrega_parcial"].indexOf(r.estado) >= 0).length;
  if(clave === "revisar")   return req.filter(r => ["pendiente","solicitado","revisado"].indexOf(r.estado) >= 0).length;
  if(clave === "vb")        return req.filter(r => ["enviado_logistica","consolidado"].indexOf(r.estado) >= 0).length;
  if(clave === "comprar")   return req.filter(r => ["aprobado","compra_aprobada"].indexOf(r.estado) >= 0).length;
  if(clave === "guia")      return req.filter(r => ["compra_proceso","en_compra"].indexOf(r.estado) >= 0).length;
  if(clave === "mios"){
    const u = usuarioActual();
    return req.filter(r => r.solicitanteId === u.id && ABIERTOS.indexOf(r.estado) >= 0).length;
  }
  return 0;
}

function tareasDelCargo(){
  const rol = rolEfectivo();
  const T = [];

  if(rol === "almacenero" || rol === "admin"){
    T.push({ic:"pedidos", t:"Nuevo requerimiento", d:"Lo que le piden en almacén · va a la Administradora de Obra", fn:()=> abrirRequerimiento(), destacada:true});
    T.push({ic:"pdf", t:"Recibir y verificar guía", d:"Compruebe si llegó completo lo que se pidió", n:pendientesDe("verificar"), fn:()=> ir("guias"), destacada:true});
    T.push({ic:"caja", t:"Atender pedidos", d:"Revise el stock, prepare y entregue lo solicitado", n:pendientesDe("atender"), fn:()=> ir("atencion")});
    T.push({ic:"camion", t:"Entregar material al trabajador", d:"Salida de consumibles con su responsable", fn:()=> ir("movimientos", "mSalida")});
    T.push({ic:"llave", t:"Prestar herramienta", d:"A quién, hasta cuándo y con foto del responsable", fn:()=> abrirPrestamo()});
    T.push({ic:"escudo", t:"Kardex de EPP", d:"Qué EPP recibió cada trabajador", fn:()=> ir("epp")});
    T.push({ic:"reloj", t:"Mis requerimientos", d:"En qué va cada pedido que levantó", n:pendientesDe("mios"), fn:()=> ir("pedidos")});
  }

  if(rol === "obra"){
    T.push({ic:"pedidos", t:"Subir un requerimiento", d:"Se envía al área de logística para su verificación", fn:()=> abrirRequerimiento(), destacada:true});
    T.push({ic:"check", t:"Revisar pedidos de los supervisores", d:"Apruébelos y envíelos a logística", n:pendientesDe("revisar"), fn:()=> ir("pedidos")});
    T.push({ic:"tabla", t:"Consolidado de obra", d:"Qué falta comprar y qué ya llegó", fn:()=> ir("consolidado")});
    T.push({ic:"grafico", t:"Ver avance e indicadores", d:"Tiempos de atención y pendientes", fn:()=> ir("indicadores")});
    T.push({ic:"inventario", t:"Consultar inventario", d:"Stock actual del almacén de mina", fn:()=> ir("inventario")});
  }

  if(rol === "jefatura"){
    T.push({ic:"check", t:"Dar visto bueno a los pedidos", d:"Autorice para que Compras pueda comprar", n:pendientesDe("vb"), fn:()=> ir("pedidos"), destacada:true});
    T.push({ic:"alerta", t:"Materiales faltantes", d:"Lo que el almacén no pudo cubrir", fn:()=> ir("logistica")});
    T.push({ic:"carrito", t:"Seguimiento de compras", d:"Órdenes, cotizaciones y proveedores", fn:()=> ir("compras")});
    T.push({ic:"grafico", t:"Dashboard e indicadores", d:"Estado general de la obra", fn:()=> ir("dashboard")});
    T.push({ic:"documento", t:"Reportes", d:"Informe del día para la jefatura", fn:()=> ir("reportes")});
  }

  if(rol === "compras"){
    T.push({ic:"carrito", t:"Comprar lo aprobado", d:"Registre cada artículo con su foto", n:pendientesDe("comprar"), fn:()=> ir("articulos"), destacada:true});
    T.push({ic:"pdf", t:"Subir la guía de remisión", d:"Para que el almacén verifique lo enviado", n:pendientesDe("guia"), fn:()=> ir("guias")});
    T.push({ic:"documento", t:"Orden de compra", d:"Número, proveedor y monto", fn:()=> ir("compras", "cOrden")});
    T.push({ic:"pedidos", t:"Pedidos por atender", d:"Lo que espera compra", fn:()=> ir("compras", "cPendientes")});
    T.push({ic:"camion", t:"Proveedores y cotizaciones", d:"Compare precios antes de comprar", fn:()=> ir("logistica")});
  }

  if(rol === "supervisor"){
    const u = usuarioActual();
    T.push({ic:"pedidos", t:"Nuevo requerimiento", d:"Se envía a la Administradora de Obra", fn:()=> abrirRequerimiento(), destacada:true});
    T.push({ic:"subir", t:"Cargar mi pedido desde Excel", d:"Suba su requerimiento diario ya listo", fn:()=>{ abrirRequerimiento(); setTimeout(()=>{ const b = $("mr-subir"); if(b) b.scrollIntoView({block:"center"}); }, 300); }});
    T.push({ic:"reloj", t:"Mis pedidos", d:"En qué va cada uno de sus requerimientos", n:pendientesDe("mios"), fn:()=> ir("pedidos")});
    T.push({ic:"inventario", t:"Ver inventario", d:"Qué hay disponible en el almacén", fn:()=> ir("inventario")});
    T.push({ic:"tabla", t:"Consolidado de obra", d:"Avance de los materiales de " + esc(u.area || "su área"), fn:()=> ir("consolidado")});
  }

  if(rol === "admin"){
    T.push({ic:"documento", t:"Reporte diario", d:"Su trabajo y todo lo ocurrido en la app", fn:()=>{ ir("reportes"); setTimeout(()=>{ const b = $("rd-ver"); if(b) b.click(); }, 350); }});
    T.push({ic:"cambiar", t:"Ver la app como otro cargo", d:"Recorra la aplicación con sus permisos", fn:()=> abrirSimulacion()});
    T.push({ic:"escudo", t:"Panel de administración", d:"Usuarios, solicitudes y auditoría", fn:()=> ir("admin")});
  }

  if(simulando()){
    T.push({ic:"cambiar", t:"Salir de la simulación", d:"Volver a su cuenta de administrador", fn:salirSimulacion});
  }
  return T;
}

function pintarTareas(){
  const cont = $("ini-accesos");
  if(!cont) return;
  const T = tareasDelCargo();
  cont.className = "tareas";
  cont.innerHTML = T.map((x, i) =>
    '<button class="tarea' + (x.destacada ? " destacada" : "") + '" data-tarea="' + i + '">' +
    '<span class="n">' + ico(x.ic, 21) + "</span>" +
    '<span class="t"><b>' + esc(x.t) + "</b><small>" + esc(x.d) + "</small></span>" +
    (x.n ? '<span class="glob">' + x.n + "</span>" : "") +
    '<span class="p">' + ico("flecha", 18) + "</span></button>").join("");
  $$("#ini-accesos [data-tarea]").forEach(b => b.addEventListener("click", ()=>{
    const t = T[+b.dataset.tarea];
    if(t && t.fn) t.fn();
  }));
  const titulo = cont.previousElementSibling;
  if(titulo && titulo.classList.contains("sech")) titulo.innerHTML = "Mis tareas";
}

const pintarInicioV9 = pintarInicio;
pintarInicio = function(){
  pintarInicioV9();
  pintarTareas();
};

/* ---------------------------------------------------------------
   V10.3  El circuito, contado en una línea por cargo
   --------------------------------------------------------------- */
const CIRCUITO_V10 = [
  {t:"1. Requerimiento", d:"Supervisor o Administración de Obra"},
  {t:"2. Administración de Obra", d:"Revisa y lo envía a logística"},
  {t:"3. Jefa de Logística", d:"Da el visto bueno"},
  {t:"4. Compras", d:"Compra y sube la guía"},
  {t:"5. Almacén", d:"Verifica la guía e ingresa al almacén de mina"},
  {t:"6. Entrega", d:"Al trabajador, con su firma"}
];

const pintarCircuitoV9 = pintarCircuito;
pintarCircuito = function(){
  pintarCircuitoV9();
  const card = $("pe-circuito");
  if(!card) return;
  const cont = card.querySelector(".circuito");
  if(cont) cont.innerHTML = CIRCUITO_V10.map(c =>
    '<div class="c"><b>' + c.t + "</b><small>" + c.d + "</small></div>").join("");
};

/* El pedido de un supervisor le toca primero a la Administradora de Obra */
const siguientePasoV9 = siguientePaso;
siguientePaso = function(r){
  const p = siguientePasoV9(r);
  if(["pendiente","solicitado","revisado","observado"].indexOf(r.estado) >= 0){
    /* V42 · Todo pedido pasa primero por Obra, sin importar quién lo levantó. */
    const autor = db.usuarios.find(u => u.id === r.solicitanteId);
    const de = autor && autor.rol === "supervisor" ? "del supervisor"
             : (autor && autor.rol === "almacenero" ? "del almacén" : "");
    return {quien:"Administradora de Obra",
            texto:("Revisar el pedido " + de).trim() + " y enviarlo a logística."};
  }
  return p;
};

/* El módulo de EPP aparece en Más para quien maneja kardex */
const pintarMasV5 = pintarMas;
pintarMas = function(){
  pintarMasV5();
  if(!puede("kardex")) return;
  const dup = $("mas-modulos").querySelector('[data-ir2="epp"],[data-ir3="epp"],[data-ir5="epp"]');
  if(dup) dup.remove();
  if($("mas-modulos").querySelector("[data-ir10]")) return;
  $("mas-modulos").insertAdjacentHTML("afterbegin",
    '<button class="fila" data-ir10="epp"><span class="mini">' + ico("escudo", 20) + "</span>" +
    '<span class="txt"><b>Kardex de EPP</b><small>Qué EPP recibió cada trabajador</small></span>' +
    '<span class="der">' + ico("flecha", 18) + "</span></button>");
  $("mas-modulos").querySelector("[data-ir10]").addEventListener("click", ()=> ir("epp"));
};


/* ---------------------------------------------------------------
   V10  Mejoras del Administrador
        1) La actividad de la aplicación es exclusiva del Administrador.
        2) Botón «volver» arriba a la izquierda con historial real.
        3) Reporte de todas las personas involucradas (solo admin).
        4) Botón grande del consolidado con gráfica circular porcentual.
   --------------------------------------------------------------- */

/* --- 1. Actividad solo para el Administrador --- */
const puedeV10 = puede;
puede = function(permiso){
  if(typeof permiso === "string" && permiso.indexOf("historial") === 0 && !esCuentaAdmin()) return false;
  return puedeV10(permiso);
};

/* --- 2. Botón volver con historial de navegación --- */
let pilaNav = [], navAtras = false;

function actualizarVolverV10(){
  const b = $("btn-volver");
  if(b) b.classList.toggle("oculto", !sesion || !pilaNav.length || pantalla === "inicio");
}

const irV10 = ir;
ir = function(destino, panel){
  const antes = pantalla;
  irV10(destino, panel);
  if(sesion && pantalla === destino && !navAtras && destino !== antes &&
     antes !== "login" && antes !== "solicitud"){
    pilaNav.push(antes);
    if(pilaNav.length > 40) pilaNav.shift();
  }
  actualizarVolverV10();
};

(function botonVolverV10(){
  const b = $("btn-volver");
  if(!b) return;
  const n = b.cloneNode(true);
  b.parentNode.replaceChild(n, b);
  n.innerHTML = ico("volver", 22);
  n.addEventListener("click", ()=>{
    navAtras = true;
    ir(pilaNav.pop() || "inicio");
    navAtras = false;
    actualizarVolverV10();
  });
})();

const salirV10 = salir;
salir = function(){ pilaNav = []; navAtras = false; salirV10(); };

/* --- 3. Reporte de personas involucradas (exclusivo del admin) --- */
function datosPersonasInvolucradas(){
  const acc = {};
  db.historial.forEach(h => {
    const n = h.usuario || "sistema";
    if(!acc[n]) acc[n] = {n:0, ultima:h.fecha};
    acc[n].n++;
  });
  const usuarios = db.usuarios.map(u => ({
    nombre:u.nombre, usuario:u.usuario,
    cargo:u.cargo || (ROLES[u.rol] ? ROLES[u.rol].nombre : u.rol),
    rol:(ROLES[u.rol] ? ROLES[u.rol].corto : u.rol) + (u.esAdmin ? " · Admin" : ""),
    activo:u.activo,
    acciones:(acc[u.nombre] || {}).n || 0,
    ultimaAccion:(acc[u.nombre] || {}).ultima || null,
    ultimoAcceso:u.ultimoAcceso
  })).sort((a,b)=> b.acciones - a.acciones);

  const rec = {};
  db.movimientos.forEach(m => {
    if(!m.persona || m.tipo === "ingreso") return;
    if(!rec[m.persona]) rec[m.persona] = {entregas:0, prestamos:0, area:m.area || ""};
    if(m.tipo === "prestamo") rec[m.persona].prestamos++; else rec[m.persona].entregas++;
    if(m.area) rec[m.persona].area = m.area;
  });
  const receptores = Object.keys(rec).map(n => Object.assign({nombre:n}, rec[n]))
    .sort((a,b)=> (b.entregas + b.prestamos) - (a.entregas + a.prestamos));

  return {usuarios, receptores};
}

function libroPersonas(){
  const d = datosPersonasInvolucradas();
  return crearXLSX([
    {nombre:"Usuarios de la app", filas:
      [["Nombre","Usuario","Cargo","Rol","Estado","Acciones en la app","Última acción","Último acceso"]]
      .concat(d.usuarios.map(u => [u.nombre, u.usuario, u.cargo, u.rol,
        u.activo ? "Activo" : "Inactivo", u.acciones,
        u.ultimaAccion ? fecha(u.ultimaAccion) : "—",
        u.ultimoAcceso ? fecha(u.ultimoAcceso) : "Nunca"]))},
    {nombre:"Personal que recibio", filas:
      [["Persona","Área","Entregas de material","Préstamos de herramienta"]]
      .concat(d.receptores.map(r => [r.nombre, r.area || "—", r.entregas, r.prestamos]))}
  ]);
}

async function enviarReportePersonas(){
  if(!esCuentaAdmin()) return;
  const d = datosPersonasInvolucradas();
  const nombre = "personas_involucradas_" + hoyISO() + ".xlsx";
  const blob = libroPersonas();
  const activos = d.usuarios.filter(u => u.acciones > 0).length;
  const cuerpo =
    "Reporte de personas involucradas al " + soloFecha(hoyISO()) + ".\n\n" +
    "Usuarios de la aplicación: " + d.usuarios.length + " (" + activos + " con actividad)\n" +
    "Personal que recibió materiales o herramientas: " + d.receptores.length + "\n\n" +
    "Generado por " + usuarioActual().nombre + ".";
  const ok = await compartirArchivo(nombre, blob, "Personas involucradas · Almacén", cuerpo);
  if(!ok) descargarBlob(nombre, blob);
  auditar("reportes", "Reporte de personas involucradas enviado",
    {comentario:d.usuarios.length + " usuarios, " + d.receptores.length + " receptores"});
  guardar();
  snack(ok ? "Reporte compartido." : "Reporte descargado.", "ok");
}

function verReportePersonas(){
  if(!cuentaEsAdmin()) return;
  const d = datosPersonasInvolucradas();
  hoja("Personas involucradas",
    '<div class="sech" style="margin:0 0 6px">Usuarios de la aplicación (' + d.usuarios.length + ')</div>' +
    d.usuarios.map(u =>
      '<div class="linea"><span class="pt" style="background:' + (u.activo ? "var(--ok)" : "var(--mal)") + '"></span>' +
      '<span class="txt"><b>' + esc(u.nombre) + " · " + esc(u.rol) + "</b><small>" +
      esc(u.cargo) + " · " + u.acciones + " acciones · último acceso " +
      (u.ultimoAcceso ? hace(u.ultimoAcceso) : "nunca") + "</small></span></div>").join("") +
    '<div class="sech" style="margin:16px 0 6px">Personal que recibió material o herramientas (' +
    d.receptores.length + ")</div>" +
    (d.receptores.length
      ? d.receptores.map(r =>
        '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(r.nombre) + "</b><small>" +
        (r.area ? esc(r.area) + " · " : "") + r.entregas + " entregas · " + r.prestamos +
        " préstamos</small></span></div>").join("")
      : '<div class="ayuda" style="margin:0">Sin entregas registradas todavía.</div>'),
    [{txt:"Enviármelo", clase:"btn-sec", fn:enviarReportePersonas},
     {txt:"Excel", clase:"btn-pri", fn:()=>{
       descargarBlob("personas_involucradas_" + hoyISO() + ".xlsx", libroPersonas());
       snack("Excel descargado.", "ok");
     }},
     {txt:"Cerrar", clase:"btn-cont"}]);
  auditar("reportes", "Reporte de personas involucradas consultado",
    {comentario:d.usuarios.length + " usuarios"});
  guardar();
}

function pintarReportePersonasV10(){
  let card = $("pi-reporte");
  if(!esCuentaAdmin()){ if(card) card.classList.add("oculto"); return; }
  if(!card){
    card = document.createElement("div");
    card.id = "pi-reporte";
    card.className = "card acento";
    card.innerHTML =
      '<div style="font-weight:700;font-size:15px;margin-bottom:3px">Personas involucradas</div>' +
      '<p class="ayuda" style="margin:0 0 11px">Todos los usuarios de la aplicación y el personal ' +
      'que recibió materiales o herramientas.</p>' +
      '<div class="btns"><button class="btn btn-pri" id="pi-ver">Ver reporte</button>' +
      '<button class="btn btn-sec" id="pi-enviar">Enviármelo</button></div>';
    $("ini-accesos").insertAdjacentElement("afterend", card);
    $("pi-ver").addEventListener("click", verReportePersonas);
    $("pi-enviar").addEventListener("click", ()=>{ if(cuentaEsAdmin()) enviarReportePersonas(); });
  }
  card.classList.remove("oculto");
}

/* --- 4. Botón grande del consolidado con gráfica circular --- */
function pintarBotonConsolidadoV10(){
  let card = $("ini-consolidado");
  if(!puede("consolidado")){ if(card) card.remove(); return; }
  if(!card){
    card = document.createElement("button");
    card.id = "ini-consolidado";
    card.className = "card";
    card.style.cssText = "width:100%;display:flex;align-items:center;gap:16px;text-align:left;margin-top:11px";
    $("ini-metricas").insertAdjacentElement("afterend", card);
    card.addEventListener("click", ()=> ir("consolidado"));
  }
  const a = avanceConsolidado();
  const r = 30, c = 2 * Math.PI * r;
  const off = (c * (1 - Math.min(a.avance, 100) / 100)).toFixed(1);
  const color = a.avance >= 100 ? "var(--ok)" : (a.avance >= 50 ? "var(--pri)" : "var(--sec)");
  card.innerHTML =
    '<svg viewBox="0 0 76 76" width="78" height="78" style="flex:none" role="img" aria-label="Avance ' +
    a.avance + '%">' +
    '<circle cx="38" cy="38" r="30" fill="none" stroke="var(--sup-var)" stroke-width="9"/>' +
    '<circle cx="38" cy="38" r="30" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round" ' +
    'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off + '" transform="rotate(-90 38 38)" ' +
    'style="transition:stroke-dashoffset .6s cubic-bezier(.2,.8,.3,1)"/>' +
    '<text x="38" y="43" text-anchor="middle" font-size="16" font-weight="700" fill="' + color + '">' +
    a.avance + "%</text></svg>" +
    '<span style="flex:1;min-width:0">' +
    '<b style="display:block;font-size:16px">Consolidado de obra</b>' +
    '<small style="display:block;color:var(--tinta-sec);font-size:12.5px;margin-top:2px">' +
    (a.total
      ? a.entregados + " de " + a.total + " materiales completados · " + a.pendientes + " por comprar"
      : "Todavía no hay materiales cargados") + "</small></span>" +
    '<span style="flex:none;color:var(--pri)">' + ico("flecha", 20) + "</span>";
}

/* La gráfica se actualiza sola cada vez que cambian los datos */
const guardarV10 = guardar;
guardar = function(){
  guardarV10();
  if(pantalla === "inicio" && $("ini-consolidado")) pintarBotonConsolidadoV10();
};

/* --- Integración con la pantalla de inicio --- */
const pintarInicioV10 = pintarInicio;
pintarInicio = function(){
  pintarInicioV10();
  const cont = $("ini-actividad");
  if(cont){
    /* La actividad reciente es de la Administradora de Obra. Los demás
       cargos no la ven, ni siquiera el administrador de la app mientras
       trabaja como almacenero: la ve al entrar en modo administrador. */
    const r = rolEfectivo();
    const esconder = !(r === "obra" || r === "admin");
    cont.classList.toggle("oculto", esconder);
    const titulo = cont.previousElementSibling;
    if(titulo && titulo.classList.contains("sech")) titulo.classList.toggle("oculto", esconder);
  }
  pintarBotonConsolidadoV10();
  pintarReportePersonasV10();
  actualizarVolverV10();
};

/* ---------------------------------------------------------------
   V11  Inicio: resumen logístico + tareas en botones grandes
        1) Una sola viñeta «Resumen logístico» con tres cifras;
           al tocarla se abre el desglose completo.
        2) Las tareas del cargo pasan a botones grandes, dos por fila.
           «Ver la app como otro cargo» ocupa la fila entera, igual que
           la última tarea suelta cuando el cargo tiene un número impar.
   --------------------------------------------------------------- */

(function estilosV11(){
  if($("estilos-v11")) return;
  const s = document.createElement("style");
  s.id = "estilos-v11";
  s.textContent =
    ".tareas.rejilla{display:grid;grid-template-columns:1fr 1fr;gap:9px;align-items:stretch}" +
    ".tareas.rejilla .tarea{flex-direction:column;align-items:flex-start;gap:0;padding:12px;" +
      "position:relative;border-radius:var(--r-m);height:100%}" +
    ".tareas.rejilla .tarea .n{width:40px;height:40px;border-radius:13px;margin-bottom:9px}" +
    ".tareas.rejilla .tarea .t{flex:none;width:100%}" +
    ".tareas.rejilla .tarea .t b{font-size:13px;line-height:1.3;white-space:normal}" +
    ".tareas.rejilla .tarea .t small{font-size:10.5px;line-height:1.35;margin-top:3px;white-space:normal}" +
    ".tareas.rejilla .tarea .p{display:none}" +
    ".tareas.rejilla .tarea .glob{position:absolute;top:9px;right:9px;font-size:10px;padding:2px 7px}" +
    ".tareas.rejilla .tarea.ancha{grid-column:1/-1;flex-direction:row;align-items:center;gap:12px;padding:13px}" +
    ".tareas.rejilla .tarea.ancha .n{margin-bottom:0}" +
    ".tareas.rejilla .tarea.ancha .t{flex:1;min-width:0}" +
    ".tareas.rejilla .tarea.ancha .t b{font-size:14px}" +
    ".tareas.rejilla .tarea.ancha .t small{font-size:11.5px}" +
    ".tareas.rejilla .tarea.ancha .p{display:block}" +
    ".tareas.rejilla .tarea.simular{background:var(--pri)}" +
    ".tareas.rejilla .tarea.simular .n{background:rgba(255,255,255,.18);color:#fff}" +
    ".tareas.rejilla .tarea.simular .t b{color:#fff}" +
    ".tareas.rejilla .tarea.simular .t small{color:#B7CBEA}" +
    ".tareas.rejilla .tarea.simular .p{color:#fff}" +
    "#ini-resumen{width:100%;background:var(--sup);border-radius:var(--r-m);padding:13px;" +
      "margin-bottom:11px;box-shadow:var(--s1);text-align:left;transition:transform .12s}" +
    "#ini-resumen:active{transform:scale(.99)}" +
    "#ini-resumen .cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}" +
    "#ini-resumen .cab b{font-size:14.5px;font-weight:600}" +
    "#ini-resumen .cab span{font-size:11.5px;color:var(--pri);font-weight:600;display:flex;align-items:center;gap:2px}" +
    "#ini-resumen .cifras{display:flex;gap:7px}" +
    "#ini-resumen .cifra{flex:1;border-radius:10px;padding:8px;text-align:center;background:var(--sup-var)}" +
    "#ini-resumen .cifra b{display:block;font-size:18px;color:var(--pri);font-variant-numeric:tabular-nums}" +
    "#ini-resumen .cifra small{font-size:10px;color:var(--tinta-sec);font-weight:600}" +
    "#ini-resumen .cifra.alerta{background:var(--alerta-f)}" +
    "#ini-resumen .cifra.alerta b,#ini-resumen .cifra.alerta small{color:var(--alerta)}" +
    "#ini-resumen .cifra.ok{background:var(--ok-f)}" +
    "#ini-resumen .cifra.ok b,#ini-resumen .cifra.ok small{color:var(--ok)}";
  document.head.appendChild(s);
})();

/* --- Tareas en dos columnas --- */
const pintarTareasV11 = pintarTareas;
pintarTareas = function(){
  pintarTareasV11();
  const cont = $("ini-accesos");
  if(!cont) return;
  cont.classList.add("rejilla");
  $$("#ini-accesos .tarea").forEach(t => {
    const b = t.querySelector(".t b");
    const txt = b ? b.textContent : "";
    /* la simulación va siempre al final, así no deja huecos en la rejilla */
    if(/otro cargo|simulaci/i.test(txt)){
      t.classList.add("ancha", "simular");
      cont.appendChild(t);
    }
  });
  const normales = $$("#ini-accesos .tarea").filter(t => !t.classList.contains("ancha"));
  if(normales.length % 2 === 1) normales[normales.length - 1].classList.add("ancha");
};

/* --- Resumen logístico --- */
function datosResumenLogistico(){
  const mios = misPedidos();
  const enCurso = mios.filter(r => ABIERTOS.indexOf(r.estado) >= 0);
  const porComprar = puede("pedidos.todos")
    ? db.requerimientos.filter(r => ["aprobado","compra_aprobada","enviado_logistica","consolidado"].indexOf(r.estado) >= 0)
    : mios.filter(r => ["aprobado","compra_aprobada","enviado_logistica","consolidado"].indexOf(r.estado) >= 0);
  const d = datosEjecutivos(hoyISO());
  const criticos = db.materiales.filter(x => estadoStock(x) !== "disponible");
  return {
    enCurso, porComprar, criticos,
    entregasHoy:d.entregados, prestamosHoy:d.prestamos, recibidosHoy:d.recibidos,
    incidencias:d.incidencias,
    prestadas:db.herramientas.filter(h => h.estado === "prestada"),
    avance:db.consolidado.items.length ? avanceConsolidado() : null
  };
}

function verDesgloseLogistico(){
  const r = datosResumenLogistico();
  const li = (k,v) => '<div class="dato"><span>' + k + "</span><b>" + v + "</b></div>";
  const lista = (arr, vacio, fn) => arr.length
    ? arr.slice(0, 8).map(fn).join("")
    : '<div class="ayuda" style="margin:0">' + vacio + "</div>";

  hoja("Resumen logístico · " + soloFecha(hoyISO()),
    '<div class="sech" style="margin:0 0 6px">Pedidos</div>' +
    li("En curso", r.enCurso.length) +
    li("Esperando compra", r.porComprar.length) +
    li("Registrados hoy", r.recibidosHoy.length) +
    li("Con incidencia", r.incidencias.length) +

    '<div class="sech" style="margin:16px 0 6px">Movimiento del día</div>' +
    li("Entregas de material", r.entregasHoy.length) +
    li("Préstamos de herramienta", r.prestamosHoy.length) +
    li("Herramientas fuera del almacén", r.prestadas.length) +

    '<div class="sech" style="margin:16px 0 6px">Almacén</div>' +
    li("Artículos en stock crítico", r.criticos.length) +
    (r.avance ? li("Avance del consolidado", r.avance.avance + "%") +
                li("Materiales completados", r.avance.entregados + " de " + r.avance.total) : "") +

    '<div class="sech" style="margin:16px 0 6px">Pedidos en curso</div>' +
    lista(r.enCurso, "No hay pedidos abiertos.", x =>
      '<div class="linea"><span class="pt"></span><span class="txt"><b>' + esc(x.codigo || "Pedido") +
      "</b><small>" + esc(ESTADOS[x.estado] ? ESTADOS[x.estado].texto : x.estado) +
      " · " + hace(x.fecha) + "</small></span></div>") +

    (r.criticos.length
      ? '<div class="sech" style="margin:16px 0 6px">Stock crítico</div>' +
        lista(r.criticos, "", x =>
          '<div class="linea"><span class="pt" style="background:var(--mal)"></span>' +
          '<span class="txt"><b>' + esc(x.nombre) + "</b><small>" +
          x.cantidad + " " + esc(x.unidad || "und") + " · mínimo " + (x.minimo || 0) + "</small></span></div>")
      : ""),

    [{txt:"Ver pedidos", clase:"btn-pri", fn:()=> ir("pedidos")},
     {txt:"Consolidado", clase:"btn-cont", fn:()=> ir("consolidado")},
     {txt:"Cerrar", clase:"btn-cont"}]);
}

function pintarResumenLogistico(){
  const metricas = $("ini-metricas");
  if(!metricas) return;
  metricas.classList.add("oculto");
  let card = $("ini-resumen");
  if(!card){
    card = document.createElement("button");
    card.id = "ini-resumen";
    metricas.insertAdjacentElement("beforebegin", card);
    card.addEventListener("click", verDesgloseLogistico);
  }
  const r = datosResumenLogistico();
  const cifra = (v, t, c) => '<span class="cifra ' + (c || "") + '"><b>' + v + "</b><small>" + t + "</small></span>";
  card.innerHTML =
    '<span class="cab"><b>Resumen logístico</b><span>Ver desglose ' + ico("flecha", 14) + "</span></span>" +
    '<span class="cifras">' +
      cifra(r.enCurso.length, "Pedidos") +
      cifra(r.porComprar.length, "Por comprar", "alerta") +
      cifra(r.avance ? r.avance.avance + "%" : r.criticos.length,
            r.avance ? "Avance" : "Stock crítico", r.avance ? "ok" : "alerta") +
    "</span>";
}

const pintarInicioV11 = pintarInicio;
pintarInicio = function(){
  pintarInicioV11();
  pintarResumenLogistico();
};

const guardarV11 = guardar;
guardar = function(){
  guardarV11();
  if(pantalla === "inicio" && $("ini-resumen")) pintarResumenLogistico();
};

/* ---------------------------------------------------------------
   V12  Cuatro cambios pedidos:
        1) La carga desde Excel es una opción dentro del formulario.
        2) El supervisor solo hace requerimientos (y consulta stock),
           con su propia pantalla «Mis materiales».
        3) El panel de administrador se separa del de almacenero.
        4) La Administradora de Obra genera su reporte diario.
   --------------------------------------------------------------- */

(function estilosV12(){
  if($("estilos-v12")) return;
  const s = document.createElement("style");
  s.id = "estilos-v12";
  s.textContent =
    "#mr-modo{display:flex;background:var(--sup-var);border-radius:var(--r-full);padding:4px;gap:4px;margin-bottom:13px}" +
    "#mr-modo button{flex:1;background:transparent;color:var(--tinta-sec);font-size:12.5px;font-weight:600;" +
      "height:38px;border-radius:var(--r-full);display:flex;align-items:center;justify-content:center;gap:6px}" +
    "#mr-modo button.on{background:var(--sup);color:var(--pri);box-shadow:var(--s1)}" +
    "#mr-excel.destacado{background:var(--sup);border:1.5px dashed var(--pri)}" +
    ".barra-admin .appbar,.appbar.admin{background:var(--lila)}" +
    ".appbar.admin .tit small{color:#D5CFF3}" +
    ".appbar.admin .avatar{background:var(--lila-f);color:var(--lila)}" +
    ".tareas.rejilla .tarea.gob .n{background:var(--lila-f);color:var(--lila)}" +
    ".tareas.rejilla .tarea.simular{background:var(--lila)}" +
    "#ini-aviso-admin{background:var(--lila-f);border-radius:12px;padding:10px;margin-bottom:11px;" +
      "display:flex;align-items:center;gap:9px;color:#3C3489;font-size:11.5px;line-height:1.4}" +
    "#mm-barra{height:7px;background:var(--sup-var);border-radius:var(--r-full);overflow:hidden}" +
    ".mm-item{background:var(--sup);border-radius:var(--r-m);padding:12px;margin-bottom:9px;box-shadow:var(--s1)}" +
    ".mm-item .cab{display:flex;align-items:center;gap:8px;margin-bottom:7px}" +
    ".mm-item .cab b{flex:1;font-size:13px;font-weight:600}" +
    ".mm-item .via{height:7px;background:var(--sup-var);border-radius:var(--r-full);overflow:hidden}" +
    ".mm-item .lleno{height:7px;border-radius:var(--r-full)}" +
    ".mm-item .pie{font-size:10.5px;color:var(--tinta-sec);margin-top:6px}";
  document.head.appendChild(s);
})();

/* =========== 1. Excel como opción dentro de Nuevo requerimiento =========== */
let modoReq = "mano";

(function opcionesRequerimiento(){
  const excel = $("mr-excel");
  if(!excel || $("mr-modo")) return;
  const sel = document.createElement("div");
  sel.id = "mr-modo";
  sel.innerHTML =
    '<button data-modo="mano" class="on">' + ico("editar", 16) + "A mano</button>" +
    '<button data-modo="excel">' + ico("tabla", 16) + "Desde Excel</button>";
  excel.insertAdjacentElement("beforebegin", sel);
  excel.classList.add("destacado");
  $$("#mr-modo button").forEach(b => b.addEventListener("click", ()=> ponerModoReq(b.dataset.modo)));
})();

function ponerModoReq(modo){
  modoReq = modo;
  $$("#mr-modo button").forEach(b => b.classList.toggle("on", b.dataset.modo === modo));
  const excel = $("mr-excel");
  if(excel) excel.classList.toggle("oculto", modo !== "excel");
  /* Lo ya cargado nunca se pierde al cambiar de opción. */
  const titulo = $("mr-items").previousElementSibling;
  if(titulo && titulo.classList && titulo.classList.contains("sech"))
    titulo.textContent = modo === "excel" && itemsReq.length ? "Materiales importados" : "Materiales solicitados";
}

const abrirRequerimientoV12 = abrirRequerimiento;
abrirRequerimiento = function(){
  abrirRequerimientoV12();
  const sel = $("mr-modo");
  if(sel) sel.classList.toggle("oculto", !puede("pedidos.excel"));
  ponerModoReq("mano");
};

/* =========== 2. El supervisor solo hace requerimientos =========== */
ROLES.supervisor.permisos = ["pedidos.ver","pedidos.crear","pedidos.excel","inventario",
                             "notificaciones","fotos","mismateriales"];
ROLES.supervisor.resumen = "Registra sus requerimientos diarios (a mano o desde Excel), sigue en qué va cada uno " +
                           "y consulta el stock del almacén antes de pedir.";

crearPantalla("mismateriales",
  '<div id="mm-resumen"></div>' +
  '<div class="seg" data-seg="mismateriales">' +
  '<button class="on" data-pan="mmMaterial">Por material</button>' +
  '<button data-pan="mmPedido">Por pedido</button></div>' +
  '<div id="pan-mmMaterial"><div id="mm-lista"></div></div>' +
  '<div class="oculto" id="pan-mmPedido"><div id="mm-pedidos"></div></div>');

PANTALLAS.mismateriales = {titulo:"Mis materiales", icono:"tabla", perm:"mismateriales"};

/* Lo que pidió este usuario, material por material */
function misMateriales(){
  const req = misPedidos();
  const mapa = {};
  req.forEach(r => (r.items || []).forEach(it => {
    const clave = (it.desc || "").toLowerCase().trim() + "|" + (it.unidad || "und");
    if(!mapa[clave]) mapa[clave] = {desc:it.desc, unidad:it.unidad || "und", pedido:0, recibido:0, pedidos:[]};
    mapa[clave].pedido += num(it.cant) || 0;
    mapa[clave].recibido += num(it.entregado) || 0;
    if(mapa[clave].pedidos.indexOf(r.codigo) < 0) mapa[clave].pedidos.push(r.codigo);
  }));
  return Object.keys(mapa).map(k => {
    const m = mapa[k];
    m.falta = Math.max(0, +(m.pedido - m.recibido).toFixed(2));
    m.pct = m.pedido > 0 ? Math.min(100, Math.round(m.recibido / m.pedido * 100)) : 0;
    m.estado = m.pct >= 100 ? "completo" : (m.recibido > 0 ? "parcial" : "pendiente");
    return m;
  }).sort((a,b)=> a.pct - b.pct);
}

function avanceDeRequerimiento(r){
  const pedido = (r.items || []).reduce((s,it)=> s + (num(it.cant) || 0), 0);
  const recibido = (r.items || []).reduce((s,it)=> s + Math.min(num(it.entregado) || 0, num(it.cant) || 0), 0);
  return pedido > 0 ? Math.min(100, Math.round(recibido / pedido * 100)) : 0;
}

function pintarMisMateriales(){
  const mats = misMateriales();
  const req = misPedidos();
  const completos = mats.filter(m => m.estado === "completo").length;
  const pendientes = mats.filter(m => m.estado !== "completo").length;
  const pedidoTotal = mats.reduce((s,m)=> s + m.pedido, 0);
  const recibidoTotal = mats.reduce((s,m)=> s + Math.min(m.recibido, m.pedido), 0);
  const pct = pedidoTotal > 0 ? Math.min(100, Math.round(recibidoTotal / pedidoTotal * 100)) : 0;
  const c = 2 * Math.PI * 23;

  $("mm-resumen").innerHTML = mats.length
    ? '<div class="card" style="display:flex;align-items:center;gap:13px">' +
      '<svg viewBox="0 0 60 60" width="56" height="56" style="flex:none" role="img" aria-label="Avance ' + pct + '%">' +
      '<circle cx="30" cy="30" r="23" fill="none" stroke="var(--sup-var)" stroke-width="7"/>' +
      '<circle cx="30" cy="30" r="23" fill="none" stroke="var(--pri)" stroke-width="7" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct/100)).toFixed(1) +
      '" transform="rotate(-90 30 30)"/>' +
      '<text x="30" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="var(--pri)">' + pct + "%</text></svg>" +
      '<div style="flex:1"><b style="display:block;font-size:14px">De todo lo que pedí</b>' +
      '<small style="display:block;font-size:11.5px;color:var(--tinta-sec);margin-top:2px">' +
      completos + " de " + mats.length + " materiales completos · " + pendientes + " pendientes</small></div></div>"
    : "";

  const CHIP = {completo:["ok","Completo"], parcial:["alerta","Parcial"], pendiente:["mal","Pendiente"]};
  const COLOR = {completo:"var(--ok)", parcial:"var(--sec)", pendiente:"var(--mal)"};

  $("mm-lista").innerHTML = mats.length
    ? mats.map(m =>
      '<div class="mm-item"><div class="cab"><b>' + esc(m.desc) + "</b>" +
      '<span class="chip ' + CHIP[m.estado][0] + '">' + CHIP[m.estado][1] + "</span></div>" +
      '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--tinta-sec);margin-bottom:4px">' +
      "<span>" + (m.recibido > 0
        ? "Pedí " + m.pedido + " " + esc(m.unidad) + " · recibí " + m.recibido +
          (m.falta > 0 ? " · faltan " + m.falta : "")
        : "Pedí " + m.pedido + " " + esc(m.unidad) + " · no he recibido nada") +
      '</span><b style="color:var(--tinta)">' + m.pct + "%</b></div>" +
      '<div class="via"><div class="lleno" style="width:' + m.pct + "%;background:" + COLOR[m.estado] + '"></div></div>' +
      '<div class="pie">' + esc(m.pedidos.join(" · ")) + "</div></div>").join("")
    : '<div class="vacio">' + ico("tabla", 40) + "Todavía no ha pedido materiales.<br>Registre su primer requerimiento.</div>";

  $("mm-pedidos").innerHTML = req.length
    ? req.map(r => {
        const p = avanceDeRequerimiento(r);
        const col = p >= 100 ? "var(--ok)" : (p > 0 ? "var(--sec)" : "var(--mal)");
        return '<button class="fila" data-mm-req="' + r.id + '">' +
          '<span class="mini" style="background:transparent">' +
          '<span style="width:11px;height:11px;border-radius:50%;background:' + col + '"></span></span>' +
          '<span class="txt"><b>' + esc(r.codigo) + "</b><small>" +
          (r.items || []).length + " materiales · " +
          esc(ESTADOS[r.estado] ? ESTADOS[r.estado].texto : r.estado) + "</small></span>" +
          '<span class="der"><b style="color:' + col + '">' + p + "%</b></span></button>";
      }).join("")
    : '<div class="vacio">' + ico("pedidos", 40) + "Aún no tiene pedidos registrados.</div>";

  $$("#mm-pedidos [data-mm-req]").forEach(b => b.addEventListener("click", ()=>{
    const r = db.requerimientos.find(x => x.id === b.dataset.mmReq);
    if(r && typeof verRequerimiento === "function") verRequerimiento(r);
  }));
}

const refrescarV12 = refrescar;
refrescar = function(destino){
  refrescarV12(destino);
  if(destino === "mismateriales") pintarMisMateriales();
};

/* =========== 3 y 4. Tareas por cargo, ya separadas =========== */
const tareasDelCargoV12 = tareasDelCargo;
tareasDelCargo = function(){
  const rol = rolEfectivo();

  if(rol === "supervisor"){
    const T = [];
    T.push({ic:"pedidos", t:"Nuevo requerimiento", d:"A mano o desde su Excel",
            fn:()=> abrirRequerimiento(), destacada:true, ancha:true});
    T.push({ic:"reloj", t:"Mis pedidos", d:"En qué va cada uno", n:pendientesDe("mios"), fn:()=> ir("pedidos")});
    T.push({ic:"tabla", t:"Mis materiales", d:"Qué pedí y qué recibí", fn:()=> ir("mismateriales")});
    T.push({ic:"inventario", t:"Consultar inventario", d:"Vea si hay stock antes de pedir", fn:()=> ir("inventario")});
    if(simulando()) T.push({ic:"cambiar", t:"Salir de la simulación", d:"Volver a su cuenta", fn:salirSimulacion});
    return T;
  }

  /* El administrador de la app ya no ve las tareas de almacén */
  if(rol === "admin"){
    const T = [];
    const pend = db.solicitudes.filter(s => s.estado === "pendiente").length;
    T.push({ic:"usuario", t:"Solicitudes de acceso", d:"Aprobar o rechazar", n:pend,
            fn:()=> ir("admin", "aSolicitudes"), gob:true});
    T.push({ic:"personas", t:"Usuarios y cargos", d:"Crear, editar, desactivar",
            fn:()=> ir("admin", "aUsuarios"), gob:true});
    T.push({ic:"reloj", t:"Actividad y auditoría", d:"Quién hizo qué y cuándo",
            fn:()=> ir("historial"), gob:true});
    T.push({ic:"personas", t:"Personas involucradas", d:"Reporte de todo el equipo",
            fn:verReportePersonas, gob:true});
    T.push({ic:"documento", t:"Reporte de la app", d:"Excel, PDF o Word", gob:true,
            fn:()=>{ const b = $("rd-ver") || ($("__reporteAdmin") || {}); if($("rd-ver")) $("rd-ver").click();
                     else if(window.__reporteAdmin && window.__reporteAdmin.ver) window.__reporteAdmin.ver.click(); }});
    T.push({ic:"descargar", t:"Respaldo de datos", d:"Descargar o restaurar", gob:true,
            fn:()=>{ ir("mas"); setTimeout(()=>{ const b = $("ms-backup"); if(b) b.scrollIntoView({block:"center"}); }, 300); }});
    T.push({ic:"cambiar", t:"Ver la app como otro cargo", d:"Recorra la app con sus permisos",
            fn:()=> abrirSimulacion()});
    return T;
  }

  const T = tareasDelCargoV12();

  /* La Administradora de Obra cierra su día con su propio reporte */
  if(rol === "obra"){
    T.splice(1, 0, {ic:"documento", t:"Reporte diario de obra", d:"Cierre del día para la jefatura",
                    fn:()=> verReporteObra()});
  }
  return T;
};

/* Marcas visuales de las tareas de gobierno y de la tarea ancha */
const pintarTareasV12 = pintarTareas;
pintarTareas = function(){
  const T = tareasDelCargo();
  pintarTareasV12();
  $$("#ini-accesos .tarea").forEach((t, i) => {
    const x = T[i];
    if(!x) return;
    if(x.gob) t.classList.add("gob");
    if(x.ancha) t.classList.add("ancha");
  });
  const cont = $("ini-accesos");
  if(!cont) return;
  const normales = $$("#ini-accesos .tarea").filter(t => !t.classList.contains("ancha"));
  $$("#ini-accesos .tarea").forEach(t => { if(t.classList.contains("simular")) cont.appendChild(t); });
  if(normales.length % 2 === 1) normales[normales.length - 1].classList.add("ancha");
};

/* --- Modo administrador: color, aviso y botón que dice a dónde va --- */
function esModoAdmin(){ return rolEfectivo() === "admin"; }

function pintarModoV12(){
  const barra = $("appbar");
  if(barra) barra.classList.toggle("admin", esModoAdmin());
  const b = $("btn-modo");
  const u = usuarioActual();
  if(b && u && u.esAdmin && !simulando())
    b.innerHTML = ico(esModoAdmin() ? "inventario" : "escudo", 15) +
                  (esModoAdmin() ? "Ir a almacén" : "Ir a admin");
  const t = $("titulo");
  if(t && pantalla === "inicio") t.textContent = esModoAdmin() ? "Administración" : "Inicio";

  let aviso = $("ini-aviso-admin");
  if(esModoAdmin()){
    if(!aviso){
      aviso = document.createElement("div");
      aviso.id = "ini-aviso-admin";
      aviso.innerHTML = ico("escudo", 17) +
        "<span>Está administrando la aplicación. Sus tareas de almacén no aparecen en este modo.</span>";
      const ancla = $("ini-resumen") || $("ini-metricas");
      if(ancla) ancla.insertAdjacentElement("beforebegin", aviso);
    }
    aviso.classList.remove("oculto");
  } else if(aviso) aviso.classList.add("oculto");
}

/* En modo administrador el resumen habla del sistema, no de la obra */
const pintarResumenLogisticoV12 = pintarResumenLogistico;
pintarResumenLogistico = function(){
  pintarResumenLogisticoV12();
  if(!esModoAdmin()) return;
  const card = $("ini-resumen");
  if(!card) return;
  const pend = db.solicitudes.filter(s => s.estado === "pendiente").length;
  const hoy = db.historial.filter(h => diaLocal(h.fecha) === hoyISO()).length;
  const cifra = (v,t,c) => '<span class="cifra ' + (c || "") + '"><b>' + v + "</b><small>" + t + "</small></span>";
  card.innerHTML =
    '<span class="cab"><b>Estado del sistema</b><span>Ver detalle ' + ico("flecha", 14) + "</span></span>" +
    '<span class="cifras">' +
      cifra(db.usuarios.filter(u => u.activo).length, "Usuarios") +
      cifra(pend, "Solicitudes", pend ? "alerta" : "") +
      cifra(hoy, "Acciones hoy") +
    "</span>";
};

const verDesgloseV12 = verDesgloseLogistico;
verDesgloseLogistico = function(){
  if(!esModoAdmin()) return verDesgloseV12();
  verReportePersonas();
};

const aplicarRolV12 = aplicarRol;
aplicarRol = function(){ aplicarRolV12(); pintarModoV12(); };

const pintarInicioV12 = pintarInicio;
pintarInicio = function(){ pintarInicioV12(); pintarModoV12(); };

/* =========== 4. Reporte diario de la Administradora de Obra =========== */
function datosReporteObra(dia){
  const req = db.requerimientos;
  const delDia = h => diaLocal(h.fecha) === dia;
  const recibidos = req.filter(r => diaLocal(r.fecha) === dia &&
    (db.usuarios.find(u => u.id === r.solicitanteId) || {}).rol === "supervisor");
  const enviados = req.filter(r => (r.historial || []).some(h => delDia(h) &&
    ["enviado_logistica","consolidado","aprobado"].indexOf(h.estado) >= 0));
  const porRevisar = req.filter(r => ["pendiente","solicitado","revisado"].indexOf(r.estado) >= 0);
  const observados = req.filter(r => ["observado","rechazado","devuelto"].indexOf(r.estado) >= 0);
  const d = datosEjecutivos(dia);

  const disc = {};
  req.filter(r => ABIERTOS.indexOf(r.estado) >= 0 || diaLocal(r.fecha) === dia).forEach(r => {
    const k = r.disciplina || r.area || "Sin disciplina";
    if(!disc[k]) disc[k] = {nombre:k, pedidos:0, materiales:0, pedido:0, recibido:0};
    disc[k].pedidos++;
    (r.items || []).forEach(it => {
      disc[k].materiales++;
      disc[k].pedido += num(it.cant) || 0;
      disc[k].recibido += Math.min(num(it.entregado) || 0, num(it.cant) || 0);
    });
  });
  const disciplinas = Object.keys(disc).map(k => {
    const x = disc[k];
    x.pct = x.pedido > 0 ? Math.min(100, Math.round(x.recibido / x.pedido * 100)) : 0;
    return x;
  }).sort((a,b)=> b.pedidos - a.pedidos);

  return {
    recibidos, enviados, porRevisar, observados, disciplinas,
    entregas:d.entregados, parciales:req.filter(r => r.estado === "entrega_parcial"),
    sinStock:req.filter(r => r.estado === "sin_stock"),
    prestamos:d.prestamos,
    criticos:db.materiales.filter(x => estadoStock(x) !== "disponible"),
    avance:db.consolidado.items.length ? avanceConsolidado() : null,
    hayMovimiento:(recibidos.length + enviados.length + d.entregados.length + d.prestamos.length) > 0
  };
}

function libroObra(dia){
  const o = datosReporteObra(dia);
  return crearXLSX([
    {nombre:"Resumen del dia", filas:[
      ["Reporte de obra", soloFecha(dia)],
      ["Obra", db.config.obra || "—"],
      ["Emitido por", usuarioActual().nombre],
      [],
      ["Requerimientos recibidos de supervisores", o.recibidos.length],
      ["Revisados y enviados a logística", o.enviados.length],
      ["Pendientes de revisar", o.porRevisar.length],
      ["Observados o devueltos", o.observados.length],
      [],
      ["Entregas de material", o.entregas.length],
      ["Entregas parciales", o.parciales.length],
      ["Pedidos sin stock", o.sinStock.length],
      ["Herramientas prestadas", o.prestamos.length],
      ["Artículos bajo el mínimo", o.criticos.length],
      [],
      ["Avance del consolidado", o.avance ? o.avance.avance + "%" : "sin consolidado"],
      ["Materiales completos", o.avance ? o.avance.entregados + " de " + o.avance.total : "—"]]},
    {nombre:"Por disciplina", filas:
      [["Disciplina","Pedidos","Materiales","Solicitado","Recibido","Atendido %"]]
      .concat(o.disciplinas.map(x => [x.nombre, x.pedidos, x.materiales,
        +x.pedido.toFixed(2), +x.recibido.toFixed(2), x.pct]))},
    {nombre:"Requiere atencion", filas:
      [["Pedido","Disciplina","Estado","Solicitante","Fecha"]]
      .concat(o.porRevisar.concat(o.sinStock, o.observados).map(r =>
        [r.codigo, r.disciplina || r.area || "—",
         ESTADOS[r.estado] ? ESTADOS[r.estado].texto : r.estado,
         r.solicitante || "—", soloFecha(r.fecha)]))}
  ]);
}

function verReporteObra(){
  const dia = ($("rp-fecha") && $("rp-fecha").value) || hoyISO();
  const o = datosReporteObra(dia);
  const li = (k,v,c) => '<div class="dato"><span>' + k + '</span><b' +
    (c ? ' style="color:' + c + '"' : "") + ">" + v + "</b></div>";

  if(!o.hayMovimiento){
    hoja("Reporte de obra · " + soloFecha(dia),
      '<div class="vacio" style="border:none">' + ico("reloj", 40) +
      "No hubo movimientos registrados este día.</div>",
      [{txt:"Cerrar", clase:"btn-cont"}]);
    return;
  }

  const barra = (t, pct, col) =>
    '<div class="barra"><div class="rot"><span>' + t + "</span><b>" + pct + "%</b></div>" +
    '<div class="via"><div class="lleno" style="width:' + pct + "%;background:" + col + '"></div></div></div>';
  const c = o.avance ? 2 * Math.PI * 23 : 0;

  hoja("Reporte de obra · " + soloFecha(dia),
    '<div class="ayuda" style="margin:0 0 12px">' + esc(db.config.obra || "Obra") + " · " +
    esc(usuarioActual().nombre) + ", Administradora de Obra</div>" +

    '<div class="sech" style="margin:0 0 6px">Requerimientos del día</div>' +
    li("Recibidos de supervisores", o.recibidos.length) +
    li("Revisados y enviados a logística", o.enviados.length) +
    li("Pendientes de revisar", o.porRevisar.length, o.porRevisar.length ? "var(--alerta)" : "") +
    li("Observados o devueltos", o.observados.length) +

    (o.disciplinas.length
      ? '<div class="sech" style="margin:16px 0 6px">Por disciplina</div>' +
        o.disciplinas.map(x => barra(esc(x.nombre) + " · " + x.pedidos + " pedidos", x.pct,
          x.pct >= 70 ? "var(--ok)" : (x.pct >= 40 ? "var(--sec)" : "var(--mal)"))).join("")
      : "") +

    '<div class="sech" style="margin:16px 0 6px">Atención y almacén</div>' +
    li("Entregas de material", o.entregas.length) +
    li("Entregas parciales", o.parciales.length, o.parciales.length ? "var(--alerta)" : "") +
    li("Pedidos sin stock", o.sinStock.length, o.sinStock.length ? "var(--mal)" : "") +
    li("Herramientas prestadas", o.prestamos.length) +
    li("Artículos bajo el mínimo", o.criticos.length, o.criticos.length ? "var(--mal)" : "") +

    (o.avance
      ? '<div class="sech" style="margin:16px 0 6px">Consolidado de obra</div>' +
        '<div style="display:flex;align-items:center;gap:13px;padding:4px 0">' +
        '<svg viewBox="0 0 60 60" width="54" height="54" style="flex:none" role="img" aria-label="Avance ' +
        o.avance.avance + '%"><circle cx="30" cy="30" r="23" fill="none" stroke="var(--sup-var)" stroke-width="7"/>' +
        '<circle cx="30" cy="30" r="23" fill="none" stroke="var(--pri)" stroke-width="7" stroke-linecap="round" ' +
        'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' +
        (c * (1 - o.avance.avance/100)).toFixed(1) + '" transform="rotate(-90 30 30)"/>' +
        '<text x="30" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="var(--pri)">' +
        o.avance.avance + '%</text></svg><div><b style="font-size:13px">' + o.avance.entregados +
        " de " + o.avance.total + ' materiales completos</b><small style="display:block;font-size:11.5px;' +
        'color:var(--tinta-sec);margin-top:2px">' + o.avance.pendientes + " por comprar</small></div></div>"
      : "") +

    '<div class="sech" style="margin:16px 0 6px">Requiere su atención</div>' +
    (o.sinStock.length + o.porRevisar.length + o.criticos.length
      ? o.sinStock.slice(0,3).map(r =>
          '<div class="linea"><span class="pt" style="background:var(--mal)"></span><span class="txt"><b>' +
          esc(r.codigo) + ' sin stock</b><small>' + esc(r.disciplina || r.area || "—") + "</small></span></div>").join("") +
        (o.porRevisar.length
          ? '<div class="linea"><span class="pt" style="background:var(--alerta)"></span><span class="txt"><b>' +
            o.porRevisar.length + ' pedido(s) esperan su revisión</b><small>' +
            esc(o.porRevisar.slice(0,3).map(r => r.codigo).join(", ")) + "</small></span></div>"
          : "") +
        (o.criticos.length
          ? '<div class="linea"><span class="pt" style="background:var(--alerta)"></span><span class="txt"><b>' +
            o.criticos.length + ' artículo(s) bajo el mínimo</b><small>' +
            esc(o.criticos.slice(0,3).map(m => m.nombre).join(", ")) + "</small></span></div>"
          : "")
      : '<div class="ayuda" style="margin:0">Sin pendientes críticos.</div>') +

    (($("rp-para") && $("rp-para").value)
      ? '<div class="sech" style="margin:16px 0 6px">Dirigido a</div>' +
        '<div class="ayuda" style="margin:0">' + esc($("rp-para").value) + "</div>"
      : ""),

    [{txt:"Enviar a jefatura", clase:"btn-sec", fn:enviarReporteObra},
     {txt:"Excel", clase:"btn-pri", fn:()=>{
       descargarBlob("reporte_obra_" + dia + ".xlsx", libroObra(dia));
       snack("Excel del día descargado.", "ok");
     }},
     {txt:"Cerrar", clase:"btn-cont"}]);

  auditar("reportes", "Reporte diario de obra consultado", {comentario:dia});
  guardar();
}

async function enviarReporteObra(){
  const dia = ($("rp-fecha") && $("rp-fecha").value) || hoyISO();
  const o = datosReporteObra(dia);
  const nombre = "reporte_obra_" + dia + ".xlsx";
  const blob = libroObra(dia);
  const asunto = "Reporte de obra " + soloFecha(dia) + (db.config.obra ? " · " + db.config.obra : "");
  const cuerpo =
    "Reporte de obra del " + soloFecha(dia) + ".\n\n" +
    "Requerimientos de supervisores: " + o.recibidos.length + "\n" +
    "Enviados a logística: " + o.enviados.length + "  ·  Por revisar: " + o.porRevisar.length + "\n" +
    "Entregas de material: " + o.entregas.length + "  ·  Parciales: " + o.parciales.length + "\n" +
    "Pedidos sin stock: " + o.sinStock.length + "\n" +
    (o.avance ? "Avance del consolidado: " + o.avance.avance + "%\n" : "") +
    (($("rp-obs") && $("rp-obs").value) ? "\nObservaciones: " + $("rp-obs").value + "\n" : "") +
    "\nEmitido por " + usuarioActual().nombre + ", Administradora de Obra.";

  const ok = await compartirArchivo(nombre, blob, asunto, cuerpo);
  if(!ok) descargarBlob(nombre, blob);
  const dest = db.config.correos || [];
  if(dest.length){
    const url = "mailto:" + dest.map(x => x.correo).join(",") +
      "?subject=" + encodeURIComponent(asunto) + "&body=" + encodeURIComponent(cuerpo);
    setTimeout(()=>{ location.href = url; }, 700);
  }
  auditar("reportes", "Reporte diario de obra enviado", {comentario:dia});
  guardar();
  snack(ok ? "Reporte compartido." : "Reporte descargado.", "ok");
}

/* La tarjeta dentro de Reportes, solo para la Administradora de Obra */
function pintarTarjetaObra(){
  const cont = $("scr-reportes");
  if(!cont) return;
  let card = $("ro-admin");
  const visible = rolEfectivo() === "obra";
  if(!visible){ if(card) card.classList.add("oculto"); return; }
  if(!card){
    card = document.createElement("div");
    card.id = "ro-admin";
    card.className = "card acento";
    card.innerHTML =
      '<div style="font-weight:700;font-size:15px;margin-bottom:3px">Reporte diario de obra</div>' +
      '<p class="ayuda" style="margin:0 0 12px">Lo que pidieron los supervisores, lo que envió a logística, ' +
      'lo que se atendió y cómo va el consolidado.</p>' +
      '<button class="btn btn-pri" id="ro-ver">Ver el reporte del día</button>' +
      '<div class="btns" style="margin-top:10px">' +
      '<button class="btn btn-sec btn-mini" id="ro-enviar">Enviar</button>' +
      '<button class="btn btn-cont btn-mini" id="ro-xls">Excel</button></div>';
    cont.insertBefore(card, cont.firstChild);
    $("ro-ver").addEventListener("click", verReporteObra);
    $("ro-enviar").addEventListener("click", enviarReporteObra);
    $("ro-xls").addEventListener("click", ()=>{
      const dia = ($("rp-fecha") && $("rp-fecha").value) || hoyISO();
      descargarBlob("reporte_obra_" + dia + ".xlsx", libroObra(dia));
      snack("Excel del día descargado.", "ok");
    });
  }
  card.classList.remove("oculto");
}

const refrescarV12b = refrescar;
refrescar = function(destino){
  refrescarV12b(destino);
  if(destino === "reportes") pintarTarjetaObra();
};

/* El modo administrador no muestra tableros de obra ni habla de «mis tareas» */
const pintarBotonConsolidadoV12 = pintarBotonConsolidadoV10;
pintarBotonConsolidadoV10 = function(){
  if(esModoAdmin()){ const c = $("ini-consolidado"); if(c) c.remove(); return; }
  pintarBotonConsolidadoV12();
};

const pintarTareasV12b = pintarTareas;
pintarTareas = function(){
  pintarTareasV12b();
  const cont = $("ini-accesos");
  if(!cont) return;
  if(esModoAdmin()){ const c = $("ini-consolidado"); if(c) c.remove(); }
  const titulo = cont.previousElementSibling;
  if(titulo && titulo.classList.contains("sech"))
    titulo.innerHTML = esModoAdmin() ? "Gobierno de la app" : "Mis tareas";
};

/* ---------------------------------------------------------------
   V13  Control de descargas y exportaciones
        Solo el Administrador de la app (en cualquiera de sus dos
        modos) y la Administradora de Obra pueden sacar información.
        Todo archivo pasa por una sola puerta: aunque un botón
        aparezca, la descarga se rechaza y queda auditada.
        Las plantillas vacías quedan libres: sin ellas el supervisor
        no podría armar su requerimiento desde Excel.
   --------------------------------------------------------------- */

const ROLES_EXPORTAN = ["obra"];
const PLANTILLA_LIBRE = /^plantilla[_-]/i;

function puedeExportar(){
  const u = usuarioActual();
  if(!u) return false;
  if(simulando()) return false;
  if(u.esAdmin) return true;
  return ROLES_EXPORTAN.indexOf(rolEfectivo()) >= 0;
}

function negarExportacion(que){
  const u = usuarioActual();
  log("seguridad", "Exportación denegada", (u ? u.nombre : "desconocido") + " · " + (que || "archivo"));
  if(typeof auditar === "function")
    auditar("seguridad", "Intento de exportación sin permiso", {comentario:que || "archivo"});
  guardar();
  snack("Solo la Administración puede descargar información. Solicite el archivo.", "err");
  return false;
}

/* --- La puerta única: todo archivo pasa por aquí --- */
const descargarBlobV13 = descargarBlob;
descargarBlob = function(nombre, blob){
  if(!PLANTILLA_LIBRE.test(String(nombre || "")) && !puedeExportar())
    return negarExportacion(nombre);
  return descargarBlobV13(nombre, blob);
};

const descargarTextoV13 = descargarTexto;
descargarTexto = function(nombre, texto){
  if(!PLANTILLA_LIBRE.test(String(nombre || "")) && !puedeExportar())
    return negarExportacion(nombre);
  return descargarTextoV13(nombre, texto);
};

const compartirArchivoV13 = compartirArchivo;
compartirArchivo = async function(nombre, blob, titulo, texto){
  if(!puedeExportar()) return negarExportacion(nombre);
  return compartirArchivoV13(nombre, blob, titulo, texto);
};

const imprimirReporteV13 = imprimirReporte;
imprimirReporte = function(html){
  if(!puedeExportar()) return negarExportacion("reporte para imprimir o PDF");
  return imprimirReporteV13(html);
};

/* --- Los botones desaparecen para quien no exporta --- */
const BOTONES_EXPORTAR = ["kx-csv","rp-excel","rp-compartir","rp-texto","ms-backup","ms-excel",
  "epp-excel","re-pdf","re-xls","re-doc","re-enviar","dg-pdf","dg-xls","dg-doc",
  "rd-enviar","rd-xls","rd-pdf","rd-doc","pi-enviar","ro-enviar","ro-xls","co-excel"];

function pintarBotonesExportar(){
  const ok = puedeExportar();
  BOTONES_EXPORTAR.forEach(id => { const b = $(id); if(b) b.classList.toggle("oculto", !ok); });
  /* Aviso en el kardex, para que se sepa a quién pedir el archivo */
  let nota = $("kx-nota-export");
  const kx = $("kx-lista");
  if(kx && !ok){
    if(!nota){
      nota = document.createElement("div");
      nota.id = "kx-nota-export";
      nota.className = "card plano";
      nota.style.cssText = "display:flex;align-items:flex-start;gap:9px;font-size:11.5px;color:var(--tinta-sec)";
      nota.innerHTML = ico("escudo", 17) +
        "<span><b style='color:var(--tinta)'>La exportación no está disponible</b><br>" +
        "Solicite el archivo a la Administración.</span>";
      kx.insertAdjacentElement("afterend", nota);
    }
    nota.classList.remove("oculto");
  } else if(nota) nota.classList.add("oculto");
}

const refrescarV13 = refrescar;
refrescar = function(destino){
  refrescarV13(destino);
  pintarBotonesExportar();
};

const aplicarRolV13 = aplicarRol;
aplicarRol = function(){ aplicarRolV13(); pintarBotonesExportar(); };

/* ---------------------------------------------------------------
   V14  El reporte diario es del Administrador de la app.
        Solo su cuenta exporta; el panel de administración estrena
        una tarjeta para descargarlo en un toque.
   --------------------------------------------------------------- */

/* Nadie más exporta: la lista de roles con permiso queda vacía */
ROLES_EXPORTAN.length = 0;

(function estilosV14(){
  if($("estilos-v14")) return;
  const s = document.createElement("style");
  s.id = "estilos-v14";
  s.textContent =
    "#ad-reporte{background:var(--lila);border-radius:var(--r-m);padding:14px;margin-bottom:12px;box-shadow:var(--s2)}" +
    "#ad-reporte .cab{display:flex;align-items:center;gap:9px;margin-bottom:3px}" +
    "#ad-reporte .cab b{font-size:15.5px;font-weight:600;color:#fff}" +
    "#ad-reporte p{margin:0 0 12px;font-size:11.5px;color:#D5CFF3;line-height:1.4}" +
    "#ad-reporte .btn-descargar{width:100%;height:48px;border-radius:var(--r-full);background:#fff;color:var(--lila);" +
      "font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}" +
    "#ad-reporte .btn-descargar:active{transform:scale(.98)}" +
    "#ad-reporte .otros{display:flex;gap:7px;margin-top:9px}" +
    "#ad-reporte .otros button{flex:1;height:38px;border-radius:var(--r-full);background:rgba(255,255,255,.16);" +
      "border:1px solid rgba(255,255,255,.34);color:#fff;font-size:12px;font-weight:600}" +
    "#ad-reporte .otros button:active{background:rgba(255,255,255,.3)}";
  document.head.appendChild(s);
})();

function descargarReporteDiario(){
  if(!cuentaEsAdmin()) return;
  const dia = hoyISO();
  descargarBlob("reporte_diario_" + dia + ".xlsx", libroAdmin(dia));
  auditar("reportes", "Reporte diario descargado", {comentario:dia});
  guardar();
  snack("Reporte del día descargado en Excel.", "ok");
}

function pintarTarjetaReporteAdmin(){
  let card = $("ad-reporte");
  if(!esModoAdmin() || !esCuentaAdmin()){ if(card) card.classList.add("oculto"); return; }
  if(!card){
    card = document.createElement("div");
    card.id = "ad-reporte";
    card.innerHTML =
      '<div class="cab">' + ico("documento", 20) + "<b>Reporte diario</b></div>" +
      '<p id="ad-reporte-fecha"></p>' +
      '<button class="btn-descargar" id="ad-descargar">' + ico("descargar", 19) + "Descargar el reporte de hoy</button>" +
      '<div class="otros">' +
      '<button id="ad-rep-ver">Ver</button>' +
      '<button id="ad-rep-pdf">PDF</button>' +
      '<button id="ad-rep-doc">Word</button>' +
      '<button id="ad-rep-enviar">Enviar</button></div>';
    const ancla = $("ini-resumen") || $("ini-metricas");
    if(ancla) ancla.insertAdjacentElement("afterend", card);

    $("ad-descargar").addEventListener("click", descargarReporteDiario);
    $("ad-rep-ver").addEventListener("click", ()=>{
      const R = window.__reporteAdmin || {};
      if(R.ver) R.ver.click();
    });
    $("ad-rep-pdf").addEventListener("click", ()=>{
      if(!cuentaEsAdmin()) return;
      imprimirReporte(reporteEjecutivoHTML(hoyISO(),
        "Reporte diario emitido por el Administrador de la aplicación."));
      auditar("reportes", "Reporte diario en PDF", {comentario:hoyISO()});
      guardar();
    });
    $("ad-rep-doc").addEventListener("click", ()=>{
      if(!cuentaEsAdmin()) return;
      descargarBlob("reporte_diario_" + hoyISO() + ".docx",
        crearDOCX(bloquesEjecutivos(hoyISO(), "Reporte diario emitido por el Administrador de la aplicación.")));
      auditar("reportes", "Reporte diario en Word", {comentario:hoyISO()});
      guardar();
      snack("Documento Word descargado.", "ok");
    });
    $("ad-rep-enviar").addEventListener("click", ()=>{ if(cuentaEsAdmin()) enviarReporteAdmin(); });
  }
  const a = actividadDelDia(hoyISO());
  const d = datosEjecutivos(hoyISO());
  $("ad-reporte-fecha").textContent = soloFecha(hoyISO()) + " · " +
    d.movs.length + " movimientos · " + d.recibidos.length + " requerimientos · " +
    a.total + " acciones registradas";
  card.classList.remove("oculto");
}

/* La tarjeta reemplaza al mosaico «Reporte de la app», que decía lo mismo */
const tareasDelCargoV14 = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV14();
  return rolEfectivo() === "admin" ? T.filter(x => x.t !== "Reporte de la app") : T;
};

const pintarInicioV14 = pintarInicio;
pintarInicio = function(){ pintarInicioV14(); pintarTarjetaReporteAdmin(); };

/* ---------------------------------------------------------------
   V15  El menú deja de vivir en la foto de perfil.
        Izquierda: el ícono de menú, que se convierte en «volver»
        cuando se está dentro de una sección.
        Derecha: el avatar, que ahora abre lo suyo — perfil,
        notificaciones y cerrar sesión.
   --------------------------------------------------------------- */

let modoDrawer = "menu";

(function botonMenuV15(){
  if($("btn-menu")) return;
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.id = "btn-menu";
  b.setAttribute("aria-label", "Menú de secciones");
  b.innerHTML = ico("mas", 22);
  const volver = $("btn-volver");
  if(volver) volver.insertAdjacentElement("afterend", b);
  b.addEventListener("click", ()=>{ modoDrawer = "menu"; abrirDrawer(); });
})();

(function avatarAbrePerfilV15(){
  const a = $("btn-perfil");
  if(!a) return;
  const n = a.cloneNode(true);
  a.parentNode.replaceChild(n, a);
  n.addEventListener("click", ()=>{ modoDrawer = "perfil"; abrirDrawer(); });
})();

/* Un solo hueco a la izquierda: volver cuando hay a dónde volver, menú si no */
const actualizarVolverV15 = actualizarVolverV10;
actualizarVolverV10 = function(){
  actualizarVolverV15();
  const menu = $("btn-menu"), volver = $("btn-volver");
  if(!menu || !volver) return;
  menu.classList.toggle("oculto", !sesion || !volver.classList.contains("oculto"));
};

/* El panel lateral cambia de contenido según lo que se tocó */
const pintarDrawerV15 = pintarDrawer;
pintarDrawer = function(){
  pintarDrawerV15();
  const u = usuarioActual();
  if(!u || modoDrawer !== "perfil") return;

  const sinLeer = noLeidas();
  $("dr-lista").innerHTML =
    '<button class="op" data-perfil="info">' + ico("usuario", 21) + "Mi información</button>" +
    '<button class="op" data-perfil="notif">' + ico("campana", 21) + "Notificaciones" +
      (sinLeer ? '<span class="glob">' + sinLeer + "</span>" : "") + "</button>" +
    '<button class="op" data-perfil="foto">' + ico("camara", 21) + "Cambiar mi foto</button>" +
    '<div class="sep"></div>' +
    '<button class="op salir" id="dr-salir2">' + ico("salir", 21) + "Cerrar sesión</button>";

  $$("#dr-lista [data-perfil]").forEach(b => b.addEventListener("click", ()=>{
    const q = b.dataset.perfil;
    cerrarDrawer();
    if(q === "info")  return verPerfil();
    if(q === "notif") return ir("notificaciones");
    if(q === "foto")  { const f = $("pf-foto"); if(f) f.click(); }
  }));
  $("dr-salir2").addEventListener("click", async ()=>{
    cerrarDrawer();
    if(await confirmar("Cerrar sesión", "Volverá a la pantalla de inicio de sesión.", "Cerrar sesión")) salir();
  });
};

/* Al cerrar, el panel vuelve a su estado normal */
const cerrarDrawerV15 = cerrarDrawer;
cerrarDrawer = function(){ cerrarDrawerV15(); modoDrawer = "menu"; };

const aplicarRolV15 = aplicarRol;
aplicarRol = function(){ aplicarRolV15(); actualizarVolverV10(); };

/* El ícono propio de menú y el panel de secciones sin lo que ya vive en el perfil */
ICONOS.menu = '<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/>';

(function iconoMenuV15(){
  const b = $("btn-menu");
  if(b) b.innerHTML = ico("menu", 22);
})();

const pintarDrawerV15b = pintarDrawer;
pintarDrawer = function(){
  pintarDrawerV15b();
  if(modoDrawer !== "menu") return;
  const lista = $("dr-lista");
  if(!lista) return;
  /* Notificaciones, perfil y cerrar sesión ahora se tocan desde el avatar */
  $$("#dr-lista .op").forEach(b => {
    const t = b.textContent.trim();
    if(t === "Notificaciones" || t === "Mi información" || t === "Cerrar sesión") b.remove();
  });
  const seps = $$("#dr-lista .sep");
  seps.forEach(s => { if(!s.nextElementSibling || s.nextElementSibling.classList.contains("sep")) s.remove(); });
  const ultimo = lista.lastElementChild;
  if(ultimo && ultimo.classList.contains("sep")) ultimo.remove();
  if(!$("dr-pie-perfil")){
    const pie = document.createElement("div");
    pie.id = "dr-pie-perfil";
    pie.style.cssText = "padding:12px 14px;font-size:11.5px;color:var(--tinta-sec);line-height:1.4";
    pie.textContent = "Su perfil, notificaciones y cerrar sesión están en su foto, arriba a la derecha.";
    lista.appendChild(pie);
  }
};

/* ---------------------------------------------------------------
   V16  El requerimiento entra solo por Excel.
        Desaparece la carga a mano: el formulario abre en la zona de
        subida y nada se habilita hasta que haya un archivo cargado.
        Las líneas importadas sí se pueden quitar antes de registrar.
   --------------------------------------------------------------- */

(function estilosV16(){
  if($("estilos-v16")) return;
  const s = document.createElement("style");
  s.id = "estilos-v16";
  s.textContent =
    "#mr-excel.solo{background:var(--sup);border:2px dashed var(--pri);border-radius:var(--r-m);" +
      "padding:18px 14px;text-align:center}" +
    "#mr-excel.solo .ico-grande{color:var(--pri);display:block;margin:0 auto 9px}" +
    "#mr-excel.solo .titulo{font-size:14.5px;font-weight:600;margin-bottom:4px}" +
    "#mr-excel.solo .btns{flex-direction:column;gap:8px}" +
    "#mr-excel.solo .btns .btn{width:100%}" +
    "#mr-bloqueado{opacity:.45;pointer-events:none}" +
    "#mr-aviso-bloqueo{font-size:11px;color:var(--tinta-sec);text-align:center;margin:6px 0 0}" +
    ".btn-txt.apagado{color:var(--borde);pointer-events:none}";
  document.head.appendChild(s);
})();

const CAMPOS_REQ = ["mr-obra","mr-area","mr-prioridad","mr-necesario","mr-obs"];

(function soloExcelV16(){
  const excel = $("mr-excel");
  if(!excel) return;

  /* Ya no hay dos caminos: fuera el selector */
  const sel = $("mr-modo");
  if(sel) sel.remove();

  /* Fuera la tarjeta de carga a mano y su título */
  const agregar = $("mr-agregar");
  if(agregar){
    const tarjeta = agregar.closest(".card");
    if(tarjeta){
      const titulo = tarjeta.previousElementSibling;
      if(titulo && titulo.classList.contains("sech")) titulo.remove();
      tarjeta.remove();
    }
  }

  /* La zona de subida pasa al frente y se vuelve la puerta de entrada */
  excel.classList.remove("oculto");
  excel.classList.add("solo");
  excel.innerHTML =
    ico("tabla", 38).replace("<svg", '<svg class="ico-grande"') +
    '<div class="titulo">Suba su requerimiento</div>' +
    '<p class="ayuda" style="margin:0 0 14px">Descargue la plantilla, llénela con los materiales que ' +
    'necesita y súbala. Acepta .xlsx y .csv.</p>' +
    '<div class="btns">' +
    '<button class="btn btn-pri" id="mr-subir">Elegir archivo</button>' +
    '<button class="btn btn-cont" id="mr-plantilla">Descargar plantilla</button></div>' +
    '<input type="file" id="mr-archivo" accept=".xlsx,.csv" hidden>' +
    '<div class="ayuda" id="mr-importe" style="margin:11px 0 0"></div>';

  /* Los botones se volvieron a crear: hay que reconectarlos */
  $("mr-subir").addEventListener("click", ()=> $("mr-archivo").click());
  $("mr-plantilla").addEventListener("click", ()=> plantillaRequerimiento());
  $("mr-archivo").addEventListener("change", e => importarArchivoReq(e));

  /* Los datos de cabecera esperan al archivo */
  const items = $("mr-items");
  if(items && !$("mr-aviso-bloqueo")){
    const aviso = document.createElement("p");
    aviso.id = "mr-aviso-bloqueo";
    aviso.textContent = "Los datos del pedido se activan al cargar el archivo.";
    excel.insertAdjacentElement("afterend", aviso);
  }
})();

/* La plantilla, extraída para poder reusarla desde el botón nuevo */
function plantillaRequerimiento(){
  const u = usuarioActual();
  const filas = [
    ["Descripción","Cantidad","Unidad","Observaciones","Área","Prioridad","Necesario para"],
    ["Perno hexagonal 5/8 x 3", 24, "und", "Acero galvanizado", u.area || "Civil", "Alta", hoyISO()],
    ["Cable NYY 3x10", 120, "m", "", u.area || "Eléctrico", "Normal", ""],
    ["", "", "", "", "", "", ""]
  ];
  descargarBlob("plantilla_requerimiento.xlsx",
    crearXLSX([{nombre:"Requerimiento", filas, estilos:[1]}]));
  snack("Plantilla descargada. Llénela y súbala.", "ok");
}

async function importarArchivoReq(e){
  const archivo = e.target.files && e.target.files[0];
  if(!archivo) return;
  const salida = $("mr-importe");
  try{
    const filas = await leerTabla(archivo);
    const res = importarPedido(filas);
    salida.className = "ayuda";
    salida.innerHTML = "<b>" + res.cargados + "</b> material(es) cargados de <b>" + esc(archivo.name) + "</b>" +
      (res.ignoradas ? " · " + res.ignoradas + " fila(s) sin descripción omitidas" : "") +
      "<br>Revise la lista y pulse <b>Registrar</b>.";
    snack(res.cargados + " materiales cargados del archivo.", "ok");
  }catch(err){
    salida.className = "ayuda err";
    salida.textContent = err.message || "No se pudo leer el archivo.";
    snack("No se pudo leer el archivo.", "err");
  }
  e.target.value = "";
  estadoFormularioReq();
}

/* Nada se habilita mientras no haya materiales cargados */
function estadoFormularioReq(){
  const hay = typeof itemsReq !== "undefined" && itemsReq.length > 0;
  CAMPOS_REQ.forEach(id => { const c = $(id); if(c) c.disabled = !hay; });
  ["mr-registrar","mr-registrar2"].forEach(id => {
    const b = $(id);
    if(!b) return;
    b.classList.toggle("apagado", !hay);
    b.disabled = !hay;
    b.style.opacity = hay ? "" : ".45";
  });
  const aviso = $("mr-aviso-bloqueo");
  if(aviso) aviso.classList.toggle("oculto", hay);
  const excel = $("mr-excel");
  if(excel){
    const t = excel.querySelector(".titulo");
    if(t) t.textContent = hay ? "Cargar otro archivo" : "Suba su requerimiento";
  }
}

const pintarItemsReqV16 = pintarItemsReq;
pintarItemsReq = function(){ pintarItemsReqV16(); estadoFormularioReq(); };

const abrirRequerimientoV16 = abrirRequerimiento;
abrirRequerimiento = function(){
  abrirRequerimientoV16();
  const sel = $("mr-modo");
  if(sel) sel.remove();
  const excel = $("mr-excel");
  if(excel) excel.classList.remove("oculto");
  if($("mr-importe")) { $("mr-importe").className = "ayuda"; $("mr-importe").innerHTML = ""; }
  estadoFormularioReq();
};

/* ---------------------------------------------------------------
   V17  Entrega de varios artículos en un solo vale.
        Se elige a la persona y el área una sola vez, se agregan los
        materiales uno por uno, y se cierra con una foto y una firma.
        En el kardex cada material conserva su propio movimiento,
        todos con el mismo número de vale.
   --------------------------------------------------------------- */

let entregaItems = [];

(function estilosV17(){
  if($("estilos-v17")) return;
  const s = document.createElement("style");
  s.id = "estilos-v17";
  s.textContent =
    "#sa-destino{background:var(--pri-cont);border-radius:var(--r-m);padding:12px;margin-bottom:12px}" +
    "#sa-destino label{color:var(--pri-osc)}" +
    "#sa-lista .fila{padding:10px}" +
    "#sa-lista .fila .der .quitar{margin:0}" +
    "#sa-aviso{margin-bottom:11px}";
  document.head.appendChild(s);
})();

(function entregaMultipleV17(){
  const panel = $("pan-mSalida");
  if(!panel || $("sa-destino")) return;

  const material = $("sa-material").closest(".campo");
  const persona  = $("sa-persona").closest(".campo");
  const area     = $("sa-area").closest(".campo");

  /* Persona y área suben a una cabecera fija: se eligen una sola vez */
  const destino = document.createElement("div");
  destino.id = "sa-destino";
  panel.insertBefore(destino, panel.firstChild);
  destino.appendChild(persona);
  destino.appendChild(area);

  /* El área pasa de texto libre a lista, con opción de escribir otra */
  const inputArea = $("sa-area");
  const sel = document.createElement("select");
  sel.id = "sa-area-sel";
  inputArea.insertAdjacentElement("beforebegin", sel);
  inputArea.classList.add("oculto");
  inputArea.placeholder = "Escriba el área";
  sel.addEventListener("change", ()=>{
    const otra = sel.value === "__otra";
    inputArea.classList.toggle("oculto", !otra);
    if(!otra) inputArea.value = sel.value;
    else { inputArea.value = ""; inputArea.focus(); }
  });

  /* El botón de guardar se reemplaza por agregar + registrar.
     Se clona para que no arrastre el listener de la salida de un solo
     artículo: si no, cada clic registraría la salida al instante. */
  const viejo = $("sa-guardar");
  const guardar = viejo.cloneNode(false);
  viejo.parentNode.replaceChild(guardar, viejo);
  guardar.textContent = "Agregar a la entrega";
  guardar.className = "btn btn-ton";
  guardar.id = "sa-agregar";

  const lista = document.createElement("div");
  lista.innerHTML =
    '<div class="sech" id="sa-titulo-lista">En esta entrega</div><div id="sa-lista"></div>' +
    '<div id="sa-aviso"></div>' +
    '<button class="btn btn-pri" id="sa-registrar">Registrar entrega</button>';
  panel.appendChild(lista);

  /* Los adjuntos y el motivo cierran el vale, no cada artículo */
  const foto = $("sa-foto1").closest(".campo");
  const obs  = $("sa-obs").closest(".campo");
  /* van antes del bloque de la lista; si no comparten padre, se anexan */
  if(foto && foto.parentNode === panel) panel.insertBefore(foto, lista);
  else if(foto) lista.parentNode.insertBefore(foto, lista);
  if(obs && obs.parentNode === panel) panel.insertBefore(obs, lista);
  else if(obs) lista.parentNode.insertBefore(obs, lista);
  foto.querySelector("label").textContent = "Foto de quien recibe";
  obs.querySelector("label").textContent = "Motivo u orden de trabajo";

  $("sa-agregar").addEventListener("click", agregarAEntrega);
  $("sa-registrar").addEventListener("click", registrarEntrega);
})();

function areasConocidas(){
  const a = ["Civil","Mecánico","Eléctrico","Mantenimiento","Almacén"];
  db.personal.forEach(p => { if(p.area && a.indexOf(p.area) < 0) a.push(p.area); });
  db.usuarios.forEach(u => { if(u.area && a.indexOf(u.area) < 0) a.push(u.area); });
  return a;
}

function llenarAreasEntrega(){
  const sel = $("sa-area-sel");
  if(!sel) return;
  const actual = sel.value;
  sel.innerHTML = '<option value="">— Área destino —</option>' +
    areasConocidas().map(x => '<option value="' + esc(x) + '">' + esc(x) + "</option>").join("") +
    '<option value="__otra">Otra área…</option>';
  if(actual) sel.value = actual;
}

/* Cuánto de un material ya está comprometido en el vale en curso */
function yaEnEntrega(itemId){
  return entregaItems.filter(x => x.itemId === itemId).reduce((s,x)=> s + x.cantidad, 0);
}

function agregarAEntrega(){
  const m = db.materiales.find(x => x.id === $("sa-material").value);
  const cant = num($("sa-cantidad").value);
  if(!m) return snack("Seleccione un material.", "err");
  if(cant <= 0) return snack("Ingrese una cantidad mayor a cero.", "err");
  const libre = +(m.stock - yaEnEntrega(m.id)).toFixed(2);
  if(cant > libre)
    return snack(libre > 0 ? "Solo quedan " + libre + " " + m.unidad + " disponibles."
                           : "Ya comprometió todo el stock de " + m.nombre + ".", "err");
  entregaItems.push({itemId:m.id, nombre:m.nombre, cantidad:cant, unidad:m.unidad});
  $("sa-cantidad").value = "";
  $("sa-material").value = "";
  pintarEntrega();
  snack(m.nombre + " agregado a la entrega.", "ok");
}

function pintarEntrega(){
  const cont = $("sa-lista");
  if(!cont) return;
  $("sa-titulo-lista").textContent = entregaItems.length
    ? "En esta entrega · " + entregaItems.length
    : "En esta entrega";

  cont.innerHTML = entregaItems.length
    ? entregaItems.map((x,i) => {
        const m = db.materiales.find(z => z.id === x.itemId);
        const queda = m ? +(m.stock - yaEnEntrega(x.itemId)).toFixed(2) : 0;
        const bajo = m && queda < (m.minimo || 0);
        return '<div class="fila"><span class="mini' + (bajo ? " alerta" : "") + '">' +
          ico("inventario", 18) + "</span>" +
          '<span class="txt"><b>' + esc(x.nombre) + "</b><small>" + x.cantidad + " " + esc(x.unidad) +
          " · quedará en " + queda + (bajo ? " (bajo el mínimo)" : "") + "</small></span>" +
          '<span class="der"><button class="quitar" data-quitar-ent="' + i + '">Quitar</button></span></div>';
      }).join("")
    : '<div class="vacio">' + ico("inventario", 36) +
      "Agregue el primer material.<br>Puede sumar todos los que se lleve la misma persona.</div>";

  $$("#sa-lista [data-quitar-ent]").forEach(b => b.addEventListener("click", ()=>{
    entregaItems.splice(+b.dataset.quitarEnt, 1);
    pintarEntrega();
  }));

  const bajos = entregaItems.filter(x => {
    const m = db.materiales.find(z => z.id === x.itemId);
    return m && (m.stock - yaEnEntrega(x.itemId)) < (m.minimo || 0);
  });
  $("sa-aviso").innerHTML = bajos.length
    ? '<div class="card aviso" style="font-size:11.5px;padding:11px;margin:0">' +
      "<b>" + bajos.length + " artículo(s) quedarán bajo el mínimo:</b> " +
      esc(bajos.map(x => x.nombre).join(", ")) + ". Se avisará a logística al registrar.</div>"
    : "";

  const btn = $("sa-registrar");
  if(btn){
    btn.textContent = entregaItems.length
      ? "Registrar entrega de " + entregaItems.length + " artículo(s)"
      : "Registrar entrega";
    btn.disabled = !entregaItems.length;
    btn.style.opacity = entregaItems.length ? "" : ".45";
  }
}

function registrarEntrega(){
  if(!entregaItems.length) return snack("Agregue al menos un material.", "err");
  const p = db.personal.find(x => x.id === $("sa-persona").value);
  if(!p) return snack("Indique a quién se entrega.", "err");
  const area = ($("sa-area").value || "").trim();
  if(!area) return snack("Indique el área destino.", "err");

  const vale = codigo("VAL");
  const obs = $("sa-obs").value.trim();
  const foto = fotos["sa-foto1"] || null;
  const bajos = [];

  entregaItems.forEach(x => {
    const m = db.materiales.find(z => z.id === x.itemId);
    if(!m) return;
    m.stock = +(m.stock - x.cantidad).toFixed(2);
    registrarMov({tipo:"salida", itemId:m.id, item:m.nombre, cantidad:x.cantidad, unidad:m.unidad,
      saldo:m.stock, persona:p.nombre, area:area, documento:vale,
      obs:obs, foto1:foto, foto2:null});
    if(m.stock < (m.minimo || 0)) bajos.push(m.nombre + " (" + m.stock + " " + m.unidad + ")");
  });

  log("movimientos", "Entrega registrada",
      vale + " · " + entregaItems.length + " artículo(s) → " + p.nombre, null);
  auditar("movimientos", "Entrega de consumibles",
    {comentario:vale + " · " + entregaItems.length + " artículo(s) a " + p.nombre + " · " + area,
     fotos:foto ? [1] : []});

  if(bajos.length)
    notificar({roles:["compras","jefatura","obra","admin"],
      titulo:"Materiales bajo el mínimo",
      cuerpo:"Tras la entrega " + vale + ":\n" + bajos.join("\n")});

  if(!guardar()) return;
  snack("Entrega " + vale + " registrada · " + entregaItems.length + " artículo(s).", "ok");

  entregaItems = [];
  ["sa-cantidad","sa-obs"].forEach(i => { if($(i)) $(i).value = ""; });
  $("sa-material").value = "";
  limpiarFoto("sa-foto1");
  pintarEntrega();
  refrescar("movimientos");
}

const refrescarV17 = refrescar;
refrescar = function(destino){
  refrescarV17(destino);
  if(destino === "movimientos"){ llenarAreasEntrega(); pintarEntrega(); }
};

/* ---------------------------------------------------------------
   V18  Circuito de recepción: logística despacha, el almacén recibe.
        La Jefa de Logística (y Compras) registran el despacho con su
        guía; al almacenero le aparece en «Recibir materiales», donde
        verifica línea por línea contra lo que dice la guía y registra
        el ingreso. Lo que falta se le avisa solo a logística.
   --------------------------------------------------------------- */

(function estilosV18(){
  if($("estilos-v18")) return;
  const s = document.createElement("style");
  s.id = "estilos-v18";
  s.textContent =
    ".rc-linea{background:var(--sup);border-radius:var(--r-m);padding:11px;margin-bottom:7px;box-shadow:var(--s1)}" +
    ".rc-linea .cab{display:flex;align-items:center;gap:8px;margin-bottom:7px}" +
    ".rc-linea .cab b{flex:1;font-size:12.5px;font-weight:600}" +
    ".rc-linea .fila-cant{display:flex;align-items:center;gap:8px}" +
    ".rc-linea .fila-cant .dice{flex:1;font-size:10.5px;color:var(--tinta-sec)}" +
    ".rc-linea input{width:76px;text-align:center;padding:7px;font-size:13px}" +
    ".rc-linea .und{font-size:10.5px;color:var(--tinta-sec);width:34px}" +
    ".rc-linea.ok input{border-color:var(--ok)}" +
    ".rc-linea.parcial input{border-color:var(--sec)}" +
    ".rc-linea.nada input{border-color:var(--mal);color:var(--mal)}";
  document.head.appendChild(s);
})();

crearPantalla("recepcion2",
  '<div id="rc-pendientes"></div>' +
  '<div class="sech" id="rc-sech-hist">Recibidas esta semana</div>' +
  '<div id="rc-historial"></div>');
PANTALLAS.recepcion2 = {titulo:"Recibir materiales", icono:"camion", perm:"guias"};

crearPantalla("despacho",
  '<div class="card acento" style="font-size:13px">' +
  'Registre lo que sale hacia obra. El almacén recibirá el aviso y verificará la guía a su llegada.</div>' +
  '<div class="card">' +
  '<div class="dos">' +
  '<div class="campo"><label>N° de guía</label><input type="text" id="dp-numero" placeholder="T001-00241"></div>' +
  '<div class="campo"><label>Transportista</label><input type="text" id="dp-transporte" placeholder="Andina Cargo"></div></div>' +
  '<div class="campo"><label>Requerimientos que atiende</label><input type="text" id="dp-reqs" placeholder="REQ-2026-007, REQ-2026-008"></div>' +
  '<div class="campo"><label>Detalle en Excel</label>' +
  '<button class="foto-btn" data-archivo="dp-excel"><span id="dp-excel-ico"></span>Adjuntar detalle</button>' +
  '<input type="file" id="dp-excel" accept=".xlsx,.csv" hidden><div class="ayuda" id="dp-info" style="margin:8px 0 0"></div></div>' +
  '<div class="campo"><label>Guía en PDF</label>' +
  '<button class="foto-btn" data-archivo="dp-pdf"><span id="dp-pdf-ico"></span>Adjuntar PDF</button>' +
  '<input type="file" id="dp-pdf" accept="application/pdf" hidden><div class="prev" id="dp-pdf-prev"></div></div>' +
  '<button class="btn btn-cont" id="dp-plantilla" style="margin-bottom:10px">Descargar plantilla del detalle</button>' +
  '<button class="btn btn-pri" id="dp-enviar">Despachar a obra</button></div>' +
  '<div class="sech">Despachos en camino</div><div id="dp-lista"></div>');
PANTALLAS.despacho = {titulo:"Despachar a obra", icono:"camion", perm:"guias"};

let despachoLineas = null;

function despachos(){ db.despachos = db.despachos || []; return db.despachos; }

/* --- Lado logística: registrar el despacho --- */
(function pantallaDespachoV18(){
  const p = $("dp-plantilla");
  if(!p) return;
  p.addEventListener("click", ()=>{
    descargarBlob("plantilla_despacho.xlsx", crearXLSX([{nombre:"Despacho", estilos:[1], filas:[
      ["Material","Unidad","Cantidad"],
      ["Cable NYY 3x4mm","m",150],
      ["Tomacorriente industrial","und",12],
      ["","",""]]}]));
    snack("Plantilla descargada.", "ok");
  });

  $("dp-excel").addEventListener("change", async e => {
    const archivo = e.target.files && e.target.files[0];
    if(!archivo) return;
    try{
      const filas = await leerTabla(archivo);
      despachoLineas = leerGuia(filas);
      $("dp-info").className = "ayuda";
      $("dp-info").innerHTML = "<b>" + despachoLineas.length + "</b> línea(s) leídas de <b>" +
        esc(archivo.name) + "</b>.";
    }catch(err){
      despachoLineas = null;
      $("dp-info").className = "ayuda err";
      $("dp-info").textContent = err.message || "No se pudo leer el archivo.";
    }
    e.target.value = "";
  });

  $("dp-enviar").addEventListener("click", ()=>{
    const numero = $("dp-numero").value.trim();
    if(!numero) return snack("Indique el número de guía.", "err");
    if(!despachoLineas || !despachoLineas.length)
      return snack("Adjunte el detalle en Excel con los materiales.", "err");
    const d = {
      id:uid(), fecha:ahora(), numero,
      transportista:$("dp-transporte").value.trim(),
      reqs:$("dp-reqs").value.trim(),
      pdf:adjuntos["dp-pdf"] || null,
      lineas:despachoLineas.map(l => ({desc:l.desc, unidad:l.unidad || "und", cant:num(l.cant) || 0})),
      estado:"en_camino", enviadoPor:usuarioActual().nombre, recepcion:null
    };
    despachos().unshift(d);
    log("compras", "Despacho enviado a obra", numero + " · " + d.lineas.length + " línea(s)", d.id);
    auditar("compras", "Despacho a obra", {comentario:numero + " · " + d.lineas.length + " línea(s)"});
    notificar({roles:["almacenero","admin","obra"],
      titulo:"Despacho en camino: " + numero,
      cuerpo:d.lineas.length + " material(es) · " + (d.transportista || "transportista por confirmar") +
             (d.reqs ? "\nAtiende: " + d.reqs : ""),
      refTipo:"despacho", refId:d.id});
    if(!guardar()) return;
    snack("Despacho registrado. El almacén ya fue avisado.", "ok");
    despachoLineas = null;
    ["dp-numero","dp-transporte","dp-reqs"].forEach(i => { if($(i)) $(i).value = ""; });
    $("dp-info").innerHTML = "";
    limpiarArchivo("dp-pdf");
    pintarDespachos();
  });
})();

function pintarDespachos(){
  const cont = $("dp-lista");
  if(!cont) return;
  const enCamino = despachos().filter(d => d.estado === "en_camino");
  cont.innerHTML = enCamino.length
    ? enCamino.map(d =>
      '<div class="fila"><span class="mini alerta">' + ico("camion", 20) + "</span>" +
      '<span class="txt"><b>Guía ' + esc(d.numero) + "</b><small>" + d.lineas.length +
      " material(es) · " + esc(d.transportista || "—") + " · " + hace(d.fecha) + "</small></span></div>").join("")
    : '<div class="vacio">' + ico("camion", 36) + "No hay despachos en camino.</div>";
}

/* --- Lado almacén: recibir y verificar --- */
function pintarRecepcion(){
  const pend = despachos().filter(d => d.estado === "en_camino");
  $("rc-pendientes").innerHTML =
    '<div class="sech" style="margin-top:4px">Por recibir' + (pend.length ? " · " + pend.length : "") + "</div>" +
    (pend.length
      ? pend.map(d =>
        '<div class="card" style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">' +
        '<span class="mini alerta" style="width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--alerta-f);color:var(--alerta);flex:none">' +
        ico("camion", 19) + "</span>" +
        '<span style="flex:1;min-width:0"><b style="display:block;font-size:13.5px">Guía ' + esc(d.numero) + "</b>" +
        '<small style="font-size:11px;color:var(--tinta-sec)">' + esc(d.transportista || "—") +
        " · despachado " + hace(d.fecha) + "</small></span>" +
        '<span class="chip alerta">Por recibir</span></div>' +
        '<div class="card plano" style="margin:0 0 9px;font-size:11.5px;color:var(--tinta-sec);padding:9px">' +
        "<b style='color:var(--tinta)'>" + d.lineas.length + " materiales</b>" +
        (d.reqs ? " · " + esc(d.reqs) : "") + "<br>Enviado por " + esc(d.enviadoPor || "logística") + "</div>" +
        '<button class="btn btn-pri" data-recibir="' + d.id + '">Recibir y verificar</button></div>').join("")
      : '<div class="vacio">' + ico("camion", 40) + "No hay despachos en camino.</div>");

  $$("#rc-pendientes [data-recibir]").forEach(b =>
    b.addEventListener("click", ()=> abrirVerificacion(b.dataset.recibir)));

  const hechas = despachos().filter(d => d.estado === "recibido").slice(0, 8);
  $("rc-historial").innerHTML = hechas.length
    ? hechas.map(d => {
        const r = d.recepcion || {};
        const ok = r.conformes === d.lineas.length;
        return '<div class="fila"><span class="mini ' + (ok ? "ok" : "mal") + '">' +
          ico(ok ? "check" : "alerta", 19) + "</span>" +
          '<span class="txt"><b>' + esc(d.numero) + "</b><small>" +
          (ok ? "Conforme" : "Con diferencias") + " · " + r.conformes + " de " + d.lineas.length +
          " · " + hace(r.fecha || d.fecha) + "</small></span></div>";
      }).join("")
    : '<div class="vacio">Todavía no ha recibido despachos.</div>';
}

function abrirVerificacion(id){
  const d = despachos().find(x => x.id === id);
  if(!d) return;
  const recibido = d.lineas.map(l => l.cant);

  const pinta = ()=>{
    const cuerpo = d.lineas.map((l,i) => {
      const r = recibido[i];
      const estado = r >= l.cant ? "ok" : (r > 0 ? "parcial" : "nada");
      const chip = r >= l.cant ? '<span class="chip ok">Conforme</span>'
                 : (r > 0 ? '<span class="chip alerta">Faltan ' + +(l.cant - r).toFixed(2) + "</span>"
                          : '<span class="chip mal">No llegó</span>');
      return '<div class="rc-linea ' + estado + '"><div class="cab"><b>' + esc(l.desc) + "</b>" + chip + "</div>" +
        '<div class="fila-cant"><span class="dice">Guía dice <b style="color:var(--tinta)">' +
        l.cant + " " + esc(l.unidad) + "</b></span>" +
        '<input type="number" min="0" step="0.01" inputmode="decimal" value="' + r +
        '" data-rc="' + i + '"><span class="und">' + esc(l.unidad) + "</span></div></div>";
    }).join("");

    const conformes = d.lineas.filter((l,i)=> recibido[i] >= l.cant).length;
    const completo = conformes === d.lineas.length;
    const resumen = '<div class="card ' + (completo ? "acento" : "aviso") + '" style="font-size:11.5px;padding:11px;margin:11px 0 0">' +
      "<b>" + (completo ? "Llegó completo" : "Llegó incompleto") + "</b><br>" +
      conformes + " de " + d.lineas.length + " conformes" +
      (completo ? "." : ". Se avisará a la Jefa de Logística al registrar.") + "</div>";

    hoja("Guía " + esc(d.numero), cuerpo + resumen,
      [{txt:"Registrar ingreso", clase:"btn-pri", fn:()=> registrarRecepcion(d, recibido)},
       {txt:"Cerrar", clase:"btn-cont"}]);

    $$("#hoja-cuerpo [data-rc]").forEach(inp => inp.addEventListener("change", ()=>{
      recibido[+inp.dataset.rc] = Math.max(0, num(inp.value));
      pinta();
    }));
  };
  pinta();
}

function registrarRecepcion(d, recibido){
  const faltantes = [];
  d.lineas.forEach((l,i) => {
    const cant = recibido[i];
    if(cant > 0){
      let m = db.materiales.find(x => sinTildes(x.nombre) === sinTildes(l.desc));
      if(!m){
        m = {id:uid(), codigo:codigo("MAT"), nombre:l.desc, categoria:"", unidad:l.unidad || "und",
             stock:0, minimo:0, obs:"", foto:null, creado:ahora()};
        db.materiales.push(m);
      }
      m.stock = +(m.stock + cant).toFixed(2);
      registrarMov({tipo:"ingreso", itemId:m.id, item:m.nombre, cantidad:cant, unidad:m.unidad,
        saldo:m.stock, persona:"", area:"", documento:d.numero,
        obs:"Recepción de guía " + d.numero, foto1:null, foto2:null});
    }
    if(cant < l.cant) faltantes.push(l.desc + ": llegaron " + cant + " de " + l.cant + " " + (l.unidad || ""));
  });

  const conformes = d.lineas.filter((l,i)=> recibido[i] >= l.cant).length;
  d.estado = "recibido";
  d.recepcion = {fecha:ahora(), por:usuarioActual().nombre, conformes,
                 total:d.lineas.length, completo:conformes === d.lineas.length,
                 recibido:recibido.slice()};

  log("compras", "Guía recibida", d.numero + " · " + conformes + " de " + d.lineas.length + " conformes", d.id);
  auditar("compras", faltantes.length ? "Recepción con diferencias" : "Recepción conforme",
    {comentario:d.numero + " · " + conformes + " de " + d.lineas.length});

  if(faltantes.length)
    notificar({roles:["jefatura","compras","obra","admin"],
      titulo:"Diferencias en la guía " + d.numero,
      cuerpo:faltantes.join("\n"), refTipo:"despacho", refId:d.id});

  if(!guardar()) return;
  snack(faltantes.length ? "Ingreso registrado con diferencias. Logística fue avisada."
                         : "Ingreso registrado. Guía conforme.", "ok");
  pintarRecepcion();
}

const refrescarV18 = refrescar;
refrescar = function(destino){
  refrescarV18(destino);
  if(destino === "recepcion2") pintarRecepcion();
  if(destino === "despacho")   pintarDespachos();
};

/* --- El panel del almacenero, ordenado por el flujo real --- */
const tareasDelCargoV18 = tareasDelCargo;
tareasDelCargo = function(){
  const rol = rolEfectivo();
  if(rol !== "almacenero") return tareasDelCargoV18();

  const porRecibir = despachos().filter(d => d.estado === "en_camino").length;
  const porVolver = db.herramientas.filter(h => h.estado === "prestada").length;
  const T = [];
  T.push({ic:"pedidos", t:"Nuevo requerimiento", d:"Lo que le piden en almacén · pasa a la Administradora de Obra",
          fn:()=> abrirRequerimiento(), destacada:true});
  T.push({ic:"camion", t:"Recibir materiales", d:"Verifique contra la guía de logística",
          n:porRecibir, fn:()=> ir("recepcion2"), destacada:true, ancha:true});
  T.push({ic:"caja", t:"Entregar consumible", d:"Uno o varios artículos en un vale",
          fn:()=> ir("movimientos", "mSalida")});
  T.push({ic:"llave", t:"Prestar herramienta", d:"A quién y hasta cuándo", fn:()=> abrirPrestamo()});
  T.push({ic:"cambiar", t:"Devoluciones", d:"Herramientas por volver", n:porVolver,
          fn:()=> ir("herramientas", "hPrestamos")});
  T.push({ic:"inventario", t:"Inventario general", d:"Stock, mínimos y críticos", fn:()=> ir("inventario")});
  T.push({ic:"escudo", t:"Kardex de EPP", d:"Qué EPP recibió cada trabajador", fn:()=> ir("epp"), ancha:true});
  if(simulando()) T.push({ic:"cambiar", t:"Salir de la simulación", d:"Volver a su cuenta", fn:salirSimulacion});
  return T;
};

/* Logística y Compras acceden al despacho desde sus tareas */
const tareasDelCargoV18b = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV18b();
  const rol = rolEfectivo();
  if(rol === "jefatura" || rol === "compras")
    T.splice(1, 0, {ic:"camion", t:"Despachar a obra", d:"Registrar la guía de salida",
                    fn:()=> ir("despacho")});
  return T;
};

/* ---------------------------------------------------------------
   V19  Gráficas en los reportes.
        PDF: anillo de avance y barras dibujadas en la propia hoja.
        Excel: barras de texto dentro de la celda, que se ven en
        cualquier Excel y en Google Sheets sin riesgo de que el
        archivo se dañe.
   --------------------------------------------------------------- */

function barraTexto(valor, maximo, ancho){
  const n = maximo > 0 ? Math.round((valor / maximo) * (ancho || 20)) : 0;
  return "█".repeat(Math.max(0, n)) || "·";
}

function anilloSVG(pct, tam){
  const t = tam || 90, r = t * 0.38, c = 2 * Math.PI * r, mitad = t / 2;
  const color = pct >= 70 ? "#1E8E5A" : (pct >= 40 ? "#1B4B8F" : "#C4362B");
  return '<svg viewBox="0 0 ' + t + " " + t + '" width="' + t + '" height="' + t + '">' +
    '<circle cx="' + mitad + '" cy="' + mitad + '" r="' + r + '" fill="none" stroke="#EDF1F7" stroke-width="' + (t*0.13) + '"/>' +
    '<circle cx="' + mitad + '" cy="' + mitad + '" r="' + r + '" fill="none" stroke="' + color +
    '" stroke-width="' + (t*0.13) + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) +
    '" stroke-dashoffset="' + (c * (1 - Math.min(100, pct)/100)).toFixed(1) +
    '" transform="rotate(-90 ' + mitad + " " + mitad + ')"/>' +
    '<text x="' + mitad + '" y="' + (mitad + t*0.06) + '" text-anchor="middle" font-size="' + (t*0.19) +
    '" font-weight="700" fill="' + color + '">' + pct + "%</text></svg>";
}

function barrasSVG(datos, ancho){
  const w = ancho || 300, alto = 96, base = 72, izq = 34;
  const max = Math.max(1, ...datos.map(d => d.valor));
  const paso = (w - izq - 10) / Math.max(1, datos.length);
  let s = '<svg viewBox="0 0 ' + w + " " + alto + '" width="100%" height="' + alto + '">' +
    '<line x1="' + izq + '" y1="' + base + '" x2="' + (w-6) + '" y2="' + base + '" stroke="#DCE3ED"/>' +
    '<text x="' + (izq-4) + '" y="' + (base+3) + '" text-anchor="end" font-size="8" fill="#5B6672">0</text>' +
    '<text x="' + (izq-4) + '" y="15" text-anchor="end" font-size="8" fill="#5B6672">' + max + "</text>";
  datos.forEach((d,i) => {
    const h = Math.round((d.valor / max) * 58);
    const x = izq + paso*i + paso*0.22, bw = paso*0.56;
    s += '<rect x="' + x.toFixed(1) + '" y="' + (base-h) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(2,h) +
      '" rx="2" fill="' + (d.color || "#1B4B8F") + '"/>' +
      '<text x="' + (x + bw/2).toFixed(1) + '" y="' + (base+12) + '" text-anchor="middle" font-size="8.5" fill="#5B6672">' +
      esc(d.eti) + "</text>" +
      '<text x="' + (x + bw/2).toFixed(1) + '" y="' + (base-h-3) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="' +
      (d.color || "#1B4B8F") + '">' + d.valor + "</text>";
  });
  return s + "</svg>";
}

/* --- El PDF del reporte estrena cabecera con gráficas --- */
const reporteEjecutivoHTMLV19 = reporteEjecutivoHTML;
reporteEjecutivoHTML = function(dia, observaciones){
  const html = reporteEjecutivoHTMLV19(dia, observaciones);
  const d = datosEjecutivos(dia);
  const c = db.consolidado.items.length ? avanceConsolidado() : null;
  const movs = d.movs || [];
  const cuenta = t => movs.filter(m => m.tipo === t).length;

  const bloque =
    '<div style="display:flex;gap:18px;align-items:center;margin:14px 0 18px;padding:14px;' +
    'border:1px solid #DCE3ED;border-radius:8px">' +
    (c ? '<div style="text-align:center;flex:none">' + anilloSVG(c.avance, 96) +
         '<div style="font-size:9px;color:#5B6672;margin-top:3px">Consolidado</div></div>' : "") +
    '<div style="flex:1">' +
    '<div style="font-size:9px;color:#5B6672;letter-spacing:.06em;font-weight:600;margin-bottom:6px">MOVIMIENTOS DEL DÍA</div>' +
    barrasSVG([
      {eti:"Ingresos",    valor:cuenta("ingreso"),    color:"#1E8E5A"},
      {eti:"Salidas",     valor:cuenta("salida"),     color:"#1B4B8F"},
      {eti:"Préstamos",   valor:cuenta("prestamo"),   color:"#E8821A"},
      {eti:"Devoluciones",valor:cuenta("devolucion"), color:"#5B4BB7"}
    ]) + "</div></div>";

  return html.replace(/<body([^>]*)>/i, "<body$1>").replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, "$1" + bloque);
};

/* --- El Excel del reporte estrena una hoja con barras de texto ---
   Se deja que el libro original se arme, se capturan sus hojas y se
   vuelve a armar con la hoja de gráficas al final. */
const libroAdminV19 = libroAdmin;
libroAdmin = function(dia){
  let hojas = null;
  const original = crearXLSX;
  crearXLSX = function(h){ hojas = h; return original(h); };
  try{ libroAdminV19(dia); } finally { crearXLSX = original; }
  return original((hojas || []).concat([hojaGraficas(dia)]));
};

function hojaGraficas(dia){
  const d = datosEjecutivos(dia);
  const movs = d.movs || [];
  const cuenta = t => movs.filter(m => m.tipo === t).length;
  const c = db.consolidado.items.length ? avanceConsolidado() : null;
  const tipos = [["Ingresos", cuenta("ingreso")], ["Salidas", cuenta("salida")],
                 ["Préstamos", cuenta("prestamo")], ["Devoluciones", cuenta("devolucion")]];
  const max = Math.max(1, ...tipos.map(t => t[1]));
  const filas = [["Movimiento","Cantidad","Gráfico"]]
    .concat(tipos.map(t => [t[0], t[1], barraTexto(t[1], max, 20)]))
    .concat([[]]);
  if(c){
    filas.push(["Avance del consolidado", c.avance + "%", barraTexto(c.avance, 100, 20)]);
    filas.push(["Materiales completos", c.entregados + " de " + c.total, barraTexto(c.entregados, c.total, 20)]);
    filas.push([]);
  }
  const criticos = db.materiales.filter(m => estadoStock(m) !== "disponible").slice(0, 10);
  if(criticos.length){
    filas.push(["Artículo","Stock","Mínimo","Gráfico"]);
    criticos.forEach(m => filas.push([m.nombre, m.stock, m.minimo || 0, barraTexto(m.stock, m.minimo || 1, 20)]));
  }
  return {nombre:"Graficas", filas, estilos:[1]};
}


/* ---------------------------------------------------------------
   V20  Unidades de medida estandarizadas.
        La misma lista al crear un producto, al despachar, al recibir
        y al entregar. Se deja escribir una propia para casos raros,
        y al recibir se avisa si la unidad no coincide con la del
        almacén, para no sumar cajas a un stock contado en unidades.
   --------------------------------------------------------------- */

const UNIDADES = [
  {grupo:"Conteo", items:[["und","Unidad"],["par","Par"],["jgo","Juego"],["doc","Docena"]]},
  {grupo:"Longitud y área", items:[["m","Metro"],["rll","Rollo"],["var","Varilla"],["pln","Plancha"],["m2","Metro²"]]},
  {grupo:"Peso y volumen", items:[["kg","Kilogramo"],["L","Litro"],["gal","Galón"],["m3","Metro³"]]},
  {grupo:"Empaque", items:[["cja","Caja"],["bls","Bolsa"],["bld","Balde"],["paq","Paquete"]]}
];

/* Variantes que la gente escribe a mano y su unidad de la lista */
const ALIAS_UNIDAD = {
  unidad:"und", unidades:"und", unid:"und", uni:"und", u:"und", pza:"und", pieza:"und",
  metro:"m", metros:"m", mt:"m", mts:"m", ml:"m",
  juego:"jgo", juegos:"jgo", set:"jgo",
  caja:"cja", cajas:"cja",
  bolsa:"bls", bolsas:"bls", saco:"bls", sacos:"bls",
  pares:"par", rollo:"rll", rollos:"rll", varilla:"var", varillas:"var",
  plancha:"pln", planchas:"pln", balde:"bld", baldes:"bld",
  paquete:"paq", paquetes:"paq", docena:"doc", docenas:"doc",
  kilo:"kg", kilos:"kg", kilogramo:"kg", kilogramos:"kg",
  litro:"L", litros:"L", lt:"L", galon:"gal", galones:"gal",
  m3:"m3", metrocubico:"m3", m2:"m2"
};

function normalizarUnidad(u){
  const t = sinTildes(String(u || "").trim()).replace(/\.$/, "");
  if(!t) return "";
  const directa = UNIDADES.some(g => g.items.some(i => i[0].toLowerCase() === t));
  if(directa) return UNIDADES.reduce((r,g)=> r || (g.items.find(i => i[0].toLowerCase() === t) || [])[0], null);
  return ALIAS_UNIDAD[t] || String(u).trim();
}

function nombreUnidad(u){
  const c = normalizarUnidad(u);
  for(const g of UNIDADES){
    const i = g.items.find(x => x[0] === c);
    if(i) return i[1] + " (" + i[0] + ")";
  }
  return c || "—";
}

/* Convierte un <input> de unidad en lista, dejando escribir una propia */
function selectorUnidad(id, valor){
  const campo = $(id);
  if(!campo) return;
  let sel = $(id + "-sel");
  if(!sel){
    sel = document.createElement("select");
    sel.id = id + "-sel";
    campo.insertAdjacentElement("beforebegin", sel);
    campo.classList.add("oculto");
    campo.placeholder = "Escriba la unidad";
    sel.addEventListener("change", ()=>{
      const otra = sel.value === "__otra";
      campo.classList.toggle("oculto", !otra);
      if(otra){ campo.value = ""; campo.focus(); }
      else campo.value = sel.value;
    });
  }
  sel.innerHTML = '<option value="">— Unidad —</option>' +
    UNIDADES.map(g => '<optgroup label="' + g.grupo + '">' +
      g.items.map(i => '<option value="' + i[0] + '">' + i[1] + " · " + i[0] + "</option>").join("") +
      "</optgroup>").join("") +
    '<option value="__otra">Otra unidad…</option>';
  const v = normalizarUnidad(valor || campo.value);
  const existe = UNIDADES.some(g => g.items.some(i => i[0] === v));
  if(v && existe){ sel.value = v; campo.value = v; campo.classList.add("oculto"); }
  else if(v){ sel.value = "__otra"; campo.value = v; campo.classList.remove("oculto"); }
  else sel.value = "";
}

/* Al crear un producto la unidad deja de escribirse a mano */
const abrirProductoV20 = abrirProducto;
abrirProducto = function(tipo, id){
  abrirProductoV20(tipo, id);
  selectorUnidad("mp-unidad", $("mp-unidad").value);
};

/* Lo que se escriba a mano igual entra normalizado */
const nuevoMaterialGuardarV20 = typeof guardarProducto === "function" ? guardarProducto : null;
if(nuevoMaterialGuardarV20){
  guardarProducto = function(){
    if($("mp-unidad")) $("mp-unidad").value = normalizarUnidad($("mp-unidad").value);
    return nuevoMaterialGuardarV20.apply(null, arguments);
  };
}

/* ---------------------------------------------------------------
   V21  Recepción contando: el almacenero agrega lo que realmente
        bajó del camión y la app lo cruza contra la guía. Lo que llega
        sin figurar en la guía también entra, marcado como no
        declarado, porque físicamente ya está en el almacén.
   --------------------------------------------------------------- */

(function estilosV21(){
  if($("estilos-v21")) return;
  const s = document.createElement("style");
  s.id = "estilos-v21";
  s.textContent =
    ".rec-item{background:var(--sup);border-radius:var(--r-m);padding:11px;margin-bottom:7px;box-shadow:var(--s1)}" +
    ".rec-item.extra{border-left:3px solid var(--lila);border-radius:0 var(--r-m) var(--r-m) 0}" +
    ".rec-item .cab{display:flex;align-items:center;gap:8px;margin-bottom:5px}" +
    ".rec-item .cab b{flex:1;font-size:12.5px;font-weight:600}" +
    ".rec-item small{font-size:10.5px;color:var(--tinta-sec)}" +
    "#rec-cifras{display:flex;gap:7px;margin-bottom:11px}" +
    "#rec-cifras .c{flex:1;background:var(--sup);border-radius:10px;padding:9px;text-align:center;box-shadow:var(--s1)}" +
    "#rec-cifras .c b{display:block;font-size:17px}" +
    "#rec-cifras .c small{font-size:8.5px;color:var(--tinta-sec)}";
  document.head.appendChild(s);
})();

let recepConteo = null, recibidos = [];

crearPantalla("recibiendo",
  '<div id="rec-guia"></div>' +
  '<div class="card">' +
  '<div class="campo"><label>Material recibido</label><select id="rec-material"></select></div>' +
  '<div class="campo oculto" id="rec-campo-nuevo"><label>Nombre del material</label>' +
  '<input type="text" id="rec-nuevo" placeholder="Como figura en la guía"></div>' +
  '<div class="dos">' +
  '<div class="campo"><label>Cantidad contada</label><input type="number" id="rec-cant" min="0.01" step="0.01" inputmode="decimal" placeholder="0"></div>' +
  '<div class="campo"><label>Unidad</label><input type="text" id="rec-unidad" placeholder="und"></div></div>' +
  '<button class="btn btn-ton" id="rec-agregar">Agregar a la recepción</button></div>' +
  '<div class="sech" id="rec-titulo">Recibido</div>' +
  '<div id="rec-cifras"></div>' +
  '<div id="rec-lista"></div>' +
  '<div id="rec-cruce"></div>' +
  '<div class="campo" style="margin-top:12px"><label>Foto de la descarga</label>' +
  '<button class="foto-btn" data-foto="rec-foto"><span id="rec-foto-ico"></span>Tomar foto</button>' +
  '<input type="file" id="rec-foto" accept="image/*" capture="environment" hidden>' +
  '<div class="prev" id="rec-foto-prev"></div></div>' +
  '<button class="btn btn-pri" id="rec-registrar">Registrar ingreso</button>');
PANTALLAS.recibiendo = {titulo:"Recibir materiales", icono:"camion", perm:"guias"};

function abrirRecepcion(id){
  recepConteo = id ? despachos().find(x => x.id === id) : null;
  recibidos = [];
  ir("recibiendo");
}

/* La lista de la pantalla anterior ahora lleva al panel de conteo */
const pintarRecepcionV21 = pintarRecepcion;
pintarRecepcion = function(){
  pintarRecepcionV21();
  $$("#rc-pendientes [data-recibir]").forEach(b => {
    const n = b.cloneNode(true);
    b.parentNode.replaceChild(n, b);
    n.addEventListener("click", ()=> abrirRecepcion(n.dataset.recibir));
  });
  if(!$("rc-sin-guia")){
    const btn = document.createElement("button");
    btn.className = "btn btn-cont";
    btn.id = "rc-sin-guia";
    btn.style.marginBottom = "6px";
    btn.textContent = "Recibir sin guía";
    $("rc-pendientes").appendChild(btn);
    btn.addEventListener("click", ()=> abrirRecepcion(null));
  }
};

function llenarMaterialesRecepcion(){
  const sel = $("rec-material");
  if(!sel) return;
  const enGuia = recepConteo ? recepConteo.lineas.map(l => l.desc) : [];
  const nombres = db.materiales.map(m => m.nombre);
  enGuia.forEach(d => { if(nombres.indexOf(d) < 0) nombres.push(d); });
  nombres.sort((a,b)=> a.localeCompare(b));
  sel.innerHTML = '<option value="">— Seleccione el material —</option>' +
    nombres.map(n => '<option value="' + esc(n) + '"' +
      (enGuia.indexOf(n) >= 0 ? ' data-guia="1"' : "") + ">" + esc(n) +
      (enGuia.indexOf(n) >= 0 ? " · en la guía" : "") + "</option>").join("") +
    '<option value="__nuevo">Otro material…</option>';
  sel.onchange = ()=>{
    const nuevo = sel.value === "__nuevo";
    $("rec-campo-nuevo").classList.toggle("oculto", !nuevo);
    if(nuevo){ $("rec-nuevo").value = ""; $("rec-nuevo").focus(); $("rec-unidad").value = ""; }
    else {
      const m = db.materiales.find(x => x.nombre === sel.value);
      const l = recepConteo && recepConteo.lineas.find(x => x.desc === sel.value);
      const u = (m && m.unidad) || (l && l.unidad) || "";
      selectorUnidad("rec-unidad", u);
    }
  };
}

function nombreRecepcion(){
  const sel = $("rec-material");
  return sel.value === "__nuevo" ? $("rec-nuevo").value.trim() : sel.value;
}

function lineaDeGuia(nombre){
  if(!recepConteo) return null;
  return recepConteo.lineas.find(l => sinTildes(l.desc) === sinTildes(nombre)) || null;
}

function agregarRecibido(){
  const nombre = nombreRecepcion();
  const cant = num($("rec-cant").value);
  const unidad = normalizarUnidad($("rec-unidad").value) || "und";
  if(!nombre) return snack("Indique el material.", "err");
  if(cant <= 0) return snack("Ingrese la cantidad contada.", "err");
  if(recibidos.some(r => sinTildes(r.nombre) === sinTildes(nombre)))
    return snack("Ese material ya está en la recepción.", "err");

  const m = db.materiales.find(x => sinTildes(x.nombre) === sinTildes(nombre));
  if(m && normalizarUnidad(m.unidad) !== unidad)
    snack("Ojo: en almacén está en " + nombreUnidad(m.unidad) + " y usted anotó " + nombreUnidad(unidad) + ".", "err");

  recibidos.push({nombre, cantidad:cant, unidad});
  $("rec-cant").value = "";
  $("rec-material").value = "";
  $("rec-nuevo").value = "";
  $("rec-campo-nuevo").classList.add("oculto");
  pintarRecibidos();
  snack(nombre + " agregado.", "ok");
}

function cruceRecepcion(){
  const g = recepConteo ? recepConteo.lineas : [];
  const conformes = [], incompletos = [], noLlegaron = [], deMas = [];
  recibidos.forEach(r => {
    const l = lineaDeGuia(r.nombre);
    if(!l) deMas.push(r);
    else if(r.cantidad >= l.cant) conformes.push({r, l});
    else incompletos.push({r, l});
  });
  g.forEach(l => { if(!recibidos.some(r => sinTildes(r.nombre) === sinTildes(l.desc))) noLlegaron.push(l); });
  return {conformes, incompletos, noLlegaron, deMas, cuadra: !incompletos.length && !noLlegaron.length && !deMas.length};
}

function pintarRecibidos(){
  const g = recepConteo;
  $("rec-guia").innerHTML = g
    ? '<div class="card acento" style="display:flex;align-items:center;gap:10px">' +
      ico("documento", 19) +
      '<div style="flex:1;min-width:0"><b style="display:block;font-size:12.5px">La guía trae ' +
      g.lineas.length + " materiales</b>" +
      '<small style="font-size:10.5px">Guía ' + esc(g.numero) + " · enviada por " +
      esc(g.enviadoPor || "logística") + "</small></div></div>"
    : '<div class="card aviso" style="font-size:12px">Recepción <b>sin guía</b>. Quedará marcada como sin respaldo de logística.</div>';

  const c = cruceRecepcion();
  $("rec-titulo").textContent = recibidos.length ? "Recibido · " + recibidos.length : "Recibido";

  $("rec-cifras").innerHTML = (g && (recibidos.length || g.lineas.length))
    ? '<div class="c"><b style="color:var(--ok)">' + c.conformes.length + "</b><small>Conforme</small></div>" +
      '<div class="c"><b style="color:var(--alerta)">' + c.incompletos.length + "</b><small>Incompleto</small></div>" +
      '<div class="c"><b style="color:var(--mal)">' + c.noLlegaron.length + "</b><small>No llegó</small></div>" +
      '<div class="c"><b style="color:var(--lila)">' + c.deMas.length + "</b><small>De más</small></div>"
    : "";

  $("rec-lista").innerHTML = recibidos.length
    ? recibidos.map((r,i) => {
        const l = lineaDeGuia(r.nombre);
        const chip = !g ? ""
          : (!l ? '<span class="chip lila">No estaba en la guía</span>'
                : (r.cantidad >= l.cant ? '<span class="chip ok">Coincide</span>'
                                        : '<span class="chip alerta">Faltan ' + +(l.cant - r.cantidad).toFixed(2) + "</span>"));
        return '<div class="rec-item' + (g && !l ? " extra" : "") + '"><div class="cab"><b>' + esc(r.nombre) + "</b>" +
          chip + '<button class="quitar" data-quitar-rec="' + i + '">Quitar</button></div>' +
          "<small>Conté " + r.cantidad + " " + esc(r.unidad) +
          (l ? " · la guía dice " + l.cant + " " + esc(l.unidad) : (g ? " · llegó de más" : "")) +
          "</small></div>";
      }).join("")
    : '<div class="vacio">' + ico("camion", 36) +
      "Agregue el primer material contado.<br>La app lo compara con la guía.</div>";

  $$("#rec-lista [data-quitar-rec]").forEach(b => b.addEventListener("click", ()=>{
    recibidos.splice(+b.dataset.quitarRec, 1);
    pintarRecibidos();
  }));

  $("rec-cruce").innerHTML = (g && recibidos.length)
    ? (c.cuadra
        ? '<div class="card acento" style="font-size:11.5px;padding:11px"><b>La guía cuadra.</b> Todo lo despachado llegó completo.</div>'
        : '<div class="card aviso" style="font-size:11.5px;padding:11px"><b>La guía no cuadra.</b> ' +
          "Al registrar se avisa a la Jefa de Logística con el detalle, y lo que no llegó queda pendiente." +
          (c.noLlegaron.length ? "<br>No llegó: " + esc(c.noLlegaron.map(l => l.desc).join(", ")) : "") +
          (c.deMas.length ? "<br>De más: " + esc(c.deMas.map(r => r.nombre).join(", ")) : "") + "</div>")
    : "";

  const btn = $("rec-registrar");
  btn.textContent = recibidos.length
    ? "Registrar ingreso de " + recibidos.length + " material(es)"
    : "Registrar ingreso";
  btn.disabled = !recibidos.length;
  btn.style.opacity = recibidos.length ? "" : ".45";
}

function registrarRecepcionContada(){
  if(!recibidos.length) return snack("Agregue al menos un material.", "err");
  const g = recepConteo;
  const c = cruceRecepcion();
  const foto = fotos["rec-foto"] || null;
  const doc = g ? g.numero : "SIN GUÍA";

  recibidos.forEach(r => {
    let m = db.materiales.find(x => sinTildes(x.nombre) === sinTildes(r.nombre));
    if(!m){
      m = {id:uid(), codigo:codigo("MAT"), nombre:r.nombre, categoria:"", unidad:r.unidad,
           stock:0, minimo:0, obs:"", foto:null, creado:ahora()};
      db.materiales.push(m);
    }
    m.stock = +(m.stock + r.cantidad).toFixed(2);
    registrarMov({tipo:"ingreso", itemId:m.id, item:m.nombre, cantidad:r.cantidad, unidad:r.unidad,
      saldo:m.stock, persona:"", area:"", documento:doc,
      obs:(g && !lineaDeGuia(r.nombre)) ? "No declarado en la guía" : (g ? "Recepción de guía " + g.numero : "Recepción sin guía"),
      foto1:foto, foto2:null});
  });

  if(g){
    g.estado = "recibido";
    g.recepcion = {fecha:ahora(), por:usuarioActual().nombre,
      conformes:c.conformes.length, total:g.lineas.length,
      completo:c.cuadra, contado:recibidos.slice(),
      faltantes:c.noLlegaron.map(l => l.desc), incompletos:c.incompletos.map(x => x.l.desc),
      deMas:c.deMas.map(r => r.nombre)};
  }

  log("compras", g ? "Guía recibida" : "Ingreso sin guía",
      doc + " · " + recibidos.length + " material(es)", g ? g.id : null);
  auditar("compras", c.cuadra ? "Recepción conforme" : "Recepción con diferencias",
    {comentario:doc + " · " + recibidos.length + " material(es)", fotos:foto ? [1] : []});

  if(g && !c.cuadra){
    const det = []
      .concat(c.incompletos.map(x => x.l.desc + ": llegaron " + x.r.cantidad + " de " + x.l.cant + " " + (x.l.unidad || "")))
      .concat(c.noLlegaron.map(l => l.desc + ": no llegó (" + l.cant + " " + (l.unidad || "") + ")"))
      .concat(c.deMas.map(r => r.nombre + ": llegó sin figurar en la guía (" + r.cantidad + " " + r.unidad + ")"));
    notificar({roles:["jefatura","compras","obra","admin"],
      titulo:"Diferencias en la guía " + g.numero, cuerpo:det.join("\n"),
      refTipo:"despacho", refId:g.id});
  }

  if(!guardar()) return;
  snack(c.cuadra ? "Ingreso registrado. Guía conforme."
                 : "Ingreso registrado con diferencias. Logística fue avisada.", "ok");
  recibidos = [];
  recepConteo = null;
  limpiarFoto("rec-foto");
  ir("recepcion2");
}

(function conectarRecepcionV21(){
  if($("rec-agregar")) $("rec-agregar").addEventListener("click", agregarRecibido);
  if($("rec-registrar")) $("rec-registrar").addEventListener("click", registrarRecepcionContada);
})();

const refrescarV21 = refrescar;
refrescar = function(destino){
  refrescarV21(destino);
  if(destino === "recibiendo"){ llenarMaterialesRecepcion(); selectorUnidad("rec-unidad"); pintarRecibidos(); }
};

/* ---------------------------------------------------------------
   V22  Sin mosaicos repetidos.
        Cuando una sección ya tiene su tarjeta grande en el inicio,
        su mosaico desaparece de «Mis tareas». La regla es general:
        vale para cualquier cargo, presente o futuro.
   --------------------------------------------------------------- */

/* Tarjetas grandes del inicio y el mosaico que dejarían repetido */
const TARJETAS_GRANDES = [
  {tarjeta:()=> !!$("ini-consolidado"), titulos:[/^consolidado/i]},
  {tarjeta:()=> !!$("ad-reporte") && !$("ad-reporte").classList.contains("oculto"),
   titulos:[/^reporte de la app$/i, /^reporte diario$/i]},
  {tarjeta:()=> !!$("pi-reporte") && !$("pi-reporte").classList.contains("oculto"),
   titulos:[/^personas involucradas$/i]}
];

const tareasDelCargoV22 = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV22();
  const repetidos = TARJETAS_GRANDES.filter(x => x.tarjeta())
    .reduce((a,x)=> a.concat(x.titulos), []);
  if(!repetidos.length) return T;
  return T.filter(t => !repetidos.some(re => re.test((t.t || "").trim())));
};

/* La tarjeta grande se dibuja después de las tareas, así que hay que
   repintar una vez para que el mosaico repetido desaparezca. */
const pintarInicioV22 = pintarInicio;
pintarInicio = function(){
  pintarInicioV22();
  if(typeof pintarTareas === "function") pintarTareas();
};

/* ---------------------------------------------------------------
   V23  El cambio de modo baja de la barra superior a la tarjeta de
        saludo, justo debajo del nombre y el cargo. La barra queda
        despejada y el botón aparece donde se lee quién es usted.
   --------------------------------------------------------------- */

(function estilosV23(){
  if($("estilos-v23")) return;
  const s = document.createElement("style");
  s.id = "estilos-v23";
  s.textContent =
    "#appbar #btn-modo{display:none !important}" +
    "#ini-saludo .btn-modo{position:static;margin-top:9px;height:36px;padding:0 14px;width:auto;" +
      "background:var(--pri-cont);border:1px solid var(--pri-cont);color:var(--pri-osc);font-size:12.5px}" +
    "#ini-saludo .btn-modo.admin{background:var(--lila-f);border-color:var(--lila-f);color:var(--lila)}" +
    "#ini-saludo .btn-modo:active{filter:brightness(.94)}";
  document.head.appendChild(s);
})();

/* El botón de la barra queda oculto pero vivo: conserva su listener.
   En el saludo se dibuja uno propio, porque la tarjeta se redibuja
   entera en cada pintado y se llevaría por delante al original. */
function moverBotonModo(){
  const original = $("btn-modo"), saludo = $("ini-saludo");
  if(!original || !saludo) return;
  original.classList.add("oculto");

  const u = usuarioActual();
  const puedeCambiar = u && u.esAdmin && !simulando();
  const fila = saludo.firstElementChild;
  const datos = fila && fila.lastElementChild;
  if(!datos || datos === fila) return;

  let b = $("btn-modo-saludo");
  if(!puedeCambiar){ if(b) b.remove(); return; }
  if(!b || !datos.contains(b)){
    if(b) b.remove();
    b = document.createElement("button");
    b.id = "btn-modo-saludo";
    b.className = "btn-modo";
    b.addEventListener("click", ()=> $("btn-modo").click());
    datos.appendChild(b);
  }
  const enAdmin = esModoAdmin();
  b.classList.toggle("admin", enAdmin);
  b.innerHTML = ico(enAdmin ? "inventario" : "escudo", 15) +
                (enAdmin ? "Ir a almacén" : "Ir a admin");
}

const pintarInicioV23 = pintarInicio;
pintarInicio = function(){
  pintarInicioV23();
  moverBotonModo();
  pintarModoV12();
};

const aplicarRolV23 = aplicarRol;
aplicarRol = function(){ aplicarRolV23(); moverBotonModo(); };

/* ---------------------------------------------------------------
   V24  El cambio de modo vuelve a la barra superior, donde estaba
        bien. Lo que baja al saludo, debajo del nombre y el cargo, es
        «Ver la app como otro cargo», que es lo que se pidió mover.
   --------------------------------------------------------------- */

(function estilosV24(){
  if($("estilos-v24")) return;
  const s = document.createElement("style");
  s.id = "estilos-v24";
  s.textContent =
    "#appbar #btn-modo{display:flex !important}" +
    "#btn-modo-saludo{display:none !important}" +
    "#btn-simular-saludo{position:static;margin-top:9px;height:36px;padding:0 14px;width:auto;" +
      "border-radius:var(--r-full);background:var(--lila-f);border:1px solid var(--lila-f);" +
      "color:var(--lila);font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:6px}" +
    "#btn-simular-saludo:active{filter:brightness(.94)}";
  document.head.appendChild(s);
})();

/* El botón de simulación se dibuja dentro del saludo, que se redibuja
   entero en cada pintado; por eso se recrea en vez de moverse. */
function botonSimularEnSaludo(){
  const barra = $("btn-modo");
  if(barra) barra.classList.remove("oculto");
  const viejo = $("btn-modo-saludo");
  if(viejo) viejo.remove();

  const saludo = $("ini-saludo");
  const u = usuarioActual();
  if(!saludo || !u) return;
  const fila = saludo.firstElementChild;
  const datos = fila && fila.lastElementChild;
  if(!datos || datos === fila) return;

  /* Simular cargos es gobierno de la app: no aparece en modo almacén */
  const puede = u.esAdmin && !simulando() && esModoAdmin();
  let b = $("btn-simular-saludo");
  if(!puede){ if(b) b.remove(); return; }
  if(!b || !datos.contains(b)){
    if(b) b.remove();
    b = document.createElement("button");
    b.id = "btn-simular-saludo";
    b.addEventListener("click", ()=> abrirSimulacion());
    datos.appendChild(b);
  }
  b.innerHTML = ico("cambiar", 15) + "Ver la app como otro cargo";
}

/* Ya no hace falta el mosaico: el botón vive junto al nombre */
const tareasDelCargoV24 = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV24();
  const u = usuarioActual();
  return (u && u.esAdmin && !simulando())
    ? T.filter(x => x.t !== "Ver la app como otro cargo")
    : T;
};

const pintarInicioV24 = pintarInicio;
pintarInicio = function(){ pintarInicioV24(); botonSimularEnSaludo(); };

const aplicarRolV24 = aplicarRol;
aplicarRol = function(){ aplicarRolV24(); botonSimularEnSaludo(); };

/* ---------------------------------------------------------------
   V25  El resumen logístico y el consolidado bajan al pie del inicio.
        Arriba quedan el saludo y las tareas, que es lo que se usa a
        diario; la consulta de cifras queda al final, en todos los
        cargos donde aparecen.
   --------------------------------------------------------------- */

function bajarPanelesResumen(){
  const scr = $("scr-inicio");
  if(!scr) return;
  /* appendChild mueve el elemento: no hace falta quitarlo antes */
  ["ini-resumen", "ini-consolidado"].forEach(id => {
    const el = $(id);
    if(el) scr.appendChild(el);
  });
  /* El aviso de modo y el reporte del administrador se anclan al
     resumen, así que al bajarlo se irían con él: vuelven arriba. */
  const saludo = $("ini-saludo");
  if(!saludo) return;
  let ancla = saludo;
  [$("ini-aviso-admin"), $("ad-reporte")].forEach(el => {
    if(!el) return;
    ancla.insertAdjacentElement("afterend", el);
    ancla = el;
  });
}

const pintarInicioV25 = pintarInicio;
pintarInicio = function(){ pintarInicioV25(); bajarPanelesResumen(); };

const aplicarRolV25 = aplicarRol;
aplicarRol = function(){ aplicarRolV25(); bajarPanelesResumen(); };

/* ---------------------------------------------------------------
   V26  El consolidado aprovecha el código y el requerimiento.
        El Excel de obra trae «CÓDIGO» y «N° REQUERIMIENTO»: ambos se
        leen, se muestran en cada material, se pueden buscar y sirven
        para filtrar por requerimiento. Además la lista deja de
        cortarse en 300 y avisa cuántos quedan fuera.
   --------------------------------------------------------------- */

COLS_CONSOLIDADO.push(
  {clave:"codigo", alias:["codigo","cod","clave","sku"]},
  {clave:"requerimiento", alias:["requerimiento","n requerimiento","no requerimiento",
                                 "nro requerimiento","n° requerimiento","nº requerimiento"]}
);

/* El importador original ignora las claves nuevas: se completan después */
const importarConsolidadoV26 = importarConsolidado;
importarConsolidado = function(filas, nombreArchivo){
  const r = importarConsolidadoV26(filas, nombreArchivo);

  let iCab = -1, mapa = {};
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    const prueba = {};
    (filas[i] || []).forEach((celda, c)=>{
      const t = sinTildes(celda);
      COLS_CONSOLIDADO.forEach(col => {
        if(col.alias.indexOf(t) >= 0 && prueba[col.clave] === undefined) prueba[col.clave] = c;
      });
    });
    if(prueba.desc !== undefined){ iCab = i; mapa = prueba; break; }
  }
  if(iCab < 0) return r;

  const dato = (f, k) => mapa[k] === undefined ? "" : String(f[mapa[k]] == null ? "" : f[mapa[k]]).trim();
  const extras = [];
  for(let i = iCab + 1; i < filas.length; i++){
    const f = filas[i] || [];
    if(!dato(f, "desc")) continue;
    extras.push({codigo:dato(f, "codigo"), requerimiento:dato(f, "requerimiento")});
  }
  db.consolidado.items.forEach((it, i) => {
    if(!extras[i]) return;
    it.codigo = extras[i].codigo;
    it.requerimiento = extras[i].requerimiento;
    /* Sin columna de categoría, el código y el requerimiento ocupan su
       lugar. Van dentro de «categoria» a propósito: es el campo que el
       buscador de la pantalla ya recorre, así se busca por código. */
    if(!it.categoria || it.categoria === "General"){
      const partes = [];
      if(extras[i].codigo) partes.push(extras[i].codigo);
      if(extras[i].requerimiento) partes.push("REQ " + extras[i].requerimiento);
      if(partes.length) it.categoria = partes.join(" · ");
    }
  });
  guardar();
  return r;
};

/* Cada material muestra su código, y la lista completa se puede ver */
const pintarConsolidadoV26 = pintarConsolidado;
pintarConsolidado = function(){
  pintarConsolidadoV26();
  const cont = $("co-lista");
  if(!cont || !db.consolidado.items.length) return;

  /* El código ya viaja dentro del texto; aquí solo se resalta.
     Se empareja por id del ítem: hay descripciones repetidas entre
     requerimientos y buscarlas por nombre daría el código equivocado. */
  const porId = {};
  db.consolidado.items.forEach(x => { if(x.codigo) porId[x.id] = x.codigo; });
  $$("#co-lista .fila").forEach(f => {
    const s = f.querySelector(".txt small");
    if(!s || s.dataset.cod) return;
    const cod = porId[f.dataset.cons];
    if(!cod || s.innerHTML.indexOf(cod) !== 0) return;
    s.dataset.cod = "1";
    s.innerHTML = '<b style="color:var(--pri);font-weight:700">' + esc(cod) + "</b>" +
                  s.innerHTML.slice(cod.length);
  });

  let lista = db.consolidado.items;
  if(typeof filtroCons !== "undefined" && filtroCons)
    lista = lista.filter(x => estadoConsolidado(x) === filtroCons);
  const q = sinTildes(($("co-buscar") || {}).value || "");
  if(q) lista = lista.filter(x => sinTildes(x.desc + " " + x.categoria + " " + (x.codigo || "")).indexOf(q) >= 0);

  let nota = $("co-mas");
  if(lista.length > 300){
    if(!nota){
      nota = document.createElement("div");
      nota.id = "co-mas";
      nota.className = "card plano";
      nota.style.cssText = "text-align:center;font-size:12px;color:var(--tinta-sec);padding:11px";
      cont.insertAdjacentElement("afterend", nota);
    }
    nota.innerHTML = "Se muestran los primeros 300 de <b>" + lista.length +
      "</b>. Use el buscador o los filtros para acotar.";
  } else if(nota) nota.remove();
};

/* ---------------------------------------------------------------
   V27  Los botones de tareas pasan a ser una sola pieza: el ícono
        suelto y grande arriba, sin recuadro detrás, y el nombre en
        una línea debajo. El color lo lleva el botón entero.
        Vale para todos los cargos.
   --------------------------------------------------------------- */

/* Nombre corto para que entre en una línea; la explicación queda en
   el encabezado de cada pantalla. Si falta uno, se usa su 1ª palabra. */
const NOMBRE_CORTO = {
  "Recibir materiales":"Recibir", "Recibir y verificar guía":"Recibir",
  "Entregar consumible":"Entregar", "Entregar material al trabajador":"Entregar",
  "Prestar herramienta":"Prestar", "Devoluciones":"Devoluciones",
  "Inventario general":"Inventario", "Consultar inventario":"Inventario",
  "Ver inventario":"Inventario", "Kardex de EPP":"EPP",
  "Atender pedidos":"Atender", "Pedir material a logística":"Pedir",
  "Nuevo requerimiento":"Requerimiento", "Subir un requerimiento":"Requerimiento",
  "Cargar mi pedido desde Excel":"Excel", "Mis pedidos":"Mis pedidos",
  "Mis materiales":"Mis materiales", "Consolidado de obra":"Consolidado",
  "Reporte diario de obra":"Reporte", "Revisar pedidos de los supervisores":"Revisar",
  "Ver avance e indicadores":"Indicadores", "Dashboard e indicadores":"Dashboard",
  "Dar visto bueno a los pedidos":"Visto bueno", "Materiales faltantes":"Faltantes",
  "Seguimiento de compras":"Compras", "Reportes":"Reportes",
  "Comprar lo aprobado":"Comprar", "Subir la guía de remisión":"Subir guía",
  "Orden de compra":"Orden", "Pedidos por atender":"Por atender",
  "Proveedores y cotizaciones":"Proveedores", "Despachar a obra":"Despachar",
  "Solicitudes de acceso":"Solicitudes", "Usuarios y cargos":"Usuarios",
  "Actividad y auditoría":"Actividad", "Personas involucradas":"Personas",
  "Reporte de la app":"Reporte", "Respaldo de datos":"Respaldo",
  "Ver la app como otro cargo":"Otro cargo", "Salir de la simulación":"Salir"
};
function nombreCorto(t){ return NOMBRE_CORTO[t] || String(t || "").split(" ")[0]; }

(function estilosV27(){
  if($("estilos-v27")) return;
  const s = document.createElement("style");
  s.id = "estilos-v27";
  s.textContent =
    ".tareas.rejilla{gap:10px}" +
    ".tareas.rejilla .tarea{flex-direction:column;align-items:center;justify-content:flex-start;" +
      "text-align:center;padding:16px 8px 13px;gap:0;border-radius:18px;position:relative}" +
    /* el ícono deja su cajita: queda suelto y al doble de tamaño */
    ".tareas.rejilla .tarea .n{width:auto;height:auto;border-radius:0;background:transparent;" +
      "color:var(--pri);margin:0 0 9px}" +
    ".tareas.rejilla .tarea .n svg{width:32px;height:32px}" +
    ".tareas.rejilla .tarea .t{flex:none;width:100%;min-width:0}" +
    ".tareas.rejilla .tarea .t b{font-size:12.5px;line-height:1.25;white-space:nowrap;" +
      "overflow:hidden;text-overflow:ellipsis;display:block}" +
    ".tareas.rejilla .tarea .t small{display:none}" +
    ".tareas.rejilla .tarea .p{display:none}" +
    ".tareas.rejilla .tarea .glob{position:absolute;top:9px;right:9px;font-size:10px;padding:2px 7px}" +
    /* el color pasa al botón completo, no a un cuadrito interno */
    ".tareas.rejilla .tarea.destacada{background:var(--sec)}" +
    ".tareas.rejilla .tarea.destacada .n{background:transparent;color:#fff}" +
    ".tareas.rejilla .tarea.destacada .t b{color:#fff}" +
    ".tareas.rejilla .tarea.destacada .glob{background:#fff;color:var(--mal)}" +
    ".tareas.rejilla .tarea.gob .n{background:transparent;color:var(--lila)}" +
    /* la fila entera conserva el mismo formato centrado */
    ".tareas.rejilla .tarea.ancha{flex-direction:column;align-items:center;gap:0;padding:16px 8px 13px}" +
    ".tareas.rejilla .tarea.ancha .n{margin:0 0 9px}" +
    ".tareas.rejilla .tarea.ancha .t b{font-size:13px}" +
    ".tareas.rejilla .tarea.ancha .p{display:none}";
  document.head.appendChild(s);
})();

const pintarTareasV27 = pintarTareas;
pintarTareas = function(){
  pintarTareasV27();
  const cont = $("ini-accesos");
  if(!cont) return;
  $$("#ini-accesos .tarea").forEach(t => {
    const b = t.querySelector(".t b");
    if(!b || b.dataset.corto) return;
    b.title = b.textContent;          /* el nombre completo, al mantener pulsado */
    b.textContent = nombreCorto(b.textContent);
    b.dataset.corto = "1";
  });
  /* con todos los botones iguales, solo se estira el último si sobra */
  const tiles = $$("#ini-accesos .tarea");
  tiles.forEach(t => t.classList.remove("ancha"));
  if(tiles.length % 2 === 1) tiles[tiles.length - 1].classList.add("ancha");
};

/* ---------------------------------------------------------------
   V28  El consolidado se mueve solo.
        Recibir una guía suma a «comprado»; entregar el material al
        frente suma a «entregado». El emparejamiento va primero por
        código y, si no lo hay, por nombre. Lo que no encuentra pareja
        se avisa para asignarlo a mano, en vez de perderse en silencio.
   --------------------------------------------------------------- */

function claveCons(t){
  return sinTildes(String(t || "")).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/* Busca la línea del consolidado que corresponde a un material */
function lineaConsolidado(nombre, codigo){
  const items = db.consolidado.items || [];
  if(codigo){
    const porCod = items.find(x => x.codigo && claveCons(x.codigo) === claveCons(codigo));
    if(porCod) return porCod;
  }
  const k = claveCons(nombre);
  if(!k) return null;
  const exacta = items.find(x => claveCons(x.desc) === k);
  if(exacta) return exacta;
  /* Sin coincidencia exacta se acepta que uno contenga al otro
     ("Cinta de embalaje transparente" con "Cinta de embalaje"), pero
     solo si hay un único candidato: con dos o más sería una lotería,
     y prefiere avisar a asignarlo mal en silencio. */
  const parecidos = items.filter(x => {
    const d = claveCons(x.desc);
    return d && (d.indexOf(k) >= 0 || k.indexOf(d) >= 0);
  });
  return parecidos.length === 1 ? parecidos[0] : null;
}

/* campo: "comprado" al recibir · "entregado" al entregar al frente */
function sumarAlConsolidado(lineas, campo){
  const res = {tocadas: 0, sinPareja: []};
  if(!db.consolidado.items || !db.consolidado.items.length) return res;

  lineas.forEach(l => {
    const cant = num(l.cantidad) || 0;
    if(cant <= 0) return;
    const it = lineaConsolidado(l.nombre, l.codigo);
    if(!it){ res.sinPareja.push(l.nombre); return; }
    const tope = num(it.requerido) || 0;
    const antes = num(it[campo]) || 0;
    /* nunca por encima de lo requerido: el avance no puede pasar de 100% */
    it[campo] = tope > 0 ? Math.min(tope, +(antes + cant).toFixed(2)) : +(antes + cant).toFixed(2);
    /* lo entregado no puede superar a lo comprado */
    if(campo === "entregado" && (num(it.comprado) || 0) < it[campo]) it.comprado = it[campo];
    if(it[campo] !== antes) res.tocadas++;
  });
  return res;
}

function avisarConsolidado(res, verbo){
  if(!res.tocadas && !res.sinPareja.length) return;
  if(res.tocadas)
    log("consolidado", "Consolidado actualizado",
        res.tocadas + " material(es) " + verbo + (res.sinPareja.length ? " · " + res.sinPareja.length + " sin pareja" : ""));
  if(res.sinPareja.length){
    const lista = res.sinPareja.slice(0, 6).join(", ") + (res.sinPareja.length > 6 ? "…" : "");
    notificar({roles:["obra","almacenero","admin"],
      titulo:"Materiales sin pareja en el consolidado",
      cuerpo:"No se encontraron en el consolidado y hay que asignarlos a mano:\n" + lista});
    setTimeout(()=> snack(res.sinPareja.length + " material(es) no están en el consolidado. Revise el aviso.", "err"), 900);
  }else if(res.tocadas){
    setTimeout(()=> snack("Consolidado actualizado: " + res.tocadas + " material(es).", "ok"), 900);
  }
}

/* --- Al recibir con guía, lo contado pasa a «comprado» --- */
const registrarRecepcionContadaV28 = registrarRecepcionContada;
registrarRecepcionContada = function(){
  const copia = recibidos.map(r => ({nombre:r.nombre, cantidad:r.cantidad, codigo:r.codigo || ""}));
  const g = recepConteo;
  if(g) copia.forEach(c => {
    const l = (g.lineas || []).find(x => claveCons(x.desc) === claveCons(c.nombre));
    if(l && l.codigo) c.codigo = l.codigo;
  });
  const r = registrarRecepcionContadaV28.apply(this, arguments);
  if(copia.length) avisarConsolidado(sumarAlConsolidado(copia, "comprado"), "recibidos");
  guardar();
  return r;
};

/* --- Al entregar al frente, lo del vale pasa a «entregado» --- */
const registrarEntregaV28 = registrarEntrega;
registrarEntrega = function(){
  const copia = entregaItems.map(x => ({nombre:x.nombre, cantidad:x.cantidad}));
  const r = registrarEntregaV28.apply(this, arguments);
  if(copia.length) avisarConsolidado(sumarAlConsolidado(copia, "entregado"), "entregados");
  guardar();
  return r;
};

/* ---------------------------------------------------------------
   V29  El formato de requisito de la obra, tal cual.
        1) La tabla termina donde termina: el bloque de firmas del pie
           ya no entra como material.
        2) Obra, área, N° de requerimiento y fecha de entrega se leen
           de la cabecera del formato en vez de escribirse otra vez.
        3) La plantilla que descarga el supervisor es ese mismo
           formato, para que todos usen el de la empresa.
   --------------------------------------------------------------- */

/* Tras varias filas seguidas sin descripción, lo que sigue es pie de
   página (firmas, notas) y no materiales. */
function recortarTablaPedido(filas, colDesc, desde){
  let vacias = 0;
  for(let i = desde; i < filas.length; i++){
    const d = String((filas[i] || [])[colDesc] || "").trim();
    if(d){ vacias = 0; continue; }
    if(++vacias >= 5) return filas.slice(0, i - 4);
  }
  return filas;
}

function cabeceraFormato(filas){
  const out = {};
  const norm = v => sinTildes(String(v == null ? "" : v)).replace(/\s+/g, " ").trim();
  for(let i = 0; i < Math.min(filas.length, 11); i++){
    const f = filas[i] || [];
    for(let c = 0; c < f.length; c++){
      const t = norm(f[c]).replace(/[:°º]/g, "").trim();
      if(!t) continue;
      /* el valor está en la primera celda con contenido a la derecha */
      let v = "";
      for(let k = c + 1; k < f.length; k++){
        if(String(f[k] == null ? "" : f[k]).trim()){ v = String(f[k]).trim(); break; }
      }
      if(!v) continue;
      if(t === "obra" && !out.obra) out.obra = v;
      else if((t === "area" || t === "area disciplina") && !out.area) out.area = v;
      else if(t === "n" && !out.numero && /^\d+$/.test(v)) out.numero = v;
      else if(t.indexOf("fecha de entrega") === 0 && !out.entrega) out.entrega = v;
      else if(t === "supervisor" && !out.supervisor) out.supervisor = v;
    }
  }
  return out;
}

const importarPedidoV29 = importarPedido;
importarPedido = function(filas){
  /* se ubica la cabecera para saber en qué columna va la descripción */
  let iCab = -1, colDesc = -1;
  for(let i = 0; i < Math.min(filas.length, 15); i++){
    (filas[i] || []).forEach((celda, c)=>{
      const t = sinTildes(celda);
      if(iCab < 0 && COLS_PEDIDO[0].alias.indexOf(t) >= 0){ iCab = i; colDesc = c; }
    });
    if(iCab >= 0) break;
  }
  const cab = cabeceraFormato(filas);
  const usar = (iCab >= 0 && colDesc >= 0) ? recortarTablaPedido(filas, colDesc, iCab + 1) : filas;
  const r = importarPedidoV29(usar);

  /* la cabecera del formato completa lo que el usuario no escribió */
  if(cab.obra && $("mr-obra") && !$("mr-obra").value) $("mr-obra").value = cab.obra;
  if(cab.area && $("mr-area") && !$("mr-area").value) $("mr-area").value = cab.area;
  if(cab.entrega && $("mr-necesario") && !$("mr-necesario").value){
    const f = fechaExcel(cab.entrega) || (String(cab.entrega).slice(0,10).match(/^\d{4}-\d{2}-\d{2}$/) ? String(cab.entrega).slice(0,10) : "");
    if(f) $("mr-necesario").value = f;
  }
  if(cab.numero) window.__numeroFormato = cab.numero;
  return r;
};

/* La plantilla pasa a ser el formato de la empresa */
plantillaRequerimiento = function(){
  const u = usuarioActual();
  const filas = [
    ["REQUERIMIENTO DE MATERIALES", "", "", "", ""],
    [], [], [],
    ["Obra:", db.config.obra || "", "", "N°", ""],
    [],
    ["ÁREA :", u.area || "", "", "FECHA DE SOLICITUD:", hoyISO()],
    ["SUPERVISOR :", u.nombre, "", "FECHA DE ENTREGA:", ""],
    [],
    ["N°", "DESCRIPCIÓN", "UND", "CANTIDAD", "OBSERVACIONES"],
    [1, "Perno hexagonal 5/8 x 3", "und", 24, "Acero galvanizado"],
    [2, "Cable NYY 3x10", "m", 120, ""],
    [3, "", "", "", ""]
  ];
  descargarBlob("plantilla_requerimiento.xlsx",
    crearXLSX([{nombre:"Requerimiento", filas, estilos:[10]}]));
  snack("Plantilla con el formato de la obra descargada.", "ok");
};

/* ---------------------------------------------------------------
   V30  Al entregar se elige la unidad de una lista.
        Se propone la del almacén; si se cambia por otra, se avisa
        que el descuento de stock se hará igual en la unidad del
        almacén, para que nadie descuadre el inventario sin saberlo.
        Se suma «millar», que faltaba y aparece en el consolidado.
   --------------------------------------------------------------- */

(function unidadesV30(){
  const conteo = UNIDADES.find(g => g.grupo === "Conteo");
  if(conteo && !conteo.items.some(i => i[0] === "mll")) conteo.items.push(["mll","Millar"]);
  ALIAS_UNIDAD.millar = "mll"; ALIAS_UNIDAD.millares = "mll"; ALIAS_UNIDAD.mil = "mll";
})();

(function estilosV30(){
  if($("estilos-v30")) return;
  const s = document.createElement("style");
  s.id = "estilos-v30";
  s.textContent =
    "#sa-aviso-unidad{margin:-4px 0 12px}" +
    ".fila .chip.uni{margin-left:6px}";
  document.head.appendChild(s);
})();

/* El formulario de salida estrena su campo de unidad */
(function campoUnidadV30(){
  const cant = $("sa-cantidad");
  if(!cant || $("sa-unidad")) return;
  const fila = cant.closest(".dos") || cant.parentElement.parentElement;
  const campo = document.createElement("div");
  campo.className = "campo";
  campo.innerHTML = '<label>Unidad</label><select id="sa-unidad-sel"></select>' +
                    '<input type="text" id="sa-unidad" class="oculto" placeholder="Escriba la unidad">';
  fila.appendChild(campo);

  const aviso = document.createElement("div");
  aviso.id = "sa-aviso-unidad";
  fila.insertAdjacentElement("afterend", aviso);

  selectorUnidad("sa-unidad");
  /* el campo oculto se sincroniza aquí: el selector solo engancha su
     propio listener cuando crea el <select>, y este ya venía hecho */
  $("sa-unidad-sel").addEventListener("change", ()=>{
    const sel = $("sa-unidad-sel"), campo = $("sa-unidad");
    const otra = sel.value === "__otra";
    campo.classList.toggle("oculto", !otra);
    if(otra){ campo.value = ""; campo.focus(); } else campo.value = sel.value;
    avisarUnidadEntrega();
  });
  $("sa-unidad").addEventListener("input", avisarUnidadEntrega);
  $("sa-material").addEventListener("change", ()=>{
    const m = db.materiales.find(x => x.id === $("sa-material").value);
    selectorUnidad("sa-unidad", m ? m.unidad : "");
    avisarUnidadEntrega();
  });
})();

function avisarUnidadEntrega(){
  const cont = $("sa-aviso-unidad");
  if(!cont) return;
  const m = db.materiales.find(x => x.id === $("sa-material").value);
  const u = normalizarUnidad(($("sa-unidad") || {}).value || "");
  if(!m || !u || normalizarUnidad(m.unidad) === u){ cont.innerHTML = ""; return; }
  cont.innerHTML = '<div class="card aviso" style="font-size:11.5px;padding:11px;margin:0">' +
    "<b>El almacén lleva este material en " + esc(m.unidad) + ".</b> Si entrega en " + esc(u) +
    ", el stock se descontará igual en " + esc(m.unidad) + " y quedará descuadrado.</div>";
}

/* La unidad elegida viaja con el artículo del vale */
const agregarAEntregaV30 = agregarAEntrega;
agregarAEntrega = function(){
  const antes = entregaItems.length;
  agregarAEntregaV30.apply(this, arguments);
  if(entregaItems.length === antes) return;          /* no se agregó: hubo error */
  const it = entregaItems[entregaItems.length - 1];
  const u = normalizarUnidad(($("sa-unidad") || {}).value || "");
  const m = db.materiales.find(x => x.id === it.itemId);
  if(u && m && normalizarUnidad(m.unidad) !== u){
    it.unidad = u;
    it.unidadAlmacen = m.unidad;                     /* para dejarlo dicho en el kardex */
  }
  const sel = $("sa-unidad-sel");
  if(sel){ selectorUnidad("sa-unidad", m ? m.unidad : ""); }
  if($("sa-aviso-unidad")) $("sa-aviso-unidad").innerHTML = "";
  /* la lista se dibujó antes de marcar la unidad: hay que repintarla */
  pintarEntrega();
};

/* En la lista del vale se marca lo que va en otra unidad */
const pintarEntregaV30 = pintarEntrega;
pintarEntrega = function(){
  pintarEntregaV30();
  $$("#sa-lista .fila").forEach((f, i) => {
    const x = entregaItems[i];
    if(!x || !x.unidadAlmacen) return;
    const s = f.querySelector(".txt small");
    if(s) s.innerHTML = x.cantidad + " " + esc(x.unidad) +
      ' <span class="chip alerta uni">el almacén lo lleva en ' + esc(x.unidadAlmacen) + "</span>";
  });
};

/* Y queda anotado en el movimiento, para no perder el rastro */
const registrarEntregaV30 = registrarEntrega;
registrarEntrega = function(){
  const distintas = entregaItems.filter(x => x.unidadAlmacen)
    .map(x => x.nombre + ": " + x.cantidad + " " + x.unidad + " (almacén en " + x.unidadAlmacen + ")");
  const r = registrarEntregaV30.apply(this, arguments);
  if(distintas.length){
    log("movimientos", "Entrega en otra unidad", distintas.join(" · "));
    guardar();
  }
  return r;
};

/* Los botones de la entrega se reenganchan resolviendo la función en
   el momento del clic. Estaban atados a la versión original, así que
   los envoltorios posteriores (unidad, consolidado) no llegaban a
   ejecutarse al pulsarlos, solo al llamarlos por código. */
(function reengancharEntregaV30(){
  [["sa-agregar", ()=> agregarAEntrega()],
   ["sa-registrar", ()=> registrarEntrega()]].forEach(([id, fn]) => {
    const b = $(id);
    if(!b) return;
    const n = b.cloneNode(true);
    b.parentNode.replaceChild(n, b);
    n.addEventListener("click", fn);
  });
})();

/* ---------------------------------------------------------------
   V30  Los nombres se resuelven al entrar, no después.
        Al subir el Excel, cada línea se compara contra el catálogo
        (consolidado + inventario): lo seguro pasa, lo dudoso se
        pregunta y lo desconocido se elige o se declara nuevo. Cada
        confirmación queda guardada, así que la próxima vez entra
        sola — y ese mismo diccionario sirve para las guías.
   --------------------------------------------------------------- */

function alias(){ db.alias = db.alias || {}; return db.alias; }
function claveAlias(t){
  return sinTildes(String(t || "")).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function catalogo(){
  const out = [], visto = {};
  (db.consolidado.items || []).forEach(it => {
    const k = claveAlias(it.desc);
    if(!k || visto[k]) return;
    visto[k] = true;
    out.push({desc:it.desc, codigo:it.codigo || "", unidad:it.unidad || "und", origen:"consolidado"});
  });
  (db.materiales || []).forEach(m => {
    const k = claveAlias(m.nombre);
    if(!k || visto[k]) return;
    visto[k] = true;
    out.push({desc:m.nombre, codigo:m.codigo || "", unidad:m.unidad || "und", origen:"inventario"});
  });
  return out;
}

/* Palabras raras pesan más: "vulcanizante" distingue, "de" no */
function pesos(cat){
  const df = {};
  cat.forEach(c => new Set(claveAlias(c.desc).split(" ")).forEach(w => { df[w] = (df[w] || 0) + 1; }));
  const N = Math.max(1, cat.length);
  return w => Math.log((N + 1) / ((df[w] || 0) + 1)) + 1;
}

/* Comparación por tríos de letras: rescata las erratas, donde no hay
   ninguna palabra en común ("emgrapador" contra "Engrapador"). */
function trios(t){
  const s = " " + claveAlias(t) + " ";
  const out = new Set();
  for(let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}
function parecidoLetras(a, b){
  const A = trios(a), B = trios(b);
  if(!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(t => { if(B.has(t)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

function parecido(a, b, peso){
  const A = new Set(claveAlias(a).split(" ").filter(w => w.length > 2));
  const B = new Set(claveAlias(b).split(" ").filter(w => w.length > 2));
  if(!A.size || !B.size) return 0;
  let inter = 0, sa = 0, sb = 0;
  A.forEach(w => { sa += peso(w); if(B.has(w)) inter += peso(w); });
  B.forEach(w => { sb += peso(w); });
  const porPalabras = sa + sb ? (2 * inter) / (sa + sb) : 0;
  if(porPalabras > 0) return porPalabras;
  /* sin palabras en común, se mira la escritura, con castigo:
     una errata puede sugerirse, pero nunca darse por segura */
  return parecidoLetras(a, b) * 0.85;
}

/* estado: "exacto" · "probable" · "nuevo" */
function sugerir(nombre, cat, peso){
  const k = claveAlias(nombre);
  const guardado = alias()[k];
  if(guardado){
    const it = cat.find(c => claveAlias(c.desc) === claveAlias(guardado.desc));
    if(it) return {estado:"exacto", item:it, p:1, porAlias:true};
  }
  const exacto = cat.find(c => claveAlias(c.desc) === k);
  if(exacto) return {estado:"exacto", item:exacto, p:1};
  const orden = cat.map(c => ({c, p:parecido(nombre, c.desc, peso)}))
                   .sort((x,y) => y.p - x.p).slice(0, 6);
  const mejor = orden[0];
  if(mejor && mejor.p >= 0.72 && (orden.length < 2 || mejor.p - orden[1].p >= 0.08))
    return {estado:"exacto", item:mejor.c, p:mejor.p};
  if(mejor && mejor.p >= 0.40)
    return {estado:"probable", item:mejor.c, p:mejor.p, opciones:orden.filter(o => o.p >= 0.25).map(o => o.c)};
  return {estado:"nuevo", item:null, p:0, opciones:orden.filter(o => o.p >= 0.2).map(o => o.c)};
}

(function estilosRevision(){
  if($("estilos-revision")) return;
  const s = document.createElement("style");
  s.id = "estilos-revision";
  s.textContent =
    "#mr-revision{margin-bottom:12px}" +
    "#mr-revision .cab{display:flex;gap:7px;margin-bottom:10px}" +
    "#mr-revision .cab span{flex:1;border-radius:10px;padding:8px;text-align:center;font-size:10.5px;font-weight:600}" +
    "#mr-revision .ok{background:var(--ok-f);color:var(--ok)}" +
    "#mr-revision .duda{background:var(--alerta-f);color:var(--alerta)}" +
    "#mr-revision .no{background:var(--mal-f);color:var(--mal)}" +
    "#mr-revision .linea-rev{background:var(--sup);border-radius:var(--r-m);padding:11px;margin-bottom:8px;box-shadow:var(--s1)}" +
    "#mr-revision .linea-rev.duda{border-left:3px solid var(--sec);border-radius:0 var(--r-m) var(--r-m) 0}" +
    "#mr-revision .linea-rev.no{border-left:3px solid var(--mal);border-radius:0 var(--r-m) var(--r-m) 0}" +
    "#mr-revision .escrito{font-size:12.5px;font-weight:600;display:block;margin-bottom:2px}" +
    "#mr-revision .pista{font-size:10.5px;color:var(--tinta-sec);display:block;margin-bottom:7px}" +
    "#mr-revision select{font-size:13px;padding:9px}";
  document.head.appendChild(s);
})();

let revision = [];

function pintarRevision(){
  let cont = $("mr-revision");
  const items = $("mr-items");
  if(!items) return;
  if(!cont){
    cont = document.createElement("div");
    cont.id = "mr-revision";
    items.insertAdjacentElement("beforebegin", cont);
  }
  const dudas = revision.filter(r => r.estado !== "exacto");
  if(!revision.length){ cont.innerHTML = ""; return; }

  const ok = revision.length - dudas.length;
  const nDuda = revision.filter(r => r.estado === "probable").length;
  const nNo = revision.filter(r => r.estado === "nuevo").length;

  cont.innerHTML =
    '<div class="sech" style="margin:0 0 8px">Revisión de nombres</div>' +
    '<div class="cab"><span class="ok">' + ok + " reconocidos</span>" +
    '<span class="duda">' + nDuda + " por confirmar</span>" +
    '<span class="no">' + nNo + " sin catalogar</span></div>" +
    (dudas.length
      ? dudas.map(r =>
        '<div class="linea-rev ' + (r.estado === "probable" ? "duda" : "no") + '">' +
        '<b class="escrito">' + esc(r.escrito) + "</b>" +
        '<small class="pista">' + (r.estado === "probable"
            ? "Se parece a un material del catálogo. Confirme cuál es."
            : "No está en el catálogo. Elíjalo o déjelo como material nuevo.") + "</small>" +
        '<select data-rev="' + r.i + '">' +
          (r.opciones || []).map(o =>
            '<option value="' + esc(o.desc) + '"' +
            (r.item && o.desc === r.item.desc ? " selected" : "") + ">" +
            (o.codigo ? o.codigo + " · " : "") + esc(o.desc) + "</option>").join("") +
          '<option value="__nuevo"' + (r.estado === "nuevo" ? " selected" : "") +
            ">Es un material nuevo (" + esc(r.escrito) + ")</option>" +
        "</select></div>").join("") +
        '<button class="btn btn-ton" id="mr-confirmar" style="margin-top:4px">Confirmar nombres</button>'
      : '<div class="card" style="background:var(--ok-f);color:var(--ok);font-size:11.5px;padding:11px;margin:0">' +
        "<b>Todos los nombres coinciden con el catálogo.</b></div>");

  $$("#mr-revision [data-rev]").forEach(sel => sel.addEventListener("change", ()=>{
    const r = revision.find(x => x.i === +sel.dataset.rev);
    if(!r) return;
    r.eleccion = sel.value;
  }));
  if($("mr-confirmar")) $("mr-confirmar").addEventListener("click", confirmarNombres);
}

function confirmarNombres(){
  const cat = catalogo();
  revision.forEach(r => {
    if(r.estado === "exacto") return;
    const elegido = r.eleccion || (r.item ? r.item.desc : "__nuevo");
    if(elegido === "__nuevo"){
      r.estado = "nuevo"; r.item = null;
      return;
    }
    const it = cat.find(c => c.desc === elegido);
    if(!it) return;
    r.item = it; r.estado = "exacto";
    /* la corrección se guarda: la próxima vez entra sola */
    alias()[claveAlias(r.escrito)] = {desc:it.desc, codigo:it.codigo || ""};
    const item = itemsReq[r.i];
    if(item){
      item.desc = it.desc;
      item.codigo = it.codigo || "";
      if(!item.unidad || item.unidad === "und") item.unidad = it.unidad || item.unidad;
    }
  });
  guardar();
  pintarItemsReq();
  pintarRevision();
  snack("Nombres confirmados. La app los recordará.", "ok");
}

const importarPedidoV30 = importarPedido;
importarPedido = function(filas){
  const r = importarPedidoV30(filas);
  const cat = catalogo();
  const peso = pesos(cat);
  revision = itemsReq.map((it, i) => {
    const s = sugerir(it.desc, cat, peso);
    /* lo que el diccionario ya sabe se aplica sin preguntar */
    if(s.estado === "exacto" && s.item){
      it.desc = s.item.desc;
      it.codigo = s.item.codigo || "";
      if(!it.unidad || it.unidad === "und") it.unidad = s.item.unidad || it.unidad;
    }
    return {i, escrito:it.desc, estado:s.estado, item:s.item, opciones:s.opciones || (s.item ? [s.item] : [])};
  });
  pintarItemsReq();
  pintarRevision();
  return r;
};

const limpiarRequerimientoV30 = limpiarRequerimiento;
limpiarRequerimiento = function(){
  limpiarRequerimientoV30.apply(this, arguments);
  revision = [];
  const c = $("mr-revision");
  if(c) c.innerHTML = "";
};

/* El diccionario también resuelve las guías de logística */
const lineaConsolidadoV30 = lineaConsolidado;
lineaConsolidado = function(nombre, codigo){
  const g = alias()[claveAlias(nombre)];
  if(g){
    const items = db.consolidado.items || [];
    const porCod = g.codigo && items.find(x => x.codigo === g.codigo);
    if(porCod) return porCod;
    const porDesc = items.find(x => claveAlias(x.desc) === claveAlias(g.desc));
    if(porDesc) return porDesc;
  }
  return lineaConsolidadoV30(nombre, codigo);
};

/* ---------------------------------------------------------------
   V31  Logística elige del consolidado en vez de escribir.
        El diccionario de alias ya resuelve los nombres que llegan
        escritos de otra forma; esto ataca el origen: si nadie
        teclea el nombre, no hay nada que resolver. El código y la
        descripción del consolidado viajan dentro de la guía.
   --------------------------------------------------------------- */

let despachoElegidas = [];

(function elegirDelConsolidadoV31(){
  const enviar = $("dp-enviar");
  if(!enviar || $("dp-elegir")) return;
  const caja = document.createElement("div");
  caja.className = "card";
  caja.id = "dp-elegir";
  caja.innerHTML =
    '<div class="sech" style="margin:0 0 8px">Materiales del consolidado</div>' +
    '<p class="ayuda" style="margin:0 0 10px">Elija de la lista: el nombre y el código viajan en la guía, ' +
    'y el almacén los reconoce sin ambigüedad.</p>' +
    '<div class="campo"><input type="search" id="dp-buscar" placeholder="Buscar material o código"></div>' +
    '<div id="dp-resultados"></div>' +
    '<div class="sech" id="dp-sech" style="margin:14px 0 8px">En esta guía</div>' +
    '<div id="dp-lineas"></div>';
  const tarjeta = enviar.closest(".card");
  if(tarjeta) tarjeta.insertAdjacentElement("beforebegin", caja);
  $("dp-buscar").addEventListener("input", pintarBuscadorDespacho);
})();

function faltaPorComprar(x){
  return Math.max(0, +((num(x.requerido) || 0) - (num(x.comprado) || 0)).toFixed(2));
}

function pintarBuscadorDespacho(){
  const cont = $("dp-resultados");
  if(!cont) return;
  const q = sinTildes(($("dp-buscar") || {}).value || "");
  if(!q){ cont.innerHTML = ""; return; }
  const lista = (db.consolidado.items || [])
    .filter(x => sinTildes(x.desc + " " + (x.codigo || "")).indexOf(q) >= 0)
    .filter(x => !despachoElegidas.some(e => e.id === x.id))
    .slice(0, 12);
  cont.innerHTML = lista.length
    ? lista.map(x =>
        '<button class="fila" data-dp="' + x.id + '"><span class="txt"><b>' + esc(x.desc) + "</b>" +
        '<small>' + esc(x.codigo || "") + " · falta por comprar " + faltaPorComprar(x) + " " +
        esc(x.unidad) + "</small></span><span class=\"der\">" + ico("mas", 18) + "</span></button>").join("")
    : '<div class="ayuda" style="margin:0">Sin coincidencias en el consolidado.</div>';

  $$("#dp-resultados [data-dp]").forEach(b => b.addEventListener("click", ()=>{
    const x = (db.consolidado.items || []).find(z => z.id === b.dataset.dp);
    if(!x) return;
    const falta = faltaPorComprar(x);
    despachoElegidas.push({id:x.id, desc:x.desc, unidad:x.unidad, codigo:x.codigo || "",
                           cant:falta > 0 ? falta : (num(x.requerido) || 1)});
    $("dp-buscar").value = "";
    pintarBuscadorDespacho();
    pintarLineasDespacho();
  }));
}

function pintarLineasDespacho(){
  const cont = $("dp-lineas");
  if(!cont) return;
  $("dp-sech").textContent = despachoElegidas.length
    ? "En esta guía · " + despachoElegidas.length : "En esta guía";
  cont.innerHTML = despachoElegidas.length
    ? despachoElegidas.map((l,i) =>
      '<div class="fila"><span class="txt"><b>' + esc(l.desc) + "</b><small>" + esc(l.codigo) + "</small></span>" +
      '<span class="der" style="flex-direction:row;align-items:center;gap:7px">' +
      '<input type="number" min="0" step="0.01" value="' + l.cant + '" data-cant="' + i +
      '" style="width:74px;text-align:center;padding:7px"><small>' + esc(l.unidad) + "</small>" +
      '<button class="quitar" data-quitar-dp="' + i + '">Quitar</button></span></div>').join("")
    : '<div class="vacio" style="padding:18px">Busque y elija los materiales que salen a obra.</div>';

  $$("#dp-lineas [data-cant]").forEach(inp => inp.addEventListener("change", ()=>{
    despachoElegidas[+inp.dataset.cant].cant = Math.max(0, num(inp.value));
  }));
  $$("#dp-lineas [data-quitar-dp]").forEach(b => b.addEventListener("click", ()=>{
    despachoElegidas.splice(+b.dataset.quitarDp, 1);
    pintarLineasDespacho();
    pintarBuscadorDespacho();
  }));
}

/* Lo elegido manda; el Excel sigue disponible para lo que venga suelto */
(function enviarDespachoV31(){
  const viejo = $("dp-enviar");
  if(!viejo) return;
  const b = viejo.cloneNode(true);
  viejo.parentNode.replaceChild(b, viejo);
  b.addEventListener("click", ()=>{
    const numero = $("dp-numero").value.trim();
    if(!numero) return snack("Indique el número de guía.", "err");
    const deLista = despachoElegidas.filter(l => l.cant > 0)
      .map(l => ({desc:l.desc, unidad:l.unidad || "und", cant:l.cant, codigo:l.codigo || ""}));
    const deExcel = (despachoLineas || [])
      .map(l => ({desc:l.desc, unidad:l.unidad || "und", cant:num(l.cant) || 0, codigo:""}));
    const lineas = deLista.concat(deExcel);
    if(!lineas.length)
      return snack("Elija materiales del consolidado o adjunte el detalle en Excel.", "err");

    const d = {id:uid(), fecha:ahora(), numero,
      transportista:$("dp-transporte").value.trim(), reqs:$("dp-reqs").value.trim(),
      pdf:adjuntos["dp-pdf"] || null, lineas, estado:"en_camino",
      enviadoPor:usuarioActual().nombre, recepcion:null};
    despachos().unshift(d);
    log("compras", "Despacho enviado a obra", numero + " · " + lineas.length + " línea(s)", d.id);
    auditar("compras", "Despacho a obra", {comentario:numero + " · " + lineas.length + " línea(s)"});
    notificar({roles:["almacenero","admin","obra"], titulo:"Despacho en camino: " + numero,
      cuerpo:lineas.length + " material(es) · " + (d.transportista || "transportista por confirmar") +
             (d.reqs ? "\nAtiende: " + d.reqs : ""), refTipo:"despacho", refId:d.id});
    if(!guardar()) return;
    snack("Despacho registrado. El almacén ya fue avisado.", "ok");
    despachoElegidas = []; despachoLineas = null;
    ["dp-numero","dp-transporte","dp-reqs"].forEach(i => { if($(i)) $(i).value = ""; });
    if($("dp-info")) $("dp-info").innerHTML = "";
    if($("dp-buscar")) $("dp-buscar").value = "";
    limpiarArchivo("dp-pdf");
    pintarBuscadorDespacho(); pintarLineasDespacho(); pintarDespachos();
  });
})();

const refrescarV31 = refrescar;
refrescar = function(destino){
  refrescarV31(destino);
  if(destino === "despacho"){ pintarBuscadorDespacho(); pintarLineasDespacho(); }
};

/* ---------------------------------------------------------------
   V32  La guía de remisión electrónica entra sola.
        El almacenero sube el PDF tal como se lo mandan y la app saca
        el número, la fecha y los materiales con sus cantidades. Ya no
        hace falta que nadie los teclee ni suba un Excel aparte.
        Si el PDF no se deja leer, queda el conteo a mano de siempre.
   --------------------------------------------------------------- */

/* Los flujos del PDF vienen comprimidos con zlib: el navegador ya
   sabe descomprimirlos, igual que hace con los .xlsx */
async function inflarPDF(bytes){
  /* El PDF deja un salto de línea antes de «endstream» y el
     descompresor del navegador lo rechaza: se prueba recortándolo. */
  const recortes = [0, 1, 2];
  for(const modo of ["deflate", "deflate-raw"]){
    for(const q of recortes){
      const trozo = q ? bytes.slice(0, bytes.length - q) : bytes;
      if(!trozo.length) continue;
      try{
        const flujo = new Blob([trozo]).stream().pipeThrough(new DecompressionStream(modo));
        const salida = new Uint8Array(await new Response(flujo).arrayBuffer());
        if(salida.length) return salida;
      }catch(e){}
    }
  }
  return bytes;
}

function textoDePDF(bin){
  /* solo interesan los trozos entre paréntesis, que es donde el PDF
     guarda el texto que se dibuja */
  const partes = [];
  const re = /\((?:[^()\\]|\\.)*\)/g;
  let m;
  while((m = re.exec(bin)) !== null){
    let t = m[0].slice(1, -1)
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    if(/[\x20-\x7E\xC0-\xFF]/.test(t)) partes.push(t);
  }
  return partes.join(" ");
}

async function leerPDFTexto(archivo){
  const datos = new Uint8Array(await archivo.arrayBuffer());
  let bin = "";
  for(let i = 0; i < datos.length; i++) bin += String.fromCharCode(datos[i]);
  const salida = [];
  const re = /stream\r?\n?([\s\S]*?)endstream/g;
  let m;
  while((m = re.exec(bin)) !== null){
    const crudo = m[1];
    const bytes = new Uint8Array(crudo.length);
    for(let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i) & 0xFF;
    const plano = await inflarPDF(bytes);
    let texto = "";
    for(let i = 0; i < plano.length; i++) texto += String.fromCharCode(plano[i]);
    /* un flujo sin órdenes de texto es una imagen o una fuente */
    if(texto.indexOf("Tj") < 0 && texto.indexOf("TJ") < 0) continue;
    salida.push(textoDePDF(texto));
  }
  return salida.join(" ").replace(/\s+/g, " ").trim();
}

const UNIDADES_SUNAT = {
  "UNIDAD (NIU)":"und", "UNIDAD (ZZ)":"und", "UNIDAD":"und", "METRO":"m", "KILOGRAMO":"kg",
  "LITRO":"L", "GALON":"gal", "CAJA":"cja", "PAQUETE":"paq", "BOLSA":"bls",
  "JUEGO":"jgo", "PAR":"par", "MILLAR":"mll"
};

function leerGuiaSunat(texto){
  const t = texto.replace(/\s+/g, " ");
  const g = {lineas:[]};
  const num = t.match(/N[°¡ºo]?\s*(E[A-Z0-9]{1,4}\s*-\s*\d{4,})/);
  if(num) g.numero = num[1].replace(/\s+/g, "");
  const fec = t.match(/(\d{2}\/\d{2}\/\d{4})/);
  if(fec) g.fecha = fec[1];
  const obs = t.match(/Observaciones\s*:?\s*(.{2,60}?)\s+Esta es/i);
  if(obs) g.observaciones = obs[1].trim();

  const claves = Object.keys(UNIDADES_SUNAT)
    .sort((a,b)=> b.length - a.length)
    .map(u => u.replace(/[()]/g, "\\$&")).join("|");
  const re = new RegExp("([^|]{2,90}?)\\s+(" + claves + ")\\s+(\\d{1,3})\\s+(?:SI|NO)\\s+(\\d+(?:\\.\\d+)?)", "g");
  /* la descripción real es lo que sigue al último rótulo de cabecera */
  const CORTES = ["Cdigo producto SUNAT", "Código producto SUNAT", "SUNAT",
                  "Partida arancelaria", "Descripcin Detallada", "Descripción Detallada"];
  let m;
  while((m = re.exec(t)) !== null){
    let desc = m[1];
    CORTES.forEach(c => {
      const k = desc.lastIndexOf(c);
      if(k >= 0) desc = desc.slice(k + c.length);
    });
    desc = desc.replace(/^[\s:·.-]+/, "").trim();
    if(!desc) continue;
    g.lineas.push({n:+m[3], desc,
      unidad:UNIDADES_SUNAT[m[2]] || normalizarUnidad(m[2]) || "und",
      cant:num2(m[4])});
  }
  g.lineas.sort((a,b)=> a.n - b.n);
  return g;
}
function num2(v){ const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; }

async function cargarGuiaPDF(archivo){
  let texto = "";
  try{ texto = await leerPDFTexto(archivo); }
  catch(e){ texto = ""; }
  if(!texto) throw new Error("No se pudo leer el PDF. Si es un escaneo, use el conteo a mano.");
  const g = leerGuiaSunat(texto);
  if(!g.lineas.length)
    throw new Error("El PDF se leyó pero no se reconocieron los materiales. Use el conteo a mano.");

  const pdf = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = ()=> res(fr.result);
    fr.onerror = ()=> res(null);
    fr.readAsDataURL(archivo);
  });

  const d = {id:uid(), fecha:ahora(), numero:g.numero || archivo.name.replace(/\.pdf$/i, ""),
    transportista:"", reqs:g.observaciones || "", pdf, estado:"en_camino",
    enviadoPor:"Guía de remisión electrónica", recepcion:null,
    lineas:g.lineas.map(l => ({desc:l.desc, unidad:l.unidad, cant:l.cant, codigo:""}))};
  despachos().unshift(d);
  log("compras", "Guía leída del PDF", d.numero + " · " + d.lineas.length + " material(es)", d.id);
  guardar();
  return d;
}

/* El botón vive junto al de recibir sin guía */
const pintarRecepcionV32 = pintarRecepcion;
pintarRecepcion = function(){
  pintarRecepcionV32();
  const cont = $("rc-pendientes");
  if(!cont || $("rc-pdf")) return;
  const caja = document.createElement("div");
  caja.style.marginTop = "8px";
  caja.innerHTML =
    '<button class="btn btn-ton" id="rc-pdf">' + ico("pdf", 18) + "Leer la guía en PDF</button>" +
    '<input type="file" id="rc-pdf-archivo" accept="application/pdf" hidden>' +
    '<p class="ayuda" id="rc-pdf-info" style="margin:8px 0 0;text-align:center">' +
    "Suba la guía tal como se la envían: la app saca los materiales.</p>";
  cont.appendChild(caja);

  $("rc-pdf").addEventListener("click", ()=> $("rc-pdf-archivo").click());
  $("rc-pdf-archivo").addEventListener("change", async e => {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!archivo) return;
    const info = $("rc-pdf-info");
    info.className = "ayuda";
    info.textContent = "Leyendo " + archivo.name + "…";
    try{
      const d = await cargarGuiaPDF(archivo);
      info.innerHTML = "<b>" + esc(d.numero) + "</b> · " + d.lineas.length + " material(es) leídos.";
      snack("Guía leída: " + d.lineas.length + " materiales.", "ok");
      abrirRecepcion(d.id);
    }catch(err){
      info.className = "ayuda err";
      info.textContent = err.message || "No se pudo leer la guía.";
      snack("No se pudo leer la guía.", "err");
    }
  });
};

/* ---------------------------------------------------------------
   V33  El supervisor pide tocando y sigue lo suyo.
        1) Catálogo con semáforo dentro del requerimiento: ve si hay,
           si queda poco o si no hay — nunca la cantidad exacta, para
           que el pedido siga siendo un pedido y no un autoservicio.
        2) Repetir el pedido anterior en un toque.
        3) «Mis materiales» muestra el recorrido de cada uno:
           pedido, en camino, en almacén, recibido.
   --------------------------------------------------------------- */

(function estilosV33(){
  if($("estilos-v33")) return;
  const s = document.createElement("style");
  s.id = "estilos-v33";
  s.textContent =
    "#mr-catalogo .fila{padding:10px}" +
    ".sem{width:10px;height:10px;border-radius:50%;flex:none}" +
    ".sem.hay{background:var(--ok)} .sem.poco{background:var(--sec)} .sem.no{background:var(--mal)}" +
    ".pasos{display:flex;align-items:center;margin:8px 0 0}" +
    ".pasos .tramo{flex:1;height:4px;background:var(--sup-var)}" +
    ".pasos .punto{width:9px;height:9px;border-radius:50%;background:var(--sup-var);flex:none;margin:0 -1px}" +
    ".pasos.hecho1 .t1,.pasos.hecho1 .p1,.pasos.hecho2 .t1,.pasos.hecho2 .p1,.pasos.hecho2 .t2,.pasos.hecho2 .p2," +
      ".pasos.hecho3 .t1,.pasos.hecho3 .p1,.pasos.hecho3 .t2,.pasos.hecho3 .p2,.pasos.hecho3 .t3,.pasos.hecho3 .p3," +
      ".pasos.hecho4 .tramo,.pasos.hecho4 .punto{background:currentColor}" +
    ".rotulos{display:flex;font-size:8.5px;color:var(--tinta-sec);margin-top:5px}" +
    ".rotulos span{flex:1} .rotulos span:last-child{flex:none}" +
    "#mm-cifras{display:flex;gap:6px;margin-bottom:11px}" +
    "#mm-cifras .c{flex:1;background:var(--sup);border-radius:10px;padding:8px;text-align:center;box-shadow:var(--s1)}" +
    "#mm-cifras .c b{display:block;font-size:15px} #mm-cifras .c small{font-size:8px}";
  document.head.appendChild(s);
})();

/* Cuánto de un material viene en camino, según las guías despachadas */
function enCaminoDe(nombre){
  return (despachos() || []).filter(d => d.estado === "en_camino")
    .reduce((s,d)=> s + (d.lineas || [])
      .filter(l => claveCons(l.desc) === claveCons(nombre))
      .reduce((a,l)=> a + (num(l.cant) || 0), 0), 0);
}

function semaforoDe(nombre){
  const m = db.materiales.find(x => claveCons(x.nombre) === claveCons(nombre));
  const camino = enCaminoDe(nombre);
  if(!m || m.stock <= 0) return {clase:"no", txt:"no hay", color:"var(--mal)", camino};
  if(m.stock <= (m.minimo || 0)) return {clase:"poco", txt:"queda poco", color:"var(--alerta)", camino};
  return {clase:"hay", txt:"hay en almacén", color:"var(--ok)", camino};
}

/* Catálogo: lo del consolidado primero, y lo que solo existe en almacén */
function catalogoPedido(){
  const vistos = {}, salida = [];
  (db.consolidado.items || []).forEach(x => {
    const k = claveCons(x.desc);
    if(vistos[k]) return;
    vistos[k] = true;
    salida.push({desc:x.desc, codigo:x.codigo || "", unidad:x.unidad || "und"});
  });
  db.materiales.forEach(m => {
    const k = claveCons(m.nombre);
    if(vistos[k]) return;
    vistos[k] = true;
    salida.push({desc:m.nombre, codigo:m.codigo || "", unidad:m.unidad || "und"});
  });
  return salida;
}

(function catalogoEnRequerimientoV33(){
  const excel = $("mr-excel");
  if(!excel || $("mr-catalogo")) return;
  const caja = document.createElement("div");
  caja.className = "card";
  caja.id = "mr-catalogo";
  caja.innerHTML =
    '<div class="sech" style="margin:0 0 8px">Elija los materiales</div>' +
    '<div class="campo"><input type="search" id="mr-buscar" placeholder="Buscar material o código"></div>' +
    '<div id="mr-resultados"></div>' +
    '<div class="btns" style="margin-top:4px">' +
    '<button class="btn btn-cont btn-mini" id="mr-repetir">Repetir pedido anterior</button></div>';
  excel.insertAdjacentElement("beforebegin", caja);
  $("mr-buscar").addEventListener("input", pintarCatalogoPedido);
  $("mr-repetir").addEventListener("click", repetirPedidoAnterior);
})();

function pintarCatalogoPedido(){
  const cont = $("mr-resultados");
  if(!cont) return;
  const q = sinTildes(($("mr-buscar") || {}).value || "");
  if(!q){ cont.innerHTML = ""; return; }
  /* primero lo que empieza por lo buscado: «cable» debe traer los
     cables antes que los terminales para cable */
  const lista = catalogoPedido()
    .filter(x => sinTildes(x.desc + " " + x.codigo).indexOf(q) >= 0)
    .filter(x => !itemsReq.some(i => claveCons(i.desc) === claveCons(x.desc)))
    .map(x => {
      const d = sinTildes(x.desc);
      return {x, peso: d.indexOf(q) === 0 ? 0 : (d.indexOf(" " + q) >= 0 ? 1 : 2)};
    })
    .sort((a,b)=> a.peso - b.peso || a.x.desc.length - b.x.desc.length)
    .slice(0, 10).map(o => o.x);
  cont.innerHTML = lista.length
    ? lista.map(x => {
        const s = semaforoDe(x.desc);
        return '<button class="fila" data-mrcat="' + esc(x.desc) + '" data-und="' + esc(x.unidad) + '">' +
          '<span class="sem ' + s.clase + '"></span>' +
          '<span class="txt"><b>' + esc(x.desc) + "</b><small>" +
          (x.codigo ? esc(x.codigo) + " · " : "") + esc(x.unidad) +
          ' · <b style="color:' + s.color + ';font-weight:700">' + s.txt + "</b>" +
          (s.camino > 0 ? ' · <b style="color:var(--lila);font-weight:700">' + s.camino + " en camino</b>" : "") +
          "</small></span>" +
          '<span class="der"><span class="chip info">Pedir</span></span></button>';
      }).join("")
    : '<div class="ayuda" style="margin:0">Sin coincidencias. Puede pedirlo igual escribiéndolo en su Excel.</div>';

  $$("#mr-resultados [data-mrcat]").forEach(b => b.addEventListener("click", ()=>{
    const desc = b.dataset.mrcat;
    itemsReq.push({desc, cant:1, unidad:b.dataset.und || "und", obs:"", foto:null});
    $("mr-buscar").value = "";
    pintarCatalogoPedido();
    pintarItemsReq();
    snack(desc + " agregado. Ajuste la cantidad.", "ok");
  }));
}

/* Las cantidades se editan en la misma lista del pedido */
const pintarItemsReqV33 = pintarItemsReq;
pintarItemsReq = function(){
  pintarItemsReqV33();
  const cont = $("mr-items");
  if(!cont) return;
  /* la cantidad se edita en la propia fila, antes del botón de quitar */
  $$("#mr-items .fila").forEach((f,i) => {
    if(f.querySelector("[data-cant-req]")) return;
    const quitar = f.querySelector(".quitar");
    const marca = '<input type="number" min="0.01" step="0.01" value="' +
      (itemsReq[i] ? itemsReq[i].cant : 1) + '" data-cant-req="' + i +
      '" style="width:66px;text-align:center;padding:6px;margin-right:7px">';
    if(quitar) quitar.insertAdjacentHTML("beforebegin", marca);
    else f.insertAdjacentHTML("beforeend", marca);
  });
  $$("#mr-items [data-cant-req]").forEach(inp => inp.addEventListener("change", ()=>{
    const i = +inp.dataset.cantReq;
    if(itemsReq[i]) itemsReq[i].cant = Math.max(0.01, num(inp.value));
  }));
};

function repetirPedidoAnterior(){
  const mios = misPedidos();
  if(!mios.length) return snack("Todavía no tiene pedidos anteriores.", "err");
  hoja("Repetir un pedido",
    mios.slice(0, 10).map(r =>
      '<button class="fila" data-rep="' + r.id + '"><span class="txt"><b>' + esc(r.codigo) + "</b>" +
      '<small>' + (r.items || []).length + " materiales · " + hace(r.fecha) + "</small></span></button>").join(""),
    [{txt:"Cerrar", clase:"btn-cont"}]);
  $$("#hoja-cuerpo [data-rep]").forEach(b => b.addEventListener("click", ()=>{
    const r = db.requerimientos.find(x => x.id === b.dataset.rep);
    if(!r) return;
    (r.items || []).forEach(it => {
      if(itemsReq.some(i => claveCons(i.desc) === claveCons(it.desc))) return;
      itemsReq.push({desc:it.desc, cant:num(it.cant) || 1, unidad:it.unidad || "und", obs:it.obs || "", foto:null});
    });
    cerrarHoja();
    pintarItemsReq();
    snack("Copiado de " + r.codigo + ". Revise las cantidades.", "ok");
  }));
}

const abrirRequerimientoV33 = abrirRequerimiento;
abrirRequerimiento = function(){
  abrirRequerimientoV33();
  if($("mr-buscar")) $("mr-buscar").value = "";
  pintarCatalogoPedido();
};

/* --- El recorrido de cada material en «Mis materiales» --- */
function etapaMaterial(m){
  const falta = +(m.pedido - m.recibido).toFixed(2);
  if(falta <= 0) return {n:4, txt:"recibido", color:"var(--ok)", nota:m.recibido + " de " + m.pedido + " " + m.unidad};
  const inv = db.materiales.find(x => claveCons(x.nombre) === claveCons(m.desc));
  if(inv && inv.stock > 0)
    return {n:3, txt:"en almacén", color:"var(--pri)",
            nota:"Hay en almacén · pásese a recogerlo" + (m.recibido ? " (lleva " + m.recibido + ")" : "")};
  const camino = enCaminoDe(m.desc);
  if(camino > 0){
    const d = (despachos() || []).find(x => x.estado === "en_camino" &&
      (x.lineas || []).some(l => claveCons(l.desc) === claveCons(m.desc)));
    return {n:2, txt:"en camino", color:"var(--lila)",
            nota:"Guía " + (d ? esc(d.numero) : "") + (d && d.transportista ? " · " + esc(d.transportista) : "")};
  }
  return {n:1, txt:"pedido", color:"var(--tinta-sec)", nota:"Esperando compra o despacho"};
}

const pintarMisMaterialesV33 = pintarMisMateriales;
pintarMisMateriales = function(){
  pintarMisMaterialesV33();
  const mats = misMateriales();
  const etapas = mats.map(etapaMaterial);

  let cifras = $("mm-cifras");
  if(!cifras && $("mm-resumen")){
    cifras = document.createElement("div");
    cifras.id = "mm-cifras";
    $("mm-resumen").insertAdjacentElement("afterend", cifras);
  }
  if(cifras){
    const c = n => etapas.filter(e => e.n === n).length;
    cifras.innerHTML = mats.length
      ? '<div class="c"><b style="color:var(--tinta-sec)">' + c(1) + "</b><small>Pedido</small></div>" +
        '<div class="c"><b style="color:var(--lila)">' + c(2) + "</b><small>En camino</small></div>" +
        '<div class="c"><b style="color:var(--pri)">' + c(3) + "</b><small>En almacén</small></div>" +
        '<div class="c"><b style="color:var(--ok)">' + c(4) + "</b><small>Recibido</small></div>"
      : "";
  }

  /* cada tarjeta estrena su línea de tiempo */
  $$("#mm-lista .mm-item").forEach((el, i) => {
    if(el.querySelector(".pasos")) return;
    const e = etapas[i];
    if(!e) return;
    el.insertAdjacentHTML("beforeend",
      '<div class="pasos hecho' + e.n + '" style="color:' + e.color + '">' +
      '<span class="tramo t1"></span><span class="punto p1"></span>' +
      '<span class="tramo t2"></span><span class="punto p2"></span>' +
      '<span class="tramo t3"></span><span class="punto p3"></span>' +
      '<span class="tramo t4"></span><span class="punto p4"></span></div>' +
      '<div class="rotulos"><span>Pedido</span><span>En camino</span><span>En almacén</span><span>Recibido</span></div>' +
      '<div class="pie" style="color:' + e.color + '">' + e.nota + "</div>");
  });
};

/* ---------------------------------------------------------------
   V34  El supervisor avisa; el almacén o la obra registran.
        En el frente no hay tiempo de armar el requerimiento, así que
        el botón desaparece de su panel. A cambio, quien lo registra
        indica de qué supervisor viene, para que el pedido siga siendo
        suyo: lo ve en «Mis pedidos» y en «Mis materiales», y recibe
        el aviso de que quedó registrado.
   --------------------------------------------------------------- */

/* Su panel queda en seguir lo suyo y consultar el almacén */
const tareasDelCargoV34 = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV34();
  if(rolEfectivo() !== "supervisor") return T;
  return T.filter(x => ["Nuevo requerimiento", "Subir un requerimiento",
                        "Cargar mi pedido desde Excel"].indexOf(x.t) < 0);
};

/* Quien registra por otro elige de quién es el pedido */
function candidatosSolicitante(){
  const yo = usuarioActual();
  const sup = db.usuarios.filter(x => x.activo && x.rol === "supervisor" && x.id !== yo.id)
    .sort((a,b)=> (a.nombre || "").localeCompare(b.nombre || ""));
  return [{id:yo.id, nombre:yo.nombre + " (yo)", area:yo.area || ""}]
    .concat(sup.map(x => ({id:x.id, nombre:x.nombre, area:x.area || ""})));
}

function pintarSolicitante(){
  const quien = $("mr-quien");
  if(!quien) return;
  const puedeOtros = puede("pedidos.todos");
  let sel = $("mr-solicita");
  if(!puedeOtros){ if(sel) sel.parentNode.remove(); return; }
  if(!sel){
    const caja = document.createElement("div");
    caja.style.marginTop = "7px";
    caja.innerHTML = '<select id="mr-solicita"></select>';
    quien.parentNode.appendChild(caja);
    sel = $("mr-solicita");
    sel.addEventListener("change", ()=>{
      const u = db.usuarios.find(x => x.id === sel.value);
      if(u && u.area && $("mr-area")) $("mr-area").value = u.area;
    });
  }
  const actual = sel.value;
  sel.innerHTML = candidatosSolicitante().map(x =>
    '<option value="' + x.id + '">' + esc(x.nombre) + (x.area ? " · " + esc(x.area) : "") + "</option>").join("");
  if(actual) sel.value = actual;
}

const abrirRequerimientoV34 = abrirRequerimiento;
abrirRequerimiento = function(){
  abrirRequerimientoV34();
  pintarSolicitante();
};

/* El pedido queda a nombre del supervisor, aunque lo teclee otro */
const registrarRequerimientoV34 = registrarRequerimiento;
registrarRequerimiento = function(){
  const sel = $("mr-solicita");
  const elegido = sel ? sel.value : "";
  const antes = db.requerimientos.length;
  const r = registrarRequerimientoV34.apply(this, arguments);
  const yo = usuarioActual();
  if(elegido && yo && elegido !== yo.id && db.requerimientos.length > antes){
    const nuevo = db.requerimientos[0];
    const u = db.usuarios.find(x => x.id === elegido);
    if(u){
      nuevo.solicitanteId = u.id;
      nuevo.solicitante = u.nombre;
      nuevo.solicitanteCargo = u.cargo || "";
      nuevo.registradoPor = yo.nombre;
      if(!nuevo.disciplina && u.area){ nuevo.disciplina = u.area; nuevo.area = u.area; }
      log("pedidos", "Requerimiento registrado por otro",
          nuevo.codigo + " · de " + u.nombre + " · lo registró " + yo.nombre, nuevo.id);
      notificar({usuarios:[u.id],
        titulo:"Su requerimiento quedó registrado: " + nuevo.codigo,
        cuerpo:(nuevo.items || []).length + " material(es) · lo registró " + yo.nombre +
               "\nPuede seguirlo en «Mis materiales».",
        refTipo:"requerimiento", refId:nuevo.id});
      guardar();
    }
  }
  return r;
};

/* En la lista de pedidos se ve de quién es y quién lo tecleó */
const pintarPedidosV34 = typeof pintarPedidos === "function" ? pintarPedidos : null;
if(pintarPedidosV34){
  pintarPedidos = function(){
    pintarPedidosV34.apply(this, arguments);
    $$("#pe-lista .fila").forEach(f => {
      const s = f.querySelector(".txt small");
      if(!s || s.dataset.reg) return;
      const cod = (f.querySelector(".txt b") || {}).textContent || "";
      const r = db.requerimientos.find(x => x.codigo === cod.trim());
      if(!r || !r.registradoPor) return;
      s.dataset.reg = "1";
      s.insertAdjacentHTML("beforeend", " · registrado por " + esc(r.registradoPor));
    });
  };
}

/* ---------------------------------------------------------------
   V35  Cada línea del requerimiento, con las tres celdas del formato
        de la obra: material, unidad de medida y cantidad. La unidad
        llega propuesta desde el catálogo, pero se puede cambiar —
        el mismo perno se pide por unidad o por caja según el caso.
   --------------------------------------------------------------- */

function opcionesUnidadReq(actual){
  const enLista = UNIDADES.some(g => g.items.some(i => i[0] === actual));
  let html = "";
  if(actual && !enLista) html += '<option value="' + esc(actual) + '" selected>' + esc(actual) + "</option>";
  html += UNIDADES.map(g =>
    '<optgroup label="' + g.grupo + '">' +
    g.items.map(i => '<option value="' + i[0] + '"' + (i[0] === actual ? " selected" : "") + ">" +
      i[0] + "</option>").join("") + "</optgroup>").join("");
  return html;
}

const pintarItemsReqV35 = pintarItemsReq;
pintarItemsReq = function(){
  pintarItemsReqV35();
  $$("#mr-items .fila").forEach((f,i) => {
    if(f.querySelector("[data-und-req]")) return;
    const cant = f.querySelector("[data-cant-req]");
    const und = itemsReq[i] ? (itemsReq[i].unidad || "und") : "und";
    const marca = '<select data-und-req="' + i + '" style="width:78px;padding:6px;margin-right:7px">' +
      opcionesUnidadReq(und) + "</select>";
    if(cant) cant.insertAdjacentHTML("afterend", marca);
    else {
      const quitar = f.querySelector(".quitar");
      if(quitar) quitar.insertAdjacentHTML("beforebegin", marca);
      else f.insertAdjacentHTML("beforeend", marca);
    }
  });
  $$("#mr-items [data-und-req]").forEach(sel => sel.addEventListener("change", ()=>{
    const i = +sel.dataset.undReq;
    if(itemsReq[i]) itemsReq[i].unidad = sel.value || "und";
  }));
};

/* El nombre necesita su línea: las tres celdas no caben a lo ancho */
(function estilosItemsReqV35(){
  if($("estilos-v35")) return;
  const s = document.createElement("style");
  s.id = "estilos-v35";
  s.textContent =
    "#mr-items .fila{flex-wrap:wrap;row-gap:9px}" +
    "#mr-items .fila .txt{flex:1 1 calc(100% - 58px);min-width:0}" +
    "#mr-items .fila [data-cant-req]{margin-left:58px}" +
    "#mr-items .fila .quitar{margin-left:auto}";
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   V36  El supervisor vuelve a poder pedir por su cuenta.
        Se le quitó cuando pedir era subir una plantilla y no tenía
        tiempo; ahora es buscar y tocar, así que el botón regresa.
        El almacén y la obra siguen pudiendo registrar por él.
   --------------------------------------------------------------- */

const tareasDelCargoV36 = tareasDelCargo;
tareasDelCargo = function(){
  const T = tareasDelCargoV36();
  if(rolEfectivo() !== "supervisor") return T;
  if(T.some(x => x.t === "Nuevo requerimiento")) return T;
  T.unshift({ic:"pedidos", t:"Nuevo requerimiento", d:"Busque y toque los materiales",
             fn:()=> abrirRequerimiento(), destacada:true});
  return T;
};

/* ---------------------------------------------------------------
   V37  Más puestos en obra.
        Cinco supervisores —seguridad, civil, eléctrico, eléctrico
        junior y calidad— y dos capataces. El capataz no pide ni
        entrega: entra a ver qué material hay en obra, y nada más.
   --------------------------------------------------------------- */

/* Las disciplinas nuevas entran donde ya se usan las de siempre */
["Seguridad", "Calidad"].forEach(d => { if(DISCIPLINAS.indexOf(d) < 0) DISCIPLINAS.push(d); });
EXTRA_DISCIPLINA["Seguridad"] = ["recepcion"];
EXTRA_DISCIPLINA["Calidad"]   = ["recepcion"];

ROLES.capataz = {
  nombre:"Capataz de obra", corto:"Capataz",
  permisos:["inventario", "notificaciones", "fotos"],
  resumen:"Consulta qué material hay en el almacén de obra. No registra pedidos ni movimientos."
};

const PUESTOS_V37 = [
  {usuario:"supervisor.seguridad", nombre:"Supervisor de Seguridad", rol:"supervisor",
   cargo:"Supervisor de Seguridad", area:"Seguridad"},
  {usuario:"supervisor.civil",     nombre:"Supervisor Civil",        rol:"supervisor",
   cargo:"Supervisor Civil",        area:"Civil"},
  {usuario:"supervisor.electrico", nombre:"Supervisor Eléctrico",    rol:"supervisor",
   cargo:"Supervisor Eléctrico",    area:"Eléctrico"},
  {usuario:"supervisor.electrico.junior", nombre:"Supervisor Eléctrico Junior", rol:"supervisor",
   cargo:"Supervisor Eléctrico Junior", area:"Eléctrico"},
  {usuario:"supervisor.calidad",   nombre:"Supervisor de Calidad",   rol:"supervisor",
   cargo:"Supervisor de Calidad",   area:"Calidad"},
  {usuario:"capataz.1", nombre:"Capataz 1", rol:"capataz", cargo:"Capataz de obra", area:""},
  {usuario:"capataz.2", nombre:"Capataz 2", rol:"capataz", cargo:"Capataz de obra", area:""}
];

/* V44 · Estas cuentas también se mudaron a la base (ver sql/).

   Creándolas en cada celular pasaba algo peor que tener data de más: cada
   equipo armaba su PROPIO `supervisor.civil`, con otro id y otra sal. Al
   sincronizar no se reconocían entre ellos y la lista de usuarios terminaba
   con el mismo puesto repetido tantas veces como celulares hubiera.

   `PUESTOS_V37` se conserva porque más abajo lo usan los recorridos y los
   filtros por disciplina; lo que ya no se hace es crear las cuentas. */
async function crearPuestosV37(){ }

/* El capataz entra directo a ver el material de obra */
const tareasDelCargoV37 = tareasDelCargo;
tareasDelCargo = function(){
  if(rolEfectivo() !== "capataz") return tareasDelCargoV37();
  const T = [];
  T.push({ic:"inventario", t:"Material en obra", d:"Qué hay hoy en el almacén",
          fn:()=> ir("inventario"), destacada:true, ancha:true});
  T.push({ic:"alerta", t:"Stock crítico", d:"Lo que está por acabarse",
          n:db.materiales.filter(x => estadoStock(x) !== "disponible").length,
          fn:()=>{ ir("inventario"); setTimeout(()=>{
            const b = document.querySelector('#iv-filtros [data-est="bajo"]'); if(b) b.click(); }, 250); }});
  if(simulando()) T.push({ic:"cambiar", t:"Salir de la simulación", d:"Volver a su cuenta", fn:salirSimulacion});
  return T;
};
NOMBRE_CORTO["Material en obra"] = "Material";
NOMBRE_CORTO["Stock crítico"] = "Crítico";

const iniciarAppV37 = iniciarApp;
iniciarApp = function(){
  iniciarAppV37.apply(this, arguments);
  crearPuestosV37();
};

/* ---------------------------------------------------------------
   V38  Los puestos nuevos también se pueden recorrer.
        «Ver la app como otro cargo» armaba su lista con los cargos
        de siempre y una entrada por disciplina, así que el capataz
        y el eléctrico junior no aparecían aunque sus cuentas ya
        existieran. La lista pasa a salir de los cargos reales.
   --------------------------------------------------------------- */

const opcionesSimulacionV38 = opcionesSimulacion;
opcionesSimulacion = function(){
  const o = opcionesSimulacionV38();
  /* el eléctrico junior comparte disciplina, así que va aparte */
  if(!o.some(x => x.etiqueta === "Supervisor Eléctrico Junior"))
    o.push({rol:"supervisor", area:"Eléctrico", etiqueta:"Supervisor Eléctrico Junior"});
  if(ROLES.capataz && !o.some(x => x.rol === "capataz"))
    o.push({rol:"capataz", area:"Obra", etiqueta:"Capataz de obra"});
  return o;
};

/* Cada cargo con su ícono; el capataz no tenía uno propio */
const abrirSimulacionV38 = abrirSimulacion;
abrirSimulacion = function(){
  abrirSimulacionV38.apply(this, arguments);
  const ops = opcionesSimulacion();
  $$("#hoja-cuerpo [data-sim]").forEach(b => {
    const o = ops[+b.dataset.sim];
    if(!o) return;
    if(o.rol === "capataz"){
      const mini = b.querySelector(".mini");
      if(mini) mini.innerHTML = ico("personas", 20);
    }
    if(o.etiqueta === "Supervisor Eléctrico Junior"){
      const s = b.querySelector(".txt small");
      if(s) s.textContent = "Mismos permisos del supervisor eléctrico.";
    }
  });
};

/* ---------------------------------------------------------------
   V39  Dónde está cada cosa.
        Cada material lleva su ubicación en el almacén — zona, rack y
        nivel —, se ve en el inventario, se filtra por zona y aparece
        al entregar, que es cuando hay que ir a buscarlo. Al recibir
        material nuevo se pregunta dónde se guardó.
   --------------------------------------------------------------- */

(function estilosV39(){
  if($("estilos-v39")) return;
  const s = document.createElement("style");
  s.id = "estilos-v39";
  s.textContent =
    ".ubic{display:inline-flex;align-items:center;gap:4px;background:var(--sup-var);color:var(--tinta-sec);" +
      "border-radius:6px;padding:1px 6px;font-size:10.5px;font-weight:700;letter-spacing:.02em}" +
    ".ubic.vacia{background:var(--alerta-f);color:var(--alerta)}" +
    "#iv-zonas{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;margin-bottom:6px;scrollbar-width:none}" +
    "#iv-zonas::-webkit-scrollbar{display:none}" +
    "#iv-zonas button{background:var(--sup);border:1px solid var(--borde);color:var(--tinta-sec);" +
      "font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:var(--r-full);white-space:nowrap}" +
    "#iv-zonas button.on{background:var(--pri-cont);border-color:var(--pri-cont);color:var(--pri-osc)}";
  document.head.appendChild(s);
})();

function ubicacionDe(m){ return String((m && m.ubicacion) || "").trim(); }
function zonaDe(m){
  const u = ubicacionDe(m);
  if(!u) return "";
  return u.split(/[-–\/\s]/)[0].toUpperCase();
}
function zonasConocidas(){
  const z = {};
  db.materiales.forEach(m => { const k = zonaDe(m); if(k) z[k] = (z[k] || 0) + 1; });
  return Object.keys(z).sort().map(k => ({zona:k, n:z[k]}));
}
function marcaUbicacion(m){
  const u = ubicacionDe(m);
  return u ? '<span class="ubic">' + ico("inventario", 11) + esc(u) + "</span>"
           : '<span class="ubic vacia">sin ubicar</span>';
}

/* --- El campo dentro de la ficha del producto --- */
(function campoUbicacionV39(){
  const cat = $("mp-categoria");
  if(!cat || $("mp-ubicacion")) return;
  const campo = document.createElement("div");
  campo.className = "campo";
  campo.id = "mp-campo-ubicacion";
  campo.innerHTML = '<label>Ubicación en almacén</label>' +
    '<input type="text" id="mp-ubicacion" list="mp-ubic-lista" placeholder="A-03-2 · rack, estante, nivel">' +
    '<datalist id="mp-ubic-lista"></datalist>' +
    '<div class="ayuda" style="margin:6px 0 0">Ejemplos: A-01-1, B-04-3, PATIO, CONTENEDOR 2</div>';
  const fila = cat.closest(".dos") || cat.closest(".campo");
  if(fila) fila.insertAdjacentElement("afterend", campo);
})();

const abrirProductoV39 = abrirProducto;
abrirProducto = function(tipo, id){
  abrirProductoV39(tipo, id);
  const inp = $("mp-ubicacion");
  if(!inp) return;
  const m = id ? db.materiales.find(x => x.id === id) : null;
  inp.value = m ? ubicacionDe(m) : "";
  const lista = $("mp-ubic-lista");
  if(lista){
    const vistas = {};
    db.materiales.forEach(x => { const u = ubicacionDe(x); if(u) vistas[u] = 1; });
    lista.innerHTML = Object.keys(vistas).sort().map(u => '<option value="' + esc(u) + '">').join("");
  }
  const soloMaterial = tipo !== "herramienta";
  $("mp-campo-ubicacion").classList.toggle("oculto", false);
  if(!soloMaterial) inp.placeholder = "Dónde se guarda la herramienta";
};

const registrarProductoV39 = registrarProducto;
registrarProducto = function(){
  const antes = db.materiales.length;
  const idsAntes = db.materiales.map(x => x.id);
  const ubic = ($("mp-ubicacion") ? $("mp-ubicacion").value : "").trim().toUpperCase();
  const r = registrarProductoV39.apply(this, arguments);
  if(!ubic) return r;
  /* vale tanto para el alta como para la edición */
  const nuevo = db.materiales.find(x => idsAntes.indexOf(x.id) < 0);
  const objetivo = nuevo || db.materiales.find(x => x.id === (window.__editandoProducto || ""));
  if(objetivo){ objetivo.ubicacion = ubic; guardar(); }
  return r;
};

/* --- En el inventario: la marca y el filtro por zona --- */
const pintarInventarioV39 = pintarInventario;
pintarInventario = function(){
  pintarInventarioV39.apply(this, arguments);

  let zonas = $("iv-zonas");
  const filtros = $("iv-filtros");
  if(filtros && !zonas){
    zonas = document.createElement("div");
    zonas.id = "iv-zonas";
    filtros.insertAdjacentElement("afterend", zonas);
  }
  if(zonas){
    const lista = zonasConocidas();
    const sinUbicar = db.materiales.filter(m => !ubicacionDe(m)).length;
    zonas.innerHTML = lista.length
      ? '<button class="' + (!window.__zonaFiltro ? "on" : "") + '" data-zona="">Todas</button>' +
        lista.map(z => '<button class="' + (window.__zonaFiltro === z.zona ? "on" : "") +
          '" data-zona="' + esc(z.zona) + '">' + esc(z.zona) + " · " + z.n + "</button>").join("") +
        (sinUbicar ? '<button class="' + (window.__zonaFiltro === "__sin" ? "on" : "") +
          '" data-zona="__sin">Sin ubicar · ' + sinUbicar + "</button>" : "")
      : "";
    $$("#iv-zonas [data-zona]").forEach(b => b.addEventListener("click", ()=>{
      window.__zonaFiltro = b.dataset.zona;
      pintarInventario();
    }));
  }

  /* la ubicación se lee en la propia fila */
  $$("#iv-lista .fila").forEach(f => {
    const m = db.materiales.find(x => x.id === f.dataset.mat);
    const s = f.querySelector(".txt small");
    if(!m || !s || s.dataset.ubic) return;
    s.dataset.ubic = "1";
    s.insertAdjacentHTML("afterbegin", marcaUbicacion(m) + " ");
  });

  if(window.__zonaFiltro){
    $$("#iv-lista .fila").forEach(f => {
      const m = db.materiales.find(x => x.id === f.dataset.mat);
      if(!m) return;
      const z = zonaDe(m);
      const pasa = window.__zonaFiltro === "__sin" ? !ubicacionDe(m) : z === window.__zonaFiltro;
      f.classList.toggle("oculto", !pasa);
    });
  }
};

/* --- Al entregar, dice dónde ir a buscarlo --- */
const pintarEntregaV39 = pintarEntrega;
pintarEntrega = function(){
  pintarEntregaV39.apply(this, arguments);
  $$("#sa-lista .fila").forEach((f,i) => {
    const it = entregaItems[i];
    if(!it) return;
    const m = db.materiales.find(x => x.id === it.itemId);
    const s = f.querySelector(".txt small");
    if(!m || !s || s.dataset.ubic) return;
    s.dataset.ubic = "1";
    s.insertAdjacentHTML("afterbegin", marcaUbicacion(m) + " ");
  });
};

/* Los escuchas quedaron atados a la versión vieja de pintarInventario:
   se rehacen para que siempre llamen a la actual. */
(function reconectarInventarioV39(){
  const buscar = $("iv-buscar");
  if(buscar){
    const n = buscar.cloneNode(true);
    buscar.parentNode.replaceChild(n, buscar);
    n.addEventListener("input", ()=> pintarInventario());
  }
  const filtros = $("iv-filtros");
  if(filtros){
    const n = filtros.cloneNode(true);
    filtros.parentNode.replaceChild(n, filtros);
    n.addEventListener("click", e => {
      const b = e.target.closest("button[data-est]");
      if(!b) return;
      filtroInv = b.dataset.est || "";
      $$("#iv-filtros button").forEach(x => x.classList.toggle("on", x === b));
      pintarInventario();
    });
  }
})();

/* ---------------------------------------------------------------
   V39  La herramienta tiene hoja de vida.
        1) Al devolver se exige foto, igual que al prestar: queda el
           antes y el después de cada salida.
        2) El préstamo cerrado ya no se borra — se guarda con sus
           fechas, sus días fuera, su estado y sus dos fotos.
        3) Al vencer un préstamo avisa solo, una vez al día, al
           almacén y al responsable.
   --------------------------------------------------------------- */

function historialPrestamos(h){ h.prestamos = h.prestamos || []; return h.prestamos; }

function diasEntre(a, b){
  const d1 = new Date(a), d2 = new Date(b || ahora());
  if(isNaN(d1) || isNaN(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/* La devolución pide evidencia y archiva el préstamo */
devolverHerramienta = async function(id){
  const h = db.herramientas.find(x => x.id === id);
  if(!h) return;
  const pr = h.prestamo || {};
  const p = pr.personaId ? db.personal.find(x => x.id === pr.personaId) : null;
  const fuera = diasEntre(pr.salida || pr.fecha, ahora());
  const tarde = pr.devolucion && pr.devolucion < hoyISO() ? diasEntre(pr.devolucion, hoyISO()) : 0;

  limpiarFoto("dv-foto");
  hoja("Devolución de " + esc(h.nombre),
    '<div class="card plano" style="font-size:11.5px;color:var(--tinta-sec);padding:11px;margin:0 0 12px">' +
    "<b style='color:var(--tinta)'>" + esc(p ? p.nombre : "—") + "</b> · " + fuera + " día(s) fuera" +
    (tarde ? " · <b style='color:var(--mal)'>" + tarde + " de retraso</b>" : " · a tiempo") + "</div>" +
    '<div class="campo"><label>Estado en que se devuelve</label><select id="dv-estado">' +
    '<option value="Operativa">Operativa</option><option value="Observada">Observada</option>' +
    '<option value="Dada de baja">Dada de baja</option></select></div>' +
    '<div class="campo"><label>Foto de la herramienta al volver</label>' +
    '<button class="foto-btn" id="dv-foto-btn">' + ico("camara", 20) + "Tomar foto</button>" +
    '<input type="file" id="dv-foto" accept="image/*" capture="environment" hidden>' +
    '<div class="prev" id="dv-foto-prev"></div></div>' +
    '<div class="campo"><label>Observaciones</label>' +
    '<textarea id="dv-obs" placeholder="Daños, desgaste, faltantes"></textarea></div>',
    [{txt:"Cancelar", clase:"btn-cont"},
     {txt:"Registrar devolución", clase:"btn-ok", fn:()=> cerrarDevolucion(h, p, pr, fuera, tarde)}]);

  setTimeout(()=>{
    initFoto("dv-foto");
    const b = $("dv-foto-btn");
    if(b) b.addEventListener("click", ()=> $("dv-foto").click());
  }, 40);
};

function cerrarDevolucion(h, p, pr, fuera, tarde){
  const estado = ($("dv-estado") || {}).value || "Operativa";
  const obs = ($("dv-obs") || {}).value || "";
  const foto = fotos["dv-foto"] || null;
  if(!foto){
    snack("Tome la foto de la herramienta al volver.", "err");
    devolverHerramienta(h.id);   /* la hoja se cerró: se vuelve a abrir */
    return;
  }

  historialPrestamos(h).unshift({
    id:uid(), personaId:pr.personaId || null, responsable:pr.responsable || (p ? p.nombre : ""),
    salida:pr.salida || pr.fecha, pactada:pr.devolucion || "", retorno:ahora(),
    dias:fuera, retraso:tarde, estado, obs,
    fotoSalida:pr.fotoResponsable || null, fotoHerramienta:pr.fotoHerramienta || null,
    fotoRetorno:foto, registro:usuarioActual().nombre
  });

  h.estado = estado === "Dada de baja" ? "baja" : "disponible";
  registrarMov({tipo:"devolucion", itemId:h.id, item:h.codigo + " · " + h.nombre, cantidad:1,
    unidad:"und", saldo:"", persona:p ? p.nombre : (pr.responsable || ""), area:estado,
    documento:"", obs:obs + (tarde ? " · " + tarde + " día(s) de retraso" : ""),
    foto1:foto, foto2:pr.fotoResponsable || null});
  h.asignadaA = null; h.prestamo = null;
  log("herramientas", "Devolución registrada",
      h.codigo + " · " + estado + " · " + fuera + " día(s)", h.id);
  if(estado !== "Operativa")
    notificar({roles:["almacenero","obra","admin"],
      titulo:"Herramienta devuelta " + estado.toLowerCase() + ": " + h.nombre,
      cuerpo:(p ? p.nombre : "") + (obs ? "\n" + obs : ""), refTipo:"herramienta", refId:h.id});
  limpiarFoto("dv-foto");
  if(guardar()){ snack("Devolución registrada (" + estado + ").", "ok"); refrescar(pantalla); }
}

/* --- La hoja de vida, dentro del detalle de la herramienta --- */
const detalleHerramientaV39 = detalleHerramienta;
detalleHerramienta = function(id){
  detalleHerramientaV39(id);
  const h = db.herramientas.find(x => x.id === id);
  const cont = $("hoja-cuerpo");
  if(!h || !cont || $("hv-herramienta")) return;
  const hist = historialPrestamos(h);
  const dias = hist.reduce((s,x)=> s + (x.dias || 0), 0);
  const obs = hist.filter(x => x.estado !== "Operativa").length;

  const CHIP = {"Operativa":"ok", "Observada":"alerta", "Dada de baja":"mal"};
  cont.insertAdjacentHTML("beforeend",
    '<div id="hv-herramienta"><div class="sech" style="margin:16px 0 8px">Hoja de vida</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:11px">' +
    '<div class="card plano" style="flex:1;text-align:center;padding:9px;margin:0"><b style="display:block;font-size:16px;color:var(--pri)">' +
      hist.length + '</b><small style="font-size:8.5px;color:var(--tinta-sec)">Préstamos</small></div>' +
    '<div class="card plano" style="flex:1;text-align:center;padding:9px;margin:0"><b style="display:block;font-size:16px;color:var(--pri)">' +
      dias + '</b><small style="font-size:8.5px;color:var(--tinta-sec)">Días fuera</small></div>' +
    '<div class="card plano" style="flex:1;text-align:center;padding:9px;margin:0"><b style="display:block;font-size:16px;color:var(--alerta)">' +
      obs + '</b><small style="font-size:8.5px;color:var(--tinta-sec)">Observada</small></div></div>' +
    (hist.length
      ? hist.slice(0, 10).map(x =>
        '<div class="card plano" style="padding:11px;margin-bottom:7px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
        '<b style="flex:1;font-size:12.5px">' + esc(x.responsable || "—") + "</b>" +
        '<span class="chip ' + (CHIP[x.estado] || "") + '">' + esc(x.estado) + "</span></div>" +
        '<small style="display:block;font-size:10.5px;color:var(--tinta-sec)">' +
        soloFecha(x.salida) + " → " + soloFecha(x.retorno) + " · " + (x.dias || 0) + " día(s)" +
        (x.retraso ? " · " + x.retraso + " de retraso" : " · a tiempo") + "</small>" +
        (x.obs ? '<small style="display:block;font-size:10.5px;color:var(--tinta-sec);margin-top:3px">' + esc(x.obs) + "</small>" : "") +
        '<div style="display:flex;gap:6px;margin-top:7px">' +
        (x.fotoSalida ? '<img src="' + x.fotoSalida + '" class="thumb" style="width:46px;height:46px" data-zoom="' + x.fotoSalida + '" alt="salida">' : "") +
        (x.fotoRetorno ? '<img src="' + x.fotoRetorno + '" class="thumb" style="width:46px;height:46px" data-zoom="' + x.fotoRetorno + '" alt="retorno">' : "") +
        "</div></div>").join("")
      : '<div class="ayuda" style="margin:0">Todavía no se ha prestado.</div>') + "</div>");
}

/* --- Aviso de vencimiento, una vez al día --- */
function avisarPrestamosVencidos(){
  if(!db || !db.herramientas) return;
  const hoy = hoyISO();
  let hubo = false;
  db.herramientas.forEach(h => {
    const pr = h.prestamo;
    if(!pr || h.estado !== "prestada" || !pr.devolucion) return;
    if(pr.devolucion > hoy || pr.avisado === hoy) return;
    const p = pr.personaId ? db.personal.find(x => x.id === pr.personaId) : null;
    const tarde = diasEntre(pr.devolucion, hoy);
    pr.avisado = hoy;
    hubo = true;
    notificar({roles:["almacenero", "admin", "obra"],
      titulo:"Préstamo vencido: " + h.nombre,
      cuerpo:(pr.responsable || (p ? p.nombre : "—")) + " debió devolverla el " + soloFecha(pr.devolucion) +
             (tarde ? "\nLleva " + tarde + " día(s) de retraso." : ""),
      refTipo:"herramienta", refId:h.id});
  });
  if(hubo) guardar();
}

const aplicarRolV39 = aplicarRol;
aplicarRol = function(){ aplicarRolV39(); avisarPrestamosVencidos(); };

/* ---------------------------------------------------------------
   V40  La foto es de la herramienta, no de la persona.
        Quien recibe ya queda identificado por sus datos —nombre,
        DNI, área—, así que fotografiarlo no aporta y demora la
        entrega. Lo que sí importa es cómo salió la herramienta,
        para poder compararla con la foto del retorno.
   --------------------------------------------------------------- */

(function fotoDeLaHerramientaV40(){
  const campoPersona = ($("mt-foto1") || {}).closest ? $("mt-foto1").closest(".campo") : null;
  if(campoPersona) campoPersona.classList.add("oculto");
  const campoHer = ($("mt-foto2") || {}).closest ? $("mt-foto2").closest(".campo") : null;
  if(campoHer){
    const et = campoHer.querySelector("label");
    if(et) et.textContent = "Foto de la herramienta al salir";
  }
})();

const registrarPrestamoV40 = registrarPrestamo;
registrarPrestamo = function(){
  const h = db.herramientas.find(x => x.id === $("mt-herramienta").value);
  const p = db.personal.find(x => x.id === $("mt-persona").value);
  if(!h) return snack("Seleccione una herramienta disponible.", "err");
  if(!p) return snack("Seleccione al responsable.", "err");
  if(!fotos["mt-foto2"]) return snack("Tome la foto de la herramienta antes de entregarla.", "err");
  /* la validación original exige la foto del responsable: se le da
     la de la herramienta para que no bloquee */
  const previa = fotos["mt-foto1"];
  fotos["mt-foto1"] = previa || fotos["mt-foto2"];
  const r = registrarPrestamoV40.apply(this, arguments);
  if(!previa && h.prestamo) h.prestamo.fotoResponsable = null;
  fotos["mt-foto1"] = null;
  return r;
};

/* En el historial, la foto de salida es la de la herramienta */
const cerrarDevolucionV40 = cerrarDevolucion;
cerrarDevolucion = function(h, p, pr, fuera, tarde){
  const r = cerrarDevolucionV40.apply(this, arguments);
  const ultimo = (h.prestamos || [])[0];
  if(ultimo && !ultimo.fotoSalida && ultimo.fotoHerramienta)
    ultimo.fotoSalida = ultimo.fotoHerramienta;
  return r;
};

/* La lista de préstamos ya no muestra la cara: muestra la herramienta */
const pintarPrestamosV40 = pintarPrestamos;
pintarPrestamos = function(){
  pintarPrestamosV40();
  db.herramientas.filter(h => h.estado === "prestada" && h.prestamo).forEach(h => {
    const b = document.querySelector('#he-prestamos [data-her="' + h.id + '"]');
    if(!b) return;
    const mini = b.querySelector(".mini");
    if(!mini) return;
    mini.innerHTML = h.prestamo.fotoHerramienta
      ? '<img src="' + h.prestamo.fotoHerramienta + '" alt="">'
      : ico("llave", 20);
  });
};

/* ---------------------------------------------------------------
   V41  Al prestar se ve —y se completa— la identidad de la
        herramienta: marca, modelo y número de serie. Y si quien se
        la lleva no está registrado, se anotan sus datos ahí mismo
        sin salir del préstamo.
   --------------------------------------------------------------- */

(function camposPrestamoV41(){
  const her = $("mt-herramienta");
  const per = $("mt-persona");
  if(!her || !per || $("mt-marca")) return;

  her.closest(".campo").insertAdjacentHTML("afterend",
    '<div class="card plano" id="mt-ficha" style="padding:11px;margin-bottom:14px">' +
    '<div class="sech" style="margin:0 0 8px">Identificación de la herramienta</div>' +
    '<div class="dos"><div class="campo" style="margin-bottom:9px"><label>Marca</label>' +
    '<input type="text" id="mt-marca" placeholder="Bosch"></div>' +
    '<div class="campo" style="margin-bottom:9px"><label>Modelo</label>' +
    '<input type="text" id="mt-modelo" placeholder="GSB 550"></div></div>' +
    '<div class="campo" style="margin-bottom:0"><label>N° de serie</label>' +
    '<input type="text" id="mt-serie" placeholder="BS-2291"></div>' +
    '<p class="ayuda" style="margin:8px 0 0">Se guarda en la herramienta y queda en el vale del préstamo.</p></div>');

  per.closest(".campo").insertAdjacentHTML("afterend",
    '<div class="card plano oculto" id="mt-nueva" style="padding:11px;margin-bottom:14px">' +
    '<div class="sech" style="margin:0 0 8px">Datos del responsable</div>' +
    '<div class="campo" style="margin-bottom:9px"><label>Nombre completo</label>' +
    '<input type="text" id="mt-n-nombre" placeholder="Nombres y apellidos"></div>' +
    '<div class="dos"><div class="campo" style="margin-bottom:9px"><label>DNI</label>' +
    '<input type="text" id="mt-n-dni" inputmode="numeric" maxlength="8" placeholder="00000000"></div>' +
    '<div class="campo" style="margin-bottom:9px"><label>Celular</label>' +
    '<input type="tel" id="mt-n-cel" inputmode="tel" placeholder="999 999 999"></div></div>' +
    '<div class="dos"><div class="campo" style="margin-bottom:0"><label>Cargo</label>' +
    '<input type="text" id="mt-n-cargo" placeholder="Operario"></div>' +
    '<div class="campo" style="margin-bottom:0"><label>Área</label>' +
    '<input type="text" id="mt-n-area" placeholder="Eléctrico"></div></div>' +
    '<p class="ayuda" style="margin:8px 0 0">Queda registrado en el personal de obra para la próxima vez.</p></div>');

  her.addEventListener("change", ficharHerramienta);
  per.addEventListener("change", ()=>{
    $("mt-nueva").classList.toggle("oculto", per.value !== "__nueva");
    if(per.value === "__nueva" && $("mt-n-nombre")) $("mt-n-nombre").focus();
  });
})();

function ficharHerramienta(){
  const h = db.herramientas.find(x => x.id === ($("mt-herramienta") || {}).value);
  ["mt-marca", "mt-modelo", "mt-serie"].forEach(id => { if($(id)) $(id).value = ""; });
  if(!h) return;
  if($("mt-marca"))  $("mt-marca").value  = h.marca || "";
  if($("mt-modelo")) $("mt-modelo").value = h.modelo || "";
  if($("mt-serie"))  $("mt-serie").value  = h.serie || "";
}

/* La lista de responsables admite anotar a alguien nuevo */
const llenarPersonalV41 = llenarPersonal;
llenarPersonal = function(idSel){
  llenarPersonalV41(idSel);
  if(idSel !== "mt-persona") return;
  const sel = $(idSel);
  if(!sel || sel.querySelector('[value="__nueva"]')) return;
  sel.insertAdjacentHTML("beforeend", '<option value="__nueva">Otra persona, anotar sus datos…</option>');
};

const abrirPrestamoV41 = abrirPrestamo;
abrirPrestamo = function(){
  abrirPrestamoV41.apply(this, arguments);
  ["mt-n-nombre", "mt-n-dni", "mt-n-cel", "mt-n-cargo", "mt-n-area"].forEach(id => { if($(id)) $(id).value = ""; });
  if($("mt-nueva")) $("mt-nueva").classList.add("oculto");
  ficharHerramienta();
};

const registrarPrestamoV41 = registrarPrestamo;
registrarPrestamo = function(){
  const per = $("mt-persona");
  /* si es alguien nuevo, primero entra al personal de obra */
  if(per && per.value === "__nueva"){
    const nombre = ($("mt-n-nombre") || {}).value || "";
    if(!nombre.trim()) return snack("Escriba el nombre del responsable.", "err");
    const p = {id:uid(), nombre:nombre.trim(), dni:($("mt-n-dni") || {}).value.trim() || "",
      celular:($("mt-n-cel") || {}).value.trim() || "", cargo:($("mt-n-cargo") || {}).value.trim() || "",
      area:($("mt-n-area") || {}).value.trim() || "", foto:null, activo:true};
    db.personal.push(p);
    log("personal", "Persona registrada desde un préstamo", p.nombre + (p.dni ? " · DNI " + p.dni : ""));
    llenarPersonal("mt-persona");
    per.value = p.id;
  }

  const h = db.herramientas.find(x => x.id === ($("mt-herramienta") || {}).value);
  const r = registrarPrestamoV41.apply(this, arguments);

  /* lo escrito en la ficha se guarda en la herramienta y en el vale */
  if(h && h.estado === "prestada" && h.prestamo){
    const marca = ($("mt-marca") || {}).value.trim() || "";
    const modelo = ($("mt-modelo") || {}).value.trim() || "";
    const serie = ($("mt-serie") || {}).value.trim() || "";
    if(marca)  h.marca = marca;
    if(modelo) h.modelo = modelo;
    if(serie)  h.serie = serie;
    h.prestamo.marca = h.marca || "";
    h.prestamo.modelo = h.modelo || "";
    h.prestamo.serie = h.serie || "";
    const p = db.personal.find(x => x.id === h.prestamo.personaId);
    if(p){ h.prestamo.dni = p.dni || ""; h.prestamo.cargo = p.cargo || ""; h.prestamo.area = p.area || ""; }
    guardar();
  }
  return r;
};

/* El historial guarda con qué identidad salió la herramienta */
const cerrarDevolucionV41 = cerrarDevolucion;
cerrarDevolucion = function(h, p, pr, fuera, tarde){
  const r = cerrarDevolucionV41.apply(this, arguments);
  const ultimo = (h.prestamos || [])[0];
  if(ultimo){
    ultimo.marca = pr.marca || h.marca || "";
    ultimo.modelo = pr.modelo || h.modelo || "";
    ultimo.serie = pr.serie || h.serie || "";
    ultimo.dni = pr.dni || (p ? p.dni : "") || "";
    guardar();
  }
  return r;
};

/* ---------------------------------------------------------------
   V42  La Administradora de Obra, primer filtro de todo pedido

   Regla de la obra: venga de quien venga —un supervisor, un capataz,
   o el propio almacenero que levanta lo que le pidieron de palabra—
   el requerimiento pasa primero por la Administradora de Obra.
   Ella es la única que lo manda a logística.

   1) El almacenero pierde el botón de «Enviar a logística».
   2) Aunque alguien llegue por otro camino, el cambio de estado se
      bloquea en un solo punto: nadie salta el visto bueno de Obra.
   --------------------------------------------------------------- */
(function obraPrimerFiltroV42(){
  const p = ROLES.almacenero.permisos;
  const i = p.indexOf("pedidos.consolidar");
  if(i >= 0) p.splice(i, 1);
  ROLES.almacenero.resumen =
    "Levanta los requerimientos que le piden en almacén y los pasa a la " +
    "Administradora de Obra, y maneja inventario, herramientas, préstamos, " +
    "ingresos por guía, consolidado y reportes.";
})();

const cambiarEstadoReqV42 = cambiarEstadoReq;
cambiarEstadoReq = function(id, estado){
  /* Se mira el cargo con el que está trabajando, no la cuenta: cuando el
     administrador de la app trabaja como almacenero, también pasa por Obra. */
  const mandaObra = rolEfectivo() === "obra" || rolEfectivo() === "admin";
  if(estado === "enviado_logistica" && !mandaObra)
    return snack("Solo la Administradora de Obra envía los pedidos a logística.", "err");
  if(estado === "aprobado" && !mandaObra){
    const r = db.requerimientos.find(x => x.id === id);
    const paso = (r.historial || []).some(h =>
      ["enviado_logistica","consolidado","aprobado"].indexOf(h.estado) >= 0);
    if(!paso)
      return snack("Este pedido todavía no pasó por la Administradora de Obra.", "err");
  }
  return cambiarEstadoReqV42.apply(this, arguments);
};

/* ---------------------------------------------------------------
   V43  Amarillo y azul

   La paleta pasa de naranja a amarillo de casco. El amarillo no
   admite texto blanco —se pierde bajo el sol de mina—, así que todo
   lo que iba en blanco sobre el color secundario pasa a tinta
   oscura. Esta hoja va al final para ganarle a las anteriores.
   --------------------------------------------------------------- */
(function amarilloYAzulV43(){
  if($("estilos-amarillo")) return;
  const s = document.createElement("style");
  s.id = "estilos-amarillo";
  s.textContent =
    ".simbanda{color:var(--sobre-sec)}" +
    ".simbanda .txt small{opacity:.75}" +
    ".tarea.destacada .n{background:var(--sec);color:var(--sobre-sec)}" +
    ".tareas.rejilla .tarea.destacada .n{background:transparent;color:var(--sobre-sec)}" +
    ".tareas.rejilla .tarea.destacada .t b{color:var(--sobre-sec)}" +
    ".tareas.rejilla .tarea.destacada .glob{background:var(--sobre-sec);color:var(--sec)}" +
    ".btn-modo.admin{color:var(--sobre-sec)}";
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   V48  Quién soy, arriba y sin rodeos

   La tarjeta de inicio abría con "Buenas noches" y recién debajo el
   nombre. El saludo ocupa la línea de arriba —la que primero se lee—
   para decir algo que ya se sabe.

   Y la barra de arriba, que es lo único que se ve desde cualquier
   pantalla, mostraba el cargo pero no el nombre. Cuando el
   administrador anda cambiando de cargo para revisar cómo ve la app
   cada uno, saber con qué identidad está trabajando importa más que
   la hora del día.

   Queda: primero el nombre, después el puesto, en la tarjeta y en la
   barra. Y el botón de cambiar de cargo también arriba, para no tener
   que volver a Inicio cada vez.
   --------------------------------------------------------------- */
(function estilosV48(){
  if($("estilos-v48")) return;
  const s = document.createElement("style");
  s.id = "estilos-v48";
  s.textContent =
    /* el nombre pasa a ser la línea principal de la tarjeta */
    "#ini-saludo .nombre-v48{font-size:19px;font-weight:600;line-height:1.15}" +
    "#ini-saludo .cargo-v48{font-size:12.5px;color:var(--tinta-sec);margin-top:1px}" +
    /* en la barra, nombre y cargo entran en la línea del subtítulo */
    "#appbar .tit small#subtitulo{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}" +
    "#btn-simular-barra{flex:0 0 auto}";
  document.head.appendChild(s);
})();

function sinSaludoV48(){
  const caja = $("ini-saludo");
  if(!caja) return;
  const fila = caja.firstElementChild;
  const datos = fila && fila.lastElementChild;
  if(!datos || datos === fila) return;

  /* Se quita solo si de verdad es el saludo: si algún día se cambia el
     orden, esto no se lleva por delante el nombre. */
  const primero = datos.firstElementChild;
  if(primero && primero.textContent.trim() === saludo().trim()) primero.remove();

  const nombre = datos.firstElementChild;
  if(nombre) nombre.className = "nombre-v48";
  const cargo = nombre && nombre.nextElementSibling;
  if(cargo && cargo.tagName !== "BUTTON") cargo.className = "cargo-v48";
}

function cabeceraArribaV48(){
  const u = usuarioActual();
  if(!u) return;

  /* Nombre primero, puesto después — el mismo orden que abajo. */
  const sub = $("subtitulo");
  if(sub){
    const cargo = ROLES[rolEfectivo()];
    sub.textContent = u.nombre + (cargo ? " · " + cargo.nombre : "");
  }

  /* El botón de cambiar de cargo, al lado del de modo. Se rige por las
     mismas condiciones que el de la tarjeta: es gobierno de la app. */
  const modo = $("btn-modo");
  const puedeSimular = u.esAdmin && !simulando() && esModoAdmin();
  let b = $("btn-simular-barra");

  if(!puedeSimular || !modo){ if(b) b.remove(); return; }
  if(!b){
    b = document.createElement("button");
    b.id = "btn-simular-barra";
    b.className = "icon-btn";
    b.setAttribute("aria-label", "Ver la app como otro cargo");
    b.title = "Ver la app como otro cargo";
    b.innerHTML = ico("cambiar", 20);
    b.addEventListener("click", ()=> abrirSimulacion());
    modo.insertAdjacentElement("beforebegin", b);
  }
}

const pintarInicioV48 = pintarInicio;
pintarInicio = function(){ pintarInicioV48(); sinSaludoV48(); cabeceraArribaV48(); };

const aplicarRolV48 = aplicarRol;
aplicarRol = function(){ aplicarRolV48(); cabeceraArribaV48(); };

/* ---------------------------------------------------------------
   V48b  Fuera el botón de menú

   Eran dos controles para el mismo panel: el de la izquierda lo abría
   con las secciones y el avatar con el perfil. Se va el de la
   izquierda.

   OJO — el panel de secciones era la ÚNICA forma de llegar a
   Consolidado y a Más: no hay barra inferior y las tarjetas de Inicio
   no los cubren. Quitando el botón sin más, esas pantallas quedaban
   sin camino. Así que el avatar pasa a abrir el panel completo:
   primero las secciones, después el perfil.
   --------------------------------------------------------------- */
(function menuFueraV48(){
  const m = $("btn-menu");
  if(m) m.remove();

  /* Se reemplaza el nodo para soltar el enganche anterior (abría en
     modo perfil) sin dejar dos escuchas peleando. */
  const a = $("btn-perfil");
  if(!a) return;
  const n = a.cloneNode(true);
  a.parentNode.replaceChild(n, a);
  n.setAttribute("aria-label", "Secciones y mi cuenta");
  n.addEventListener("click", ()=>{ modoDrawer = "menu"; abrirDrawer(); });
})();

const pintarDrawerV48 = pintarDrawer;
pintarDrawer = function(){
  pintarDrawerV48();
  if(modoDrawer !== "menu") return;

  const lista = $("dr-lista"), u = usuarioActual();
  if(!lista || !u || $("dr-perfil-v48")) return;

  /* Ya no hay dos sitios, así que sobra la aclaración de dónde está el perfil */
  const pie = $("dr-pie-perfil");
  if(pie) pie.remove();

  const sinLeer = noLeidas();
  const caja = document.createElement("div");
  caja.id = "dr-perfil-v48";
  caja.innerHTML =
    '<div class="sep"></div>' +
    '<button class="op" data-perfil48="info">' + ico("usuario", 21) + "Mi información</button>" +
    '<button class="op" data-perfil48="notif">' + ico("campana", 21) + "Notificaciones" +
      (sinLeer ? '<span class="glob">' + sinLeer + "</span>" : "") + "</button>" +
    '<button class="op" data-perfil48="foto">' + ico("camara", 21) + "Cambiar mi foto</button>" +
    '<div class="sep"></div>' +
    '<button class="op salir" data-perfil48="salir">' + ico("salir", 21) + "Cerrar sesión</button>";
  lista.appendChild(caja);

  $$("#dr-perfil-v48 [data-perfil48]").forEach(b => b.addEventListener("click", async ()=>{
    const q = b.dataset.perfil48;
    cerrarDrawer();
    if(q === "info")  return verPerfil();
    if(q === "notif") return ir("notificaciones");
    if(q === "foto")  { const f = $("pf-foto"); if(f) f.click(); return; }
    if(q === "salir" && await confirmar("Cerrar sesión",
        "Volverá a la pantalla de inicio de sesión.", "Cerrar sesión")) salir();
  }));
};

/* ---------------------------------------------------------------
   V49  El pedido como planilla: columnas, filas y un + para agregar

   Desde la V16 el requerimiento entraba SOLO por Excel. Para el que
   necesita tres cosas, bajar la plantilla, llenarla y subirla es un
   rodeo largo — y en obra, con el celular, a veces ni hay Excel.

   Ahora el pedido se ve y se escribe como la plantilla: las mismas
   columnas, una fila por material. El archivo sigue funcionando igual
   —lo que carga cae en estas mismas filas— y se puede corregir lo
   importado sin volver a subir nada.

   Las columnas son las que guarda cada línea: descripción, cantidad,
   unidad y observaciones. Obra, área, prioridad y fecha quedan arriba
   porque son del pedido entero, no de cada material: la propia
   importación las lee una sola vez, de la primera fila.
   --------------------------------------------------------------- */
(function estilosV49(){
  if($("estilos-v49")) return;
  const s = document.createElement("style");
  s.id = "estilos-v49";
  s.textContent =
    /* la tabla se desplaza sola: en un celular no entran cuatro columnas */
    ".tabla-req{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--borde);" +
      "border-radius:12px;background:var(--sup)}" +
    ".tabla-req table{border-collapse:collapse;width:100%;min-width:520px}" +
    ".tabla-req th{font-size:11px;font-weight:600;color:var(--tinta-sec);text-align:left;" +
      "text-transform:uppercase;letter-spacing:.03em;padding:9px 8px;background:var(--sup-var);" +
      "border-bottom:1px solid var(--borde);white-space:nowrap}" +
    ".tabla-req td{padding:5px 6px;border-bottom:1px solid var(--borde-suave,var(--borde))}" +
    ".tabla-req tr:last-child td{border-bottom:0}" +
    ".tabla-req input{width:100%;border:1px solid transparent;background:transparent;" +
      "padding:8px 7px;border-radius:8px;font:inherit;font-size:13.5px;color:inherit}" +
    ".tabla-req input:focus{border-color:var(--pri);background:var(--sup);outline:none}" +
    ".tabla-req .c-desc{min-width:170px}.tabla-req .c-obs{min-width:140px}" +
    ".tabla-req .c-cant{width:84px}.tabla-req .c-und{width:88px}" +
    ".tabla-req .c-quita{width:40px;text-align:center}" +
    ".tabla-req .quita-fila{border:0;background:transparent;color:var(--tinta-sec);" +
      "font-size:17px;line-height:1;cursor:pointer;padding:7px 6px;border-radius:8px}" +
    ".tabla-req .quita-fila:hover,.tabla-req .quita-fila:active{background:var(--mal-f,#fde8e8);color:var(--mal,#b42318)}" +
    ".tabla-req .sin-filas td{padding:20px 10px;text-align:center;color:var(--tinta-sec);font-size:13px}" +
    /* el + flota sobre el formulario, encima de la barra de botones */
    "#mr-fab{position:absolute;right:18px;bottom:84px;z-index:30;width:52px;height:52px;" +
      "border-radius:999px;border:0;background:var(--pri);color:var(--sobre-pri);" +
      "font-size:28px;line-height:1;cursor:pointer;box-shadow:0 6px 18px rgba(16,24,40,.28);" +
      "display:flex;align-items:center;justify-content:center;padding:0}" +
    "#mr-fab:active{transform:scale(.94)}";
  document.head.appendChild(s);
})();

const COLS_REQ_V49 = [
  {k:"desc",   t:"Descripción",    c:"c-desc", tipo:"text"},
  {k:"cant",   t:"Cantidad",       c:"c-cant", tipo:"number"},
  {k:"unidad", t:"Unidad",         c:"c-und",  tipo:"text"},
  {k:"obs",    t:"Observaciones",  c:"c-obs",  tipo:"text"}
];

function filaVaciaV49(){
  return {desc:"", cant:1, unidad:"und", obs:"", foto:null};
}

function pintarTablaReqV49(){
  const cont = $("mr-items");
  if(!cont) return;

  const cabecera = "<tr>" + COLS_REQ_V49.map(c => "<th>" + c.t + "</th>").join("") +
                   '<th class="c-quita"></th></tr>';

  const cuerpo = itemsReq.length
    ? itemsReq.map((it, i) => "<tr>" + COLS_REQ_V49.map(c =>
        '<td class="' + c.c + '"><input type="' + c.tipo + '"' +
        (c.tipo === "number" ? ' min="0.01" step="0.01" inputmode="decimal"' : "") +
        ' data-campo="' + c.k + '" data-fila="' + i + '" value="' + esc(String(it[c.k] === undefined ? "" : it[c.k])) + '"' +
        (c.k === "desc" ? ' placeholder="Qué material necesita"' : "") + "></td>").join("") +
        '<td class="c-quita"><button type="button" class="quita-fila" data-quitaritem="' + i +
        '" aria-label="Quitar esta línea" title="Quitar">✕</button></td></tr>').join("")
    : '<tr class="sin-filas"><td colspan="' + (COLS_REQ_V49.length + 1) + '">' +
      "Toque el + para agregar un material, o suba la plantilla.</td></tr>";

  cont.innerHTML = '<div class="tabla-req"><table><thead>' + cabecera +
                   "</thead><tbody>" + cuerpo + "</tbody></table></div>";

  /* Se escribe directo sobre el arreglo y NO se repinta: repintar en cada
     tecla le sacaría el foco al campo y el teclado del celular se cerraría. */
  $$("#mr-items input[data-campo]").forEach(inp => {
    inp.addEventListener("input", ()=>{
      const it = itemsReq[+inp.dataset.fila];
      if(!it) return;
      it[inp.dataset.campo] = inp.dataset.campo === "cant"
        ? Math.max(0.01, num(inp.value) || 0.01)
        : inp.value;
    });
  });

  $$("#mr-items [data-quitaritem]").forEach(b => b.addEventListener("click", ()=>{
    itemsReq.splice(+b.dataset.quitaritem, 1);
    pintarItemsReq();
  }));
}

const pintarItemsReqV49 = pintarItemsReq;
pintarItemsReq = function(){
  pintarItemsReqV49();      /* deja que corra el bloqueo del formulario */
  pintarTablaReqV49();      /* y encima va la planilla */
};

/* El + flotante: agrega una línea y deja el cursor en la descripción */
(function fabRequerimientoV49(){
  const modal = $("modal-requerimiento");
  if(!modal || $("mr-fab")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.id = "mr-fab";
  b.setAttribute("aria-label", "Agregar un material al pedido");
  b.title = "Agregar un material";
  b.textContent = "+";
  b.addEventListener("click", ()=>{
    itemsReq.push(filaVaciaV49());
    pintarItemsReq();
    const campos = $$('#mr-items input[data-campo="desc"]');
    const ultimo = campos[campos.length - 1];
    if(ultimo){ ultimo.focus(); ultimo.scrollIntoView({block:"center", behavior:"smooth"}); }
  });
  modal.appendChild(b);
  if(getComputedStyle(modal).position === "static") modal.style.position = "relative";
})();

/* Una línea sin descripción no es un material: no debe llegar al pedido. */
const registrarRequerimientoV49 = registrarRequerimiento;
registrarRequerimiento = function(){
  const antes = itemsReq.length;
  for(let i = itemsReq.length - 1; i >= 0; i--)
    if(!String(itemsReq[i].desc || "").trim()) itemsReq.splice(i, 1);
  if(antes !== itemsReq.length) pintarItemsReq();
  if(!itemsReq.length) return snack("Escriba al menos un material.", "err");
  return registrarRequerimientoV49.apply(this, arguments);
};

/* ---------------------------------------------------------------
   V50  El formulario, ordenado

   Pide lo mismo que antes —no se saca ningún dato— pero agrupado. Venía
   así: la tarjeta de quién solicita, el buscador de materiales, y
   después obra, área, prioridad y fecha sueltas, sin tarjeta ni título,
   flotando entre dos bloques que sí la tenían. Cuatro campos que son del
   pedido parecían no ser de nada.

   Queda en cuatro pasos, en el orden en que se llena:
     1. Suba su requerimiento   (la caja de la V47)
     2. Datos del pedido        quién pide, obra, área, prioridad, fecha
     3. Materiales              buscador y la planilla de la V49
     4. Adjuntos                foto, guía y justificación

   Se MUEVEN los nodos que ya están, no se vuelven a crear: los campos
   conservan su id y todo lo que quedó enganchado en las versiones
   anteriores sigue funcionando.
   --------------------------------------------------------------- */
(function ordenFormularioV50(){
  const cuerpo = document.querySelector("#modal-requerimiento .cuerpo");
  if(!cuerpo || $("estilos-v50")) return;

  const s = document.createElement("style");
  s.id = "estilos-v50";
  s.textContent =
    "#modal-requerimiento .sech-v50{font-size:11.5px;font-weight:700;letter-spacing:.04em;" +
      "text-transform:uppercase;color:var(--tinta-sec);margin:18px 0 7px;display:flex;" +
      "align-items:center;gap:7px}" +
    "#modal-requerimiento .sech-v50 .n{width:19px;height:19px;border-radius:999px;" +
      "background:var(--pri-cont);color:var(--pri);font-size:11px;display:flex;" +
      "align-items:center;justify-content:center;flex:0 0 auto}" +
    "#modal-requerimiento .caja-v50{background:var(--sup);border:1px solid var(--borde);" +
      "border-radius:14px;padding:12px}" +
    "#modal-requerimiento .caja-v50 > * + *{margin-top:11px}" +
    /* la fila de quién solicita pierde su tarjeta: ya vive dentro de una */
    "#modal-requerimiento .solicita-v50{background:var(--pri-cont);border-radius:10px;padding:10px}";
  document.head.appendChild(s);

  /* Cada paso es UN elemento con su título adentro. Así, para acomodarlos
     en pantalla grande, basta con mover la sección: no hay que adivinar
     qué div es cuál. */
  const seccion = (n, titulo, nodos) => {
    const sec = document.createElement("section");
    sec.className = "paso-v50";
    sec.dataset.paso = n;
    const h = document.createElement("div");
    h.className = "sech-v50";
    h.innerHTML = '<span class="n">' + n + "</span>" + esc(titulo);
    const caja = document.createElement("div");
    caja.className = "caja-v50";
    nodos.forEach(x => { if(x) caja.appendChild(x); });
    sec.appendChild(h);
    sec.appendChild(caja);
    cuerpo.appendChild(sec);
  };

  /* Se toman las piezas ANTES de mover nada, que al mover cambian de sitio */
  const excel     = $("mr-excel");
  const aviso     = $("mr-aviso-bloqueo");
  const solicita  = cuerpo.querySelector(".card.acento");
  const catalogo  = $("mr-catalogo");
  const items     = $("mr-items");
  const dos       = [...cuerpo.querySelectorAll(":scope > .dos")];
  const adjuntos  = [...cuerpo.querySelectorAll(":scope > .campo")];
  const sechVieja = [...cuerpo.querySelectorAll(":scope > .sech")];

  if(!excel || !items) return;

  sechVieja.forEach(x => x.remove());
  if(solicita){ solicita.classList.remove("card", "acento"); solicita.classList.add("solicita-v50"); }
  if(catalogo)  catalogo.classList.remove("card");

  /* 1 · la caja de subida, sola arriba y sin tarjeta alrededor */
  cuerpo.appendChild(excel);
  if(aviso) cuerpo.appendChild(aviso);

  /* La caja de subida va suelta arriba: es el atajo, no un paso más.
     Los pasos numerados son los tres que siempre hay que llenar. */
  seccion(1, "Datos del pedido", [solicita].concat(dos));
  seccion(2, "Materiales", [catalogo, items]);
  seccion(3, "Adjuntos", adjuntos);
})();

/* ---------------------------------------------------------------
   V51  Celular, tablet o computadora

   La Administradora de Obra trabaja en computadora, no en celular. La
   app estaba clavada en 460 px de ancho: en una laptop quedaba una tira
   angosta en el medio con dos franjas grises a los costados.

   Qué NO se hace: agrandar letras ni íconos. En pantalla grande el
   tamaño de la letra no tiene por qué crecer —se lee igual y queda
   ridículo—. Lo que cambia es cuánto entra a lo ancho y cómo se reparte.

   CÓMO SE DETECTA. No se mira el "user agent": esa cadena miente
   —Chrome dice ser Safari, el iPad dice ser Mac— y cada modelo nuevo que
   sale rompe la lista. Se mira lo único que importa de verdad:

     · si hay un mouse de por medio   → (any-pointer: fine)
     · si la pantalla se toca         → maxTouchPoints / (any-pointer: coarse)
     · cuánto mide la ventana

   Con eso entran bien todos: iPhone y Android (se tocan, angostos) van
   de celular; iPad va de tablet, y si le enchufan teclado y mouse pasa a
   computadora, que es lo correcto; Mac, PC y laptops van de computadora;
   y una laptop con pantalla táctil también, porque tiene mouse. Además
   se vuelve a mirar al cambiar el tamaño de la ventana o al girar el
   equipo, así que achicar el navegador en la laptop devuelve la vista
   angosta sin recargar.
   --------------------------------------------------------------- */
(function equipoV51(){
  if($("estilos-v51")) return;

  function medir(){
    const mq = q => window.matchMedia && window.matchMedia(q).matches;
    const hayMouse  = mq("(any-pointer: fine)") || mq("(any-hover: hover)");
    const seToca    = (navigator.maxTouchPoints || 0) > 0 || mq("(any-pointer: coarse)");
    const ancho     = window.innerWidth || document.documentElement.clientWidth;

    /* Manda el ancho, y el mouse desempata: una ventana angosta en la
       laptop se trabaja como celular, que es lo que el usuario ve. */
    let tipo;
    if(ancho >= 980 && hayMouse) tipo = "computadora";
    else if(ancho >= 700)        tipo = "tablet";
    else                         tipo = "celular";

    return {tipo, ancho, hayMouse, seToca};
  }

  function aplicar(){
    const e = medir();
    const raiz = document.documentElement;
    ["celular","tablet","computadora"].forEach(t =>
      raiz.classList.toggle("equipo-" + t, t === e.tipo));
    raiz.classList.toggle("con-mouse", e.hayMouse);
    raiz.classList.toggle("tactil", e.seToca);
    window.ALM_EQUIPO = e;
    return e;
  }

  const s = document.createElement("style");
  s.id = "estilos-v51";
  s.textContent =
    /* ── Computadora: más ancho, MISMO tamaño de letra e íconos ── */
    "html.equipo-computadora .app{max-width:1180px}" +
    "html.equipo-computadora .modal .cuerpo{max-width:1040px}" +
    "html.equipo-computadora .modal .pie-modal{max-width:1040px;margin:0 auto;width:100%}" +

    /* Las tarjetas de tareas dejan de ser una columna larga */
    "html.equipo-computadora .tareas.rejilla{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}" +
    "html.equipo-computadora .metricas{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}" +

    /* Los pares de campos se reparten de a cuatro, no de a dos */
    "html.equipo-computadora .modal .cuerpo .dos{grid-template-columns:repeat(4,1fr)}" +

    /* El requerimiento en dos columnas: los datos y los adjuntos a un
       lado, la planilla al otro, que es la que pide espacio. */
    "html.equipo-computadora #modal-requerimiento .cuerpo{display:grid;" +
      "grid-template-columns:minmax(320px,7fr) minmax(380px,9fr);" +
      "grid-column-gap:24px;align-content:start}" +
    /* la caja de subida cruza las dos columnas */
    "html.equipo-computadora #modal-requerimiento .cuerpo > #mr-excel," +
    "html.equipo-computadora #modal-requerimiento .cuerpo > #mr-aviso-bloqueo{grid-column:1/-1}" +
    /* izquierda los datos y los adjuntos, derecha la planilla */
    'html.equipo-computadora #modal-requerimiento [data-paso="1"]{grid-column:1;grid-row:3}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="3"]{grid-column:1;grid-row:4}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="2"]{grid-column:2;grid-row:3/span 2}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="2"] .sech-v50{margin-top:18px}' +
    "html.equipo-computadora #modal-requerimiento .cuerpo .dos{grid-template-columns:repeat(2,1fr)}" +
    "html.equipo-computadora #mr-fab{bottom:100px;right:28px}" +

    /* Con mouse, el cursor tiene que decir qué se puede tocar */
    "html.con-mouse .tarea,html.con-mouse .op,html.con-mouse .fila{cursor:pointer}" +

    /* ── Tablet: un ancho intermedio, sin partir en dos ── */
    "html.equipo-tablet .app{max-width:820px}" +
    "html.equipo-tablet .modal .cuerpo{max-width:760px}" +
    "html.equipo-tablet .tareas.rejilla{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}";
  document.head.appendChild(s);

  aplicar();

  /* Se vuelve a mirar al cambiar la ventana o girar el equipo. Con una
     espera corta para no recalcular en cada píxel del arrastre. */
  let reloj = null;
  const revisar = ()=>{ clearTimeout(reloj); reloj = setTimeout(aplicar, 150); };
  window.addEventListener("resize", revisar);
  window.addEventListener("orientationchange", revisar);
})();

/* ---------------------------------------------------------------
   V52  Arriba va el trabajo, no el saludo

   La tarjeta del saludo ocupaba lo mejor de la primera pantalla para
   decir el nombre y el cargo, que desde la V48 están en la barra de
   arriba —visibles desde cualquier pantalla, no solo en Inicio—. El
   botón de cambiar de cargo también subió ahí.

   En ese lugar ahora van las dos cosas que se miran al abrir la app: el
   resumen logístico y el avance del consolidado. Estaban al fondo, hay
   que bajar toda la pantalla para verlos.

   Se los deja planos: sin sombra, sin bloques de color rellenos, los
   números grandes y una línea fina separando. El color queda solo donde
   avisa algo —por comprar, stock crítico—, que es para lo que sirve.

   La tarjeta del saludo se esconde, no se borra: `pintarInicio` le
   escribe adentro en cada repintado y quitarla reventaría el Inicio.
   --------------------------------------------------------------- */
(function estilosV52(){
  if($("estilos-v52")) return;
  const s = document.createElement("style");
  s.id = "estilos-v52";
  s.textContent =
    "#ini-saludo{display:none!important}" +

    "#ini-cabecera-v52{display:grid;gap:10px;margin:0 0 16px}" +
    "html.equipo-computadora #ini-cabecera-v52," +
    "html.equipo-tablet #ini-cabecera-v52{grid-template-columns:1fr 1fr;align-items:stretch}" +
    "#ini-cabecera-v52 > *{margin:0!important}" +

    /* resumen logístico, plano */
    "#ini-cabecera-v52 #ini-resumen{padding:15px 16px;border:1px solid var(--borde);" +
      "box-shadow:none;display:flex;flex-direction:column;justify-content:space-between}" +
    "#ini-cabecera-v52 #ini-resumen .cab{margin-bottom:13px}" +
    "#ini-cabecera-v52 #ini-resumen .cifras{gap:0}" +
    "#ini-cabecera-v52 #ini-resumen .cifra{background:transparent!important;padding:2px 4px}" +
    "#ini-cabecera-v52 #ini-resumen .cifra + .cifra{border-left:1px solid var(--borde)}" +
    "#ini-cabecera-v52 #ini-resumen .cifra b{font-size:23px;font-weight:600;line-height:1.1}" +
    "#ini-cabecera-v52 #ini-resumen .cifra small{font-size:10.5px;font-weight:500;color:var(--tinta-sec)!important}" +

    /* consolidado, mismo peso visual y anillo más chico */
    "#ini-cabecera-v52 #ini-consolidado{padding:15px 16px;border:1px solid var(--borde);" +
      "box-shadow:none;gap:14px!important}" +
    "#ini-cabecera-v52 #ini-consolidado svg[role=img]{width:60px!important;height:60px!important}";
  document.head.appendChild(s);
})();

function cabeceraInicioV52(){
  const scr = $("scr-inicio"), saludo = $("ini-saludo");
  const resumen = $("ini-resumen"), consolidado = $("ini-consolidado");
  if(!scr || (!resumen && !consolidado)) return;

  let caja = $("ini-cabecera-v52");
  if(!caja){
    caja = document.createElement("div");
    caja.id = "ini-cabecera-v52";
    /* justo donde estaba el saludo, que es lo primero de la pantalla */
    if(saludo) saludo.insertAdjacentElement("afterend", caja);
    else scr.insertBefore(caja, scr.firstElementChild);
  }
  /* Se reacomodan en cada repintado porque los dos se crean tarde, cuando
     el cargo ya se sabe: hasta ese momento puede no existir ninguno. */
  if(resumen && resumen.parentElement !== caja) caja.appendChild(resumen);
  if(consolidado && consolidado.parentElement !== caja) caja.appendChild(consolidado);
}

const pintarInicioV52 = pintarInicio;
pintarInicio = function(){ pintarInicioV52(); cabeceraInicioV52(); };

/* El botón de cambiar de cargo vivía dentro de la tarjeta escondida; el
   de la barra hace lo mismo y sí se ve. */
const botonSimularEnSaludoV52 = botonSimularEnSaludo;
botonSimularEnSaludo = function(){
  botonSimularEnSaludoV52.apply(this, arguments);
  const b = $("btn-simular-saludo");
  if(b) b.remove();
};

/* ---------------------------------------------------------------
   V53  Un solo "Salir de la simulación"

   Estaba en tres sitios a la vez: el aviso amarillo de arriba, el panel
   lateral, y además un mosaico entre las tareas del cargo. El mosaico es
   el que sobra —ocupa el lugar de una tarea de verdad y, siendo el único
   de color, se lee como si fuera lo más importante de la pantalla.

   Se quita solo el mosaico. La salida sigue donde se la busca: en el
   propio aviso que dice que se está simulando (`#sim-salir`).

   Se filtra acá, al final, porque el mosaico lo agregan cuatro bloques
   distintos (V9.2 y las tres listas de tareas posteriores) y así no hay
   que acordarse de ninguno.
   --------------------------------------------------------------- */
const tareasDelCargoV53 = tareasDelCargo;
tareasDelCargo = function(){
  return tareasDelCargoV53.apply(this, arguments)
    .filter(x => !x || String(x.t || "").indexOf("Salir de la simulación") !== 0);
};

/* ---------------------------------------------------------------
   V54  La plantilla es el formato oficial de la obra

   Hasta ahora el botón "Descargar plantilla" armaba un Excel de cuatro
   columnas inventado por la app. El formato de verdad —el que firma
   Logística— tiene cabecera con obra, número, área, supervisor y las dos
   fechas, y la tabla lleva N°, DESCRIPCIÓN, UND, CANTIDAD (solicitada,
   entrega parcial y entrega total), SOLICITANTE, LUGAR/FRENTE,
   AUTORIZADO y OBSERVACIONES.

   Ese archivo vive en el storage, en `formatos/`. Se baja de ahí y no
   del código: si mañana cambia el formato, se reemplaza el archivo y
   todos los equipos bajan el nuevo sin tocar la app ni volver a
   desplegar nada.

   Tres intentos, en este orden:
     1. el storage        — el bueno, el que puede cambiar
     2. la copia del repo — si no hay señal (el service worker la guarda)
     3. el armado a mano  — último recurso, para no dejar a nadie sin nada
   --------------------------------------------------------------- */
const FORMATO_REQ_V54 =
  "https://lotfscfgkgsnqwwnftoo.supabase.co/storage/v1/object/public/almacen-fotos/formatos/requerimiento.xlsx";
const FORMATO_REQ_LOCAL_V54 = "formatos/FORMATO%20DE%20REQUERIMIENTO.xlsx";

const plantillaRequerimientoV54 = plantillaRequerimiento;
plantillaRequerimiento = async function(){
  for(const url of [FORMATO_REQ_V54, FORMATO_REQ_LOCAL_V54]){
    try{
      const r = await fetch(url, {cache:"no-store"});
      if(!r.ok) continue;
      const blob = await r.blob();
      if(blob.size < 1000) continue;   /* llegó una página de error, no el archivo */
      descargarBlob("FORMATO DE REQUERIMIENTO.xlsx", blob);
      snack("Formato descargado. Llénelo y súbalo.", "ok");
      return;
    }catch(e){ /* se prueba el siguiente */ }
  }
  snack("Sin señal: se descarga la plantilla simple.", "");
  return plantillaRequerimientoV54.apply(this, arguments);
};

/* ---------------------------------------------------------------
   V55  Las columnas del pedido, las del formato oficial

   La planilla de la V49 tenía las cuatro columnas que la app ya
   guardaba. El formato oficial pide dos más por línea: quién solicita
   ese material y a qué lugar o frente va. Sin esas dos, al almacenero le
   llega un pedido de veinte líneas sin saber para quién es cada una.

   Las que NO se ponen acá y están en el formato —entrega parcial,
   entrega total y autorizado— son de después: las llena el almacén al
   despachar y Logística al aprobar. En el momento de pedir están vacías
   siempre, y una columna que nadie llena solo estorba.
   --------------------------------------------------------------- */
COLS_REQ_V49.splice(0, COLS_REQ_V49.length,
  {k:"desc",        t:"Descripción",   c:"c-desc", tipo:"text"},
  {k:"cant",        t:"Cantidad",      c:"c-cant", tipo:"number"},
  {k:"unidad",      t:"Und.",          c:"c-und",  tipo:"text"},
  {k:"solicitante", t:"Solicitante",   c:"c-sol",  tipo:"text"},
  {k:"lugar",       t:"Lugar / frente",c:"c-lug",  tipo:"text"},
  {k:"obs",         t:"Observaciones", c:"c-obs",  tipo:"text"}
);

(function estilosColumnasV55(){
  if($("estilos-v55")) return;
  const s = document.createElement("style");
  s.id = "estilos-v55";
  s.textContent =
    ".tabla-req table{min-width:760px}" +
    ".tabla-req .c-sol{min-width:130px}.tabla-req .c-lug{min-width:130px}";
  document.head.appendChild(s);
})();

/* Una línea nueva hereda quién pide y a dónde va: en un pedido de veinte
   materiales casi siempre son los mismos, y escribirlos veinte veces en
   el celular es lo que hace que la gente no los llene. */
const filaVaciaV55 = filaVaciaV49;
filaVaciaV49 = function(){
  const base = filaVaciaV55();
  const u = usuarioActual();
  const ultima = itemsReq[itemsReq.length - 1];
  base.solicitante = (ultima && ultima.solicitante) || (u ? u.nombre : "");
  base.lugar = (ultima && ultima.lugar) || "";
  return base;
};

/* ---------------------------------------------------------------
   V56  Un cajón detrás, en pastel sobrio

   Estaba todo blanco sobre casi blanco: las tarjetas no se despegaban
   del fondo y la pantalla se leía como una sola mancha. El fondo en sí
   estaba bien, lo que faltaba era que cada cosa se apoyara en algo.

   Se le pone un cajón detrás —un azul grisáceo muy bajo, del mismo tono
   de la app— y las tarjetas quedan blancas encima, con una línea fina.
   Sobrio a propósito: en obra la pantalla se mira a pleno sol y los
   colores fuertes cansan.
   --------------------------------------------------------------- */
(function estilosV56(){
  if($("estilos-v56")) return;
  const s = document.createElement("style");
  s.id = "estilos-v56";
  s.textContent =
    ":root{--cajon:#E8EDF5;--cajon-borde:#D5DEEC;--cajon-hondo:#DFE6F1}" +

    /* el cajón: la zona donde se trabaja deja de ser blanca */
    ".app main{background:var(--cajon)}" +
    "#drawer{background:var(--cajon)}" +

    /* y lo que va encima se despega, con línea fina en vez de sombra */
    ".app main .card,.app main .tarea,.app main .caja-v50,.app main .tabla-req," +
    ".app main #ini-resumen,.app main #ini-consolidado," +
    ".app main .fila,.app main .vacio{border:1px solid var(--cajon-borde)}" +

    /* los bloques que agrupan van un tono más hondo que el cajón */
    ".app main .caja-v50{background:var(--sup)}" +
    ".app main .sech,.app main .sech-v50{color:var(--tinta-sec)}" +

    /* la banda de simulación y las tarjetas de color no se tocan */
    ".app main .tarea.destacada,.app main .card.acento{border-color:transparent}" +

    /* en la tabla del pedido, la cabecera un punto más marcada */
    ".tabla-req th{background:var(--cajon-hondo)}";
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   V57  En computadora, las secciones a la izquierda

   En el celular se entra a cada sección por el panel que abre el avatar
   y se vuelve con la flecha. En una laptop eso es un paso de más: hay
   sitio de sobra para tener las secciones siempre a la vista.

   Se arma una barra a la izquierda con los mismos destinos del panel
   —misma lista `MENU`, mismos permisos— y al tocar uno cambia solo el
   contenido: la barra se queda, marcando dónde está parado. En celular
   y tablet no aparece: ahí el panel sigue siendo lo correcto.
   --------------------------------------------------------------- */
(function estilosLateralV57(){
  if($("estilos-v57")) return;
  const s = document.createElement("style");
  s.id = "estilos-v57";
  s.textContent =
    "#lateral-v57{display:none}" +
    "html.equipo-computadora .app{display:grid;grid-template-columns:238px 1fr;" +
      "grid-template-rows:auto auto 1fr}" +
    "html.equipo-computadora .app > #appbar,html.equipo-computadora .app > .simbanda{grid-column:1/-1}" +
    "html.equipo-computadora .app > main{grid-column:2;grid-row:3;min-width:0}" +
    "html.equipo-computadora #lateral-v57{display:block;grid-column:1;grid-row:3;" +
      "overflow-y:auto;padding:12px 10px;background:var(--sup);" +
      "border-right:1px solid var(--cajon-borde)}" +
    "#lateral-v57 .op-lat{width:100%;display:flex;align-items:center;gap:11px;padding:10px 12px;" +
      "border:0;background:transparent;border-radius:10px;font:inherit;font-size:14px;" +
      "color:var(--tinta);text-align:left;cursor:pointer;margin-bottom:2px}" +
    "#lateral-v57 .op-lat:hover{background:var(--cajon)}" +
    "#lateral-v57 .op-lat.on{background:var(--pri-cont);color:var(--pri);font-weight:600}" +
    "#lateral-v57 .op-lat svg{flex:0 0 auto}" +
    "#lateral-v57 .op-lat .glob{margin-left:auto;background:var(--mal,#b42318);color:#fff;" +
      "font-size:10.5px;font-weight:700;border-radius:999px;padding:1px 6px}";
  document.head.appendChild(s);
})();

function pintarLateralV57(){
  const app = document.querySelector(".app");
  if(!app || typeof MENU === "undefined") return;

  let nav = $("lateral-v57");
  if(!nav){
    nav = document.createElement("nav");
    nav.id = "lateral-v57";
    nav.setAttribute("aria-label", "Secciones");
    app.insertBefore(nav, app.querySelector("main"));
  }
  if(!sesion || !usuarioActual()){ nav.innerHTML = ""; return; }

  const sinLeer = noLeidas();
  let html = "";
  MENU.forEach(k => {
    if(k !== "mas" && PANTALLAS[k].perm && !puede(PANTALLAS[k].perm)) return;
    html += '<button type="button" class="op-lat' + (pantalla === k ? " on" : "") +
      '" data-ir-lat="' + k + '">' + ico(PANTALLAS[k].icono, 20) +
      "<span>" + esc(PANTALLAS[k].titulo) + "</span></button>";
  });
  html += '<button type="button" class="op-lat' + (pantalla === "notificaciones" ? " on" : "") +
    '" data-ir-lat="notificaciones">' + ico("campana", 20) + "<span>Notificaciones</span>" +
    (sinLeer ? '<span class="glob">' + sinLeer + "</span>" : "") + "</button>";

  nav.innerHTML = html;
  $$("#lateral-v57 [data-ir-lat]").forEach(b =>
    b.addEventListener("click", ()=> ir(b.dataset.irLat)));
}

/* Se repinta al cambiar de pantalla —para que se marque dónde está— y al
   cambiar de cargo, que cambia qué secciones se pueden ver. */
const irV57 = ir;
ir = function(){ const r = irV57.apply(this, arguments); pintarLateralV57(); return r; };

const aplicarRolV57 = aplicarRol;
aplicarRol = function(){ aplicarRolV57.apply(this, arguments); pintarLateralV57(); };

const pintarBadgeV57 = pintarBadge;
pintarBadge = function(){ pintarBadgeV57.apply(this, arguments); pintarLateralV57(); };

/* ---------------------------------------------------------------
   V58  La actividad arriba, todo en una línea

   Actividad reciente, resumen logístico y consolidado son las tres cosas
   que se miran al abrir: cómo viene el día. Estaban repartidas, una
   arriba y dos al fondo. Ahora van juntas en la primera línea.

   En computadora entran las tres a lo ancho. En el celular no entran
   —serían tres columnas de 110 px— así que se apilan, que es lo que
   corresponde: la regla es "una línea si hay sitio", no "una línea
   siempre".
   --------------------------------------------------------------- */
(function estilosV58(){
  if($("estilos-v58")) return;
  const s = document.createElement("style");
  s.id = "estilos-v58";
  s.textContent =
    "html.equipo-computadora #ini-cabecera-v52{grid-template-columns:1.15fr 1fr 1fr;align-items:stretch}" +
    "html.equipo-tablet #ini-cabecera-v52{grid-template-columns:1fr 1fr}" +
    "#ini-cabecera-v52 #ini-actividad{margin:0}" +
    "#scr-inicio .sech.sech-huerfana-v61{display:none}" +
    "#ini-cabecera-v52 #ini-actividad .fila,#ini-cabecera-v52 #ini-actividad .card{height:100%;margin:0}";
  document.head.appendChild(s);
})();

const cabeceraInicioV58 = cabeceraInicioV52;
cabeceraInicioV52 = function(){
  cabeceraInicioV58.apply(this, arguments);
  const caja = $("ini-cabecera-v52"), act = $("ini-actividad");
  if(caja && act && act.parentElement !== caja){
    /* Al mudarla, el título "ACTIVIDAD" que la encabezaba se queda solo
       más abajo. Se marca ANTES de mover, que después ya no es su
       hermano y no hay cómo encontrarlo. */
    const titulo = act.previousElementSibling;
    if(titulo && titulo.classList.contains("sech")) titulo.classList.add("sech-huerfana-v61");
    /* la actividad va primera: es la que dice si pasó algo */
    caja.insertBefore(act, caja.firstElementChild);
  }
};

/* ---------------------------------------------------------------
   V59  Los accesos, dentro del menú que ya está desplegado

   En computadora el menú de la izquierda está siempre a la vista, así
   que tener además una rejilla de mosaicos en el medio de la pantalla es
   decir dos veces lo mismo y ocupar el lugar de la información.

   Los accesos del cargo pasan al menú, debajo de las secciones. Y se
   sacan los que repetían algo que ya estaba arriba: el mosaico
   "Inventario" contra la sección Inventario, "Consolidado" contra
   Consolidado de obra. Lo que NO se junta, aunque suene parecido:

     · "Requerimiento" crea uno nuevo; "Pedidos" es la lista de todos.
     · "Reporte" es el cierre del día; "Revisar" son los pedidos que
       esperan su visto bueno.
     · "Indicadores" son tiempos de atención; "Consolidado de obra" es el
       avance de materiales.

   Cada uno hace algo distinto: juntarlos sería perder una función, no
   ahorrar un botón.
   --------------------------------------------------------------- */
function sinTildesV59(t){
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const pintarLateralV59 = pintarLateralV57;
pintarLateralV57 = function(){
  pintarLateralV59.apply(this, arguments);
  const nav = $("lateral-v57");
  if(!nav || !nav.children.length || typeof tareasDelCargo !== "function") return;

  /* Lo que ya está en el menú no se repite abajo */
  const yaEstan = [...nav.querySelectorAll(".op-lat span:first-of-type")]
    .map(s => sinTildesV59(s.textContent));

  /* "Consultar inventario" y la sección "Inventario" son lo mismo con un
     verbo delante. Se le saca el verbo y se compara: si lo que queda es
     una sección, el acceso sobra. Lo que NO queda igual al sacarlo
     —"Revisar pedidos de los supervisores", "Ver avance e indicadores"—
     se queda, porque lleva a otro lado. */
  const sinVerbo = t => sinTildesV59(t)
    .replace(/^(consultar|ver|ir a|abrir|entrar a|mostrar)\s+/, "")
    .replace(/^(el|la|los|las|un|una)\s+/, "");

  const tareas = tareasDelCargo().filter(t => {
    const n = sinTildesV59(t.t), s = sinVerbo(t.t);
    return !yaEstan.some(y => y === n || y === s);
  });
  if(!tareas.length) return;

  const sep = document.createElement("div");
  sep.className = "sep-lat";
  nav.appendChild(sep);

  tareas.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "op-lat accion";
    b.innerHTML = ico(t.ic || "flecha", 20) + "<span>" + esc(t.t) + "</span>";
    if(t.d) b.title = t.d;
    b.addEventListener("click", ()=> { if(typeof t.fn === "function") t.fn(); });
    nav.appendChild(b);
  });
};

(function estilosV59(){
  if($("estilos-v59")) return;
  const s = document.createElement("style");
  s.id = "estilos-v59";
  s.textContent =
    "#lateral-v57 .sep-lat{height:1px;background:var(--cajon-borde);margin:9px 8px}" +
    "#lateral-v57 .op-lat.accion{color:var(--tinta-sec)}" +
    "#lateral-v57 .op-lat.accion:hover{color:var(--tinta)}" +
    /* con el menú desplegado, los mosaicos del medio sobran */
    "html.equipo-computadora #ini-accesos,html.equipo-computadora #ini-accesos + .sech," +
    "html.equipo-computadora .sech.accesos-v59{display:none}";
  document.head.appendChild(s);
})();

/* El título "MIS TAREAS" queda huérfano al esconder la rejilla */
const pintarInicioV59 = pintarInicio;
pintarInicio = function(){
  pintarInicioV59.apply(this, arguments);
  const rejilla = $("ini-accesos");
  const titulo = rejilla && rejilla.previousElementSibling;
  if(titulo && titulo.classList.contains("sech")) titulo.classList.add("accesos-v59");
};

/* ---------------------------------------------------------------
   V60  En qué anda la compra

   Entre "aprobado" y "recibido" pasaban semanas en las que el pedido no
   decía nada. El solicitante llamaba a Logística para preguntar, y
   Logística lo anotaba aparte. Ahora se marca en el propio pedido:

     Comprado · En fabricación · Empaquetando · Enviado · Otro

   "Otro" pide escribir qué pasa —"esperando el flete de Lima", "el
   proveedor cambió el modelo"— porque la obra siempre tiene un caso que
   no entra en cuatro casillas, y si no hay dónde escribirlo se anota en
   un cuaderno que nadie más ve.

   Cada marca queda en el historial del pedido con quién y cuándo, y le
   llega un aviso al que lo pidió: de eso se trata, de que no tenga que
   llamar para saber.
   --------------------------------------------------------------- */
Object.assign(ESTADOS, {
  comprado:     {texto:"Comprado",       chip:"ok"},
  fabricacion:  {texto:"En fabricación", chip:"alerta"},
  empaquetando: {texto:"Empaquetando",   chip:"alerta"},
  enviado:      {texto:"Enviado",        chip:"lila"},
  otro:         {texto:"Otro",           chip:"info"}
});

/* Siguen contando como "en curso": el pedido no terminó hasta que llega */
["comprado","fabricacion","empaquetando","enviado","otro"].forEach(e => {
  if(ABIERTOS.indexOf(e) < 0) ABIERTOS.push(e);
});

const AVANCE_V60 = [
  {e:"comprado",     ic:"carrito",  t:"Comprado",       d:"Ya se compró; falta que llegue"},
  {e:"fabricacion",  ic:"llave",    t:"En fabricación", d:"El proveedor lo está fabricando"},
  {e:"empaquetando", ic:"caja",     t:"Empaquetando",   d:"Se está preparando para el envío"},
  {e:"enviado",      ic:"camion",   t:"Enviado",        d:"Va en camino a la obra"},
  {e:"otro",         ic:"editar",   t:"Otro",           d:"Escribir en qué anda"}
];

/* El texto libre de "Otro" se guarda aparte del estado, para que el chip
   siga siendo un estado conocido y el detalle se lea debajo. */
function marcarAvanceV60(id, estado){
  const r = db.requerimientos.find(x => x.id === id);
  if(!r) return;

  const aplicar = (nota)=>{
    historia(r, estado, nota || "");
    r.avanceNota = estado === "otro" ? (nota || "") : "";
    log("pedidos", "Avance de compra: " + ESTADOS[estado].texto, r.codigo + (nota ? " · " + nota : ""), r.id);
    notificar({usuarios:[r.solicitanteId], titulo:"Su pedido: " + ESTADOS[estado].texto + " · " + r.codigo,
      cuerpo:(nota ? nota + "\n" : "") + "Marcado por " + usuarioActual().nombre + ".",
      refTipo:"requerimiento", refId:r.id});
    if(!guardar()) return;
    snack("Pedido marcado como " + ESTADOS[estado].texto.toLowerCase() + ".", "ok");
    cerrarHoja();
    refrescar(pantalla);
  };

  if(estado !== "otro") return aplicar("");
  pedirTexto("¿En qué anda el pedido?", "Por ejemplo: esperando el flete de Lima")
    .then(txt => { if(txt != null && String(txt).trim()) aplicar(String(txt).trim()); });
}

/* Se agrega al final de la hoja de detalle, que ya la arma `detalleReq` */
const detalleReqV60 = detalleReq;
detalleReq = function(id){
  detalleReqV60.apply(this, arguments);

  const r = db.requerimientos.find(x => x.id === id);
  const cuerpo = $("hoja-cuerpo");
  if(!r || !cuerpo || cuerpo.querySelector(".avance-v60")) return;

  /* Solo lo marca quien maneja la compra */
  if(!puede("compras") && !puede("pedidos.aprobar")) return;
  /* Y solo mientras el pedido siga vivo */
  if(CERRADOS.indexOf(r.estado) >= 0) return;

  const caja = document.createElement("div");
  caja.className = "avance-v60";
  caja.innerHTML =
    '<div class="sech" style="margin:16px 0 8px">En qué anda la compra</div>' +
    (r.avanceNota ? '<p class="ayuda" style="margin:0 0 9px">Ahora: ' + esc(r.avanceNota) + "</p>" : "") +
    '<div class="avance-ops">' + AVANCE_V60.map(o =>
      '<button type="button" class="avance-op' + (r.estado === o.e ? " on" : "") +
      '" data-avance="' + o.e + '" title="' + esc(o.d) + '">' +
      ico(o.ic, 19) + "<span>" + esc(o.t) + "</span></button>").join("") + "</div>";
  cuerpo.appendChild(caja);

  cuerpo.querySelectorAll("[data-avance]").forEach(b =>
    b.addEventListener("click", ()=> marcarAvanceV60(id, b.dataset.avance)));
};

(function estilosV60(){
  if($("estilos-v60")) return;
  const s = document.createElement("style");
  s.id = "estilos-v60";
  s.textContent =
    ".avance-ops{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px}" +
    ".avance-op{display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:10px;" +
      "border:1px solid var(--cajon-borde);background:var(--sup);font:inherit;font-size:13px;" +
      "color:var(--tinta);cursor:pointer;text-align:left}" +
    ".avance-op:active{transform:scale(.98)}" +
    ".avance-op.on{background:var(--pri-cont);border-color:var(--pri);color:var(--pri);font-weight:600}" +
    ".avance-op svg{flex:0 0 auto}";
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   V61  La actividad, solo el reloj

   Ocupaba un tercio de la primera línea para decir "100 registros ·
   último hace 6 min". El número importa de reojo; el detalle, solo
   cuando alguien lo va a mirar.

   Queda el reloj con la cantidad encima, del ancho de un botón. Al
   tocarlo se abre la lista completa, que es donde el detalle sirve.

   Se le esconde el texto al botón que ya existía en vez de armar uno
   nuevo: así el clic sigue yendo a donde iba, sin volver a engancharlo.
   --------------------------------------------------------------- */
(function estilosV61(){
  if($("estilos-v61")) return;
  const s = document.createElement("style");
  s.id = "estilos-v61";
  s.textContent =
    /* el reloj toma lo que necesita; el resto de la línea se reparte */
    "html.equipo-computadora #ini-cabecera-v52{grid-template-columns:auto 1fr 1fr}" +
    "html.equipo-computadora #ini-cabecera-v52.sin-actividad," +
    "html.equipo-tablet #ini-cabecera-v52.sin-actividad{grid-template-columns:1fr 1fr}" +
    "html.equipo-tablet #ini-cabecera-v52{grid-template-columns:auto 1fr}" +

    "#ini-cabecera-v52 #ini-actividad .fila{width:auto;height:100%;padding:14px;gap:0;" +
      "justify-content:center;align-items:center}" +
    "#ini-cabecera-v52 #ini-actividad .fila .txt," +
    "#ini-cabecera-v52 #ini-actividad .fila .der{display:none}" +
    "#ini-cabecera-v52 #ini-actividad .fila{position:relative}" +
    "#ini-cabecera-v52 #ini-actividad .fila .mini{margin:0}" +
    "#ini-cabecera-v52 #ini-actividad .cuenta-v61{position:absolute;top:6px;right:6px;" +
      "min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--pri);" +
      "color:var(--sobre-pri);font-size:10.5px;font-weight:700;line-height:19px;text-align:center;" +
      "box-shadow:0 0 0 2px var(--sup)}" +

    /* en el celular no se encoge: ahí hay una línea por tarjeta y el
       texto se lee bien */
    "html.equipo-celular #ini-cabecera-v52 #ini-actividad .fila{width:100%;justify-content:flex-start}" +
    "html.equipo-celular #ini-cabecera-v52 #ini-actividad .fila .txt," +
    "html.equipo-celular #ini-cabecera-v52 #ini-actividad .fila .der{display:''}";
  document.head.appendChild(s);
})();

function cuentaActividadV61(){
  const cont = $("ini-actividad"), caja = $("ini-cabecera-v52");
  if(!cont) return;

  /* La app le esconde la actividad a todo el que no sea Administradora de
     Obra o administrador. Cuando no está, la línea se reparte entre dos y
     no queda una columna vacía. */
  if(caja) caja.classList.toggle("sin-actividad", cont.classList.contains("oculto"));

  /* El contador va colgado del BOTÓN, no del círculo del ícono: ese
     círculo recorta con overflow:hidden —lo necesita para las fotos
     redondas— y se comía el número entero. */
  const fila = cont.querySelector(".fila");
  if(!fila) return;
  const n = (db.historial || []).length;
  let g = fila.querySelector(".cuenta-v61");
  if(!n){ if(g) g.remove(); return; }
  if(!g){
    g = document.createElement("span");
    g.className = "cuenta-v61";
    fila.appendChild(g);
  }
  g.textContent = n > 999 ? "999+" : n;
  if(fila) fila.title = n + " registros de actividad · tóquelo para ver el detalle";
}

const cabeceraInicioV61 = cabeceraInicioV52;
cabeceraInicioV52 = function(){
  cabeceraInicioV61.apply(this, arguments);
  cuentaActividadV61();
};

/* ---------------------------------------------------------------
   V62  En computadora, todo pasa en el mismo hueco

   El menú de la izquierda y la línea de arriba —actividad, resumen,
   consolidado— se quedan siempre. Lo único que cambia al tocar un botón
   es el hueco de la derecha. Antes, "Subir un requerimiento" tapaba la
   pantalla entera: se perdía de vista dónde estaba uno parado y había
   que cerrar para volver a ver los números.

   Dos cosas hubo que mover para eso:

   1. La línea de arriba vivía DENTRO de la pantalla de Inicio, así que
      al ir a Pedidos desaparecía. Pasa a colgar de la app, al lado del
      menú, y se queda en todas.

   2. Los modales cuelgan de `body` y son `position:fixed` a pantalla
      completa. No se pueden meter en la rejilla, así que se mide el
      hueco de la derecha y se les dice exactamente dónde pararse. Se
      vuelve a medir al cambiar el tamaño de la ventana.

   En celular no cambia nada: ahí la pantalla completa ES lo correcto,
   no hay espacio para dos cosas a la vez.
   --------------------------------------------------------------- */
(function estilosV62(){
  if($("estilos-v62")) return;
  const s = document.createElement("style");
  s.id = "estilos-v62";
  s.textContent =
    /* la rejilla gana una fila: la línea fija va entre la barra y el hueco */
    "html.equipo-computadora .app{grid-template-rows:auto auto auto 1fr}" +
    "html.equipo-computadora .app > #appbar{grid-row:1}" +
    "html.equipo-computadora .app > .simbanda{grid-row:2}" +
    "html.equipo-computadora .app > #lateral-v57{grid-row:3/span 2}" +
    "html.equipo-computadora .app > #ini-cabecera-v52{grid-column:2;grid-row:3;" +
      "margin:14px 14px 0!important;padding:0}" +
    "html.equipo-computadora .app > main{grid-row:4}" +

    /* los modales se paran en el hueco medido, no en toda la pantalla */
    "html.equipo-computadora .modal.abierto{top:var(--zona-y);left:var(--zona-x);" +
      "right:auto;bottom:auto;width:var(--zona-w);height:var(--zona-h);" +
      "border-left:1px solid var(--cajon-borde);animation:none}" +
    "html.equipo-computadora .modal.abierto .cuerpo{max-width:none}" +
    "html.equipo-computadora .modal.abierto .pie-modal{max-width:none}";
  document.head.appendChild(s);
})();

/* Se mide el hueco de la derecha y se publica para que lo usen los modales */
function medirZonaV62(){
  const app = document.querySelector(".app");
  const main = app && app.querySelector("main");
  if(!main) return;
  const b = main.getBoundingClientRect(), r = document.documentElement.style;
  r.setProperty("--zona-x", Math.round(b.left) + "px");
  r.setProperty("--zona-y", Math.round(b.top) + "px");
  r.setProperty("--zona-w", Math.round(b.width) + "px");
  r.setProperty("--zona-h", Math.round(b.height) + "px");
}

/* La línea de arriba deja de ser parte de Inicio y pasa a ser de la app */
function cabeceraFijaV62(){
  const app = document.querySelector(".app");
  const caja = $("ini-cabecera-v52");
  if(!app || !caja) return;
  const enComputadora = document.documentElement.classList.contains("equipo-computadora");

  if(enComputadora){
    if(caja.parentElement !== app) app.insertBefore(caja, app.querySelector("main"));
  }else{
    /* de vuelta a Inicio: en celular es una tarjeta más de esa pantalla */
    const scr = $("scr-inicio"), saludo = $("ini-saludo");
    if(scr && caja.parentElement !== scr){
      if(saludo) saludo.insertAdjacentElement("afterend", caja);
      else scr.insertBefore(caja, scr.firstElementChild);
    }
  }
  medirZonaV62();
}

/* Estando fija, los números tienen que seguir vivos fuera de Inicio:
   los pintores originales solo corrían estando en la pantalla de Inicio. */
function refrescarCabeceraV62(){
  if(!sesion || !usuarioActual()) return;
  try{ if(typeof pintarResumenLogistico === "function") pintarResumenLogistico(); }catch(e){}
  try{ if(typeof pintarBotonConsolidadoV10 === "function") pintarBotonConsolidadoV10(); }catch(e){}
  try{ cabeceraInicioV52(); }catch(e){}
}

const irV62 = ir;
ir = function(){
  const r = irV62.apply(this, arguments);
  cabeceraFijaV62();
  refrescarCabeceraV62();
  return r;
};

const aplicarRolV62 = aplicarRol;
aplicarRol = function(){ aplicarRolV62.apply(this, arguments); cabeceraFijaV62(); };

/* Al abrir un modal se vuelve a medir: la banda de simulación puede haber
   aparecido o desaparecido y el hueco cambió de sitio. */
const abrirModalV62 = abrirModal;
abrirModal = function(){ medirZonaV62(); const r = abrirModalV62.apply(this, arguments); medirZonaV62(); return r; };

/* La V51 decide el tipo de equipo con 150 ms de espera. Si esto corriera
   antes, leería la clase vieja y en el celular la línea se quedaría
   colgada de la app en vez de volver a Inicio. */
let relojZonaV62 = null;
window.addEventListener("resize", ()=>{
  clearTimeout(relojZonaV62);
  relojZonaV62 = setTimeout(()=>{ cabeceraFijaV62(); medirZonaV62(); }, 260);
});
window.addEventListener("orientationchange", ()=>{
  setTimeout(()=>{ cabeceraFijaV62(); medirZonaV62(); }, 300);
});
setTimeout(()=> { cabeceraFijaV62(); medirZonaV62(); }, 400);

/* ---------------------------------------------------------------
   V63  La caja de subida, en una sola línea

   Se llevaba un tercio del formulario para decir algo que se entiende
   con dos palabras: un ícono de 38 px, un título, un párrafo de dos
   renglones y dos botones apilados de 86 px de alto.

   Queda todo en una línea: ícono, título y los dos botones al costado.
   La explicación larga —"llénela con los materiales que necesita"— pasa
   al `title`: sirve la primera vez y estorba las otras cincuenta.

   En el celular se parte en dos renglones, que en 375 px una sola línea
   con dos botones no entra sin achicar la letra.
   --------------------------------------------------------------- */
(function cajaCompactaV63(){
  if($("estilos-v63")) return;
  const s = document.createElement("style");
  s.id = "estilos-v63";
  s.textContent =
    "#modal-requerimiento #mr-excel.solo{display:flex;align-items:center;gap:14px;text-align:left;" +
      "padding:11px 14px;flex-wrap:wrap}" +
    "#modal-requerimiento #mr-excel.solo .ico-grande{width:26px;height:26px;margin:0;flex:0 0 auto}" +
    "#modal-requerimiento #mr-excel.solo .titulo{margin:0;font-size:14px}" +
    "#modal-requerimiento #mr-excel.solo .ayuda{margin:0!important;font-size:11.5px;line-height:1.3}" +
    "#modal-requerimiento #mr-excel.solo .texto-v63{flex:1 1 190px;min-width:0}" +

    /* los botones vuelven a ser botones: ícono y texto en la misma fila */
    "#modal-requerimiento #mr-excel.solo .btns{flex:0 0 auto;margin:0;border:0;border-radius:0;background:transparent;" +
      "display:flex;gap:9px}" +
    "#modal-requerimiento #mr-excel.solo .btns .btn{width:auto;min-height:0;flex-direction:row;gap:7px;" +
      "padding:9px 15px;border-radius:10px;font-size:13px;border:1px solid var(--cajon-borde)}" +
    "#modal-requerimiento #mr-excel.solo .btns .btn + .btn{border-left:1px solid var(--cajon-borde)}" +
    "#modal-requerimiento #mr-excel.solo .btns .btn svg{width:17px;height:17px}" +
    "#modal-requerimiento #mr-excel.solo .btns #mr-plantilla{background:var(--sup)}" +

    /* el aviso de importación no debe empujar la línea */
    "#modal-requerimiento #mr-excel.solo #mr-importe{flex:1 0 100%;margin:0!important}" +
    "#modal-requerimiento #mr-excel.solo #mr-importe:empty{display:none}" +

    "@media(max-width:520px){#mr-excel.solo .btns{flex:1 0 100%}" +
      "#modal-requerimiento #mr-excel.solo .btns .btn{flex:1}}";
  document.head.appendChild(s);

  /* El título y la ayuda se envuelven para que ocupen una sola columna
     entre el ícono y los botones. Se hace una vez: el bloque no se
     vuelve a pintar. */
  const excel = $("mr-excel");
  if(!excel || excel.querySelector(".texto-v63")) return;
  const titulo = excel.querySelector(".titulo");
  const ayuda = excel.querySelector(".ayuda");
  if(!titulo) return;

  const caja = document.createElement("div");
  caja.className = "texto-v63";
  titulo.insertAdjacentElement("beforebegin", caja);
  caja.appendChild(titulo);
  if(ayuda){
    caja.appendChild(ayuda);
    excel.title = ayuda.textContent.trim();
    ayuda.textContent = "Acepta .xlsx y .csv";
  }
})();

/* ---------------------------------------------------------------
   V64  Que reconozca el formato que descarga

   Descargar la plantilla y volver a subirla llena tenía que funcionar de
   ida y vuelta, y no funcionaba del todo: el formato oficial trae dos
   columnas que el lector no conocía —SOLICITANTE y LUGAR/FRENTE— así que
   se perdían al importar. Ahora entran.

   Además el formato viene con los números de fila del 1 al 61 ya
   escritos. Como el lector contaba "fila con algo pero sin descripción"
   como omitida, subir una plantilla con tres materiales avisaba
   "58 filas omitidas", que parece un error y no lo es. Ahora una fila que
   solo tiene su número no cuenta: está vacía, simplemente.

   También se va el recuadro punteado. Ocupaba media pantalla para
   sostener dos botones; los botones se van arriba, en una tira fina, y
   lo que queda —los datos del pedido y los materiales— pasa a un solo
   cuadro que se va llenando a medida que se carga.
   --------------------------------------------------------------- */

/* 1 · Las dos columnas que faltaban */
COLS_PEDIDO.push(
  {clave:"solicitante", alias:["solicitante","quien solicita","pide","solicita"]},
  {clave:"lugar",       alias:["lugar/frente","lugar / frente","lugar","frente de trabajo","ubicacion"]}
);

const importarPedidoV64 = importarPedido;
importarPedido = function(filas){
  const antes = itemsReq.length;
  const res = importarPedidoV64.apply(this, arguments);

  /* El original ya cargó descripción, cantidad, unidad y observaciones.
     Se vuelve a leer solo para completar las dos columnas nuevas, que él
     no conoce, emparejando por descripción en el orden en que entraron. */
  try{
    let iCab = -1, mapa = {};
    for(let i = 0; i < Math.min(filas.length, 15); i++){
      const prueba = {};
      (filas[i] || []).forEach((celda, c)=>{
        const t = sinTildes(celda);
        COLS_PEDIDO.forEach(col => { if(col.alias.indexOf(t) >= 0 && prueba[col.clave] === undefined) prueba[col.clave] = c; });
      });
      if(prueba.desc !== undefined){ iCab = i; mapa = prueba; break; }
    }
    if(iCab >= 0 && (mapa.solicitante !== undefined || mapa.lugar !== undefined)){
      const val = (f, k) => mapa[k] === undefined ? "" : String(f[mapa[k]] == null ? "" : f[mapa[k]]).trim();
      let n = antes;
      for(let i = iCab + 1; i < filas.length && n < itemsReq.length; i++){
        const f = filas[i] || [];
        if(!val(f, "desc")) continue;
        if(val(f, "solicitante")) itemsReq[n].solicitante = val(f, "solicitante");
        if(val(f, "lugar"))       itemsReq[n].lugar = val(f, "lugar");
        n++;
      }
    }
  }catch(e){ console.warn("[import] columnas extra:", e); }

  /* El importador original ya pintó la tabla ANTES de que este paso
     completara solicitante y lugar, así que hay que volver a pintarla:
     si no, el dato entra al pedido pero la pantalla lo muestra vacío. */
  try{ pintarItemsReq(); }catch(e){}

  /* Una fila que solo trae su número de orden está vacía, no omitida */
  return res;
};

/* El conteo de omitidas se corrige donde se muestra, que es lo que lee
   la persona: se descuentan las filas numeradas y vacías del formato. */
const importarArchivoReqV64 = importarArchivoReq;
importarArchivoReq = async function(e){
  const archivo = e.target.files && e.target.files[0];
  if(!archivo) return importarArchivoReqV64.apply(this, arguments);
  const r = await importarArchivoReqV64.apply(this, arguments);
  const salida = $("mr-importe");
  if(salida && /fila\(s\) sin descripción omitidas/.test(salida.innerHTML)){
    salida.innerHTML = salida.innerHTML.replace(/ · \d+ fila\(s\) sin descripción omitidas/, "");
  }
  return r;
};

/* 2 · Fuera el recuadro punteado; los botones, arriba y en una tira */
(function tiraSubidaV64(){
  if($("estilos-v64")) return;
  const s = document.createElement("style");
  s.id = "estilos-v64";
  s.textContent =
    /* la caja deja de ser un recuadro: es una tira de dos botones */
    "#modal-requerimiento #mr-excel.solo{border:0!important;background:transparent!important;" +
      "padding:0!important;margin:0 0 4px!important;gap:9px;align-items:center}" +
    "#modal-requerimiento #mr-excel.solo .ico-grande," +
    "#modal-requerimiento #mr-excel.solo .texto-v63{display:none}" +
    "#modal-requerimiento #mr-excel.solo .btns{flex:1 1 auto;display:flex;gap:9px;" +
      /* la V16 los apilaba en columna y esa regla seguía viva */
      "flex-direction:row!important;align-items:stretch}" +
    "#modal-requerimiento #mr-excel.solo .btns .btn{flex:1 1 0;min-height:38px;height:38px;" +
      "flex-direction:row;gap:7px;padding:0 14px;border-radius:10px;font-size:13px;" +
      "border:1px solid var(--cajon-borde)}" +
    "#modal-requerimiento #mr-excel.solo #mr-importe{flex:1 0 100%;margin:6px 0 0!important;" +
      "font-size:11.5px}" +

    /* 3 · un solo cuadro: los datos y los materiales, que se va llenando */
    '#modal-requerimiento [data-paso="1"] .caja-v50{border-bottom:0;border-radius:14px 14px 0 0;' +
      "padding-bottom:4px}" +
    '#modal-requerimiento [data-paso="2"]{margin-top:0}' +
    '#modal-requerimiento [data-paso="2"] .sech-v50{display:none}' +
    '#modal-requerimiento [data-paso="2"] .caja-v50{border-top:0;border-radius:0 0 14px 14px;' +
      "padding-top:4px}" +
    /* en computadora seguían en dos columnas: ahora es un cuadro solo */
    'html.equipo-computadora #modal-requerimiento [data-paso="1"],' +
    'html.equipo-computadora #modal-requerimiento [data-paso="2"]{grid-column:1/-1}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="1"]{grid-row:3}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="2"]{grid-row:4}' +
    'html.equipo-computadora #modal-requerimiento [data-paso="3"]{grid-column:1/-1;grid-row:5}';
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   V65  El requerimiento ES el formato

   Queda solo lo que se usa: los dos botones arriba y el cuadro con las
   filas del formato. Se va lo demás — el buscador de materiales, el
   "repetir pedido anterior" y los adjuntos— porque el pedido entra por
   el archivo o se escribe en la planilla, y no por esos caminos.

   Los datos de cabecera del formato (obra, área, prioridad, fecha) NO
   se borran: se esconden. Los llena solo la importación al leer la
   cabecera del archivo, y el registro los sigue leyendo de ahí. Se
   muestran arriba de la tabla en una tira de lectura, con "Editar" al
   costado — si se borraran, un pedido escrito a mano saldría sin obra ni
   fecha y eso es peor que un campo de más.

   Y el botón pasa a decir "Enviar", que es lo que hace: el pedido se va
   a la Administradora de Obra.
   --------------------------------------------------------------- */
(function estilosV65(){
  if($("estilos-v65")) return;
  const s = document.createElement("style");
  s.id = "estilos-v65";
  s.textContent =
    /* fuera el buscador, el repetir y los adjuntos */
    "#modal-requerimiento #mr-catalogo," +
    '#modal-requerimiento [data-paso="3"]{display:none!important}' +
    /* la cabecera del pedido se esconde, pero sigue viva */
    "#modal-requerimiento .datos-ocultos-v65{display:none!important}" +

    /* la tira de lectura con lo que trajo el archivo */
    "#mr-cabecera-v65{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;" +
      "padding:9px 12px;margin:0 0 10px;border:1px solid var(--cajon-borde);" +
      "border-radius:10px;background:var(--sup);font-size:12.5px}" +
    "#mr-cabecera-v65 .d{display:flex;gap:5px;align-items:baseline;min-width:0}" +
    "#mr-cabecera-v65 .d span{color:var(--tinta-sec);font-size:11px}" +
    "#mr-cabecera-v65 .d b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#mr-cabecera-v65 .editar{margin-left:auto;border:0;background:transparent;color:var(--pri);" +
      "font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 6px;border-radius:8px}" +
    "#mr-cabecera-v65 .editar:hover{background:var(--cajon)}" +
    "#mr-cabecera-v65.vacia .d{display:none}";
  document.head.appendChild(s);
})();

/* La cabecera del pedido: escondida, y resumida arriba de la tabla */
function cabeceraPedidoV65(){
  const paso1 = document.querySelector('#modal-requerimiento [data-paso="1"]');
  const paso2 = document.querySelector('#modal-requerimiento [data-paso="2"]');
  if(!paso1 || !paso2) return;
  paso1.classList.add("datos-ocultos-v65");

  let tira = $("mr-cabecera-v65");
  if(!tira){
    tira = document.createElement("div");
    tira.id = "mr-cabecera-v65";
    const caja = paso2.querySelector(".caja-v50") || paso2;
    caja.insertBefore(tira, caja.firstElementChild);
  }

  const v = id => { const c = $(id); return c ? String(c.value || "").trim() : ""; };
  const partes = [
    ["Obra", v("mr-obra")], ["Área", v("mr-area")],
    ["Prioridad", v("mr-prioridad")], ["Necesario para", v("mr-necesario")]
  ].filter(p => p[1]);

  tira.classList.toggle("vacia", !partes.length);
  tira.innerHTML =
    (partes.length
      ? partes.map(p => '<span class="d"><span>' + p[0] + "</span><b>" + esc(p[1]) + "</b></span>").join("")
      : '<span class="d" style="display:flex"><span>Los datos de la obra salen de la cabecera del archivo</span></span>') +
    '<button type="button" class="editar">' + (partes.length ? "Editar" : "Escribirlos") + "</button>";

  tira.querySelector(".editar").addEventListener("click", ()=>{
    const oculto = paso1.classList.toggle("datos-ocultos-v65");
    if(!oculto) paso1.scrollIntoView({block:"nearest", behavior:"smooth"});
  });
}

const pintarItemsReqV65 = pintarItemsReq;
pintarItemsReq = function(){ pintarItemsReqV65.apply(this, arguments); cabeceraPedidoV65(); };

const abrirRequerimientoV65 = abrirRequerimiento;
abrirRequerimiento = function(){
  const r = abrirRequerimientoV65.apply(this, arguments);
  cabeceraPedidoV65();
  return r;
};

/* "Registrar" es lo que hace la app; "Enviar" es lo que hace la persona */
(function botonEnviarV65(){
  ["mr-registrar", "mr-registrar2"].forEach(id => {
    const b = $(id);
    if(b) b.textContent = "Enviar";
  });
})();

/* ---------------------------------------------------------------
   V66  La tabla, con todos los puntos de la planilla

   Faltaban cuatro columnas del formato oficial: el N° de orden, ENTREGA
   PARCIAL, ENTREGA TOTAL y AUTORIZADO. Las dejé afuera a propósito
   —las llenan el almacén y Logística después, no quien pide— pero el
   pedido es que la pantalla sea la planilla, así que van todas y en el
   mismo orden que el papel:

     N° · DESCRIPCIÓN · UND · SOLICITADA · ENTREGA PARCIAL ·
     ENTREGA TOTAL · SOLICITANTE · LUGAR/FRENTE · AUTORIZADO ·
     OBSERVACIONES

   Las tres de después van en gris y sin marco: se pueden escribir, pero
   se ve de un vistazo que no son de este momento. El N° no se escribe,
   se cuenta solo — si fuera un campo, alguien lo dejaría en blanco o
   repetido y la fila perdería su orden.

   Diez columnas no entran en ninguna pantalla: la tabla se desplaza de
   costado, que es como se lee el papel cuando es ancho.
   --------------------------------------------------------------- */
COLS_REQ_V49.splice(0, COLS_REQ_V49.length,
  {k:"desc",           t:"Descripción",     c:"c-desc", tipo:"text"},
  {k:"unidad",         t:"Und.",            c:"c-und",  tipo:"text"},
  {k:"cant",           t:"Solicitada",      c:"c-cant", tipo:"number"},
  {k:"entregaParcial", t:"Entrega parcial", c:"c-ent",  tipo:"number", despues:true},
  {k:"entregaTotal",   t:"Entrega total",   c:"c-ent",  tipo:"number", despues:true},
  {k:"solicitante",    t:"Solicitante",     c:"c-sol",  tipo:"text"},
  {k:"lugar",          t:"Lugar / frente",  c:"c-lug",  tipo:"text"},
  {k:"autorizado",     t:"Autorizado",      c:"c-aut",  tipo:"text",   despues:true},
  {k:"obs",            t:"Observaciones",   c:"c-obs",  tipo:"text"}
);

(function estilosV66(){
  if($("estilos-v66")) return;
  const s = document.createElement("style");
  s.id = "estilos-v66";
  s.textContent =
    ".tabla-req table{min-width:1120px}" +
    ".tabla-req .c-num{width:44px;text-align:center;color:var(--tinta-sec);font-size:12.5px;" +
      "font-variant-numeric:tabular-nums}" +
    ".tabla-req .c-ent{width:104px}.tabla-req .c-aut{width:112px}" +
    /* lo que se llena después: se distingue sin quedar bloqueado */
    ".tabla-req td.despues-v66{background:var(--cajon)}" +
    ".tabla-req td.despues-v66 input{color:var(--tinta-sec)}" +
    ".tabla-req th.despues-v66{background:var(--cajon-hondo);font-style:italic}";
  document.head.appendChild(s);
})();

/* Se rehace el pintado para meter el N°, que no es un campo sino la
   posición de la fila, y para marcar las columnas de después. */
pintarTablaReqV49 = function(){
  const cont = $("mr-items");
  if(!cont) return;

  const cab = '<tr><th class="c-num">N°</th>' + COLS_REQ_V49.map(c =>
      '<th class="' + c.c + (c.despues ? " despues-v66" : "") + '">' + c.t + "</th>").join("") +
    '<th class="c-quita"></th></tr>';

  const cuerpo = itemsReq.length
    ? itemsReq.map((it, i) =>
        '<tr><td class="c-num">' + (i + 1) + "</td>" +
        COLS_REQ_V49.map(c =>
          '<td class="' + c.c + (c.despues ? " despues-v66" : "") + '"><input type="' + c.tipo + '"' +
          (c.tipo === "number" ? ' min="0" step="0.01" inputmode="decimal"' : "") +
          ' data-campo="' + c.k + '" data-fila="' + i + '" value="' +
          esc(String(it[c.k] === undefined || it[c.k] === null ? "" : it[c.k])) + '"' +
          (c.k === "desc" ? ' placeholder="Qué material necesita"' : "") +
          (c.despues ? ' title="Lo llenan el almacén y Logística al entregar"' : "") +
          "></td>").join("") +
        '<td class="c-quita"><button type="button" class="quita-fila" data-quitaritem="' + i +
        '" aria-label="Quitar esta línea" title="Quitar">✕</button></td></tr>').join("")
    : '<tr class="sin-filas"><td colspan="' + (COLS_REQ_V49.length + 2) + '">' +
      "Suba la planilla o toque el + para agregar un material.</td></tr>";

  cont.innerHTML = '<div class="tabla-req"><table><thead>' + cab +
                   "</thead><tbody>" + cuerpo + "</tbody></table></div>";

  /* Se escribe directo sobre el arreglo y NO se repinta: repintar en cada
     tecla le sacaría el foco al campo y cerraría el teclado del celular. */
  $$("#mr-items input[data-campo]").forEach(inp => {
    inp.addEventListener("input", ()=>{
      const it = itemsReq[+inp.dataset.fila];
      if(!it) return;
      const k = inp.dataset.campo;
      it[k] = k === "cant" ? Math.max(0.01, num(inp.value) || 0.01)
            : (k === "entregaParcial" || k === "entregaTotal")
              ? (inp.value === "" ? "" : num(inp.value))
              : inp.value;
    });
  });

  $$("#mr-items [data-quitaritem]").forEach(b => b.addEventListener("click", ()=>{
    itemsReq.splice(+b.dataset.quitaritem, 1);
    pintarItemsReq();
  }));
};

/* Y que el archivo también traiga esas tres, si vienen llenas */
COLS_PEDIDO.push(
  {clave:"entregaParcial", alias:["entrega parcial","parcial"]},
  {clave:"entregaTotal",   alias:["entrega total","total"]},
  {clave:"autorizado",     alias:["autorizado","autoriza","vb","visto bueno"]}
);

/* ---------------------------------------------------------------
   V67  Fuera la revisión de nombres

   Era un paso entre subir el archivo y enviar el pedido: por cada
   material que no calzaba exacto con el catálogo, un desplegable
   preguntando si es ese o es nuevo. Con veinte líneas son veinte
   preguntas antes de poder mandar nada.

   Qué se pierde y qué no, para que quede dicho:

   · Lo que calza EXACTO con el catálogo se sigue enlazando solo, con su
     código. Eso pasa al importar y no dependía de este bloque.
   · Lo que no calza entra TAL COMO ESTÁ ESCRITO en el archivo. No se
     acepta ninguna corrección a ciegas: aceptar el parecido automático
     renombraría el material de alguien por una suposición, y eso es
     peor que tener dos nombres para la misma cosa.
   · Se deja de aprender equivalencias ("fierro 1/2" = "Varilla 1/2").
     Antes cada corrección quedaba guardada para la próxima.

   O sea: el catálogo puede terminar con el mismo material escrito de
   dos formas. Se arregla desde Inventario, uniendo los dos. Si eso
   empieza a molestar en obra, el camino es que la revisión aparezca
   SOLO cuando el parecido es muy alto, en vez de por cada línea.
   --------------------------------------------------------------- */
pintarRevision = function(){
  const cont = $("mr-revision");
  if(cont) cont.innerHTML = "";
};

/* ---------------------------------------------------------------
   V68  Un pedido por día

   La obra pide una vez al día. Si la Administradora sube un segundo
   requerimiento el mismo día, no se rechaza: se guarda para MAÑANA. Así
   nadie pierde lo que cargó, y logística recibe un pedido por día en vez
   de tres sueltos.

   Si de verdad hace falta uno más hoy —porque algo se subió mal, o entró
   una urgencia— se le pide permiso a Logística. Mientras el permiso no
   esté aprobado, lo subido queda para mañana igual: si Logística no
   contesta o dice que no, el pedido del día que ya estaba queda como
   está, y lo nuevo sale mañana. Aprobado el permiso, se mueve a hoy.

   Dos decisiones que tomé y conviene revisar:

   · Lo segundo del día SIEMPRE se registra, aunque sea para mañana.
     Dejarlo sin registrar hasta que Logística conteste significaría que
     la Administradora pierde lo que cargó si nadie contesta, y en obra
     nadie contesta a las 6 de la tarde.
   · El permiso vale por UN pedido y por ESE día. No queda abierto: al
     otro día vuelve a regir la regla sola.

   El permiso vive en `config`, que ya se sincroniza, para no tener que
   crear otra tabla en la base por un dato que es uno por día.
   --------------------------------------------------------------- */
function diaDeManana(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function pedidosDelDia(dia){
  return (db.requerimientos || []).filter(r =>
    (r.diaPedido || diaLocal(r.fecha)) === dia && r.estado !== "rechazado");
}

function permisosDia(){
  db.config = db.config || {};
  db.config.permisoDia = db.config.permisoDia || {};
  return db.config.permisoDia;
}

/* Estado del permiso de hoy: null | pendiente | aprobado | usado | rechazado */
function permisoDeHoy(){
  return permisosDia()[hoyISO()] || null;
}

function pedirPermisoDiaV68(){
  const u = usuarioActual();
  const p = {estado:"pendiente", pedidoPor:u.nombre, pedidoPorId:u.id, ts:ahora()};
  permisosDia()[hoyISO()] = p;
  notificar({roles:["compras","jefatura","admin"],
    titulo:"Permiso para un segundo pedido de hoy",
    cuerpo:u.nombre + " necesita cargar otro requerimiento hoy.\n" +
           "Mientras no se apruebe, lo que subió queda para mañana.",
    refTipo:"permisoDia", prioridad:"Alta"});
  guardar();
}

function resolverPermisoV68(aprobado){
  const p = permisoDeHoy();
  if(!p || p.estado !== "pendiente") return;
  const u = usuarioActual();
  p.estado = aprobado ? "aprobado" : "rechazado";
  p.resueltoPor = u.nombre;
  p.resueltoTs = ahora();

  if(aprobado){
    /* Lo que se había guardado para mañana se trae a hoy: es lo que se
       estaba pidiendo permiso para hacer. */
    const manana = diaDeManana();
    const movidos = (db.requerimientos || []).filter(r =>
      r.diaPedido === manana && r.esperandoPermiso);
    movidos.forEach(r => { r.diaPedido = hoyISO(); r.esperandoPermiso = false; });
    if(movidos.length) p.estado = "usado";
    log("pedidos", "Permiso de segundo pedido aprobado",
        movidos.length + " pedido(s) pasan a hoy");
  }else{
    (db.requerimientos || []).forEach(r => { if(r.esperandoPermiso) r.esperandoPermiso = false; });
    log("pedidos", "Permiso de segundo pedido rechazado", "queda el pedido del día");
  }

  notificar({usuarios:[p.pedidoPorId],
    titulo:aprobado ? "Puede cargar otro pedido hoy" : "El pedido de hoy queda como está",
    cuerpo:(aprobado
      ? "Logística aprobó el segundo pedido: lo que había subido pasa a hoy."
      : "Logística no aprobó un segundo pedido. Lo que subió queda para mañana.") +
      "\nResuelto por " + u.nombre + ".",
    refTipo:"permisoDia"});

  guardar();
  snack(aprobado ? "Permiso aprobado." : "Permiso rechazado.", aprobado ? "ok" : "");
  refrescar(pantalla);
}

/* El registro decide a qué día va el pedido */
const registrarRequerimientoV68 = registrarRequerimiento;
registrarRequerimiento = function(){
  const hoy = hoyISO();
  const yaHay = pedidosDelDia(hoy).length > 0;
  const permiso = permisoDeHoy();

  /* Primero del día: va a hoy y no se pregunta nada */
  if(!yaHay){
    window.__diaDelPedidoV68 = hoy;
    return registrarRequerimientoV68.apply(this, arguments);
  }

  /* Con permiso aprobado sin usar, este segundo sí es de hoy */
  if(permiso && permiso.estado === "aprobado"){
    permiso.estado = "usado";
    window.__diaDelPedidoV68 = hoy;
    return registrarRequerimientoV68.apply(this, arguments);
  }

  /* Si no, se guarda para mañana y se ofrece pedir el permiso */
  window.__diaDelPedidoV68 = diaDeManana();
  window.__esperandoPermisoV68 = true;
  const r = registrarRequerimientoV68.apply(this, arguments);

  const yaPidio = permiso && permiso.estado === "pendiente";
  hoja("Ya hay un pedido de hoy",
    "<p style='margin:4px 0 10px'>Este quedó guardado para <b>mañana</b>, así no se pierde nada.</p>" +
    "<p class='ayuda' style='margin:0'>Si hace falta que salga hoy —porque algo se subió mal o entró una " +
    "urgencia— Logística tiene que autorizarlo. Mientras tanto sigue siendo de mañana.</p>",
    [yaPidio
      ? {txt:"Ya está pedido", clase:"btn-cont"}
      : {txt:"Pedir permiso a Logística", clase:"btn-pri", fn:()=>{
          pedirPermisoDiaV68();
          snack("Permiso pedido. Le avisamos cuando contesten.", "ok");
        }},
     {txt:"Está bien para mañana", clase:"btn-cont"}]);
  return r;
};

/* Se le sella el día al pedido recién creado */
const historiaV68 = historia;
historia = function(r, estado, nota){
  const res = historiaV68.apply(this, arguments);
  if(r && !r.diaPedido && window.__diaDelPedidoV68){
    r.diaPedido = window.__diaDelPedidoV68;
    r.esperandoPermiso = !!window.__esperandoPermisoV68;
    window.__diaDelPedidoV68 = null;
    window.__esperandoPermisoV68 = false;
  }
  return res;
};

/* Aviso para Logística, arriba de la lista de pedidos */
function avisoPermisoV68(){
  const scr = $("scr-pedidos");
  if(!scr) return;
  let caja = $("permiso-v68");
  const p = permisoDeHoy();
  const puedeResolver = puede("compras") || puede("pedidos.aprobar");
  if(!p || p.estado !== "pendiente" || !puedeResolver){ if(caja) caja.remove(); return; }

  if(!caja){
    caja = document.createElement("div");
    caja.id = "permiso-v68";
    caja.className = "card";
    caja.style.cssText = "background:var(--alerta-f);border:1px solid var(--alerta);margin-bottom:12px";
    scr.insertBefore(caja, scr.firstElementChild);
  }
  caja.innerHTML =
    "<b style='display:block;font-size:14.5px'>Permiso para un segundo pedido de hoy</b>" +
    "<p class='ayuda' style='margin:4px 0 10px'>" + esc(p.pedidoPor) +
    " necesita cargar otro requerimiento hoy. Si no se aprueba, lo que subió sale mañana.</p>" +
    '<div class="btns"><button class="btn btn-cont" id="permiso-no">No, queda para mañana</button>' +
    '<button class="btn btn-ok" id="permiso-si">Autorizar</button></div>';
  $("permiso-si").addEventListener("click", ()=> resolverPermisoV68(true));
  $("permiso-no").addEventListener("click", ()=> resolverPermisoV68(false));
}

const refrescarV68 = refrescar;
refrescar = function(destino){
  const r = refrescarV68.apply(this, arguments);
  if(destino === "pedidos") avisoPermisoV68();
  return r;
};

/* ---------------------------------------------------------------
   V69  El menú se pliega

   En computadora el menú se queda fijo, y eso está bien para navegar
   pero estorba cuando se está llenando una planilla de diez columnas:
   son 238 px que le faltan a la tabla.

   El botón va en el mismo hueco donde vive la flecha de volver, que en
   computadora casi nunca se usa. Dos dibujos distintos a propósito:

     · cerrado   → tres líneas, "acá hay un menú, ábralo"
     · abierto   → tres líneas con la flecha hacia la izquierda,
                   "esto se recoge para allá"

   Con el mismo ícono en los dos estados no se sabe si va a abrir o a
   cerrar hasta tocarlo.

   Queda recordado en el equipo: quien lo cierra para trabajar cómodo no
   tiene que volver a cerrarlo cada vez que entra.
   --------------------------------------------------------------- */
ICONOS.menu3 = '<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/>';
ICONOS.menu3cerrar = '<path d="M4 7h16M4 17h16" stroke-linecap="round"/>' +
                     '<path d="M20 12H9M13 8l-4 4 4 4" stroke-linecap="round" stroke-linejoin="round"/>';

(function estilosV69(){
  if($("estilos-v69")) return;
  const s = document.createElement("style");
  s.id = "estilos-v69";
  s.textContent =
    /* solo en computadora: en celular el menú ya se abre por el avatar */
    "#btn-lateral-v69{display:none}" +
    "html.equipo-computadora #btn-lateral-v69{display:flex}" +
    "html.equipo-computadora.lateral-cerrado .app{grid-template-columns:0 1fr}" +
    "html.equipo-computadora.lateral-cerrado #lateral-v57{display:none}" +
    /* la zona de la derecha se ensancha sola; los modales se remiden */
    "html.equipo-computadora #lateral-v57{transition:none}";
  document.head.appendChild(s);
})();

function pintarBotonLateralV69(){
  const barra = $("appbar");
  if(!barra) return;
  let b = $("btn-lateral-v69");
  if(!b){
    b = document.createElement("button");
    b.id = "btn-lateral-v69";
    b.className = "icon-btn";
    b.type = "button";
    /* en el mismo hueco que la flecha de volver */
    const volver = $("btn-volver");
    if(volver) volver.insertAdjacentElement("afterend", b);
    else barra.insertBefore(b, barra.firstElementChild);
    b.addEventListener("click", ()=>{
      const cerrado = document.documentElement.classList.toggle("lateral-cerrado");
      try{ localStorage.setItem("almacen_lateral_v69", cerrado ? "1" : "0"); }catch(e){}
      pintarBotonLateralV69();
      /* los modales están parados sobre medidas viejas: se remiden */
      setTimeout(()=>{ try{ medirZonaV62(); }catch(e){} }, 30);
    });
  }
  const cerrado = document.documentElement.classList.contains("lateral-cerrado");
  b.innerHTML = ico(cerrado ? "menu3" : "menu3cerrar", 22);
  b.setAttribute("aria-label", cerrado ? "Abrir el menú" : "Recoger el menú");
  b.title = b.getAttribute("aria-label");
  b.setAttribute("aria-expanded", cerrado ? "false" : "true");
}

(function arranqueLateralV69(){
  let guardado = null;
  try{ guardado = localStorage.getItem("almacen_lateral_v69"); }catch(e){}
  if(guardado === "1") document.documentElement.classList.add("lateral-cerrado");
  pintarBotonLateralV69();
})();

/* La flecha de volver puede aparecer y desaparecer; el botón se repinta
   con ella para no quedar suelto ni duplicado. */
const aplicarRolV69 = aplicarRol;
aplicarRol = function(){ aplicarRolV69.apply(this, arguments); pintarBotonLateralV69(); };

const irV69 = ir;
ir = function(){ const r = irV69.apply(this, arguments); pintarBotonLateralV69(); return r; };

/* Paleta amarillo y azul · V43 · 11-08-2026 */

/* ---------------------------------------------------------------
   V47  La caja de subida, arriba y partida en dos

   El requerimiento entra solo por Excel desde la V16, pero la caja
   para subirlo quedaba tercera: primero quién solicita, después el
   buscador de materiales —que no hace nada hasta que haya archivo— y
   recién ahí la subida. Lo primero que hay que hacer estaba abajo.

   Ahora la caja abre el formulario, y en vez de dos botones apilados
   es un cuadro partido al medio: a la izquierda descargar la plantilla,
   a la derecha elegir el archivo. Es el orden en que se usa.

   Se MUEVEN los botones que ya existen, no se vuelven a crear: así no
   hay que reconectar nada de lo que enganchó la V16.
   --------------------------------------------------------------- */
(function cajaSubidaArribaV47(){
  const excel = $("mr-excel");
  if(!excel || $("estilos-v47")) return;

  const s = document.createElement("style");
  s.id = "estilos-v47";
  s.textContent =
    /* el cuadro partido: un solo borde por fuera y una línea al medio */
    "#mr-excel.solo .btns{display:grid;grid-template-columns:1fr 1fr;gap:0;" +
      "margin:13px 0 0;border:1px solid var(--borde);border-radius:12px;" +
      "overflow:hidden;background:var(--sup)}" +
    "#mr-excel.solo .btns .btn{width:100%;margin:0;border:0;border-radius:0;" +
      "background:transparent;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:7px;padding:15px 9px;font-size:13px;font-weight:600;" +
      "line-height:1.25;text-align:center;min-height:86px}" +
    "#mr-excel.solo .btns .btn + .btn{border-left:1px solid var(--borde)}" +
    "#mr-excel.solo .btns .btn svg{display:block}" +
    /* el lado de subir es el que manda: va con el color de la app */
    "#mr-excel.solo .btns #mr-subir{background:var(--pri);color:var(--sobre-pri)}" +
    "#mr-excel.solo .btns #mr-subir:active{background:var(--pri-osc)}" +
    "#mr-excel.solo .btns #mr-plantilla{color:var(--pri)}" +
    "#mr-excel.solo .btns #mr-plantilla:active{background:var(--sup-var)}" +
    /* en pantallas muy angostas el texto largo no debe romper la caja */
    "@media(max-width:340px){#mr-excel.solo .btns .btn{font-size:12px;padding:13px 6px}}";
  document.head.appendChild(s);

  const btns = excel.querySelector(".btns");
  const subir = $("mr-subir"), plantilla = $("mr-plantilla");
  if(btns && subir && plantilla){
    /* Izquierda la plantilla, derecha el archivo: primero se descarga,
       después se sube. */
    btns.insertBefore(plantilla, subir);
    if(!plantilla.querySelector("svg"))
      plantilla.insertAdjacentHTML("afterbegin", ico("descargar", 24));
    if(!subir.querySelector("svg"))
      subir.insertAdjacentHTML("afterbegin", ico("subir", 24));
  }

  /* Y la caja al principio del formulario, con su aviso pegado detrás. */
  const cuerpo = excel.parentElement;
  if(cuerpo && cuerpo.firstElementChild !== excel){
    cuerpo.insertBefore(excel, cuerpo.firstElementChild);
    const aviso = $("mr-aviso-bloqueo");
    if(aviso) excel.insertAdjacentElement("afterend", aviso);
  }
})();


/* ---------------------------------------------------------------
   V70  Que la plantilla baje de verdad

   El botón no descargaba nada y no avisaba nada. La causa: la V54 hizo
   que primero se bajara el formato del storage, y recién después se
   disparara la descarga. Entre medio hay un `await`, y el navegador
   considera que el click del usuario ya terminó — una descarga que no
   sale de un gesto de la persona la bloquea en silencio. Ni error en la
   consola ni archivo: el peor tipo de fallo.

   La solución es no tener nada pendiente en el momento del click: el
   formato se baja apenas se abre el requerimiento y queda listo en
   memoria. Cuando se toca el botón ya no hay que esperar a nadie, y la
   descarga sale dentro del mismo gesto.

   Si todavía no terminó de llegar —red lenta, primer uso— se descarga
   la plantilla simple armada al vuelo, que es instantánea. Vale más un
   archivo enseguida que el archivo perfecto que no baja.
   --------------------------------------------------------------- */
(function plantillaListaV70(){
  var listo = null;      /* {blob, nombre} cuando ya llegó */
  var bajando = false;

  function traer(){
    if(listo || bajando) return;
    bajando = true;
    var fuentes = [FORMATO_REQ_V54, FORMATO_REQ_LOCAL_V54];
    (function siguiente(i){
      if(i >= fuentes.length){ bajando = false; return; }
      fetch(fuentes[i], {cache:"no-store"})
        .then(function(r){ return r.ok ? r.blob() : Promise.reject(new Error(r.status)); })
        .then(function(b){
          if(b.size < 1000) throw new Error("archivo vacío");
          listo = {blob:b, nombre:"FORMATO DE REQUERIMIENTO.xlsx"};
          bajando = false;
        })
        .catch(function(){ siguiente(i + 1); });
    })(0);
  }

  /* Se empieza a bajar al abrir el requerimiento, no al tocar el botón */
  var abrirV70 = abrirRequerimiento;
  abrirRequerimiento = function(){
    traer();
    return abrirV70.apply(this, arguments);
  };
  traer();   /* y también de entrada, por si el modal ya estaba abierto */

  /* El click no espera a nadie: o está el formato, o sale la simple */
  var generarSimple = plantillaRequerimientoV54;
  plantillaRequerimiento = function(){
    if(listo){
      descargarBlob(listo.nombre, listo.blob);
      snack("Formato descargado. Llénelo y súbalo.", "ok");
      return;
    }
    traer();
    snack("Aún no llegó el formato oficial: se descarga la plantilla simple.", "");
    return generarSimple.apply(this, arguments);
  };
})();

/* ---------------------------------------------------------------
   V71  "Observado", para cuando algo está mal

   Faltaba la salida para el caso feo: el pedido llegó incompleto, vino
   otro material, la factura no cuadra. Sin ese botón, quien lo detecta
   lo marca "Otro" y escribe el problema ahí — y entonces "Otro" mezcla
   avisos buenos ("va en camino") con problemas, y nadie puede filtrar
   los pedidos que necesitan que alguien intervenga.

   Va en rojo medio, no en el rojo fuerte de borrar: es un aviso, no una
   destrucción. Y pide escribir qué se observó, porque un pedido marcado
   como observado sin decir por qué obliga a llamar para averiguarlo,
   que es justo lo que estos estados vinieron a evitar.

   El estado `observado` ya existía en la app desde antes y cuenta como
   pedido en curso: no cierra nada, avisa.
   --------------------------------------------------------------- */
(function observadoV71(){
  if(typeof AVANCE_V60 === "undefined") return;
  if(AVANCE_V60.some(function(o){ return o.e === "observado"; })) return;

  AVANCE_V60.push({e:"observado", ic:"alerta", t:"Observado",
                   d:"Algo está mal con este pedido"});

  var s = document.createElement("style");
  s.id = "estilos-v71";
  s.textContent =
    '.avance-op[data-avance="observado"]{border-color:#e8a3a0;color:#b42318;' +
      "background:#fdf3f2}" +
    '.avance-op[data-avance="observado"]:hover{background:#fbe9e7}' +
    '.avance-op[data-avance="observado"].on{background:#b42318;border-color:#b42318;color:#fff}';
  document.head.appendChild(s);

  /* Observado pide el motivo, igual que "Otro": marcarlo sin decir qué
     pasa obliga a llamar para averiguarlo. */
  var marcarSinObservado = marcarAvanceV60;
  marcarAvanceV60 = function(id, estado){
    if(estado !== "observado") return marcarSinObservado.apply(this, arguments);

    var r = db.requerimientos.find(function(x){ return x.id === id; });
    if(!r) return;
    pedirTexto("¿Qué se observó?", "Por ejemplo: llegaron 8 de 24, el resto sin fecha")
      .then(function(txt){
        if(txt == null || !String(txt).trim()) return;
        var nota = String(txt).trim();
        historia(r, "observado", nota);
        r.avanceNota = nota;
        log("pedidos", "Pedido observado", r.codigo + " · " + nota, r.id);
        notificar({roles:["compras","jefatura","admin"], usuarios:[r.solicitanteId],
          titulo:"Pedido observado: " + r.codigo,
          cuerpo:nota + "\nObservado por " + usuarioActual().nombre + ".",
          refTipo:"requerimiento", refId:r.id, prioridad:"Alta"});
        if(!guardar()) return;
        snack("Pedido marcado como observado.", "");
        cerrarHoja();
        refrescar(pantalla);
      });
  };
})();

/* ---------------------------------------------------------------
   V72  Que las descargas bajen de verdad

   "Descargar plantilla" avisaba que descargaba y no descargaba nada.

   La causa está en `descargarBlob`, que arma un enlace y le hace click
   sin haberlo puesto nunca en la página. Un enlace suelto —que no está
   en el documento— lo ignoran varios navegadores, y otros lo respetan
   solo a veces: por eso a mí me funcionaba probándolo y a la obra no.
   No hay error en consola; simplemente no pasa nada.

   El arreglo va en `descargarBlob` y no solo en la plantilla, porque de
   ahí salen TODAS las descargas de la app: los reportes, el kardex, el
   consolidado, el respaldo. Todas tenían el mismo problema latente.

   Además queda una salida por si el navegador igual la bloquea (pasa
   dentro de la app instalada en el celular): se abre el archivo en una
   pestaña, donde se puede guardar a mano. Vale más eso que un botón que
   no hace nada.
   --------------------------------------------------------------- */
(function descargasFirmesV72(){
  if(typeof descargarBlob !== "function") return;

  window.descargarBlob = function(nombre, blob){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.rel = "noopener";
    a.style.display = "none";
    /* EN la página: un enlace suelto no dispara la descarga */
    document.body.appendChild(a);
    try{
      a.click();
    }catch(e){
      window.open(url, "_blank");
    }
    setTimeout(function(){
      if(a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
    return url;
  };

  /* Para la plantilla, además, una salida si el navegador la bloquea:
     el formato es público, así que abrirlo en una pestaña alcanza para
     guardarlo. Se ofrece solo si al soltar el click no pasó nada. */
  if(typeof plantillaRequerimiento === "function"){
    var bajarV72 = plantillaRequerimiento;
    plantillaRequerimiento = function(){
      var r = bajarV72.apply(this, arguments);
      var b = document.getElementById("mr-importe");
      if(b){
        b.className = "ayuda";
        b.innerHTML = 'Si no aparece el archivo, <a href="' + FORMATO_REQ_V54 +
          '" target="_blank" rel="noopener" style="color:var(--pri);font-weight:600">' +
          "ábralo acá</a> y guárdelo.";
      }
      return r;
    };
  }
})();
