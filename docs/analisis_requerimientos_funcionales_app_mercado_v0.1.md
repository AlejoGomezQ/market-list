# Análisis de Requerimientos Funcionales (ARF)
## App de Mercado Compartida

**Versión:** 0.1  
**Fecha:** 2026-09-06  
**Estado:** Borrador para revisión

---

## 1. Resumen

Aplicación para gestionar de forma compartida la lista de mercado de un hogar.

El objetivo principal es eliminar la necesidad de crear manualmente una lista de compras cada vez que se va al supermercado. La aplicación mantendrá un **catálogo permanente de productos** que el hogar suele comprar y permitirá indicar cuáles de esos productos deben comprarse actualmente.

La aplicación será utilizada por dos personas que comparten el mismo hogar y deberán poder consultar y modificar la información desde sus respectivos iPhone.

Un requisito fundamental es que los productos estén asociados a un **supermercado habitual**, ya que el hogar compra determinados productos siempre en establecimientos concretos. La lista de mercado deberá estar organizada por supermercado.

---

## 2. Objetivo del producto

La aplicación debe permitir que dos personas:

- Mantengan un catálogo permanente de productos.
- Indiquen rápidamente qué productos necesitan comprar.
- Consulten la lista de mercado organizada por supermercado.
- Marquen productos durante la compra para saber cuáles ya están en el carrito.
- Finalicen una compra sin perder los productos que no pudieron o no quisieron comprar.
- Mantengan la información sincronizada entre ambos dispositivos.
- Utilicen la aplicación temporalmente sin conexión y sin perder los cambios.

La aplicación debe priorizar **rapidez, simplicidad y baja fricción** durante el uso cotidiano.

---

## 3. Alcance inicial

### 3.1. Incluido

El alcance funcional inicial contempla:

1. Gestión de productos.
2. Gestión de supermercados.
3. Asignación de supermercado habitual a productos.
4. Gestión de la lista de mercado.
5. Cantidad específica para cada compra.
6. Marca opcional del producto.
7. Organización por supermercado.
8. Categorías de productos.
9. Marcado temporal de productos durante una compra.
10. Finalización de compras.
11. Persistencia de productos no comprados.
12. Sincronización entre dos dispositivos.
13. Funcionamiento offline con posterior sincronización.
14. Vinculación de dos dispositivos mediante un hogar compartido, sin login tradicional.

### 3.2. Fuera del alcance inicial

No forman parte del MVP, aunque podrían considerarse posteriormente:

- Historial de compras.
- Precios.
- Estadísticas de consumo.
- Sugerencias automáticas.
- Reconocimiento por ubicación.
- Detección automática de la sucursal de supermercado.
- Ordenamiento automático según GPS.
- Múltiples listas independientes.
- Perfiles y roles de usuario.
- Sistema tradicional de cuentas y contraseñas.
- Notificaciones avanzadas.
- Automatizaciones inteligentes.

---

## 4. Conceptos principales

### 4.1. Hogar

Representa el espacio compartido entre las dos personas que utilizan la aplicación.

Un hogar contiene:

- Sus usuarios/dispositivos.
- Sus supermercados.
- Su catálogo de productos.
- Su lista de mercado.

Para el MVP no se requiere un sistema tradicional de autenticación. Un usuario podrá crear un hogar y obtener un código que el segundo usuario utilizará para unirse.

### 4.2. Supermercado

Representa un establecimiento donde el hogar realiza sus compras.

Ejemplos:

- Supermu
- D1

Un producto tendrá un **supermercado habitual**, pero esta asociación podrá modificarse.

El modelo deberá permitir en el futuro representar diferentes sucursales/localizaciones de un mismo supermercado, aunque esto no forma parte del MVP.

### 4.3. Producto

Representa un producto que forma parte del catálogo permanente del hogar.

Ejemplos:

- Leche
- Huevos
- Arroz
- Papel higiénico

Un producto puede contener:

- Nombre.
- Marca opcional.
- Supermercado habitual.
- Categoría.

El producto existe independientemente de que actualmente sea necesario comprarlo.

### 4.4. Lista de mercado

Representa los productos que actualmente deben comprarse.

La lista no es un catálogo independiente: se construye a partir de los productos del catálogo que están actualmente incluidos en la compra.

Un producto puede estar o no estar en la lista de mercado.

Conceptualmente:

