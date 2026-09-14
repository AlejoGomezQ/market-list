# Plan — Multi-hogar y copia de catálogo entre hogares

**Versión:** 0.1
**Fecha:** 2026-09-08
**Depende de:** `analisis_requerimientos_funcionales_app_mercado_v0.1.md`, `decisiones_cerradas_v0.1.md`,
`arquitectura_funcional_v0.1.md`, `estrategia_sincronizacion_v0.1.md`, `experiencia_usuario_v0.1.md`,
`identidad_visual_v0.1.md`, `backlog_v2.md` §1 y §2.
**Estado del código:** el repositorio está muy por delante de las specs v0.1 (implementación hasta
~Fase 7: dominio, sincronización, offline, historial de compras, Sentry). `CLAUDE.md` §"Estado del
repositorio" está obsoleto y se corrige en la Fase E de este plan.

---

## 1. Alcance

Dos features del backlog de V2, que se construyen juntas porque la segunda depende de la primera.

### 1.1. Multi-hogar (`backlog_v2.md` §1)

Un dispositivo puede **pertenecer a varios hogares** y **cambiar cuál está activo**. Hoy pertenece a
uno solo: `src/lib/household-link.ts` guarda un único vínculo en `localStorage`, y el guardia del
router (`src/router.tsx`) solo distingue "tiene hogar" / "no tiene hogar".

El esquema SQL **ya soporta la relación N:M**: `household_members` tiene PK `(household_id, user_id)`
sin `unique(user_id)`, la función `is_member(p_household)` comprueba pertenencia a un hogar concreto
(no "el hogar del usuario"), y todas las políticas RLS son `is_member(household_id)` fila a fila. El
trabajo es **de cliente y de firmas de RPC**, no de esquema.

### 1.2. Copiar el catálogo de un hogar a otro (`backlog_v2.md` §2)

Una familia nueva parte del catálogo de otro hogar en vez de dar de alta ~100 productos a mano. Se
copian **productos + sus categorías + sus supermercados**, con identificadores nuevos, remapeando
`category_id` y `supermarket_id`. **No** se copian items de lista (son de la ocasión) ni lápidas.

### 1.3. Fuera de este plan

- Copiar la **lista de compra activa** (`list_items`) entre hogares. Se descartó: la lista es de la
  ocasión, no del catálogo, y fundir dos listas activas choca con `list_items_one_active_per_product`
  y con C-005. Decisión del usuario, 2026-09-08.
- Sincronizar el "hogar activo" **entre los dos dispositivos** de la misma persona. Vive solo en
  `localStorage` de cada dispositivo (D-043).
- Mantener sincronizados en segundo plano los hogares **no activos** (D-044).
- Un límite de hogares por dispositivo, o roles/permisos entre hogares (RN-009: todos los miembros
  son iguales).

---

## 2. Decisiones nuevas (D-043 … D-053)

Se incorporan a `decisiones_cerradas_v0.1.md` en la Fase E. No se vuelven a plantear.

### D-043 — Un dispositivo puede pertenecer a varios hogares; el "hogar activo" es local

El vínculo local pasa de un objeto a `{ households: HouseholdLink[], activeId: string }`. El hogar
activo **no se sincroniza**: cada dispositivo (incluidos los dos de una misma persona) elige el suyo.
No hay columna ni tabla en el servidor para esto. `households` sigue sin `deleted_at`: los hogares no
se borran.

### D-044 — La sincronización opera solo sobre el hogar activo

Realtime, delta pull y la cola de salida trabajan únicamente sobre el hogar activo. Al **cambiar de
hogar la app se recarga** (`window.location.assign`), igual que hoy al salir de un hogar
(`src/routes/ajustes-screen.tsx`). Tras la recarga, `useSyncEngine` monta con el `householdId` nuevo
y hace su delta pull normal.

Consecuencia obligatoria: **los cursores del delta pull pasan a llevar el `householdId` en la
clave**. Hoy son `sync:cursor:<entity>` (globales al dispositivo, `src/lib/sync/delta-pull.ts:28`);
pasan a `sync:cursor:<householdId>:<entity>`. Sin esto, cambiar de hogar reutilizaría el cursor del
anterior y **se saltaría filas** del nuevo.

