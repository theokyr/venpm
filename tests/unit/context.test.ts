import { describe, it, expect } from "vitest";
import { createRealIOContext } from "../../src/cli/context.js";

describe("createRealIOContext shell", () => {
    it("rejects detached spawn failures", async () => {
        const ctx = createRealIOContext({ yes: true });

        await expect(
            ctx.shell.spawn("/tmp/venpm-definitely-missing-discord", [], { detached: true })
        ).rejects.toThrow();
    });
});
