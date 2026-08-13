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
