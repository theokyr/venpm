import { describe, it, expect, vi } from "vitest";
import { createStreamRenderer } from "../../src/core/stream-renderer.js";
import type { ErrorInfo } from "../../src/core/errors.js";

function collectLines(write: ReturnType<typeof vi.fn>): unknown[] {
    return (write.mock.calls as [string][]).map(([raw]) => JSON.parse(raw));
}

describe("StreamRenderer", () => {
    describe("NDJSON format", () => {
        it("each emitted line is valid JSON with a trailing newline", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.text("hello");
            r.warn("watch out");
            r.finish(true, {});
            for (const [raw] of write.mock.calls as [string][]) {
                expect(raw.endsWith("\n")).toBe(true);
                expect(() => JSON.parse(raw)).not.toThrow();
            }
        });
    });

    describe("log events", () => {
        it("text() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.text("hello world");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "log", message: "hello world" });
        });

        it("heading() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.heading("Section header");
            const events = collectLines(write);
            expect(events[0]).toEqual({ type: "log", message: "Section header" });
        });

        it("success() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.success("All done!");
            const events = collectLines(write);
            expect(events[0]).toEqual({ type: "log", message: "All done!" });
        });

        it("verbose() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.verbose("debug info");
            const events = collectLines(write);
            expect(events[0]).toEqual({ type: "log", message: "debug info" });
        });

        it("dim() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.dim("subtle text");
            const events = collectLines(write);
            expect(events[0]).toEqual({ type: "log", message: "subtle text" });
        });

        it("write() emits { type: 'log', message }", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.write("raw data");
            const events = collectLines(write);
            expect(events[0]).toEqual({ type: "log", message: "raw data" });
        });
    });

    describe("warning events", () => {
        it("warn() emits { type: 'warning', message } immediately", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.warn("something is off");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "warning", message: "something is off" });
        });

        it("multiple warn() calls each emit their own event", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.warn("first");
            r.warn("second");
            const events = collectLines(write);
            expect(events).toHaveLength(2);
            expect(events[0]).toEqual({ type: "warning", message: "first" });
            expect(events[1]).toEqual({ type: "warning", message: "second" });
        });
    });

    describe("no-op structured methods", () => {
        it("table() does not emit anything", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.table(["A", "B"], [["1", "2"]]);
            expect(write).not.toHaveBeenCalled();
        });

        it("keyValue() does not emit anything", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.keyValue([["key", "val"]]);
            expect(write).not.toHaveBeenCalled();
        });

        it("list() does not emit anything", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.list(["item1", "item2"]);
            expect(write).not.toHaveBeenCalled();
        });
    });

    describe("progress events", () => {
        it("progress() emits { type: 'progress', id, message } on start", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.progress("task-1", "Starting...");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "progress", id: "task-1", message: "Starting..." });
        });

        it("progress handle .update() emits a progress event", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "Starting...");
            write.mockClear();
            handle.update("In progress...");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "progress", id: "task-1", message: "In progress..." });
        });

        it("progress handle .succeed() emits status='done' with message", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "Working...");
            write.mockClear();
            handle.succeed("Finished!");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "progress", id: "task-1", status: "done", message: "Finished!" });
        });

        it("progress handle .succeed() falls back to initial message when called with no args", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "Working...");
            write.mockClear();
            handle.succeed();
            const events = collectLines(write);
            expect((events[0] as Record<string, unknown>).message).toBe("Working...");
        });

        it("progress handle .fail() emits status='fail' with message", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "Working...");
            write.mockClear();
            handle.fail("Something broke");
            const events = collectLines(write);
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ type: "progress", id: "task-1", status: "fail", message: "Something broke" });
        });

        it("progress handle .fail() falls back to initial message when called with no args", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "Working...");
            write.mockClear();
            handle.fail();
            const events = collectLines(write);
            expect((events[0] as Record<string, unknown>).message).toBe("Working...");
        });

        it("progress handle has update, succeed, fail methods", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            const handle = r.progress("task-1", "msg");
            expect(handle).toHaveProperty("update");
            expect(handle).toHaveProperty("succeed");
            expect(handle).toHaveProperty("fail");
        });
    });

    describe("finish() — result event on success", () => {
        it("emits { type: 'result', success: true, data } on finish(true)", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.finish(true, { installed: ["foo"] });
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.type).toBe("result");
            expect(last.success).toBe(true);
            expect(last.data).toEqual({ installed: ["foo"] });
        });

        it("result event is valid JSON with trailing newline", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.finish(true, {});
            const raw = (write.mock.calls[write.mock.calls.length - 1] as [string])[0];
            expect(raw.endsWith("\n")).toBe(true);
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        it("omits warnings key in result event when no warnings", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.finish(true, {});
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(Object.hasOwn(last, "warnings")).toBe(false);
        });

        it("includes accumulated warnings in result event", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.warn("w1");
            r.warn("w2");
            r.finish(true, {});
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.warnings).toEqual(["w1", "w2"]);
        });

        it("includes extraWarnings passed to finish()", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.finish(true, {}, ["extra"]);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.warnings).toEqual(["extra"]);
        });

        it("merges warn() warnings and extraWarnings", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.warn("collected");
            r.finish(true, {}, ["extra"]);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.warnings).toEqual(["collected", "extra"]);
        });
    });

    describe("finish() — error event on failure", () => {
        it("emits { type: 'error', success: false, error } on finish(false)", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "Build failed" });
            r.finish(false);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.type).toBe("error");
            expect(last.success).toBe(false);
            expect((last.error as ErrorInfo).code).toBe("BUILD_FAILED");
        });

        it("error event is valid JSON with trailing newline", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "fail" });
            r.finish(false);
            const raw = (write.mock.calls[write.mock.calls.length - 1] as [string])[0];
            expect(raw.endsWith("\n")).toBe(true);
            expect(() => JSON.parse(raw)).not.toThrow();
        });

        it("uses UNKNOWN fallback when no error() was called before finish(false)", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.finish(false);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect((last.error as ErrorInfo).code).toBe("UNKNOWN");
        });

        it("last error() wins when called multiple times", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "first" });
            r.error({ code: "PLUGIN_NOT_FOUND", message: "second" });
            r.finish(false);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect((last.error as ErrorInfo).code).toBe("PLUGIN_NOT_FOUND");
        });

        it("error event includes warnings when present", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.warn("watch out");
            r.error({ code: "BUILD_FAILED", message: "fail" });
            r.finish(false);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(last.warnings).toEqual(["watch out"]);
        });

        it("omits warnings key in error event when none", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.error({ code: "BUILD_FAILED", message: "fail" });
            r.finish(false);
            const events = collectLines(write);
            const last = events[events.length - 1] as Record<string, unknown>;
            expect(Object.hasOwn(last, "warnings")).toBe(false);
        });
    });

    describe("event ordering", () => {
        it("emits events in call order", () => {
            const write = vi.fn();
            const r = createStreamRenderer(write);
            r.text("first");
            r.warn("second");
            r.text("third");
            r.finish(true, {});
            const events = collectLines(write);
            expect((events[0] as Record<string, unknown>).message).toBe("first");
            expect((events[1] as Record<string, unknown>).message).toBe("second");
            expect((events[2] as Record<string, unknown>).message).toBe("third");
            expect((events[3] as Record<string, unknown>).type).toBe("result");
        });
    });
});
