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
        botonArchivo("co-archivo", "Subir el consolidado del día", ".xlsx,.csv", "sec") +
        "</div></div>"
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

  if($("co-archivo-bt")){
    enlazarBotonArchivo("co-archivo", {acepta:".xlsx,.csv",
      confirmar:"toque para reemplazar el consolidado",
      alConfirmar:function(a){ cargarConsolidado(a); }});
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
/* La Administradora de Obra corrige lo que le llega: el supervisor pide
   "cemento" y son 40 bolsas, o se equivocó de frente. Lo hace sobre el
   pedido, sin devolvérselo y sin rehacerlo.

   Se puede editar mientras el material no se haya comprado. Después no:
   lo comprado ya se pagó y lo entregado ya salió del almacén, así que
   cambiar el pedido dejaría el kardex diciendo una cosa y el pedido otra.
   El administrador de la app puede editar siempre, para arreglar líos. */
function puedeEditarReq(r){
  if(cargo === "admin") return true;
  if(cargo !== "obra") return false;
  return r.estado === "pendiente" || r.estado === "en_logistica";
}

var editando = null;      /* id del requerimiento abierto en el editor */
var itemsEdit = [];       /* copia de trabajo: nada se toca hasta guardar */

function abrirEditor(id){
  var r = db.requerimientos.filter(function(x){ return x.id === id; })[0];
  if(!r) return;
  editando = id;
  itemsEdit = r.items.map(function(i){
    return {desc:i.desc, und:i.und || "und", cant:i.cant, sol:i.sol || "", frente:i.frente || "", obs:i.obs || ""};
  });
  VISTA.revisar();
}

function cerrarEditor(){ editando = null; itemsEdit = []; VISTA.revisar(); }

function filaEditor(r){
  return '<tr><td colspan="7" style="background:var(--sup2);padding:14px">' +
    '<div class="rejilla dos" style="margin-bottom:10px">' +
      '<label class="campo"><span>Fecha del pedido</span>' +
        '<input type="date" id="ed-fecha" value="' + esc(r.fecha) + '"></label>' +
      '<label class="campo"><span>Área</span>' +
        '<input id="ed-area" value="' + esc(r.area || "") + '"></label>' +
    "</div>" +
    '<div class="tabla-caja"><table><thead><tr>' +
      "<th>N°</th><th>Descripción</th><th>Und</th><th class='n'>Cantidad</th>" +
      "<th>Solicitante</th><th>Lugar / frente</th><th>Observaciones</th><th></th>" +
    "</tr></thead><tbody>" +
    itemsEdit.map(function(it, i){
      return "<tr><td class='n' style='color:var(--tinta3)'>" + (i + 1) + "</td>" +
        '<td style="min-width:180px"><input data-e="' + i + '" data-k="desc" value="' + esc(it.desc) + '"></td>' +
        '<td style="width:140px"><select data-e="' + i + '" data-k="und">' + opcionesUnidad(it.und || "und") + "</select></td>" +
        '<td style="width:96px"><input class="n" type="number" min="0" step="0.01" data-e="' + i + '" data-k="cant" value="' + esc(it.cant) + '"></td>' +
        '<td style="min-width:130px"><input data-e="' + i + '" data-k="sol" value="' + esc(it.sol) + '"></td>' +
        '<td style="min-width:130px"><input data-e="' + i + '" data-k="frente" value="' + esc(it.frente) + '"></td>' +
        '<td style="min-width:150px"><input data-e="' + i + '" data-k="obs" value="' + esc(it.obs) + '"></td>' +
        '<td><button class="bt chico" type="button" data-quita-e="' + i + '">Quitar</button></td></tr>';
    }).join("") + "</tbody></table></div>" +
    '<div class="botones" style="margin-top:11px">' +
      '<button class="bt sec" type="button" id="ed-add">Agregar material</button>' +
      '<button class="bt pri" type="button" id="ed-guardar">Guardar cambios</button>' +
      '<button class="bt" type="button" id="ed-cancelar">Cancelar</button>' +
    "</div></td></tr>";
}

function engancharEditor(){
  if(!editando) return;
  var z = $("zona");

  var ins = z.querySelectorAll("[data-e][data-k]"), i;
  for(i = 0; i < ins.length; i++){
    var ev = ins[i].tagName === "SELECT" ? "change" : "input";
    ins[i].addEventListener(ev, function(){
      itemsEdit[+this.dataset.e][this.dataset.k] = this.value;
    });
  }
  var qs = z.querySelectorAll("[data-quita-e]");
  for(i = 0; i < qs.length; i++) qs[i].addEventListener("click", function(){
    itemsEdit.splice(+this.dataset.quitaE, 1);
    VISTA.revisar();
  });
  $("ed-add").addEventListener("click", function(){
    itemsEdit.push({desc:"", und:"und", cant:"", sol:"", frente:"", obs:""});
    VISTA.revisar();
  });
  $("ed-cancelar").addEventListener("click", cerrarEditor);
  $("ed-guardar").addEventListener("click", guardarEdicion);
}

function guardarEdicion(){
  var r = db.requerimientos.filter(function(x){ return x.id === editando; })[0];
  if(!r) return cerrarEditor();

  var buenos = itemsEdit.filter(function(i){ return String(i.desc).trim() && num(i.cant) > 0; });
  if(!buenos.length) return aviso("Deje al menos un material con su cantidad.");

  var sols = [], frentes = [];
  buenos.forEach(function(i){
    var q = String(i.sol || "").trim(), f = String(i.frente || "").trim();
    if(q && sols.indexOf(q) < 0) sols.push(q);
    if(f && frentes.indexOf(f) < 0) frentes.push(f);
  });
  if(!sols.length) return aviso("Escriba quién lo pide, al menos en un punto.");

  /* Se deshace lo que este pedido le había sumado al consolidado y se
     vuelve a aplicar con lo corregido. Cambiar los números en el sitio
     dejaría el consolidado con la cuenta vieja. */
  var d = revertirDelConsolidado(r.codigo);

  r.fecha = $("ed-fecha").value || r.fecha;
  r.area = $("ed-area").value.trim();
  r.solicitante = sols.join(" · ");
  r.frente = frentes.join(" · ");
  r.items = buenos.map(function(i){
    return {desc:String(i.desc).trim(), und:i.und || "und", cant:num(i.cant),
            sol:String(i.sol || "").trim() || sols[0], frente:String(i.frente || "").trim(),
            obs:String(i.obs || "").trim()};
  });

  var res = aplicarAlConsolidado(r);
  guardar();
  subirReq(r);
  var id = r.codigo;
  cerrarEditor();
  pintarMenu();
  aviso(id + " actualizado · " + r.items.length + " material(es)" +
        (res.nuevos ? " · " + res.nuevos + " nuevo(s) en el consolidado" : "") + ".");
}

VISTA.revisar = function(){
  var esObra = (cargo === "obra" || cargo === "admin");

  /* El pedido del día que todavía no sale, uno por proyecto. Es lo que
     la Administradora tiene delante para revisar. */
  var abiertos = db.requerimientos.filter(function(r){ return r.estado === "pendiente"; });
  var salidos  = db.requerimientos.filter(function(r){ return r.estado !== "pendiente"; });

  var resumen = "";
  if(cargo === "obra"){
    var porRevisar = 0;
    abiertos.forEach(function(r){
      porRevisar += r.items.filter(function(i){ return !i.validado && !i.devuelto; }).length;
    });
    var enLog = salidos.filter(function(r){
      return r.estado === "en_logistica" || r.estado === "aprobado"; }).length;
    var req = 0, comp = 0;
    db.consolidado.forEach(function(c){ req += c.requerido; comp += c.comprado; });
    var falta = Math.round((req - comp) * 100) / 100;
    var pct = req ? Math.round(comp / req * 100) : 0;
    resumen = '<div class="cifras">' +
      '<div class="cifra"><b style="color:' + (porRevisar ? "var(--rojo)" : "var(--verde)") + '">' +
        porRevisar + "</b><small>materiales por validar</small></div>" +
      '<div class="cifra"><b>' + enLog + "</b><small>en manos de logística</small></div>" +
      '<div class="cifra"><b>' + falta + "</b><small>falta comprar</small></div>" +
      '<div class="cifra"><b>' + pct + '%</b><small>de la obra comprado</small></div>' +
    "</div>";
  }

  var html = '<div class="vista">' + resumen;

  if(esObra){
    html += abiertos.length
      ? abiertos.map(function(r){ return tarjetaDelDia(r); }).join("")
      : '<div class="tarjeta"><h2>Todo pedido pasa primero por usted</h2>' +
        '<div class="vacio">Hoy todavía no hay nada que revisar.</div></div>';
  }

  /* Lo que ya salió: para Obra es historial, para logística y compras es
     su bandeja de entrada. */
  var deOtros = esObra ? salidos : salidos;
  html += '<div class="tarjeta">' +
    "<h2>" + (esObra ? "Ya pasaron a logística" : "Pedidos que Obra ya revisó") + "</h2>" +
    '<p class="nota">' + (esObra
      ? "Salieron con los materiales que usted validó."
      : "Dé el visto bueno para que el asistente pueda comprar.") + "</p>" +
    (deOtros.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Proyecto</th><th>Fecha</th>' +
        '<th class="n">Materiales</th><th>Estado</th><th></th></tr></thead><tbody>' +
        deOtros.map(function(r){
          var f = FLUJO[r.estado] || FLUJO.pendiente;
          var sig = siguienteEstado(r);
          var vivos = r.items.filter(function(i){ return !i.devuelto; });
          return "<tr><td><b>" + esc(etiquetaReq(r)) + "</b></td>" +
            "<td>" + esc(nombreProyecto(r.proyecto)) + "</td><td>" + fecha(r.fecha) + "</td>" +
            "<td class='n'>" + vivos.length + "</td>" +
            '<td><span class="marca-est ' + f.c + '">' + f.t + "</span></td>" +
            '<td style="white-space:nowrap">' +
              '<button class="bt chico" type="button" data-ver="' + r.id + '">Ver</button> ' +
              (puedeEditarReq(r)
                ? '<button class="bt chico" type="button" data-editar="' + r.id + '">Editar</button> '
                : "") +
              (sig && !esObra
                ? '<button class="bt chico pri" type="button" data-ok="' + r.id + '">Visto bueno</button>'
                : "") + "</td></tr>" +
            '<tr data-det="' + r.id + '" style="display:none"><td colspan="7" style="background:var(--sup2)">' +
              vivos.map(function(it){
                return "· <b>" + esc(it.desc) + "</b> — " + it.cant + " " + esc(it.und) +
                  (it.sol ? " · " + esc(it.sol) : "") +
                  (it.frente ? " · " + esc(it.frente) : "") +
                  (it.obs ? " · <i>" + esc(it.obs) + "</i>" : "");
              }).join("<br>") + "</td></tr>" +
            (editando === r.id ? filaEditor(r) : "");
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">Todavía no ha salido ningún pedido.</div>') +
    "</div></div>";

  $("zona").innerHTML = html;
  engancharRevisar();
};

/* ---------------------------------------------------------------------
   LA TARJETA DEL PEDIDO DEL DÍA

   Un renglón por material, no por supervisor: la Administradora puede
   mandar los clavos de uno y devolverle la dimantina a otro sin que se
   arrastren entre ellos.
   --------------------------------------------------------------------- */
function tarjetaDelDia(r){
  var et = etiquetaReq(r);
  var vivos = r.items.filter(function(i){ return !i.devuelto; });
  var ok = vivos.filter(function(i){ return i.validado; }).length;

  return '<div class="tarjeta">' +
    "<h2>" + esc(et) + " · " + esc(nombreProyecto(r.proyecto)) + " · " + fecha(r.fecha) + "</h2>" +
    '<div class="botones" style="align-items:center;margin:0 0 12px">' +
      '<p class="nota" style="margin:0;flex:1;min-width:220px">' +
        "Revise y páselo a logística. Nada sale de la obra sin su visto bueno." +
      "</p>" +
      '<button class="bt pri" type="button" data-enviar="' + r.id + '"' +
        (ok ? "" : " disabled") + ">Pasar a logística</button>" +
    "</div>" +
    (vivos.length
      ? '<div class="tabla-caja"><table><thead><tr>' +
        "<th>Material</th><th class='n'>Cantidad</th><th>Solicitante</th><th>Lugar</th>" +
        "<th>Observaciones</th><th></th></tr></thead><tbody>" +
        vivos.map(function(it){
          var k = r.items.indexOf(it);
          return "<tr>" +
            "<td><b>" + esc(it.desc) + "</b></td>" +
            "<td class='n'>" + it.cant + " " + esc(it.und) + "</td>" +
            "<td>" + esc(it.sol || "—") + "</td>" +
            "<td>" + esc(it.frente || "—") + "</td>" +
            '<td style="min-width:150px">' +
              (it.validado
                ? esc(it.obs || "—")
                : '<input data-motivo="' + r.id + ':' + k + '" value="' + esc(it.motivo || "") +
                  '" placeholder="Por qué se devuelve">') +
            "</td>" +
            '<td style="white-space:nowrap"><button class="bt chico ' +
              (it.validado ? "pri" : "") + '" type="button" data-val="' + r.id + ":" + k + '">' +
              (it.validado ? "Validado para enviar en " + esc(et) : "Validar para enviar en " + esc(et)) +
            "</button></td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="nota" style="margin-top:10px">' +
          "<b>" + ok + "</b> de " + vivos.length + " validado(s). " +
          (ok < vivos.length
            ? "Los " + (vivos.length - ok) + " que no marque vuelven a su supervisor para que los corrija."
            : "Todo listo para salir.") +
        "</p>"
      : '<div class="vacio">Este pedido se quedó sin materiales.</div>') +
    "</div>";
}

function engancharRevisar(){
  var z = $("zona"), i;

  var vs = z.querySelectorAll("[data-ver]");
  for(i=0;i<vs.length;i++) vs[i].addEventListener("click", function(){
    var f = $("zona").querySelector('[data-det="' + this.dataset.ver + '"]');
    var abierto = f.style.display !== "none";
    f.style.display = abierto ? "none" : "";
    this.textContent = abierto ? "Ver" : "Ocultar";
  });

  /* validar o quitar la validación de un material */
  var vl = z.querySelectorAll("[data-val]");
  for(i=0;i<vl.length;i++) vl[i].addEventListener("click", function(){
    var p = this.dataset.val.split(":");
    var r = db.requerimientos.filter(function(x){ return x.id === p[0]; })[0];
    if(!r) return;
    var it = r.items[+p[1]];
    it.validado = !it.validado;
    guardar(); subirReq(r); VISTA.revisar();
  });

  /* el motivo se guarda mientras lo escribe */
  var mt = z.querySelectorAll("[data-motivo]");
  for(i=0;i<mt.length;i++) mt[i].addEventListener("input", function(){
    var p = this.dataset.motivo.split(":");
    var r = db.requerimientos.filter(function(x){ return x.id === p[0]; })[0];
    if(!r) return;
    r.items[+p[1]].motivo = this.value;
    guardar();
  });

  var en = z.querySelectorAll("[data-enviar]");
  for(i=0;i<en.length;i++) en[i].addEventListener("click", function(){
    pasarALogistica(this.dataset.enviar);
  });

  var bs = z.querySelectorAll("[data-ok]");
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.ok; }.bind(this))[0];
    r.estado = siguienteEstado(r);
    guardar(); subirReq(r); VISTA.revisar(); pintarMenu();
    aviso(etiquetaReq(r) + " · " + FLUJO[r.estado].t.toLowerCase() + ".");
  });

  var es = z.querySelectorAll("[data-editar]");
  for(i=0;i<es.length;i++) es[i].addEventListener("click", function(){
    abrirEditor(this.dataset.editar);
  });
  engancharEditor();
}

/* ---------------------------------------------------------------------
   PASAR EL PEDIDO DEL DÍA A LOGÍSTICA

   Sale lo validado. Lo que no se validó no se pierde ni se compra: se
   le devuelve al supervisor que lo pidió, con el motivo, para que lo
   corrija y lo vuelva a mandar en el pedido de mañana.
   --------------------------------------------------------------------- */
function pasarALogistica(id){
  var r = db.requerimientos.filter(function(x){ return x.id === id; })[0];
  if(!r) return;

  var vivos = r.items.filter(function(i){ return !i.devuelto; });
  var val = vivos.filter(function(i){ return i.validado; });
  var no  = vivos.filter(function(i){ return !i.validado; });

  if(!val.length) return aviso("No ha validado ningún material. Marque al menos uno.");

  if(no.length){
    var sinMotivo = no.filter(function(i){ return !String(i.motivo || "").trim(); }).length;
    if(!confirm(no.length + " material(es) sin validar vuelven a su supervisor para que los corrija" +
                (sinMotivo ? ", y " + sinMotivo + " van sin motivo escrito" : "") + ".\n\n" +
                "Salen a logística los " + val.length + " que validó. ¿Continuar?")) return;
  }

  no.forEach(function(i){
    i.devuelto = true;
    i.devueltoEn = new Date().toISOString();
    /* no se compra, así que sale de la cuenta del consolidado */
    restarDelConsolidado(r.codigo, i);
  });

  r.estado = siguienteEstado(r) || "en_logistica";
  guardar();
  subirReq(r);
  VISTA.revisar();
  pintarMenu();
  aviso(etiquetaReq(r) + " salió a logística con " + val.length + " material(es)" +
        (no.length ? " · " + no.length + " devuelto(s) al supervisor" : "") + ".");
}


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
          return "<tr><td><b>" + esc(etiquetaReq(r)) + "</b></td><td>" + esc(r.solicitante) + "</td>" +
            "<td>" + r.items.map(function(i){ return esc(i.desc) + " (" + i.cant + ")"; }).join(", ") + "</td>" +
            '<td><button class="bt chico pri" type="button" data-comp="' + r.id + '">Comprado</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">No hay pedidos aprobados esperando compra.</div>') +
    "</div></div>";
  var bs = $("zona").querySelectorAll("[data-comp]"), i;
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.comp; }.bind(this))[0];
    r.estado = "comprado";
    guardar(); subirReq(r); VISTA.comprar();
    aviso(r.codigo + " comprado. Ya se puede despachar.");
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
          return "<tr><td><b>" + esc(etiquetaReq(r)) + "</b></td><td>" + fecha(r.fecha) + "</td>" +
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
  /* Tres letras, no cinco: Ana, Eva, Luis y Jose son nombres de verdad y
     el minimo de cinco los dejaba fuera. Es el mismo minimo que pide la
     base, para que no acepte aqui lo que alla rechaza. */
  if(nombre.length < 3) return err.textContent = "Escriba su nombre.";
  if(cel.replace(/\D/g,"").length < 6) return err.textContent = "Escriba su número de celular.";
  if(fc.length < 3) return err.textContent = "Escriba el número de su fotocheck.";
  if(!clave.length) return err.textContent = "Escriba una contraseña.";
  if(db.usuarios.some(function(u){ return u.fc === fc; }))
    return err.textContent = "Ese fotocheck ya tiene un perfil. Entre con su contraseña.";

  /* el dueño de la app trabaja de almacenero y además la administra:
     su cuenta lleva los dos, y elige cuál usar desde el propio panel */
  if(fc === FOTOCHECK_DUENO){ puesto = "almacenero"; localStorage.setItem("almacen_simple_dueno","1"); }
  else localStorage.setItem("almacen_simple_dueno","0");

  /* La cuenta se crea en la base, que es donde debe vivir: así sirve en
     el celular y en la computadora. La contraseña la guarda cifrada el
     servicio de acceso; aquí no queda copia de ella.

     Si la base no contesta —sin señal, o todavía sin montar— se crea
     solo en este equipo, como hasta ahora, y la persona puede trabajar
     igual. Volver a registrarse con señal la crea allá. */
  if(typeof nubeCrearPerfil === "function"){
    $("al-err").textContent = "Creando su cuenta…";
    nubeCrearPerfil({nombre:nombre, puesto:puesto, celular:cel, fotocheck:fc, clave:clave})
      .then(function(p){
        $("al-err").textContent = "";
        entrar(p.puesto, p.nombre);
        aviso("Listo, " + p.nombre.split(" ")[0] + ". Su cuenta sirve en cualquier equipo.");
        nubeArrancar();
      })
      .catch(function(e){
        $("al-err").textContent = "";
        if(/already registered|ya existe|User already/i.test(e.message || "")){
          return altaSoloLocal(nombre, cel, fc, clave, puesto,
            "Ese fotocheck ya tiene cuenta en la base. Entre con su contraseña.");
        }
        altaSoloLocal(nombre, cel, fc, clave, puesto,
          "Creada solo en este equipo. La base no contestó: " + e.message);
      });
    return;
  }
  altaSoloLocal(nombre, cel, fc, clave, puesto, null);
}

