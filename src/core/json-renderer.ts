import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

const NOOP_PROGRESS: ProgressHandle = {
    update(): void {},
    succeed(): void {},
    fail(): void {},
};

export function createJsonRenderer(
    write: WriteFn = (s) => process.stdout.write(s),
): Renderer {
    const warnings: string[] = [];
    let lastError: ErrorInfo | undefined;

    return {
        text(): void {},
        heading(): void {},
        success(): void {},
        warn(message: string): void {
            warnings.push(message);
        },
        error(info: ErrorInfo): void {
            lastError = info;
        },
        verbose(): void {},
        dim(): void {},
        table(): void {},
        keyValue(): void {},
        list(): void {},
        progress(): ProgressHandle {
            return NOOP_PROGRESS;
        },
        write(): void {},
        finish(success: boolean, data?: unknown, extraWarnings?: string[]): void {
            const allWarnings = [...warnings, ...(extraWarnings ?? [])];
            if (success) {
                const envelope: Record<string, unknown> = { success: true, data };
                if (allWarnings.length > 0) envelope.warnings = allWarnings;
                write(JSON.stringify(envelope) + "\n");
            } else {
                const envelope: Record<string, unknown> = {
                    success: false,
                    error: lastError ?? { code: "UNKNOWN", message: "Unknown error" },
                };
                if (allWarnings.length > 0) envelope.warnings = allWarnings;
                write(JSON.stringify(envelope) + "\n");
            }
        },
    };
}