```text
Producto:
    Leche

Lista de mercado:
    Leche → incluida
```

Cuando la compra termina, el producto puede dejar de estar incluido en la lista, pero continúa existiendo en el catálogo.

### 4.5. Item de lista

Cuando un producto se agrega a la lista de mercado, se genera conceptualmente un elemento de compra que puede tener información específica de esa compra.

Por ejemplo:

```text
Producto:
    Leche
    Marca: Alpina
    Supermercado habitual: Supermu

Item de mercado:
    Leche
    Cantidad: 2
```

La cantidad representa cuánto se desea comprar **en esa ocasión**.

---

# 5. Actores

## 5.1. Usuario del hogar

Existen dos usuarios principales.

Ambos tienen los mismos permisos y pueden realizar todas las operaciones disponibles.

No existen roles diferenciados en el MVP.

Cada usuario puede:

- Consultar productos.
- Crear productos.
- Editar productos.
- Eliminar productos.
- Agregar productos a la lista.
- Quitar productos de la lista.
- Modificar cantidades.
- Cambiar supermercados.
- Gestionar supermercados.
- Marcar productos durante la compra.
- Finalizar la compra.

---

# 6. Requerimientos funcionales

## RF-001 — Crear producto

El sistema deberá permitir crear un producto nuevo dentro del catálogo del hogar.

Como mínimo deberá solicitar:

- Nombre.
- Supermercado habitual.

Opcionalmente podrá registrar:

- Marca.
- Categoría.

Al crear un producto, este no deberá agregarse automáticamente a la lista de mercado, salvo que la UX que se defina posteriormente establezca explícitamente lo contrario.

---

## RF-002 — Editar producto

El sistema deberá permitir modificar un producto existente.

Se deberá poder modificar como mínimo:

- Nombre.
- Marca.
- Supermercado habitual.
- Categoría.

La modificación del producto deberá reflejarse para ambos usuarios.

---

## RF-003 — Eliminar producto

El sistema deberá permitir eliminar definitivamente un producto del catálogo.

Eliminar un producto implica que dejará de formar parte del catálogo y no deberá continuar apareciendo en la lista de mercado.

La aplicación no requiere papelera ni recuperación de productos en el MVP.

---

## RF-004 — Crear supermercado

El sistema deberá permitir agregar supermercados al hogar.

Como mínimo deberá registrarse:

- Nombre del supermercado.

Ejemplos:

```text
Supermu
D1
```

La estructura deberá permitir ampliar posteriormente el modelo para soportar sucursales o ubicaciones.

---

## RF-005 — Editar supermercado

El sistema deberá permitir modificar la información de un supermercado existente.

Como mínimo deberá poder modificarse su nombre.

---

## RF-006 — Eliminar supermercado

El sistema deberá permitir eliminar un supermercado.

Antes de eliminarlo, el sistema deberá considerar los productos que tengan dicho supermercado como habitual.

El comportamiento exacto de esta situación deberá definirse durante el diseño de UX/modelo de datos.

---

## RF-007 — Asignar supermercado habitual

Cada producto deberá poder tener un supermercado habitual.

Esta asociación representa dónde normalmente se compra el producto y no debe interpretarse como una restricción absoluta.

El usuario podrá cambiar posteriormente el supermercado habitual del producto.

---

## RF-008 — Mover producto entre supermercados

El sistema deberá permitir cambiar el supermercado habitual asociado a un producto.

Ejemplo:

```text
Arroz
D1 → Supermu
```

El cambio deberá reflejarse en las futuras listas de mercado.

---

## RF-009 — Agregar producto a la lista de mercado

El sistema deberá permitir agregar un producto existente del catálogo a la lista de mercado.

Agregar un producto a la lista deberá ser una operación diferente a crear un producto.

Ejemplo:

```text
Producto existente:
    Leche

Acción:
    Agregar a mercado

Resultado:
    Leche aparece en la lista de mercado.
```

La aplicación deberá priorizar una interacción rápida para esta acción.

---

## RF-010 — Quitar producto de la lista

El sistema deberá permitir retirar un producto de la lista de mercado sin eliminarlo del catálogo.

Ejemplo:

```text
Leche
↓
Quitar de mercado
↓
Leche continúa en el catálogo
```

---

## RF-011 — Definir cantidad para una compra

