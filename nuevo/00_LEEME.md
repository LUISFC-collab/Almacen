# La página · Almacén CPQ

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `index.html` | La página. Es la que se abre. |
| `componentes.html` | El catálogo visual: cada pieza con su clase y para qué sirve |
| `estilos/1-base.css` | Colores, letra y fondo |
| `estilos/2-panel-izquierdo.css` | El riel con el puesto y sus tareas |
| `estilos/3-componentes.css` | Tarjetas, botones, campos, tablas, marcas y portada |
| `scripts/1-nucleo.js` | Datos, acceso, unidades, Excel y el puente consolidado–inventario |
| `scripts/2-pantallas.js` | Una función por pantalla |

## Cómo abrirla

Doble clic en `index.html`. No necesita servidor ni internet.

Para ponerla online, arrastre **esta carpeta completa** a **app.netlify.com/drop**.

## El orden importa

Los dos archivos de `scripts/` **comparten variables**, por eso no van envueltos en una
función. `1-nucleo.js` va primero y `2-pantallas.js` después — el segundo arranca la
aplicación en su última línea. Si los invierte, no arranca.

Los tres CSS se cargan en orden porque el último pisa al anterior donde haga falta.

## Los colores

Viven como variables en `1-base.css`. Cambiarlos es tocar un solo sitio.

Están declarados **tres veces**: el juego claro, el oscuro para quien tenga el celular en
modo noche, y el oscuro forzado. Si un color se declarara solo dentro del bloque oscuro,
en modo claro no existiría y se vería el texto de un tema sobre el fondo del otro.

Sobre el amarillo la tinta va oscura. El blanco sobre amarillo no se lee con el celular
al sol, que es como se usa esto.

## Las medidas de toque

Ningún botón ni campo baja de 44 px de alto. Es lo mínimo para acertar con el dedo
enguantado en obra. Si agrega algo, respete esa medida.

## Dónde está cada cosa en el JS

**`1-nucleo.js`** — la semilla de datos, `guardar()`, el acceso por fotocheck
(`crearPerfil`, `intentarEntrar`), las unidades y sus alias, `mover()` que es el único
sitio donde cambia el stock, la lectura de Excel (`abrirZip`, `filasDeXLSX`) y la
escritura (`crearXLSX`).

**`2-pantallas.js`** — `VISTA.requisito`, `VISTA.ingreso`, `VISTA.salida`,
`VISTA.prestamo`, `VISTA.inventario`, `VISTA.consolidado`, `VISTA.kardex`,
`VISTA.revisar`, `VISTA.comprar`, `VISTA.despachar`, `VISTA.guia`, `VISTA.puestos`.
Cada una pinta su HTML y engancha sus botones.

## El administrador

Está reservado al fotocheck que figura en `FOTOCHECK_DUENO`, dentro de `1-nucleo.js`.
Quien se registre con ese número recibe el puesto de almacenero **y** el de administrador,
y le aparece el interruptor para pasar de uno a otro. Para cederlo, cambie ese número.

## Lo que falta

Los datos viven en el navegador de cada equipo. Para que todos vean lo mismo hay que
conectar la base: está en la carpeta `1 BASE DE DATOS`, al lado de esta.
