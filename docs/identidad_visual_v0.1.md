# Identidad visual

**Versión:** 0.1
**Fecha:** 2026-09-06
**Depende de:** `experiencia_usuario_v0.1.md`, que definió pantallas y gestos y dejó abierta la
identidad visual.

Cierra paleta, tipografía, retícula y tono de los textos. Es el documento que hay que tener delante
al escribir el primer componente.

---

## 1. De dónde sale el lenguaje visual

El problema de diseño de esta app no es "mostrar una lista bonita". Es **que alguien de pie, con una
mano ocupada y el carro en movimiento, sepa de un vistazo qué le falta y dónde está**.

Ese problema ya está resuelto, y muy bien, dentro del propio supermercado: la señalización de pasillo
y las etiquetas de estante. Tipografía condensada y pesada, contraste máximo, jerarquía brutal, cero
decoración, color usado solo para orientar. Es un lenguaje que además le resulta familiar al usuario
precisamente en el momento en que va a usar la app.

**La app se diseña como señalización de supermercado, no como una app de recetas.** De ahí salen las
tres reglas que gobiernan todo lo demás:

1. **El color es orientación, no decoración.** Solo los supermercados tienen color. Todo lo demás es
   tinta y papel.
2. **El peso y el tamaño son la jerarquía.** Nada de cajas, sombras ni tarjetas para separar cosas.
3. **Nada compite con el nombre del producto.** Es lo único que se lee en movimiento.

Lo que se descarta explícitamente: la app de mercado ilustrada con verduras y colores pastel (el
camino evidente y el que hace que todas se parezcan), y el pastiche de tique de caja en monoespaciada
(gracioso, pero convierte la letra pequeña en protagonista, que es justo lo contrario de lo que hace
falta en un pasillo).

---

## 2. Color

### Base

Achromática a propósito, para que el único color saturado de la pantalla signifique algo.

| Token | Claro | Oscuro | Uso |
|-------|-------|--------|-----|
| `--paper` | `#FFFFFF` | `#17191A` | Fondo único. No hay superficies elevadas. |
| `--ink` | `#000000` | `#F2F3F3` | Nombres de producto y cifras. |
| `--ink-mute` | `#6B6F72` | `#9AA0A3` | Marca, contadores, texto secundario. |
| `--ink-ghost` | `#A9AEB1` | `#63696C` | Filas ya compradas. |
| `--rule` | `#E3E5E6` | `#2C3033` | Separadores, bordes de control. |

**Negro real, no un negro teñido.** Las etiquetas de estante se imprimen en negro sobre blanco, y un
`#111` "casi negro" es una coartada de diseñador que aquí no aporta nada y resta contraste.

### Supermercados

Cada supermercado recibe un color al crearse, de una paleta cerrada de ocho. Es lo que permite saber
en qué sección estás sin leer, que es exactamente lo que se necesita en un pasillo.

```
rojo     #B3261E     cobalto  #1B4FD8     bosque  #1F6B45     ocre     #8A5A00
ciruela  #6D2C6B     turquesa #0F5F6B     pizarra #3A4550     naranja  #A8420F
```

Todos son lo bastante oscuros para llevar texto blanco encima cumpliendo AA; verificarlo forma parte
del trabajo de montaje, no se da por hecho. Se usan **idénticos en claro y en oscuro**: el color de
un supermercado es su identidad, no un tema.

Se asignan por orden al crear supermercados y son editables. "Sin asignar" no tiene color: su banda
es gris `--rule` con texto en `--ink-mute`, porque literalmente es la ausencia de sitio.

### Funcionales

Solo aparecen en estado y en acciones destructivas, nunca decorando:

```
--alert        #B45309   sin conexión, cambios pendientes
--destructive  #A32014   eliminar, y solo dentro de un flujo de eliminación
```

Deliberadamente menos vivos que los colores de supermercado, para que un aviso no grite más que la
orientación.

---

## 3. Tipografía

**Una sola familia: Archivo**, en su versión variable, aprovechando su eje de anchura. Los dos
registros no se distinguen por cambiar de tipografía, sino por cambiar de anchura, que es más
característico y evita el emparejamiento serif/sans de manual.

| Papel | Ajuste |
|-------|--------|
| Rótulo de supermercado | Archivo `wdth 75`, peso 700, tracking `-0.01em`, versalitas no, mayúsculas sí |
| Nombre de producto | Archivo `wdth 100`, peso 500, 17–18 px, tracking 0 |
| Cantidad y contadores | Archivo `wdth 75`, peso 700, cifras tabulares (`font-variant-numeric: tabular-nums`) |
| Marca y secundario | Archivo `wdth 100`, peso 400, 14 px, `--ink-mute` |
| Botones | Archivo `wdth 100`, peso 600, 16 px |

Archivo está dibujada para aguantar tamaños pequeños y titulares de alto rendimiento, con aperturas
abiertas y altura de x generosa: exactamente lo que pide leer en movimiento. Se carga por Google
Fonts con una pila de reserva del sistema (`system-ui`) por si la fuente no llega.

