# Arquitectura funcional

**Versión:** 0.1
**Fecha:** 2026-09-06
**Depende de:** `analisis_requerimientos_funcionales_app_mercado_v0.1.md` (ARF) y
`decisiones_cerradas_v0.1.md` (decisiones `D-0xx` y conflictos `C-0xx`).

Define el modelo de datos, las operaciones del dominio y la forma de la aplicación. El SQL es la
**forma** del esquema, no la migración final. La experiencia de usuario y el detalle del protocolo de
sincronización van en documentos aparte.

---

## 1. Forma general

La aplicación es **local-first**: la interfaz nunca lee de la red. Lee de una réplica local del
hogar y escribe en ella; la sincronización con Supabase ocurre por detrás y es la que puede fallar,
no la interfaz.

```
   Interfaz (React)
        │  lee y escribe
        ▼
   Caché de TanStack Query          ← fuente de verdad de la interfaz
        │  persistida en
        ▼
   IndexedDB (réplica del hogar)    ← D-016: réplica completa, sin selectividad
        │
        │  cola de mutaciones pendientes (D-022)
        ▼
   Supabase ── Postgres + RLS
        │
        └── Realtime ──► el otro dispositivo
```

Tres consecuencias que atraviesan todo el diseño:

1. **Los identificadores se generan en el cliente** (D-024), porque crear sin red exige tener el id
   antes de hablar con el servidor.
2. **Todas las escrituras son idempotentes** (D-025), porque una mutación en cola puede reenviarse.
3. **Nada se borra de verdad** (D-026), porque un dispositivo desconectado no puede enterarse de una
   fila que desapareció.

---

## 2. Entidades

```
households ─┬─ household_members
            ├─ supermarkets
            ├─ categories
            └─ products ── list_items
```

Toda fila cuelga de un `household_id`. Es la unidad de aislamiento: las políticas de seguridad se
escriben una vez contra esa columna y valen para todo.

### 2.1. Columnas comunes de las entidades sincronizadas

`supermarkets`, `categories`, `products` y `list_items` comparten:

| Columna | Papel |
|---------|-------|
| `id uuid` | Clave primaria, **generada en el cliente** (D-024). |
| `household_id uuid` | Aislamiento y base de las políticas RLS. |
| `created_at`, `updated_at` | Metadatos; `updated_at` sirve para la sincronización por delta. |
| `deleted_at` / `removed_at` | Lápida (D-026). Nulo significa vivo. |
| `field_updated_at jsonb` | Marca de tiempo **por campo** para la fusión de D-017 y D-025. |

### 2.2. Esquema

```sql
create table households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table supermarkets (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

create table categories (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  position         int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

create table products (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  name             text not null,
  brand            text,                                    -- opcional, RF-012 / D-005
  category_id      uuid references categories(id) on delete set null,
  supermarket_id   uuid references supermarkets(id) on delete set null,  -- opcional, D-002
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  field_updated_at jsonb not null default '{}'::jsonb
);

create table list_items (
  id               uuid primary key,
  household_id     uuid not null references households(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  quantity         int  not null default 1 check (quantity > 0),   -- RF-011 / D-010
  checked          boolean not null default false,                 -- RF-015
  checked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_reason   text check (removed_reason in ('purchased', 'removed')),
  field_updated_at jsonb not null default '{}'::jsonb
);

-- Un producto está en la lista, o no está. No puede estar dos veces.
create unique index list_items_one_active_per_product
  on list_items (product_id) where removed_at is null;
```

### 2.3. Por qué el modelo tiene esta forma

**`list_items` es una entidad y no un campo `en_lista` sobre el producto** (D-003). Es lo que permite
que la cantidad y el marcado sean propiedad de *esa ocasión* y no del producto (RN-006), y lo que
sostiene la separación catálogo/lista que es el corazón del ARF (RN-001).

**El índice único parcial es la traducción literal de "un producto está o no está en la lista".** Al
ser parcial sobre `removed_at is null`, un producto puede tener muchos items históricos y como mucho
uno activo, que es exactamente lo que se necesita para que el historial de V2 no rompa nada.

