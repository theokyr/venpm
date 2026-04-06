export interface JsonEnvelope<T = unknown> {
    success: boolean;
    error?: string;
    data?: T;
}

export function jsonSuccess<T>(data: T): JsonEnvelope<T> {
    return { success: true, data };
}

export function jsonError(message: string): JsonEnvelope<never> {
    return { success: false, error: message };
}

export function writeJson(envelope: JsonEnvelope, write: (s: string) => void = s => process.stdout.write(s)): void {
    write(JSON.stringify(envelope) + "\n");
}
