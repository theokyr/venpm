import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const CLI = join(import.meta.dirname, "..", "..", "dist", "index.js");

const VENCORD_FIXTURE = join(import.meta.dirname, "..", "fixtures", "vencord");
const VALID_INDEX = join(import.meta.dirname, "..", "fixtures", "indexes", "valid-basic.json");
const INVALID_INDEX = join(import.meta.dirname, "..", "fixtures", "indexes", "invalid-missing-name.json");

function makeEnv(xdgConfigHome: string, vencordPath: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        XDG_CONFIG_HOME: xdgConfigHome,
        VENPM_VENCORD_PATH: vencordPath,
    };
}

async function run(
    args: string[],
    env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
        const { stdout, stderr } = await execFileAsync("node", [CLI, ...args], { env });
        return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return {
            stdout: e.stdout ?? "",
            stderr: e.stderr ?? "",
            code: e.code ?? 1,
        };
    }
}

describe("venpm CLI e2e", () => {
    const tmpDirs: string[] = [];

    async function makeTmp(): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), "venpm-e2e-"));
        tmpDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        for (const dir of tmpDirs.splice(0)) {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("--help shows venpm and command names", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { stdout, code } = await run(["--help"], env);
        expect(code).toBe(0);
        expect(stdout).toContain("venpm");
        expect(stdout).toMatch(/install|uninstall|update|list|search/);
    });

    it("--version shows semver", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { stdout, code } = await run(["--version"], env);
        expect(code).toBe(0);
        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("doctor runs without error", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { code } = await run(["doctor"], env);
        expect(code).toBe(0);
    });

    it("config path prints venpm directory", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { stdout, code } = await run(["config", "path"], env);
        expect(code).toBe(0);
        expect(stdout.trim()).toContain("venpm");
        // Should be inside the temp XDG dir
        expect(stdout.trim()).toContain(xdg);
    });

    it("repo list shows default kamaras repo", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { stdout, code } = await run(["repo", "list"], env);
        expect(code).toBe(0);
        expect(stdout).toContain("kamaras");
    });

    it("create scaffolds a plugin repo (plugins.json exists and is valid)", async () => {
        const xdg = await makeTmp();
        const repoDir = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { code } = await run(["create", repoDir], env);
        expect(code).toBe(0);

        const pluginsJsonPath = join(repoDir, "plugins.json");
        const raw = await readFile(pluginsJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(parsed).toHaveProperty("$schema");
        expect(parsed).toHaveProperty("name");
        expect(parsed).toHaveProperty("plugins");
        expect(typeof parsed.$schema).toBe("string");
        expect((parsed.$schema as string)).toContain("venpm");
    });

    it("validate accepts a valid index", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { code, stdout } = await run(["validate", VALID_INDEX], env);
        expect(code).toBe(0);
        expect(stdout).toContain("valid");
    });

    it("validate rejects an invalid index", async () => {
        const xdg = await makeTmp();
        const env = makeEnv(xdg, VENCORD_FIXTURE);
        const { code, stderr, stdout } = await run(["validate", INVALID_INDEX], env);
        expect(code).not.toBe(0);
        const output = stdout + stderr;
        expect(output).toMatch(/error|fail|invalid/i);
    });
});
