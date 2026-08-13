/* =====================================================================
   ALMACÉN CPQ · SINCRONIZACIÓN ENTRE EQUIPOS               V44 · 11-08-2026

   Hasta la V43 cada celular guardaba su propio almacén: si el almacenero
   registraba un ingreso, la Administradora de Obra no lo veía. Esto lo
   arregla. La app sigue trabajando contra `db` en memoria y contra
   localStorage —o sea, sigue funcionando sin señal—, y este archivo se
   encarga de subir lo que cambió y bajar lo que cambiaron los demás.

   Cómo funciona
     · Subir  — cada `guardar()` dispara un empujón (con 800 ms de espera,
                para no mandar una fila por cada tecla). Solo viajan los
                registros cuyo contenido cambió de verdad.
     · Bajar  — un WebSocket de Realtime avisa en ~1 s. Si la red lo corta,
                un sondeo cada 45 s trae lo que falte. Nunca se depende de
                una sola vía.
     · Empate — gana el `ts` más nuevo. Es la hora de la acción, no la de
                la subida.
     · Borrar — se apaga (`eliminado`), no se borra. Una fila que
                desaparece no puede sincronizarse; apagada, el borrado
                llega a todos los equipos.

   Sin conexión no se rompe nada: se sigue guardando local y el empujón
   se reintenta cuando vuelve la señal.
   ===================================================================== */