function altaSoloLocal(nombre, cel, fc, clave, puesto, motivo){
  if(db.usuarios.some(function(u){ return u.fc === fc; })){
    if(motivo) return aviso(motivo);
  } else {
    db.usuarios.push({id:uid(), nombre:nombre, cel:cel, fc:fc, clave:clave, puesto:puesto,
                      creado:new Date().toISOString()});
    guardar();
  }
  entrar(puesto, nombre);
  aviso(motivo || ("Listo, " + nombre.split(" ")[0] + ". Su fotocheck es su acceso."));
}

function intentarEntrar(){
  var fc = ($("ac-fc").value || "").replace(/\D/g,"");
  var clave = $("ac-clave").value;
  var err = $("ac-err");
  err.textContent = "";

  /* Primero se prueba contra la base: si esa persona tiene cuenta allá,
     su perfil y su puesto son los de la base, iguales en todos los
     equipos. Solo si la base no la conoce —o no hay señal— se busca en
     la lista de este equipo, que es lo que había hasta ahora. */
  if(typeof nubeEntrar === "function" && fc && clave && !entrandoPorNube){
    entrandoPorNube = true;
    err.textContent = "Comprobando…";
    nubeEntrar(fc, clave).then(function(p){
      entrandoPorNube = false;
      err.textContent = "";
      $("ac-fc").value = ""; $("ac-clave").value = "";
      localStorage.setItem("almacen_simple_dueno", fc === FOTOCHECK_DUENO ? "1" : "0");
      localStorage.setItem("almacen_simple_fc", fc);
      entrar(p.puesto, p.nombre);
      aviso("Bienvenido, " + p.nombre.split(" ")[0] + ". En línea.");
      nubeArrancar();
    }).catch(function(e){
      entrandoPorNube = false;
      err.textContent = "";
      /* la base dijo que no; se sigue con la lista local */
      seguirEntrandoLocal(fc, clave, e);
    });
    return;
  }
  seguirEntrandoLocal(fc, clave, null);
}

