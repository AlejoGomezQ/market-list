# Estrategia de sincronización

**Versión:** 0.1
**Fecha:** 2026-09-06
**Depende de:** `arquitectura_funcional_v0.1.md` (modelo de datos y función de fusión) y
`decisiones_cerradas_v0.1.md` (D-015 a D-027, conflictos C-001 a C-004).

Define cómo viajan los cambios entre los dos dispositivos y Supabase: qué sube, qué baja, en qué
orden, qué pasa cuando falla y qué ve el usuario mientras tanto.

---

## 1. Qué se promete y qué no

**Se promete:**

- La interfaz responde siempre al instante, haya red o no. Nunca hay una rueda girando entre pulsar
  y ver el resultado.
- Ningún cambio hecho sin conexión se pierde mientras la app siga instalada (RNF-003).
- Con conexión, un cambio de un dispositivo aparece en el otro en cosa de segundos (RF-016).
- Los dos dispositivos convergen al mismo estado tras sincronizar, independientemente del orden en
  que lo hagan (RNF-004).

**No se promete, y es deliberado:**

- No hay sincronización en segundo plano. La cola sube cuando la app está abierta, porque iOS no
  soporta la Background Sync API. Cerrar la pestaña con cambios pendientes los deja pendientes hasta
  la próxima vez que se abra. Es una limitación real y la interfaz debe hacerla visible (sección 9).
- No hay fusión semántica. Dos personas editando el mismo campo a la vez: gana la última (D-017). Con
  dos usuarios y una ventana de minutos u horas (D-015), el caso es raro y el coste de resolverlo
  bien es desproporcionado.
- No hay resolución manual de conflictos. Nunca se le pregunta al usuario "¿cuál de estas dos
  versiones prefieres?". Todas las colisiones se resuelven solas según C-001 a C-004.

---

## 2. Las piezas

```
Acción del usuario
      │
      ├─► escritura optimista en la caché  ──► la interfaz ya muestra el resultado
      │
      └─► mutación encolada
                │
                │  (si hay red: sale ya. Si no: espera)
                ▼
          sync_push  ──►  Postgres  ──► Realtime ──► el otro dispositivo
                                   └──► delta pull ──► este dispositivo al reconectar
```

| Pieza | Responsabilidad |
|-------|-----------------|
| Caché de TanStack Query | Fuente de verdad de la interfaz. Nunca se lee de la red para pintar. |
| Persistidor en IndexedDB | Sobrevive al cierre de la app. Desechable. |
| Cola de salida | Mutaciones pendientes de subir. **No** desechable. |
| `sync_push` | Función de Postgres que aplica los parches campo a campo (D-025). |
| Realtime | Baja cambios ajenos con baja latencia. Best-effort. |
| Delta pull | Recupera lo que Realtime se perdió. La red de seguridad. |

---

## 3. Ciclo de vida

### 3.1. Primer arranque tras unirse al hogar

Descarga completa de las cuatro tablas del hogar (D-016). Son cientos de filas: una consulta por
tabla y listo. Se guarda el cursor `last_sync_at` con el `now()` que devuelve el servidor, nunca con
la hora local.

### 3.2. Arranque con caché

1. Se hidrata la caché desde IndexedDB y **se pinta de inmediato**. La app es usable antes de que
   haya ocurrido una sola llamada de red.
2. Se reanuda la cola de salida (sección 4).
3. Se lanza un delta pull desde `last_sync_at`.
4. Se abre la suscripción de Realtime.

Ese orden importa: **primero subir, luego bajar**. Si se baja antes, los cambios locales aún no
enviados podrían verse pisados en pantalla por el estado antiguo del servidor y provocar un parpadeo,
aunque la fusión acabe resolviéndolo bien.

### 3.3. En marcha

Cada acción escribe en la caché y encola su mutación. Con red, la cola se drena sola. Realtime va
aplicando lo que llega del otro dispositivo.

### 3.4. Pérdida de conexión

Las mutaciones se pausan y se acumulan. La interfaz sigue funcionando entera: consultar, marcar,
agregar, quitar y modificar (RF-024).

Aviso sobre la detección: `navigator.onLine` miente. Da "en línea" con wifi de hotel sin salida o con
un pasillo de supermercado con una barra de cobertura muerta. Se usa como señal, pero la verdad la
dan los fallos reales de petición: si una subida falla por red, se considera desconectado aunque el
navegador diga lo contrario.

### 3.5. Recuperación

Al volver la red: subir la cola primero, luego delta pull desde el cursor, y reabrir Realtime si se
cayó. También se dispara al volver la pestaña a primer plano, porque en iOS una pestaña en segundo
plano se congela y la conexión de Realtime muere en silencio.

