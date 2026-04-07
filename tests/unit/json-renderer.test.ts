import { describe, it, expect, vi } from "vitest";
import { createJsonRenderer } from "../../src/core/json-renderer.js";
import type { ErrorInfo } from "../../src/core/errors.js";

describe("JsonRenderer", () => {
    describe("finish() — success envelope", () => {
        it("writes valid JSON with trailing newline", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true, { installed: ["foo"] });
            expect(write).toHaveBeenCalledOnce();
            const raw = write.mock.calls[0][0] as string;
            expect(raw.endsWith("\n")).toBe(true);
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        it("success envelope has success=true and data field", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true, { count: 3 });
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.success).toBe(true);
            expect(envelope.data).toEqual({ count: 3 });
        });

        it("omits warnings key when no warnings", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true, null);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(Object.hasOwn(envelope, "warnings")).toBe(false);
        });

        it("includes warnings from warn() calls", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.warn("first warning");
            r.warn("second warning");
            r.finish(true, {});
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.warnings).toEqual(["first warning", "second warning"]);
        });

        it("includes extraWarnings passed to finish()", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true, {}, ["extra warning"]);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.warnings).toEqual(["extra warning"]);
        });

        it("merges warn() warnings and extraWarnings", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.warn("collected");
            r.finish(true, {}, ["extra"]);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.warnings).toEqual(["collected", "extra"]);
        });

        it("omits warnings key when extraWarnings is empty array", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true, {}, []);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(Object.hasOwn(envelope, "warnings")).toBe(false);
        });

        it("data can be undefined", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(true);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.success).toBe(true);
        });
    });

    describe("finish() — error envelope", () => {
        it("writes valid JSON with trailing newline on failure", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            r.finish(false);
            const raw = write.mock.calls[0][0] as string;
            expect(raw.endsWith("\n")).toBe(true);
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        it("error envelope has success=false", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.success).toBe(false);
        });

        it("error envelope includes the ErrorInfo", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            const err: ErrorInfo = {
                code: "PLUGIN_NOT_FOUND",
                message: "Plugin not found",
                suggestion: "Try venpm search",
            };
            r.error(err);
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.error).toEqual(err);
        });

        it("uses UNKNOWN fallback when no error() was called before finish(false)", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.error.code).toBe("UNKNOWN");
            expect(typeof envelope.error.message).toBe("string");
        });

        it("last error() wins when called multiple times", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "first" });
            r.error({ code: "PLUGIN_NOT_FOUND", message: "second" });
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.error.code).toBe("PLUGIN_NOT_FOUND");
        });

        it("error envelope includes warnings when present", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.warn("watch out");
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(envelope.warnings).toEqual(["watch out"]);
        });

        it("omits warnings key in error envelope when none", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            r.finish(false);
            const envelope = JSON.parse(write.mock.calls[0][0] as string);
            expect(Object.hasOwn(envelope, "warnings")).toBe(false);
        });
    });

    describe("silently ignored methods", () => {
        it("text() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.text("hello");
            expect(write).not.toHaveBeenCalled();
        });

        it("heading() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.heading("Section");
            expect(write).not.toHaveBeenCalled();
        });

        it("success() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.success("Done!");
            expect(write).not.toHaveBeenCalled();
        });

        it("verbose() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.verbose("debug info");
            expect(write).not.toHaveBeenCalled();
        });

        it("dim() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.dim("subtle");
            expect(write).not.toHaveBeenCalled();
        });

        it("table() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.table(["A", "B"], [["1", "2"]]);
            expect(write).not.toHaveBeenCalled();
        });

        it("keyValue() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.keyValue([["key", "val"]]);
            expect(write).not.toHaveBeenCalled();
        });

        it("list() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.list(["item"]);
            expect(write).not.toHaveBeenCalled();
        });

        it("write() does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.write("raw data\n");
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("progress() — no-op handles", () => {
        it("returns a ProgressHandle", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            const handle = r.progress("task-1", "Working...");
            expect(handle).toHaveProperty("update");
            expect(handle).toHaveProperty("succeed");
            expect(handle).toHaveProperty("fail");
        });

        it("progress handle methods do not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            const handle = r.progress("task-1", "Working...");
            handle.update("updated");
            handle.succeed("done");
            handle.fail("oops");
            expect(write).not.toHaveBeenCalled();
        });

        it("progress() itself does not write anything", () => {
            const write = vi.fn();
            const r = createJsonRenderer(write);
            r.progress("task-1", "Working...");
            expect(write).not.toHaveBeenCalled();
        });
    });
});
