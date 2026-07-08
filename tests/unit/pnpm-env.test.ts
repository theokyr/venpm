import { describe, it, expect } from "vitest";
import { createPnpmEnvForNonInteractiveYes } from "../../src/cli/pnpm-env.js";

describe("createPnpmEnvForNonInteractiveYes", () => {
    it("sets CI=true when --yes runs without a TTY and CI is unset", () => {
        expect(
            createPnpmEnvForNonInteractiveYes(
                { yes: true },
                { stdoutIsTTY: false, ci: undefined }
            )
        ).toEqual({ CI: "true" });
    });

    it("treats JSON modes as yes for non-interactive pnpm", () => {
        expect(
            createPnpmEnvForNonInteractiveYes(
                { json: true },
                { stdoutIsTTY: false, ci: undefined }
            )
        ).toEqual({ CI: "true" });

        expect(
            createPnpmEnvForNonInteractiveYes(
                { jsonStream: true },
                { stdoutIsTTY: false, ci: undefined }
            )
        ).toEqual({ CI: "true" });
    });

    it("preserves an existing CI value by not overriding it", () => {
        expect(
            createPnpmEnvForNonInteractiveYes(
                { yes: true },
                { stdoutIsTTY: false, ci: "false" }
            )
        ).toBeUndefined();
    });

    it("leaves interactive rebuilds unchanged", () => {
        expect(
            createPnpmEnvForNonInteractiveYes(
                { yes: true },
                { stdoutIsTTY: true, ci: undefined }
            )
        ).toBeUndefined();
    });

    it("does not set CI without explicit yes semantics", () => {
        expect(
            createPnpmEnvForNonInteractiveYes(
                {},
                { stdoutIsTTY: false, ci: undefined }
            )
        ).toBeUndefined();
    });
});
