import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");
const VENCORD_FIXTURE = join(import.meta.dirname, "..", "fixtures", "vencord");

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number }> {
    try {
        await execFileAsync("node", [CLI, ...args], { env });
        return { code: 0 };
    } catch (err: unknown) {
        return { code: (err as { code?: number }).code ?? 1 };
    }
}

describe("exit codes", () => {
    const tmpDirs: string[] = [];
    async function makeTmp() {
        const dir = await mkdtemp(join(tmpdir(), "venpm-exit-"));
        tmpDirs.push(dir);
        return dir;
    }
    afterEach(async () => {
        for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    });

    it("exits 0 for successful list command", async () => {
        const xdg = await makeTmp();
        const env = { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
        const { code } = await run(["list", "--json"], env);
        expect(code).toBe(0);
    });

    it("exits 1 for command errors (plugin not found)", async () => {
        const xdg = await makeTmp();
        const env = { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
        const { code } = await run(["info", "nonexistent-plugin", "--json"], env);
        expect(code).toBe(1);
    });
});