Contrapartida asumida: el hogar no activo puede quedar algo desfasado en local hasta que se vuelva a
él (entonces un delta pull lo pone al día desde su propio cursor). Para dos personas y compras
esporádicas, es irrelevante.

> `ponytail:` el cambio de hogar es una recarga completa, no un cambio en caliente. Es el patrón que
> ya usan "salir del hogar" y "regenerar código". Si cambiar de hogar resulta ser una acción
> frecuente, se convierte el vínculo en un store observable y se elimina la recarga.

### D-045 — El selector de hogar vive en Ajustes, como primera sección

No va en la cabecera de Mercado. Motivos: rompería el contrato del `<h1>Mercado</h1>` que usan los
tests (`src/App.test.tsx`), choca con el principio "lo que está arriba del todo es para mirar, no
para tocar" (`experiencia_usuario` §1), y la cabecera de Mercado ya está en su tope de dos iconos
(`identidad_visual` §5, comentario en `src/routes/mercado-screen.tsx:238`). Ajustes ya es la
superficie de gestión del hogar (nombre, código, regenerar, salir) y el patrón de drawer anidado ya
existe ahí.

Se coloca **como primera sección de Ajustes**, no enterrada al final, para que cambiar de hogar sea
lo más corto posible dentro de esa restricción (pestaña Catálogo → icono Ajustes → primera fila).

*Se revisará en Fase 8 si el uso real muestra que se cambia de hogar a menudo.*

### D-046 — "Añadir otro hogar" reutiliza la pantalla de onboarding

Se accede desde Ajustes con un botón "Añadir otro hogar", que navega a `/onboarding?add=1`. El
guardia de `onboardingRoute.beforeLoad` (`src/router.tsx:41`) se relaja para dejar pasar cuando
`add=1` aunque ya haya vínculo. En ese modo:

- La copia cambia: "Añadir otro hogar" en vez de "¿Empezamos?".
- Aparece una salida visible **"Cancelar"** que vuelve a `/catalogo/ajustes` (en pantalla completa no
  hay botón de atrás, `experiencia_usuario` §11).
- Al terminar `create` o `join`, se añade el vínculo, se fija como **activo** y se recarga en `/`.
- El paso de "dar de alta supermercados" tras crear se mantiene (un hogar nuevo vacío los necesita),
  salvo que el usuario venga del flujo de copia de catálogo, que ya los trae.

### D-047 — Salir de un hogar con otros pendientes hace limpieza selectiva

Hoy salir del hogar llama a `clearPersistedSyncState()` (`src/lib/query-client.ts:76`), que vacía
**toda** la caché, la cola, los cursores y la cuarentena. Con multi-hogar:

- Si quedan **otros hogares**: se quita solo ese vínculo, se eliminan sus 4 consultas de la caché
  (`queryClient.removeQueries({ queryKey: [entity, leftId] })`) y sus 4 cursores de IndexedDB, se
  fija otro hogar como activo y se recarga.
- Si era el **último**: comportamiento actual (limpiar todo + volver a `/onboarding`).

Los parches que quedaran en cola pertenecientes al hogar que se abandona (raro: la cola casi siempre
está vacía) fallarán el `is_member` en `sync_push` y acabarán en cuarentena. Es un caso poco
frecuente y con aviso legible ("No se pudieron guardar N cambios").

> `ponytail:` no se segmenta la cola por hogar. Las ediciones no llevan `household_id` (lo resuelve
> `sync_push` por el id de fila), así que filtrarla sería costoso para un caso que casi nunca ocurre.

### D-048 — `regenerate_household_code` y `leave_household` reciben `p_household_id`

Hoy derivan el hogar del llamador con `where user_id = auth.uid()` sin recibirlo
(`regenerate_household_code` con `limit 1` sin `order by`; `leave_household` borra **todas** las
membresías). Pasan a recibir `p_household_id uuid` explícito y validar `is_member(p_household_id)`.

