/**
 * Formato del total de una compra en el historial (backlog_v2 §6). Símbolo de moneda fijo
 * antepuesto, separador de miles, sin decimales: no hay campo de moneda del hogar todavía, así que
 * el símbolo es fijo y `es-CO` fija el separador (punto para los miles). `85400 -> "$85.400"`.
 */
export function formatCurrency(n: number): string {
	return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n)}`;
}
