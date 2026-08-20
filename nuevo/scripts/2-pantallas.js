/* =====================================================================
   ALMACÉN CPQ · PANTALLAS

   Una función por pantalla. Cada una pinta su HTML y engancha sus
   botones; ninguna sabe de las otras. Al final arranca la aplicación,
   así que este archivo va después del núcleo.
   ===================================================================== */
"use strict";

/* ---------- reemplazar el consolidado ----------
   El consolidado se actualiza a diario en el Drive, así que hay que
   poder subir el nuevo y que pise al anterior.

   Lo que NO se pisa: lo comprado y lo entregado. Esos números los fue
   ganando la app recibiendo guías y entregando al frente; si el archivo
   nuevo los borrara, el avance de la obra volvería a cero cada mañana.
   Del archivo se toma el alcance —qué se pide y cuánto—; lo que ya
   ocurrió se conserva. */
function leerConsolidado(filas){
  var iCab = -1, col = {};
  for(var i = 0; i < Math.min(filas.length, 25); i++){
    var f = filas[i] || [], prueba = {};
    for(var c = 0; c < f.length; c++){
      var t = clave(f[c]);
      if(!t) continue;
      if(/^codigo/.test(t) && prueba.cod === undefined) prueba.cod = c;
      else if(/^descripcion|^material/.test(t) && prueba.desc === undefined) prueba.desc = c;
      else if(/^und$|^unidad/.test(t) && prueba.und === undefined) prueba.und = c;
      else if(/^cantidad|^solicitada/.test(t) && prueba.cant === undefined) prueba.cant = c;
      else if(/^n requerimiento|^requerimiento/.test(t) && prueba.req === undefined) prueba.req = c;
      else if(/observacion/.test(t) && prueba.obs === undefined) prueba.obs = c;
    }
    if(prueba.desc !== undefined && prueba.cant !== undefined){ iCab = i; col = prueba; break; }
  }
  if(iCab < 0) throw new Error('No encontré las columnas "Descripción" y "Cantidad". ¿Es el consolidado?');

  var salida = [];
  for(var n = iCab + 1; n < filas.length; n++){
    var fila = filas[n] || [];
    var desc = String(fila[col.desc] == null ? "" : fila[col.desc]).trim();
    if(!desc) continue;
    if(/^(total|firma|elaborado|revisado|aprobado|observaci)/i.test(desc)) break;
    var cant = num(fila[col.cant]);
    if(!(cant > 0)) continue;
    salida.push({
      codigo: col.cod === undefined ? "" : String(fila[col.cod] || "").trim(),
      desc: desc,
      unidad: (col.und === undefined ? "" : String(fila[col.und] || "").trim()) || "und",
      requerido: cant,
      nreq: col.req === undefined ? "" : String(fila[col.req] || "").trim(),
      obs: col.obs === undefined ? "" : String(fila[col.obs] || "").trim()
    });
  }
  if(!salida.length) throw new Error("No encontré ningún renglón con material y cantidad.");
  return salida;
}

function compararConsolidado(nuevos){
  var viejos = db.consolidado.slice();
  var usados = {}, res = {actualizados:[], nuevos:[], salieron:[], sinTocar:0};

  nuevos.forEach(function(n){
    var v = null, i;
    if(n.codigo) for(i=0;i<viejos.length;i++)
      if(viejos[i].codigo === n.codigo && !usados[viejos[i].id]) { v = viejos[i]; break; }
    if(!v) for(i=0;i<viejos.length;i++)
      if(clave(viejos[i].desc) === clave(n.desc) && !usados[viejos[i].id]) { v = viejos[i]; break; }
    if(v){
      usados[v.id] = true;
      n.enlace = v;
      if(num(v.requerido) !== n.requerido) res.actualizados.push({v:v, n:n});
      else res.sinTocar++;
    } else {
      res.nuevos.push(n);
    }
  });

  viejos.forEach(function(v){
    if(usados[v.id]) return;
    /* solo se avisa de los que se fueron y ya tenían movimiento */
    res.salieron.push(v);
  });
  return res;
}