- `leave_household(p_household_id)`: `delete from household_members where household_id = p_household_id
  and user_id = auth.uid()` — solo esa membresía.
- `regenerate_household_code(p_household_id)`: sustituye el `join_code` de ese hogar y mantiene la
  expulsión de **D-040** acotada a él: `delete from household_members where household_id =
  p_household_id and user_id <> auth.uid()`.

### D-049 — Copiar catálogo es una RPC transaccional, excepción acotada a D-039

`copy_catalog(p_source_household, p_target_household, …)`, `security definer`, con
`is_member` sobre **ambos** hogares, todo en **una transacción**.

Es una excepción deliberada y acotada a la regla "un solo camino de escritura" (D-039). Justificación:
es una operación **administrativa, en línea, no frecuente**, que debe ser **atómica** (100+ filas a
medio copiar es peor que no copiar), y tiene el **mismo precedente** que la siembra de 7 categorías
que `create_household` ya hace server-side fuera de la cola. El resultado lo recogen ambos
dispositivos del hogar destino por su delta pull normal (`updated_at` lo pone el trigger del
servidor); el dispositivo que inicia la copia fuerza un delta pull al recibir la respuesta.

No se implementa vía `sync_push` con ~100 parches: llenaría la cola, es lento y raro de observar a
medio camino. Decisión del usuario, 2026-09-08.

### D-050 — Qué copia `copy_catalog` y cómo resuelve duplicados

- **Supermercados y categorías**: se emparejan con los del destino por `lower(btrim(name))`. Los que
  ya existan en el destino se reutilizan; los que no, se crean con id nuevo (`gen_random_uuid()` en el
  `INSERT`, como las categorías de `create_household`). Un hogar recién creado ya trae las 7
  categorías de RF-020, así que "Lácteos" del origen se empareja con la del destino en vez de
  duplicarse.
- **Productos**: id nuevo, se remapean `category_id` y `supermarket_id` por los mapas anteriores, se
  copian `name` y `brand`. Un producto cuyo `(lower(name), lower(brand))` ya exista activo en el
  destino **se omite** — esto resuelve D-006 en masa (copiar a un catálogo no vacío no lo llena de
  "Leche" / "leche").
- **No se copian**: items de lista, lápidas (`deleted_at is not null` / `removed_at is not null`),
  ni `field_updated_at` del origen (las filas nuevas llevan `now()` en todos los campos).
- **`purchase_batch_id` / `purchase_total`**: no aplican (son de lápidas de `list_items`).

Propiedad útil: ejecutar `copy_catalog` dos veces seguidas es un **no-op** (todo empareja o se omite).

### D-051 — Para copiar de un hogar hay que ser miembro de él

