import type { Prompter } from "./types.js";
import { createColors, shouldColorize } from "./ansi.js";

export function createPrompter(options: { yes: boolean; nonInteractive?: boolean }): Prompter {
    if (options.yes) {
        return {
            async confirm(_message: string, defaultValue = true): Promise<boolean> {
                return defaultValue;
            },
            async input(_message: string, defaultValue?: string): Promise<string> {
                return defaultValue ?? "";
            },
            async select<T extends string>(_message: string, choices: { value: T; label: string }[]): Promise<T> {
                return choices[0].value;
            },
        };
    }

    if (options.nonInteractive) {
        const bail = (message: string): never => {
            throw new Error(
                `Cannot prompt in non-interactive mode (no TTY): "${message}". ` +
                `Use --yes to auto-confirm, or set config values explicitly.`,
            );
        };
        return {
            async confirm(message: string): Promise<boolean> { return bail(message); },
            async input(message: string): Promise<string> { return bail(message); },
            async select<T extends string>(message: string): Promise<T> { return bail(message); },
        };
    }

    return {
        async confirm(message: string, defaultValue = true): Promise<boolean> {
            const { createInterface } = await import("readline/promises");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const c = createColors(shouldColorize(process.stdout));
            const hint = defaultValue ? "[Y/n]" : "[y/N]";
            try {
                const answer = await rl.question(`  ${c.amber("?")} ${message} ${c.dim(hint)} `);
                const trimmed = answer.trim().toLowerCase();
                if (trimmed === "") return defaultValue;
                return trimmed === "y" || trimmed === "yes";
            } finally {
                rl.close();
            }
        },

        async input(message: string, defaultValue?: string): Promise<string> {
            const { createInterface } = await import("readline/promises");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const c = createColors(shouldColorize(process.stdout));
            const hint = defaultValue !== undefined ? ` (${defaultValue})` : "";
            try {
                const answer = await rl.question(`  ${c.amber("?")} ${message}${c.dim(hint)}: `);
                const trimmed = answer.trim();
                return trimmed === "" ? (defaultValue ?? "") : trimmed;
            } finally {
                rl.close();
            }
        },

        async select<T extends string>(message: string, choices: { value: T; label: string }[]): Promise<T> {
            const c = createColors(shouldColorize(process.stdout));

            // Try raw mode for arrow-key navigation
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
                return new Promise<T>((resolve) => {
                    let selected = 0;

                    function render(): void {
                        const lines = choices.map((choice, i) => {
                            const marker = i === selected ? c.amber("❯") : " ";
                            const label = i === selected ? choice.label : c.dim(choice.label);
                            return `    ${marker} ${label}`;
                        });
                        process.stdout.write(`\r\x1b[K  ${c.amber("?")} ${message}\n`);
                        for (const line of lines) {
                            process.stdout.write(`\r\x1b[K${line}\n`);
                        }
                        // Move cursor back up
                        process.stdout.write(`\x1b[${lines.length + 1}A`);
                    }

                    render();
                    process.stdin.setRawMode(true);
                    process.stdin.resume();

                    function onData(data: Buffer): void {
                        const key = data.toString();
                        if (key === "\x1b[A" || key === "k") { // Up arrow or k
                            selected = (selected - 1 + choices.length) % choices.length;
                            render();
                        } else if (key === "\x1b[B" || key === "j") { // Down arrow or j
                            selected = (selected + 1) % choices.length;
                            render();
                        } else if (key === "\r" || key === "\n") { // Enter
                            process.stdin.setRawMode(false);
                            process.stdin.pause();
                            process.stdin.removeListener("data", onData);
                            // Clear the select UI and show chosen value
                            process.stdout.write(`\r\x1b[K  ${c.amber("?")} ${message} ${c.bright(choices[selected].label)}\n`);
                            // Clear remaining lines
                            for (let i = 0; i < choices.length; i++) {
                                process.stdout.write(`\r\x1b[K\n`);
                            }
                            process.stdout.write(`\x1b[${choices.length}A`);
                            resolve(choices[selected].value);
                        } else if (key === "\x03") { // Ctrl+C
                            process.stdin.setRawMode(false);
                            process.stdin.pause();
                            process.stdin.removeListener("data", onData);
                            process.exit(130);
                        }
                    }

                    process.stdin.on("data", onData);
                });
            }

            // Fallback: numbered input with styling
            const { createInterface } = await import("readline/promises");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const lines = choices.map((ch, i) => `  ${i + 1}) ${ch.label}`).join("\n");
            try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const answer = await rl.question(`  ${c.amber("?")} ${message}\n${lines}\nChoice [1]: `);
                    const trimmed = answer.trim();
                    if (trimmed === "") return choices[0].value;
                    const idx = parseInt(trimmed, 10) - 1;
                    if (!isNaN(idx) && idx >= 0 && idx < choices.length) {
                        return choices[idx].value;
                    }
                }
            } finally {
                rl.close();
            }
        },
    };
}