---

## 4. La cola de salida

### 4.1. Forma

Cada entrada es un parche: entidad, id, campos modificados y la marca de tiempo del momento en que el
usuario actuó (no del momento del envío). Nunca se envía la fila entera: solo lo que cambió. Es lo
que permite que C-003 se resuelva bien.

### 4.2. Orden serial, no paralelo

Las mutaciones **deben salir en orden y de una en una**. Si se envían en paralelo, la inserción de un
`list_item` puede adelantar a la del producto al que apunta y llegar a un padre que todavía no
existe.

En TanStack Query esto se consigue dándoles a todas el mismo `scope`:

```ts
useMutation({ scope: { id: 'sync' }, /* … */ })
```

Las mutaciones que comparten `scope.id` se ejecutan en serie. Sin esto, la cola es una carrera.

**Trampa de la persistencia:** una mutación rehidratada desde IndexedDB no trae su función, porque las
funciones no se serializan. Hay que registrar `queryClient.setMutationDefaults(key, { mutationFn })`
al arrancar la app, **antes** de hidratar. Si se olvida, las mutaciones pendientes se reanudan sin
nada que ejecutar y desaparecen sin ruido: se pierden cambios y nadie se entera.

### 4.3. Un lote, sin coalescencia

La cola pendiente se envía **entera en una sola llamada**, aplicada de forma atómica dentro de la
función. Para dos personas, la cola siempre cabe: volver de una hora sin cobertura son cien parches,
que es una petición, no cien.

Una versión anterior de este documento colapsaba entradas repetidas sobre el mismo campo antes de
enviar. Se ha quitado. Su justificación era el número de peticiones, y eso ya lo resuelve el lote; a
cambio era la pieza con la superficie de error más sutil de todo el sistema, porque había que
preservar la semántica de las marcas de tiempo y no colapsar nunca a través de un borrado. Si algún
día el tamaño del cuerpo molesta, se añade entonces.

---

## 5. Errores, reintentos y cuarentena

### 5.1. Clasificación

No todos los fallos merecen el mismo trato. Reintentar eternamente algo que nunca va a funcionar
congela la cola entera detrás de él.

| Tipo | Ejemplos | Tratamiento |
|------|----------|-------------|
| **Transitorio** | Sin red, timeout, 5xx, Postgres no disponible | Reintento con backoff, indefinidamente. Es una cola, no tiene prisa. |
| **De sesión** | 401, JWT caducado | Refrescar la sesión y reintentar una vez. Si vuelve a fallar, pasa a permanente. |
| **Permanente** | 400, violación de restricción, dato que no valida, RLS deniega | **Cuarentena.** No se reintenta. |

### 5.2. Backoff

Exponencial desde 1 s, duplicando, con tope de 60 s y jitter de ±30 %. El tope es bajo a propósito:
esta app se abre durante veinte minutos en un supermercado, y un backoff que crece hasta diez minutos
equivale a no reintentar nunca. El jitter evita que los dos dispositivos reintenten sincronizados.

### 5.3. Cuarentena y bloqueo de cabecera

Una mutación permanentemente rota no puede quedarse al frente de la cola bloqueando a las demás. Se
aparta a cuarentena y la cola sigue.

Con una salvedad: **las dependientes se van con ella**. Si se descarta la creación de un producto, la
inserción de su item de lista no tiene padre y se descarta también. La regla es sencilla porque el
grafo lo es: un `list_item` depende de su producto; un producto depende de su supermercado y su
categoría, pero como esas referencias son anulables (D-002, D-004), basta con anularlas en lugar de
descartar el producto.

Lo que hay en cuarentena es visible para el usuario (sección 9) y nunca se borra solo y en silencio.

Pero la interfaz de cuarentena se queda en una franja con el número y un botón de copiar el detalle,
no un inspector con descarte por elemento. Con dos usuarios, cuatro tablas y una RLS que o funciona o
no, un error permanente es sinónimo de bug propio: lo que hace falta es poder pegarlo en un informe,
no administrarlo. El inspector se construye el día que haga falta, si llega.

---

## 6. La bajada de cambios

### 6.1. Realtime no es la fuente de verdad

Realtime da la latencia baja que pide RF-016, pero **no reproduce lo que ocurrió mientras el socket
estaba caído**. Si se confía solo en él, cada desconexión deja un agujero permanente en el estado
local.

Por eso hay un delta pull en cada uno de estos momentos: al arrancar, al recuperar la red, al volver
la pestaña a primer plano y al reconectar el socket.

```sql
select * from products
where household_id = :hogar and updated_at > :cursor
order by updated_at;
```

