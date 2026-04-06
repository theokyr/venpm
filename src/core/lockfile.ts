import { dirname } from "node:path";
import type { FileSystem, InstalledPlugin, LockfileData } from "./types.js";

export const EMPTY_LOCKFILE: LockfileData = { plugins: {} };

export async function loadLockfile(fs: FileSystem, path: string): Promise<LockfileData> {
    const exists = await fs.exists(path);
    if (!exists) return { ...EMPTY_LOCKFILE, plugins: {} };
    const raw = await fs.readFile(path, "utf-8");
    return JSON.parse(raw) as LockfileData;
}

export async function saveLockfile(fs: FileSystem, path: string, data: LockfileData): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

export function isInstalled(data: LockfileData, name: string): boolean {
    return Object.prototype.hasOwnProperty.call(data.plugins, name);
}

export function getInstalled(data: LockfileData, name: string): InstalledPlugin | undefined {
    return data.plugins[name];
}

export function addInstalled(data: LockfileData, name: string, entry: InstalledPlugin): LockfileData {
    return {
        ...data,
        plugins: { ...data.plugins, [name]: entry },
    };
}

export function removeInstalled(data: LockfileData, name: string): LockfileData {
    const { [name]: _removed, ...rest } = data.plugins;
    return { ...data, plugins: rest };
}
