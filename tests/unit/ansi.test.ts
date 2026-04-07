import { describe, it, expect, afterEach } from "vitest";
import { createColors, shouldColorize } from "../../src/core/ansi.js";

describe("createColors", () => {
    it("wraps text in amber ANSI when enabled", () => {
        const c = createColors(true);
        const result = c.amber("hello");
        expect(result).toContain("\x1b[38;2;249;115;22m");
        expect(result).toContain("hello");
        expect(result).toContain("\x1b[0m");
    });

    it("wraps text in emerald ANSI when enabled", () => {
        const c = createColors(true);
        expect(c.emerald("ok")).toContain("\x1b[38;2;52;211;153m");
    });

    it("wraps text in red ANSI when enabled", () => {
        const c = createColors(true);
        expect(c.red("err")).toContain("\x1b[38;2;239;68;68m");
    });

    it("wraps text in yellow ANSI when enabled", () => {
        const c = createColors(true);
        expect(c.yellow("warn")).toContain("\x1b[38;2;251;191;36m");
    });

    it("wraps text in dim ANSI when enabled", () => {
        const c = createColors(true);
        expect(c.dim("muted")).toContain("\x1b[38;2;74;92;86m");
    });

    it("wraps text in bright ANSI when enabled", () => {
        const c = createColors(true);
        expect(c.bright("heading")).toContain("\x1b[38;2;232;232;232m");
    });

    it("wraps text in bold when enabled", () => {
        const c = createColors(true);
        expect(c.bold("strong")).toContain("\x1b[1m");
    });

    it("passes through text unchanged when disabled", () => {
        const c = createColors(false);
        expect(c.amber("hello")).toBe("hello");
        expect(c.emerald("ok")).toBe("ok");
        expect(c.red("err")).toBe("err");
        expect(c.yellow("warn")).toBe("warn");
        expect(c.dim("muted")).toBe("muted");
        expect(c.bright("heading")).toBe("heading");
        expect(c.bold("strong")).toBe("strong");
    });

    it("supports nesting: bold + amber", () => {
        const c = createColors(true);
        const result = c.bold(c.amber("hello"));
        expect(result).toContain("\x1b[1m");
        expect(result).toContain("\x1b[38;2;249;115;22m");
    });
});

describe("shouldColorize", () => {
    afterEach(() => {
        delete process.env.NO_COLOR;
        delete process.env.FORCE_COLOR;
    });

    it("returns false when NO_COLOR is set", () => {
        process.env.NO_COLOR = "1";
        expect(shouldColorize({ isTTY: true })).toBe(false);
    });

    it("returns true when FORCE_COLOR is set even without TTY", () => {
        process.env.FORCE_COLOR = "1";
        expect(shouldColorize({ isTTY: false })).toBe(true);
    });

    it("returns true for TTY when no env overrides", () => {
        expect(shouldColorize({ isTTY: true })).toBe(true);
    });

    it("returns false for non-TTY when no env overrides", () => {
        expect(shouldColorize({ isTTY: false })).toBe(false);
    });
});
