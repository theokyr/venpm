import type { Renderer } from "./types.js";
import type { ErrorInfo } from "./errors.js";
import type { Colors } from "./ansi.js";
import { createColors } from "./ansi.js";
import { createPlainProgress, createTtyProgress, type ProgressHandle } from "./progress.js";

type WriteFn = (data: string) => void;

// ─── Alignment helpers ────────────────────────────────────────────────────────

function padEnd(s: string, width: number): string {
    return s + " ".repeat(Math.max(0, width - s.length));
}

function columnWidths(headers: string[], rows: string[][]): number[] {
    return headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
    );
}

// ─── Error formatting ─────────────────────────────────────────────────────────

function formatError(
    info: ErrorInfo,
    write: WriteFn,
    cross: (s: string) => string,
    codeColor: (s: string) => string,
    suggestionColor: (s: string) => string,
): void {
    write(`  ${cross("✖")} ${info.message}\n`);
    if (info.suggestion) {
        write(`  ⟩ ${suggestionColor(info.suggestion)}\n`);
    }
    const codePart = `[${info.code}]`;
    // Right-pad to 48 chars so code appears at the far right
    const padding = " ".repeat(Math.max(0, 48 - codePart.length));
    write(`${padding}${codeColor(codePart)}\n`);
}

// ─── PlainRenderer ────────────────────────────────────────────────────────────

export function createPlainRenderer(
    options: { verbose: boolean; quiet: boolean },
    write: WriteFn = (d) => process.stdout.write(d),
): Renderer {
    const { verbose, quiet } = options;

    return {
        text(message: string): void {
            if (quiet) return;
            write(`  ${message}\n`);
        },

        heading(message: string): void {
            if (quiet) return;
            write(`  ${message}\n`);
        },

        success(message: string): void {
            if (quiet) return;
            write(`  ✔ ${message}\n`);
        },

        warn(message: string): void {
            write(`  ⚠ ${message}\n`);
        },

        error(info: ErrorInfo): void {
            formatError(info, write, (s) => s, (s) => s, (s) => s);
        },

        verbose(message: string): void {
            if (!verbose) return;
            write(`  ${message}\n`);
        },

        dim(message: string): void {
            if (quiet) return;
            write(`  ${message}\n`);
        },

        table(headers: string[], rows: string[][]): void {
            const widths = columnWidths(headers, rows);
            const headerLine = headers.map((h, i) => padEnd(h, widths[i])).join("  ");
            write(`  ${headerLine}\n`);
            const sep = widths.map((w) => "-".repeat(w)).join("  ");
            write(`  ${sep}\n`);
            for (const row of rows) {
                const line = row.map((cell, i) => padEnd(cell, widths[i])).join("  ");
                write(`  ${line}\n`);
            }
        },

        keyValue(pairs: [string, string][]): void {
            const maxKey = Math.max(...pairs.map(([k]) => k.length));
            for (const [key, value] of pairs) {
                write(`  ${padEnd(key, maxKey)}: ${value}\n`);
            }
        },

        list(items: string[]): void {
            for (const item of items) {
                write(`  • ${item}\n`);
            }
        },

        progress(id: string, message: string): ProgressHandle {
            return createPlainProgress(id, message, write);
        },

        write(data: string): void {
            write(data);
        },

        finish(_success: boolean, _data?: unknown, _warnings?: string[]): void {
            // no-op: plain renderer writes immediately
        },
    };
}

// ─── TtyRenderer ──────────────────────────────────────────────────────────────

export function createTtyRenderer(
    options: { verbose: boolean; quiet: boolean },
    write: WriteFn = (d) => process.stdout.write(d),
    colors: Colors = createColors(true),
): Renderer {
    const { verbose, quiet } = options;

    return {
        text(message: string): void {
            if (quiet) return;
            write(`  ${message}\n`);
        },

        heading(message: string): void {
            if (quiet) return;
            write(`  ${colors.bold(colors.amber(message))}\n`);
        },

        success(message: string): void {
            if (quiet) return;
            write(`  ${colors.emerald("✔")} ${message}\n`);
        },

        warn(message: string): void {
            write(`  ${colors.yellow("⚠")} ${message}\n`);
        },

        error(info: ErrorInfo): void {
            formatError(
                info,
                write,
                (s) => colors.red(s),
                (s) => colors.dim(s),
                (s) => colors.amber(s),
            );
        },

        verbose(message: string): void {
            if (!verbose) return;
            write(`  ${colors.dim(message)}\n`);
        },

        dim(message: string): void {
            if (quiet) return;
            write(`  ${colors.dim(message)}\n`);
        },

        table(headers: string[], rows: string[][]): void {
            const widths = columnWidths(headers, rows);
            const headerLine = headers.map((h, i) => padEnd(h, widths[i])).join("  ");
            write(`  ${colors.dim(headerLine)}\n`);
            const sep = widths.map((w) => "-".repeat(w)).join("  ");
            write(`  ${colors.dim(sep)}\n`);
            for (const row of rows) {
                const line = row.map((cell, i) => padEnd(cell, widths[i])).join("  ");
                write(`  ${line}\n`);
            }
        },

        keyValue(pairs: [string, string][]): void {
            const maxKey = Math.max(...pairs.map(([k]) => k.length));
            for (const [key, value] of pairs) {
                write(`  ${colors.dim(padEnd(key, maxKey) + ":")} ${value}\n`);
            }
        },

        list(items: string[]): void {
            for (const item of items) {
                write(`  • ${item}\n`);
            }
        },

        progress(id: string, message: string): ProgressHandle {
            return createTtyProgress(id, message, write, colors);
        },

        write(data: string): void {
            write(data);
        },

        finish(_success: boolean, _data?: unknown, _warnings?: string[]): void {
            // no-op: tty renderer writes immediately
        },
    };
}
