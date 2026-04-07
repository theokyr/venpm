import { describe, it, expect } from "vitest";
import { makeError, ErrorCode } from "../../src/core/errors.js";

describe("ErrorCode", () => {
    it("has all expected error codes", () => {
        expect(ErrorCode.VENCORD_NOT_FOUND).toBe("VENCORD_NOT_FOUND");
        expect(ErrorCode.PLUGIN_NOT_FOUND).toBe("PLUGIN_NOT_FOUND");
        expect(ErrorCode.PLUGIN_AMBIGUOUS).toBe("PLUGIN_AMBIGUOUS");
        expect(ErrorCode.PLUGIN_NOT_INSTALLED).toBe("PLUGIN_NOT_INSTALLED");
        expect(ErrorCode.REPO_FETCH_FAILED).toBe("REPO_FETCH_FAILED");
        expect(ErrorCode.GIT_NOT_AVAILABLE).toBe("GIT_NOT_AVAILABLE");
        expect(ErrorCode.PNPM_NOT_AVAILABLE).toBe("PNPM_NOT_AVAILABLE");
        expect(ErrorCode.CIRCULAR_DEPENDENCY).toBe("CIRCULAR_DEPENDENCY");
        expect(ErrorCode.VERSION_NOT_FOUND).toBe("VERSION_NOT_FOUND");
        expect(ErrorCode.SCHEMA_INVALID).toBe("SCHEMA_INVALID");
        expect(ErrorCode.BUILD_FAILED).toBe("BUILD_FAILED");
        expect(ErrorCode.DISCORD_NOT_FOUND).toBe("DISCORD_NOT_FOUND");
        expect(ErrorCode.NON_INTERACTIVE).toBe("NON_INTERACTIVE");
    });
});

describe("makeError", () => {
    it("creates ErrorInfo with default suggestion for known code", () => {
        const err = makeError(ErrorCode.VENCORD_NOT_FOUND, "Vencord path not configured");
        expect(err.code).toBe("VENCORD_NOT_FOUND");
        expect(err.message).toBe("Vencord path not configured");
        expect(err.suggestion).toContain("venpm config set vencord.path");
    });

    it("allows overriding the default suggestion", () => {
        const err = makeError(ErrorCode.VENCORD_NOT_FOUND, "not found", {
            suggestion: "custom suggestion",
        });
        expect(err.suggestion).toBe("custom suggestion");
    });

    it("includes candidates when provided", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume", "VolumeBooster"],
        });
        expect(err.candidates).toEqual(["BetterVolume", "VolumeBooster"]);
        expect(err.suggestion).toContain("Did you mean");
    });

    it("includes docsUrl when provided", () => {
        const err = makeError(ErrorCode.SCHEMA_INVALID, "bad schema", {
            docsUrl: "https://venpm.dev/errors",
        });
        expect(err.docsUrl).toBe("https://venpm.dev/errors");
    });

    it("formats suggestion for single candidate", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume"],
        });
        expect(err.suggestion).toContain("Did you mean: BetterVolume");
    });

    it("formats suggestion for multiple candidates", () => {
        const err = makeError(ErrorCode.PLUGIN_NOT_FOUND, "not found", {
            candidates: ["BetterVolume", "VolumeBooster"],
        });
        expect(err.suggestion).toContain("Did you mean one of:");
    });
});