**Las mayúsculas del rótulo de supermercado son señalización, no una etiqueta decorativa.** Es la
única parte de la interfaz en mayúsculas; no hay antetítulos ni etiquetas en versalitas espaciadas en
ningún otro sitio.

Escala: 13 / 14 / 17 / 20 / 26 px. Cinco pasos, ni uno más. Interlineado 1.3 en producto, 1.15 en
rótulos.

---

## 4. Retícula y forma

**El radio de curva codifica la función, no se aplica igual a todo:**

- `0` en las bandas de supermercado, que van de borde a borde y son señales rectangulares.
- `4px` en botones y campos.
- `999px` solo en el contador de cantidad, porque es el único control que se manipula con el pulgar y
  la forma de píldora dice "aquí se toca".

**Sin tarjetas y sin sombras.** Las filas no son cajas: son franjas de 56 px de alto separadas por
aire, no por bordes. La sombra se reserva para lo que de verdad flota sobre el contenido: el *drawer*
y la barra de pestañas.

**La banda del supermercado es el elemento memorable de la app**, y es donde se gasta toda la audacia:
sangre completa, color sólido, nombre en condensada pesada blanca, contador a la derecha, y **se
queda pegada arriba al desplazar**. Mientras recorres Supermu, siempre tienes el letrero de Supermu
sobre la cabeza. Es literalmente el cartel colgado del techo del pasillo.

```
┌─────────────────────────────────────┐
│███ SUPERMU                  3 de 6 █│  ← banda sólida, sticky
└─────────────────────────────────────┘
     Leche                          2
     Huevos
     Pan de molde
     ────────────────────────────────
     Queso                    comprado
     Yogur                    comprado

            Finalizar compra · 3

┌─────────────────────────────────────┐
│███ D1                       0 de 2 █│
└─────────────────────────────────────┘
     Arroz
     Papel higiénico                 2
```

**La cantidad solo se imprime cuando es mayor que 1.** Veinte controles `− 1 +` a la vez son ruido, y
además son un objetivo de toque parásito justo al lado de la fila, cuyo toque significa marcar. En el
Mercado la cantidad es una cifra; tocarla abre el contador ahí mismo. En el Catálogo sí vive el
control completo, que es donde se arma la lista (D-034).

Alineación: todo a la izquierda salvo cifras y contadores, a la derecha. El nombre del producto
siempre arranca en la misma vertical, para que la vista baje por una sola línea al escanear.

---

## 5. Iconos

**Lucide**, que ya viene con shadcn/ui. Trazo 1.75, tamaño 20 px, siempre `currentColor`.

**Nunca emojis**, en ninguna parte de la interfaz: se dibujan distinto en cada sistema, no heredan el
color del texto y no se alinean con la tipografía.

Y pocos: buscar, ajustes, más, menos, cerrar, papelera, sin conexión. Si un icono necesita una
etiqueta al lado para entenderse, sobra el icono.

---

## 6. Movimiento

Un único momento coreografiado en toda la app: **al marcar un producto, la fila viaja hasta el grupo
de comprados**, 200 ms, con una curva de salida. Es movimiento que responde a una acción y que
explica qué acaba de pasar, que es el único que se gana su sitio.

Nada más se mueve. Sin entradas escalonadas de secciones, sin transiciones al pasar el dedo por
encima, sin barridos de carga. Con `prefers-reduced-motion`, la fila salta a su sitio sin recorrido.

---

## 7. Cómo se usa shadcn/ui

Como **primitivas de comportamiento**, no como aspecto. De shadcn se aprovechan la accesibilidad, el
foco, el manejo de teclado y el comportamiento del *drawer*; se sustituye entera su capa de tokens.

Concretamente, lo que **no** se usa: `Card` para las filas de lista, el radio uniforme por defecto, la
sombra gris suave bajo cada bloque y la paleta neutra de fábrica. Dejar los valores de fábrica es
exactamente lo que hace que dos aplicaciones distintas parezcan la misma.

---

## 8. Los textos

Español, en frase, sin mayúsculas iniciales por palabra. Voz activa y una sola cosa por frase.

- **Los botones dicen lo que va a pasar**, y el resultado repite la misma palabra: `Finalizar compra`
  produce `Compra finalizada`. `Guardar` produce `Guardado`.
- **Los vacíos son una invitación, no un lamento.** "Nada que comprar ahora mismo" con un enlace al
  catálogo; no "Tu lista está vacía :(".
- **Los errores dicen qué pasó y qué hacer**, sin disculparse: "No se pudieron guardar 3 cambios.
  Revisa cuáles" en vez de "Uy, algo salió mal".
- **Nombres de usuario, no de sistema.** "Sin conexión", no "offline"; "supermercado", no "tienda";
  "código del hogar", no "token de vinculación".
- Sin signos como adorno: nada de flechas al final de los botones ni cadenas unidas por puntos medios.

---

## 9. El suelo de calidad

No se anuncia, se cumple: foco de teclado visible en todo lo interactivo, contraste AA en texto y en
los pares de color de supermercado, `prefers-reduced-motion` respetado, tipografía que escala con el
ajuste del sistema, y el estado "comprado" comunicado con casilla y no solo con color o tachado.