var entrandoPorNube = false;

function seguirEntrandoLocal(fc, clave, errorNube){
  var err = $("ac-err");
  var u = db.usuarios.filter(function(x){ return x.fc === fc; })[0];
  if(u){
    localStorage.setItem("almacen_simple_dueno", u.fc === FOTOCHECK_DUENO ? "1" : "0");
    localStorage.setItem("almacen_simple_fc", u.fc);
  }
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
  if(u.clave !== clave){
    return err.textContent = errorNube && /invalid|credenciales|password/i.test(errorNube.message)
      ? "El fotocheck o la contraseña no coinciden."
      : "La contraseña no coincide.";
  }

  /* Aquí estaba el agujero por el que no llegaba nada a las tablas.
     La contraseña era la correcta según este equipo, pero la base no
     conocía a esta persona, así que se entraba «solo en este equipo» y
     todo el trabajo del día se quedaba en el navegador. De ahí que un
     aparato mostrara una cosa y el otro otra, y que el botón de
     actualizar no tuviera de dónde igualar.

     Ahora se le crea la cuenta en la base con lo que acaba de escribir
     y se entra en línea. Nadie tiene que hacer un trámite aparte, que
     en obra no lo hace nadie. */
  var seguirLocal = function(porque){
    $("ac-fc").value = ""; $("ac-clave").value = "";
    entrar(u.puesto, u.nombre);
    aviso("Bienvenido, " + u.nombre.split(" ")[0] + ". " + (porque || "Solo en este equipo."));
  };

  var noConoce = !errorNube ||
    /invalid login credentials|invalid_grant|credentials/i.test(String(errorNube.message || ""));

  if(typeof nubeAltaSiHaceFalta === "function" && noConoce){
    err.textContent = "Creando su cuenta en la base…";
    nubeAltaSiHaceFalta({
      fotocheck: fc, clave: clave, nombre: u.nombre,
      puesto: u.puesto, celular: u.cel || ""
    }).then(function(p){
      err.textContent = "";
      $("ac-fc").value = ""; $("ac-clave").value = "";
      entrar(p.puesto || u.puesto, p.nombre || u.nombre);
      aviso("Bienvenido, " + (p.nombre || u.nombre).split(" ")[0] + ". En línea.");
      nubeArrancar();
    }).catch(function(e){
      err.textContent = "";
      var m = String((e && e.message) || "");
      seguirLocal(/aprobad|visto bueno/i.test(m)
        ? "Su cuenta ya está en la base y espera el visto bueno del administrador."
        : "La base no la tomó (" + m + "). Por ahora, solo en este equipo.");
    });
    return;
  }
  seguirLocal(errorNube ? "La base dice: " + errorNube.message : null);
}

/* =====================================================================
   ARRANCAR LA NUBE

   Se llama al entrar con cuenta de la base. Baja lo que hay, abre el
   canal de tiempo real y sube lo que se hubiera quedado pendiente.
   ===================================================================== */
function nubeArrancar(){
  if(typeof nubeHay !== "function" || !nubeHay()) return;

  Nube.alCambiar = function(tabla){
    /* Llega el aviso de que algo cambió allá. Se vuelve a bajar en vez de
       aplicar el cambio suelto: son pocos cientos de filas y así no hay
       forma de que la copia de aquí se desvíe de la de la base. */
    clearTimeout(Nube._t);
    Nube._t = setTimeout(nubeBajarYPintar, 400);
  };
  nubeEscuchar();
  nubeSubirPendientes().then(function(x){
    if(x.subidos) aviso("Se subieron " + x.subidos + " pendiente(s).");
  });
  nubeBajarYPintar();
  pintarEstadoNube();
}

function nubeBajarYPintar(){
  return nubeTraerTodo().then(function(t){
    if(!t) return;
    /* Los requerimientos de la base mandan sobre los de este equipo:
       allá está lo que ven todos. Lo local que aún no subió sigue en la
       cola y se reintenta aparte. */
    if(t.requerimientos && t.requerimiento_items){
      var porId = {};
      t.requerimiento_items.forEach(function(i){
        (porId[i.requerimiento_id] = porId[i.requerimiento_id] || []).push(i);
      });
      db.requerimientos = t.requerimientos.map(function(r){
        var items = (porId[r.id] || []).sort(function(a,b){ return (a.orden||0)-(b.orden||0); });
        return {id:r.id, nubeId:r.id, codigo:r.codigo, fecha:r.fecha,
                solicitante:r.solicitante, area:r.area || "", frente:r.frente || "",
                estado:r.estado, proyecto:r.proyecto || "todos",
                items:items.map(function(i){
                  return {desc:i.descripcion, und:i.unidad, cant:Number(i.cantidad),
                          sol:i.solicitante || "", frente:i.frente || "",
                          obs:i.observaciones || "",
                          validado: !!i.validado,
                          motivo: i.motivo_devolucion || "",
                          devuelto: !!i.devuelto_en,
                          devueltoEn: i.devuelto_en || null};
                })};
      });
    }
    if(t.consolidado && t.consolidado.length){
      db.consolidado = t.consolidado.map(function(c){
        return {id:c.id, codigo:c.codigo, desc:c.descripcion, unidad:c.unidad,
                requerido:Number(c.requerido), comprado:Number(c.comprado),
                entregado:Number(c.entregado), adicional:!!c.adicional,
                pedidos:[]};
      });
    }
    if(t.herramientas && t.herramientas.length){
      db.herramientas = t.herramientas.map(function(x){
        return {id:x.id, nombre:x.nombre, estado:x.estado, prestamo:null};
      });
    }
    /* Lo que la persona llevaba escrito en el otro aparato. Se aplica
       antes de repintar, para que la pantalla salga ya con ello puesto. */
    if(t.requerimiento_borradores && t.requerimiento_borradores.length &&
       typeof aplicarBorrador === "function"){
      var mio = t.requerimiento_borradores.filter(function(b){
        return !Nube.perfil || b.dueno === Nube.perfil.id;
      })[0];
      if(mio && mio.contenido) aplicarBorrador(mio.contenido, mio.equipo);
    }
    guardar();
    pintarEstadoNube();
    if(typeof VISTA[actual] === "function") VISTA[actual]();
    pintarMenu();
  }).catch(function(){});
}

