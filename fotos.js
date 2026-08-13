/* =====================================================================
   ALMACÉN CPQ · FOTOS                                 V45 · 11-08-2026

   Dos problemas de obra que este archivo resuelve:

   1. El iPhone guarda las fotos en HEIC. Ningún navegador de Android las
      abre, y varios de iPhone tampoco cuando llegan desde la galería. La
      foto entraba, el `<img>` no la podía leer y quedaba un registro con
      una foto rota. Ahora se convierte a JPG antes de tocarla, y si el
      formato no se reconoce de entrada se intenta la conversión igual —
      no se descarta nada sin haberlo intentado.

   2. Al pedir una foto, el celular abría directo la cámara o directo la
      galería según el equipo, sin dejar elegir. Si el material ya estaba
      fotografiado, había que salir y volver a entrar. Ahora pregunta.

   Va después del index.html y no le toca una sola línea: envuelve
   `comprimir` y se cuelga del clic en fase de captura.
   ===================================================================== */
(function fotosV45(){
  "use strict";

  /* ---------------------------------------------------------------
     FORMATOS — que entre lo que sea que traiga el celular
     --------------------------------------------------------------- */

  /* Los inputs de foto declaran qué aceptan. Sin nombrar heic/heif,
     el selector de archivos de varios Android los muestra en gris. */
  function ampliarAcepta(){
    ["so-foto","mp-foto","mr-ifoto","mr-foto","mt-foto1","mt-foto2","mu-foto",
     "mo-foto","in-foto","sa-foto1","oc-foto","gu-foto"].forEach(function(id){
      var inp = document.getElementById(id);
      if(inp) inp.setAttribute("accept", "image/*,.heic,.heif,.HEIC,.HEIF");
    });
  }

  function sePuedeLeer(archivo){
    /* createImageBitmap dice en un paso si el navegador entiende el
       formato, sin tener que armar un data URL de varios MB. */
    if(!window.createImageBitmap) return Promise.resolve(true);
    return createImageBitmap(archivo).then(function(b){
      if(b.close) b.close();
      return true;
    }).catch(function(){ return false; });
  }

  async function aFormatoConocido(archivo){
    var nombre = String(archivo.name || "").toLowerCase();
    var esHeic = /heic|heif/.test(archivo.type || "") || /\.(heic|heif)$/.test(nombre);

    if(!esHeic && await sePuedeLeer(archivo)) return archivo;

    if(typeof window.heic2any !== "function"){
      /* Sin el conversor no se puede hacer nada, pero se avisa con el
         motivo real en vez de un "no se pudo leer la imagen" a secas. */
      throw new Error("Esta foto está en un formato que el navegador no abre (HEIC de iPhone). " +
                      "Vuelva a intentar con la app abierta y con señal.");
    }

    var blob = await heic2any({blob:archivo, toType:"image/jpeg", quality:0.92});
    if(Array.isArray(blob)) blob = blob[0];
    var base = nombre.replace(/\.[^.]+$/, "") || "foto";
    try{
      return new File([blob], base + ".jpg", {type:"image/jpeg"});
    }catch(e){
      blob.name = base + ".jpg";   /* navegadores viejos sin constructor File */
      return blob;
    }
  }

  if(typeof window.comprimir === "function"){
    var comprimirV45 = window.comprimir;
    window.comprimir = async function(archivo, maxLado, calidad){
      return comprimirV45(await aFormatoConocido(archivo), maxLado, calidad);
    };
  }

  /* ---------------------------------------------------------------
     DE DÓNDE SALE LA FOTO — cámara o galería, que lo diga quien la toma
     --------------------------------------------------------------- */

  var estilos = document.createElement("style");
  estilos.textContent =
    ".hoja-foto{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;" +
      "justify-content:center;background:rgba(16,24,40,.45)}" +
    ".hoja-foto .caja{background:var(--sup,#fff);width:100%;max-width:480px;border-radius:16px 16px 0 0;" +
      "padding:8px;box-shadow:0 -8px 32px rgba(16,24,40,.2);animation:hojaSube .18s ease-out}" +
    "@keyframes hojaSube{from{transform:translateY(100%)}to{transform:translateY(0)}}" +
    ".hoja-foto .tit{font-size:13px;opacity:.7;padding:10px 12px 6px}" +
    ".hoja-foto button{display:flex;align-items:center;gap:12px;width:100%;border:0;background:transparent;" +
      "padding:15px 12px;font:inherit;font-size:15px;text-align:left;color:inherit;cursor:pointer;border-radius:10px}" +
    ".hoja-foto button:active{background:rgba(16,24,40,.07)}" +
    ".hoja-foto .ic{font-size:20px;width:26px;text-align:center}" +
    ".hoja-foto .sep{height:1px;background:rgba(16,24,40,.1);margin:2px 12px}" +
    ".hoja-foto .cancelar{justify-content:center;opacity:.65;margin-top:2px}" +
    "@media(min-width:600px){.hoja-foto{align-items:center}.hoja-foto .caja{border-radius:16px}}";
  document.head.appendChild(estilos);

  function abrirHoja(input, esArchivo){
    var capa = document.createElement("div");
    capa.className = "hoja-foto";

    function elegir(conCamara){
      cerrar();
      /* `capture` es lo que decide si el celular abre la cámara o el
         explorador de archivos. Se pone y se saca en cada uso: si queda
         puesto, la próxima vez ya no deja elegir. */
      if(conCamara) input.setAttribute("capture", "environment");
      else input.removeAttribute("capture");
      input.click();
    }
    function cerrar(){
      capa.remove();
      document.removeEventListener("keydown", alEscape);
    }
    function alEscape(e){ if(e.key === "Escape") cerrar(); }

    var caja = document.createElement("div");
    caja.className = "caja";

    if(esArchivo){
      caja.innerHTML =
        '<div class="tit">Adjuntar documento</div>' +
        '<button data-op="galeria"><span class="ic">\u{1F4C1}</span>Buscar en el celular</button>' +
        '<div class="sep"></div>' +
        '<button class="cancelar" data-op="no">Cancelar</button>';
    }else{
      caja.innerHTML =
        '<div class="tit">Agregar foto</div>' +
        '<button data-op="camara"><span class="ic">\u{1F4F7}</span>Tomar una foto ahora</button>' +
        '<button data-op="galeria"><span class="ic">\u{1F5BC}</span>Elegir del celular</button>' +
        '<div class="sep"></div>' +
        '<button class="cancelar" data-op="no">Cancelar</button>';
    }

    caja.addEventListener("click", function(e){
      var b = e.target.closest("button");
      if(!b) return;
      if(b.dataset.op === "camara")  return elegir(true);
      if(b.dataset.op === "galeria") return elegir(false);
      cerrar();
    });
    capa.addEventListener("click", function(e){ if(e.target === capa) cerrar(); });
    document.addEventListener("keydown", alEscape);

    capa.appendChild(caja);
    document.body.appendChild(capa);
  }

  /* En fase de captura: corta el clic antes de que lo agarre el handler
     del index.html, que abría el input a ciegas. */
  document.addEventListener("click", function(e){
    var b = e.target.closest && e.target.closest("[data-foto],[data-archivo]");
    if(!b) return;
    var id = b.dataset.foto || b.dataset.archivo;
    var input = document.getElementById(id);
    if(!input) return;
    e.preventDefault();
    e.stopPropagation();
    abrirHoja(input, !!b.dataset.archivo);
  }, true);

  if(document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ampliarAcepta);
  else
    ampliarAcepta();
  /* Los modales arman inputs cuando se abren: se repasa cada tanto. */
  setInterval(ampliarAcepta, 4000);
})();
