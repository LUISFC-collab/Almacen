# Proyecto Almacén CPQ · Columbito

Todo el aplicativo, en dos partes.

## Las dos carpetas

### `1 BASE DE DATOS`
Los seis scripts SQL, el archivo que conecta la página con la base, y las **instrucciones
paso a paso** para montarla en Supabase: crear el proyecto, ejecutar los scripts, copiar las
claves, encender el tiempo real y hacerse administrador.

Empiece por su `00_LEEME.md`.

### `2 PAGINA WEB`
La página con sus componentes separados: el HTML por un lado, tres archivos de estilos y dos
de código. Además `componentes.html`, un catálogo donde se ve cada pieza visual —botones,
campos, tablas, marcas de estado— con su clase y para qué sirve.

Empiece por su `00_LEEME.md`.

## Cuál va primero

**La página funciona sola.** Ábrala con doble clic en `2 PAGINA WEB/index.html` y ya sirve:
guarda todo en el navegador de ese equipo. Así puede usarla desde mañana en el almacén.

**La base resuelve lo que la página sola no puede:** que su cuenta creada en la computadora
exista también en el celular, y que el ingreso que registra usted lo vea la Administradora
de Obra al momento. Eso es lo que hoy no ocurre.

Si va a trabajar desde un solo equipo, la página basta. Si va a repartir el enlace a la
obra, monte primero la base.

## Cómo entra usted

Su fotocheck **1352992** está reservado en el código: quien se registre con ese número
recibe el puesto de almacenero **y** el de administrador de la aplicación, con un
interruptor arriba a la izquierda para pasar de uno a otro sin volver a entrar.

Nadie más puede darse de alta como administrador — esa opción no aparece en la lista.

## Lo que la aplicación hace hoy

Levanta requisitos, uno por uno o desde Excel, y los descarga en el formato de la obra.
Recibe mercadería contra la guía, con o sin ella, contando lo que de verdad bajó del camión.
Entrega al frente y presta herramientas, varias a la vez y con foto opcional. Lleva el
inventario armado sobre el consolidado, el kardex de todo lo que entró y salió, y el
consolidado que se puede reemplazar cada día con el archivo del Drive sin perder lo ya
comprado ni lo entregado.

Y reparte todo eso en siete puestos, donde cada uno ve solo lo suyo.
