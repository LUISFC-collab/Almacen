/* =====================================================================
   ALMACÉN CPQ · NÚCLEO

   Los datos, el acceso por fotocheck, las unidades, la lectura y la
   escritura de Excel, y el puente entre consolidado e inventario.

   Los dos archivos comparten variables a propósito: por eso no van
   envueltos en una función. El orden importa — este primero.
   ===================================================================== */
"use strict";

var CLAVE = "almacen_simple_v1";
var $ = function(id){ return document.getElementById(id); };
var esc = function(t){ return String(t == null ? "" : t)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };
var num = function(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; };
var hoy = function(){ var d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
var fecha = function(iso){ if(!iso) return "—";
  var d = new Date(iso); if(isNaN(d)) return String(iso).slice(0,10);
  return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getFullYear()).slice(2); };
var uid = function(){ return "x" + (contador++) + "-" + Math.floor(performance.now()*1000); };
var contador = 1;

/* ============ datos ============ */
function semilla(){
  var cons = [
    ["R01-001","Contenedores de 20 pies","und",3],
    ["R01-002","Radio de comunicación con señal interna de MY","und",1],
    ["R01-003","Escritorios","und",5],
    ["R01-004","Sillas para escritorios","und",5],
    ["R01-005","Martillo para demolición, marca HILTI","und",1],
    ["R01-006","Parihuela de madera","und",4],
    ["R01-007","Cilindro negro con tapa de geomembrana","und",1],
    ["R01-008","Separadores Artesco index","und",7],
    ["R01-009","Armella cerrada de 1/2","und",20],
    ["R01-010","Candado de 20 mm","und",3],
    ["R01-011","Escoba","und",3],
    ["R01-012","Recogedor","und",3]
  ].map(function(f){
    return {id:uid(), codigo:f[0], desc:f[1], unidad:f[2], requerido:f[3], comprado:0, entregado:0};
  });

  return {
    obra:"Reposición del sistema de floculante",
    area:"Proyectos de Capital Sostenible",
    serie:"EG07", correlativo:282,
    consolidado:cons,
    materiales:[
      {id:uid(), nombre:"Escoba", unidad:"und", stock:2},
      {id:uid(), nombre:"Recogedor", unidad:"und", stock:1},
      {id:uid(), nombre:"Candado de 20 mm", unidad:"und", stock:0}
    ],
    herramientas:[
      {id:uid(), nombre:"Amoladora 7\"", estado:"disponible", prestamo:null},
      {id:uid(), nombre:"Taladro percutor", estado:"disponible", prestamo:null},
      {id:uid(), nombre:"Llave de torque 1/2\"", estado:"disponible", prestamo:null}
    ],
    usuarios:[],
    requerimientos:[],
    guias:[
      {id:uid(), numero:"EG07 - 00000282", fecha:"2026-08-13", transportista:"", estado:"en_camino",
       lineas:[
         {desc:"Separadores Artesco index", unidad:"und", cant:7, codigo:"R01-008"},
         {desc:"Armella cerrada de 1/2",    unidad:"und", cant:20, codigo:"R01-009"},
         {desc:"Candado de 20 mm",          unidad:"und", cant:3,  codigo:"R01-010"},
         {desc:"Escoba",                    unidad:"und", cant:3,  codigo:"R01-011"},
         {desc:"Recogedor",                 unidad:"und", cant:3,  codigo:"R01-012"}
       ]}
    ],
    movimientos:[]
  };
}

var db;
try{ db = JSON.parse(localStorage.getItem(CLAVE)) || semilla(); }catch(e){ db = semilla(); }
if(!db.consolidado) db = semilla();
if(!db.usuarios) db.usuarios = [];
function guardar(){ try{ localStorage.setItem(CLAVE, JSON.stringify(db)); }catch(e){} }

function aviso(t){
  var a = $("aviso-flotante");
  a.textContent = t; a.classList.add("ver");
  clearTimeout(a._t); a._t = setTimeout(function(){ a.classList.remove("ver"); }, 2600);
}

/* ---- el puente entre consolidado, inventario y kardex ---- */
function clave(t){ return String(t||"").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim(); }

function buscarConsolidado(desc, codigo){
  var i;
  if(codigo) for(i=0;i<db.consolidado.length;i++)
    if(db.consolidado[i].codigo === codigo) return db.consolidado[i];
  for(i=0;i<db.consolidado.length;i++)
    if(clave(db.consolidado[i].desc) === clave(desc)) return db.consolidado[i];
  return null;
}
function buscarMaterial(desc){
  for(var i=0;i<db.materiales.length;i++)
    if(clave(db.materiales[i].nombre) === clave(desc)) return db.materiales[i];
  return null;
}
function mover(tipo, desc, unidad, cant, doc, persona){
  var m = buscarMaterial(desc);
  if(!m){
    m = {id:uid(), nombre:desc, unidad:unidad||"und", stock:0};
    db.materiales.push(m);
  }
  var delta = tipo === "ingreso" ? cant : -cant;
  if(m.stock + delta < 0) throw new Error("No alcanza el stock de " + desc + ": hay " + m.stock + " " + m.unidad + ".");
  m.stock = Math.round((m.stock + delta) * 100) / 100;
  db.movimientos.unshift({id:uid(), fecha:new Date().toISOString(), tipo:tipo, item:desc,
    cant:cant, unidad:m.unidad, saldo:m.stock, doc:doc||"", persona:persona||""});
  var c = buscarConsolidado(desc);
  if(c){
    if(tipo === "ingreso") c.comprado = Math.min(c.requerido, Math.round((c.comprado+cant)*100)/100);
    else c.entregado = Math.min(c.comprado, Math.round((c.entregado+cant)*100)/100);
  }
  return m;
}

/* ============ secciones ============ */
/* Las unidades que se usan en obra. La lista se puede ampliar desde la
   propia pantalla: lo que se agregue queda guardado para la próxima. */
var UNIDADES_BASE = [
  "und","par","jgo","doc","mll",
  "m","m2","m3","rll","var","pln",
  "kg","t","L","gal",
  "cja","bls","paq","bld","sac","tbo"
];
var NOMBRE_UNIDAD = {
  und:"Unidad", par:"Par", jgo:"Juego", doc:"Docena", mll:"Millar",
  m:"Metro", m2:"Metro cuadrado", m3:"Metro cúbico", rll:"Rollo",
  var:"Varilla", pln:"Plancha", kg:"Kilogramo", t:"Tonelada",
  L:"Litro", gal:"Galón", cja:"Caja", bls:"Bolsa", paq:"Paquete",
  bld:"Balde", sac:"Saco", tbo:"Tubo"
};
/* En el Excel de la obra la misma unidad viene escrita de siete maneras:
   und, Und, UND, und., U... Todas apuntan a lo mismo. Aquí se unifican
   al cargar, así el inventario no termina con «Mts» y «m» por separado. */
