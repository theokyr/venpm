export interface ErrorInfo {
    code: string;
    message: string;
    suggestion?: string;
    candidates?: string[];
    docsUrl?: string;
}

export const ErrorCode = {
    VENCORD_NOT_FOUND: "VENCORD_NOT_FOUND",
    PLUGIN_NOT_FOUND: "PLUGIN_NOT_FOUND",
    PLUGIN_AMBIGUOUS: "PLUGIN_AMBIGUOUS",
    PLUGIN_NOT_INSTALLED: "PLUGIN_NOT_INSTALLED",
    REPO_FETCH_FAILED: "REPO_FETCH_FAILED",
    GIT_NOT_AVAILABLE: "GIT_NOT_AVAILABLE",
    PNPM_NOT_AVAILABLE: "PNPM_NOT_AVAILABLE",
    CIRCULAR_DEPENDENCY: "CIRCULAR_DEPENDENCY",
    VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
    SCHEMA_INVALID: "SCHEMA_INVALID",
    BUILD_FAILED: "BUILD_FAILED",
    DISCORD_NOT_FOUND: "DISCORD_NOT_FOUND",
    NON_INTERACTIVE: "NON_INTERACTIVE",
} as const;

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

const DEFAULT_SUGGESTIONS: Record<string, string> = {
    VENCORD_NOT_FOUND: "Run: venpm config set vencord.path /path/to/Vencord",
    PLUGIN_NOT_FOUND: "Run: venpm search <query> to find available plugins",
    PLUGIN_AMBIGUOUS: "Use --from <repo> to specify which repository",
    PLUGIN_NOT_INSTALLED: "Run: venpm list to see installed plugins",
    REPO_FETCH_FAILED: "Check URL with: venpm repo list",
    GIT_NOT_AVAILABLE: "Install git, or use --tarball",
    PNPM_NOT_AVAILABLE: "Install pnpm: npm i -g pnpm",
    CIRCULAR_DEPENDENCY: "Check dependency graph for cycles",
    VERSION_NOT_FOUND: "Run: venpm info <plugin> to see available versions",
    SCHEMA_INVALID: "Run: venpm validate --strict for detailed errors",
    BUILD_FAILED: "Run: venpm doctor to check your environment",
    DISCORD_NOT_FOUND: "Set: venpm config set discord.binary /path/to/discord",
    NON_INTERACTIVE: "Use --yes to auto-confirm, or set config explicitly",
};

export const ExitCode = {
    SUCCESS: 0,
    COMMAND_ERROR: 1,
    USAGE_ERROR: 2,
    ENV_ERROR: 3,
} as const;

export function exitCodeForError(code: ErrorCodeValue): number {
    switch (code) {
        case ErrorCode.VENCORD_NOT_FOUND:
        case ErrorCode.GIT_NOT_AVAILABLE:
        case ErrorCode.PNPM_NOT_AVAILABLE:
        case ErrorCode.BUILD_FAILED:
        case ErrorCode.DISCORD_NOT_FOUND:
            return ExitCode.ENV_ERROR;
        default:
            return ExitCode.COMMAND_ERROR;
    }
}

export function makeError(
    code: ErrorCodeValue,
    message: string,
    options?: { suggestion?: string; candidates?: string[]; docsUrl?: string },
): ErrorInfo {
    let suggestion = options?.suggestion;

    if (!suggestion && options?.candidates && options.candidates.length > 0) {
        if (options.candidates.length === 1) {
            suggestion = `Did you mean: ${options.candidates[0]}`;
        } else {
            suggestion = `Did you mean one of: ${options.candidates.join(", ")}`;
        }
    }

    if (!suggestion) {
        suggestion = DEFAULT_SUGGESTIONS[code];
    }

    return {
        code,
        message,
        suggestion,
        candidates: options?.candidates,
        docsUrl: options?.docsUrl,
    };
}
