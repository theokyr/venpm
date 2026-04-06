import { describe, it, expect, vi } from "vitest";
import { jsonSuccess, jsonError, writeJson } from "../../src/core/json.js";

describe("jsonSuccess", () => {
    it("wraps data in success envelope", () => {
        const result = jsonSuccess({ plugins: [] });
        expect(result).toEqual({ success: true, data: { plugins: [] } });
    });

    it("handles null data", () => {
        const result = jsonSuccess(null);
        expect(result).toEqual({ success: true, data: null });
    });
});

describe("jsonError", () => {
    it("wraps message in error envelope", () => {
        const result = jsonError("not found");
        expect(result).toEqual({ success: false, error: "not found" });
    });
});

describe("writeJson", () => {
    it("writes JSON to stdout", () => {
        const write = vi.fn();
        writeJson({ success: true, data: {} }, write);
        const output = JSON.parse(write.mock.calls[0][0]);
        expect(output.success).toBe(true);
    });

    it("outputs valid JSON with no trailing content", () => {
        const write = vi.fn();
        writeJson({ success: false, error: "fail" }, write);
        const raw = write.mock.calls[0][0];
        expect(() => JSON.parse(raw)).not.toThrow();
        expect(raw.endsWith("\n")).toBe(true);
    });
});
