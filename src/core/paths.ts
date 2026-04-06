import { win32, posix } from "node:path";
import { homedir } from "node:os";

const APP_NAME = "venpm";

function home(): string {
    return process.env.HOME ?? homedir();
}

export function getConfigDir(): string {
    const platform = process.platform;

    if (platform === "win32") {
        const appData = process.env.APPDATA;
        if (appData) return win32.join(appData, APP_NAME);
        return win32.join(home(), "AppData", "Roaming", APP_NAME);
    }

    if (platform === "darwin") {
        return posix.join(home(), "Library", "Application Support", APP_NAME);
    }

    // Linux / other: XDG
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg) return posix.join(xdg, APP_NAME);
    return posix.join(home(), ".config", APP_NAME);
}

function platformJoin(...parts: string[]): string {
    return process.platform === "win32" ? win32.join(...parts) : posix.join(...parts);
}

export function getConfigPath(): string {
    return platformJoin(getConfigDir(), "config.json");
}

export function getLockfilePath(): string {
    return platformJoin(getConfigDir(), "venpm-lock.json");
}
