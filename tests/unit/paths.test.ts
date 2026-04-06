import { describe, it, expect, vi, afterEach } from "vitest";
import { getConfigDir, getConfigPath, getLockfilePath } from "../../src/core/paths.js";

describe("getConfigDir", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it("uses XDG_CONFIG_HOME on Linux when set", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        process.env.XDG_CONFIG_HOME = "/custom/config";
        expect(getConfigDir()).toBe("/custom/config/venpm");
    });

    it("defaults to ~/.config on Linux when XDG not set", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        delete process.env.XDG_CONFIG_HOME;
        process.env.HOME = "/home/testuser";
        expect(getConfigDir()).toBe("/home/testuser/.config/venpm");
    });

    it("uses APPDATA on Windows", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
        expect(getConfigDir()).toBe("C:\\Users\\test\\AppData\\Roaming\\venpm");
    });

    it("uses Library/Application Support on macOS", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        process.env.HOME = "/Users/testuser";
        expect(getConfigDir()).toBe("/Users/testuser/Library/Application Support/venpm");
    });

    it("getConfigPath returns config.json path", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        process.env.XDG_CONFIG_HOME = "/custom/config";
        expect(getConfigPath()).toMatch(/\/venpm\/config\.json$/);
    });

    it("getLockfilePath returns venpm-lock.json path", () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        process.env.XDG_CONFIG_HOME = "/custom/config";
        expect(getLockfilePath()).toMatch(/\/venpm\/venpm-lock\.json$/);
    });
});
