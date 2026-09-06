# Experiencia de usuario

**Versión:** 0.1
**Fecha:** 2026-09-06
**Depende de:** ARF (RNF-001, UX-001 a UX-005) y `decisiones_cerradas_v0.1.md`.

Define pantallas, navegación y gestos. Cierra las cuestiones de UX que el ARF dejó pendientes.

---

## 1. Principios

Tres, y todos salen de RNF-001:

1. **Se usa con una mano, de pie, empujando un carro.** El pulgar llega a la mitad inferior de la
   pantalla; lo que esté arriba del todo es para mirar, no para tocar.
2. **Cero espera.** Toda escritura es optimista (estrategia de sincronización, §9). Ninguna acción
   frecuente muestra un indicador de carga.
3. **Un toque para lo frecuente.** Agregar a la lista, marcar y cambiar la cantidad son un solo toque
   cada uno. Todo lo que exija abrir una pantalla de detalle es, por definición, poco frecuente.

## 2. Los dos momentos de uso

La app se usa en dos situaciones muy distintas, y de ahí sale toda la estructura:

| | **Armar la lista** | **Hacer la compra** |
|---|---|---|
| Dónde | En casa, mirando la nevera | En el pasillo, con el carro |
| Qué quiere | Recorrer o buscar y añadir varios | Marcar, y nada más |
| Pantalla | Catálogo | Mercado |

---

## 3. Navegación

Dos pestañas en la barra inferior, al alcance del pulgar. **Mercado** es la pantalla de arranque:
es la que se abre en el supermercado, que es el momento de menos paciencia.

```
┌─────────────────────────────────┐
│                                 │
│           contenido             │
│                                 │
├─────────────────────────────────┤
│    Mercado    │    Catálogo     │  ← barra inferior, con safe-area
└─────────────────────────────────┘
```

Ajustes vive tras un icono en la cabecera del Catálogo, no en la barra: se visita tres veces al año.

No hay más niveles que estos dos más un detalle de producto. Todo lo que se abre encima lo hace como
*drawer* desde abajo (D-023), nunca como diálogo centrado: el pulgar está abajo.

---

## 4. Pantalla Mercado

Resuelve RF-013, RF-014, RF-015 y RF-017.

```
  Mercado                      ● Al día
  ─────────────────────────────────────

  SUPERMU                      3 de 6  ⌄
  ─────────────────────────────────────
   ☐   Leche                            2
   ☐   Huevos
   ☐   Pan de molde
  ·····································
   ☑   Queso
   ☑   Yogur
   ☑   Mantequilla

          [  Finalizar compra · 3  ]

  D1                           0 de 2  ⌄
  ─────────────────────────────────────
   ☐   Arroz
   ☐   Papel higiénico                  2

  SIN ASIGNAR                  0 de 1  ⌄
  ─────────────────────────────────────
   ☐   Pilas AA
```

**Secciones, no pestañas** (D-007): con dos supermercados, la lista entera cabe de un vistazo y una
pestaña sería un toque extra por nada.

**La sección se pliega** tocando su cabecera. En Supermu pliegas D1 y dejas de verlo. Es lo que hace
innecesarias las pestañas de la alternativa B de UX-001, sin renunciar a ver el conjunto en casa.

**Toda la fila marca.** El área de toque no es la casilla, es la fila entera de borde a borde: 44 px
de alto como mínimo. Marcar es lo que más se repite y hay que poder hacerlo sin mirar.

**Los marcados bajan al final de su sección** (D-009), tras un separador y en gris. No desaparecen,
porque RF-015 lo prohíbe, pero la lista de lo que queda pendiente se acorta sola conforme avanzas.

**Dentro de cada supermercado, el orden es por categoría** (D-031): lácteos juntos, limpieza junta.
Es el orden global de las categorías, el mismo para todos los supermercados; el recorrido propio de
cada uno llegará en V2 (RF-021) y encajará aquí sin tocar nada más. Los productos sin categoría van
al final del grupo.

**"Sin asignar" siempre al final** (D-002), después de los supermercados reales.

**El contador de la cabecera dice "3 de 6"**, no un porcentaje ni una barra: es la información que
buscas de reojo mientras caminas.

**La cantidad solo se imprime cuando es mayor que 1**, y como cifra, no como control. Veinte
contadores `− 1 +` a la vez son ruido, y sobre todo son un objetivo de toque parásito pegado a una
fila cuyo toque significa marcar. Tocar la cifra abre el contador ahí mismo. El control completo vive
en el Catálogo, que es donde se arma la lista (D-034).

### Añadir sin salir de aquí

Un campo de búsqueda al desplegar la cabecera, que busca en el catálogo y añade con un toque. Si no
hay resultados, ofrece **Crear "pan integral"** (D-008), que crea el producto y lo añade en la misma
acción. Cubre el caso de acordarte de algo estando ya en la tienda.