(function sincronizacionV44(){
  "use strict";

  var CFG = window.SUPA_CFG || {};
  if(!CFG.url || !CFG.key || CFG.key.indexOf("PEGAR") === 0){
    console.warn("[sync] Sin config.js válido: la app trabaja solo en este equipo.");
    return;
  }

  var SUFIJO = "_create_110826";
  /* Colecciones que son listas de registros: cada una tiene su tabla. */
  var COLECCIONES = [
    "usuarios", "solicitudes", "personal", "materiales", "herramientas",
    "requerimientos", "movimientos", "notificaciones", "historial",
    "auditoria", "guias", "proveedores", "despachos"
  ];
  /* Colecciones que son un solo objeto: van todas a la tabla `estado`. */
  var SUELTAS = ["config", "correlativos", "consolidado", "alias"];

  /* Topes que la app aplica en local. Lo que quede por debajo del corte no
     se vuelve a bajar, si no la lista crecería y se recortaría sin parar. */
  var TOPES = {notificaciones:400, auditoria:1500, historial:2000};

  function tabla(col){ return "alm_" + col + SUFIJO; }
  function base(){ return String(CFG.url).replace(/\/+$/, ""); }
  function cab(extra){
    var h = {apikey:CFG.key, Authorization:"Bearer " + CFG.key, "Content-Type":"application/json"};
    for(var k in (extra || {})) h[k] = extra[k];
    return h;
  }

  /* Huella del equipo, para saber de dónde vino cada fila. */
  var EQUIPO = (function(){
    var k = "almacen_equipo_v3", v = null;
    try{ v = localStorage.getItem(k); }catch(e){}
    if(!v){
      v = Math.random().toString(36).slice(2, 8);
      try{ localStorage.setItem(k, v); }catch(e){}
    }
    return v;
  })();

  var estado = {activo:false, subiendo:false, ultimo:null, error:null, vivo:false, primeraCarga:false};
  window.ALM_SYNC = estado;

  /* Se avisa cuando ya bajó todo por primera vez. El login lo espera: sin
     esto, en un equipo recién abierto no habría ni una cuenta contra la cual
     comparar y diría "usuario o contraseña incorrectos". */
  var _listoOk;
  estado.listo = new Promise(function(r){ _listoOk = r; });

  /* `db` es un `let` del script principal: vive en el ámbito global léxico,
     no cuelga de `window`. Se lee por nombre, nunca como window.db. */
  function hayDb(){ return typeof db !== "undefined" && db && Array.isArray(db.materiales); }

  /* `_enviado` vive solo en memoria, a propósito. Si el celular se apaga a
     media subida, al abrir de nuevo arranca vacío: todo se vuelve a comparar
     contra el servidor y lo que faltó viaja solo. Nunca se pierde un cambio
     por haber cerrado la app. */
  var _enviado = {};   /* col|id -> huella de lo último que subimos */
  var _corte   = {};   /* col -> fecha del registro más viejo que conservamos */
  var _reloj   = null;
  var _desde   = null; /* updated_at del último sondeo, para pedir solo lo nuevo */

  /* Los borrados hechos sin señal sí tienen que sobrevivir al cierre: el
     registro ya no está en `db`, así que no hay de dónde recalcularlos. */
  var COLA = "almacen_cola_borrados_v3";
  function colaLeer(){
    try{ return JSON.parse(localStorage.getItem(COLA) || "[]"); }catch(e){ return []; }
  }
  function colaEscribir(c){
    try{ localStorage.setItem(COLA, JSON.stringify(c)); }catch(e){}
  }

  function huella(o){
    var s = JSON.stringify(o), h = 5381;
    for(var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + ":" + s.length;
  }
  function stamp(r){ return r && r._ts ? r._ts : "1970-01-01T00:00:00.000Z"; }

  /* ---------------------------------------------------------------
     FOTOS Y ADJUNTOS — al bucket, no dentro del registro

     Una foto en base64 pesa unas 60 KB metida en el propio registro, y
     eso se bajaba entero cada vez que alguien tocaba cualquier cosa de
     ese material. Ahora se sube una vez y en el registro queda el enlace.

     El nombre del archivo sale del contenido, así que la misma foto
     subida dos veces cae en la misma ruta y la segunda no pesa nada. Por
     eso el 409 ("ya existe") cuenta como éxito: la política del bucket
     deja crear pero no pisar, y esa foto ya está arriba.
     --------------------------------------------------------------- */
  var BUCKET = "almacen-fotos";

  function esAdjunto(v){
    return typeof v === "string" && v.length > 512 &&
           (v.indexOf("data:image/") === 0 || v.indexOf("data:application/pdf") === 0);
  }

  function aBlob(dataUrl){
    var coma = dataUrl.indexOf(","),
        tipo = dataUrl.slice(5, dataUrl.indexOf(";")),
        bin  = atob(dataUrl.slice(coma + 1)),
        arr  = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return {blob:new Blob([arr], {type:tipo}), tipo:tipo};
  }

  async function subirAdjunto(col, id, campo, dataUrl){
    var b = aBlob(dataUrl);
    var ext = b.tipo === "application/pdf" ? "pdf" :
              b.tipo === "image/png" ? "png" :
              b.tipo === "image/webp" ? "webp" : "jpg";
    var ruta = col + "/" + id + "/" + campo + "-" + huella(dataUrl).replace(/:/g, "") + "." + ext;
    var url  = base() + "/storage/v1/object/" + BUCKET + "/" + ruta.split("/").map(encodeURIComponent).join("/");

    var r = await fetch(url, {
      method:"POST",
      headers:{apikey:CFG.key, Authorization:"Bearer " + CFG.key, "Content-Type":b.tipo},
      body:b.blob
    });
    if(!r.ok && r.status !== 409) throw new Error("storage " + r.status + " " + ruta);
    return base() + "/storage/v1/object/public/" + BUCKET + "/" +
           ruta.split("/").map(encodeURIComponent).join("/");
  }

  /* Recorre el registro entero: la foto puede estar suelta (`foto`), en
     una lista (`fotos`) o dentro de un préstamo. No se sabe dónde, así
     que se buscan todas. */
  async function subirDeRegistro(col, reg, nodo, camino, prof){
    if(prof > 4 || !nodo || typeof nodo !== "object") return false;
    var cambio = false;
    var claves = Array.isArray(nodo) ? nodo.map(function(_, i){ return i; }) : Object.keys(nodo);

    for(var i = 0; i < claves.length; i++){
      var k = claves[i], v = nodo[k];
      if(esAdjunto(v)){
        try{
          nodo[k] = await subirAdjunto(col, reg.id, (camino ? camino + "-" : "") + k, v);
          cambio = true;
        }catch(e){
          /* Si la subida falla se deja el base64 y se reintenta después:
             antes perder la foto que perderla del registro. */
          console.warn("[sync] foto no subida:", e.message);
        }
      }else if(v && typeof v === "object"){
        if(await subirDeRegistro(col, reg, v, (camino ? camino + "-" : "") + k, prof + 1)) cambio = true;
      }
    }
    return cambio;
  }

  async function subirFotos(){
    var hubo = false;
    for(var i = 0; i < COLECCIONES.length; i++){
      var col = COLECCIONES[i];
      if(!Array.isArray(db[col])) continue;
      for(var j = 0; j < db[col].length; j++){
        var reg = db[col][j];
        if(!reg || !reg.id) continue;
        if(await subirDeRegistro(col, reg, reg, "", 0)) hubo = true;
      }
    }
    if(hubo){ try{ guardarLocal(); }catch(e){} }
    return hubo;
  }

  /* ---------------------------------------------------------------
     SUBIR
     --------------------------------------------------------------- */
  async function upsert(col, filas){
    if(!filas.length) return;
    var url = base() + "/rest/v1/" + tabla(col) + "?on_conflict=id";
    var r = await fetch(url, {
      method:"POST",
      headers:cab({Prefer:"resolution=merge-duplicates,return=minimal"}),
      body:JSON.stringify(filas)
    });
    if(!r.ok) throw new Error(tabla(col) + " " + r.status + " " + (await r.text()).slice(0, 200));
  }

  function pendientes(col, registros){
    var salida = [], marcar = [], ahoraISO = new Date().toISOString();
    registros.forEach(function(reg){
      if(!reg || !reg.id) return;
      var clave = col + "|" + reg.id;
      /* El _ts no entra en la huella: si entrara, cada sello nuevo se vería
         como un cambio y la fila viajaría sola una y otra vez. */
      var copia = {}; for(var k in reg) if(k !== "_ts") copia[k] = reg[k];
      var h = huella(copia);
      if(_enviado[clave] === h) return;
      /* El cambio se detecta aquí, 800 ms después de ocurrir: ese es el ts. */
      if(!reg._ts || _enviado[clave] !== undefined) reg._ts = ahoraISO;
      salida.push({id:reg.id, datos:reg, ts:reg._ts, eliminado:false, cell_at:EQUIPO});
      marcar.push([clave, h]);
    });
    salida._marcar = marcar;
    return salida;
  }

  async function empujar(){
    if(estado.subiendo || !navigator.onLine || !hayDb()) return;
    estado.subiendo = true;
    var fallo = null;

    /* Las fotos van al bucket ANTES del diff: así lo que viaja en la
       fila es el enlace, no la imagen entera. */
    try{ await subirFotos(); }catch(e){ fallo = fallo || e; }

    /* Primero los borrados que quedaron pendientes por falta de señal. */
    var cola = colaLeer();
    if(cola.length){
      var quedan = [];
      for(var c = 0; c < cola.length; c++){
        try{
          await upsert(cola[c].col, [{
            id:cola[c].id, datos:{}, ts:cola[c].ts, eliminado:true,
            elim_por:cola[c].quien || EQUIPO, elim_ts:cola[c].ts, cell_at:EQUIPO
          }]);
        }catch(e){ quedan.push(cola[c]); fallo = fallo || e; }
      }
      colaEscribir(quedan);
    }

    for(var i = 0; i < COLECCIONES.length; i++){
      var col = COLECCIONES[i];
      try{
        var lista = db[col];
        if(!Array.isArray(lista)) continue;
        var filas = pendientes(col, lista);
        if(filas.length){
          await upsert(col, filas);
          filas._marcar.forEach(function(p){ _enviado[p[0]] = p[1]; });
        }
      }catch(e){ fallo = fallo || e; }
    }

    try{
      var sueltas = [], marcar = [], ahoraISO = new Date().toISOString();
      SUELTAS.forEach(function(nom){
        var val = db[nom];
        if(val === undefined || val === null) return;
        var clave = "estado|" + nom, h = huella(val);
        if(_enviado[clave] === h) return;
        sueltas.push({id:nom, datos:{valor:val}, ts:ahoraISO, eliminado:false, cell_at:EQUIPO});
        marcar.push([clave, h]);
      });
      if(sueltas.length){
        await upsert("estado", sueltas);
        marcar.forEach(function(p){ _enviado[p[0]] = p[1]; });
      }
    }catch(e){ fallo = fallo || e; }

    estado.subiendo = false;
    estado.error = fallo ? String(fallo.message || fallo) : null;
    if(!fallo) estado.ultimo = new Date().toISOString();
    else console.warn("[sync] al subir:", fallo);
    pintarEstado();
  }

  function programarEmpujon(){
    clearTimeout(_reloj);
    _reloj = setTimeout(function(){ empujar(); }, 800);
  }

  /* ---------------------------------------------------------------
     BAJAR
     --------------------------------------------------------------- */
  function fusionar(col, filas){
    if(!filas || !filas.length) return false;
    var cambio = false;

    if(col === "estado"){
      filas.forEach(function(f){
        if(f.eliminado || SUELTAS.indexOf(f.id) < 0) return;
        var valor = f.datos && f.datos.valor;
        if(valor === undefined) return;
        if(huella(db[f.id]) === huella(valor)) return;
        /* Los correlativos no se pisan hacia abajo: si este equipo ya llegó
           más lejos, el número del otro dejaría códigos repetidos. */
        if(f.id === "correlativos"){
          var mio = db.correlativos || {}, suyo = valor || {}, mezcla = {};
          Object.keys(mio).concat(Object.keys(suyo)).forEach(function(k){
            mezcla[k] = Math.max(Number(mio[k]) || 0, Number(suyo[k]) || 0);
          });
          db.correlativos = mezcla;
        }else{
          db[f.id] = valor;
        }
        _enviado["estado|" + f.id] = huella(db[f.id]);
        cambio = true;
      });
      return cambio;
    }

    if(!Array.isArray(db[col])) db[col] = [];
    var lista = db[col], porId = {};
    lista.forEach(function(r, i){ if(r && r.id) porId[r.id] = i; });

    filas.forEach(function(f){
      if(!f || !f.id) return;
      var i = porId[f.id];

      if(f.eliminado){
        if(i !== undefined && i >= 0){
          lista[i] = null;
          cambio = true;
        }
        _enviado[col + "|" + f.id] = "borrado";
        return;
      }

      var reg = f.datos;
      if(!reg || typeof reg !== "object") return;
      reg.id = f.id;
      reg._ts = f.ts || reg._ts;

      if(i === undefined){
        /* No revivir lo que ya quedó por debajo del tope local. */
        var corte = _corte[col];
        if(corte && reg.fecha && String(reg.fecha) < corte) return;
        lista.push(reg);
        porId[f.id] = lista.length - 1;
        cambio = true;
      }else{
        if(stamp(reg) <= stamp(lista[i])) return;  /* lo nuestro es más nuevo */
        lista[i] = reg;
        cambio = true;
      }
      var copia = {}; for(var k in reg) if(k !== "_ts") copia[k] = reg[k];
      _enviado[col + "|" + f.id] = huella(copia);
    });

    if(cambio){
      db[col] = lista.filter(Boolean);
      var tope = TOPES[col];
      if(tope && db[col].length > tope){
        db[col].sort(function(a, b){ return String(b.fecha || "").localeCompare(String(a.fecha || "")); });
        db[col].length = tope;
        var ultimo = db[col][tope - 1];
        _corte[col] = ultimo && ultimo.fecha ? String(ultimo.fecha) : _corte[col];
      }
    }
    return cambio;
  }

  async function traer(soloNuevo){
    if(!navigator.onLine || !hayDb()) return;
    var hubo = false, marca = new Date().toISOString(), fallo = null;
    var todas = COLECCIONES.concat(["estado"]);

    for(var i = 0; i < todas.length; i++){
      var col = todas[i];
      try{
        var qs = "select=id,datos,ts,eliminado&limit=20000";
        if(soloNuevo && _desde) qs += "&updated_at=gt." + encodeURIComponent(_desde);
        var r = await fetch(base() + "/rest/v1/" + tabla(col) + "?" + qs, {headers:cab()});
        if(!r.ok) throw new Error(tabla(col) + " " + r.status);
        if(fusionar(col, await r.json())) hubo = true;
      }catch(e){ fallo = fallo || e; }
    }

    if(!fallo) _desde = marca;
    estado.error = fallo ? String(fallo.message || fallo) : null;
    if(fallo) console.warn("[sync] al bajar:", fallo);

    if(hubo){
      try{ if(typeof guardarLocal === "function") guardarLocal(); }catch(e){}
      repintar();
    }
    pintarEstado();
    return hubo;
  }

  function repintar(){
    try{
      if(typeof pintarBadge === "function") pintarBadge();
      if(typeof sesion !== "undefined" && sesion && typeof refrescar === "function" &&
         typeof pantalla !== "undefined" && pantalla && pantalla !== "login"){
        refrescar(pantalla);
      }
    }catch(e){ console.warn("[sync] al repintar:", e); }
  }

  /* ---------------------------------------------------------------
     BORRAR APAGANDO
     --------------------------------------------------------------- */
  window.almBorrar = function(col, id, quien){
    if(!id) return;
    var ts = new Date().toISOString();
    if(Array.isArray(db[col])) db[col] = db[col].filter(function(x){ return x.id !== id; });
    _enviado[col + "|" + id] = "borrado";

    /* El registro ya no está en `db`, así que el borrado no se puede
       recalcular después: se anota en cola hasta que el servidor lo acuse. */
    var cola = colaLeer();
    cola.push({col:col, id:id, quien:quien || EQUIPO, ts:ts});
    colaEscribir(cola);

    if(!navigator.onLine) return;
    upsert(col, [{
      id:id, datos:{}, ts:ts,
      eliminado:true, elim_por:quien || EQUIPO, elim_ts:ts, cell_at:EQUIPO
    }]).then(function(){
      colaEscribir(colaLeer().filter(function(x){ return !(x.col === col && x.id === id); }));
    }).catch(function(e){ console.warn("[sync] al borrar:", e); });
  };

  /* ---------------------------------------------------------------
     REALTIME — el aviso llega en ~1 s; el sondeo queda de respaldo
     --------------------------------------------------------------- */
  var ws = null, latido = null, reintento = 0;

  function conectar(){
    if(!navigator.onLine) return;
    try{ if(ws) ws.close(); }catch(e){}
    var url = base().replace(/^http/, "ws") +
      "/realtime/v1/websocket?apikey=" + encodeURIComponent(CFG.key) + "&vsn=1.0.0";
    try{ ws = new WebSocket(url); }catch(e){ return; }

    ws.onopen = function(){
      reintento = 0;
      estado.vivo = true;
      var cambios = COLECCIONES.concat(["estado"]).map(function(c){
        return {event:"*", schema:"public", table:tabla(c)};
      });
      ws.send(JSON.stringify({
        topic:"realtime:almacen", event:"phx_join", ref:"1", join_ref:"1",
        payload:{config:{broadcast:{ack:false, self:false}, presence:{key:""}, postgres_changes:cambios}}
      }));
      clearInterval(latido);
      latido = setInterval(function(){
        try{ ws.send(JSON.stringify({topic:"phoenix", event:"heartbeat", payload:{}, ref:"hb"})); }catch(e){}
      }, 25000);
      pintarEstado();
    };

    ws.onmessage = function(ev){
      var m;
      try{ m = JSON.parse(ev.data); }catch(e){ return; }
      if(m.event !== "postgres_changes") return;
      var d = m.payload && m.payload.data;
      if(!d || !d.table) return;
      var col = String(d.table).replace(/^alm_/, "").replace(new RegExp(SUFIJO + "$"), "");
      var fila = d.record || d.old_record;
      if(!fila) return;
      if(fila.cell_at === EQUIPO) return;  /* eco de lo que acabamos de subir */
      if(fusionar(col, [fila])){
        try{ if(typeof guardarLocal === "function") guardarLocal(); }catch(e){}
        repintar();
      }
    };

    ws.onclose = function(){
      estado.vivo = false;
      clearInterval(latido);
      pintarEstado();
      reintento = Math.min(reintento + 1, 6);
      setTimeout(conectar, 1000 * Math.pow(2, reintento));  /* 2 s … 64 s */
    };
    ws.onerror = function(){ try{ ws.close(); }catch(e){} };
  }

  /* ---------------------------------------------------------------
     AVISO EN PANTALLA — una línea discreta, para saber si está al día
     --------------------------------------------------------------- */
  function pintarEstado(){
    var el = document.getElementById("sync-estado");
    if(!el){
      el = document.createElement("div");
      el.id = "sync-estado";
      el.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.4 system-ui," +
        "sans-serif;padding:3px 8px;border-radius:999px;pointer-events:none;opacity:.85";
      document.body.appendChild(el);
    }
    var txt, fondo, tinta;
    if(!navigator.onLine){ txt = "Sin señal · se guarda en el equipo"; fondo = "#4b5563"; tinta = "#fff"; }
    else if(estado.error){  txt = "Sin sincronizar";                    fondo = "#b42318"; tinta = "#fff"; }
    else if(estado.vivo){   txt = "En línea · al día";                  fondo = "#dcfae6"; tinta = "#085d3a"; }
    else{                   txt = "Conectando…";                        fondo = "#fef0c7"; tinta = "#7a2e0e"; }
    el.textContent = txt;
    el.style.background = fondo;
    el.style.color = tinta;
  }

  /* ---------------------------------------------------------------
     ENGANCHE con la app
     --------------------------------------------------------------- */
  function arrancar(){
    if(estado.activo) return;
    estado.activo = true;

    /* Cada guardado local dispara el empujón. */
    window.guardarLocal = window.guardar;
    window.guardar = function(){
      var r = guardarLocal.apply(this, arguments);
      programarEmpujon();
      return r;
    };

    /* Los códigos se sacan del máximo que ya existe, no de un contador que
       cada equipo lleva por su cuenta: si no, dos almaceneros creando a la
       vez sacaban el mismo MAT-0013. */
    if(typeof window.codigo === "function"){
      window.codigo = function(prefijo){
        var col = prefijo === "MAT" ? db.materiales : prefijo === "HER" ? db.herramientas : null;
        var max = 0;
        (col || []).forEach(function(x){
          var m = /-(\d+)$/.exec(x.codigo || "");
          if(m) max = Math.max(max, +m[1]);
        });
        var n = Math.max(max, Number(db.correlativos[prefijo]) || 0) + 1;
        db.correlativos[prefijo] = n;
        return prefijo + "-" + String(n).padStart(4, "0");
      };
    }
    if(typeof window.codigoReq === "function"){
      window.codigoReq = function(){
        var anio = new Date().getFullYear(), max = 0;
        (db.requerimientos || []).forEach(function(r){
          var m = new RegExp("^REQ-" + anio + "-(\\d+)$").exec(r.codigo || "");
          if(m) max = Math.max(max, +m[1]);
        });
        var n = Math.max(max, Number(db.correlativos.REQ) || 0) + 1;
        db.correlativos.REQ = n;
        return "REQ-" + anio + "-" + String(n).padStart(3, "0");
      };
    }

    /* Nadie entra hasta que bajaron las cuentas: el aplicativo sale desnudo,
       si no habría que adivinar contra una lista vacía. */
    if(typeof window.entrar === "function"){
      var entrarLocal = window.entrar;
      window.entrar = async function(usuario, clave){
        if(!estado.primeraCarga){
          if(!navigator.onLine)
            return {ok:false, msg:"Sin señal. Necesita internet para entrar la primera vez en este equipo."};
          try{
            await Promise.race([estado.listo, new Promise(function(r){ setTimeout(r, 12000); })]);
          }catch(e){}
          if(!estado.primeraCarga)
            return {ok:false, msg:"No se pudo conectar con el servidor. Revise la señal y vuelva a intentar."};
        }
        return entrarLocal.apply(this, arguments);
      };
    }

    /* Primer llenado: lo del servidor entra antes de que nadie toque nada. */
    traer(false).then(function(){
      estado.primeraCarga = true;
      _listoOk();
      empujar();
    }).catch(function(){ _listoOk(); });

    setInterval(function(){ if(!document.hidden) traer(true); }, 45000);
    document.addEventListener("visibilitychange", function(){ if(!document.hidden) traer(true); });
    window.addEventListener("online", function(){ conectar(); traer(true).then(empujar); pintarEstado(); });
    window.addEventListener("offline", pintarEstado);

    /* Al cerrar la pestaña no da tiempo a un fetch normal. `keepalive` hace
       que el navegador termine de mandarlo aunque la página ya no esté —y a
       diferencia de sendBeacon sí lleva la cabecera del upsert, que es la
       que evita el choque con la fila que ya existe. El tope del navegador
       es 64 KB por pedido; lo que no entre viaja al abrir de nuevo, porque
       las huellas de lo enviado no se guardan y todo se vuelve a comparar. */
    window.addEventListener("pagehide", function(){
      clearTimeout(_reloj);
      if(!hayDb()) return;
      COLECCIONES.forEach(function(col){
        if(!Array.isArray(db[col])) return;
        var filas = pendientes(col, db[col]);
        if(!filas.length) return;
        var cuerpo = JSON.stringify(filas);
        if(cuerpo.length > 60000) return;
        try{
          fetch(base() + "/rest/v1/" + tabla(col) + "?on_conflict=id", {
            method:"POST", keepalive:true,
            headers:cab({Prefer:"resolution=merge-duplicates,return=minimal"}),
            body:cuerpo
          });
          filas._marcar.forEach(function(p){ _enviado[p[0]] = p[1]; });
        }catch(e){}
      });
    });

    conectar();
    pintarEstado();
  }

  /* La app arma `db` dentro de un arranque asíncrono; se espera a que esté. */
  var espera = setInterval(function(){
    if(hayDb()){
      clearInterval(espera);
      arrancar();
    }
  }, 120);
  setTimeout(function(){ clearInterval(espera); }, 30000);
})();
