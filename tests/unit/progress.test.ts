import { describe, it, expect, vi } from "vitest";
import { createPlainProgress } from "../../src/core/progress.js";

describe("PlainProgress", () => {
    it("prints initial message on creation", () => {
        const write = vi.fn();
        createPlainProgress("fetch-1", "Fetching index...", write);
        expect(write).toHaveBeenCalledWith("  ⟩ Fetching index...\n");
    });

    it("prints update message", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.update("Still fetching...");
        expect(write).toHaveBeenCalledWith("  ⟩ Still fetching...\n");
    });

    it("prints succeed message with checkmark", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.succeed("Done");
        expect(write).toHaveBeenCalledWith("  ✔ Done\n");
    });

    it("prints fail message with cross", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.fail("Network error");
        expect(write).toHaveBeenCalledWith("  ✖ Network error\n");
    });

    it("uses initial message if succeed called without override", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.succeed();
        expect(write).toHaveBeenCalledWith("  ✔ Fetching...\n");
    });

    it("uses initial message if fail called without override", () => {
        const write = vi.fn();
        const handle = createPlainProgress("fetch-1", "Fetching...", write);
        handle.fail();
        expect(write).toHaveBeenCalledWith("  ✖ Fetching...\n");
    });
});