---

## 5. Pantalla Catálogo

Resuelve RF-019, RF-009 y el alta de productos.

```
  Catálogo                       Ajustes
  ─────────────────────────────────────
  [  Buscar producto…                 ]
  ─────────────────────────────────────
  SUPERMU
   Leche              Alpina   −  2  +
   Huevos                          +
   Pan de molde                    +
   Queso                           +
  D1
   Arroz                           +
   Papel higiénico             −  2  +
  SIN ASIGNAR
   Pilas AA                        +

                                   ( + )
```

**El mismo control hace las dos cosas.** Un producto que no está en la lista muestra `+`; al tocarlo
entra con cantidad 1 y el `+` se convierte en el contador `− 1 +`. El segundo toque en `+` ya sube a
2. Agregar y fijar cantidad son el mismo gesto repetido, lo que cierra UX-002 y UX-003 con un solo
control y sin abrir nada.

Quitar de la lista es bajar el contador a cero, o el gesto de deslizar de §8.

**El buscador filtra según escribes** (D-011) y es lo primero que se toca con cien productos en el
catálogo. Es *sticky*: no se va al desplazar.

**Agrupado por supermercado**, igual que el Mercado, para que el modelo mental sea uno solo.

**El botón flotante crea un producto nuevo.** Está abajo a la derecha, donde cae el pulgar.

---

## 6. Alta y edición de producto

Un *drawer* desde abajo, no una pantalla nueva.

```
  Nuevo producto                      ✕
  ─────────────────────────────────────
   Nombre        [ Leche_             ]   ← autofoco, teclado ya abierto
   Supermercado  ( Supermu ) ( D1 ) ( — )
  ─────────────────────────────────────
   + Marca y categoría                  ← plegado
  ─────────────────────────────────────
   [ Guardar ]        [ Guardar y otro ]
```

**Solo dos campos a la vista** (RF-001), y el supermercado como botones, no como desplegable: con dos
o tres opciones, un desplegable es un toque desperdiciado. `—` es "sin asignar" (D-002).

**Marca y categoría van plegadas.** Son opcionales (RF-012, D-004) y pedirlas de frente ralentiza el
alta.

**"Guardar y otro"** mantiene el drawer abierto con el nombre limpio. El primer día vas a dar de alta
sesenta productos de un tirón y ese botón es la diferencia entre hacerlo y abandonar.

**Si el nombre se parece a uno existente**, aviso en línea bajo el campo: *"¿Te refieres a Leche
(Supermu)?"*, con la opción de ir a ese. Avisa, no bloquea (D-006).

Editar (RF-002) es el mismo drawer con los datos cargados, y se abre tocando el nombre del producto
en el catálogo. Cambiar aquí el supermercado mueve el producto de sección al instante, y también su
item si está en la lista (D-027).

**Eliminar** vive dentro del drawer de edición, abajo y en rojo. Si el producto está en la lista, el
aviso lo dice: *"Está en la lista de mercado. Se quitará también de ahí."* (RF-003, C-004).

---

## 7. Finalizar compra

Es la única acción destructiva de la app y por eso es la única que confirma.

**El botón vive al final de cada sección** (D-001), no en una barra global: cierras Supermu el martes
y D1 el sábado. Está desactivado si no hay nada marcado en esa sección, y lleva el número:
`Finalizar compra · 3`.

Al pulsar, un *drawer* de confirmación:

```
  Finalizar compra en Supermu
  ─────────────────────────────────────
   Saldrán de la lista        3 productos
   Se quedan sin comprar      3 productos

   Los productos siguen en tu catálogo.
  ─────────────────────────────────────
         [  Finalizar  ]     [ Cancelar ]
```

Decir las dos cifras a la vez es lo que hace evidente la regla que más confunde de todo el producto:
lo marcado sale, lo no marcado se queda (RN-005, UX-004).

**Y después, deshacer** (D-032). Un aviso al pie durante unos segundos con la opción de revertir. Sale
gratis: como el retirado es lógico y no físico (D-026), deshacer es poner a nulo el `removed_at` de
esos items. Una compra finalizada por error a las nueve de la noche, sin deshacer, obliga a
reconstruir la lista a mano.

Si se finaliza sin nada marcado, no pasa nada: la lista queda igual. RF-017 permite finalizar con
productos sin marcar, y el caso degenerado es simplemente que no sale ninguno.

---

## 8. Gestos y reglas transversales

