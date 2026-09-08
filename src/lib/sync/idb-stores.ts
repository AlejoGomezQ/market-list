import { createStore } from "idb-keyval";

/**
 * D-030/§8.1: la caché es desechable, la cola de salida no -- "viven en almacenes de IndexedDB
 * separados y con versionado independiente". `createStore` es perezoso (no abre la base hasta el
 * primer `get`/`set` real), así que definir los dos aquí a nivel de módulo es seguro incluso bajo
 * Vitest/jsdom, que no implementa IndexedDB (mismo razonamiento que ya documentaba
 * `query-client.ts` para el store por defecto de idb-keyval).
 *
 * Una base de datos por almacén, no una base con dos *object stores*: `createStore(base, store)` de
 * idb-keyval abre la base con un `onupgradeneeded` que crea SOLO ese store, siempre en la versión 1.
 * Con la misma base y distinto store, la primera llamada que corre su `open` crea su store en la v1;
 * la segunda ve la base ya en v1, `onupgradeneeded` no dispara y su store nunca llega a existir --
 * cualquier transacción sobre él lanza "One of the specified object stores was not found". Bases
 * separadas evitan el choque y encajan además con el "versionado independiente" de D-030.
 */
export const cacheStore = createStore("market-list-cache", "cache");
export const queueStore = createStore("market-list-queue", "queue");
