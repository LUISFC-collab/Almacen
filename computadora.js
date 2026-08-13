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
  /* Sin tope: la separación se puede arrastrar hasta cerrar la columna.
     Por debajo de este ancho ya no se lee nada, así que cerrarla del todo
     equivale a esconderla — es lo que hace Excel y es lo que espera la
     mano que la está arrastrando. */
  var CASI_CERRADA = 14;

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
    /* La separación se VE siempre, en plomo: si solo apareciera al pasar
       por encima, nadie descubre que se puede mover. Se marca en azul al
       apuntarla y en rojo cuando se la está por cerrar. */
    ".tabla-req th .tirador::after{",
      "content:'';position:absolute;left:2px;top:18%;width:2px;height:64%;",
      "background:#98a2b3;border-radius:2px}",
    ".tabla-req th .tirador:hover::after,.tabla-req th.midiendo .tirador::after{",
      "top:0;height:100%;background:var(--pri)}",
    /* el texto baja de línea y nunca se sale del ancho de su columna */
    ".tabla-req textarea{width:100%;border:1px solid transparent;background:transparent;",
      "padding:7px;border-radius:8px;font:inherit;font-size:13.5px;color:inherit;resize:none;",
      "overflow:hidden;line-height:1.35;display:block;white-space:pre-wrap;word-break:break-word}",
    ".tabla-req textarea:focus{border-color:var(--pri);background:var(--sup);outline:none}",
    ".tabla-req td{vertical-align:top}",
    ".tabla-req td.c-num{padding-top:13px}",
    "body.arrastrando-col{cursor:col-resize;user-select:none}",
    /* mientras se la arrastra hasta cerrar */
    ".tabla-req th.por-cerrar{background:var(--mal-f,#fde8e8)}",
    ".tabla-req th.por-cerrar .tirador::after{background:var(--mal,#b42318)!important}"
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
        /* El ancho PEDIDO por el arrastre, que no es el dibujado: con
           table-layout:fixed la celda nunca baja de sus rellenos (~14px),
           así que mirando lo dibujado la columna no llega a cerrarse
           nunca y el gesto de esconderla no se completaba. */
        var pedido = w0;
        th.classList.add("midiendo");
        document.body.classList.add("arrastrando-col");

        var mover = function(ev){
          var w = Math.max(0, Math.round(w0 + (ev.clientX - x0)));
          pedido = w;
          col.style.width = w + "px";
          /* aviso de que soltando ahí la columna se esconde */
          th.classList.toggle("por-cerrar", w < CASI_CERRADA);
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
          th.classList.remove("por-cerrar");
          document.body.classList.remove("arrastrando-col");

          /* Cerrada del todo = escondida. Se guarda como oculta y se
             repinta: queda la doble línea y vuelve con el anticlick. */
          if(pedido < CASI_CERRADA && k !== "num" && k !== "quita"){
            var esc0 = ocultas();
            if(esc0.indexOf(k) < 0) esc0.push(k);
            guardarOcultas(esc0);
            /* se le devuelve un ancho usable para cuando vuelva */
            var Av = anchos(); Av[k] = POR_DEFECTO[k] || 120; guardarAnchos(Av);
            pintarItemsReq();
            if(typeof snack === "function")
              snack("Columna escondida. Anticlick en la doble línea para traerla.", "");
            return;
          }
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

/* ---------------------------------------------------------------
   C4  El calendario de pedidos

   El reloj de la fila de arriba decía cuántos registros de actividad
   había: un número que casi nadie mira. En su lugar va un calendario,
   que es lo que se pregunta de verdad en Pedidos — "¿qué se pidió el
   martes?", "¿cómo viene lo de hoy?".

   Cada día trae su marca "resueltos/total" (2/10): de un vistazo se ve
   qué días quedaron cerrados y cuáles siguen abiertos, sin entrar a
   ninguno. Resuelto = entregado, cerrado, recibido o rechazado; lo
   demás sigue en curso.

   Al elegir un día la lista de Pedidos muestra solo ese día. "Hoy"
   vuelve al día corriente y "Todos" saca el filtro, porque a veces se
   busca un pedido viejo y no se recuerda de cuándo era.

   Un pedido cuenta en el día que le toca (`diaPedido`, el de la regla
   de un pedido por día), no en el que se escribió: son distintos cuando
   algo se cargó de noche para el día siguiente.
   --------------------------------------------------------------- */
(function calendarioPedidosC4(){
  if(typeof pintarPedidos !== "function") return;

  var MESES = ["enero","febrero","marzo","abril","mayo","junio","julio",
               "agosto","septiembre","octubre","noviembre","diciembre"];
  var DIAS = ["L","M","M","J","V","S","D"];

  var elegido = null;          /* null = todos los días */
  var mesVisto = null;         /* Date del primero del mes que se muestra */

  function diaDe(r){ return r.diaPedido || diaLocal(r.fecha); }

  /* Cuántos resueltos y cuántos hay, por día */
  function conteo(){
    var c = {};
    (typeof misPedidos === "function" ? misPedidos() : []).forEach(function(r){
      var d = diaDe(r);
      if(!c[d]) c[d] = {total:0, listos:0};
      c[d].total++;
      if(CERRADOS.indexOf(r.estado) >= 0) c[d].listos++;
    });
    return c;
  }

  function iso(d){
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  var s = document.createElement("style");
  s.id = "estilos-c4";
  s.textContent = [
    "#cal-c4{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;",
      "height:100%;padding:12px 14px;border:1px solid var(--cajon-borde);border-radius:var(--r-m,14px);",
      "background:var(--sup);cursor:pointer;min-width:96px}",
    "#cal-c4:hover{border-color:var(--pri)}",
    "#cal-c4 .dia{font-size:22px;font-weight:600;line-height:1;color:var(--pri)}",
    "#cal-c4 .mes{font-size:10.5px;color:var(--tinta-sec);text-transform:uppercase;letter-spacing:.04em}",
    "#cal-c4 .marca{font-size:11px;font-weight:600;color:var(--tinta-sec);margin-top:2px}",
    "#cal-c4 .marca.listo{color:var(--ok,#085d3a)}",

    ".hoja-cal{position:fixed;z-index:9999;background:var(--sup);border:1px solid var(--cajon-borde);",
      "border-radius:14px;box-shadow:0 10px 30px rgba(16,24,40,.2);padding:12px;width:302px}",
    ".hoja-cal .cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}",
    ".hoja-cal .cab b{font-size:14px}",
    ".hoja-cal .cab button{border:0;background:transparent;font:inherit;font-size:17px;cursor:pointer;",
      "color:var(--pri);padding:2px 9px;border-radius:8px}",
    ".hoja-cal .cab button:hover{background:var(--cajon)}",
    ".hoja-cal .sem,.hoja-cal .rej{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}",
    ".hoja-cal .sem span{font-size:10px;color:var(--tinta-sec);text-align:center;padding:3px 0}",
    ".hoja-cal .rej button{border:1px solid transparent;background:transparent;border-radius:8px;",
      "padding:5px 0 4px;font:inherit;cursor:pointer;display:flex;flex-direction:column;",
      "align-items:center;gap:1px;min-height:40px}",
    ".hoja-cal .rej button:hover{background:var(--cajon)}",
    ".hoja-cal .rej .n{font-size:12.5px;color:var(--tinta)}",
    ".hoja-cal .rej .m{font-size:9.5px;color:var(--tinta-sec);font-variant-numeric:tabular-nums}",
    ".hoja-cal .rej .m.listo{color:var(--ok,#085d3a);font-weight:700}",
    ".hoja-cal .rej button.hoy{border-color:var(--pri)}",
    ".hoja-cal .rej button.elegido{background:var(--pri);}",
    ".hoja-cal .rej button.elegido .n,.hoja-cal .rej button.elegido .m{color:var(--sobre-pri)}",
    ".hoja-cal .rej button.fuera .n{opacity:.32}",
    ".hoja-cal .pie{display:flex;gap:8px;margin-top:10px}",
    ".hoja-cal .pie button{flex:1;border:1px solid var(--cajon-borde);background:var(--sup);",
      "border-radius:9px;padding:8px;font:inherit;font-size:12.5px;cursor:pointer}",
    ".hoja-cal .pie button:hover{border-color:var(--pri);color:var(--pri)}"
  ].join("");
  document.head.appendChild(s);

  function cerrarHojaCal(){
    var h = document.querySelector(".hoja-cal");
    if(h) h.remove();
    document.removeEventListener("click", cerrarHojaCal);
  }

  function abrirHojaCal(ancla){
    cerrarHojaCal();
    var c = conteo();
    var hoy = hoyISO();
    if(!mesVisto){
      var base = elegido ? new Date(elegido + "T12:00:00") : new Date();
      mesVisto = new Date(base.getFullYear(), base.getMonth(), 1);
    }

    var h = document.createElement("div");
    h.className = "hoja-cal";

    function pintar(){
      var y = mesVisto.getFullYear(), m = mesVisto.getMonth();
      var primero = new Date(y, m, 1);
      /* lunes primero: getDay() da 0 el domingo */
      var corr = (primero.getDay() + 6) % 7;
      var inicio = new Date(y, m, 1 - corr);

      var celdas = "";
      for(var i = 0; i < 42; i++){
        var d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
        var k = iso(d), dat = c[k];
        var fuera = d.getMonth() !== m;
        if(fuera && i > 34 && !dat) continue;
        celdas += '<button data-dia="' + k + '" class="' +
          (fuera ? "fuera " : "") + (k === hoy ? "hoy " : "") +
          (k === elegido ? "elegido" : "") + '">' +
          '<span class="n">' + d.getDate() + "</span>" +
          (dat ? '<span class="m' + (dat.listos === dat.total ? " listo" : "") + '">' +
                 dat.listos + "/" + dat.total + "</span>" : '<span class="m">·</span>') +
          "</button>";
      }

      h.innerHTML =
        '<div class="cab"><button data-mes="-1" aria-label="Mes anterior">‹</button>' +
        "<b>" + MESES[m] + " " + y + "</b>" +
        '<button data-mes="1" aria-label="Mes siguiente">›</button></div>' +
        '<div class="sem">' + DIAS.map(function(x){ return "<span>" + x + "</span>"; }).join("") + "</div>" +
        '<div class="rej">' + celdas + "</div>" +
        '<div class="pie"><button data-ir="hoy">Hoy</button>' +
        '<button data-ir="todos">Todos los días</button></div>';
    }

    pintar();
    document.body.appendChild(h);

    var r = ancla.getBoundingClientRect();
    h.style.left = Math.min(r.left, innerWidth - h.getBoundingClientRect().width - 10) + "px";
    h.style.top = Math.min(r.bottom + 6, innerHeight - h.getBoundingClientRect().height - 10) + "px";

    h.addEventListener("click", function(e){
      e.stopPropagation();
      var b = e.target.closest("button");
      if(!b) return;
      if(b.dataset.mes){
        mesVisto = new Date(mesVisto.getFullYear(), mesVisto.getMonth() + (+b.dataset.mes), 1);
        return pintar();
      }
      if(b.dataset.dia)  elegido = (elegido === b.dataset.dia) ? null : b.dataset.dia;
      if(b.dataset.ir === "hoy"){ elegido = hoyISO(); mesVisto = null; }
      if(b.dataset.ir === "todos") elegido = null;
      cerrarHojaCal();
      pintarCalendarioC4();
      if(typeof pantalla !== "undefined" && pantalla === "pedidos") pintarPedidos();
      else ir("pedidos");
    });

    setTimeout(function(){ document.addEventListener("click", cerrarHojaCal); }, 0);
  }

  /* El calendario ocupa el lugar del reloj en la fila de arriba */
  function pintarCalendarioC4(){
    var caja = document.getElementById("ini-cabecera-v52");
    if(!caja) return;
    var reloj = document.getElementById("ini-actividad");
    if(reloj) reloj.style.display = "none";

    var b = document.getElementById("cal-c4");
    if(!b){
      b = document.createElement("button");
      b.type = "button";
      b.id = "cal-c4";
      caja.insertBefore(b, caja.firstElementChild);
      b.addEventListener("click", function(e){ e.stopPropagation(); abrirHojaCal(b); });
    }

    var c = conteo();
    var k = elegido || hoyISO();
    var d = new Date(k + "T12:00:00");
    var dat = c[k];
    b.innerHTML =
      '<span class="dia">' + d.getDate() + "</span>" +
      '<span class="mes">' + MESES[d.getMonth()].slice(0, 3) + (elegido ? "" : " · hoy") + "</span>" +
      '<span class="marca' + (dat && dat.listos === dat.total ? " listo" : "") + '">' +
      (dat ? dat.listos + "/" + dat.total : "sin pedidos") + "</span>";
    b.title = elegido
      ? "Viendo los pedidos del " + k + " · toque para cambiar de día"
      : "Toque para elegir el día de los pedidos";
  }

  /* La lista de Pedidos muestra solo el día elegido */
  var misPedidosC4 = misPedidos;
  misPedidos = function(){
    var todos = misPedidosC4.apply(this, arguments);
    if(!elegido) return todos;
    return todos.filter(function(r){ return diaDe(r) === elegido; });
  };

  var pintarPedidosC4 = pintarPedidos;
  pintarPedidos = function(){
    pintarPedidosC4.apply(this, arguments);
    pintarCalendarioC4();
  };

  var irC4 = ir;
  ir = function(){
    var r = irC4.apply(this, arguments);
    pintarCalendarioC4();
    return r;
  };

  setTimeout(pintarCalendarioC4, 600);
})();

/* ---------------------------------------------------------------
   C5  Fuera la flecha de volver

   En computadora el menú de la izquierda está siempre a la vista: para
   salir de cualquier pantalla se toca la sección a la que se quiere ir,
   y la flecha de volver no agrega nada. Ocupaba el hueco de arriba a la
   izquierda, justo al lado del botón de plegar el menú, y era fácil
   tocar una queriendo la otra.

   En el celular se queda: ahí no hay menú a la vista y la flecha es la
   única forma de salir de una subpantalla.
   --------------------------------------------------------------- */
(function sinFlechaDeVolverC5(){
  var s = document.createElement("style");
  s.id = "estilos-c5";
  s.textContent = "#btn-volver{display:none!important}";
  document.head.appendChild(s);
})();

/* ---------------------------------------------------------------
   C6  La cuenta, dentro del menú

   El avatar de la esquina abría un panel que se superponía al menú que
   ya está desplegado: dos formas de llegar a lo mismo, y una tapando a
   la otra. En computadora sobra.

   Sus opciones —mi información, cambiar la foto, cerrar sesión— bajan al
   pie del menú de la izquierda, con el nombre y el cargo arriba de
   ellas. Cerrar sesión es lo último de todo y va en rojo: es la única
   acción de esa lista que se lamenta si se toca por error.

   En el celular el avatar se queda: ahí es la ÚNICA puerta al menú, y
   sacarlo dejaría al teléfono sin forma de navegar.
   --------------------------------------------------------------- */
(function cuentaEnElMenuC6(){
  if(typeof pintarLateralV57 !== "function") return;

  var s = document.createElement("style");
  s.id = "estilos-c6";
  s.textContent = [
    "html.equipo-computadora #btn-perfil{display:none!important}",
    "#lateral-v57 .op-lat.salir-c6{color:var(--mal,#b42318)}",
    "#lateral-v57 .op-lat.salir-c6:hover{background:var(--mal-f,#fde8e8)}"
  ].join("");
  document.head.appendChild(s);

  var pintarSinCuenta = pintarLateralV57;
  pintarLateralV57 = function(){
    pintarSinCuenta.apply(this, arguments);
    var nav = document.getElementById("lateral-v57");
    var u = typeof usuarioActual === "function" ? usuarioActual() : null;
    if(!nav || !u || nav.querySelector(".salir-c6")) return;

    var sep = document.createElement("div");
    sep.className = "sep-lat";
    nav.appendChild(sep);

    /* El nombre y el puesto NO se repiten acá: desde la V48 están en la
       barra de arriba, donde se ven desde cualquier pantalla y no solo
       al final del menú. */
    var ops = [
      {ic:"usuario", t:"Mi información", fn:function(){ verPerfil(); }},
      {ic:"salir",   t:"Cerrar sesión", clase:"salir-c6", fn:async function(){
        if(await confirmar("Cerrar sesión", "Volverá a la pantalla de inicio de sesión.", "Cerrar sesión")) salir();
      }}
    ];
    ops.forEach(function(o){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "op-lat " + (o.clase || "");
      b.innerHTML = ico(o.ic, 20) + "<span>" + o.t + "</span>";
      b.addEventListener("click", o.fn);
      nav.appendChild(b);
    });
  };
})();

/* ---------------------------------------------------------------
   C7  Fuera el botón flotante de "Nuevo pedido"

   El pedido ya no se levanta a mano desde una pantalla: se sube la
   planilla. Ese botón flotante llevaba al mismo formulario que el
   "Subir un requerimiento" del menú, tapando además la última fila de
   la lista de pedidos.

   Se quita SOLO el de pedidos. El mismo botón sirve a otras cuatro
   pantallas —nuevo producto, nueva herramienta, nuevo operador, cargar
   el Excel del consolidado— y ahí sigue siendo la única forma de crear.
   Quitarlo entero habría dejado el inventario sin cómo dar de alta nada.

   Y para que nadie quede sin camino: si el cargo puede crear pedidos y
   su menú todavía no tiene una entrada para eso, se le agrega. Le pasa
   al administrador trabajando en modo administración, cuyo menú son las
   tareas de gobierno y ninguna de obra.
   --------------------------------------------------------------- */
(function sinFabDePedidoC7(){
  if(typeof pintarFab !== "function") return;

  /* 1 · el flotante no aparece en Pedidos */
  var pintarFabC7 = pintarFab;
  pintarFab = function(destino){
    var r = pintarFabC7.apply(this, arguments);
    if(destino === "pedidos"){
      var fab = document.getElementById("fab");
      if(fab){ fab.classList.remove("visible"); fab.onclick = null; }
    }
    return r;
  };

  /* 2 · y el menú siempre ofrece por dónde crearlo */
  function sinTildes2(t){
    return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  var pintarLateralC7 = pintarLateralV57;
  pintarLateralV57 = function(){
    pintarLateralC7.apply(this, arguments);
    var nav = document.getElementById("lateral-v57");
    if(!nav || typeof puede !== "function" || !puede("pedidos.crear")) return;
    if(nav.querySelector("[data-nuevo-pedido-c7]")) return;

    /* si ya hay una entrada que abre el requerimiento, no se duplica */
    var yaHay = Array.prototype.some.call(nav.querySelectorAll(".op-lat span"), function(s){
      var t = sinTildes2(s.textContent);
      return t.indexOf("requerimiento") >= 0 || t.indexOf("nuevo pedido") >= 0;
    });
    if(yaHay) return;

    var antesDe = nav.querySelector(".sep-lat") || null;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "op-lat accion";
    b.setAttribute("data-nuevo-pedido-c7", "1");
    b.innerHTML = ico("agregar", 20) + "<span>Nuevo pedido</span>";
    b.addEventListener("click", function(){ abrirRequerimiento(); });
    if(antesDe) nav.insertBefore(b, antesDe);
    else nav.appendChild(b);
  };
})();

/* ---------------------------------------------------------------
   C8  La barra de deslizar, siempre a la vista

   Con un pedido de veintinueve líneas la tabla se estiraba hacia abajo y
   su barra horizontal quedaba al final de todo: para mover las columnas
   de costado había que bajar la pantalla entera hasta el fondo, correr,
   y volver a subir para ver lo que se estaba escribiendo. Con cada fila
   que se agregaba, peor.

   Ahora el cuadro de la tabla tiene su propio alto y sus propias barras:
   las filas se recorren DENTRO del cuadro, y la barra de izquierda a
   derecha se queda pegada a su borde de abajo, a la vista siempre.

   Y la cabecera queda pegada arriba mientras se recorren las filas. En
   una planilla de diez columnas, sin eso, en la fila veinte ya nadie
   sabe si la columna que está llenando es "entrega parcial" o "entrega
   total" — y son justo las dos que no conviene confundir.
   --------------------------------------------------------------- */
(function tablaConAltoPropioC8(){
  var s = document.createElement("style");
  s.id = "estilos-c8";
  s.textContent = [
    /* el cuadro se recorre solo, en los dos sentidos */
    ".tabla-req{max-height:min(58vh,620px);overflow:auto}",

    /* la cabecera se queda arriba mientras bajan las filas */
    ".tabla-req thead th{position:sticky;top:0;z-index:3}",
    /* el N° también se queda al correr de costado: sin él, en una tabla
       ancha se pierde de vista a qué fila pertenece lo que se escribe */
    ".tabla-req td.c-num,.tabla-req th.c-num{position:sticky;left:0;z-index:2;",
      "background:var(--sup)}",
    ".tabla-req th.c-num{z-index:4}",
    /* la esquina de arriba a la izquierda pisa a las dos */
    ".tabla-req thead th.c-num{background:var(--cajon-hondo)}",

    /* barras finas, que no se coman el espacio de la tabla */
    ".tabla-req::-webkit-scrollbar{width:11px;height:11px}",
    ".tabla-req::-webkit-scrollbar-thumb{background:#98a2b3;border-radius:8px;",
      "border:2px solid var(--sup)}",
    ".tabla-req::-webkit-scrollbar-thumb:hover{background:#667085}",
    ".tabla-req::-webkit-scrollbar-track{background:var(--cajon)}"
  ].join("");
  document.head.appendChild(s);
})();
