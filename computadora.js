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

  /* Columnas escondidas por el usuario, como en Excel. Se guardan igual
     que los anchos: es una preferencia del equipo, no del pedido. */
  var LLAVE_OCULTAS = "almacen_ocultas_planilla_c2";
  function ocultas(){
    try{ return JSON.parse(localStorage.getItem(LLAVE_OCULTAS) || "[]"); }catch(e){ return []; }
  }
  function guardarOcultas(v){
    try{ localStorage.setItem(LLAVE_OCULTAS, JSON.stringify(v)); }catch(e){}
  }
  window.ALM_COLS = {
    ocultas: ocultas, guardarOcultas: guardarOcultas,
    anchos: anchos, guardarAnchos: guardarAnchos,
    pordefecto: function(){ return POR_DEFECTO; },
    titulos: function(){
      var t = {num:"N°"};
      COLS_REQ_V49.forEach(function(c){ t[c.k] = c.t; });
      return t;
    }
  };

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
    var todas = [{k:"num"}].concat(COLS_REQ_V49).concat([{k:"quita"}]);
    var esc = ocultas(), fuera = [], salida = [];
    todas.forEach(function(c){
      /* N° y la X no se pueden esconder: sin ellas la fila pierde su
         orden y su forma de quitarse. */
      if(c.k !== "num" && c.k !== "quita" && esc.indexOf(c.k) >= 0){ fuera.push(c.k); return; }
      var copia = {};
      for(var x in c) copia[x] = c[x];
      copia.faltanAntes = fuera.slice();   /* la marca de doble línea */
      fuera = [];
      salida.push(copia);
    });
    /* si la última quedó escondida, la marca va en la X */
    if(fuera.length && salida.length) salida[salida.length - 1].faltanDespues = fuera.slice();
    return salida;
  }

  pintarTablaReqV49 = function(){
    var cont = document.getElementById("mr-items");
    if(!cont) return;
    var A = anchos(), cols = columnas();

    var colgroup = "<colgroup>" + cols.map(function(c){
      return '<col data-col="' + c.k + '" style="width:' + A[c.k] + 'px">';
    }).join("") + "</colgroup>";

    var marca = function(c){
      return (c.faltanAntes && c.faltanAntes.length ? " tras-oculta" : "") +
             (c.faltanDespues && c.faltanDespues.length ? " antes-oculta" : "");
    };
    var datos = function(c){
      return ' data-col="' + c.k + '"' +
             (c.faltanAntes && c.faltanAntes.length
               ? ' data-faltan-antes="' + c.faltanAntes.join(",") + '"' : "") +
             (c.faltanDespues && c.faltanDespues.length
               ? ' data-faltan-despues="' + c.faltanDespues.join(",") + '"' : "");
    };
    var cab = "<tr>" + cols.map(function(c){
      if(c.k === "num")
        return '<th class="c-num' + marca(c) + '"' + datos(c) +
               '><span class="rot">N°</span><span class="tirador" data-mueve="num"></span></th>';
      if(c.k === "quita")
        return '<th class="c-quita' + marca(c) + '"' + datos(c) + "></th>";
      return '<th class="' + c.c + (c.despues ? " despues-v66" : "") + marca(c) + '"' + datos(c) +
             '><span class="rot">' + c.t + "</span>" +
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

/* ---------------------------------------------------------------
   C3  Ocultar y mostrar columnas, como en Excel

   Anticlick sobre la cabecera y sale el menú: ocultar esa columna,
   devolver la que falta al lado, o devolverlas todas.

   La gracia de Excel no es esconder —eso es fácil— sino que se note
   que algo falta y se pueda traer de vuelta sin adivinar. Por eso
   donde había una columna queda una doble línea marcada: es la única
   pista de que ahí hay algo escondido. Sin esa marca, alguien esconde
   Observaciones, se olvida, y un mes después jura que la app nunca las
   tuvo.

   N° y la X no se pueden esconder: sin ellas la fila pierde su orden y
   su forma de quitarse.

   Y la cabecera se acomoda al ancho: si la columna se angosta, el
   título parte en varias líneas y se centra, en vez de cortarse con
   puntos suspensivos. Un título cortado no dice qué columna es.
   --------------------------------------------------------------- */
(function columnasOcultablesC3(){
  if(!window.ALM_COLS || typeof pintarTablaReqV49 !== "function") return;

  var ANGOSTA = 108;   /* debajo de esto el título se centra y parte */

  var s = document.createElement("style");
  s.id = "estilos-c3";
  s.textContent = [
    /* Los min-width de las versiones anteriores (130px en Solicitante y
       Lugar, entre otros) le ponen piso a la columna y el arrastre se
       traba ahí. Ahora el ancho lo manda el <colgroup> y nada más. */
    ".tabla-req th,.tabla-req td{min-width:0}",
    /* el título se acomoda: parte en líneas y se centra cuando no entra */
    ".tabla-req th{white-space:normal}",
    ".tabla-req th .rot{display:block;overflow-wrap:anywhere;line-height:1.2}",
    ".tabla-req th.angosta{text-align:center}",
    ".tabla-req th.angosta .rot{text-align:center}",
    /* la doble línea: acá falta una columna */
    ".tabla-req th.tras-oculta,.tabla-req td.tras-oculta{border-left:3px double var(--pri)}",
    ".tabla-req th.antes-oculta,.tabla-req td.antes-oculta{border-right:3px double var(--pri)}",
    ".tabla-req th.tras-oculta,.tabla-req th.antes-oculta{cursor:context-menu}",
    /* el menú del anticlick */
    ".menu-col-c3{position:fixed;z-index:9999;background:var(--sup);border:1px solid var(--cajon-borde);",
      "border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.18);padding:5px;min-width:210px}",
    ".menu-col-c3 button{display:block;width:100%;text-align:left;border:0;background:transparent;",
      "font:inherit;font-size:13px;color:var(--tinta);padding:9px 11px;border-radius:7px;cursor:pointer}",
    ".menu-col-c3 button:hover{background:var(--cajon)}",
    ".menu-col-c3 button[disabled]{opacity:.4;cursor:default}",
    ".menu-col-c3 .sep{height:1px;background:var(--cajon-borde);margin:4px 6px}"
  ].join("");
  document.head.appendChild(s);

  function cerrarMenu(){
    var m = document.querySelector(".menu-col-c3");
    if(m) m.remove();
    document.removeEventListener("click", cerrarMenu);
    document.removeEventListener("scroll", cerrarMenu, true);
  }

  function abrirMenu(x, y, th){
    cerrarMenu();
    var clave = th.dataset.col;
    var titulos = window.ALM_COLS.titulos();
    var esc = window.ALM_COLS.ocultas();
    var faltan = []
      .concat((th.dataset.faltanAntes || "").split(",").filter(Boolean))
      .concat((th.dataset.faltanDespues || "").split(",").filter(Boolean));

    var m = document.createElement("div");
    m.className = "menu-col-c3";
    var html = "";

    if(clave !== "num" && clave !== "quita")
      html += '<button data-op="ocultar">Ocultar «' + esc2(titulos[clave] || clave) + "»</button>";

    faltan.forEach(function(k){
      html += '<button data-op="mostrar" data-k="' + k + '">Mostrar «' +
              esc2(titulos[k] || k) + "»</button>";
    });

    if(esc.length){
      html += '<div class="sep"></div>' +
              '<button data-op="todas">Mostrar todas las columnas (' + esc.length + ")</button>";
    }
    if(!html) html = "<button disabled>Esta columna no se puede ocultar</button>";
    m.innerHTML = html;
    document.body.appendChild(m);

    /* que no se salga de la pantalla */
    var r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
    m.style.top  = Math.min(y, innerHeight - r.height - 8) + "px";

    m.addEventListener("click", function(e){
      var b = e.target.closest("button");
      if(!b || b.disabled) return;
      var lista = window.ALM_COLS.ocultas();
      if(b.dataset.op === "ocultar" && lista.indexOf(clave) < 0) lista.push(clave);
      if(b.dataset.op === "mostrar") lista = lista.filter(function(k){ return k !== b.dataset.k; });
      if(b.dataset.op === "todas") lista = [];
      window.ALM_COLS.guardarOcultas(lista);
      cerrarMenu();
      pintarItemsReq();
    });

    setTimeout(function(){
      document.addEventListener("click", cerrarMenu);
      document.addEventListener("scroll", cerrarMenu, true);
    }, 0);
  }

  function esc2(t){
    return String(t).replace(/[&<>"]/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];
    });
  }

  /* La marca de doble línea también en las celdas, no solo en la
     cabecera: si estuviera solo arriba, al bajar por una tabla larga se
     pierde de vista que falta algo. */
  function marcarCeldas(){
    var cont = document.getElementById("mr-items");
    if(!cont) return;
    var tabla = cont.querySelector("table");
    if(!tabla) return;
    var ths = tabla.querySelectorAll("thead th");
    Array.prototype.forEach.call(tabla.querySelectorAll("tbody tr"), function(tr){
      Array.prototype.forEach.call(tr.children, function(td, i){
        var th = ths[i];
        if(!th) return;
        td.classList.toggle("tras-oculta", th.classList.contains("tras-oculta"));
        td.classList.toggle("antes-oculta", th.classList.contains("antes-oculta"));
      });
    });
  }

  /* El título se centra cuando la columna queda angosta */
  function acomodarTitulos(){
    var cont = document.getElementById("mr-items");
    if(!cont) return;
    Array.prototype.forEach.call(cont.querySelectorAll("thead th"), function(th){
      th.classList.toggle("angosta", th.getBoundingClientRect().width < ANGOSTA);
    });
  }

  var pintarSinMenu = pintarTablaReqV49;
  pintarTablaReqV49 = function(){
    pintarSinMenu.apply(this, arguments);
    var cont = document.getElementById("mr-items");
    if(!cont) return;

    marcarCeldas();
    acomodarTitulos();

    Array.prototype.forEach.call(cont.querySelectorAll("thead th"), function(th){
      th.addEventListener("contextmenu", function(e){
        e.preventDefault();
        abrirMenu(e.clientX, e.clientY, th);
      });
    });

    /* al arrastrar una separación el título puede pasar a angosto */
    Array.prototype.forEach.call(cont.querySelectorAll(".tirador"), function(t){
      t.addEventListener("mousedown", function(){
        var seguir = function(){ acomodarTitulos(); };
        var parar = function(){
          document.removeEventListener("mousemove", seguir);
          document.removeEventListener("mouseup", parar);
          acomodarTitulos();
        };
        document.addEventListener("mousemove", seguir);
        document.addEventListener("mouseup", parar);
      });
    });
  };
})();
