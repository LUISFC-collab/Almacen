/* =====================================================================
   ALMACEN CPQ · Lo propio de la COMPUTADORA

   Acá va todo lo que solo tiene sentido en una laptop: el menú de la
   izquierda, el ancho, el requerimiento en dos columnas, el plegado.

   Se lee DESPUÉS del motor, así que puede envolver cualquier función de
   app.js sin tocarla — el mismo recurso que ya usan los bloques V del
   motor. Lo que se escriba acá no llega al celular.

   De momento está vacío a propósito: los bloques de computadora siguen
   dentro de app.js y se van mudando de a uno, comprobando cada mudanza.
   Mover trece mil líneas de golpe es la forma más segura de romper algo
   sin saber qué fue.
   ===================================================================== */

/* ---------------------------------------------------------------
   C1  Fuera "Inicio" del menú

   En computadora esa pantalla se quedó sin nada que mostrar: sus
   tarjetas subieron al menú de la izquierda y sus números —actividad,
   resumen, consolidado— a la fila de arriba, que ahora se ve desde
   cualquier sección. Entrar a Inicio era llegar a un hueco.

   Al sacarla hay que decidir dónde cae la app al abrir, porque si no
   cae igual en el hueco pero sin forma de salir. Cae en la primera
   sección que el cargo tenga permitida: para casi todos es Pedidos,
   que es a lo que se entra a hacer.

   La pantalla de Inicio NO se borra: en el celular sigue siendo la
   principal y ahí sí tiene sentido. Esto es solo de computadora.
   --------------------------------------------------------------- */
(function sinInicioEnElMenuC1(){
  if(typeof pintarLateralV57 !== "function") return;

  const pintarConInicio = pintarLateralV57;
  pintarLateralV57 = function(){
    pintarConInicio.apply(this, arguments);
    const nav = document.getElementById("lateral-v57");
    if(!nav) return;
    const b = nav.querySelector('[data-ir-lat="inicio"]');
    if(b) b.remove();
  };

  /* A dónde va la app cuando no hay Inicio */
  function primeraSeccion(){
    const libres = (typeof MENU !== "undefined" ? MENU : [])
      .filter(k => k !== "inicio" && k !== "mas")
      .filter(k => !PANTALLAS[k].perm || puede(PANTALLAS[k].perm));
    return libres[0] || "pedidos";
  }

  const iniciarAppC1 = iniciarApp;
  iniciarApp = function(){
    const r = iniciarAppC1.apply(this, arguments);
    /* Solo si quedó parada en Inicio: si el cargo entró a otra cosa, no
       se le mueve el piso. */
    if(typeof pantalla !== "undefined" && pantalla === "inicio") ir(primeraSeccion());
    return r;
  };

  /* El botón de volver y el cambio de modo también podían dejarla en
     Inicio; se la manda a la sección de siempre. */
  const irC1 = ir;
  ir = function(destino){
    if(destino === "inicio") destino = primeraSeccion();
    return irC1.call(this, destino, arguments[1]);
  };
})();
/* ---------------------------------------------------------------
   C2  La planilla: el texto baja de línea y las columnas se mueven

   Tres cosas que faltaban al escribir en la tabla:

   1. El texto se cortaba. Un campo de una línea con "Perno hexagonal
      galvanizado 5/8 x 3 con tuerca y arandela" muestra el final y
      esconde el principio, y al salir del campo no se sabe qué dice.
      Ahora la celda crece hacia abajo —dos, tres, cuatro renglones— sin
      pasarse NUNCA del ancho de su columna, que es el límite.

   2. Cada separación se puede arrastrar. Descripción necesita sitio,
      Und. no; quién trabaja decide cuál, no yo desde acá. El ancho de
      cada columna queda recordado en el equipo.

   3. Al ensanchar columnas la tabla deja de entrar, y ahí aparece la
      barra de izquierda a derecha. Ya existía, pero con anchos fijos
      casi no llegaba a hacer falta.

   Se usa `table-layout: fixed` con un <colgroup>: es lo único que hace
   que el ancho de la columna mande de verdad sobre el contenido. Sin
   eso el navegador reparte a su gusto y arrastrar no cambia nada.
   --------------------------------------------------------------- */