function aplicarConsolidado(nuevos, res){
  var correlativo = db.consolidado.length;
  var mapa = {};
  db.consolidado.forEach(function(c){ mapa[c.id] = c; });

  var final = nuevos.map(function(n){
    var v = n.enlace;
    if(v){
      /* del archivo viene el alcance; lo comprado y entregado se conserva */
      v.codigo = n.codigo || v.codigo;
      v.desc = n.desc;
      v.unidad = n.unidad || v.unidad;
      v.requerido = n.requerido;
      v.nreq = n.nreq || v.nreq;
      v.adicional = false;
      return v;
    }
    correlativo++;
    return {id:uid(), codigo:n.codigo || ("R01-" + String(correlativo).padStart(3,"0")),
            desc:n.desc, unidad:n.unidad, requerido:n.requerido, nreq:n.nreq,
            comprado:0, entregado:0, adicional:false, pedidos:[]};
  });

  /* los que ya no están en el archivo pero tienen movimiento se quedan,
     marcados como adicionales: fueron reales y no se pueden borrar */
  res.salieron.forEach(function(v){
    if(num(v.comprado) > 0 || num(v.entregado) > 0){
      v.adicional = true;
      final.push(v);
    }
  });

  db.consolidado = final;
  db.consolidadoCargado = {fecha:new Date().toISOString(), por:cargo,
    renglones:final.length, archivo:db._ultimoArchivo || ""};
  guardar();
}

function cargarConsolidado(archivo){
  var lector = new FileReader();
  lector.onload = function(){
    try{
      var seguir = function(filas){
        var nuevos = leerConsolidado(filas);
        var res = compararConsolidado(nuevos);
        var conMovimiento = res.salieron.filter(function(v){
          return num(v.comprado) > 0 || num(v.entregado) > 0; }).length;

        var texto =
          "Se va a reemplazar el consolidado con " + nuevos.length + " renglones.\n\n" +
          "· " + res.actualizados.length + " cambian de cantidad\n" +
          "· " + res.sinTocar + " quedan igual\n" +
          "· " + res.nuevos.length + " son nuevos\n" +
          "· " + res.salieron.length + " ya no están en el archivo" +
          (conMovimiento ? " (" + conMovimiento + " se conservan porque ya tuvieron movimiento)" : "") +
          "\n\nLo comprado y lo entregado se conserva. ¿Continuar?";

        if(!confirm(texto)) return;
        db._ultimoArchivo = archivo.name;
        aplicarConsolidado(nuevos, res);
        VISTA.consolidado();
        aviso("Consolidado reemplazado · " + db.consolidado.length + " renglones.");
      };
      if(/\.csv$/i.test(archivo.name)){
        seguir(filasDeCSV(new TextDecoder().decode(new Uint8Array(lector.result))));
      } else {
        abrirZip(lector.result).then(function(mapa){ seguir(filasDeXLSX(mapa)); })
          .catch(function(e){ aviso(e.message); });
      }
    }catch(e){ aviso(e.message); }
  };
  lector.readAsArrayBuffer(archivo);
}