/* =====================================================================
   ACTUALIZAR ESTE EQUIPO

   Lo tiene todo el mundo, no solo el administrador: el que se queda con
   la versión vieja o con datos raros es cualquiera, y esperar a que el
   administrador le llegue al cerro no es un plan.

   Borra lo que el navegador guardó de la app y, si la persona entró con
   su cuenta, también la copia local de los datos: al recargar se vuelve
   a bajar lo que hay en la base y este equipo queda igual que los demás.

   Si hay cosas sin subir NO se borra nada: primero se avisa. Perder un
   ingreso registrado sin señal por limpiar el equipo sería el peor
   cambio posible.
   ===================================================================== */
function ponerBotonActualizar(){
  var caja = $("salir");
  if(!caja || caja.querySelector(".actualizar")) return;
  var b = document.createElement("button");
  b.type = "button";
  b.className = "actualizar";
  b.textContent = "Actualizar este equipo";
  b.title = "Borra lo guardado en este equipo y vuelve a bajar lo de la base";
  b.addEventListener("click", actualizarEsteEquipo);
  caja.insertBefore(b, caja.firstChild);
}

async function actualizarEsteEquipo(){
  var pend = typeof nubePendientes === "function" ? nubePendientes() : 0;
  var enLinea = typeof nubeHay === "function" && nubeHay();

  /* Sin sesión no hay con qué igualar: no existe copia en la base de la
     que bajar. Antes el botón limpiaba el caché igual y la persona se
     quedaba creyendo que había igualado; por eso lo apretaba en los dos
     aparatos y seguían mostrando cosas distintas. Ahora se dice, y se
     ofrece lo único que sí se puede hacer aquí, que es traer el
     programa nuevo. */
  if(!enLinea){
    if(!confirm("Este equipo NO está conectado a la base, así que no hay con qué igualarlo.\n\n" +
                "Lo que ve aquí está guardado solo en este navegador. Para que los equipos " +
                "muestren lo mismo hay que salir y volver a entrar con fotocheck y " +
                "contraseña en cada uno.\n\n" +
                "¿Quiere al menos traer la última versión del programa? Sus datos NO se tocan.")) return;
    try{
      if(window.caches){
        var lls = await caches.keys();
        for(var q = 0; q < lls.length; q++) await caches.delete(lls[q]);
      }
      if(navigator.serviceWorker){
        var rg = await navigator.serviceWorker.getRegistrations();
        for(var w = 0; w < rg.length; w++) await rg[w].unregister();
      }
    }catch(e){}
    aviso("Trayendo la última versión del programa…");
    setTimeout(function(){ location.reload(); }, 600);
    return;
  }

  if(pend){
    if(!confirm("Hay " + pend + " cosa(s) registrada(s) que todavía no suben a la base.\n\n" +
                "Si limpia ahora se pierden. Lo sano es esperar a que suban.\n\n" +
                "Aceptar = limpiar igual y perderlas.")) return;
  } else if(!confirm("Este equipo se va a quedar solo con lo que hay en la base.\n\n" +
                     "Se borra la copia local y se vuelve a bajar todo. Sus datos están " +
                     "en la base, no se pierde nada.\n\n¿Continuar?")) return;

  try{
    if(window.caches){
      var llaves = await caches.keys();
      for(var i = 0; i < llaves.length; i++) await caches.delete(llaves[i]);
    }
    if(navigator.serviceWorker){
      var regs = await navigator.serviceWorker.getRegistrations();
      for(var j = 0; j < regs.length; j++) await regs[j].unregister();
    }
  }catch(e){}

  /* Se va todo lo que este equipo guardó por su cuenta. Al recargar, la
     app vuelve a bajar de la base y este aparato queda igual que los
     demás, que es justo lo que se le pide al botón.

     La sesión se conserva a propósito: si se borrara habría que volver
     a entrar y no se bajaría nada, o sea lo contrario de lo que pide. */
  try{
    localStorage.removeItem(CLAVE);
    localStorage.removeItem("almacen_cola_nube");
    localStorage.removeItem("almacen_borrador_req");
    localStorage.removeItem("almacen_purga_hecha");
  }catch(e){}
  aviso("Igualando con la base…");
  setTimeout(function(){ location.reload(); }, 600);
}

/* =====================================================================
   CONECTARSE SIN VOLVER A TECLEAR NADA

   La app ya tiene guardado el fotocheck y la contraseña de quien está
   usándola: son los que escribió al entrar. Si además resulta que no
   hay sesión con la base, pedirle que salga y vuelva a entrar para
   escribir otra vez lo mismo es hacerle perder el tiempo, y mientras
   tanto todo lo que registra se queda en cola.

   Así que la app se conecta sola con lo que ya tiene. Es lo mismo que
   hace cualquier aplicación que lo mantiene a uno dentro entre una
   apertura y la siguiente.

   Si falla no se insiste ni se molesta: queda el botón para intentarlo
   a mano, y el aviso rojo sigue diciendo la verdad.
   ===================================================================== */
var conectando = false;
var ultimoFalloNube = "";

/* Lo que devuelve la base viene en su idioma. Traducirlo no es adorno:
   el que lo lee esta en el cerro y necesita saber que tiene que cambiar,
   no el nombre de una restriccion. El texto original queda en el titulo
   por si hace falta mirarlo. */
function motivoLegible(m){
  m = String(m || "");
  if(m.indexOf("perfiles_nombre_ok") >= 0) return "el nombre es muy corto (mínimo 3 letras).";
  if(m.indexOf("perfiles_fotocheck_ok") >= 0) return "el fotocheck debe tener entre 3 y 12 dígitos.";
  if(/weak_password|at least 6/i.test(m)) return "la contraseña es muy corta.";
  if(/already registered|duplicate/i.test(m)) return "ese fotocheck ya tiene cuenta con otra contraseña.";
  if(/aprobad|visto bueno/i.test(m)) return "su cuenta espera el visto bueno del administrador.";
  if(/Failed to fetch|NetworkError|network/i.test(m)) return "no hay señal para llegar a la base.";
  return m;
}

function usuarioDeEsteEquipo(){
  var quien = null;
  try{ quien = localStorage.getItem("almacen_simple_persona"); }catch(e){}
  var fc = null;
  try{ fc = localStorage.getItem("almacen_simple_fc"); }catch(e){}
  var lista = (window.db && db.usuarios) || [];
  var u = fc ? lista.filter(function(x){ return x.fc === fc; })[0] : null;
  if(!u && quien) u = lista.filter(function(x){ return x.nombre === quien; })[0];
  return (u && u.fc && u.clave) ? u : null;
}

function conectarConLoGuardado(silencioso){
  if(conectando) return Promise.resolve(false);
  if(typeof nubeHay === "function" && nubeHay()) return Promise.resolve(true);
  if(typeof nubeAltaSiHaceFalta !== "function") return Promise.resolve(false);

  var u = usuarioDeEsteEquipo();
  if(!u){
    if(!silencioso) aviso("Este equipo no tiene guardada su contraseña. Salga y entre con su fotocheck.");
    return Promise.resolve(false);
  }

  conectando = true;
  if(!silencioso) aviso("Conectando con la base…");
  return nubeAltaSiHaceFalta({
    fotocheck: u.fc, clave: u.clave, nombre: u.nombre,
    puesto: u.puesto, celular: u.cel || ""
  }).then(function(p){
    conectando = false;
    try{ localStorage.setItem("almacen_simple_fc", u.fc); }catch(e){}
    nubeArrancar();
    pintarEstadoNube();
    aviso("Conectado. " + (typeof nubePendientes === "function" && nubePendientes()
      ? "Subiendo lo que estaba en cola…" : "Ya está en línea."));
    return true;
  }).catch(function(e){
    conectando = false;
    /* El intento callado tambien deja dicho por que fallo. Un fallo que
       no se ve es un fallo que nadie puede arreglar, y el que abre la
       app en el cerro no tiene consola para mirarlo. */
    ultimoFalloNube = (e && e.message) || "sin detalle";
    pintarEstadoNube();
    if(!silencioso) aviso("No se pudo conectar: " + ultimoFalloNube);
    return false;
  });
}

/* El botón vive pegado al aviso rojo, que es donde la persona mira
   cuando algo no aparece. Solo sale si hay con qué conectarse. */
function ponerBotonConectar(caja){
  var b = caja.querySelector(".conectar");
  if(typeof nubeHay === "function" && nubeHay()){
    if(b) b.remove();
    return;
  }
  if(!usuarioDeEsteEquipo()){ if(b) b.remove(); return; }
  if(b) return;
  b = document.createElement("button");
  b.type = "button";
  b.className = "conectar";
  b.textContent = "Conectar con la base";
  b.title = "Usa el fotocheck y la contraseña que ya tiene guardados en este equipo";
  b.addEventListener("click", function(){ conectarConLoGuardado(false); });
  var aviso1 = caja.querySelector(".nube");
  if(aviso1 && aviso1.nextSibling) caja.insertBefore(b, aviso1.nextSibling);
  else caja.insertBefore(b, caja.firstChild);
}

/* El estado va donde la versión: es lo mismo que se mira cuando algo
   no aparece —qué versión tengo y si estoy hablando con la base—. */
