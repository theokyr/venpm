import type { Prompter } from "./types.js";

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
            const hint = defaultValue ? "[Y/n]" : "[y/N]";
            try {
                const answer = await rl.question(`${message} ${hint} `);
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
            const hint = defaultValue !== undefined ? ` (${defaultValue})` : "";
            try {
                const answer = await rl.question(`${message}${hint}: `);
                const trimmed = answer.trim();
                return trimmed === "" ? (defaultValue ?? "") : trimmed;
            } finally {
                rl.close();
            }
        },

        async select<T extends string>(message: string, choices: { value: T; label: string }[]): Promise<T> {
            const { createInterface } = await import("readline/promises");
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const lines = choices.map((c, i) => `  ${i + 1}) ${c.label}`).join("\n");
            try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const answer = await rl.question(`${message}\n${lines}\nChoice [1]: `);
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
