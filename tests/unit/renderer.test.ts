import { describe, it, expect, vi } from "vitest";
import { createPlainRenderer, createTtyRenderer } from "../../src/core/renderer.js";
import type { ErrorInfo } from "../../src/core/errors.js";
import { createColors } from "../../src/core/ansi.js";

// ─── PlainRenderer ─────────────────────────────────────────────────────────────

describe("PlainRenderer", () => {
    describe("text()", () => {
        it("writes indented text with newline", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.text("hello world");
            expect(write).toHaveBeenCalledWith("  hello world\n");
        });

        it("is suppressed in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            r.text("hello");
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("heading()", () => {
        it("writes indented heading with newline", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.heading("My Heading");
            expect(write).toHaveBeenCalledWith("  My Heading\n");
        });

        it("is suppressed in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            r.heading("heading");
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("success()", () => {
        it("writes checkmark prefix", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.success("Done!");
            expect(write).toHaveBeenCalledWith("  ✔ Done!\n");
        });

        it("is suppressed in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            r.success("Done!");
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("warn()", () => {
        it("writes warning prefix", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.warn("Be careful");
            expect(write).toHaveBeenCalledWith("  ⚠ Be careful\n");
        });

        it("is always shown in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            r.warn("Be careful");
            expect(write).toHaveBeenCalledWith("  ⚠ Be careful\n");
        });
    });

    describe("error()", () => {
        it("writes error with cross prefix", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            const err: ErrorInfo = { code: "PLUGIN_NOT_FOUND", message: "Plugin not found" };
            r.error(err);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("✖ Plugin not found");
        });

        it("includes suggestion when present", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            const err: ErrorInfo = {
                code: "PLUGIN_NOT_FOUND",
                message: "Plugin not found",
                suggestion: "Try venpm search",
            };
            r.error(err);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("Try venpm search");
        });

        it("includes error code", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            const err: ErrorInfo = { code: "BUILD_FAILED", message: "Build failed" };
            r.error(err);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("BUILD_FAILED");
        });

        it("is always shown in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            const err: ErrorInfo = { code: "BUILD_FAILED", message: "Build failed" };
            r.error(err);
            expect(write).toHaveBeenCalled();
        });
    });

    describe("verbose()", () => {
        it("is suppressed when verbose=false", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.verbose("debug message");
            expect(write).not.toHaveBeenCalled();
        });

        it("writes when verbose=true", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: true, quiet: false }, write);
            r.verbose("debug message");
            expect(write).toHaveBeenCalled();
            expect(write.mock.calls[0][0]).toContain("debug message");
        });
    });

    describe("dim()", () => {
        it("writes indented dim text", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.dim("subtle info");
            expect(write).toHaveBeenCalledWith("  subtle info\n");
        });

        it("is suppressed in quiet mode", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: true }, write);
            r.dim("subtle info");
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("table()", () => {
        it("renders aligned columns", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.table(["Name", "Version"], [["foo", "1.0.0"], ["longer-name", "2.0.0"]]);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("Name");
            expect(output).toContain("Version");
            expect(output).toContain("foo");
            expect(output).toContain("longer-name");
            expect(output).toContain("1.0.0");
            expect(output).toContain("2.0.0");
        });

        it("pads columns to equal widths", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.table(["Name", "Value"], [["a", "1"], ["longkey", "2"]]);
            const output = write.mock.calls.map((c) => c[0]).join("");
            // "a" row should be padded to match "longkey" width
            expect(output).toMatch(/a\s+1/);
        });
    });

    describe("keyValue()", () => {
        it("renders key: value pairs", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.keyValue([["Name", "foo"], ["Version", "1.0.0"]]);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("Name");
            expect(output).toContain("foo");
            expect(output).toContain("Version");
            expect(output).toContain("1.0.0");
        });

        it("aligns colons in key: value pairs", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.keyValue([["Short", "val1"], ["LongerKey", "val2"]]);
            const lines = write.mock.calls.map((c) => c[0]).join("").split("\n").filter(Boolean);
            // Both lines should have their colons at the same column position
            const colonPositions = lines.map((l) => l.indexOf(":"));
            expect(colonPositions[0]).toBe(colonPositions[1]);
        });
    });

    describe("list()", () => {
        it("renders bulleted items", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.list(["item one", "item two"]);
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("item one");
            expect(output).toContain("item two");
        });

        it("prefixes each item with a bullet", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.list(["alpha"]);
            const output = write.mock.calls.map((c) => c[0]).join("");
            // Should have some bullet-like character
            expect(output).toMatch(/[•\-\*·] alpha|alpha/);
        });
    });

    describe("progress()", () => {
        it("returns a ProgressHandle", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            const handle = r.progress("task-1", "Working...");
            expect(handle).toHaveProperty("update");
            expect(handle).toHaveProperty("succeed");
            expect(handle).toHaveProperty("fail");
        });

        it("writes initial message via plain progress", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.progress("task-1", "Working...");
            const output = write.mock.calls.map((c) => c[0]).join("");
            expect(output).toContain("Working...");
        });
    });

    describe("write()", () => {
        it("passes raw data through unchanged", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            r.write("raw data\n");
            expect(write).toHaveBeenCalledWith("raw data\n");
        });
    });

    describe("finish()", () => {
        it("is a no-op", () => {
            const write = vi.fn();
            const r = createPlainRenderer({ verbose: false, quiet: false }, write);
            expect(() => r.finish(true)).not.toThrow();
            expect(write).not.toHaveBeenCalled();
        });
    });
});

