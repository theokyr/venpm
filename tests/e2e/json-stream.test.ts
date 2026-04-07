import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");
const VENCORD_FIXTURE = join(import.meta.dirname, "..", "fixtures", "vencord");

function makeEnv(xdg: string): NodeJS.ProcessEnv {
    return { ...process.env, XDG_CONFIG_HOME: xdg, VENPM_VENCORD_PATH: VENCORD_FIXTURE };
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; code: number }> {
    try {
        const { stdout } = await execFileAsync("node", [CLI, ...args], { env });
        return { stdout, code: 0 };
    } catch (err: unknown) {
        const e = err as { stdout?: string; code?: number };
        return { stdout: e.stdout ?? "", code: e.code ?? 1 };
    }
}

function parseNdjson(stdout: string): unknown[] {
    return stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

describe("--json-stream", () => {
    const tmpDirs: string[] = [];
    async function makeTmp() {
        const dir = await mkdtemp(join(tmpdir(), "venpm-stream-"));
        tmpDirs.push(dir);
        return dir;
    }
    afterEach(async () => {
        for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    });

    it("list outputs NDJSON ending with result event", async () => {
        const xdg = await makeTmp();
        const { stdout, code } = await run(["list", "--json-stream"], makeEnv(xdg));
        expect(code).toBe(0);
        const events = parseNdjson(stdout);
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("result");
        expect(last.success).toBe(true);
    });

    it("each line is valid JSON", async () => {
        const xdg = await makeTmp();
        const { stdout } = await run(["doctor", "--json-stream"], makeEnv(xdg));
        const lines = stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });

    it("info for nonexistent plugin ends with error event", async () => {
        const xdg = await makeTmp();
        const { stdout } = await run(["info", "nonexistent", "--json-stream"], makeEnv(xdg));
        const events = parseNdjson(stdout);
        const last = events[events.length - 1] as Record<string, unknown>;
        expect(last.type).toBe("error");
        expect(last.success).toBe(false);
        expect((last.error as Record<string, unknown>).code).toBeDefined();
    });
});