function pintarEstadoNube(){
  var caja = $("salir");
  if(!caja) return;
  ponerBotonActualizar();
  var p = caja.querySelector(".nube");
  if(!p){
    p = document.createElement("p");
    p.className = "nube";
    caja.insertBefore(p, caja.firstChild);
  }
  var pend = typeof nubePendientes === "function" ? nubePendientes() : 0;
  if(typeof nubeHay === "function" && nubeHay()){
    p.textContent = "En línea" + (pend ? " · " + pend + " por subir" : "");
    p.className = "nube ok";
  } else {
    /* Este renglón explica por qué dos aparatos muestran cosas distintas,
       así que no puede seguir siendo un gris que nadie mira. Mientras
       diga esto, nada de lo que se registre sale de este navegador. */
    p.textContent = "SOLO EN ESTE EQUIPO" + (pend ? " · " + pend + " por subir" : "");
    p.title = "Nada de lo que registre está llegando a la base. Salga y vuelva a entrar " +
              "con su fotocheck y contraseña para conectarse.";
    p.className = "nube aislado";
  }
  ponerBotonConectar(caja);

  /* El porque, en letra chica y solo si lo hay */
  var m = caja.querySelector(".motivo");
  if(ultimoFalloNube && !(typeof nubeHay === "function" && nubeHay())){
    if(!m){
      m = document.createElement("small");
      m.className = "motivo";
      var bt = caja.querySelector(".conectar");
      if(bt && bt.nextSibling) caja.insertBefore(m, bt.nextSibling);
      else caja.insertBefore(m, caja.firstChild);
    }
    m.textContent = "No conectó porque " + motivoLegible(ultimoFalloNube);
    m.title = ultimoFalloNube;
  } else if(m) m.remove();
}

/* La portada ya no ofrece entrar a mirar sin cuenta: todo el que use la
   app tiene su perfil, y ese perfil vive en la tabla, no en el equipo.
   Se deja la función vacía para no tocar a quien la llama. */
function pintarPortada(){}

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
  if(typeof pintarEstadoNube === "function") pintarEstadoNube();
  ir(PANEL[k][0]);
}

var simulando = false;

function simular(k){
  simulando = true;
  cargo = k;
  $("banda").classList.add("ver");
  /* La banda decía solo "está viendo", y eso hacía pensar que era de mirar.
     No lo es: el administrador puede registrar y corregir en cualquier
     puesto, que es justamente para lo que sirve. Y dice dónde va a parar
     lo que escriba, porque no es lo mismo probar contra la base que
     probar contra este equipo. */
  var donde = (typeof nubeHay === "function" && nubeHay())
    ? "Lo que registre aquí se guarda en la base, como si fuera esa persona."
    : "Lo que registre aquí queda solo en este equipo.";
  $("banda-txt").textContent = "Está probando la app como " + NOMBRE_PUESTO[k] +
    " · puede registrar y corregir. " + donde;
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
  if(typeof nubeSalir === "function") nubeSalir();
  localStorage.removeItem("almacen_simple_cargo");
  localStorage.removeItem("almacen_simple_persona");
  localStorage.removeItem("almacen_simple_dueno");
  if($("sombreros")) $("sombreros").style.display = "none";
  if($("alta")) $("alta").style.display = "none";
  $("portada").classList.add("ver");
  window.scrollTo(0,0);
}

/* =====================================================================
   QUE TODOS LOS EQUIPOS TERMINEN EN LA MISMA VERSIÓN

   El servidor deja la página guardada un rato en cada navegador. Por eso
   un equipo muestra la versión nueva y otro sigue con la vieja hasta que
   a alguien se le ocurre vaciar el caché. Mientras tanto dos personas
   miran pantallas distintas y creen que la app está fallando, cuando lo
   que pasa es que no están corriendo el mismo programa.

   La app le pregunta al servidor qué versión hay publicada, sin usar el
   caché, y si no es la suya se recarga sola una vez. Es lo que uno haría
   a mano, hecho solo y sin que nadie tenga que enterarse.
   ===================================================================== */
var MARCA_RECARGA = "almacen_recargado_a";

function versionPublicada(){
  return fetch("index.html?ver=" + Date.now(), {cache: "no-store"})
    .then(function(r){ return r.ok ? r.text() : ""; })
    .then(function(html){
      var marca = "1-nucleo.js?v=";
      var i = html.indexOf(marca);
      if(i < 0) return "";
      var resto = html.slice(i + marca.length);
      var fin = resto.indexOf('"');
      return fin < 0 ? "" : resto.slice(0, fin);
    })
    .catch(function(){ return ""; });
}

function vigilarVersion(){
  versionPublicada().then(function(v){
    if(!v || v === VERSION_APP) return;

    /* Si ya se recargó por esta misma versión y sigue llegando la vieja,
       no se insiste: un equipo dando vueltas en recargas es peor que un
       equipo atrasado. Se avisa y que lo aprieten a mano. */
    var ya = "";
    try{ ya = sessionStorage.getItem(MARCA_RECARGA) || ""; }catch(e){}
    if(ya === v){
      var p = $("salir") && $("salir").querySelector(".version");
      if(p){
        p.textContent = textoVersion() + " · hay una más nueva";
        p.title = "El servidor tiene la " + v + ". Use Actualizar este equipo.";
      }
      return;
    }

    try{ sessionStorage.setItem(MARCA_RECARGA, v); }catch(e){}
    aviso("Hay una versión más nueva. Actualizando este equipo…");
    setTimeout(function(){
      try{
        var u = new URL(location.href);
        u.searchParams.set("v", v);
        location.replace(u.toString());
      }catch(e){ location.reload(); }
    }, 900);
  });
}

/* La versión va pegada arriba del botón de salir: es donde la mira el que
   llama por teléfono para decir «no me aparece lo nuevo». */
(function ponerActualizar(){
  if(typeof ponerBotonActualizar === "function") ponerBotonActualizar();
})();

/* Al abrir, y cada diez minutos para el equipo que se queda encendido
   todo el día en la oficina. */
vigilarVersion();
setInterval(vigilarVersion, 600000);

(function ponerVersion(){
  var caja = $("salir");
  if(!caja || caja.querySelector(".version")) return;
  var p = document.createElement("p");
  p.className = "version";
  p.textContent = textoVersion();
  p.title = "Versión publicada de la aplicación";
  caja.insertBefore(p, caja.firstChild);
})();

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


/* =====================================================================
   RESPALDO Y PONER EN 0

   Un solo botón abre las cuatro cosas. Están juntas y escondidas a
   propósito: tres de ellas se hacen una vez al año y la última borra
   la obra entera. Un botón suelto en el panel se pulsa sin querer.

   Las cuentas de administración nunca se pierden: ni al restaurar un
   respaldo ajeno ni al borrar todo. Si se perdieran, nadie podría
   volver a entrar a este equipo a arreglarlo.
   ===================================================================== */
function nombreRespaldo(){
  var d = new Date(), dos = function(n){ return String(n).padStart(2,"0"); };
  return "respaldo-almacen-" + d.getFullYear() + "-" + dos(d.getMonth()+1) + "-" +
         dos(d.getDate()) + "-" + dos(d.getHours()) + dos(d.getMinutes()) + ".json";
}

/* Recorre los datos buscando fotos. Se busca por el nombre del campo y no
   por una lista fija de sitios: mañana habrá fotos en la guía o en el
   despacho y este respaldo tiene que llevárselas igual, sin que nadie se
   acuerde de venir a agregarlas aquí. */
function recorrerFotos(nodo, hacer){
  if(!nodo || typeof nodo !== "object") return;
  if(Array.isArray(nodo)){
    for(var i = 0; i < nodo.length; i++) recorrerFotos(nodo[i], hacer);
    return;
  }
  for(var k in nodo){
    if(!Object.prototype.hasOwnProperty.call(nodo, k)) continue;
    var v = nodo[k];
    if(typeof v === "string" && /foto|imagen|adjunto/i.test(k)) hacer(nodo, k, v);
    else if(v && typeof v === "object") recorrerFotos(v, hacer);
  }
}

/* Un respaldo que solo lleve el enlace de la foto no sirve: el día que se
   restaura en otro equipo, o que se limpia el Storage, quedan cuadros rotos.
   Por eso las fotos que viven en el servidor se bajan y se meten dentro del
   archivo. Las que ya están guardadas dentro de los datos viajan solas. */
async function armarRespaldo(){
  var copia = JSON.parse(JSON.stringify(db));
  var pendientes = [], dentro = 0, bajadas = 0, fallaron = 0;

  recorrerFotos(copia, function(obj, k, v){
    if(/^data:/i.test(v)){ dentro++; return; }
    if(/^https?:\/\//i.test(v)) pendientes.push({obj:obj, k:k, url:v});
  });

  for(var i = 0; i < pendientes.length; i++){
    var p = pendientes[i];
    try{
      var r = await fetch(p.url);
      if(!r.ok) throw new Error(r.status);
      var b = await r.blob();
      p.obj[p.k] = await new Promise(function(ok, mal){
        var l = new FileReader();
        l.onload = function(){ ok(l.result); };
        l.onerror = mal;
        l.readAsDataURL(b);
      });
      bajadas++;
    }catch(e){
      /* se deja el enlace: al menos queda constancia de dónde estaba */
      fallaron++;
    }
  }
  return {datos:copia, dentro:dentro, bajadas:bajadas, fallaron:fallaron};
}

async function descargarRespaldo(){
  var bt = $("mn-bajar");
  if(bt){ bt.disabled = true; bt.textContent = "Reuniendo las fotos…"; }
  var r;
  try{ r = await armarRespaldo(); }
  catch(e){
    if(bt){ bt.disabled = false; bt.textContent = "Descargar respaldo"; }
    return aviso("No se pudo armar el respaldo.");
  }

  var carga = {
    marca:"almacen-cpq", version:2, fecha:new Date().toISOString(),
    equipo:navigator.userAgent,
    fotos:{guardadas:r.dentro + r.bajadas, bajadasDelServidor:r.bajadas, sinPoderBajar:r.fallaron},
    datos:r.datos
  };
  var a = document.createElement("a");
  var url = URL.createObjectURL(new Blob([JSON.stringify(carga, null, 1)],
                                          {type:"application/json"}));
  a.href = url; a.download = nombreRespaldo();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);

  if(bt){ bt.disabled = false; bt.textContent = "Descargar respaldo"; }
  aviso("Respaldo descargado" +
    (carga.fotos.guardadas ? " · " + carga.fotos.guardadas + " foto(s) dentro" : "") +
    (r.fallaron ? " · " + r.fallaron + " no se pudo bajar" : "") + ".");
}

