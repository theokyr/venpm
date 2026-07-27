import { describe, it, expect } from "vitest";
import { createPnpmEnvForNonInteractiveYes } from "../../src/cli/pnpm-env.js";

describe("createPnpmEnvForNonInteractiveYes", () => {
    it("sets CI=true when --yes is used and CI is unset", () => {
        expect(
            createPnpmEnvForNonInteractiveYes({ yes: true })
        ).toEqual({ CI: "true" });
    });

    it("treats JSON modes as yes for non-interactive pnpm", () => {
        expect(
            createPnpmEnvForNonInteractiveYes({ json: true })
        ).toEqual({ CI: "true" });

        expect(
            createPnpmEnvForNonInteractiveYes({ jsonStream: true })
        ).toEqual({ CI: "true" });
    });

    it("overrides CI=false because explicit --yes authorizes pnpm's purge", () => {
        expect(createPnpmEnvForNonInteractiveYes({ yes: true })).toEqual({ CI: "true" });
    });

    it("does not set CI without explicit yes semantics", () => {
        expect(
            createPnpmEnvForNonInteractiveYes({})
        ).toBeUndefined();
    });
});