(function planillaAnchaC2(){
  if(typeof pintarTablaReqV49 !== "function") return;

  var LLAVE = "almacen_anchos_planilla_c2";
  var POR_DEFECTO = {
    num:46, desc:260, unidad:78, cant:96, entregaParcial:104,
    entregaTotal:104, solicitante:150, lugar:150, autorizado:120, obs:200, quita:44
  };
  var MINIMO = 56;

  function anchos(){
    var g = {};
    try{ g = JSON.parse(localStorage.getItem(LLAVE) || "{}"); }catch(e){}
    return Object.assign({}, POR_DEFECTO, g);
  }
  function guardarAnchos(a){
    try{ localStorage.setItem(LLAVE, JSON.stringify(a)); }catch(e){}
  }

  /* La celda crece hacia abajo hasta donde haga falta */
  function crecer(t){
    t.style.height = "auto";
    t.style.height = Math.max(34, t.scrollHeight) + "px";
  }

  var s = document.createElement("style");
  s.id = "estilos-c2";
  s.textContent = [
    ".tabla-req table{table-layout:fixed;min-width:0;width:max-content}",
    ".tabla-req th{position:relative;user-select:none}",
    ".tabla-req th .tirador{position:absolute;top:0;right:-3px;width:7px;height:100%;",
      "cursor:col-resize;z-index:2}",
    ".tabla-req th .tirador:hover::after,.tabla-req th.midiendo .tirador::after{",
      "content:'';position:absolute;left:2px;top:0;width:2px;height:100%;background:var(--pri)}",
    /* el texto baja de línea y nunca se sale del ancho de su columna */
    ".tabla-req textarea{width:100%;border:1px solid transparent;background:transparent;",
      "padding:7px;border-radius:8px;font:inherit;font-size:13.5px;color:inherit;resize:none;",
      "overflow:hidden;line-height:1.35;display:block;white-space:pre-wrap;word-break:break-word}",
    ".tabla-req textarea:focus{border-color:var(--pri);background:var(--sup);outline:none}",
    ".tabla-req td{vertical-align:top}",
    ".tabla-req td.c-num{padding-top:13px}",
    "body.arrastrando-col{cursor:col-resize;user-select:none}"
  ].join("");
  document.head.appendChild(s);

  /* Columnas en el orden del papel; `num` y `quita` no son campos */
  function columnas(){
    return [{k:"num"}].concat(COLS_REQ_V49).concat([{k:"quita"}]);
  }

  pintarTablaReqV49 = function(){
    var cont = document.getElementById("mr-items");
    if(!cont) return;
    var A = anchos(), cols = columnas();

    var colgroup = "<colgroup>" + cols.map(function(c){
      return '<col data-col="' + c.k + '" style="width:' + A[c.k] + 'px">';
    }).join("") + "</colgroup>";

    var cab = "<tr>" + cols.map(function(c){
      if(c.k === "num")   return '<th class="c-num">N°<span class="tirador" data-mueve="num"></span></th>';
      if(c.k === "quita") return '<th class="c-quita"></th>';
      return '<th class="' + c.c + (c.despues ? " despues-v66" : "") + '">' + c.t +
             '<span class="tirador" data-mueve="' + c.k + '"></span></th>';
    }).join("") + "</tr>";

    function campo(c, it, i){
      var v = esc(String(it[c.k] == null ? "" : it[c.k]));
      if(c.tipo === "number")
        return '<input type="number" min="0" step="0.01" inputmode="decimal" data-campo="' + c.k +
               '" data-fila="' + i + '" value="' + v + '"' +
               (c.despues ? ' title="Lo llenan el almacén y Logística al entregar"' : "") + ">";
      return '<textarea rows="1" data-campo="' + c.k + '" data-fila="' + i + '"' +
             (c.k === "desc" ? ' placeholder="Qué material necesita"' : "") +
             (c.despues ? ' title="Lo llenan el almacén y Logística al entregar"' : "") + ">" +
             v + "</textarea>";
    }

    var cuerpo = itemsReq.length
      ? itemsReq.map(function(it, i){
          return "<tr>" + cols.map(function(c){
            if(c.k === "num")   return '<td class="c-num">' + (i + 1) + "</td>";
            if(c.k === "quita") return '<td class="c-quita"><button type="button" class="quita-fila" ' +
              'data-quitaritem="' + i + '" aria-label="Quitar esta línea" title="Quitar">✕</button></td>';
            return '<td class="' + c.c + (c.despues ? " despues-v66" : "") + '">' + campo(c, it, i) + "</td>";
          }).join("") + "</tr>";
        }).join("")
      : '<tr class="sin-filas"><td colspan="' + cols.length + '">' +
        "Suba la planilla o toque el + para agregar un material.</td></tr>";

    cont.innerHTML = '<div class="tabla-req"><table>' + colgroup +
                     "<thead>" + cab + "</thead><tbody>" + cuerpo + "</tbody></table></div>";

    /* Se escribe directo sobre el arreglo y NO se repinta: repintar en
       cada tecla sacaría el foco del campo a media palabra. */
    Array.prototype.forEach.call(cont.querySelectorAll("[data-campo]"), function(el){
      if(el.tagName === "TEXTAREA") crecer(el);
      el.addEventListener("input", function(){
        var it = itemsReq[+el.dataset.fila];
        if(!it) return;
        var k = el.dataset.campo;
        it[k] = k === "cant" ? Math.max(0.01, num(el.value) || 0.01)
              : (k === "entregaParcial" || k === "entregaTotal")
                ? (el.value === "" ? "" : num(el.value))
                : el.value;
        if(el.tagName === "TEXTAREA") crecer(el);
      });
    });

    Array.prototype.forEach.call(cont.querySelectorAll("[data-quitaritem]"), function(b){
      b.addEventListener("click", function(){
        itemsReq.splice(+b.dataset.quitaritem, 1);
        pintarItemsReq();
      });
    });

    /* Arrastrar la separación entre columnas */
    Array.prototype.forEach.call(cont.querySelectorAll(".tirador"), function(t){
      t.addEventListener("mousedown", function(e){
        e.preventDefault();
        var k = t.dataset.mueve;
        var col = cont.querySelector('col[data-col="' + k + '"]');
        var th = t.parentNode;
        if(!col) return;
        var x0 = e.clientX, w0 = col.getBoundingClientRect().width;
        th.classList.add("midiendo");
        document.body.classList.add("arrastrando-col");

        var mover = function(ev){
          var w = Math.max(MINIMO, Math.round(w0 + (ev.clientX - x0)));
          col.style.width = w + "px";
          /* Las celdas de texto se reacomodan al nuevo ancho, pero en el
             cuadro SIGUIENTE: medidas en el mismo, el navegador todavía
             no aplicó el ancho y se calcularía el alto contra el viejo. */
          requestAnimationFrame(function(){
            Array.prototype.forEach.call(
              document.querySelectorAll('#mr-items textarea[data-campo="' + k + '"]'), crecer);
          });
          /* Se guarda MIENTRAS se arrastra, no solo al soltar: la
             sincronización repinta la tabla cuando llega un cambio de
             otro equipo, y si eso cae a mitad del gesto la columna
             volvía al ancho de fábrica y se perdía el arrastre. */
          var Am = anchos(); Am[k] = w; guardarAnchos(Am);
        };
        var soltar = function(){
          document.removeEventListener("mousemove", mover);
          document.removeEventListener("mouseup", soltar);
          th.classList.remove("midiendo");
          document.body.classList.remove("arrastrando-col");
          /* Un último reacomodo con el ancho ya asentado: durante el
             arrastre el alto puede quedar de más, y así cierra justo. */
          requestAnimationFrame(function(){
            Array.prototype.forEach.call(
              document.querySelectorAll('#mr-items textarea[data-campo="' + k + '"]'), crecer);
          });
          /* col puede haber quedado desconectado si hubo repintado a
             mitad del arrastre: se toma el del documento, no el del
             cierre, y si no hay se deja lo ya guardado en `mover`. */
          var vivo = document.querySelector('#mr-items col[data-col="' + k + '"]');
          if(vivo){
            var A2 = anchos();
            A2[k] = Math.round(vivo.getBoundingClientRect().width);
            guardarAnchos(A2);
          }
        };
        document.addEventListener("mousemove", mover);
        document.addEventListener("mouseup", soltar);
      });
    });
  };
})();