| Elemento | Regla |
|----------|-------|
| Área de toque | 44 px mínimo, siempre. La fila entera es zona de toque, no el icono. |
| Marcar | Un toque en la fila (Mercado). |
| Cantidad | Contador `− +` en el Catálogo. En el Mercado, cifra a la derecha (solo si es mayor que 1); tocarla abre el contador en su sitio. |
| Quitar de la lista | Deslizar la fila hacia la izquierda, con confirmación por deslizamiento largo. Alternativa accesible: bajar el contador a 0. |
| Abrir detalle | Tocar el nombre en el Catálogo. Nunca en el Mercado: allí tocar significa marcar. |
| Capas | *Drawer* desde abajo. Nunca diálogo centrado. |
| Deshacer | Aviso al pie, con acción, en lo destructivo. |

**Sin vibración.** Safari en iOS no soporta `navigator.vibrate`, así que el respuesta al marcar es
visual: cambio de estado inmediato y la fila desplazándose al grupo de comprados.

**Modo oscuro automático**, siguiendo al sistema. La mitad de las compras se hacen de noche.

**Accesibilidad:** el estado comprado nunca se comunica solo con el tachado ni solo con el color;
siempre hay casilla marcada. Contraste AA y respeto al tamaño de fuente del sistema, que en un iPhone
de alguien de cuarenta y tantos suele estar subido.

---

## 9. Estado de la sincronización

Un indicador discreto en la cabecera del Mercado (D-012), que solo levanta la voz cuando toca:

| Estado | Qué se ve |
|--------|-----------|
| Al día | `● Al día`, gris, sin animación. |
| Subiendo | Igual. El cambio ya está en pantalla; que viaje no es asunto del usuario. |
| Sin conexión | `▲ Sin conexión · 3 pendientes`, ámbar, permanente. |
| En cuarentena | Franja roja tocable con el detalle y la opción de descartar. |

Como no hay sincronización en segundo plano (D-029), el contador de pendientes tiene que verse
**antes** de cerrar la app. De ahí que ocupe sitio fijo en la cabecera y no sea un aviso pasajero.

Nada se revierte solo en pantalla. Si un cambio acaba en cuarentena, el estado local se mantiene y se
avisa; ver cómo tu marca se deshace sola en mitad del pasillo es peor que un aviso.

---

## 10. Primer uso y ajustes

### Onboarding

```
   ¿Empezamos?

   [ Crear un hogar ]
   [ Unirme con un código ]
```

**Crear** pide el nombre del hogar, siembra las categorías de RF-020 y lleva directo a dar de alta
supermercados, porque sin ellos el catálogo no arranca. **Unirme** pide el código de seis a ocho
caracteres, en mayúsculas y con teclado sin autocorrección.

Tras crear, se muestra el código con un botón de copiar y una explicación de una línea de para qué
sirve. Es también la llave de recuperación (D-014) y conviene que se entienda desde el minuto uno.

### Ajustes

Hogar y código (ver, copiar, regenerar, con aviso de que el anterior deja de servir), supermercados,
categorías, estado de sincronización con la última sincronización correcta, y versión de la app.

### Estados vacíos

No son pantallas en blanco, son la siguiente acción:

- **Sin supermercados:** *"Empieza por dónde compras"* y un botón para crear el primero.
- **Catálogo vacío:** *"Añade lo que sueles comprar"* y el botón de alta.
- **Mercado vacío:** *"Nada que comprar ahora mismo"* y un enlace al catálogo. Es un estado de éxito,
  no un error: acabas de terminar la compra. Que no parezca un fallo.

---

## 11. Particularidades de la PWA en iOS

Cosas que no aparecen en un navegador de escritorio y que sí van a aparecer aquí:

- **No hay botón de atrás.** En modo pantalla completa desaparece el cromo de Safari, así que toda
  pantalla que se abra encima necesita su propia salida visible. Un drawer sin ✕ es un callejón.
- **Safe areas.** `viewport-fit=cover` y `env(safe-area-inset-bottom)` en la barra de pestañas, o el
  indicador de inicio del iPhone se come la zona de toque.
- **Sin rebote de recarga.** `overscroll-behavior: none`, para que tirar de la lista hacia abajo no
  recargue la app en mitad de una compra.
- **El teclado tapa media pantalla.** Los campos de búsqueda y alta van arriba, nunca al pie.
- **La pantalla se apaga sola** cada treinta segundos mientras empujas el carro. Con la Screen Wake
  Lock API se puede mantener encendida mientras haya productos pendientes en el Mercado. Es opcional,
  pero es de lo que más se agradece en uso real.
- **Actualización de versión:** aviso discreto, nunca recarga por sorpresa. Recargar con cambios en
  cola es la peor forma de estrenar una versión.

---

## 12. Lo que este documento no cierra

- Administración de categorías por el usuario (UX-005), diferida a V2 junto con el orden de recorrido
  de RF-021.
- Textos definitivos de la interfaz.

La identidad visual (paleta, tipografía, retícula y tono de los textos) se cierra en
`identidad_visual_v0.1.md`.