Cada producto agregado a la lista de mercado deberá poder tener una cantidad asociada a esa compra.

La cantidad representa cuánto se desea comprar en la ocasión actual.

Ejemplo:

```text
Leche
Cantidad: 2
```

La cantidad no debe interpretarse necesariamente como una cantidad permanente del producto.

---

## RF-012 — Marca opcional

Los productos podrán tener una marca asociada.

La marca será opcional.

Ejemplo:

```text
Leche
Marca: Alpina
```

Un producto podrá existir sin marca.

---

## RF-013 — Visualizar lista de mercado

La aplicación deberá disponer de una vista específica para la lista de mercado.

Esta vista deberá mostrar exclusivamente los productos actualmente incluidos en la lista de mercado.

Los productos que no estén pendientes de compra no deberán aparecer en esta vista.

---

## RF-014 — Separar la lista por supermercado

Los productos de la lista de mercado deberán organizarse por supermercado.

Ejemplo:

```text
SUPERMU

☐ Leche
☐ Huevos
☐ Queso


D1

☐ Arroz
☐ Papel higiénico
☐ Pasta
```

La aplicación no deberá mezclar todos los supermercados en una única lista plana.

La decisión de interfaz entre:

- una lista continua con secciones por supermercado, o
- una pestaña independiente por supermercado,

queda pendiente de definición de UX.

---

## RF-015 — Marcar producto durante la compra

Durante una compra, el usuario deberá poder marcar individualmente los productos que ya tiene en su carrito.

Ejemplo:

```text
☑ Leche
☐ Huevos
☑ Queso
```

El marcado representa:

> El producto ya fue recogido/comprado durante la compra actual.

Marcar un producto no deberá retirarlo inmediatamente de la lista de mercado.

---

## RF-016 — Sincronizar estado de compra

El estado de marcado durante una compra deberá ser reactivo entre los dispositivos.

Si un usuario marca un producto, el otro usuario deberá poder observar el cambio sin necesidad de reconstruir manualmente la lista.

Ejemplo:

```text
Usuario A:
    ☑ Leche

Usuario B:
    ☑ Leche
```

La experiencia deberá procurar que los cambios aparezcan prácticamente en tiempo real cuando exista conexión.

---

## RF-017 — Finalizar compra

La aplicación deberá permitir finalizar una compra.

La finalización deberá poder ejecutarse aunque existan productos sin marcar.

Al finalizar:

- Los productos marcados como comprados deberán salir de la lista de mercado.
- Los productos que no fueron marcados deberán permanecer en la lista.
- Todos los productos continuarán existiendo en el catálogo.

Ejemplo:

Antes:

```text
☑ Leche
☑ Huevos
☐ Queso
```

Después de finalizar:

```text
☐ Queso
```

La leche y los huevos dejan de estar en la lista, pero continúan en el catálogo.

---

## RF-018 — Mantener productos no comprados

Si un producto no fue marcado durante la compra, deberá permanecer automáticamente en la lista de mercado después de finalizar la compra.

Esto cubre casos como:

- El supermercado no tenía el producto.
- El usuario decidió no comprarlo.
- Se olvidó comprarlo.
- Se decidió comprarlo posteriormente.

---

## RF-019 — Catálogo permanente

Los productos del catálogo deberán permanecer disponibles independientemente de si actualmente están incluidos en la lista de mercado.

El catálogo constituye la base permanente de productos habituales del hogar.

---

## RF-020 — Categorías

El sistema deberá soportar categorías para los productos.

Ejemplos iniciales:

- Frutas y verduras.
- Carnes.
- Lácteos.
- Despensa.
- Bebidas.
- Limpieza.
- Higiene.

La estructura y conjunto definitivo de categorías será iterado posteriormente.

---

## RF-021 — Orden personalizado por supermercado

El sistema deberá estar preparado para que cada supermercado pueda tener un orden de recorrido propio.

Ejemplo:

```text
Supermu:
1. Frutas
2. Carnes
3. Lácteos
4. Despensa
5. Limpieza
```

Mientras que:

```text
D1:
1. Frutas
2. Despensa
3. Bebidas
4. Lácteos
5. Limpieza
```

El orden deberá considerarse una propiedad del recorrido de cada supermercado y no necesariamente un orden global.

La edición de este orden podrá formar parte de una versión posterior.

---

## RF-022 — Vincular segundo dispositivo

