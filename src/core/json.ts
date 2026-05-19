import type { ErrorInfo } from "./errors.js";

export interface JsonEnvelope<T = unknown> {
    success: boolean;
    error?: ErrorInfo;
    data?: T;
    warnings?: string[];
}

export function jsonSuccess<T>(data: T, warnings?: string[]): JsonEnvelope<T> {
    const envelope: JsonEnvelope<T> = { success: true, data };
    if (warnings && warnings.length > 0) {
        envelope.warnings = warnings;
    }
    return envelope;
}

export function jsonError(error: ErrorInfo): JsonEnvelope<never> {
    return { success: false, error };
}

export function writeJson(envelope: JsonEnvelope, write: (s: string) => void = s => process.stdout.write(s)): void {
    write(JSON.stringify(envelope) + "\n");
}
