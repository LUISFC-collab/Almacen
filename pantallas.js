/* =====================================================================
   ALMACEN CPQ · El marcado de las pantallas

   Las pantallas y los modales son los mismos en computadora y en celular
   —cambia como se acomodan, no que hay— asi que viven aca una sola vez.
   Copiados en los dos HTML, agregar un campo obligaria a acordarse de los
   dos, y tarde o temprano no se acuerda nadie.

   Se inserta durante el parseo, en el lugar de este <script>, para que el
   motor lo encuentre ya puesto: app.js engancha botones apenas se lee.
   ===================================================================== */
(function marcadoDePantallas(){
  var donde = document.currentScript;
  var html = `


<div class="app">

  <header class="appbar oculto" id="appbar">
    <button class="icon-btn oculto" id="btn-volver" aria-label="Volver"></button>
    <div class="tit"><b id="titulo">Inicio</b><small id="subtitulo"></small></div>
    <button class="btn-modo oculto" id="btn-modo">Cambiar modo</button>
    <button class="avatar" id="btn-perfil" aria-label="Perfil y menú"><span id="avatar-txt">··</span><span class="punto" id="badge"></span></button>
  </header>

  <main>

    <!-- ============ LOGIN ============ -->
    <section class="pantalla activa" id="scr-login">
      <div style="text-align:center;margin:26px 0 24px">
        <div style="width:82px;height:82px;border-radius:26px;background:var(--pri);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:var(--s2)" id="logo-app"></div>
        <h1 style="margin:0;font-size:24px;color:var(--pri);letter-spacing:-.02em">Almacén Minero</h1>
        <p style="margin:5px 0 0;color:var(--tinta-sec);font-size:13.5px">Gestión de requerimientos, materiales y herramientas</p>
      </div>

      <div class="card">
        <div class="campo">
          <label for="lg-usuario">Usuario</label>
          <input type="text" id="lg-usuario" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="usuario">
        </div>
        <div class="campo">
          <label for="lg-clave">Contraseña</label>
          <input type="password" id="lg-clave" autocomplete="current-password" placeholder="••••••••">
        </div>
        <button class="btn btn-pri" id="lg-entrar">Iniciar sesión</button>
        <div class="ayuda err" id="lg-error" style="margin:10px 0 0;text-align:center;min-height:16px"></div>
      </div>

      <button class="btn btn-txt" id="lg-solicitar">Solicitar acceso</button>
    </section>

    <!-- ============ SOLICITUD DE ACCESO ============ -->
    <section class="pantalla" id="scr-solicitud">
      <div class="card acento" style="font-size:13px">
        Complete sus datos. El administrador revisará la solicitud y le habilitará el ingreso.
      </div>
      <div class="card">
        <div class="campo"><label>Nombre completo</label><input type="text" id="so-nombre" placeholder="Nombres y apellidos"></div>
        <div class="dos">
          <div class="campo"><label>DNI</label><input type="text" id="so-dni" inputmode="numeric" maxlength="8" placeholder="00000000"></div>
          <div class="campo"><label>Celular</label><input type="tel" id="so-celular" inputmode="tel" placeholder="999 999 999"></div>
        </div>
        <div class="campo"><label>Correo electrónico</label><input type="email" id="so-correo" autocapitalize="none" spellcheck="false" placeholder="nombre@empresa.com"></div>
        <div class="campo">
          <label>Área</label>
          <select id="so-area-tipo">
            <option value="">— Seleccione el área —</option>
            <option value="administrativa">Área Administrativa</option>
            <option value="supervision">Área de Supervisión</option>
          </select>
        </div>
        <div class="campo oculto" id="so-campo-cargo">
          <label>Cargo</label>
          <select id="so-cargo-sel"></select>
        </div>
        <div class="campo"><label>Usuario solicitado</label><input type="text" id="so-usuario" autocapitalize="none" spellcheck="false" placeholder="nombre.apellido"></div>
        <div class="dos">
          <div class="campo"><label>Contraseña</label><input type="password" id="so-clave" placeholder="mínimo 6 caracteres"></div>
          <div class="campo"><label>Confirmar</label><input type="password" id="so-clave2" placeholder="repita la contraseña"></div>
        </div>
        <div class="campo">
          <label>Foto de perfil (opcional)</label>
          <button class="foto-btn" data-foto="so-foto"><span id="so-foto-ico"></span>Tomar foto</button>
          <input type="file" id="so-foto" accept="image/*" capture="user" hidden>
          <div class="prev" id="so-foto-prev"></div>
        </div>
        <div class="btns">
          <button class="btn btn-cont" id="so-cancelar">Cancelar</button>
          <button class="btn btn-pri" id="so-enviar">Enviar solicitud</button>
        </div>
      </div>
    </section>

    <!-- ============ INICIO ============ -->
    <section class="pantalla" id="scr-inicio">
      <div class="card" id="ini-saludo"></div>
      <div class="metricas" id="ini-metricas"></div>
      <div class="sech">Accesos rápidos</div>
      <div class="metricas" id="ini-accesos"></div>
      <div class="sech">Actividad reciente</div>
      <div id="ini-actividad"></div>
    </section>

    <!-- ============ PEDIDOS ============ -->
    <section class="pantalla" id="scr-pedidos">
      <div class="filtros" id="pe-filtros"></div>
      <div class="filtros oculto" id="pe-areas"></div>
      <div id="pe-lista"></div>
    </section>

    <!-- ============ INVENTARIO ============ -->
    <section class="pantalla" id="scr-inventario">
      <div class="campo"><input type="search" id="iv-buscar" placeholder="Buscar por nombre o código"></div>
      <div class="filtros" id="iv-filtros">
        <button class="on" data-est="">Todos</button>
        <button data-est="disponible">Disponible</button>
        <button data-est="bajo">Bajo stock</button>
        <button data-est="agotado">Agotado</button>
      </div>
      <div id="iv-lista"></div>
    </section>

    <!-- ============ CONSOLIDADO ============ -->
    <section class="pantalla" id="scr-consolidado">
      <div id="co-carga"></div>
      <div class="campo"><input type="search" id="co-buscar" placeholder="Buscar material del consolidado"></div>
      <div class="filtros" id="co-filtros">
        <button class="on" data-f="">Todos</button>
        <button data-f="pendiente">Por comprar</button>
        <button data-f="comprado">Comprados</button>
        <button data-f="entregado">Entregados</button>
      </div>
      <div id="co-lista"></div>
      <div id="co-resumen"></div>
    </section>

    <!-- ============ HERRAMIENTAS ============ -->
    <section class="pantalla" id="scr-herramientas">
      <div class="seg" data-seg="herramientas">
        <button class="on" data-pan="hInventario">Inventario</button>
        <button data-pan="hPrestamos">Préstamos</button>
      </div>
      <div id="pan-hInventario"><div id="he-lista"></div></div>
      <div class="oculto" id="pan-hPrestamos"><div id="he-prestamos"></div></div>
    </section>

    <!-- ============ COMPRAS ============ -->
    <section class="pantalla" id="scr-compras">
      <div class="seg" data-seg="compras">
        <button class="on" data-pan="cPendientes">Por atender</button>
        <button data-pan="cOrden">Orden</button>
        <button data-pan="cGuia">Guía / ingreso</button>
      </div>
      <div id="pan-cPendientes"><div id="cp-lista"></div></div>

      <div class="card oculto" id="pan-cOrden">
        <div class="campo"><label>Requerimiento aprobado</label><select id="oc-req"></select></div>
        <div class="dos">
          <div class="campo"><label>N° orden de compra</label><input type="text" id="oc-numero" placeholder="OC-2026-045"></div>
          <div class="campo"><label>Monto (S/)</label><input type="number" id="oc-monto" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        </div>
        <div class="campo"><label>Proveedor</label><input type="text" id="oc-proveedor" placeholder="Ferretería Andina SAC"></div>
        <div class="campo"><label>Entrega prometida</label><input type="date" id="oc-entrega"></div>
        <div class="campo">
          <label>Foto de la orden</label>
          <button class="foto-btn" data-foto="oc-foto"><span id="oc-foto-ico"></span>Tomar foto</button>
          <input type="file" id="oc-foto" accept="image/*" capture="environment" hidden>
          <div class="prev" id="oc-foto-prev"></div>
        </div>
        <button class="btn btn-pri" id="oc-guardar">Registrar orden de compra</button>
      </div>

      <div class="card oculto" id="pan-cGuia">
        <div class="campo"><label>Requerimiento en compra</label><select id="gu-req"></select></div>
        <div class="dos">
          <div class="campo"><label>N° guía de remisión</label><input type="text" id="gu-numero" placeholder="T001-00234"></div>
          <div class="campo"><label>Transportista</label><input type="text" id="gu-transporte" placeholder="Transportes Sur"></div>
        </div>
        <div class="campo">
          <label>Guía de remisión en PDF</label>
          <button class="foto-btn" data-archivo="gu-pdf"><span id="gu-pdf-ico"></span>Adjuntar PDF</button>
          <input type="file" id="gu-pdf" accept="application/pdf" hidden>
          <div class="prev" id="gu-pdf-prev"></div>
        </div>
        <div class="campo">
          <label>Foto del despacho</label>
          <button class="foto-btn" data-foto="gu-foto"><span id="gu-foto-ico"></span>Tomar foto</button>
          <input type="file" id="gu-foto" accept="image/*" capture="environment" hidden>
          <div class="prev" id="gu-foto-prev"></div>
        </div>
        <label style="display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--tinta);margin-bottom:14px">
          <input type="checkbox" id="gu-inventario" checked style="width:20px;height:20px;flex:none">
          Registrar ingreso y actualizar inventario
        </label>
        <button class="btn btn-pri" id="gu-guardar">Registrar guía e ingreso</button>
      </div>
    </section>

    <!-- ============ MOVIMIENTOS ============ -->
    <section class="pantalla" id="scr-movimientos">
      <div class="seg" data-seg="movimientos">
        <button class="on" data-pan="mSalida">Salida</button>
        <button data-pan="mIngreso">Ingreso</button>
        <button data-pan="mKardex">Kardex</button>
      </div>

      <div class="card" id="pan-mSalida">
        <div class="campo"><label>Material</label><select id="sa-material"></select></div>
        <div class="dos">
          <div class="campo"><label>Cantidad</label><input type="number" id="sa-cantidad" min="0.01" step="0.01" inputmode="decimal" placeholder="0"></div>
          <div class="campo"><label>Área destino</label><input type="text" id="sa-area" placeholder="Mantenimiento"></div>
        </div>
        <div class="campo"><label>Entregado a</label><select id="sa-persona"></select></div>
        <div class="campo">
          <label>Foto del responsable</label>
          <button class="foto-btn" data-foto="sa-foto1"><span id="sa-foto1-ico"></span>Tomar foto</button>
          <input type="file" id="sa-foto1" accept="image/*" capture="user" hidden>
          <div class="prev" id="sa-foto1-prev"></div>
        </div>
        <div class="campo"><label>Observaciones</label><textarea id="sa-obs" placeholder="Motivo, orden de trabajo…"></textarea></div>
        <button class="btn btn-pri" id="sa-guardar">Registrar salida</button>
      </div>

      <div class="card oculto" id="pan-mIngreso">
        <div class="campo"><label>Material</label><select id="in-material"></select></div>
        <div class="dos">
          <div class="campo"><label>Cantidad</label><input type="number" id="in-cantidad" min="0.01" step="0.01" inputmode="decimal" placeholder="0"></div>
          <div class="campo"><label>Guía / factura</label><input type="text" id="in-documento" placeholder="F001-01234"></div>
        </div>
        <div class="campo"><label>Proveedor</label><input type="text" id="in-proveedor" placeholder="Ferretería Andina"></div>
        <div class="campo">
          <label>Foto de la guía o el material</label>
          <button class="foto-btn" data-foto="in-foto"><span id="in-foto-ico"></span>Tomar foto</button>
          <input type="file" id="in-foto" accept="image/*" capture="environment" hidden>
          <div class="prev" id="in-foto-prev"></div>
        </div>
        <div class="campo"><label>Observaciones</label><textarea id="in-obs" placeholder="Estado del material…"></textarea></div>
        <button class="btn btn-pri" id="in-guardar">Registrar ingreso</button>
      </div>

      <div class="oculto" id="pan-mKardex">
        <div class="campo"><input type="search" id="kx-texto" placeholder="Buscar en el kardex"></div>
        <div class="filtros" id="kx-filtros">
          <button class="on" data-tipo="">Todos</button>
          <button data-tipo="ingreso">Ingresos</button>
          <button data-tipo="salida">Salidas</button>
          <button data-tipo="prestamo">Préstamos</button>
          <button data-tipo="devolucion">Devoluciones</button>
        </div>
        <div id="kx-lista"></div>
        <button class="btn btn-cont" id="kx-csv" style="margin-top:12px">Exportar kardex</button>
      </div>
    </section>

    <!-- ============ NOTIFICACIONES ============ -->
    <section class="pantalla" id="scr-notificaciones">
      <div id="no-lista"></div>
    </section>

    <!-- ============ HISTORIAL ============ -->
    <section class="pantalla" id="scr-historial">
      <div class="campo"><input type="search" id="hi-buscar" placeholder="Buscar en el historial"></div>
      <div class="filtros" id="hi-filtros"></div>
      <div id="hi-lista"></div>
    </section>

    <!-- ============ INDICADORES ============ -->
    <section class="pantalla" id="scr-indicadores">
      <div class="metricas" id="kpi-metricas"></div>
      <div class="sech">Requerimientos por estado</div>
      <div class="card" id="kpi-estados"></div>
      <div class="sech">Tiempos de atención</div>
      <div class="card" id="kpi-tiempos"></div>
      <div class="sech">Movimientos de los últimos 7 días</div>
      <div class="card"><div class="dias" id="kpi-dias"></div></div>
      <div class="sech">Materiales críticos</div>
      <div id="kpi-bajo"></div>
    </section>

    <!-- ============ REPORTES ============ -->
    <section class="pantalla" id="scr-reportes">
      <div class="card">
        <div class="dos">
          <div class="campo"><label>Fecha</label><input type="date" id="rp-fecha"></div>
          <div class="campo"><label>Dirigido a</label><input type="text" id="rp-para" placeholder="Administración, Logística, Gerencia"></div>
        </div>
        <button class="btn btn-ton" id="rp-generar">Ver resumen del día</button>
      </div>
      <div class="card">
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">Enviar el reporte del día</div>
        <p class="ayuda" style="margin:0 0 12px">Incluye movimientos, requerimientos, consolidado, stock crítico y herramientas prestadas.</p>
        <div class="btns">
          <button class="btn btn-sec" id="rp-excel">Excel del día</button>
          <button class="btn btn-cont" id="rp-compartir">Compartir</button>
        </div>
        <button class="btn btn-txt" id="rp-texto" style="margin-top:8px">Versión en texto</button>
      </div>
      <div id="rp-salida"></div>
    </section>

    <!-- ============ PERSONAL ============ -->
    <section class="pantalla" id="scr-personal">
      <div id="pr-lista"></div>
    </section>

    <!-- ============ PANEL ADMINISTRADOR ============ -->
    <section class="pantalla" id="scr-admin">
      <div class="seg" data-seg="admin">
        <button class="on" data-pan="aSolicitudes">Solicitudes</button>
        <button data-pan="aUsuarios">Usuarios</button>
        <button data-pan="aActividad">Actividad</button>
      </div>
      <div id="pan-aSolicitudes"><div id="ad-solicitudes"></div></div>
      <div class="oculto" id="pan-aUsuarios">
        <button class="btn btn-ton" id="ad-nuevo" style="margin-bottom:12px">Crear usuario</button>
        <div id="ad-usuarios"></div>
      </div>
      <div class="oculto" id="pan-aActividad"><div id="ad-actividad"></div></div>
    </section>

    <!-- ============ MÁS ============ -->
    <section class="pantalla" id="scr-mas">
      <div class="sech">Módulos</div>
      <div id="mas-modulos"></div>
      <div class="sech">Datos</div>
      <div id="mas-datos"></div>
      <div class="sech">Aplicación</div>
      <div id="mas-app"></div>
    </section>

  </main>

  <button class="fab" id="fab"><span id="fab-ico"></span><span id="fab-txt">Nuevo</span></button>
</div>

<!-- ================= DRAWER ================= -->
<div class="velo" id="velo"></div>
<aside class="drawer" id="drawer">
  <div class="cabe">
    <div class="foto" id="dr-foto"></div>
    <b id="dr-nombre">—</b>
    <small id="dr-rol">—</small>
    <button class="btn btn-mini" id="dr-cambiar-foto" style="background:rgba(255,255,255,.18);color:#fff;margin-top:10px">Cambiar foto</button>
    <input type="file" id="pf-foto" accept="image/*" capture="user" hidden>
  </div>
  <div class="lista" id="dr-lista"></div>
</aside>

<!-- ================= MODALES ================= -->
<div class="modal" id="modal-producto">
  <div class="barra-modal">
    <button class="btn-txt" data-cerrar-modal="modal-producto">Cancelar</button>
    <b id="mp-titulo">Nuevo producto</b>
    <button class="btn-txt reg" id="mp-registrar">Registrar</button>
  </div>
  <div class="cuerpo">
    <div class="campo">
      <label>Tipo</label>
      <select id="mp-tipo"><option value="material">Material / consumible</option><option value="herramienta">Herramienta o equipo</option></select>
    </div>
    <div class="campo"><label>Nombre</label><input type="text" id="mp-nombre" placeholder="Guantes de badana"></div>
    <div class="dos">
      <div class="campo"><label>Código</label><input type="text" id="mp-codigo" disabled></div>
      <div class="campo"><label>Categoría</label><input type="text" id="mp-categoria" placeholder="EPP, ferretería…"></div>
    </div>
    <div class="dos">
      <div class="campo"><label>Cantidad inicial</label><input type="number" id="mp-cantidad" min="0" step="0.01" inputmode="decimal" placeholder="0"></div>
      <div class="campo"><label>Unidad</label><input type="text" id="mp-unidad" placeholder="und"></div>
    </div>
    <div class="campo" id="mp-solo-material"><label>Stock mínimo</label><input type="number" id="mp-minimo" min="0" step="0.01" inputmode="decimal" value="5"></div>
    <div id="mp-solo-herramienta" class="oculto">
      <div class="dos">
        <div class="campo"><label>Marca</label><input type="text" id="mp-marca" placeholder="Stanley"></div>
        <div class="campo"><label>Modelo</label><input type="text" id="mp-modelo" placeholder="STHT0-62"></div>
      </div>
      <div class="campo"><label>N° de serie</label><input type="text" id="mp-serie" placeholder="SN-000123"></div>
    </div>
    <div class="campo"><label>Observaciones</label><textarea id="mp-obs" placeholder="Detalles, ubicación, estado"></textarea></div>
    <div class="campo">
      <label>Foto del artículo</label>
      <button class="foto-btn" data-foto="mp-foto"><span id="mp-foto-ico"></span>Tomar foto</button>
      <input type="file" id="mp-foto" accept="image/*" capture="environment" hidden>
      <div class="prev" id="mp-foto-prev"></div>
    </div>
  </div>
  <div class="pie-modal">
    <button class="btn btn-cont" data-cerrar-modal="modal-producto">Cancelar</button>
    <button class="btn btn-pri" id="mp-registrar2">Registrar</button>
  </div>
</div>

<div class="modal" id="modal-requerimiento">
  <div class="barra-modal">
    <button class="btn-txt" data-cerrar-modal="modal-requerimiento">Cancelar</button>
    <b>Nuevo requerimiento</b>
    <button class="btn-txt reg" id="mr-registrar">Registrar</button>
  </div>
  <div class="cuerpo">
    <div class="card acento" style="display:flex;align-items:center;gap:11px;padding:12px">
      <span id="mr-quien-ico"></span>
      <div style="min-width:0">
        <div style="font-size:11.5px;color:var(--tinta-sec);font-weight:600">SOLICITA</div>
        <b id="mr-quien" style="font-size:14px"></b>
      </div>
    </div>

    <div class="card oculto" id="mr-excel" style="background:var(--sup-var)">
      <div style="font-weight:600;font-size:14.5px">Cargar el pedido desde Excel</div>
      <p class="ayuda" style="margin:5px 0 11px">
        Descargue la plantilla, llénela con su requerimiento diario y súbala. Acepta .xlsx y .csv.
      </p>
      <div class="btns">
        <button class="btn btn-cont" id="mr-plantilla">Plantilla</button>
        <button class="btn btn-ton" id="mr-subir">Subir archivo</button>
      </div>
      <input type="file" id="mr-archivo" accept=".xlsx,.csv" hidden>
      <div class="ayuda" id="mr-importe" style="margin:9px 0 0"></div>
    </div>

    <div class="dos">
      <div class="campo"><label>Obra</label><input type="text" id="mr-obra" placeholder="Nombre de la obra"></div>
      <div class="campo"><label>Área / disciplina</label><input type="text" id="mr-area" placeholder="Civil, Eléctrico…"></div>
    </div>
    <div class="dos">
      <div class="campo">
        <label>Prioridad</label>
        <select id="mr-prioridad"><option>Normal</option><option>Alta</option><option>Urgente</option></select>
      </div>
      <div class="campo"><label>Necesario para</label><input type="date" id="mr-necesario"></div>
    </div>

    <div class="sech" style="margin-top:6px">Materiales solicitados</div>
    <div class="card plano">
      <div class="campo"><label>Material</label><input type="text" id="mr-desc" placeholder="Rodamiento 6205"></div>
      <div class="dos">
        <div class="campo"><label>Cantidad</label><input type="number" id="mr-cant" min="0.01" step="0.01" inputmode="decimal" placeholder="1"></div>
        <div class="campo"><label>Unidad</label><input type="text" id="mr-unidad" placeholder="und"></div>
      </div>
      <div class="campo"><label>Observaciones del ítem</label><input type="text" id="mr-iobs" placeholder="Marca, medida, referencia"></div>
      <div class="campo">
        <label>Foto del ítem</label>
        <button class="foto-btn" data-foto="mr-ifoto"><span id="mr-ifoto-ico"></span>Tomar foto</button>
        <input type="file" id="mr-ifoto" accept="image/*" capture="environment" hidden>
        <div class="prev" id="mr-ifoto-prev"></div>
      </div>
      <button class="btn btn-ton" id="mr-agregar">Agregar material</button>
    </div>
    <div id="mr-items"></div>

    <div class="sech">Adjuntos del requerimiento</div>
    <div class="campo">
      <label>Foto general</label>
      <button class="foto-btn" data-foto="mr-foto"><span id="mr-foto-ico"></span>Tomar foto</button>
      <input type="file" id="mr-foto" accept="image/*" capture="environment" hidden>
      <div class="prev" id="mr-foto-prev"></div>
    </div>
    <div class="campo">
      <label>Guía de remisión (PDF)</label>
      <button class="foto-btn" data-archivo="mr-pdf"><span id="mr-pdf-ico"></span>Adjuntar PDF</button>
      <input type="file" id="mr-pdf" accept="application/pdf" hidden>
      <div class="prev" id="mr-pdf-prev"></div>
    </div>
    <div class="campo"><label>Justificación</label><textarea id="mr-obs" placeholder="Motivo del requerimiento"></textarea></div>
  </div>
  <div class="pie-modal">
    <button class="btn btn-cont" data-cerrar-modal="modal-requerimiento">Cancelar</button>
    <button class="btn btn-pri" id="mr-registrar2">Registrar</button>
  </div>
</div>

<div class="modal" id="modal-prestamo">
  <div class="barra-modal">
    <button class="btn-txt" data-cerrar-modal="modal-prestamo">Cancelar</button>
    <b id="mt-titulo">Préstamo de herramienta</b>
    <button class="btn-txt reg" id="mt-registrar">Registrar</button>
  </div>
  <div class="cuerpo">
    <div class="campo"><label>Herramienta</label><select id="mt-herramienta"></select></div>
    <div class="campo"><label>Responsable</label><select id="mt-persona"></select></div>
    <div class="dos">
      <div class="campo"><label>Fecha de salida</label><input type="date" id="mt-salida"></div>
      <div class="campo"><label>Devolución prevista</label><input type="date" id="mt-devolucion"></div>
    </div>
    <div class="campo">
      <label>Foto del responsable recibiendo</label>
      <button class="foto-btn" data-foto="mt-foto1"><span id="mt-foto1-ico"></span>Tomar foto</button>
      <input type="file" id="mt-foto1" accept="image/*" capture="user" hidden>
      <div class="prev" id="mt-foto1-prev"></div>
    </div>
    <div class="campo">
      <label>Foto de la herramienta</label>
      <button class="foto-btn" data-foto="mt-foto2"><span id="mt-foto2-ico"></span>Tomar foto</button>
      <input type="file" id="mt-foto2" accept="image/*" capture="environment" hidden>
      <div class="prev" id="mt-foto2-prev"></div>
    </div>
    <div class="campo"><label>Observaciones</label><textarea id="mt-obs" placeholder="Estado de entrega, turno"></textarea></div>
  </div>
  <div class="pie-modal">
    <button class="btn btn-cont" data-cerrar-modal="modal-prestamo">Cancelar</button>
    <button class="btn btn-pri" id="mt-registrar2">Registrar</button>
  </div>
</div>

<div class="modal" id="modal-usuario">
  <div class="barra-modal">
    <button class="btn-txt" data-cerrar-modal="modal-usuario">Cancelar</button>
    <b id="mu-titulo">Nuevo usuario</b>
    <button class="btn-txt reg" id="mu-registrar">Registrar</button>
  </div>
  <div class="cuerpo">
    <input type="hidden" id="mu-id">
    <div class="campo"><label>Nombre completo</label><input type="text" id="mu-nombre" placeholder="Nombres y apellidos"></div>
    <div class="dos">
      <div class="campo"><label>Cargo</label><input type="text" id="mu-cargo" placeholder="Ej. Asistente de logística"></div>
      <div class="campo"><label>Área / disciplina</label><input type="text" id="mu-area" placeholder="Civil, Eléctrico…"></div>
    </div>
    <div class="campo"><label>Usuario</label><input type="text" id="mu-usuario" autocapitalize="none" spellcheck="false" placeholder="nombre.apellido"></div>
    <div class="campo"><label>Contraseña</label><input type="text" id="mu-clave" placeholder="mínimo 6 caracteres"></div>
    <div class="ayuda" id="mu-ayuda-clave">Al editar, deje la contraseña vacía para conservar la actual.</div>
    <div class="campo"><label>Rol</label><select id="mu-rol"></select></div>
    <div class="campo" id="mu-permisos" style="font-size:12.5px;color:var(--tinta-sec)"></div>
    <div class="campo">
      <label>Foto de perfil</label>
      <button class="foto-btn" data-foto="mu-foto"><span id="mu-foto-ico"></span>Tomar foto</button>
      <input type="file" id="mu-foto" accept="image/*" capture="user" hidden>
      <div class="prev" id="mu-foto-prev"></div>
    </div>
  </div>
  <div class="pie-modal">
    <button class="btn btn-cont" data-cerrar-modal="modal-usuario">Cancelar</button>
    <button class="btn btn-pri" id="mu-registrar2">Registrar</button>
  </div>
</div>

<div class="modal" id="modal-personal">
  <div class="barra-modal">
    <button class="btn-txt" data-cerrar-modal="modal-personal">Cancelar</button>
    <b>Registrar operador</b>
    <button class="btn-txt reg" id="mo-registrar">Registrar</button>
  </div>
  <div class="cuerpo">
    <input type="hidden" id="mo-id">
    <div class="campo"><label>Nombre completo</label><input type="text" id="mo-nombre" placeholder="Juan Quispe Mamani"></div>
    <div class="dos">
      <div class="campo"><label>DNI</label><input type="text" id="mo-dni" inputmode="numeric" maxlength="8" placeholder="00000000"></div>
      <div class="campo"><label>Área</label><input type="text" id="mo-area" placeholder="Mina"></div>
    </div>
    <div class="campo"><label>Cargo</label><input type="text" id="mo-cargo" placeholder="Operador de equipo"></div>
    <div class="campo">
      <label>Foto</label>
      <button class="foto-btn" data-foto="mo-foto"><span id="mo-foto-ico"></span>Tomar foto</button>
      <input type="file" id="mo-foto" accept="image/*" capture="user" hidden>
      <div class="prev" id="mo-foto-prev"></div>
    </div>
  </div>
  <div class="pie-modal">
    <button class="btn btn-cont" data-cerrar-modal="modal-personal">Cancelar</button>
    <button class="btn btn-pri" id="mo-registrar2">Registrar</button>
  </div>
</div>

<div class="hoja" id="hoja">
  <div class="panel">
    <div class="agarre"></div>
    <div class="cab" id="hoja-cab"></div>
    <div class="cuerpo" id="hoja-cuerpo"></div>
    <div class="pie" id="hoja-pie"></div>
  </div>
</div>

<div class="snack" id="snack"></div>
<input type="file" id="co-archivo" accept=".xlsx,.csv" hidden>

`;
  donde.insertAdjacentHTML("beforebegin", html);
})();