La aplicación deberá permitir crear un hogar compartido.

El primer usuario podrá:

1. Crear un hogar.
2. Obtener un código de vinculación.

El segundo usuario podrá:

1. Seleccionar la opción de unirse a un hogar.
2. Introducir el código.
3. Quedar asociado al mismo hogar.

No se requiere autenticación tradicional mediante usuario y contraseña para el MVP.

---

## RF-023 — Compartir información del hogar

Una vez vinculados, ambos usuarios deberán trabajar sobre la misma información.

Esto incluye:

- Productos.
- Supermercados.
- Lista de mercado.
- Cantidades.
- Estado de compra.
- Categorías.
- Configuración relevante del hogar.

---

## RF-024 — Uso offline

La aplicación deberá permitir consultar y modificar información esencial aunque temporalmente no exista conexión a Internet.

Como mínimo deberá poder:

- Consultar la lista.
- Marcar productos.
- Agregar productos a la lista.
- Quitar productos de la lista.
- Realizar modificaciones básicas.

Los cambios realizados offline deberán sincronizarse cuando se recupere la conexión.

---

# 7. Reglas de negocio

## RN-001 — Producto y lista son conceptos diferentes

Crear un producto no implica necesariamente que deba comprarse.

Un producto puede existir permanentemente en el catálogo sin estar incluido en la lista de mercado.

---

## RN-002 — La lista se construye a partir del catálogo

Un producto solamente aparece en la lista de mercado cuando está marcado para ser comprado.

---

## RN-003 — Eliminar de la lista no elimina el producto

Quitar un producto de la lista de mercado no deberá eliminarlo del catálogo.

---

## RN-004 — Comprar no elimina el producto

Finalizar una compra no elimina los productos del catálogo.

Solamente los retira de la lista aquellos productos que fueron marcados como comprados.

---

## RN-005 — Los productos no comprados permanecen

Los productos que no hayan sido marcados durante la compra permanecen en la lista después de finalizarla.

---

## RN-006 — La cantidad corresponde a la compra actual

La cantidad registrada para un item de mercado representa la cantidad que se desea comprar en esa ocasión.

---

## RN-007 — El supermercado es habitual

El supermercado asociado al producto representa el lugar donde normalmente se compra.

No constituye necesariamente una restricción permanente.

---

## RN-008 — Un hogar comparte sus datos

Los usuarios vinculados al mismo hogar consultan y modifican la misma información.

---

## RN-009 — Ambos usuarios tienen los mismos permisos

No existen roles administrativos diferentes en el MVP.

---

## RN-010 — La lista está agrupada por supermercado

La lista de mercado deberá permitir identificar claramente qué productos deben comprarse en cada supermercado.

---

# 8. Casos de uso principales

## CU-001 — Crear producto

**Actor:** Usuario

**Flujo principal:**

1. El usuario accede al catálogo.
2. Selecciona crear producto.
3. Introduce el nombre.
4. Selecciona supermercado habitual.
5. Opcionalmente introduce marca y categoría.
6. Guarda.
7. El producto aparece en el catálogo.

---

## CU-002 — Agregar producto al mercado

**Actor:** Usuario

**Flujo principal:**

1. El usuario consulta el catálogo.
2. Selecciona un producto.
3. Ejecuta "Agregar al mercado".
4. Define la cantidad.
5. El producto aparece en la lista de mercado correspondiente a su supermercado.

---

## CU-003 — Hacer mercado

**Actor:** Usuario

**Flujo principal:**

1. El usuario abre la lista de mercado.
2. Consulta los productos agrupados por supermercado.
3. Ingresa a un supermercado.
4. Marca cada producto conforme lo coloca en el carrito.
5. Puede consultar el estado actualizado de la lista desde cualquiera de los dispositivos.

---

## CU-004 — Finalizar compra

**Actor:** Usuario

**Flujo principal:**

1. El usuario termina el recorrido.
2. Selecciona finalizar compra.
3. El sistema retira de la lista los productos marcados.
4. Mantiene en la lista los productos no marcados.
5. Los productos continúan en el catálogo.

---

## CU-005 — Cambiar supermercado habitual

**Actor:** Usuario

**Flujo principal:**

1. El usuario abre un producto.
2. Edita su supermercado habitual.
3. Selecciona otro supermercado.
4. Guarda.
5. El producto queda asociado al nuevo supermercado.