var ALIAS_UNIDAD = {
  u:"und", un:"und", uni:"und", unid:"und", unidad:"und", unidades:"und", pza:"und", pzas:"und",
  par:"par", pares:"par",
  jgo:"jgo", jgos:"jgo", jgs:"jgo", juego:"jgo", juegos:"jgo",
  doc:"doc", docena:"doc", docenas:"doc",
  mll:"mll", millar:"mll", millares:"mll",
  m:"m", mt:"m", mtr:"m", mtrs:"m", mts:"m", metro:"m", metros:"m", ml:"m",
  m2:"m2", metrocuadrado:"m2", m3:"m3", metrocubico:"m3",
  rll:"rll", rollo:"rll", rollos:"rll",
  var:"var", varilla:"var", varillas:"var",
  pln:"pln", plancha:"pln", planchas:"pln",
  kg:"kg", kilo:"kg", kilos:"kg", kilogramo:"kg", kilogramos:"kg",
  t:"t", tn:"t", tonelada:"t", toneladas:"t",
  l:"L", lt:"L", lts:"L", litro:"L", litros:"L",
  gal:"gal", galon:"gal", galones:"gal",
  cja:"cja", caja:"cja", cajas:"cja",
  bls:"bls", bolsa:"bls", bolsas:"bls",
  paq:"paq", paquete:"paq", paquetes:"paq", pack:"paq", packs:"paq", pq:"paq",
  bld:"bld", balde:"bld", baldes:"bld",
  sac:"sac", saco:"sac", sacos:"sac",
  tbo:"tbo", tubo:"tbo", tubos:"tbo"
};
function normalizarUnidad(u){
  var t = String(u == null ? "" : u).trim();
  if(!t) return "und";
  var k = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
  if(ALIAS_UNIDAD[k]) return ALIAS_UNIDAD[k];
  /* «UND», «Und» y «und.» son la misma que «und»: se compara sin mayúsculas
     ni puntos contra la lista buena antes de darla por desconocida. */
  for(var i = 0; i < UNIDADES_BASE.length; i++){
    if(UNIDADES_BASE[i].toLowerCase() === k) return UNIDADES_BASE[i];
  }
  return t;
}

function unidades(){
  db.unidades = db.unidades || [];
  return UNIDADES_BASE.concat(db.unidades.filter(function(u){
    return UNIDADES_BASE.indexOf(u) < 0; }));
}
function opcionesUnidad(sel){
  return unidades().map(function(u){
    return '<option value="' + esc(u) + '"' + (u === sel ? " selected" : "") + ">" +
      esc(NOMBRE_UNIDAD[u] || u) + " (" + esc(u) + ")</option>";
  }).join("") + '<option value="__otra">Otra unidad…</option>';
}
function nuevaUnidad(){
  var u = prompt("¿Qué unidad? Escríbala corta, como se anota en la guía (ej. mll, rll, cil)");
  if(!u) return null;
  u = normalizarUnidad(u);
  if(!u) return null;
  db.unidades = db.unidades || [];
  if(unidades().indexOf(u) < 0){ db.unidades.push(u); guardar(); }
  return u;
}

