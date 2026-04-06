import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateIndex, validateConfig, validateLockfile } from "../../src/core/schema.js";

function loadFixture(relPath: string): unknown {
    const fullPath = join(import.meta.dirname, "..", "fixtures", relPath);
    return JSON.parse(readFileSync(fullPath, "utf-8"));
}

describe("validateIndex", () => {
    it("accepts valid-basic", () => {
        const result = validateIndex(loadFixture("indexes/valid-basic.json"));
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("accepts valid-full", () => {
        const result = validateIndex(loadFixture("indexes/valid-full.json"));
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects missing-name", () => {
        const result = validateIndex(loadFixture("indexes/invalid-missing-name.json"));
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects no-source", () => {
        const result = validateIndex(loadFixture("indexes/invalid-no-source.json"));
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects non-object input", () => {
        const result = validateIndex("not an object");
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects null", () => {
        const result = validateIndex(null);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Input is null or undefined");
    });
});

describe("validateConfig", () => {
    it("accepts valid config", () => {
        const config = {
            repos: [{ name: "my-repo", url: "https://example.com/index.json" }],
            vencord: { path: "/home/user/Vencord" },
            rebuild: "ask",
            discord: { restart: "always", binary: null },
        };
        const result = validateConfig(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects config with invalid rebuild mode", () => {
        const config = {
            repos: [],
            vencord: { path: null },
            rebuild: "sometimes",
            discord: { restart: "ask", binary: null },
        };
        const result = validateConfig(config);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

describe("validateLockfile", () => {
    it("accepts valid lockfile", () => {
        const lockfile = {
            installed: {
                myPlugin: {
                    version: "1.0.0",
                    repo: "my-repo",
                    method: "git",
                    pinned: false,
                    installed_at: "2024-01-15T10:30:00.000Z",
                    git_ref: "abc1234",
                },
            },
        };
        const result = validateLockfile(lockfile);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects lockfile with invalid method", () => {
        const lockfile = {
            installed: {
                myPlugin: {
                    version: "1.0.0",
                    repo: "my-repo",
                    method: "magic",
                    pinned: false,
                    installed_at: "2024-01-15T10:30:00.000Z",
                },
            },
        };
        const result = validateLockfile(lockfile);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});