---

## CU-006 — Compartir hogar

**Actor:** Dos usuarios

**Flujo principal:**

1. Usuario A crea un hogar.
2. El sistema genera un código.
3. Usuario A comparte el código con Usuario B.
4. Usuario B selecciona unirse a un hogar.
5. Introduce el código.
6. Ambos dispositivos quedan asociados al mismo hogar.
7. Los datos del hogar quedan disponibles para ambos.

---

# 9. Requerimientos no funcionales

## RNF-001 — Simplicidad

La aplicación deberá minimizar la cantidad de pasos necesarios para las operaciones frecuentes.

Especialmente:

- Agregar un producto existente a la lista.
- Marcar un producto durante la compra.
- Consultar los productos de un supermercado.

---

## RNF-002 — Sincronización

Los cambios realizados por cualquiera de los dos usuarios deberán sincronizarse entre dispositivos.

Cuando exista conexión, los cambios deberán reflejarse con la menor latencia razonablemente posible.

---

## RNF-003 — Funcionamiento offline

La aplicación deberá mantener una experiencia funcional básica sin conexión.

La pérdida temporal de conectividad no deberá provocar la pérdida de cambios realizados localmente.

---

## RNF-004 — Consistencia

La información compartida deberá converger hacia el mismo estado en ambos dispositivos después de sincronizarse.

Los detalles del mecanismo de resolución de conflictos quedan fuera del alcance funcional de este documento y serán definidos durante el diseño técnico.

---

## RNF-005 — Persistencia

Los productos y configuración del hogar deberán persistir entre sesiones de uso.

---

## RNF-006 — Escalabilidad futura

El modelo deberá evitar decisiones que impidan posteriormente incorporar:

- Más supermercados.
- Sucursales.
- Ubicación.
- Orden de recorrido.
- Historial.
- Automatizaciones.
- Más usuarios por hogar, si posteriormente se considera necesario.

---

# 10. Modelo conceptual inicial

El modelo conceptual puede representarse de la siguiente manera:

```text
HOGAR
│
├── Usuarios
│
├── Supermercados
│   ├── Supermu
│   └── D1
│
├── Categorías
│
└── Productos
    │
    ├── Nombre
    ├── Marca (opcional)
    ├── Categoría
    └── Supermercado habitual
```

La lista de mercado se deriva de los productos que actualmente están incluidos:

```text
HOGAR
│
└── LISTA DE MERCADO
    │
    ├── Supermu
    │   ├── Producto A
    │   ├── Producto B
    │   └── Producto C
    │
    └── D1
        ├── Producto D
        └── Producto E
```

Un item de mercado deberá poder almacenar información específica de la compra, especialmente la cantidad y el estado temporal durante el recorrido.

---

# 11. Flujo conceptual de uso

El flujo principal esperado es:

```text
CATÁLOGO
    │
    │ Producto hace falta
    ▼
AGREGAR A MERCADO
    │
    ▼
DEFINIR CANTIDAD
    │
    ▼
LISTA DE MERCADO
    │
    ├── Supermu
    │
    └── D1
         │
         ▼
     HACER COMPRA
         │
         ▼
   MARCAR PRODUCTOS
         │
         ▼
   FINALIZAR COMPRA
         │
         ├── Marcados
         │      ↓
         │   salen de la lista
         │
         └── No marcados
                ↓
          permanecen en la lista
```

---

# 12. Consideraciones de UX pendientes

Estas decisiones no se consideran cerradas todavía.

## UX-001 — Navegación entre supermercados

Se deberán evaluar al menos:

**Alternativa A:**

```text
Supermu
---------
productos

D1
---------
productos
```

**Alternativa B:**

```text
[ Supermu ] [ D1 ]

productos
```

La decisión deberá basarse en velocidad de uso durante el mercado.

---

## UX-002 — Agregar rápidamente a mercado

La acción de agregar un producto existente a la lista deberá requerir la menor cantidad posible de interacción.

Se deberá evaluar, por ejemplo:

```text
Leche
[ + ]
```

frente a entrar al detalle del producto.

---

## UX-003 — Cantidad

Se deberá definir cómo se introduce y modifica rápidamente la cantidad.

---

## UX-004 — Finalizar compra

La acción de finalizar deberá ser claramente visible y operar sobre la compra actual.