var SEC = [
  {k:"requisito",  t:"Requisito",  ic:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'},
  {k:"ingreso",    t:"Ingreso",    ic:'<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>'},
  {k:"salida",     t:"Salida",     ic:'<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'},
  {k:"prestamo",   t:"Préstamo",   ic:'<path d="M14.7 6.3a4 4 0 0 0 5 5L15 16l-3.5 3.5a2.1 2.1 0 0 1-3-3L12 13z"/>'},
  {k:"inventario", t:"Inventario", ic:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'},
  {k:"consolidado",t:"Consolidado",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>'},
  {k:"kardex",     t:"Kardex",     ic:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'}
];
SEC.push(
  {k:"puestos", t:"Puestos", ic:'<path d="M17 20a5 5 0 0 0-10 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M20 20a4 4 0 0 0-3-3.8"/>'},
  {k:"revisar",  t:"Revisar", ic:'<path d="M9 11l2 2 4-4"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'},
  {k:"despachar",t:"Despachar",  ic:'<path d="M3 12h11M10 6l6 6-6 6M17 5v14"/>'},
  {k:"guia",     t:"Guía",       ic:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'},
  {k:"comprar",  t:"Comprar",    ic:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L22 7H6"/>'},
  {k:"mispedidos",t:"Mis pedidos",ic:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'}
);

/* El administrador de la aplicación es uno solo, y se reconoce por su
   fotocheck. No aparece en la lista de puestos al registrarse: quien se
   dé de alta con este número lo recibe; cualquier otro, no.
   Para pasarlo a otra persona, cambie el número de aquí abajo. */
var FOTOCHECK_DUENO = "1352992";

var PUESTOS = [
  {k:"almacenero", t:"Almacenero", d:"Recibe, entrega, presta y lleva el kardex",
   ic:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', destacado:true},
  {k:"obra", t:"Administradora de Obra", d:"Revisa todo pedido y controla el consolidado",
   ic:'<path d="M9 11l2 2 4-4"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'},
  {k:"jefatura", t:"Jefe de Logística", d:"Da el visto bueno, despacha y emite la guía",
   ic:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'},
  {k:"compras", t:"Asistente de Logística", d:"Compra lo aprobado y despacha a la mina",
   ic:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L22 7H6"/>'},
  {k:"supervisor", t:"Supervisor", d:"Pide materiales y sigue sus pedidos",
   ic:'<path d="M12 2 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7z"/>'},
  {k:"capataz", t:"Capataz", d:"Consulta qué material hay en obra",
   ic:'<path d="M17 20a5 5 0 0 0-10 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>'},
  {k:"admin", t:"Administrador de la app", d:"Ve todo y entra como cualquier puesto",
   ic:'<path d="M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5z"/><path d="m9 12 2 2 4-4"/>',
   admin:true}
];
var NOMBRE_PUESTO = {};
PUESTOS.forEach(function(p){ NOMBRE_PUESTO[p.k] = p.t; });

/* Qué ve cada cargo, en su orden */
/* El consolidado lo ven todos los que deciden algo sobre el material:
   es la única lista donde se ve qué se pidió, qué llegó y qué falta.
   Si logística no lo ve, compra a ciegas; si el almacén no lo ve, no
   sabe a qué renglón pertenece lo que está recibiendo. */
var PANEL = {
  almacenero:["requisito","ingreso","salida","prestamo","inventario","consolidado","kardex"],
  obra:      ["revisar","requisito","consolidado","inventario","kardex"],
  jefatura:  ["revisar","despachar","guia","consolidado","inventario"],
  compras:   ["comprar","despachar","consolidado","inventario"],
  supervisor:["requisito","mispedidos","inventario"],
  capataz:   ["inventario"],
  admin:     ["puestos","consolidado","inventario","kardex"]
};

var TITULO = {
  requisito:"Requisito de materiales", ingreso:"Ingreso por guía",
  salida:"Salida al frente", prestamo:"Préstamo de herramientas",
  inventario:"Inventario del almacén", consolidado:"Consolidado de obra",
  kardex:"Kardex de movimientos", revisar:"Requisitos por revisar",
  despachar:"Despachar a obra", guia:"Guías emitidas",
  comprar:"Comprar lo aprobado", mispedidos:"Mis pedidos",
  puestos:"Los puestos de la obra"
};
var cargo = "almacenero";
var actual = PANEL[cargo][0];

function pintarMenu(){
  var pend = 0, i;
  for(i=0;i<db.guias.length;i++) if(db.guias[i].estado === "en_camino") pend++;
  var vencidos = 0;
  for(i=0;i<db.herramientas.length;i++){
    var h = db.herramientas[i];
    if(h.prestamo && h.prestamo.devolucion && h.prestamo.devolucion < hoy()) vencidos++;
  }
  var permitidas = PANEL[cargo];
  $("menu").innerHTML = SEC.filter(function(s){ return permitidas.indexOf(s.k) >= 0; })
    .sort(function(a,b){ return permitidas.indexOf(a.k) - permitidas.indexOf(b.k); })
    .map(function(s){
    var g = 0;
    if(s.k === "ingreso") g = pend;
    else if(s.k === "prestamo") g = vencidos;
    else if(s.k === "revisar") g = db.requerimientos.filter(function(r){
      return cargo === "obra" ? r.estado === "pendiente" : r.estado === "en_logistica"; }).length;
    else if(s.k === "comprar") g = db.requerimientos.filter(function(r){
      return r.estado === "aprobado"; }).length;
    return '<button class="opcion" type="button" data-sec="' + s.k + '"' +
      (s.k === actual ? ' aria-current="true"' : "") + ">" +
      '<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + s.ic + "</svg></span>" +
      "<b>" + s.t + "</b>" + (g ? '<span class="glob">' + g + "</span>" : "") + "</button>";
  }).join("");
  var bs = $("menu").querySelectorAll("[data-sec]");
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){ ir(this.dataset.sec); });
}

function ir(sec){
  actual = sec;
  $("titulo").textContent = TITULO[sec];
  pintarMenu();
  VISTA[sec]();
  window.scrollTo(0,0);
}

var VISTA = {};




/* ---------- foto, opcional ----------
   Una foto de celular pesa 3 MB y aquí se guardan en el propio equipo.
   Se reduce a 900 px y se comprime: queda en unos 80 KB, suficiente para
   reconocer la herramienta o el material, sin llenar la memoria. */
function prepararFoto(archivo, listo){
  var lector = new FileReader();
  lector.onload = function(){
    var img = new Image();
    img.onload = function(){
      var max = 900, an = img.width, al = img.height;
      if(an > max || al > max){
        if(an > al){ al = Math.round(al * max / an); an = max; }
        else { an = Math.round(an * max / al); al = max; }
      }
      var c = document.createElement("canvas");
      c.width = an; c.height = al;
      c.getContext("2d").drawImage(img, 0, 0, an, al);
      listo(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = function(){ listo(null); };
    img.src = lector.result;
  };
  lector.readAsDataURL(archivo);
}

/* Campo de foto: se pinta donde se le diga y guarda en una variable */
function campoFoto(id, etiqueta){
  return '<div class="campo"><span>' + etiqueta + " <em style='font-weight:400;" +
    "text-transform:none;letter-spacing:0;color:var(--tinta3)'>· opcional</em></span>" +
    '<input type="file" id="' + id + '" accept="image/*" capture="environment" hidden>' +
    '<button class="bt" type="button" id="' + id + '-bt" style="justify-content:flex-start">' +
    "Tomar o elegir foto</button>" +
    '<div id="' + id + '-vista"></div></div>';
}

var fotos = {};
function enlazarFoto(id){
  var inp = $(id), bt = $(id + "-bt"), vista = $(id + "-vista");
  if(!inp || !bt) return;
  bt.addEventListener("click", function(){ inp.click(); });
  inp.addEventListener("change", function(e){
    var a = e.target.files && e.target.files[0];
    if(!a) return;
    prepararFoto(a, function(dato){
      if(!dato) return aviso("No se pudo leer esa imagen.");
      fotos[id] = dato;
      vista.innerHTML = '<div style="margin-top:9px;display:flex;align-items:center;gap:10px">' +
        '<img src="' + dato + '" alt="" style="width:66px;height:66px;object-fit:cover;' +
        'border-radius:10px;border:1px solid var(--linea)">' +
        '<button class="bt chico" type="button" id="' + id + '-quitar">Quitar la foto</button></div>';
      $(id + "-quitar").addEventListener("click", function(){
        fotos[id] = null; vista.innerHTML = ""; inp.value = "";
      });
    });
  });
}

function miniFoto(dato){
  if(!dato) return "";
  return '<img src="' + dato + '" alt="foto" data-ver="' + dato +
    '" style="width:34px;height:34px;object-fit:cover;border-radius:7px;' +
    'border:1px solid var(--linea);cursor:pointer;vertical-align:middle">';
}
function verFotos(){
  var ims = window.document.querySelectorAll("[data-ver]"), i;
  for(i=0;i<ims.length;i++) ims[i].addEventListener("click", function(){
    var v = window.document.createElement("div");
    v.style.cssText = "position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.9);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out";
    v.innerHTML = '<img src="' + this.dataset.ver + '" alt="" style="max-width:100%;' +
      'max-height:100%;border-radius:12px">';
    v.addEventListener("click", function(){ v.remove(); });
    window.document.body.appendChild(v);
  });
}

/* ---------- escribir el Excel del requisito ----------
   Un .xlsx es un zip con XML adentro. Se arma a mano, sin comprimir
   (método 0, que el formato admite), así no hace falta ninguna librería
   ni que el navegador traiga CompressionStream. */
var TABLA_CRC = (function(){
  var t = new Uint32Array(256), c, n, k;
  for(n = 0; n < 256; n++){
    c = n;
    for(k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  var c = 0xFFFFFFFF;
  for(var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function armarZip(archivos){
  var cod = new TextEncoder(), partes = [], central = [], desp = 0;
  archivos.forEach(function(a){
    var nombre = cod.encode(a.nombre), datos = cod.encode(a.texto), c = crc32(datos);
    var loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true);
    loc.setUint16(6, 0, true); loc.setUint16(8, 0, true);        /* sin comprimir */
    loc.setUint16(10, 0, true); loc.setUint16(12, 0, true);
    loc.setUint32(14, c, true);
    loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true);
    loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nombre, datos);

    var cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true); cen.setUint16(14, 0, true);
    cen.setUint32(16, c, true);
    cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nombre.length, true);
    cen.setUint32(42, desp, true);
    central.push(new Uint8Array(cen.buffer), nombre);
    desp += 30 + nombre.length + datos.length;
  });

  var tamCentral = central.reduce(function(t, p){ return t + p.length; }, 0);
  var fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, desp, true);

  return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]),
    {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function letraCol(n){
  var s = "";
  n++;
  while(n > 0){ var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}
function xmlSeguro(t){
  return String(t == null ? "" : t)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");
}

/* filas: matriz. estilos: números de fila (base 1) que van en negrita */
function crearXLSX(filas, estilos, anchos){
  estilos = estilos || [];
  var hoja = "";
  filas.forEach(function(fila, i){
    var celdas = "";
    (fila || []).forEach(function(v, c){
      if(v === "" || v == null) return;
      var ref = letraCol(c) + (i + 1);
      var est = estilos.indexOf(i + 1) >= 0 ? ' s="1"' : "";
      if(typeof v === "number" && isFinite(v))
        celdas += '<c r="' + ref + '"' + est + "><v>" + v + "</v></c>";
      else
        celdas += '<c r="' + ref + '" t="inlineStr"' + est +
                  "><is><t xml:space=\"preserve\">" + xmlSeguro(v) + "</t></is></c>";
    });
    hoja += '<row r="' + (i + 1) + '">' + celdas + "</row>";
  });

  var cols = "";
  if(anchos && anchos.length){
    cols = "<cols>" + anchos.map(function(a, i){
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>';
    }).join("") + "</cols>";
  }

  return armarZip([
    {nombre:"[Content_Types].xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>"},
    {nombre:"_rels/.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/workbook.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Requerimiento" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {nombre:"xl/_rels/workbook.xml.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/styles.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="2"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/></cellXfs>' +
      "</styleSheet>"},
    {nombre:"xl/worksheets/sheet1.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + "<sheetData>" + hoja + "</sheetData></worksheet>"}
  ]);
}

function bajarBlob(nombre, blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}

/* El requisito, con la cabecera y las filas en blanco de la plantilla */
function excelRequisito(r){
  var filas = [
    ["REQUERIMIENTO DE MATERIALES"],
    [],
    ["Obra:", db.obra, "", "", "", "FECHA DE SOLICITUD:", fecha(r.fecha)],
    ["ÁREA :", r.area || db.area, "", "", "", "FECHA DE ENTREGA:", ""],
    ["SUPERVISOR :", r.solicitante],
    [],
    ["N°","DESCRIPCIÓN","UND","CANTIDAD","ENTREGA","ENTREGA","LUGAR/FRENTE","AUTORIZADO","OBSERVACIONES"],
    ["","","","SOLICITADA","PARCIAL","TOTAL","",""]
  ];
  r.items.forEach(function(i, n){
    filas.push([n + 1, i.desc, i.und || "und", num(i.cant), "", "",
                i.frente || r.frente || "", "", i.obs || ""]);
  });
  /* filas en blanco hasta 15, como en la plantilla impresa */
  for(var n = r.items.length; n < 15; n++) filas.push([n + 1, "", "", "", "", "", "", "", ""]);

  return crearXLSX(filas, [1, 7, 8], [6, 46, 8, 12, 12, 12, 18, 14, 30]);
}

/* ---------- leer el Excel del requerimiento ----------
   Un .xlsx es un zip con las celdas en XML. Se descomprime con lo que
   el propio navegador trae, sin librerías. También acepta .csv, que es
   lo que sale cuando alguien guarda la plantilla desde el celular. */
function inflar(bytes){
  if(typeof DecompressionStream === "undefined")
    return Promise.reject(new Error("Este navegador no puede abrir .xlsx. Guarde la plantilla como CSV."));
  var flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(flujo).arrayBuffer().then(function(b){ return new Uint8Array(b); });
}

function abrirZip(buffer){
  var d = new DataView(buffer), u8 = new Uint8Array(buffer);
  var fin = -1;
  for(var i = buffer.byteLength - 22; i >= 0; i--){
    if(d.getUint32(i, true) === 0x06054b50){ fin = i; break; }
  }
  if(fin < 0) return Promise.reject(new Error("El archivo no parece un Excel."));
  var total = d.getUint16(fin + 10, true), ini = d.getUint32(fin + 16, true);
  var archivos = [], p = ini, dec = new TextDecoder();
  for(var n = 0; n < total; n++){
    var nl = d.getUint16(p + 28, true), el = d.getUint16(p + 30, true),
        cl = d.getUint16(p + 32, true), off = d.getUint32(p + 42, true);
    var nombre = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    archivos.push({nombre:nombre, off:off});
    p += 46 + nl + el + cl;
  }
  return Promise.all(archivos.map(function(a){
    var nl2 = d.getUint16(a.off + 26, true), el2 = d.getUint16(a.off + 28, true);
    var metodo = d.getUint16(a.off + 8, true);
    var tam = d.getUint32(a.off + 18, true);
    var datos = u8.subarray(a.off + 30 + nl2 + el2, a.off + 30 + nl2 + el2 + tam);
    if(metodo === 0) return Promise.resolve({nombre:a.nombre, texto:dec.decode(datos)});
    return inflar(datos).then(function(x){ return {nombre:a.nombre, texto:dec.decode(x)}; });
  })).then(function(lista){
    var mapa = {};
    lista.forEach(function(f){ mapa[f.nombre] = f.texto; });
    return mapa;
  });
}

function filasDeXLSX(mapa){
  var sst = [];
  if(mapa["xl/sharedStrings.xml"]){
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while((m = re.exec(mapa["xl/sharedStrings.xml"]))){
      var t = "", rt = /<t[^>]*>([\s\S]*?)<\/t>/g, x;
      while((x = rt.exec(m[1]))) t += x[1];
      sst.push(t.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
    }
  }
  var nombreHoja = null;
  for(var k in mapa){ if(/^xl\/worksheets\/sheet\d+\.xml$/.test(k)){ nombreHoja = k; break; } }
  if(!nombreHoja) throw new Error("El Excel no tiene hojas legibles.");
  var hoja = mapa[nombreHoja], filas = [];
  var rf = /<row[^>]*>([\s\S]*?)<\/row>/g, fr;
  while((fr = rf.exec(hoja))){
    var celdas = [], rc = /<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g, c;
    while((c = rc.exec(fr[1]))){
      var col = 0, letras = c[1];
      for(var i = 0; i < letras.length; i++) col = col * 26 + (letras.charCodeAt(i) - 64);
      col--;
      var tipo = /t="(\w+)"/.exec(c[2]);
      var v = /<v>([\s\S]*?)<\/v>/.exec(c[3]);
      var valor = "";
      if(tipo && tipo[1] === "s" && v) valor = sst[+v[1]] || "";
      else if(v) valor = v[1];
      else {
        var inl = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3]);
        if(inl) valor = inl[1];
      }
      celdas[col] = String(valor).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
    }
    filas.push(celdas);
  }
  return filas;
}

function filasDeCSV(texto){
  return texto.split(/\r?\n/).filter(function(l){ return l.trim(); })
    .map(function(l){
      var sep = (l.split(";").length > l.split(",").length) ? ";" : ",";
      return l.split(sep).map(function(c){ return c.replace(/^"|"$/g,"").trim(); });
    });
}

/* Busca la fila de encabezados y saca descripción, unidad y cantidad */
function importarFilas(filas){
  var iCab = -1, col = {};
  for(var i = 0; i < Math.min(filas.length, 20); i++){
    var f = filas[i] || {}, prueba = {};
    for(var c = 0; c < (f.length || 0); c++){
      var t = clave(f[c]);
      if(!t) continue;
      if(/^descripcion|^material|^detalle/.test(t) && prueba.desc === undefined) prueba.desc = c;
      else if(/^und|^unidad/.test(t) && prueba.und === undefined) prueba.und = c;
      else if(/^cantidad|^cant|^solicitada/.test(t) && prueba.cant === undefined) prueba.cant = c;
      else if(/lugar|frente/.test(t) && prueba.frente === undefined) prueba.frente = c;
      else if(/observacion/.test(t) && prueba.obs === undefined) prueba.obs = c;
    }
    if(prueba.desc !== undefined){ iCab = i; col = prueba; break; }
  }
  if(iCab < 0) throw new Error('No encontré la columna "Descripción". Use la plantilla de la obra.');

  var sacados = [];
  for(var n = iCab + 1; n < filas.length; n++){
    var fila = filas[n] || [];
    var desc = String(fila[col.desc] == null ? "" : fila[col.desc]).trim();
    if(!desc) continue;
    if(/^(total|firma|elaborado|revisado|aprobado)/i.test(desc)) break;
    var cant = col.cant === undefined ? 0 : num(fila[col.cant]);
    sacados.push({
      desc: desc,
      und: normalizarUnidad(col.und === undefined ? "" : fila[col.und]),
      cant: cant > 0 ? cant : "",
      frente: col.frente === undefined ? "" : String(fila[col.frente] || "").trim(),
      obs: col.obs === undefined ? "" : String(fila[col.obs] || "").trim()
    });
  }
  if(!sacados.length) throw new Error("No encontré ninguna fila con material.");
  return sacados;
}

function cargarExcel(archivo){
  var lector = new FileReader();
  lector.onload = function(){
    try{
      var pedir = function(filas){
        var traidos = importarFilas(filas);
        /* las unidades que vengan y no estén en la lista, se agregan */
        db.unidades = db.unidades || [];
        traidos.forEach(function(t){
          if(t.und && unidades().indexOf(t.und) < 0) db.unidades.push(t.und);
        });
        var vacios = itemsReq.filter(function(i){ return String(i.desc).trim(); }).length === 0;
        if(vacios) itemsReq = [];
        traidos.forEach(function(t){ itemsReq.push(t); });
        guardar();
        pintarItems();
        aviso(traidos.length + " material(es) cargados de " + archivo.name + ".");
      };
      if(/\.csv$/i.test(archivo.name)){
        pedir(filasDeCSV(new TextDecoder().decode(new Uint8Array(lector.result))));
      } else {
        abrirZip(lector.result).then(function(mapa){ pedir(filasDeXLSX(mapa)); })
          .catch(function(e){ aviso(e.message); });
      }
    }catch(e){ aviso(e.message); }
  };
  lector.readAsArrayBuffer(archivo);
}

/* ---------- REQUISITO ---------- */
var itemsReq = [];
VISTA.requisito = function(){
  $("zona").innerHTML =
    '<div class="vista"><div class="tarjeta">' +
    "<h2>Nuevo requisito</h2>" +
    '<p class="nota">Lo que pide el frente. Se llena igual que la plantilla de la obra.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Solicitante</span><input id="rq-sol" placeholder="Ing. Ramos"></label>' +
      '<label class="campo"><span>Área</span><input id="rq-area" value="' + esc(db.area) + '"></label>' +
      '<label class="campo"><span>Lugar / frente</span><input id="rq-frente" placeholder="Poza 3"></label>' +
      '<label class="campo"><span>Fecha del pedido</span><input type="date" id="rq-fecha" value="' + hoy() + '" max="' + hoy() + '"></label>' +
    "</div>" +
    '<div class="botones"><button class="bt sec" type="button" id="rq-add">Agregar material</button>' +
    '<button class="bt" type="button" id="rq-excel">Subir desde Excel</button>' +
    '<input type="file" id="rq-archivo" accept=".xlsx,.csv" hidden>' +
    '<span class="der" id="rq-conteo"></span></div>' +
    '<div id="rq-items" style="margin-top:12px"></div>' +
    '<div class="botones"><button class="bt pri" type="button" id="rq-guardar">Registrar requisito</button></div>' +
    "</div>" +
    '<div class="tarjeta"><h2>Requisitos registrados</h2><div id="rq-lista"></div></div></div>';

  $("rq-add").addEventListener("click", function(){
    itemsReq.push({desc:"", und:"und", cant:"", frente:$("rq-frente").value, obs:""});
    pintarItems();
    var ults = $("rq-items").querySelectorAll('[data-c="desc"]');
    if(ults.length) ults[ults.length-1].focus();
  });
  $("rq-excel").addEventListener("click", function(){ $("rq-archivo").click(); });
  $("rq-archivo").addEventListener("change", function(e){
    var a = e.target.files && e.target.files[0];
    if(a) cargarExcel(a);
    e.target.value = "";
  });
  $("rq-guardar").addEventListener("click", guardarReq);
  if(!itemsReq.length) itemsReq.push({desc:"", und:"und", cant:"", frente:"", obs:""});
  pintarItems();
  pintarListaReq();
};

function pintarItems(){
  var html = '<div class="tabla-caja"><table><thead><tr>' +
    "<th>N°</th><th>Descripción</th><th>Und</th><th class='n'>Cantidad</th>" +
    "<th>Lugar / frente</th><th>Observaciones</th><th></th></tr></thead><tbody>";
  for(var i=0;i<itemsReq.length;i++){
    var it = itemsReq[i];
    html += "<tr><td class='n' style='color:var(--tinta3)'>" + (i+1) + "</td>" +
      '<td style="min-width:180px"><input data-i="' + i + '" data-c="desc" value="' + esc(it.desc) + '" placeholder="Material"></td>' +
      '<td style="width:140px"><select data-i="' + i + '" data-c="und">' +
        opcionesUnidad(it.und || "und") + "</select></td>" +
      '<td style="width:96px"><input class="n" type="number" min="0" step="0.01" data-i="' + i + '" data-c="cant" value="' + esc(it.cant) + '"></td>' +
      '<td style="min-width:130px"><input data-i="' + i + '" data-c="frente" value="' + esc(it.frente) + '"></td>' +
      '<td style="min-width:150px"><input data-i="' + i + '" data-c="obs" value="' + esc(it.obs) + '"></td>' +
      '<td><button class="bt chico" type="button" data-quitar="' + i + '">Quitar</button></td></tr>';
  }
  html += "</tbody></table></div>";
  $("rq-items").innerHTML = html;

  var ins = $("rq-items").querySelectorAll("input"), i2;
  for(i2=0;i2<ins.length;i2++) ins[i2].addEventListener("input", function(){
    itemsReq[+this.dataset.i][this.dataset.c] = this.value;
    contarReq();
  });
  var sels = $("rq-items").querySelectorAll("select");
  for(i2=0;i2<sels.length;i2++) sels[i2].addEventListener("change", function(){
    var n = +this.dataset.i;
    if(this.value === "__otra"){
      var u = nuevaUnidad();
      itemsReq[n].und = u || "und";
      pintarItems();
      return;
    }
    itemsReq[n].und = this.value;
  });
  var qs = $("rq-items").querySelectorAll("[data-quitar]");
  for(i2=0;i2<qs.length;i2++) qs[i2].addEventListener("click", function(){
    itemsReq.splice(+this.dataset.quitar,1); pintarItems();
  });
  contarReq();
}
function contarReq(){
  var n = 0;
  for(var i=0;i<itemsReq.length;i++) if(String(itemsReq[i].desc).trim()) n++;
  $("rq-conteo").textContent = n + (n === 1 ? " material" : " materiales");
}

function guardarReq(){
  var buenos = itemsReq.filter(function(i){ return String(i.desc).trim() && num(i.cant) > 0; });
  if(!buenos.length) return aviso("Agregue al menos un material con su cantidad.");
  var sol = $("rq-sol").value.trim();
  if(!sol) return aviso("Escriba quién lo pide.");

  var codigo = "REQ-" + String(db.requerimientos.length + 1).padStart(3,"0");
  db.requerimientos.unshift({
    id:uid(), codigo:codigo, fecha:$("rq-fecha").value || hoy(),
    solicitante:sol, area:$("rq-area").value.trim(), frente:$("rq-frente").value.trim(),
    estado:"pendiente",
    items:buenos.map(function(i){
      return {desc:i.desc.trim(), und:i.und||"und", cant:num(i.cant), frente:i.frente, obs:i.obs};
    })
  });

  /* El consolidado es la suma de lo que pide la obra: cada supervisor
     hace el suyo, así que un pedido nuevo de algo que ya figura le suma
     al requerido, no se descuenta de lo que ya estaba previsto. */
  var nuevos = 0, sumados = 0;
  buenos.forEach(function(i){
    var c = buscarConsolidado(i.desc);
    if(c){
      c.requerido = Math.round((num(c.requerido) + num(i.cant)) * 100) / 100;
      c.pedidos = c.pedidos || [];
      c.pedidos.push({req:codigo, quien:sol, cant:num(i.cant), fecha:$("rq-fecha").value || hoy()});
      sumados++;
      return;
    }
    db.consolidado.push({id:uid(),
      codigo:"R01-" + String(db.consolidado.length + 1).padStart(3,"0"),
      desc:i.desc.trim(), unidad:i.und||"und", requerido:num(i.cant),
      comprado:0, entregado:0, adicional:true,
      pedidos:[{req:codigo, quien:sol, cant:num(i.cant), fecha:$("rq-fecha").value || hoy()}]});
    nuevos++;
  });

  guardar();
  var reg = db.requerimientos[0];
  try{
    bajarBlob("REQUISITO_" + codigo + ".xlsx", excelRequisito(reg));
  }catch(e){ /* si el navegador no deja bajar, el pedido igual quedó guardado */ }
  itemsReq = [{desc:"", und:"und", cant:"", frente:"", obs:""}];
  VISTA.requisito();
  var detalle = [];
  if(sumados) detalle.push(sumados + " sumado(s) al consolidado");
  if(nuevos)  detalle.push(nuevos + " nuevo(s) en el consolidado");
  aviso(codigo + " registrado · Excel descargado" +
        (detalle.length ? " · " + detalle.join(" · ") : "") + ".");
}

function pintarListaReq(){
  if(!db.requerimientos.length){
    $("rq-lista").innerHTML = '<div class="vacio">Todavía no hay requisitos.</div>'; return;
  }
  $("rq-lista").innerHTML = '<div class="tabla-caja"><table><thead><tr>' +
    "<th>Código</th><th>Fecha</th><th>Solicitante</th><th>Frente</th><th class='n'>Materiales</th><th></th>" +
    "</tr></thead><tbody>" +
    db.requerimientos.map(function(r){
      return "<tr><td><b>" + esc(r.codigo) + "</b></td><td>" + fecha(r.fecha) + "</td>" +
        "<td>" + esc(r.solicitante) + "</td><td>" + esc(r.frente || "—") + "</td>" +
        "<td class='n'>" + r.items.length + "</td>" +
        '<td style="width:1%"><button class="bt chico" type="button" data-xls="' + r.id +
        '">Excel</button></td></tr>';
    }).join("") + "</tbody></table></div>";

  var xs = $("rq-lista").querySelectorAll("[data-xls]"), i;
  for(i=0;i<xs.length;i++) xs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.xls; }.bind(this))[0];
    bajarBlob("REQUISITO_" + r.codigo + ".xlsx", excelRequisito(r));
    aviso("Excel de " + r.codigo + " descargado.");
  });
}

/* ---------- INGRESO ---------- */
var conteo = null;
VISTA.ingreso = function(){
  var enCamino = db.guias.filter(function(g){ return g.estado === "en_camino"; });
  var html = '<div class="vista">';

  if(!conteo){
    html += '<div class="tarjeta"><h2>Guías por recibir</h2>' +
      '<p class="nota">Elija la guía que bajó del camión. Los renglones ya vienen con su código.</p>';
    html += enCamino.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Guía</th><th>Fecha</th>' +
        "<th class='n'>Renglones</th><th></th></tr></thead><tbody>" +
        enCamino.map(function(g){
          return "<tr><td><b>" + esc(g.numero) + "</b></td><td>" + fecha(g.fecha) + "</td>" +
            "<td class='n'>" + g.lineas.length + "</td>" +
            '<td><button class="bt chico pri" type="button" data-abrir="' + g.id + '">Contar</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">No hay guías en camino.</div>';
    html += '<div class="botones"><button class="bt" type="button" id="in-sin">Recibir sin guía</button></div></div>';
  } else {
    html += '<div class="tarjeta"><h2>' + esc(conteo.numero || "Sin guía") + "</h2>" +
      '<p class="nota">Escriba lo que contó de verdad. Entra al almacén lo contado, no lo declarado.</p>' +
      '<div class="tabla-caja"><table><thead><tr><th>Material</th><th class="n">Guía dice</th>' +
      '<th class="n">Contado</th><th>Estado</th></tr></thead><tbody>' +
      conteo.lineas.map(function(l,i){
        return "<tr><td>" + esc(l.desc) + "</td>" +
          "<td class='n' style='color:var(--tinta2)'>" + l.cant + " " + esc(l.unidad) + "</td>" +
          '<td style="width:108px"><input class="n" type="number" min="0" step="0.01" data-l="' + i +
            '" value="' + (l.contado == null ? "" : l.contado) + '"></td>' +
          '<td data-est="' + i + '"></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<div class="botones"><button class="bt" type="button" id="in-volver">Volver</button>' +
      '<button class="bt pri" type="button" id="in-registrar">Registrar ingreso</button>' +
      '<span class="der" id="in-resumen"></span></div>' +
      '<div class="aviso"><p>Lo que falte queda pendiente en el consolidado y <b>no</b> entra al almacén.</p></div>' +
      "</div>";
  }
  html += "</div>";
  $("zona").innerHTML = html;

  var i;
  if(!conteo){
    var ab = $("zona").querySelectorAll("[data-abrir]");
    for(i=0;i<ab.length;i++) ab[i].addEventListener("click", function(){
      var g = db.guias.filter(function(x){ return x.id === this.dataset.abrir; }.bind(this))[0];
      conteo = {id:g.id, numero:g.numero, lineas:g.lineas.map(function(l){
        return {desc:l.desc, unidad:l.unidad, cant:l.cant, codigo:l.codigo, contado:null}; })};
      VISTA.ingreso();
    });
    $("in-sin").addEventListener("click", function(){
      conteo = {id:null, numero:"Sin guía", lineas:[]};
      var d = prompt("¿Qué material llegó?");
      if(!d){ conteo = null; return; }
      var c = prompt("¿Cuántos?");
      conteo.lineas.push({desc:d, unidad:"und", cant:num(c), codigo:"", contado:num(c)});
      VISTA.ingreso();
    });
  } else {
    var ins = $("zona").querySelectorAll("[data-l]");
    for(i=0;i<ins.length;i++) ins[i].addEventListener("input", function(){
      conteo.lineas[+this.dataset.l].contado = this.value === "" ? null : num(this.value);
      pintarEstados();
    });
    $("in-volver").addEventListener("click", function(){ conteo = null; VISTA.ingreso(); });
    $("in-registrar").addEventListener("click", registrarIngreso);
    pintarEstados();
  }
};

function pintarEstados(){
  var falta = 0, ok = 0, sin = 0;
  conteo.lineas.forEach(function(l,i){
    var td = $("zona").querySelector('[data-est="' + i + '"]');
    var t = "", c = "";
    if(l.contado == null){ t = "sin verificar"; c = "est-info"; sin++; }
    else if(l.contado >= l.cant){ t = "conforme"; c = "est-ok"; ok++; }
    else if(l.contado > 0){ t = "faltan " + Math.round((l.cant-l.contado)*100)/100; c = "est-alerta"; falta++; }
    else { t = "no llegó"; c = "est-mal"; falta++; }
    if(td) td.innerHTML = '<span class="marca-est ' + c + '">' + t + "</span>";
  });
  var r = $("in-resumen");
  if(r) r.textContent = ok + " conformes · " + falta + " con diferencia · " + sin + " sin verificar";
}

function registrarIngreso(){
  var entran = conteo.lineas.filter(function(l){ return l.contado > 0; });
  if(!entran.length) return aviso("No hay nada contado para registrar.");
  var faltan = conteo.lineas.filter(function(l){ return !l.contado || l.contado < l.cant; });
  if(faltan.length && !confirm(faltan.length + " renglón(es) no llegaron completos. ¿Registrar igual?")) return;

  try{
    entran.forEach(function(l){ mover("ingreso", l.desc, l.unidad, l.contado, conteo.numero, ""); });
  }catch(e){ return aviso(e.message); }

  if(conteo.id){
    var g = db.guias.filter(function(x){ return x.id === conteo.id; })[0];
    if(g) g.estado = faltan.length ? "parcial" : "recibida";
  }
  guardar();
  var n = entran.length;
  conteo = null;
  VISTA.ingreso(); pintarMenu();
  aviso(n + " material(es) al almacén" + (faltan.length ? " · " + faltan.length + " pendiente(s)" : "") + ".");
}

/* ---------- SALIDA ---------- */
VISTA.salida = function(){
  var conStock = db.materiales.filter(function(m){ return m.stock > 0; });
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Entregar al frente</h2>" +
    '<p class="nota">Descuenta del almacén y suma a lo entregado en el consolidado.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Material</span><select id="sa-mat">' +
        (conStock.length
          ? conStock.map(function(m){ return '<option value="' + esc(m.nombre) + '">' + esc(m.nombre) +
              " · " + m.stock + " " + esc(m.unidad) + "</option>"; }).join("")
          : '<option value="">No hay stock</option>') +
      "</select></label>" +
      '<label class="campo"><span>Cantidad</span><input class="n" type="number" min="0.01" step="0.01" id="sa-cant"></label>' +
      '<label class="campo"><span>Quién recibe</span><input id="sa-quien" placeholder="Nombre del trabajador"></label>' +
      '<label class="campo"><span>Lugar / frente</span><input id="sa-frente" placeholder="Poza 3"></label>' +
      campoFoto("sa-foto", "Foto del material") +
    "</div>" +
    '<div class="botones"><button class="bt pri" type="button" id="sa-ok">Registrar salida</button></div>' +
    "</div>" +
    '<div class="tarjeta"><h2>Últimas salidas</h2><div id="sa-lista"></div></div></div>';

  enlazarFoto("sa-foto");
  $("sa-ok").addEventListener("click", function(){
    var d = $("sa-mat").value, c = num($("sa-cant").value), q = $("sa-quien").value.trim();
    if(!d) return aviso("No hay material con stock.");
    if(c <= 0) return aviso("Escriba la cantidad.");
    if(!q) return aviso("Escriba quién recibe.");
    try{
      var mv = mover("salida", d, "", c, "", q);
      var ult = db.movimientos[0];
      ult.frente = $("sa-frente").value.trim();
      if(fotos["sa-foto"]) ult.foto = fotos["sa-foto"];
    }catch(e){ return aviso(e.message); }
    fotos["sa-foto"] = null;
    guardar(); VISTA.salida();
    aviso(c + " de " + d + " entregados a " + q + ".");
  });

  var sal = db.movimientos.filter(function(m){ return m.tipo === "salida"; }).slice(0,8);
  $("sa-lista").innerHTML = sal.length
    ? '<div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Material</th>' +
      "<th class='n'>Cantidad</th><th>Recibió</th></tr></thead><tbody>" +
      sal.map(function(m){ return "<tr><td>" + fecha(m.fecha) + "</td>" +
        "<td>" + miniFoto(m.foto) + " " + esc(m.item) + "</td>" +
        "<td class='n'>" + m.cant + " " + esc(m.unidad) + "</td><td>" + esc(m.persona) + "</td></tr>"; }).join("") +
      "</tbody></table></div>"
    : '<div class="vacio">Todavía no hay salidas.</div>';
  verFotos();
};

/* ---------- PRÉSTAMO ---------- */
/* Casi nadie se lleva una sola herramienta: el que viene por la amoladora
   se lleva también el disco y la llave. Por eso se arma una lista y todas
   salen juntas, a nombre de la misma persona y con la misma fecha. */
var seLlevan = [];
VISTA.prestamo = function(){
  var libres = db.herramientas.filter(function(h){
    return h.estado === "disponible" && seLlevan.indexOf(h.id) < 0; });
  var fuera = db.herramientas.filter(function(h){ return h.estado === "prestada"; });

  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Prestar herramientas</h2>" +
    '<p class="nota">Puede agregar varias a la vez: todas salen a nombre de la misma persona.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Responsable</span><input id="pr-quien" placeholder="Nombre y apellido" value="' +
        esc(window._prQuien || "") + '"></label>' +
      '<label class="campo"><span>Devuelve el</span><input type="date" id="pr-fecha" value="' +
        (window._prFecha || hoy()) + '"></label>' +
      campoFoto("pr-foto", "Foto de las herramientas") +
    "</div>" +
    '<div class="rejilla dos" style="margin-top:11px">' +
      '<label class="campo"><span>Herramienta</span><select id="pr-her">' +
        (libres.length ? libres.map(function(h){
            return '<option value="' + esc(h.id) + '">' + esc(h.nombre) + "</option>"; }).join("")
          : '<option value="">No queda ninguna disponible</option>') + "</select></label>" +
      '<div class="campo"><span>&nbsp;</span><button class="bt sec" type="button" id="pr-add">' +
        "Agregar herramienta</button></div>" +
    "</div>" +

    (seLlevan.length
      ? '<div class="tabla-caja" style="margin-top:13px"><table><thead><tr>' +
        "<th>Se lleva</th><th></th></tr></thead><tbody>" +
        seLlevan.map(function(id,i){
          var h = db.herramientas.filter(function(x){ return x.id === id; })[0];
          return "<tr><td><b>" + esc(h ? h.nombre : "—") + "</b></td>" +
            '<td style="width:1%"><button class="bt chico" type="button" data-quita="' + i +
            '">Quitar</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="aviso" style="margin-top:13px"><p>Agregue al menos una herramienta a la lista.</p></div>') +

    '<div class="botones"><button class="bt pri" type="button" id="pr-ok">' +
      "Registrar préstamo" + (seLlevan.length > 1 ? " de " + seLlevan.length : "") + "</button>" +
      '<span class="der">' + seLlevan.length + (seLlevan.length === 1 ? " herramienta" : " herramientas") + "</span></div>" +
    "</div>" +

    '<div class="tarjeta"><h2>Fuera del almacén</h2>' +
    (fuera.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Herramienta</th><th>Responsable</th>' +
        "<th>Devuelve</th><th></th></tr></thead><tbody>" +
        fuera.map(function(h){
          var tarde = h.prestamo.devolucion && h.prestamo.devolucion < hoy();
          return "<tr><td>" + miniFoto(h.prestamo.foto) + " <b>" + esc(h.nombre) + "</b></td>" +
            "<td>" + esc(h.prestamo.responsable) + "</td>" +
            "<td>" + fecha(h.prestamo.devolucion) +
            (tarde ? ' <span class="marca-est est-mal">vencida</span>' : "") + "</td>" +
            '<td style="width:1%"><button class="bt chico" type="button" data-dev="' + h.id +
            '">Devolver</button></td></tr>';
        }).join("") + "</tbody></table></div>" +
        (fuera.length > 1
          ? '<div class="botones"><button class="bt" type="button" id="pr-todas">' +
            "Devolver todas las de una persona</button></div>" : "")
      : '<div class="vacio">Todas las herramientas están en el almacén.</div>') + "</div></div>";

  var recordar = function(){
    window._prQuien = $("pr-quien").value;
    window._prFecha = $("pr-fecha").value;
  };
  enlazarFoto("pr-foto");
  if(fotos["pr-foto"]){
    var v = $("pr-foto-vista");
    if(v && !v.innerHTML) v.innerHTML =
      '<div style="margin-top:9px"><img src="' + fotos["pr-foto"] + '" alt="" ' +
      'style="width:66px;height:66px;object-fit:cover;border-radius:10px;border:1px solid var(--linea)"></div>';
  }
  $("pr-quien").addEventListener("input", recordar);
  $("pr-fecha").addEventListener("change", recordar);

  $("pr-add").addEventListener("click", function(){
    var id = $("pr-her").value;
    if(!id) return aviso("No queda ninguna herramienta disponible.");
    recordar();
    seLlevan.push(id);
    VISTA.prestamo();
  });

  var qs = $("zona").querySelectorAll("[data-quita]"), i;
  for(i=0;i<qs.length;i++) qs[i].addEventListener("click", function(){
    recordar(); seLlevan.splice(+this.dataset.quita,1); VISTA.prestamo();
  });

  $("pr-ok").addEventListener("click", function(){
    var q = $("pr-quien").value.trim();
    if(!seLlevan.length) return aviso("Agregue al menos una herramienta.");
    if(!q) return aviso("Escriba el nombre del responsable.");
    var f = $("pr-fecha").value, n = seLlevan.length;
    var img = fotos["pr-foto"] || null;
    seLlevan.forEach(function(id){
      var h = db.herramientas.filter(function(x){ return x.id === id; })[0];
      if(!h) return;
      h.estado = "prestada";
      h.prestamo = {responsable:q, salida:hoy(), devolucion:f, foto:img};
    });
    seLlevan = []; window._prQuien = ""; window._prFecha = ""; fotos["pr-foto"] = null;
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(n + (n === 1 ? " herramienta prestada a " : " herramientas prestadas a ") + q + ".");
  });

  var ds = $("zona").querySelectorAll("[data-dev]");
  for(i=0;i<ds.length;i++) ds[i].addEventListener("click", function(){
    var h = db.herramientas.filter(function(x){ return x.id === this.dataset.dev; }.bind(this))[0];
    h.estado = "disponible"; h.prestamo = null;
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(h.nombre + " de vuelta en el almacén.");
  });

  verFotos();

  if($("pr-todas")) $("pr-todas").addEventListener("click", function(){
    var quien = prompt("¿De quién son las herramientas que vuelven?");
    if(!quien) return;
    var n = 0;
    db.herramientas.forEach(function(h){
      if(h.estado === "prestada" && clave(h.prestamo.responsable) === clave(quien)){
        h.estado = "disponible"; h.prestamo = null; n++;
      }
    });
    if(!n) return aviso("No hay herramientas a nombre de " + quien + ".");
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(n + (n === 1 ? " herramienta devuelta." : " herramientas devueltas."));
  });
};

/* ---------- INVENTARIO ---------- */
/* El almacén no empieza vacío: cuando la app entra a la obra ya hay
   material en el estante. Por eso se pueden dar de alta a mano, con su
   stock inicial, sin esperar a que llegue una guía. */
VISTA.inventario = function(){
  var total = db.materiales.length;
  var enCero = db.materiales.filter(function(m){ return m.stock <= 0; }).length;
  var soloMira = (cargo === "capataz" || cargo === "supervisor");

  $("zona").innerHTML = '<div class="vista">' +
    '<div class="cifras">' +
      '<div class="cifra"><b>' + total + "</b><small>materiales</small></div>" +
      '<div class="cifra"><b>' + (total - enCero) + "</b><small>con stock</small></div>" +
      '<div class="cifra"><b>' + enCero + "</b><small>en cero</small></div>" +
    "</div>" +

    (soloMira ? "" :
      '<div class="tarjeta"><h2>Agregar material al inventario</h2>' +
      '<p class="nota">Para lo que ya está en el estante o para dar de alta algo nuevo. ' +
      "Queda registrado en el kardex como ajuste de inventario.</p>" +
      '<div class="rejilla dos">' +
        '<label class="campo"><span>Material</span>' +
          '<input id="nv-nombre" placeholder="Nombre del material"></label>' +
        '<label class="campo"><span>Unidad</span>' +
          '<select id="nv-und">' + opcionesUnidad("und") + "</select></label>" +
        '<label class="campo"><span>Cantidad</span>' +
          '<input class="n" type="number" min="0" step="0.01" id="nv-cant" placeholder="0"></label>' +
        '<label class="campo"><span>Motivo</span><select id="nv-motivo">' +
          '<option value="inicial">Ya estaba en el almacén</option>' +
          '<option value="compra">Compra directa, sin guía</option>' +
          '<option value="ajuste">Corrección de conteo</option>' +
          "</select></label>" +
      "</div>" +
      '<div class="botones"><button class="bt sec" type="button" id="nv-ok">Agregar al inventario</button></div>' +
      "</div>") +

    '<div class="tarjeta"><h2>Qué hay en el almacén</h2>' +
    '<label class="campo" style="margin-bottom:12px"><span>Buscar</span>' +
    '<input id="iv-buscar" placeholder="Escriba el nombre"></label>' +
    '<div id="iv-lista"></div></div></div>';

  $("iv-buscar").addEventListener("input", pintarInv);
  pintarInv();

  if(soloMira) return;

  $("nv-und").addEventListener("change", function(){
    if(this.value === "__otra"){
      var u = nuevaUnidad();
      VISTA.inventario();
      if(u) $("nv-und").value = u;
    }
  });

  $("nv-ok").addEventListener("click", function(){
    var nombre = ($("nv-nombre").value || "").trim();
    var cant = num($("nv-cant").value);
    var und = $("nv-und").value;
    var motivo = $("nv-motivo").value;
    if(nombre.length < 2) return aviso("Escriba el nombre del material.");
    if(und === "__otra") return aviso("Elija una unidad.");
    if(cant <= 0) return aviso("Escriba la cantidad.");

    var ya = buscarMaterial(nombre);
    if(ya && !confirm("«" + ya.nombre + "» ya está en el inventario con " + ya.stock + " " +
        ya.unidad + ". ¿Le sumo " + cant + "?")) return;

    var doc = motivo === "inicial" ? "Inventario inicial"
            : (motivo === "compra" ? "Compra directa" : "Ajuste de conteo");
    try{
      mover("ingreso", nombre, und, cant, doc, "");
    }catch(e){ return aviso(e.message); }
    guardar();
    VISTA.inventario();
    aviso(cant + " " + und + " de " + nombre + " al inventario.");
  });
};

function pintarInv(){
  var q = clave($("iv-buscar") ? $("iv-buscar").value : "");
  var lista = db.materiales.filter(function(m){ return !q || clave(m.nombre).indexOf(q) >= 0; })
    .sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
  $("iv-lista").innerHTML = lista.length
    ? '<div class="tabla-caja"><table><thead><tr><th>Material</th><th class="n">Stock</th>' +
      "<th>En el consolidado</th></tr></thead><tbody>" +
      lista.map(function(m){
        var c = buscarConsolidado(m.nombre);
        var e = m.stock > 0 ? '<span class="marca-est est-ok">disponible</span>'
                            : '<span class="marca-est est-mal">sin stock</span>';
        return "<tr><td>" + esc(m.nombre) + "<br>" + e + "</td>" +
          "<td class='n'><b>" + m.stock + "</b> " + esc(m.unidad) + "</td>" +
          "<td>" + (c
            ? '<span class="marca-est est-info">' + esc(c.codigo) + "</span>"
            : '<span class="marca-est est-alerta">fuera del alcance</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<div class="vacio">Sin coincidencias.</div>';
}
