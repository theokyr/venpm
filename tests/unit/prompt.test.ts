import { describe, it, expect } from "vitest";
import { createPrompter } from "../../src/core/prompt.js";

describe("createPrompter (nonInteractive=true)", () => {
    const prompter = createPrompter({ yes: false, nonInteractive: true });

    it("throws on confirm with actionable message", async () => {
        await expect(prompter.confirm("Remove plugin?")).rejects.toThrow(/non-interactive mode/i);
        await expect(prompter.confirm("Remove plugin?")).rejects.toThrow(/--yes/);
    });

    it("throws on input with actionable message", async () => {
        await expect(prompter.input("Name?")).rejects.toThrow(/non-interactive mode/i);
    });

    it("throws on select with actionable message", async () => {
        const choices = [{ value: "a" as const, label: "A" }];
        await expect(prompter.select("Pick:", choices)).rejects.toThrow(/non-interactive mode/i);
    });
});

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

describe("createPrompter (yes=true) styled contract", () => {
    const prompter = createPrompter({ yes: true });

    it("auto-confirms with default true", async () => {
        expect(await prompter.confirm("Continue?")).toBe(true);
    });

    it("auto-confirms with default false", async () => {
        expect(await prompter.confirm("Continue?", false)).toBe(false);
    });

    it("auto-returns default for input", async () => {
        expect(await prompter.input("Name?", "Alice")).toBe("Alice");
    });

    it("auto-selects first choice", async () => {
        const choices = [
            { value: "a" as const, label: "Option A" },
            { value: "b" as const, label: "Option B" },
        ];
        expect(await prompter.select("Pick:", choices)).toBe("a");
    });
});