/* ---------- CONSOLIDADO ---------- */
VISTA.consolidado = function(){
  var req = 0, comp = 0, ent = 0;
  db.consolidado.forEach(function(c){ req += c.requerido; comp += c.comprado; ent += c.entregado; });
  var pct = req ? Math.round(comp / req * 100) : 0;
  $("zona").innerHTML = '<div class="vista">' +
    '<div class="cifras">' +
      '<div class="cifra"><b>' + db.consolidado.length + "</b><small>renglones</small></div>" +
      '<div class="cifra"><b>' + Math.round((req-comp)*100)/100 + "</b><small>falta comprar</small></div>" +
      '<div class="cifra"><b>' + pct + '%</b><small>comprado</small></div>' +
    "</div>" +
    ((cargo === "obra" || cargo === "almacenero" || cargo === "admin")
      ? '<div class="tarjeta"><h2>Actualizar el consolidado</h2>' +
        '<p class="nota">Suba el archivo del día y reemplaza al anterior. ' +
        "<b>Lo comprado y lo entregado se conserva</b>: del archivo se toma el alcance.</p>" +
        (db.consolidadoCargado
          ? '<div class="aviso" style="margin:0 0 12px"><p>Último reemplazo: <b>' +
            fecha(db.consolidadoCargado.fecha) + "</b>" +
            (db.consolidadoCargado.archivo ? " · " + esc(db.consolidadoCargado.archivo) : "") +
            " · " + db.consolidadoCargado.renglones + " renglones</p></div>"
          : "") +
        '<div class="botones" style="margin:0">' +
        '<button class="bt sec" type="button" id="co-subir">Subir el consolidado del día</button>' +
        '<input type="file" id="co-archivo" accept=".xlsx,.csv" hidden></div></div>'
      : "") +
    '<div class="tarjeta"><h2>Alcance de la obra</h2>' +
    '<p class="nota">Conforme llega la mercadería, lo que falta va bajando.</p>' +
    '<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Descripción</th>' +
    '<th class="n">Pide</th><th class="n">Llegó</th><th class="n">Falta</th><th>Avance</th>' +
    "</tr></thead><tbody>" +
    db.consolidado.map(function(c){
      var falta = Math.round((c.requerido - c.comprado)*100)/100;
      var p = c.requerido ? Math.round(c.comprado / c.requerido * 100) : 0;
      var quienes = (c.pedidos || []).map(function(x){ return x.quien; })
        .filter(function(v,i,a){ return a.indexOf(v) === i; });
      return "<tr><td><b>" + esc(c.codigo) + "</b>" +
        (c.adicional ? ' <span class="marca-est est-alerta">adicional</span>' : "") + "</td>" +
        "<td>" + esc(c.desc) +
        (quienes.length ? '<br><small style="color:var(--tinta2)">pidieron: ' +
          esc(quienes.join(", ")) + "</small>" : "") + "</td>" +
        "<td class='n'>" + c.requerido + " " + esc(c.unidad) + "</td>" +
        "<td class='n'>" + c.comprado + "</td>" +
        "<td class='n'><b style='color:" + (falta ? "var(--rojo)" : "var(--verde)") + "'>" + falta + "</b></td>" +
        '<td><div class="barra-avance"><span style="width:' + p + '%"></span></div></td></tr>';
    }).join("") + "</tbody></table></div></div></div>";

  if($("co-subir")){
    $("co-subir").addEventListener("click", function(){ $("co-archivo").click(); });
    $("co-archivo").addEventListener("change", function(e){
      var a = e.target.files && e.target.files[0];
      if(a) cargarConsolidado(a);
      e.target.value = "";
    });
  }
};

