// eslint-disable-next-line @typescript-eslint/no-require-imports
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Handle CJS/ESM interop
const Ajv2020 = (Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module;
const addFormats = (addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule;

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "..", "..", "schemas", "v1");

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

function createValidator() {
    // @ts-expect-error — ajv CJS/ESM interop
    const ajv = new Ajv2020({ allErrors: true });
    // @ts-expect-error — ajv-formats CJS/ESM interop
    addFormats(ajv);
    return ajv;
}

function loadSchema(filename: string): object {
    const raw = readFileSync(join(schemasDir, filename), "utf-8");
    return JSON.parse(raw);
}

function validate(data: unknown, schemaFile: string): ValidationResult {
    if (data === null || data === undefined) {
        return { valid: false, errors: ["Input is null or undefined"] };
    }
    const ajv = createValidator();
    const schema = loadSchema(schemaFile);
    const valid = ajv.validate(schema, data);
    if (valid) return { valid: true, errors: [] };
    const errors = (ajv.errors ?? []).map((e: { instancePath?: string; message?: string }) => {
        const path = e.instancePath || "/";
        return `${path}: ${e.message}`;
    });
    return { valid: false, errors };
}

export function validateIndex(data: unknown): ValidationResult {
    return validate(data, "plugins.schema.json");
}

export function validateConfig(data: unknown): ValidationResult {
    return validate(data, "config.schema.json");
}

export function validateLockfile(data: unknown): ValidationResult {
    return validate(data, "lockfile.schema.json");
}
