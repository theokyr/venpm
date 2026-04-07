import { describe, it, expect } from "vitest";
import { levenshtein, findCandidates } from "../../src/core/fuzzy.js";

describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
        expect(levenshtein("abc", "abc")).toBe(0);
    });

    it("returns length for empty vs non-empty", () => {
        expect(levenshtein("", "abc")).toBe(3);
        expect(levenshtein("abc", "")).toBe(3);
    });

    it("returns 1 for single substitution", () => {
        expect(levenshtein("cat", "car")).toBe(1);
    });

    it("returns 1 for single insertion", () => {
        expect(levenshtein("cat", "cats")).toBe(1);
    });

    it("returns 1 for single deletion", () => {
        expect(levenshtein("cats", "cat")).toBe(1);
    });

    it("handles BeterVolume → BetterVolume (1 insertion)", () => {
        expect(levenshtein("BeterVolume", "BetterVolume")).toBe(1);
    });

    it("is case-sensitive", () => {
        expect(levenshtein("ABC", "abc")).toBe(3);
    });
});

describe("findCandidates", () => {
    const plugins = ["BetterVolume", "VolumeBooster", "CustomCSS", "BetterFolders", "NoTrack"];

    it("returns close match for typo", () => {
        const result = findCandidates("BeterVolume", plugins);
        expect(result).toContain("BetterVolume");
    });

    it("returns multiple matches when applicable", () => {
        const result = findCandidates("Better", plugins);
        expect(result).toContain("BetterVolume");
        expect(result).toContain("BetterFolders");
    });

    it("returns empty array when nothing is close", () => {
        expect(findCandidates("XXXXXXXXXXX", plugins)).toEqual([]);
    });

    it("returns at most 3 candidates", () => {
        const many = Array.from({ length: 20 }, (_, i) => `plugin${i}`);
        const result = findCandidates("plugin", many);
        expect(result.length).toBeLessThanOrEqual(3);
    });

    it("sorts by distance (closest first)", () => {
        const result = findCandidates("BeterVolume", plugins);
        if (result.length > 1) {
            expect(result[0]).toBe("BetterVolume");
        }
    });

    it("handles empty candidate list", () => {
        expect(findCandidates("anything", [])).toEqual([]);
    });

    it("handles empty input", () => {
        expect(findCandidates("", plugins)).toEqual([]);
    });
});
