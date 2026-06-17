import { describe, it, expect, vi } from "vitest";
import { jsonSuccess, jsonError, writeJson } from "../../src/core/json.js";
import type { ErrorInfo } from "../../src/core/errors.js";

describe("jsonSuccess", () => {
    it("wraps data in success envelope", () => {
        const result = jsonSuccess({ plugins: [] });
        expect(result).toEqual({ success: true, data: { plugins: [] } });
    });

    it("handles null data", () => {
        const result = jsonSuccess(null);
        expect(result).toEqual({ success: true, data: null });
    });

    it("includes warnings when provided", () => {
        const result = jsonSuccess({ ok: true }, ["warning 1"]);
        expect(result).toEqual({ success: true, data: { ok: true }, warnings: ["warning 1"] });
    });

    it("omits warnings when empty array provided", () => {
        const result = jsonSuccess({ ok: true }, []);
        expect(result.warnings).toBeUndefined();
    });
});

describe("jsonError", () => {
    it("wraps ErrorInfo in error envelope", () => {
        const err: ErrorInfo = { code: "PLUGIN_NOT_FOUND", message: "not found" };
        const result = jsonError(err);
        expect(result).toEqual({ success: false, error: err });
    });

    it("preserves all ErrorInfo fields", () => {
        const err: ErrorInfo = {
            code: "PLUGIN_NOT_FOUND",
            message: "not found",
            suggestion: "try this",
            candidates: ["foo"],
            docsUrl: "https://venpm.dev",
        };
        const result = jsonError(err);
        expect(result.error).toEqual(err);
    });
});

describe("writeJson", () => {
    it("writes JSON to stdout", () => {
        const write = vi.fn();
        writeJson({ success: true, data: {} }, write);
        const output = JSON.parse(write.mock.calls[0][0]);
        expect(output.success).toBe(true);
    });

    it("outputs valid JSON with trailing newline", () => {
        const err: ErrorInfo = { code: "TEST", message: "fail" };
        const write = vi.fn();
        writeJson({ success: false, error: err }, write);
        const raw = write.mock.calls[0][0];
        expect(() => JSON.parse(raw)).not.toThrow();
        expect(raw.endsWith("\n")).toBe(true);
    });
});
