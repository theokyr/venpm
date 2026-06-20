import { writeSync } from "node:fs";

export function writeStdout(data: string): void {
    writeSync(1, data);
}

export function writeStderr(data: string): void {
    writeSync(2, data);
}
