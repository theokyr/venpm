import type { Logger } from "./types.js";

type WriteFn = (message: string) => void;

export function createLogger(
    options: { verbose: boolean; quiet: boolean },
    write: WriteFn = console.log,
): Logger {
    const { verbose, quiet } = options;

    return {
        info(message: string): void {
            if (!quiet) write(message);
        },

        warn(message: string): void {
            write(`⚠ ${message}`);
        },

        error(message: string): void {
            write(`✖ ${message}`);
        },

        verbose(message: string): void {
            if (verbose) write(message);
        },

        success(message: string): void {
            if (!quiet) write(`✔ ${message}`);
        },
    };
}