function restaurarDesde(archivo, alTerminar){
  var lector = new FileReader();
  lector.onload = function(){
    var g;
    try{ g = JSON.parse(lector.result); }
    catch(e){ return alTerminar("Ese archivo no es un respaldo: no se pudo leer."); }
    var d = g && g.datos ? g.datos : g;      /* admite el formato viejo, sin envoltura */
    if(!d || !Array.isArray(d.consolidado) || !Array.isArray(d.usuarios))
      return alTerminar("Ese archivo no es un respaldo de esta aplicación.");
    db = d;
    if(!db.materiales) db.materiales = [];
    if(!db.herramientas) db.herramientas = [];
    if(!db.requerimientos) db.requerimientos = [];
    if(!db.guias) db.guias = [];
    if(!db.movimientos) db.movimientos = [];
    asegurarAdmins();                        /* el respaldo puede venir sin ellas */
    guardar();
    alTerminar(null, d);
  };
  lector.onerror = function(){ alTerminar("No se pudo leer el archivo."); };
  lector.readAsText(archivo);
}

/* Deja este equipo sin nada guardado del navegador: los cachés de la
   página y cualquier trabajador de servicio que haya quedado de una
   versión anterior. Es lo que hace que vuelva a bajar todo del servidor. */
async function limpiarEsteEquipo(){
  try{
    if(window.caches){
      var llaves = await caches.keys();
      for(var i = 0; i < llaves.length; i++) await caches.delete(llaves[i]);
    }
    if(navigator.serviceWorker){
      var regs = await navigator.serviceWorker.getRegistrations();
      for(var j = 0; j < regs.length; j++) await regs[j].unregister();
    }
  }catch(e){}
}



/* =====================================================================
   QUIÉN USA LA APLICACIÓN

   Quién se dio de alta en ESTE equipo, con qué puesto y con qué clave.
   La clave se ve porque el almacenero es quien atiende al que la olvidó,
   y hoy no hay otra forma de recordársela: la página la guarda tal cual.
   Va tapada hasta que se pulsa: en el almacén siempre hay alguien mirando
   la pantalla por encima del hombro.

   El día que la base esté conectada esto cambia y es mejor así: las claves
   las guardará cifradas el servicio de acceso y nadie —ni el administrador,
   ni yo, ni Supabase— podrá leerlas. Ahí, en lugar de mostrarla, habrá que
   darle una nueva a quien la pierda.
   ===================================================================== */
var usuOrden = "nombre";
var usuVistas = {};

VISTA.usuarios = function(){

  function pintar(){
    var lista = (db.usuarios || []).slice();

    if(usuOrden === "nombre")
      lista.sort(function(a,b){ return String(a.nombre).localeCompare(String(b.nombre), "es"); });
    else if(usuOrden === "puesto")
      lista.sort(function(a,b){
        return String(NOMBRE_PUESTO[a.puesto] || a.puesto)
          .localeCompare(String(NOMBRE_PUESTO[b.puesto] || b.puesto), "es"); });
    else if(usuOrden === "proyecto")
      lista.sort(function(a,b){
        return nombreProyecto(a.proyecto).localeCompare(nombreProyecto(b.proyecto), "es"); });
    else if(usuOrden === "fecha")
      lista.sort(function(a,b){ return String(b.creado || "").localeCompare(String(a.creado || "")); });
    else if(usuOrden === "fotocheck")
      lista.sort(function(a,b){ return (+a.fc || 0) - (+b.fc || 0); });

    var porPuesto = {};
    lista.forEach(function(u){ porPuesto[u.puesto] = (porPuesto[u.puesto] || 0) + 1; });

    $("zona").innerHTML = '<div class="vista">' +
      tarjetaProyectos() +
      '<div class="tarjeta">' +
        "<h2>Quién está en la aplicación</h2>" +
        '<p class="nota">Desde aquí se cambia el puesto y el proyecto de cada uno, se ' +
        "les da una contraseña nueva si la olvidaron, y se quita a quien ya no está en " +
        "la obra. Mientras la app no esté conectada a la base, cada equipo lleva su " +
        "propia lista.</p>" +
        '<div class="cifras">' +
          '<div class="cifra"><b>' + lista.length + "</b><small>perfiles</small></div>" +
          Object.keys(porPuesto).map(function(k){
            return '<div class="cifra"><b>' + porPuesto[k] + "</b><small>" +
              esc(NOMBRE_PUESTO[k] || k) + "</small></div>";
          }).join("") +
        "</div>" +
        '<label class="campo" style="margin-top:12px;max-width:320px"><span>Ordenar por</span>' +
        '<select id="us-orden">' +
          op("nombre", "Nombre", usuOrden) +
          op("puesto", "Puesto", usuOrden) +
          op("proyecto", "Proyecto", usuOrden) +
          op("fotocheck", "N° de fotocheck", usuOrden) +
          op("fecha", "Fecha de alta, la más nueva primero", usuOrden) +
        "</select></label>" +
      "</div>" +

      '<div class="tarjeta">' +
        (lista.length
          ? '<div class="tabla-caja"><table><thead><tr>' +
            "<th>Nombre</th><th>Puesto</th><th>Proyecto</th><th>Fotocheck</th><th>Celular</th>" +
            "<th>Contraseña</th><th>Alta</th><th></th></tr></thead><tbody>" +
            lista.map(fila).join("") + "</tbody></table></div>"
          : '<p class="nota">Todavía no hay ningún perfil en este equipo.</p>') +
      "</div></div>";

    enganchar();
  }

  /* ---- Los proyectos de la obra ---- */
  function tarjetaProyectos(){
    var ps = proyectosVivos();
    return '<div class="tarjeta">' +
      "<h2>Proyectos de la obra</h2>" +
      '<p class="nota">Cada supervisor trabaja en uno. Los que llevan logística y ' +
      "administración se ponen en <b>Todos los proyectos</b>, porque compran y revisan " +
      "para la obra entera.</p>" +
      (ps.length
        ? '<div class="tabla-caja"><table><thead><tr><th>Proyecto</th>' +
          '<th class="n">Personas</th><th></th></tr></thead><tbody>' +
          ps.map(function(p){
            var cuantos = (db.usuarios || []).filter(function(u){ return u.proyecto === p.id; }).length;
            return "<tr><td><input data-proy=\"" + esc(p.id) + "\" value=\"" + esc(p.nombre) +
              "\" style=\"min-width:260px\"></td>" +
              "<td class='n'>" + cuantos + "</td>" +
              '<td style="width:1%"><button class="bt chico" type="button" data-quita-proy="' +
              esc(p.id) + '">Quitar</button></td></tr>';
          }).join("") + "</tbody></table></div>"
        : '<p class="nota">Todavía no hay proyectos.</p>') +
      '<div class="botones" style="margin-top:11px">' +
        '<input id="pr-nuevo" placeholder="Nombre del proyecto nuevo" style="flex:1;min-width:220px">' +
        '<button class="bt pri" type="button" id="pr-agregar">Agregar proyecto</button>' +
      "</div></div>";
  }

  function op(v, t, sel){
    return '<option value="' + v + '"' + (sel === v ? " selected" : "") + ">" + t + "</option>";
  }

  function fila(u){
    var esDueno = u.fc === FOTOCHECK_DUENO;
    var soyYo = u.nombre === quienSoy();
    var abierta = !!usuVistas[u.fc];
    return "<tr>" +
      "<td><b>" + esc(u.nombre || "—") + "</b>" +
        (esDueno || u.puesto === "admin" ? ' <span class="marca-est est-info">administra</span>' : "") + "</td>" +
      "<td>" +
        (esDueno
          ? esc(NOMBRE_PUESTO[u.puesto] || u.puesto) + "<br><small>y administrador de la app</small>"
          : '<select data-puesto-de="' + esc(u.fc) + '" style="min-width:180px">' +
            PUESTOS.map(function(p){
              return '<option value="' + p.k + '"' + (u.puesto === p.k ? " selected" : "") +
                ">" + esc(p.t) + "</option>";
            }).join("") + "</select>") +
      "</td>" +
      '<td><select data-proy-de="' + esc(u.fc) + '" style="min-width:200px">' +
        opcionesProyecto(u.proyecto) + "</select></td>" +
      '<td class="n">' + esc(u.fc || "—") + "</td>" +
      "<td>" + esc(u.cel || "—") + "</td>" +
      "<td style='white-space:nowrap'>" +
        (abierta
          ? "<code>" + esc(u.clave || "—") + "</code> "
          : '<span style="letter-spacing:.22em;color:var(--tinta3)">••••••</span> ') +
        '<button class="bt chico" type="button" data-ver-clave="' + esc(u.fc) + '">' +
        (abierta ? "Ocultar" : "Ver") + "</button> " +
        '<button class="bt chico" type="button" data-clave-de="' + esc(u.fc) + '">Cambiar</button></td>' +
      "<td>" + (u.creado ? fecha(u.creado) : "—") + "</td>" +
      '<td style="width:1%">' +
        (esDueno || soyYo
          ? '<small style="color:var(--tinta3)">' + (soyYo ? "es usted" : "dueño") + "</small>"
          : '<button class="bt chico" type="button" data-quita-usu="' + esc(u.fc) + '">Quitar</button>') +
      "</td></tr>";
  }

  function enganchar(){
    $("us-orden").addEventListener("change", function(){ usuOrden = this.value; pintar(); });

    var i, bs;

    bs = $("zona").querySelectorAll("[data-ver-clave]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("click", function(){
      usuVistas[this.dataset.verClave] = !usuVistas[this.dataset.verClave];
      pintar();
    });

    /* Cambiar el puesto cambia lo que esa persona ve al entrar. */
    bs = $("zona").querySelectorAll("[data-puesto-de]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("change", function(){
      var u = buscarUsu(this.dataset.puestoDe);
      if(!u) return;
      u.puesto = this.value;
      guardar();
      aviso(u.nombre.split(" ")[0] + " ahora entra como " + (NOMBRE_PUESTO[u.value] || this.value) + ".");
      pintar();
    });

    bs = $("zona").querySelectorAll("[data-proy-de]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("change", function(){
      var u = buscarUsu(this.dataset.proyDe);
      if(!u) return;
      u.proyecto = this.value;
      guardar();
      aviso(u.nombre.split(" ")[0] + " · " + nombreProyecto(this.value) + ".");
      pintar();
    });

    /* Una contraseña nueva, cuando alguien la olvidó. */
    bs = $("zona").querySelectorAll("[data-clave-de]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("click", function(){
      var u = buscarUsu(this.dataset.claveDe);
      if(!u) return;
      var nueva = prompt("Contraseña nueva para " + u.nombre + ":", "");
      if(nueva === null) return;
      nueva = String(nueva).trim();
      if(!nueva) return aviso("No se cambió: la contraseña no puede quedar vacía.");
      u.clave = nueva;
      guardar();
      usuVistas[u.fc] = true;
      aviso("Contraseña de " + u.nombre.split(" ")[0] + " cambiada. Dígasela.");
      pintar();
    });

    /* Quitar a alguien que ya no está en la obra. Ni el dueño ni uno mismo:
       quedarse sin administrador deja la app sin quien la arregle. */
    bs = $("zona").querySelectorAll("[data-quita-usu]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("click", function(){
      var u = buscarUsu(this.dataset.quitaUsu);
      if(!u) return;
      if(!confirm("¿Quitar a " + u.nombre + " (" + u.fc + ")?\n\nNo podrá volver a entrar con ese fotocheck. Lo que ya registró se queda.")) return;
      db.usuarios = db.usuarios.filter(function(x){ return x.fc !== u.fc; });
      guardar();
      aviso(u.nombre.split(" ")[0] + " fue quitado.");
      pintar();
    });

    /* ---- proyectos ---- */
    $("pr-agregar").addEventListener("click", function(){
      var nom = ($("pr-nuevo").value || "").trim();
      if(nom.length < 3) return aviso("Escriba el nombre del proyecto.");
      if(proyectosVivos().some(function(p){ return clave(p.nombre) === clave(nom); }))
        return aviso("Ya hay un proyecto con ese nombre.");
      db.proyectos = db.proyectos || [];
      db.proyectos.push({id:"p-" + uid(), nombre:nom, creado:new Date().toISOString()});
      guardar();
      aviso("Proyecto agregado: " + nom + ".");
      pintar();
    });

    bs = $("zona").querySelectorAll("[data-proy]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("change", function(){
      var p = (db.proyectos || []).filter(function(x){ return x.id === this.dataset.proy; }.bind(this))[0];
      if(!p) return;
      var nom = (this.value || "").trim();
      if(!nom) return pintar();
      p.nombre = nom;
      guardar();
      aviso("Proyecto renombrado.");
      pintar();
    });

    bs = $("zona").querySelectorAll("[data-quita-proy]");
    for(i = 0; i < bs.length; i++) bs[i].addEventListener("click", function(){
      var id = this.dataset.quitaProy;
      var p = (db.proyectos || []).filter(function(x){ return x.id === id; })[0];
      if(!p) return;
      var cuantos = (db.usuarios || []).filter(function(u){ return u.proyecto === id; }).length;
      if(!confirm("¿Quitar el proyecto " + p.nombre + "?" +
                  (cuantos ? "\n\n" + cuantos + " persona(s) pasan a Todos los proyectos." : ""))) return;
      db.proyectos = db.proyectos.filter(function(x){ return x.id !== id; });
      (db.usuarios || []).forEach(function(u){ if(u.proyecto === id) u.proyecto = "todos"; });
      guardar();
      aviso("Proyecto quitado.");
      pintar();
    });
  }

  function buscarUsu(fc){
    return (db.usuarios || []).filter(function(x){ return x.fc === fc; })[0];
  }

  pintar();
};