Se aplica a las cuatro tablas. Las filas llegan como upsert por id, así que solaparse no hace daño.
Se incluyen las lápidas: enterarse de un borrado es exactamente para lo que existen (D-026).

**Con multi-hogar (D-043, D-044), `:hogar` es el hogar activo** y nada más: la sincronización no
sigue en segundo plano los hogares no activos. El cursor deja de ser uno por tabla y pasa a ser uno
por `(hogar, tabla)` —clave `sync:cursor:<householdId>:<entity>`—; si se comparte el cursor entre
hogares, cambiar de activo se salta filas del nuevo en silencio. Cambiar de hogar recarga la app, así
que el motor arranca limpio con el `householdId` nuevo.

Esto solo funciona si `updated_at` se mueve en cada escritura. El `default now()` de la columna
**solo dispara en el insert**, así que hace falta un trigger; sin él, el delta pull no baja jamás una
fila editada y nadie se entera hasta que alguien pregunta por qué su cambio no llegó al otro móvil.

### 6.2. Un solo reductor, y el eco de las escrituras propias

Aplicar una fila que llega por Realtime y aplicar una fila que llega por delta pull son **la misma
operación**, y se escribe una sola vez: upsert por id, descartando el payload cuyo `field_updated_at`
sea anterior al que ya hay en local.

Esa comparación no es un refinamiento, es lo que resuelve el eco: **tu propia escritura vuelve por
Realtime**, y puede llegar con un valor más viejo que el que tienes en local si mientras tanto has
vuelto a tocar el mismo campo y ese parche sigue en la cola. Sin la comparación, el servidor te pisa
tu propio cambio y lo ves deshacerse en pantalla.

### 6.3. Dos relojes para dos trabajos

Es la parte del diseño más fácil de estropear:

- **`field_updated_at` usa la hora del cliente**, acotada al `now()` del servidor (D-025). Tiene que
  ser la del cliente porque representa *cuándo decidió el usuario*, que puede haber sido hace una
  hora sin cobertura.
- **`updated_at` usa siempre `now()` del servidor**, porque es el cursor de la sincronización. Si un
  cliente con el reloj atrasado escribiera ahí, su fila quedaría por detrás del cursor de otro
  dispositivo y **no se descargaría jamás**.

El cursor se retrasa un margen de 5 segundos al guardarlo, para cubrir el hueco entre el `now()` de
una transacción y el momento en que se hace visible al confirmarse. Se reprocesan unas pocas filas de
más y no pasa nada, porque los upserts son idempotentes.

---

## 7. Sesión y autenticación sin conexión

La sesión anónima (D-020) tiene un token de acceso de vida corta y uno de refresco de vida larga. Sin
red, el refresco falla; hay que asegurarse de que el cliente **no interprete ese fallo como un cierre
de sesión**, o al recuperar la conexión el usuario se encontraría fuera de su hogar con la cola llena
de cambios que ya no puede subir.

Antes de drenar la cola se comprueba que hay sesión válida y, si hace falta, se refresca. Solo
entonces se envía.

Si el token de refresco llega a caducar del todo (semanas sin abrir la app), la recuperación es el
código del hogar de D-014: se vuelve a entrar con él y se recupera el acceso. Los cambios que
quedaran en cola pertenecen a una identidad anónima distinta, así que **esa es la única situación en
la que se pueden perder cambios pendientes**. Es aceptable: para llegar ahí hay que pasar semanas sin
abrir una app que se usa cada semana.

---

## 8. Almacenamiento local

### 8.1. La caché es desechable, la cola no

Es la distinción que hay que respetar en el código, y no viene dada por la librería:

- La **caché de consultas** se puede tirar entera en cualquier momento. Se recupera con un bootstrap.
  Lleva una clave de versión de esquema; si la versión de la app no coincide, se descarta sin
  preguntar.
- La **cola de salida** contiene los únicos datos que no existen en ningún otro sitio. Vive en su
  propio almacén de IndexedDB, con su propio versionado, para que una subida de versión del esquema
  de la caché no se lleve por delante cambios sin enviar.

### 8.2. Validación al leer

Todo lo que sale de IndexedDB pasa por Zod (D-023). Una caché escrita por una versión anterior de la
app puede tener otra forma; si no valida, se descarta esa parte y se rehace el bootstrap. La app
nunca revienta por una caché vieja.

### 8.3. Desalojo

Safari puede purgar el almacenamiento, sobre todo si la app no está en la pantalla de inicio (D-018).
Se pide `navigator.storage.persist()` al vincular el hogar, que en una PWA instalada suele
concederse. Si aun así se purga: la caché se rehace desde el servidor y solo se pierde lo que
estuviera en cola. Es el riesgo residual asumido en D-018.