Debe quedar claro que:

- Los productos marcados salen de la lista.
- Los productos no marcados permanecen.

---

## UX-005 — Categorías y recorrido

Se deberá diseñar posteriormente cómo el usuario:

- Crea categorías.
- Asigna categorías a productos.
- Ordena categorías.
- Configura un orden diferente para cada supermercado.

---

# 13. Evoluciones potenciales

## V2 — Organización avanzada

Posibles funcionalidades:

- Orden personalizado de categorías por supermercado.
- Orden personalizado de productos.
- Configuración del recorrido habitual.
- Diferentes sucursales de un mismo supermercado.
- Selección manual de sucursal.

## V3 — Ubicación

Posible funcionalidad:

1. La aplicación obtiene la ubicación actual.
2. Determina en qué sucursal del supermercado se encuentra el usuario.
3. Identifica el recorrido configurado para esa sucursal.
4. Ordena automáticamente la lista según ese recorrido.

Ejemplo:

```text
📍 Usuario en D1 - Sucursal A

Ordenando lista según el recorrido
configurado para esta sucursal...
```

Esta funcionalidad es deliberadamente futura y no forma parte del MVP.

---

# 14. Decisiones abiertas

Las siguientes decisiones deberán resolverse antes o durante el diseño de UX/arquitectura:

1. ¿La lista de mercado utiliza tabs por supermercado o una lista continua con secciones?
2. ¿Cómo se configuran y administran las categorías?
3. ¿Cómo se configura el orden del recorrido?
4. ¿Cómo se representa una sucursal de supermercado?
5. ¿Qué ocurre exactamente al eliminar un supermercado que tiene productos asociados?
6. ¿Cómo se comportan las cantidades cuando un producto vuelve a agregarse al mercado?
7. ¿Cómo se manejan técnicamente los cambios simultáneos entre dispositivos?
8. ¿Cómo se mantiene la sesión/vinculación del hogar sin un sistema tradicional de login?
9. ¿Qué información local se almacena para permitir funcionamiento offline?

Estas decisiones no bloquean la definición funcional principal del MVP.

---

# 15. Criterios de aceptación generales del MVP

El MVP deberá permitir completar satisfactoriamente el siguiente escenario:

1. Usuario A crea un hogar.
2. Usuario B se une mediante código.
3. Ambos pueden ver los mismos supermercados.
4. Se crean productos y se asignan a supermercados habituales.
5. Los productos aparecen en el catálogo permanente.
6. Usuario A agrega varios productos al mercado.
7. Cada producto recibe una cantidad para esa compra.
8. La lista se muestra separada por supermercado.
9. Usuario A comienza a hacer mercado.
10. Marca algunos productos conforme los coloca en el carrito.
11. Usuario B puede observar esos cambios desde su dispositivo.
12. Se finaliza la compra.
13. Los productos marcados desaparecen de la lista.
14. Los productos no marcados permanecen.
15. Todos los productos continúan disponibles en el catálogo.
16. Si temporalmente no hay conexión, las operaciones básicas continúan funcionando y los cambios se sincronizan posteriormente.

---

# 16. Resumen del MVP

El producto mínimo viable debe resolver una necesidad concreta:

> **Mantener permanentemente lo que normalmente compramos y permitir convertirlo rápidamente en una lista de mercado compartida, organizada por supermercado, sin tener que reconstruir la lista cada vez.**

Las capacidades fundamentales son:

```text
CATÁLOGO PERMANENTE
        ↓
AGREGAR PRODUCTOS AL MERCADO
        ↓
LISTA AGRUPADA POR SUPERMERCADO
        ↓
MARCAR LO QUE YA ESTÁ EN EL CARRITO
        ↓
FINALIZAR COMPRA
        ↓
COMPRADOS → FUERA DE LA LISTA
NO COMPRADOS → PERMANECEN
```

La aplicación deberá ser sencilla de utilizar, compartida entre dos dispositivos y resistente a períodos de falta de conexión.

---

## Estado del documento

**Versión:** 0.1  
**Estado:** Borrador funcional pendiente de validación.

Una vez aprobado este documento, el siguiente paso recomendado será definir la **arquitectura funcional y técnica**, incluyendo modelo de datos, estrategia de sincronización/offline, mecanismo de vinculación del hogar y alternativas de stack tecnológico.
