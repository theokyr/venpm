import type { Colors } from "./ansi.js";

export interface ProgressHandle {
    update(message: string): void;
    succeed(message?: string): void;
    fail(message?: string): void;
}

type WriteFn = (data: string) => void;

// ─── Plain (non-TTY) ─────────────────────────────────────────────────────────

export function createPlainProgress(
    _id: string,
    initialMessage: string,
    write: WriteFn,
): ProgressHandle {
    write(`  ⟩ ${initialMessage}\n`);

    return {
        update(message: string): void {
            write(`  ⟩ ${message}\n`);
        },
        succeed(message?: string): void {
            write(`  ✔ ${message ?? initialMessage}\n`);
        },
        fail(message?: string): void {
            write(`  ✖ ${message ?? initialMessage}\n`);
        },
    };
}

// ─── TTY (animated spinner) ──────────────────────────────────────────────────

const SPINNER_FRAMES = ["⟩", "⟫", "⟩"];
const SPINNER_INTERVAL = 120;

export function createTtyProgress(
    _id: string,
    initialMessage: string,
    write: WriteFn,
    colors: Colors,
): ProgressHandle {
    let message = initialMessage;
    let frameIndex = 0;
    let finished = false;

    function render(): void {
        const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
        write(`\r\x1b[K  ${colors.amber(frame)} ${message}`);
    }

    render();
    const timer = setInterval(() => {
        if (finished) return;
        frameIndex++;
        render();
    }, SPINNER_INTERVAL);

    function stop(): void {
        finished = true;
        clearInterval(timer);
    }

    return {
        update(msg: string): void {
            message = msg;
            render();
        },
        succeed(msg?: string): void {
            stop();
            write(`\r\x1b[K  ${colors.emerald("✔")} ${msg ?? message}\n`);
        },
        fail(msg?: string): void {
            stop();
            write(`\r\x1b[K  ${colors.red("✖")} ${msg ?? message}\n`);
        },
    };
}