/* =====================================================================
   FOTOS Y CAPTURAS

   Una foto que no llegó al Storage no avisa: la fila se guarda igual y el
   hueco recién aparece meses después, cuando alguien reclama la entrega y
   la prueba no está. Esta pantalla junta todas las imágenes que hay en los
   datos —de materiales, movimientos, préstamos, guías, lo que sea— y las
   pone una al lado de otra para ver de un vistazo cuáles faltan.

   Tres estados, y el del medio es el que importa:
     · en el equipo   la imagen viaja dentro de los datos (data:)
     · en el servidor la imagen está en el Storage y se pudo abrir
     · NO DATA        hay un enlace pero el servidor no la devuelve, o el
                      navegador no supo abrir ese formato

   Se comprueba de verdad, no se supone: cada imagen del servidor se
   intenta cargar y se marca según lo que conteste.
   ===================================================================== */
function reunirFotos(){
  var lista = [];

  function meter(origen, fecha, quien, ref, valor){
    if(!valor || typeof valor !== "string") return;
    lista.push({
      origen:origen, fecha:fecha || "", quien:quien || "—", ref:ref || "",
      valor:valor,
      donde: /^data:/i.test(valor) ? "equipo"
           : /^https?:\/\//i.test(valor) ? "servidor" : "raro",
      estado: /^data:/i.test(valor) ? "ok" : "?"
    });
  }

  (db.materiales || []).forEach(function(m){
    /* la ficha del material no guarda quién le sacó la foto: va sin persona,
       si no el desplegable de gente se llenaría de nombres de materiales */
    meter("Material", m.creado || "", "", m.nombre || "", m.foto);
  });
  (db.movimientos || []).forEach(function(m){
    meter(m.tipo === "ingreso" ? "Ingreso" : "Salida", m.fecha,
          m.persona || m.frente || "—", m.item || "", m.foto);
  });
  (db.herramientas || []).forEach(function(h){
    if(h.prestamo) meter("Préstamo", h.prestamo.fecha || "",
                          h.prestamo.responsable || "—", h.nombre || "", h.prestamo.foto);
  });
  (db.guias || []).forEach(function(g){
    meter("Guía", g.fecha, g.transportista || "—", g.numero || "", g.foto);
  });
  (db.requerimientos || []).forEach(function(r){
    meter("Requerimiento", r.fecha, r.solicitante || r.quien || "—", r.codigo || "", r.foto);
    (r.items || []).forEach(function(it){
      meter("Requerimiento", r.fecha, r.solicitante || r.quien || "—", it.desc || "", it.foto);
    });
  });

  return lista;
}

var fotosOrden = "fecha";
var fotosFiltro = "todas";
var fotosQuien = "todos";