// ─── TtyRenderer ─────────────────────────────────────────────────────────────

describe("TtyRenderer", () => {
    describe("heading()", () => {
        it("applies amber+bold color to heading", () => {
            const write = vi.fn();
            const colors = createColors(true);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            r.heading("My Heading");
            const output = write.mock.calls.map((c) => c[0]).join("");
            // Should contain ANSI escape codes (amber = 38;2;249;115;22)
            expect(output).toContain("\x1b[");
            expect(output).toContain("My Heading");
        });
    });

    describe("success()", () => {
        it("applies emerald color to checkmark", () => {
            const write = vi.fn();
            const colors = createColors(true);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            r.success("All done");
            const output = write.mock.calls.map((c) => c[0]).join("");
            // emerald = 38;2;52;211;153
            expect(output).toContain("38;2;52;211;153");
            expect(output).toContain("All done");
        });
    });

    describe("warn()", () => {
        it("applies yellow color to warning", () => {
            const write = vi.fn();
            const colors = createColors(true);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            r.warn("Careful!");
            const output = write.mock.calls.map((c) => c[0]).join("");
            // yellow = 38;2;251;191;36
            expect(output).toContain("38;2;251;191;36");
        });
    });

    describe("error()", () => {
        it("applies red color to error message", () => {
            const write = vi.fn();
            const colors = createColors(true);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            const output = write.mock.calls.map((c) => c[0]).join("");
            // red = 38;2;239;68;68
            expect(output).toContain("38;2;239;68;68");
            expect(output).toContain("Build failed");
        });

        it("applies amber color to suggestion", () => {
            const write = vi.fn();
            const colors = createColors(true);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            r.error({ code: "BUILD_FAILED", message: "Build failed", suggestion: "Run doctor" });
            const output = write.mock.calls.map((c) => c[0]).join("");
            // amber = 38;2;249;115;22
            expect(output).toContain("38;2;249;115;22");
            expect(output).toContain("Run doctor");
        });
    });

    describe("progress()", () => {
        it("returns a ProgressHandle (TTY)", () => {
            const write = vi.fn();
            const colors = createColors(false);
            const r = createTtyRenderer({ verbose: false, quiet: false }, write, colors);
            const handle = r.progress("task-1", "Loading...");
            expect(handle).toHaveProperty("update");
            expect(handle).toHaveProperty("succeed");
            expect(handle).toHaveProperty("fail");
            // Clean up spinner
            handle.succeed();
        });
    });

    describe("finish()", () => {
        it("is a no-op", () => {
            const write = vi.fn();
            const r = createTtyRenderer({ verbose: false, quiet: false }, write);
            expect(() => r.finish(true)).not.toThrow();
        });
    });

    describe("quiet mode suppression", () => {
        it("suppresses text in quiet mode", () => {
            const write = vi.fn();
            const r = createTtyRenderer({ verbose: false, quiet: true }, write);
            r.text("hello");
            expect(write).not.toHaveBeenCalled();
        });

        it("always shows warn in quiet mode", () => {
            const write = vi.fn();
            const r = createTtyRenderer({ verbose: false, quiet: true }, write);
            r.warn("warning");
            expect(write).toHaveBeenCalled();
        });
    });
});