### 8.4. Varias pestañas

Dos pestañas abiertas drenarán la cola a la vez. La corrección está a salvo porque las escrituras son
idempotentes (D-025), así que se acepta y ya. Si algún día molesta el tráfico duplicado, se resuelve
con una elección de líder por `BroadcastChannel`; no vale la pena antes.

---

## 9. Qué ve el usuario

La sincronización no debe pedir atención salvo cuando algo va mal.

| Estado | Señal |
|--------|-------|
| Al día | Indicador discreto. Sin ruido, sin animaciones. |
| Subiendo | Igual de discreto. El usuario ya vio su cambio aplicado; que esté viajando no es asunto suyo. |
| Sin conexión | Marca visible y permanente, con el número de cambios pendientes. |
| Cambios en cuarentena | Franja única con el número y una acción de copiar el detalle al portapapeles. |

Dos reglas de interacción:

1. **Ninguna acción muestra un indicador de carga.** Todas las escrituras son optimistas: el resultado
   se pinta antes de que salga la petición. Un spinner al marcar un producto sería exactamente la
   fricción que prohíbe RNF-001.
2. **Nada se revierte solo delante del usuario.** Si una mutación acaba en cuarentena, el estado local
   se mantiene y se avisa. Ver cómo tu cambio se deshace solo, en silencio, mientras estás en el
   pasillo, es peor que un aviso.

Y como no hay sincronización en segundo plano, el contador de pendientes tiene que ser visible **antes**
de cerrar la app, no solo al abrirla.

---

## 10. El service worker

Cachea **el armazón de la aplicación** y nada más: HTML, JavaScript, CSS, fuentes e iconos. Eso es lo
que hace que la app abra sin conexión y lo que cumple RF-024 y RNF-003.

**No cachea las llamadas a Supabase.** Van en modo solo-red. Si el service worker sirviera respuestas
de la API desde su propia caché, habría dos cachés compitiendo con criterios de invalidación
distintos, y la interfaz acabaría mostrando datos más viejos que los de IndexedDB. Los datos offline
salen de la réplica local, no del service worker.

Estrategia de actualización: precacheo del armazón y aviso al usuario cuando hay versión nueva, sin
recargar por sorpresa; recargar la página en mitad de una compra, con cambios en cola, es la peor
forma posible de estrenar una versión.

---

## 11. Escenario completo

Los dos están en Supermu. Un móvil se queda sin cobertura en el fondo del pasillo de congelados.

1. **A** (sin cobertura) marca leche, huevos y queso. Los tres se tachan al instante. La cola acumula
   tres parches. El indicador muestra "3 pendientes, sin conexión".
2. **B** (con cobertura) marca el pan y agrega mantequilla, que se le había olvidado. Sube al momento.
3. **A** vuelve a tener señal al salir del pasillo. La cola se drena en serie, en una sola llamada de
   tres parches. Acto seguido, delta pull: le bajan el pan marcado y la mantequilla nueva.
4. **A** finaliza la compra de Supermu. La operación va con los ids explícitos de lo marcado en ese
   momento (D-001). La mantequilla, que **B** agregó hace un minuto y nadie marcó, no entra en la
   operación y se queda en la lista (C-002, RN-005).
5. **B** ve desaparecer los comprados por Realtime, en un par de segundos.
6. La mantequilla y lo no marcado siguen en la lista. Todo sigue en el catálogo (RN-004).

---

## 12. Qué hay que probar

La sincronización es donde se esconden los fallos difíciles, y casi todos se prueban sin red de
verdad:

- **Unitario (Vitest):** la clasificación de errores, el cálculo del backoff, el reductor de filas
  remotas y la lógica de fusión por campo, incluida la acotación de relojes adelantados.
- **Integración contra Postgres:** los conflictos C-001 a C-007, cada uno como un caso que aplica dos
  parches en ambos órdenes posibles y comprueba que el estado final es el mismo.
- **Extremo a extremo (Playwright):** el escenario de la sección 11 completo, con la red cortada a
  mitad, y el caso de cerrar la app con la cola llena y reabrirla.
- **A mano, en un iPhone real.** Playwright ejecuta WebKit de escritorio, no Safari de iOS, y ahí
  **no se reproducen** el desalojo de almacenamiento, la congelación de la pestaña en segundo plano
  ni la muerte silenciosa del socket. El extremo a extremo complementa la prueba manual, no la
  sustituye: abrir en modo avión desde la pantalla de inicio hay que verlo en el teléfono.
