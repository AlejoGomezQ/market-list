import { describe, expect, it } from "vitest";
import { formatHouseholdInvite } from "./share";

describe("formatHouseholdInvite", () => {
	it("puts the code in WhatsApp bold after a blank line", () => {
		expect(formatHouseholdInvite("W5QQLZZB")).toBe(
			"Con este código puedes unirte a un hogar y gestionar tu lista de mercado\n\n*W5QQLZZB*",
		);
	});

	it("contains no emojis", () => {
		expect(formatHouseholdInvite("ABCD1234")).not.toMatch(
			/\p{Extended_Pictographic}/u,
		);
	});
});
