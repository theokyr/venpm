import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

function emit(write: WriteFn, event: Record<string, unknown>): void {
    write(JSON.stringify(event) + "\n");
}

export function createStreamRenderer(
    write: WriteFn = (s) => process.stdout.write(s),
): Renderer {
    const warnings: string[] = [];
    let lastError: ErrorInfo | undefined;

    return {
        text(message: string): void {
            emit(write, { type: "log", message });
        },
        heading(message: string): void {
            emit(write, { type: "log", message });
        },
        success(message: string): void {
            emit(write, { type: "log", message });
        },
        warn(message: string): void {
            warnings.push(message);
            emit(write, { type: "warning", message });
        },
        error(info: ErrorInfo): void {
            lastError = info;
        },
        verbose(message: string): void {
            emit(write, { type: "log", message });
        },
        dim(message: string): void {
            emit(write, { type: "log", message });
        },
        table(): void {},
        keyValue(): void {},
        list(): void {},
        progress(id: string, message: string): ProgressHandle {
            emit(write, { type: "progress", id, message });
            return {
                update(msg: string): void {
                    emit(write, { type: "progress", id, message: msg });
                },
                succeed(msg?: string): void {
                    emit(write, { type: "progress", id, status: "done", message: msg ?? message });
                },
                fail(msg?: string): void {
                    emit(write, { type: "progress", id, status: "fail", message: msg ?? message });
                },
            };
        },
        write(data: string): void {
            emit(write, { type: "log", message: data });
        },
        finish(success: boolean, data?: unknown, extraWarnings?: string[]): void {
            const allWarnings = [...warnings, ...(extraWarnings ?? [])];
            if (success) {
                const event: Record<string, unknown> = { type: "result", success: true, data };
                if (allWarnings.length > 0) event.warnings = allWarnings;
                emit(write, event);
            } else {
                const event: Record<string, unknown> = {
                    type: "error",
                    success: false,
                    error: lastError ?? { code: "UNKNOWN", message: "Unknown error" },
                };
                if (allWarnings.length > 0) event.warnings = allWarnings;
                emit(write, event);
            }
        },
    };
}