`copy_catalog` exige `is_member` sobre origen y destino. El flujo de copia se apoya en "añadir otro
hogar" (D-046) para la entrada del código: **la feature de copia no tiene entrada de código propia**.
Solo añade, en la pantalla de Catálogo y en Ajustes, un selector de **origen entre los hogares a los
que ya perteneces**, dos casillas ("copiar también las categorías" / "copiar también los
supermercados", marcadas por defecto) y la llamada a la RPC.

Tras copiar **no** se ofrece salir del hogar de origen: si el usuario quiere hacerlo, usa "Salir de
este hogar" en Ajustes tras cambiar a ese hogar. Decisión del usuario, 2026-09-08.

Copiar es una acción **en línea**: su botón se desactiva sin conexión con un mensaje ("Necesitas
conexión para copiar un catálogo"). Es una excepción permitida a "sin indicador de carga" (RNF-001),
como ya lo es el botón de `join_household` en onboarding.

### D-052 — Color de los supermercados copiados

El color pertenece a los supermercados y sale de una paleta cerrada de 8 asignada por orden
(D-036). En `copy_catalog`:

- Supermercado que empareja con uno existente del destino: se conserva el color del destino.
- Supermercado nuevo: se asigna el **siguiente color libre** del destino (se saltan los ya usados).
  Si se agotan los 8, se reutiliza el primero (caso improbable con 2–3 supermercados por hogar).

### D-053 — `list_households()` (RPC) es la fuente de verdad del selector

Devuelve las membresías del llamador: `[{ household_id, name, join_code }]`. El selector de Ajustes
la usa para **mostrar la verdad** y **podar** hogares de los que te expulsaron (D-040/D-048) o que ya
no existen. El vínculo local sigue bastando para el camino feliz y para arrancar sin red; la
reconciliación con `list_households()` es un refresco best-effort al abrir Ajustes.

*Opcional en la Fase A; el resto del plan no la bloquea.*

---

## 3. Backend — SQL y wrappers de cliente

Todo en migraciones nuevas bajo `supabase/migrations/`, más los wrappers Zod en `src/lib/household.ts`.

### 3.1. `regenerate_household_code(p_household_id uuid)` — reemplaza la actual

```sql
create or replace function regenerate_household_code(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_code text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_member(p_household_id) then raise exception 'not a member'; end if;
  v_code := <generador de 8 chars, alfabeto sin O/0/I/1, reintento en colisión>;
  update households set join_code = v_code, updated_at = now() where id = p_household_id;
  delete from household_members where household_id = p_household_id and user_id <> v_uid; -- D-040
  return jsonb_build_object('household_id', p_household_id, 'join_code', v_code);
end $$;
```

Wrapper: `regenerateHouseholdCode(householdId)`.

### 3.2. `leave_household(p_household_id uuid)` — reemplaza la actual

```sql
create or replace function leave_household(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  delete from household_members where household_id = p_household_id and user_id = v_uid;
  return jsonb_build_object('left', true);
end $$;
```

Wrapper: `leaveHousehold(householdId)`.

### 3.3. `list_households()` — nueva (D-053)

```sql
create function list_households()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'household_id', h.id, 'name', h.name, 'join_code', h.join_code
  ) order by m.joined_at), '[]'::jsonb)
  from household_members m join households h on h.id = m.household_id
  where m.user_id = auth.uid();
$$;
```

Wrapper: `listHouseholds()` → `HouseholdLink[]`.

### 3.4. `copy_catalog(...)` — nueva (D-049, D-050, D-052)

```sql
create function copy_catalog(
  p_source_household uuid,
  p_target_household uuid,
  p_copy_supermarkets boolean default true,
  p_copy_categories   boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_sm  int := 0;  v_cat int := 0;  v_prod int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not is_member(p_source_household) then raise exception 'not a member of source'; end if;
  if not is_member(p_target_household) then raise exception 'not a member of target'; end if;
  if p_source_household = p_target_household then raise exception 'source equals target'; end if;

  -- mapa supermercados: empareja por nombre, crea los que falten con color libre
  create temp table _sm (src uuid primary key, tgt uuid) on commit drop;
  insert into _sm(src, tgt)
    select s.id, t.id
    from supermarkets s
    left join supermarkets t
      on t.household_id = p_target_household and t.deleted_at is null
     and lower(btrim(t.name)) = lower(btrim(s.name))
    where s.household_id = p_source_household and s.deleted_at is null;
  if p_copy_supermarkets then
    -- para cada _sm con tgt null: insert supermarkets (gen_random_uuid(), target, name,
    --   <siguiente color libre del destino>, field_updated_at = todos a v_now); update _sm.tgt
    -- v_sm := filas creadas
  end if;

  -- mapa categorías: idéntico patrón (empareja por nombre; crea con order = max+1)
  -- v_cat := filas creadas

  -- productos: uno por fila activa del origen que no exista ya en el destino por (name, brand)
  insert into products (id, household_id, name, brand, category_id, supermarket_id,
                        field_updated_at, created_at, updated_at)
    select gen_random_uuid(), p_target_household, p.name, p.brand,
           (select tgt from _cat where src = p.category_id),
           (select tgt from _sm  where src = p.supermarket_id),
           jsonb_build_object('name', v_now, 'brand', v_now,
                              'category_id', v_now, 'supermarket_id', v_now),
           v_now, v_now
    from products p
    where p.household_id = p_source_household and p.deleted_at is null
      and not exists (
        select 1 from products d
        where d.household_id = p_target_household and d.deleted_at is null
          and lower(btrim(d.name)) = lower(btrim(p.name))
          and coalesce(lower(btrim(d.brand)),'') = coalesce(lower(btrim(p.brand)),'')
      );
  get diagnostics v_prod = row_count;

  return jsonb_build_object('supermarkets_created', v_sm, 'categories_created', v_cat,
                            'products_copied', v_prod);
end $$;
```

Notas para quien lo implemente:
- El `updated_at` real lo pisa el trigger `set_updated_at` a `now()` del servidor — es el cursor
  (regla 6 de `CLAUDE.md`). El `v_now` de arriba es solo para `field_updated_at` y `created_at`.
- Verificar el nombre exacto de la columna de color y de orden de categoría en
  `20260906183410_domain_schema.sql`.
- `p_copy_supermarkets = false` deja los productos con `supermarket_id = null` ("Sin asignar");
  `p_copy_categories = false`, con `category_id = null`.

Wrapper: `copyCatalog(sourceId, targetId, opts?)` → `{ supermarketsCreated, categoriesCreated, productsCopied }`.

### 3.5. Pruebas de integración (`supabase/tests/`)

- `regenerate_household_code(A)` no toca el `join_code` de B; expulsa a los demás de A, no de B.
- `leave_household(A)` conserva la membresía en B.
- `list_households()` devuelve las dos; tras `leave_household(A)`, solo B.
- `copy_catalog` a destino vacío: reproduce el catálogo del origen con ids nuevos, `category_id` y
  `supermarket_id` remapeados, sin items de lista, sin lápidas.
- `copy_catalog` a destino con "Lácteos" y "Leche Alpina": no duplica la categoría ni el producto.
- `copy_catalog` con no-miembro del origen: excepción, transacción abortada, cero filas escritas.
- `copy_catalog` dos veces seguidas: la segunda devuelve todo a cero.

---

## 4. Cliente — vínculo local y motor de sincronización

### 4.1. `src/lib/household-link.ts` — forma nueva

```ts
// localStorage["market-list:household"]
type StoredLink = { households: HouseholdLink[]; activeId: string };
```

- **Migración transparente**: si al leer se encuentra el objeto viejo `{ householdId, name, joinCode }`,
  se envuelve en `{ households: [viejo], activeId: viejo.householdId }` y se reescribe.
- API:
  - `getHouseholdLink()` → **el vínculo activo** (`HouseholdLink | null`). Se mantiene para no tocar
    los ~8 llamadores actuales (`router.tsx`, `app-shell.tsx`, las pantallas).
  - `getHouseholdLinks()` → `HouseholdLink[]`.
  - `getActiveHouseholdId()` → `string | null`.
  - `setActiveHousehold(id)` → cambia `activeId` (el llamador recarga).
  - `addHouseholdLink(link)` → añade o actualiza por `householdId`; no cambia el activo salvo que se
    pida.
  - `removeHouseholdLink(id)` → quita; si era el activo, promueve el primero que quede.
  - `updateStoredJoinCode(joinCode, householdId?)` → por defecto sobre el activo.
- El guardia del router sigue siendo binario: `getHouseholdLinks().length > 0`.

### 4.2. `src/lib/sync/delta-pull.ts` — cursor por hogar

`CURSOR_KEY_PREFIX` pasa a componer `sync:cursor:<householdId>:<entity>`. `getCursor` / `setCursor`
reciben el `householdId` (ya disponible en `deltaPull(queryClient, householdId)`).

### 4.3. `src/lib/query-client.ts` — limpieza selectiva

- Nueva `clearHouseholdSyncState(householdId)`: `removeQueries` de las 4 claves `[entity, householdId]`
  + borra los 4 cursores `sync:cursor:<householdId>:*` de `queueStore`.
- `clearPersistedSyncState()` se mantiene para el caso "último hogar".
- En el cambio de hogar (tras `setActiveHousehold`, antes de recargar) se llama a
  `clearHouseholdSyncState(idAnterior)` **solo si** se quiere acotar el uso de IndexedDB; por defecto
  se deja la caché del hogar anterior (rehidrata y queda inerte). Se decide en Fase B con una medida
  real de tamaño.

  > `ponytail:` `gcTime: Infinity` retiene las 4 tablas de cada hogar que haya estado activo. Con 2–3
  > hogares de "cientos de registros" (D-016) no es problema. Si se acerca al límite de desalojo de
  > Safari, se podan las del hogar no activo al cambiar.

### 4.4. Sin cambios necesarios (verificado por la exploración)

- RLS, `is_member`, `sync_push`, esquema `household_members`: ya soportan N:M.
- `useSyncEngine` / `realtime.ts`: ya están keyeados por `householdId`; reciben el nuevo tras la
  recarga.
- La cola de salida (`scope: {id:'sync'}`): los parches pendientes de un hogar anterior se aplican
  bien mientras estás en otro, porque `sync_push` valida `is_member` por parche contra la fila y
  sigues siendo miembro.

---

## 5. Cliente — experiencia de usuario

Tono de los textos: `identidad_visual` §8 (frase, voz activa, el botón dice lo que va a pasar y el
resultado repite la palabra). Iconos Lucide trazo 1.75. Nada de emojis. Todo lo que se abre encima
es drawer desde abajo con salida visible.

### 5.1. Selector de hogar (Ajustes, primera sección) — D-045

- Título "Hogar activo". Lista de hogares (`list_households()` reconciliado con el vínculo local),
  el activo marcado. Tocar una fila que no sea la activa: `setActiveHousehold(id)` + recarga.
- Debajo, botón **"Añadir otro hogar"** → `/onboarding?add=1`.
- Las secciones actuales "Hogar" (nombre) y "Código" pasan a mostrar los del **hogar activo**.
- "Regenerar código" → `regenerateHouseholdCode(activeId)`.
- "Salir del hogar" → "Salir de este hogar", `leaveHousehold(activeId)` + `clearHouseholdSyncState` o
  `clearPersistedSyncState` según queden otros (D-047). El aviso de `unsyncedCount` se mantiene.

### 5.2. Añadir otro hogar — D-046

Reutiliza `OnboardingScreen` con `?add=1`: copia propia, botón "Cancelar" visible, y al terminar
`setActiveHousehold(nuevo)` + `navigate('/')` con recarga.

### 5.3. Copiar catálogo — D-051

Dos puntos de entrada, mismo drawer:

1. **Estado vacío del Catálogo** (`experiencia_usuario` §10: "Añade lo que sueles comprar"): se le
   suma una segunda línea/acción "o copia el catálogo de otro hogar".
2. **Ajustes**: fila "Copiar catálogo de otro hogar" (disponible siempre, no solo con catálogo
   vacío).

El drawer:
- Si perteneces a **otros hogares**: selector de origen entre ellos.
- Si **no**: "Primero añade el otro hogar" con botón a `/onboarding?add=1`.
- **Dos casillas**, marcadas por defecto: "Copiar también las categorías" (→ `p_copy_categories`) y
  "Copiar también los supermercados" (→ `p_copy_supermarkets`). Desmarcarlas deja los productos en
  "Sin asignar" para esa dimensión. Decisión del usuario, 2026-09-08.
- Sin conexión: el botón de confirmar está desactivado con "Necesitas conexión para copiar un
  catálogo".
- Confirmar → `copyCatalog(sourceId, activeId, opts)` → al volver, delta pull forzado del hogar
  activo → el drawer muestra "Catálogo copiado · N productos" (si N = 0: "Ese catálogo ya estaba
  copiado").
- No hay paso de "salir del hogar de origen": se gestiona a mano desde Ajustes (D-051).

### 5.4. Copys (borrador, `identidad_visual` §8)

| Acción | Botón | Resultado |
|---|---|---|
| Añadir hogar (crear) | `Crear un hogar` | `Hogar creado` |
| Añadir hogar (unirse) | `Unirme` | `Te uniste al hogar` |
| Cambiar de hogar | (fila de la lista) | recarga en Mercado del hogar elegido |
| Copiar catálogo | `Copiar catálogo` | `Catálogo copiado · 96 productos` |
| Salir | `Salir de este hogar` | vuelve a onboarding o al siguiente hogar |

Nombres de usuario, no de sistema: "hogar", "código del hogar", "hogar activo". Nunca "workspace",
"tenant", "instancia".

---

## 6. Seguridad

- `copy_catalog` y las RPC con `p_household_id` validan `is_member` server-side; un `household_id`
  ajeno aborta la operación entera (patrón de `sync_push`).
- El código del hogar sigue siendo credencial de facto (D-014). Copiar exige **unirse** al origen
  (D-051), lo que es visible para sus miembros y revocable regenerando el código (D-040/D-048) — más
  seguro que autorizar la copia con solo el código.
- `join_household` conserva su rate-limit (5 intentos / 5 min); "añadir otro hogar" pasa por la misma
  función, así que hereda la protección.
- Consentimiento: cualquier miembro del hogar origen puede copiar su catálogo entero a otro hogar
  solo con ser miembro. Para un hogar de dos personas con permisos iguales (RN-009) es aceptable y no
  se añade un paso de confirmación del resto de miembros.
- `list_households()` es `security definer` pero solo devuelve filas de `auth.uid()`.

---

## 7. Fases de implementación

Orden pensado para delegar cada fase a un worker. Commit + push al terminar cada una (preferencia del
usuario). Tamaño relativo S/M/L.

### Fase A — Backend: RPC y migraciones · M

Migraciones para D-048 (`regenerate_household_code`, `leave_household` con `p_household_id`), D-053
(`list_households`), D-049/D-050/D-052 (`copy_catalog`). Wrappers Zod en `src/lib/household.ts`.
Pruebas de integración (§3.5).

**Listo cuando:** las migraciones aplican limpio en una branch de Supabase y las pruebas de §3.5
pasan. Ninguna RPC deriva ya el hogar de `auth.uid()` sin recibirlo (salvo `create_household` y
`join_household`, que no aplican).

### Fase B — Cliente: vínculo local multi-hogar y cursor por hogar · M

`household-link.ts` con la forma nueva + migración transparente + API (§4.1). `delta-pull.ts` cursor
por hogar (§4.2). `query-client.ts` `clearHouseholdSyncState` (§4.3). Medida de tamaño de IndexedDB
con 2–3 hogares para decidir si se podan las cachés no activas. Tests de `household-link` (migración,
add, switch, remove) y de `delta-pull` (cursor namespacing).

**Listo cuando:** con dos vínculos en `localStorage`, cambiar el activo + recargar produce un delta
pull contra el cursor propio del hogar nuevo; salir de uno de dos no toca la caché del otro; un
`localStorage` con el formato viejo se migra sin pérdida al abrir la app.

### Fase C — UI: selector de hogar y "añadir otro hogar" · M  (depende de A y B)

Sección "Hogar activo" en Ajustes (§5.1). Modo `?add=1` de onboarding + relajación del guardia en
`router.tsx` + botón "Cancelar" (§5.2). "Salir de este hogar" con limpieza selectiva. Tests de
componente + un flujo Playwright.

**Listo cuando:** desde un dispositivo ya vinculado se añade un segundo hogar por código, se alterna
entre los dos y cada uno muestra su propio catálogo, su código y sus supermercados; salir de uno deja
el otro intacto y activo.

### Fase D — UI: copiar catálogo · M  (depende de A y C)

Estado vacío del Catálogo + fila en Ajustes (§5.3). Drawer de copia con selector de origen, guardia
de conexión, llamada a `copyCatalog`, delta pull forzado, resultado, y oferta de salir del origen.
Tests + Playwright (destino vacío → copiar → catálogo poblado y agrupado por supermercado; sin
conexión → botón desactivado).

**Listo cuando:** un hogar nuevo, tras "añadir" el hogar de otra persona y "copiar catálogo", muestra
en Mercado y Catálogo los ~100 productos con sus categorías y supermercados; repetir la copia dice
"Ese catálogo ya estaba copiado".

### Fase E — Documentación · S

- `decisiones_cerradas_v0.1.md`: incorporar D-043 … D-053.
- `backlog_v2.md` §1 y §2: marcar implementadas con el nombre de la branch (como se hizo con §5–§7).
- `arquitectura_funcional_v0.1.md` §3: añadir `p_household_id` a regenerar y a salir del hogar,
  añadir `list_households` y `copy_catalog` a la tabla de operaciones; nota de que `copy_catalog` es
  la primera operación entre hogares y por qué es una excepción a D-039.
- `estrategia_sincronizacion_v0.1.md`: cursor por hogar (`:hogar` deja de ser escalar) y "solo hogar
  activo" (D-044).
- `experiencia_usuario_v0.1.md` §10: onboarding en modo "añadir", selector en Ajustes.
- `CLAUDE.md`: **corregir §"Estado del repositorio"** (ya no es pre-implementación) y añadir a las
  reglas del local-first que el cursor lleva `householdId` y que la sincronización es del hogar
  activo.

**Listo cuando:** ningún documento describe el estado como pre-implementación ni "un hogar por
dispositivo", y las 11 decisiones nuevas están en `decisiones_cerradas`.

---

## 8. Riesgos y cuestiones abiertas

### 8.1. Riesgos

- **Cursor mal namespaced (D-044).** Si algún camino de `delta-pull` se queda con la clave vieja, el
  hogar nuevo se sincroniza a medias de forma silenciosa. Mitigación: la Fase B tiene un test
  específico y el cambio es de un solo módulo.
- **`copy_catalog` y el color (D-052).** El emparejamiento por nombre y la asignación de color libre
  son la parte con más lógica de la RPC. Mitigación: pruebas de §3.5 con destino no vacío.
- **Recarga como mecanismo de cambio (D-044).** Si Safari tarda en rehidratar IndexedDB con varios
  hogares en caché, el cambio de hogar "parpadea". Mitigación: medir en Fase B; si molesta, podar las
  cachés no activas o pasar a store observable (ambos ya contemplados).
- **Volumen local.** N hogares replicados multiplican el riesgo de desalojo de Safari (D-018).
  Mitigación: solo el activo se sincroniza; la Fase B decide si se podan los demás.

### 8.2. Resueltas con el usuario (2026-09-08)

1. **Ubicación del selector**: solo en Ajustes (D-045). No se añade a la cabecera de Mercado.
2. **Alcance de `copy_catalog`**: el drawer muestra dos casillas (categorías / supermercados),
   marcadas por defecto (D-050, §5.3).
3. **Salir del origen tras copiar**: no se ofrece automáticamente; el usuario lo hace a mano desde
   Ajustes (D-051).

### 8.3. Resueltas con el usuario (2026-09-08) — no bloquean esta feature

4. **Reinstalar con varios hogares.** Se acepta para el MVP de multi-hogar: tras reinstalar se
   reintroduce el código de cada hogar a mano. Un mecanismo para "volver a entrar sin perder nada"
   (que cubre también salir/ser expulsado y reentrar) va a `backlog_v2.md` §8, como trabajo aparte.
5. **Detección de expulsión.** Se mantiene en la Fase C: al abrir Ajustes se reconcilia el vínculo
   local con `list_households()`, se podan los hogares de los que ya no eres miembro y se avisa. Es
   independiente de que haya roles o no.
6. **Roles en el hogar (creador = admin, único que regenera el código).** Propuesta del usuario que
   **reabre RN-009**. No entra en esta feature: se diseña aparte en `backlog_v2.md` §9, sobre todo
   por el problema de "el admin pierde el teléfono y nadie puede volver a regenerar" en una app sin
   login. Multi-hogar y copia de catálogo **no dependen** de esa decisión.

### 8.4. Secuencia

Esta feature (multi-hogar + copia de catálogo) **se construye ya**, según las Fases A–E. Los §8 y §9
del backlog (reentrada limpia, roles) son ortogonales: cambian *quién puede hacer qué dentro de un
hogar* y *cómo se recupera el acceso*, no *cuántos hogares sigue un dispositivo*. Se pueden diseñar e
implementar después sin rehacer nada de lo de aquí.
