function wrap(code: string): (text: string) => string {
    return (text: string) => `\x1b[${code}m${text}\x1b[0m`;
}

function passthrough(text: string): string {
    return text;
}

export interface Colors {
    amber(text: string): string;
    emerald(text: string): string;
    red(text: string): string;
    yellow(text: string): string;
    dim(text: string): string;
    bright(text: string): string;
    bold(text: string): string;
}

export function createColors(enabled: boolean): Colors {
    if (!enabled) {
        return {
            amber: passthrough,
            emerald: passthrough,
            red: passthrough,
            yellow: passthrough,
            dim: passthrough,
            bright: passthrough,
            bold: passthrough,
        };
    }
    return {
        amber: wrap("38;2;249;115;22"),
        emerald: wrap("38;2;52;211;153"),
        red: wrap("38;2;239;68;68"),
        yellow: wrap("38;2;251;191;36"),
        dim: wrap("38;2;74;92;86"),
        bright: wrap("38;2;232;232;232"),
        bold: wrap("1"),
    };
}

export function shouldColorize(stream: { isTTY?: boolean }): boolean {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return true;
    return !!stream.isTTY;
}
