import type { ErrorEvent } from "@sentry/react";
import { describe, expect, it } from "vitest";
import { scrub } from "@/lib/sentry";

/** `scrub` solo lee unos pocos campos del evento; el resto del `ErrorEvent` no importa aquí. */
function event(partial: Partial<ErrorEvent>): ErrorEvent {
	return partial as unknown as ErrorEvent;
}

describe("scrub (beforeSend)", () => {
	it("quita la query string de la URL de la petición pero deja el path", () => {
		const out = scrub(
			event({
				request: {
					url: "https://x.supabase.co/rest/v1/products?household_id=eq.abc&select=*",
				},
			}),
		);
		expect(out.request?.url).toBe("https://x.supabase.co/rest/v1/products");
	});

	it("borra cookies, cabeceras, body y query_string de la petición", () => {
		const out = scrub(
			event({
				request: {
					url: "https://x/rest",
					cookies: { sb: "secret" },
					headers: { authorization: "Bearer x" },
					data: { p_code: "ABCD1234" },
					query_string: "code=ABCD1234",
				},
			}),
		);
		expect(out.request?.cookies).toBeUndefined();
		expect(out.request?.headers).toBeUndefined();
		expect(out.request?.data).toBeUndefined();
		expect(out.request?.query_string).toBeUndefined();
	});

	it("filtra event.extra a la allowlist de diagnóstico", () => {
		const out = scrub(
			event({
				extra: {
					op: "leave_household",
					entity: "products",
					productName: "Leche entera",
					householdCode: "ABCD1234",
				},
			}),
		);
		expect(out.extra).toEqual({ op: "leave_household", entity: "products" });
	});

	it("recorta la query string en las URLs de los breadcrumbs", () => {
		const out = scrub(
			event({
				breadcrumbs: [
					{
						category: "fetch",
						data: { url: "https://x/rest/v1/list_items?id=eq.abc" },
					},
					{ category: "console" },
				],
			}),
		);
		expect(out.breadcrumbs?.[0]?.data?.url).toBe(
			"https://x/rest/v1/list_items",
		);
	});

	it("no revienta con un evento vacío", () => {
		expect(() => scrub(event({}))).not.toThrow();
	});
});