VISTA.fotos = function(){
  var todas = reunirFotos();

  function pintar(){
    var lista = todas.slice();

    if(fotosFiltro === "faltan")   lista = lista.filter(function(f){
      return f.estado === "mal" || f.donde === "raro"; });
    if(fotosFiltro === "servidor") lista = lista.filter(function(f){ return f.donde === "servidor"; });
    if(fotosFiltro === "equipo")   lista = lista.filter(function(f){ return f.donde === "equipo"; });
    if(fotosQuien !== "todos")     lista = lista.filter(function(f){ return f.quien === fotosQuien; });

    if(fotosOrden === "fecha")
      lista.sort(function(a,b){ return String(b.fecha).localeCompare(String(a.fecha)); });
    else if(fotosOrden === "quien")
      lista.sort(function(a,b){ return String(a.quien).localeCompare(String(b.quien), "es"); });
    else if(fotosOrden === "origen")
      lista.sort(function(a,b){ return String(a.origen).localeCompare(String(b.origen), "es"); });

    var mal = todas.filter(function(f){ return f.estado === "mal" || f.donde === "raro"; }).length;
    var vistos = {}, gente = [];
    todas.forEach(function(f){
      if(f.quien && f.quien !== "—" && !vistos[f.quien]){ vistos[f.quien] = 1; gente.push(f.quien); }
    });
    gente.sort(function(a,b){ return a.localeCompare(b, "es"); });

    $("zona").innerHTML = '<div class="vista">' +
      '<div class="tarjeta">' +
        "<h2>Todas las fotos y capturas</h2>" +
        '<p class="nota">Lo que se ve aquí es lo que existe de verdad. Las marcadas ' +
        "<b>NO DATA</b> tienen un enlace guardado pero el servidor no las devuelve, o " +
        "el navegador no supo abrir ese formato: esas hay que volver a tomarlas.</p>" +
        '<div class="cifras">' +
          '<div class="cifra"><b>' + todas.length + "</b><small>en total</small></div>" +
          '<div class="cifra"><b>' +
            todas.filter(function(f){ return f.donde === "equipo"; }).length +
            "</b><small>en el equipo</small></div>" +
          '<div class="cifra"><b>' +
            todas.filter(function(f){ return f.donde === "servidor"; }).length +
            "</b><small>en el servidor</small></div>" +
          '<div class="cifra"><b id="fo-mal">' + mal + "</b><small>sin dato</small></div>" +
        "</div>" +
        '<div class="rejilla dos" style="margin-top:12px">' +
          '<label class="campo"><span>Ordenar por</span><select id="fo-orden">' +
            opcion("fecha", "Fecha, la más nueva primero", fotosOrden) +
            opcion("quien", "Quién la subió", fotosOrden) +
            opcion("origen", "De dónde salió", fotosOrden) +
          "</select></label>" +
          '<label class="campo"><span>Quién la subió</span><select id="fo-quien">' +
            opcion("todos", "Todos", fotosQuien) +
            gente.map(function(q){ return opcion(q, q, fotosQuien); }).join("") +
          "</select></label>" +
          '<label class="campo"><span>Mostrar</span><select id="fo-filtro">' +
            opcion("todas", "Todas", fotosFiltro) +
            opcion("faltan", "Solo las que no cargan", fotosFiltro) +
            opcion("servidor", "Solo las del servidor", fotosFiltro) +
            opcion("equipo", "Solo las del equipo", fotosFiltro) +
          "</select></label>" +
        "</div>" +
      "</div>" +

      '<div class="tarjeta">' +
        (lista.length
          ? '<div class="galeria" id="fo-galeria">' + lista.map(tarjeta).join("") + "</div>"
          : '<p class="nota">No hay fotos que mostrar con este filtro.</p>') +
      "</div></div>";

    $("fo-orden").addEventListener("change", function(){ fotosOrden = this.value; pintar(); });
    $("fo-filtro").addEventListener("change", function(){ fotosFiltro = this.value; pintar(); });
    $("fo-quien").addEventListener("change", function(){ fotosQuien = this.value; pintar(); });
    if(lista.length) comprobar(lista);
  }

  function opcion(v, t, sel){
    return '<option value="' + v + '"' + (sel === v ? " selected" : "") + ">" + t + "</option>";
  }

  function tarjeta(f, i){
    return '<figure class="foto-caja" data-i="' + i + '">' +
      '<div class="foto-lienzo" id="fo-l' + i + '">' +
        (f.donde === "raro"
          ? '<span class="sin-dato">NO DATA</span>'
          : '<img alt="" data-src="' + esc(f.valor) + '" data-i="' + i + '">') +
      "</div>" +
      "<figcaption>" +
        '<b>' + esc(f.origen) + (f.ref ? " · " + esc(f.ref) : "") + "</b>" +
        "<small>" + (f.fecha ? fecha(f.fecha) : "sin fecha") + " · " + esc(f.quien) + "</small>" +
      "</figcaption></figure>";
  }

  /* El número de «sin dato» no se sabe al pintar: se sabe cuando cada
     imagen contesta. Se corrige el número en su sitio y no se repinta la
     pantalla, porque repintar volvería a lanzar todas las cargas. */
  function recontar(){
    var c = $("fo-mal");
    if(c) c.textContent = todas.filter(function(f){
      return f.estado === "mal" || f.donde === "raro"; }).length;
  }

  /* Cargar la imagen es la única forma de saber si está: un enlace guardado
     no prueba nada. Las del equipo se pintan directo; las del servidor se
     intentan y se marcan según conteste. */
  function comprobar(lista){
    var imgs = $("fo-galeria").querySelectorAll("img[data-src]");
    for(var i = 0; i < imgs.length; i++){
      (function(img){
        var idx = +img.dataset.i, f = lista[idx];
        img.onload = function(){
          f.estado = "ok";
          img.closest(".foto-lienzo").classList.add("cargada");
          recontar();
        };
        img.onerror = function(){
          f.estado = "mal";
          var l = img.closest(".foto-lienzo");
          l.classList.add("sin");
          l.innerHTML = '<span class="sin-dato">NO DATA</span>';
          recontar();
        };
        img.src = img.dataset.src;
      })(imgs[i]);
    }
  }

  pintar();
};

/* El desplegado vive fuera de la función: si viviera dentro, cada
   repintado —restaurar, borrar— lo cerraría y habría que abrirlo de nuevo. */
var mantAbierto = false;

VISTA.mantenimiento = function(){

  function pintar(){
    $("zona").innerHTML = '<div class="vista">' + respaldo() + ponerEnCero() + "</div>";
    enganchar();
  }

  /* ---- Respaldo, restaurar y caché: los tres detrás de un botón ---- */
  function respaldo(){
    return '<div class="tarjeta">' +
        "<h2>Respaldo</h2>" +
        '<p class="nota">Guardar lo de hoy en el PC, traerlo de vuelta, o forzar que ' +
        "todos los equipos bajen la versión nueva.</p>" +
        '<button class="bt pri" type="button" id="mn-abrir">' +
        (mantAbierto ? "Cerrar" : "Abrir respaldo") + "</button>" +
      "</div>" + (mantAbierto ? desplegado() : "");
  }

  function desplegado(){
    return '<div class="tarjeta">' +
        "<h2>Descargar al PC</h2>" +
        '<p class="nota">Un archivo con todo lo de este equipo: consolidado, pedidos, ' +
        "guías, movimientos, herramientas y perfiles. Es lo único que permite volver atrás.</p>" +
        '<div class="cifras">' +
          '<div class="cifra"><b>' + db.consolidado.length + "</b><small>consolidado</small></div>" +
          '<div class="cifra"><b>' + db.requerimientos.length + "</b><small>pedidos</small></div>" +
          '<div class="cifra"><b>' + db.movimientos.length + "</b><small>movimientos</small></div>" +
          '<div class="cifra"><b>' + db.usuarios.length + "</b><small>perfiles</small></div>" +
        "</div>" +
        '<button class="bt pri" type="button" id="mn-bajar">Descargar respaldo</button>' +
      "</div>" +

      '<div class="tarjeta">' +
        "<h2>Restaurar desde el PC</h2>" +
        '<p class="nota">Reemplaza todo lo de este equipo por lo del archivo. Lo que hay ' +
        "ahora se pierde, así que conviene descargar un respaldo antes. Sus dos accesos " +
        "de administrador vuelven aunque el archivo no los traiga.</p>" +
        botonArchivo("mn-archivo", "Restaurar desde un archivo", ".json") +
      "</div>" +

      '<div class="tarjeta">' +
        "<h2>Borrar caché en todos los dispositivos</h2>" +
        '<p class="nota">Cuando alguien sigue viendo la versión vieja. Este equipo se ' +
        "limpia al instante. Los demás lo hacen solos la próxima vez que abran la app, " +
        "en cuanto la base de datos esté conectada: la orden viaja con los datos.</p>" +
        (db.purga ? '<p class="nota"><b>Última orden dada:</b> ' + fechaLarga(db.purga) + "</p>" : "") +
        '<button class="bt sec" type="button" id="mn-cache">Borrar caché y recargar</button>' +
      "</div>";
  }

  /* ---- Poner en 0: aparte, siempre a la vista, y con su propia llave ---- */
  function ponerEnCero(){
    return '<div class="tarjeta" style="border-left:3px solid var(--rojo)">' +
        "<h2>Poner en 0</h2>" +
        '<p class="nota">Deja la obra en cero: consolidado, pedidos, guías, movimientos, ' +
        "herramientas y todos los perfiles menos los dos de administración —sin esos nadie " +
        "podría volver a entrar—. No se puede deshacer: descargue el respaldo antes. " +
        "Para confirmar, escriba <b>PONER EN 0</b>.</p>" +
        '<input type="text" id="mn-confirmo" placeholder="PONER EN 0" ' +
        'autocomplete="off" style="margin-bottom:11px">' +
        '<button class="bt" type="button" id="mn-borrar" ' +
        'style="background:var(--rojo);color:#fff">Poner en 0</button>' +
      "</div>";
  }

  function fechaLarga(iso){
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString();
  }

  function enganchar(){
    $("mn-abrir").addEventListener("click", function(){ mantAbierto = !mantAbierto; pintar(); });

    $("mn-borrar").addEventListener("click", function(){
      var escrito = ($("mn-confirmo").value || "").trim().toUpperCase().replace(/\s+/g, " ");
      if(escrito !== "PONER EN 0") return aviso("Escriba PONER EN 0 para confirmar.");
      db = {
        obra:db.obra, area:db.area, serie:db.serie, correlativo:db.correlativo,
        consolidado:[], materiales:[], herramientas:[], usuarios:[],
        requerimientos:[], guias:[], movimientos:[]
      };
      asegurarAdmins();
      guardar();
      aviso("Todo en cero. Quedan solo sus dos accesos.");
      pintar();
    });

    if(!mantAbierto) return;

    $("mn-bajar").addEventListener("click", descargarRespaldo);

    enlazarBotonArchivo("mn-archivo", {acepta:".json",
      confirmar:"toque para restaurar",
      alConfirmar:function(f){
        restaurarDesde(f, function(err){
          if(err) return aviso(err);
          aviso("Restaurado: " + db.consolidado.length + " renglones y " +
                db.usuarios.length + " perfiles.");
          pintar();
        });
      }});

    $("mn-cache").addEventListener("click", async function(){
      /* la orden queda anotada en los datos: cuando la base esté conectada
         viaja a los demás equipos y cada uno se limpia una sola vez */
      db.purga = new Date().toISOString();
      guardar();
      try{ localStorage.setItem("almacen_purga_hecha", db.purga); }catch(e){}
      await limpiarEsteEquipo();
      aviso("Caché borrado. Recargando…");
      setTimeout(function(){ location.reload(); }, 700);
    });
  }

  pintar();
};

/* Si la persona ya había entrado con su cuenta de la base, se retoma sin
   pedirle nada: en obra se abre la app veinte veces al día. */
if(typeof nubeRecordar === "function"){
  nubeRecordar().then(function(p){
    if(!p) return;
    localStorage.setItem("almacen_simple_dueno", p.fotocheck === FOTOCHECK_DUENO ? "1" : "0");
    entrar(p.puesto, p.nombre);
    nubeArrancar();
  }).catch(function(){});
}

var guardado = localStorage.getItem("almacen_simple_cargo");
if(guardado && PANEL[guardado]){
  entrar(guardado, localStorage.getItem("almacen_simple_persona"));
  /* Estaba dentro pero sin sesión con la base: se intenta en silencio con
     lo que ya está guardado. Es el caso de todos los equipos que venían
     trabajando antes de que la app supiera hablar con la base. */
  setTimeout(function(){
    if(typeof nubeHay === "function" && !nubeHay()) conectarConLoGuardado(true);
  }, 1200);
}
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
