import { describe, it, expect } from "vitest";
import { createPrompter } from "../../src/core/prompt.js";

describe("createPrompter (yes=true)", () => {
    const prompter = createPrompter({ yes: true });

    it("auto-confirms with yes=true", async () => {
        expect(await prompter.confirm("Continue?")).toBe(true);
    });

    it("uses default value for confirm(msg, false) with yes=true", async () => {
        expect(await prompter.confirm("Continue?", false)).toBe(false);
    });

    it("auto-returns default for input with yes=true", async () => {
        expect(await prompter.input("Name?", "Alice")).toBe("Alice");
    });

    it("auto-returns empty string when no default for input with yes=true", async () => {
        expect(await prompter.input("Name?")).toBe("");
    });

    it("auto-selects first choice with yes=true", async () => {
        const choices = [
            { value: "a", label: "Option A" },
            { value: "b", label: "Option B" },
        ];
        expect(await prompter.select("Pick one:", choices)).toBe("a");
    });
});
