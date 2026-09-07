import { createStore } from "idb-keyval";

/**
 * D-030/§8.1: la caché es desechable, la cola de salida no -- "viven en almacenes de IndexedDB
 * separados y con versionado independiente". `createStore` es perezoso (no abre la base hasta el
 * primer `get`/`set` real), así que definir los dos aquí a nivel de módulo es seguro incluso bajo
 * Vitest/jsdom, que no implementa IndexedDB (mismo razonamiento que ya documentaba
 * `query-client.ts` para el store por defecto de idb-keyval).
 *
 * Una sola base de datos ("market-list") con dos *object stores* -- no hace falta una base por
 * almacén para lograr el aislamiento que pide D-030, un store aparte ya es un espacio de claves
 * distinto con su propio ciclo de vida.
 */
export const cacheStore = createStore("market-list", "cache");
export const queueStore = createStore("market-list", "queue");