**`removed_reason` distingue "lo compré" de "lo quité"**, que son las dos maneras de salir de la
lista (RF-010 y RF-017). Cuesta una columna y regala el historial (D-026).

**El item no guarda el supermercado**: lo deriva del producto (D-027). La sección en la que aparece
un item es `product.supermarket_id`, resuelto en el momento de pintar.

**`supermarket_id` y `category_id` son anulables** (D-002, D-004). Los productos sin supermercado
forman el grupo "Sin asignar" al final de la lista.

### 2.4. Espacio reservado para el futuro

No se implementan, pero el modelo les deja sitio sin migración destructiva (RNF-006):

- **Orden de recorrido por supermercado** (RF-021): tabla
  `supermarket_category_positions (supermarket_id, category_id, position)`. Las `position` actuales de
  `categories` son el orden global por defecto, que esa tabla sobreescribiría por supermercado.
- **Sucursales** (decisión abierta #4): `supermarkets` gana una referencia a una cadena padre, o una
  autorreferencia. Los productos seguirían apuntando a la cadena, no a la sucursal.
- **Historial** : ya está, son los `list_items` con `removed_at` no nulo.
- **Más de dos usuarios**: `household_members` no impone límite alguno.

---

## 3. Operaciones del dominio

Cada operación tiene un efecto **local inmediato** (optimista, es lo que ve el usuario) y una
**mutación encolada**. Si no hay red, el efecto local ocurre igual y la mutación espera.

| Operación | Requisito | Efecto |
|-----------|-----------|--------|
| Crear producto | RF-001 | Inserta en `products`. **No** crea `list_item` (RN-001). Avisa si hay nombre similar (D-006). |
| Editar producto | RF-002, RF-007, RF-008 | Parche por campos sobre `products`. |
| Eliminar producto | RF-003 | `deleted_at`. Avisa antes si tiene item activo (C-004). El item activo se retira. |
| Crear / editar supermercado | RF-004, RF-005 | Inserta o parchea `supermarkets`. |
| Eliminar supermercado | RF-006 | `deleted_at`, y parche `supermarket_id = null` en cada producto afectado (D-002). |
| Agregar a la lista | RF-009 | Declara la **intención** de que el producto esté en la lista, con `quantity = 1` (D-010). Si ya existe un item activo para ese producto, se funde con él (C-005). |
| Crear y agregar | D-008 | Las dos anteriores en una sola mutación. |
| Quitar de la lista | RF-010 | `removed_at`, `removed_reason = 'removed'`. El producto sigue en el catálogo (RN-003). |
| Cambiar cantidad | RF-011 | Parche sobre `quantity`. |
| Marcar / desmarcar | RF-015 | Parche sobre `checked` y `checked_at`. No retira el item de la lista. |
| Finalizar compra | RF-017, D-001 | Un lote de parches sobre **una lista explícita de ids**: `removed_at`, `removed_reason = 'purchased'`. |
| Deshacer finalización | D-032 | Otro lote de parches sobre los mismos ids, poniendo `removed_at` a nulo (posible gracias a §4.1). |
| Crear hogar | RF-022 | Crea `households`, la membresía y siembra las categorías de RF-020. |
| Unirse al hogar | RF-022 | Añade membresía a partir del código. |
| Regenerar código | D-014 | Sustituye `join_code`. |

**Finalizar compra recibe ids explícitos, no una condición.** Ejecuta sobre los items que estaban
marcados cuando se pulsó el botón, no sobre "todo lo marcado ahora". Es lo que hace determinista el
conflicto C-002: lo que el otro usuario agregó mientras tanto no entra en la operación. Como la
operación es por supermercado (D-001), la lista de ids se limita además a esa sección.

**Y no tiene función propia: es un lote de parches como cualquier otro.** Una `finish_purchase`
separada sería un segundo camino de escritura, sin cola, sin reintentos y sin comportamiento offline,
justo para la acción que se pulsa en la fila de la caja, que es donde peor va la cobertura. Pasando
por `sync_push` sale gratis: funciona sin conexión, deshacer es otro lote, y C-002 se sigue
cumpliendo porque los ids son explícitos.

**Agregar a la lista es una intención, no una fila.** Si A y B agregan leche casi a la vez, cada uno
con su id de cliente, llegan dos filas con el mismo `product_id` activo y el índice único parcial
rechaza la segunda. Ese rechazo sería un error permanente, es decir, cuarentena visible para el
usuario por el suceso más cotidiano que existe en esta app: que los dos se acuerden del pan.

Se resuelve en dos sitios. En `sync_push`, la inserción de un item se funde con el activo que ya
exista para ese producto en lugar de insertar (C-005). Y en el cliente, **los items se indexan por
`product_id`, no por su id**: como el dominio garantiza que hay como mucho uno activo por producto,
`product_id` es su clave natural, y así no hace falta reconciliar el id local con el que gana en el
servidor.

---

## 4. Escritura y fusión

Todas las mutaciones entran por una única función de Postgres que recibe un lote y lo aplica de forma
atómica. El cliente envía, por cada cambio, la entidad, el id, **solo los campos modificados** y la
marca de tiempo en la que el usuario hizo el cambio.

```
sync_push([
  { entity: 'list_items', id: '…', ts: '2026-09-06T10:04:11Z',
    fields: { checked: true, checked_at: '2026-09-06T10:04:11Z' } },
  …
])
```

La función aplica, campo a campo:

```
para cada campo del parche:
    si  ts_del_parche > field_updated_at[campo]:
        escribe el campo
        field_updated_at[campo] := ts_del_parche
    si no:
        lo descarta silenciosamente
```

De aquí salen cuatro propiedades que el diseño necesita:

- **El orden de llegada da igual.** Dos dispositivos que sincronizan en orden distinto convergen al
  mismo estado (RNF-004).
- **Reenviar es inofensivo.** Aplicar dos veces el mismo parche no cambia nada, que es la condición
  que exigía D-022 para reanudar mutaciones sin duplicar.
- **Editar campos distintos a la vez no se pisa** (C-003): si uno cambia la marca y el otro la
  categoría sin conexión, sobreviven ambos.
### 4.1. Dos clases de lápida

Esta distinción es obligatoria y no se puede simplificar, aunque tenga toda la pinta de poderse:

- **`deleted_at` es absorbente.** En `products`, `supermarkets` y `categories`, borrar es definitivo
  (RF-003) y ningún parche posterior resucita la fila. De aquí sale C-004 sin código adicional.
- **`removed_at` de `list_items` NO es absorbente.** Es un campo más, sujeto a la misma regla de
  último-en-escribir-gana que los demás, con su entrada en `field_updated_at`.

El motivo es que **deshacer la finalización (D-032) es exactamente resucitar una lápida**. Si
`removed_at` fuese absorbente, el parche del deshacer se descartaría en el servidor en silencio: el
usuario vería la compra reaparecer en su pantalla y desaparecer de nuevo en el siguiente delta pull,
que además viola la regla de UX de que nada se revierte solo delante del usuario.

Como C-001 ya no sale gratis de la lápida, se escribe como regla explícita en `sync_push`:

```
si el item tiene removed_at no nulo:
    un parche que solo toca `checked` se descarta        ← C-001, quitar gana sobre marcar
    un parche que toca `removed_at` se aplica por timestamp   ← permite deshacer
```

### 4.2. Reglas del servidor que no son opcionales

Cada una tapa un fallo silencioso, que es la peor clase:

- **Trigger de `updated_at`.** Un `before update` que fuerce `updated_at = now()` en las cuatro
  tablas. El `default now()` de la columna **solo dispara en el insert**; sin el trigger, el delta
  pull no baja jamás una fila editada y todo parece funcionar hasta que alguien edita algo y el otro
  dispositivo no se entera nunca.
- **Escritura solo vía `sync_push`.** Las políticas RLS conceden `select`, pero no `insert` ni
  `update` directos: se escribe a través de la función, que es `security definer`. Así la disciplina
  de la costura única deja de ser un acuerdo de caballeros y pasa a ser una restricción del servidor,
  que es lo único que sobrevive a seis meses de desarrollo.
- **Sin `default gen_random_uuid()`** en las cuatro tablas sincronizadas. Un insert que se olvide del
  id de cliente debe fallar en el acto en lugar de degradar en silencio, que es lo que convierte
  D-024 de convención en garantía.
- **Publicación de Realtime.** Las cuatro tablas se añaden a `supabase_realtime` por migración.
- **Desempate de orden.** `supermarkets.position` empata a `0` por defecto; el orden de las secciones
  se resuelve por `(position, created_at)`, o dos dispositivos pintan las secciones en orden distinto.

### 4.3. Detalles con trampa

- **Relojes.** Con último-en-escribir-gana, un móvil con la hora adelantada ganaría siempre. La marca
  del cliente se acota al `now()` del servidor antes de comparar (D-025).
- **Insertar contra un padre borrado.** La clave ajena **no** protege aquí, porque con borrado lógico
  la fila del producto sigue existiendo. `sync_push` comprueba explícitamente `products.deleted_at` y
  descarta el item; y el cliente filtra al pintar los items cuyo producto esté borrado, o el
  dispositivo que estaba sin conexión enseña una fila fantasma.
- **Producto que apunta a un supermercado borrado.** Puede ocurrir si uno borra el supermercado
  mientras el otro asigna un producto a él con marca de tiempo posterior. Regla de pintado: un
  producto cuyo supermercado esté borrado cae en "Sin asignar".
- **`quantity` es un valor, no un contador.** Dos personas tocando `+` a la vez producen 2, no 3. Es
  consecuencia asumida de C-003 y conviene tenerlo escrito antes de que parezca un fallo.

La lectura inicial es una descarga completa del hogar (D-016) y a partir de ahí incrementos por
`updated_at`. Realtime cubre el tiempo real de RF-016 mientras haya conexión; la sincronización por
delta cubre la vuelta tras un rato sin ella.

---

## 5. Seguridad

El hogar es la frontera. Con autenticación anónima (D-020), **sin RLS cualquiera con la clave pública
leería todos los hogares**, así que las políticas no son opcional.

```sql
create function is_member(p_household uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from household_members
      where household_id = p_household and user_id = auth.uid()
    );
  $$;
```

La función es `security definer` a propósito: una política sobre `household_members` que consultase
`household_members` entraría en recursión infinita, que es la trampa clásica de RLS en Supabase.
Sobre cada tabla del hogar la política es entonces `is_member(household_id)`, tanto para lectura como
para escritura.

**Unirse a un hogar** (RF-022) va en una función `security definer`, porque el que se une todavía no
es miembro y por tanto no puede ver la fila del hogar para buscarla por código.

El código de unión (D-014) es permanente y reutilizable, así que es una credencial de facto: ocho
caracteres de un alfabeto sin ambigüedades visuales (sin `O`/`0` ni `I`/`1`), y conviene limitar el
ritmo de intentos contra la función de unión para que no se pueda barrer por fuerza bruta.

---

## 6. Trazabilidad

| Requisito | Dónde se resuelve |
|-----------|-------------------|
| RN-001, RN-003, RN-004 | `list_items` como entidad separada, y `removed_at` en vez de borrar el producto. |
| RN-005 (los no comprados permanecen) | Finalizar solo toca los ids marcados; el resto queda intacto. |
| RN-006 (cantidad de esa ocasión) | `quantity` vive en `list_items`, nunca en `products`. |
| RN-010, RF-014 | Agrupación por `product.supermarket_id`, con "Sin asignar" al final. |
| RF-016 | Supabase Realtime sobre las cuatro tablas del hogar. |
| RF-024, RNF-003 | Réplica en IndexedDB, escrituras optimistas y cola de mutaciones. |
| RNF-004 (convergencia) | Fusión por campo, independiente del orden de llegada. |
| RNF-006 | Lápidas como semilla de historial; huecos reservados de la sección 2.4. |

---

## 7. Lo que este documento no cierra

- El diseño de pantallas y la interacción concreta (van en el documento de UX).
- El protocolo de sincronización a nivel de detalle: tamaño de lote, reintentos, backoff y qué se le
  muestra al usuario mientras hay mutaciones pendientes (documento de sincronización).
- El texto exacto de las migraciones y las políticas RLS, que se escribirán con el CLI de Supabase.