/* ---------- KARDEX ---------- */
VISTA.kardex = function(){
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Todo lo que entró y salió</h2>" +
    '<p class="nota">No se edita ni se borra. Un error se corrige con otro movimiento.</p>' +
    (db.movimientos.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th>' +
        '<th class="n">Cantidad</th><th class="n">Saldo</th><th>Documento</th></tr></thead><tbody>' +
        db.movimientos.slice(0,60).map(function(m){
          return "<tr><td>" + fecha(m.fecha) + "</td>" +
            '<td><span class="marca-est ' + (m.tipo === "ingreso" ? "est-ok" : "est-info") + '">' +
            m.tipo + "</span></td>" +
            "<td>" + esc(m.item) + "</td>" +
            "<td class='n'>" + (m.tipo === "ingreso" ? "+" : "−") + m.cant + " " + esc(m.unidad) + "</td>" +
            "<td class='n'><b>" + m.saldo + "</b></td>" +
            "<td>" + esc(m.doc || m.persona || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">Todavía no hay movimientos.</div>') +
    "</div></div>";
};


/* ---------- REVISAR (Obra y Jefatura) ---------- */
var FLUJO = {
  pendiente:  {t:"Esperando a Obra",      c:"est-alerta"},
  en_logistica:{t:"En logística",          c:"est-info"},
  aprobado:   {t:"Aprobado para comprar",  c:"est-ok"},
  comprado:   {t:"Comprado",               c:"est-ok"},
  despachado: {t:"Despachado",             c:"est-info"}
};
function siguienteEstado(r){
  if(cargo === "obra" && r.estado === "pendiente") return "en_logistica";
  if(cargo === "jefatura" && r.estado === "en_logistica") return "aprobado";
  return null;
}
VISTA.revisar = function(){
  var mios = db.requerimientos.filter(function(r){
    if(cargo === "obra") return true;
    return r.estado !== "pendiente";
  });

  /* Las cuatro cifras que la Administradora mira cada mañana */
  var resumen = "";
  if(cargo === "obra"){
    var porRevisar = db.requerimientos.filter(function(r){ return r.estado === "pendiente"; }).length;
    var enLog = db.requerimientos.filter(function(r){
      return r.estado === "en_logistica" || r.estado === "aprobado"; }).length;
    var req = 0, comp = 0;
    db.consolidado.forEach(function(c){ req += c.requerido; comp += c.comprado; });
    var falta = Math.round((req - comp) * 100) / 100;
    var pct = req ? Math.round(comp / req * 100) : 0;
    resumen = '<div class="cifras">' +
      '<div class="cifra"><b style="color:' + (porRevisar ? "var(--rojo)" : "var(--verde)") + '">' +
        porRevisar + "</b><small>esperan su visto bueno</small></div>" +
      '<div class="cifra"><b>' + enLog + "</b><small>en manos de logística</small></div>" +
      '<div class="cifra"><b>' + falta + "</b><small>falta comprar</small></div>" +
      '<div class="cifra"><b>' + pct + '%</b><small>de la obra comprado</small></div>' +
    "</div>";
  }

  $("zona").innerHTML = '<div class="vista">' + resumen + '<div class="tarjeta">' +
    "<h2>" + (cargo === "obra" ? "Todo pedido pasa primero por usted" : "Pedidos que Obra ya revisó") + "</h2>" +
    '<p class="nota">' + (cargo === "obra"
      ? "Revise y páselo a logística. Nada sale de la obra sin su visto bueno."
      : "Dé el visto bueno para que el asistente pueda comprar.") + "</p>" +
    (mios.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Fecha</th><th>Solicitante</th>' +
        '<th class="n">Materiales</th><th>Estado</th><th></th></tr></thead><tbody>' +
        mios.map(function(r){
          var f = FLUJO[r.estado] || FLUJO.pendiente;
          var sig = siguienteEstado(r);
          return "<tr><td><b>" + esc(r.codigo) + "</b></td><td>" + fecha(r.fecha) + "</td>" +
            "<td>" + esc(r.solicitante) + "</td><td class='n'>" + r.items.length + "</td>" +
            '<td><span class="marca-est ' + f.c + '">' + f.t + "</span></td>" +
            '<td style="white-space:nowrap">' +
              '<button class="bt chico" type="button" data-ver="' + r.id + '">Ver</button> ' +
              (sig
                ? '<button class="bt chico pri" type="button" data-ok="' + r.id + '">' +
                  (cargo === "obra" ? "Pasar a logística" : "Visto bueno") + "</button>"
                : "") + "</td></tr>" +
            '<tr data-det="' + r.id + '" style="display:none"><td colspan="6" style="background:var(--sup2)">' +
              r.items.map(function(it){
                return "· <b>" + esc(it.desc) + "</b> — " + it.cant + " " + esc(it.und) +
                  (it.frente ? " · " + esc(it.frente) : "") +
                  (it.obs ? " · <i>" + esc(it.obs) + "</i>" : "");
              }).join("<br>") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">No hay pedidos por revisar.</div>') +
    "</div></div>";
  var vs = $("zona").querySelectorAll("[data-ver]"), k;
  for(k=0;k<vs.length;k++) vs[k].addEventListener("click", function(){
    var f = $("zona").querySelector('[data-det="' + this.dataset.ver + '"]');
    var abierto = f.style.display !== "none";
    f.style.display = abierto ? "none" : "";
    this.textContent = abierto ? "Ver" : "Ocultar";
  });

  var bs = $("zona").querySelectorAll("[data-ok]"), i;
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.ok; }.bind(this))[0];
    r.estado = siguienteEstado(r);
    guardar(); VISTA.revisar(); pintarMenu();
    aviso(r.codigo + " · " + FLUJO[r.estado].t.toLowerCase() + ".");
  });
};

/* ---------- COMPRAR (Asistente) ---------- */
VISTA.comprar = function(){
  var listos = db.requerimientos.filter(function(r){ return r.estado === "aprobado"; });
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Pedidos con visto bueno</h2>" +
    '<p class="nota">Al marcar comprado, el material queda listo para despachar a la mina.</p>' +
    (listos.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Solicitante</th>' +
        '<th>Materiales</th><th></th></tr></thead><tbody>' +
        listos.map(function(r){
          return "<tr><td><b>" + esc(r.codigo) + "</b></td><td>" + esc(r.solicitante) + "</td>" +
            "<td>" + r.items.map(function(i){ return esc(i.desc) + " (" + i.cant + ")"; }).join(", ") + "</td>" +
            '<td><button class="bt chico pri" type="button" data-comp="' + r.id + '">Comprado</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">No hay pedidos aprobados esperando compra.</div>') +
    "</div></div>";
  var bs = $("zona").querySelectorAll("[data-comp]"), i;
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.comp; }.bind(this))[0];
    r.estado = "comprado";
    guardar(); VISTA.comprar(); aviso(r.codigo + " comprado. Ya se puede despachar.");
  });
};

/* ---------- DESPACHAR (Jefatura y Asistente) ---------- */
var salen = [];
VISTA.despachar = function(){
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Qué sale hacia la mina</h2>" +
    '<p class="nota">Elija del consolidado. La guía se arma sola con esos nombres y códigos.</p>' +
    '<label class="campo" style="margin-bottom:11px"><span>Material del consolidado</span>' +
    '<select id="dp-mat">' + db.consolidado.map(function(c){
      return '<option value="' + esc(c.id) + '">' + esc(c.codigo) + " · " + esc(c.desc) + "</option>";
    }).join("") + "</select></label>" +
    '<div class="rejilla dos">' +
    '<label class="campo"><span>Cantidad</span><input class="n" type="number" min="0.01" step="0.01" id="dp-cant"></label>' +
    '<label class="campo"><span>Transportista</span><input id="dp-trans" placeholder="Nombre"></label></div>' +
    '<div class="botones"><button class="bt sec" type="button" id="dp-add">Agregar a la guía</button>' +
    '<span class="der">' + salen.length + " en la guía</span></div>" +
    (salen.length
      ? '<div class="tabla-caja" style="margin-top:12px"><table><thead><tr><th>Código</th><th>Material</th>' +
        '<th class="n">Cantidad</th><th></th></tr></thead><tbody>' +
        salen.map(function(l,i){
          return "<tr><td>" + esc(l.codigo) + "</td><td>" + esc(l.desc) + "</td>" +
            "<td class='n'>" + l.cant + " " + esc(l.unidad) + "</td>" +
            '<td><button class="bt chico" type="button" data-q="' + i + '">Quitar</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : "") +
    '<div class="botones"><button class="bt pri" type="button" id="dp-ok">Generar guía ' +
      esc(db.serie + " - " + String(db.correlativo + 1).padStart(8,"0")) + "</button></div>" +
    "</div></div>";

  $("dp-add").addEventListener("click", function(){
    var c = db.consolidado.filter(function(x){ return x.id === $("dp-mat").value; })[0];
    var q = num($("dp-cant").value);
    if(!c || q <= 0) return aviso("Elija el material y su cantidad.");
    salen.push({codigo:c.codigo, desc:c.desc, unidad:c.unidad, cant:q});
    $("dp-cant").value = "";
    VISTA.despachar();
  });
  var qs = $("zona").querySelectorAll("[data-q]"), i;
  for(i=0;i<qs.length;i++) qs[i].addEventListener("click", function(){
    salen.splice(+this.dataset.q,1); VISTA.despachar();
  });
  $("dp-ok").addEventListener("click", function(){
    if(!salen.length) return aviso("Agregue al menos un material.");
    db.correlativo++;
    var numero = db.serie + " - " + String(db.correlativo).padStart(8,"0");
    db.guias.unshift({id:uid(), numero:numero, fecha:hoy(),
      transportista:$("dp-trans").value.trim(), estado:"en_camino", lineas:salen.slice()});
    salen = [];
    guardar(); pintarMenu(); ir("guia");
    aviso("Guía " + numero + " generada. El almacén ya la ve.");
  });
};

/* ---------- GUÍAS ---------- */
VISTA.guia = function(){
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Guías emitidas</h2>" +
    '<p class="nota">Serie ' + esc(db.serie) + ". El número lo pone la app, no se escribe a mano.</p>" +
    (db.guias.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Número</th><th>Fecha</th><th>Transportista</th>' +
        '<th class="n">Bienes</th><th>Estado</th></tr></thead><tbody>' +
        db.guias.map(function(g){
          var e = g.estado === "recibida" ? "est-ok" : (g.estado === "parcial" ? "est-alerta" : "est-info");
          return "<tr><td><b>" + esc(g.numero) + "</b></td><td>" + fecha(g.fecha) + "</td>" +
            "<td>" + esc(g.transportista || "—") + "</td><td class='n'>" + g.lineas.length + "</td>" +
            '<td><span class="marca-est ' + e + '">' + g.estado.replace("_"," ") + "</span></td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">Todavía no hay guías.</div>') +
    '<div class="aviso"><p>Este documento <b>no reemplaza a la guía electrónica de la SUNAT</b>. ' +
    "Es el mismo formato, para despachar y controlar la recepción.</p></div>" +
    "</div></div>";
};

/* ---------- PUESTOS (Administrador de la app) ---------- */
VISTA.puestos = function(){
  var pend = {
    obra: db.requerimientos.filter(function(r){ return r.estado === "pendiente"; }).length,
    jefatura: db.requerimientos.filter(function(r){ return r.estado === "en_logistica"; }).length,
    compras: db.requerimientos.filter(function(r){ return r.estado === "aprobado"; }).length,
    almacenero: db.guias.filter(function(g){ return g.estado === "en_camino"; }).length
  };
  $("zona").innerHTML = '<div class="vista">' +
    '<div class="cifras">' +
      '<div class="cifra"><b>' + db.requerimientos.length + "</b><small>pedidos</small></div>" +
      '<div class="cifra"><b>' + db.guias.length + "</b><small>guías</small></div>" +
      '<div class="cifra"><b>' + db.movimientos.length + "</b><small>movimientos</small></div>" +
      '<div class="cifra"><b>' + db.materiales.length + "</b><small>materiales</small></div>" +
    "</div>" +
    '<div class="tarjeta"><h2>Entrar como otro puesto</h2>' +
    '<p class="nota">Para revisar qué ve cada uno. Vuelve a su panel cuando quiera.</p>' +
    '<div class="puestos">' +
    PUESTOS.filter(function(p){ return !p.admin; }).map(function(p){
      var n = pend[p.k] || 0;
      return '<button class="puesto" type="button" data-como="' + p.k + '">' +
        '<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p.ic + "</svg></span>" +
        "<span><b>" + p.t + "</b><small>" +
        (n ? n + (n === 1 ? " cosa esperando" : " cosas esperando") : "sin pendientes") +
        "</small></span></button>";
    }).join("") + "</div></div></div>";

  var bs = $("zona").querySelectorAll("[data-como]"), i;
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){
    simular(this.dataset.como);
  });
};

/* ---------- MIS PEDIDOS (Supervisor) ---------- */
VISTA.mispedidos = function(){
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>En qué va lo que pedí</h2>" +
    (db.requerimientos.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Fecha</th>' +
        '<th>Materiales</th><th>Estado</th></tr></thead><tbody>' +
        db.requerimientos.map(function(r){
          var f = FLUJO[r.estado] || FLUJO.pendiente;
          return "<tr><td><b>" + esc(r.codigo) + "</b></td><td>" + fecha(r.fecha) + "</td>" +
            "<td>" + r.items.map(function(i){ return esc(i.desc); }).join(", ") + "</td>" +
            '<td><span class="marca-est ' + f.c + '">' + f.t + "</span></td></tr>";
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">Todavía no ha pedido nada.</div>') +
    "</div></div>";
};

function clavePuesto(fc){ return "fc" + String(fc).replace(/\D/g,""); }

function pintarAlta(){
  /* sin el administrador: ese puesto no se elige, se tiene */
  $("al-puesto").innerHTML = PUESTOS.filter(function(p){ return !p.admin; })
    .map(function(p){ return '<option value="' + p.k + '">' + esc(p.t) + "</option>"; }).join("");
}

function crearPerfil(){
  var v = function(id){ return ($(id).value || "").trim(); };
  var nombre = v("al-nombre"), cel = v("al-cel"),
      fc = v("al-fc").replace(/\D/g,""), clave = $("al-clave").value,
      puesto = $("al-puesto").value;
  var err = $("al-err");
  err.textContent = "";
  if(nombre.length < 5) return err.textContent = "Escriba su nombre completo.";
  if(cel.replace(/\D/g,"").length < 6) return err.textContent = "Escriba su número de celular.";
  if(fc.length < 3) return err.textContent = "Escriba el número de su fotocheck.";
  if(!clave.length) return err.textContent = "Escriba una contraseña.";
  if(db.usuarios.some(function(u){ return u.fc === fc; }))
    return err.textContent = "Ese fotocheck ya tiene un perfil. Entre con su contraseña.";

  /* el dueño de la app trabaja de almacenero y además la administra:
     su cuenta lleva los dos, y elige cuál usar desde el propio panel */
  if(fc === FOTOCHECK_DUENO){ puesto = "almacenero"; localStorage.setItem("almacen_simple_dueno","1"); }
  else localStorage.setItem("almacen_simple_dueno","0");
  db.usuarios.push({id:uid(), nombre:nombre, cel:cel, fc:fc, clave:clave, puesto:puesto,
                    creado:new Date().toISOString()});
  guardar();
  entrar(puesto, nombre);
  aviso("Listo, " + nombre.split(" ")[0] + ". Su fotocheck es su acceso.");
}

function intentarEntrar(){
  var fc = ($("ac-fc").value || "").replace(/\D/g,"");
  var clave = $("ac-clave").value;
  var err = $("ac-err");
  err.textContent = "";
  var u = db.usuarios.filter(function(x){ return x.fc === fc; })[0];
  if(u) localStorage.setItem("almacen_simple_dueno", u.fc === FOTOCHECK_DUENO ? "1" : "0");
  if(!u){
    err.textContent = db.usuarios.length
      ? "En este equipo no hay ningún perfil con ese fotocheck. Créelo abajo."
      : "En este equipo todavía no hay perfiles. Cree el suyo abajo.";
    $("alta").style.display = "";
    if($("al-fc")) $("al-fc").value = fc;
    if($("al-clave")) $("al-clave").value = clave;
    setTimeout(function(){ if($("al-nombre")) $("al-nombre").focus(); }, 120);
    return;
  }
  if(u.clave !== clave) return err.textContent = "La contraseña no coincide.";
  $("ac-fc").value = ""; $("ac-clave").value = "";
  entrar(u.puesto, u.nombre);
  aviso("Bienvenido, " + u.nombre.split(" ")[0] + ".");
}

function pintarPortada(){
  /* el administrador no está entre los botones de mirar sin cuenta:
     a ese panel se entra con el fotocheck del dueño y su contraseña */
  $("puestos").innerHTML = PUESTOS.filter(function(p){ return !p.admin; }).map(function(p){
    return '<button class="puesto' + (p.destacado ? " destacado" : "") +
      (p.admin ? " admin" : "") + '" type="button" data-p="' + p.k + '">' +
      '<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p.ic + "</svg></span>" +
      "<span><b>" + p.t + "</b><small>" + p.d + "</small></span></button>";
  }).join("");
  var bs = $("puestos").querySelectorAll("[data-p]"), i;
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){ entrar(this.dataset.p); });
}

function esDueno(){
  return db.usuarios.some(function(u){
    return u.fc === FOTOCHECK_DUENO && u.nombre === localStorage.getItem("almacen_simple_persona");
  }) || localStorage.getItem("almacen_simple_dueno") === "1";
}

function pintarSombreros(){
  var caja = $("sombreros");
  if(!caja) return;
  var mostrar = localStorage.getItem("almacen_simple_dueno") === "1";
  caja.style.display = mostrar ? "flex" : "none";
  if(!mostrar) return;
  var bs = caja.querySelectorAll("[data-sombrero]"), i;
  for(i=0;i<bs.length;i++){
    bs[i].classList.toggle("on", bs[i].dataset.sombrero === cargo);
    if(bs[i].dataset.enlazado) continue;
    bs[i].dataset.enlazado = "1";
    bs[i].addEventListener("click", function(){
      var k = this.dataset.sombrero;
      if(k === cargo) return;
      cargo = k;
      localStorage.setItem("almacen_simple_cargo", k);
      simulando = false;
      $("banda").classList.remove("ver");
      $("quien").innerHTML = "<small>" + esc(NOMBRE_PUESTO[k]) + "</small><b>" +
        esc(localStorage.getItem("almacen_simple_persona") || NOMBRE_PUESTO[k]) + "</b>";
      pintarMenu(); pintarSombreros();
      ir(PANEL[k][0]);
    });
  }
}

function entrar(k, persona){
  simulando = false;
  $("banda").classList.remove("ver");
  cargo = k;
  localStorage.setItem("almacen_simple_cargo", k);
  if(persona) localStorage.setItem("almacen_simple_persona", persona);
  else localStorage.removeItem("almacen_simple_persona");
  var quien = persona || NOMBRE_PUESTO[k];
  $("portada").classList.remove("ver");
  $("quien").innerHTML = "<small>" + esc(NOMBRE_PUESTO[k]) + "</small><b>" + esc(quien) + "</b>";
  pintarMenu();
  pintarSombreros();
  ir(PANEL[k][0]);
}

var simulando = false;

function simular(k){
  simulando = true;
  cargo = k;
  $("banda").classList.add("ver");
  $("banda-txt").textContent = "Está viendo la app como " + NOMBRE_PUESTO[k];
  $("quien").innerHTML = "<small>Viendo como</small><b>" + esc(NOMBRE_PUESTO[k]) + "</b>";
  pintarMenu();
  ir(PANEL[k][0]);
}

function volverAdmin(){
  simulando = false;
  cargo = "admin";
  $("banda").classList.remove("ver");
  $("quien").innerHTML = "<small>Puesto</small><b>" + esc(NOMBRE_PUESTO.admin) + "</b>";
  pintarMenu();
  ir(PANEL.admin[0]);
}

function salir(){
  localStorage.removeItem("almacen_simple_cargo");
  localStorage.removeItem("almacen_simple_persona");
  localStorage.removeItem("almacen_simple_dueno");
  if($("sombreros")) $("sombreros").style.display = "none";
  if($("alta")) $("alta").style.display = "none";
  $("portada").classList.add("ver");
  window.scrollTo(0,0);
}

pintarPortada();
pintarAlta();
$("salir").querySelector("button").addEventListener("click", salir);
$("banda-volver").addEventListener("click", volverAdmin);
$("ac-entrar").addEventListener("click", intentarEntrar);
$("ac-clave").addEventListener("keydown", function(e){ if(e.key === "Enter") intentarEntrar(); });
$("ac-crear").addEventListener("click", function(){
  $("alta").style.display = "";
  $("al-nombre").focus();
});
$("al-cancelar").addEventListener("click", function(){ $("alta").style.display = "none"; });
$("al-ok").addEventListener("click", crearPerfil);

var guardado = localStorage.getItem("almacen_simple_cargo");
if(guardado && PANEL[guardado]) entrar(guardado, localStorage.getItem("almacen_simple_persona"));
else {
  $("portada").classList.add("ver");
  /* En un equipo recién estrenado nadie tiene cuenta todavía: el recuadro
     de entrar no sirve para nada y confunde. Se abre directo el de crear. */
  if(!db.usuarios.length){
    $("alta").style.display = "";
    var t = document.querySelector("#portada p.sub");
    if(t) t.textContent = "Es la primera vez en este equipo. Cree su perfil para entrar.";
  }
}
