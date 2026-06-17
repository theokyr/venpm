import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../../src/core/log.js";

describe("createLogger", () => {
    it("logs info by default", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: false }, write);
        logger.info("hello");
        expect(write).toHaveBeenCalledWith("hello");
    });

    it("suppresses info in quiet mode", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: true }, write);
        logger.info("hello");
        expect(write).not.toHaveBeenCalled();
    });

    it("shows errors in quiet mode", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: true }, write);
        logger.error("boom");
        expect(write).toHaveBeenCalledWith("✖ boom");
    });

    it("shows warnings in quiet mode", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: true }, write);
        logger.warn("careful");
        expect(write).toHaveBeenCalledWith("⚠ careful");
    });

    it("shows verbose only in verbose mode", () => {
        const writeVerbose = vi.fn();
        const loggerVerbose = createLogger({ verbose: true, quiet: false }, writeVerbose);
        loggerVerbose.verbose("detail");
        expect(writeVerbose).toHaveBeenCalledWith("detail");

        const writeSilent = vi.fn();
        const loggerSilent = createLogger({ verbose: false, quiet: false }, writeSilent);
        loggerSilent.verbose("detail");
        expect(writeSilent).not.toHaveBeenCalled();
    });

    it("prefixes warnings with ⚠", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: false }, write);
        logger.warn("watch out");
        expect(write).toHaveBeenCalledWith("⚠ watch out");
    });

    it("prefixes success with ✔", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: false }, write);
        logger.success("done");
        expect(write).toHaveBeenCalledWith("✔ done");
    });

    it("suppresses success in quiet mode", () => {
        const write = vi.fn();
        const logger = createLogger({ verbose: false, quiet: true }, write);
        logger.success("done");
        expect(write).not.toHaveBeenCalled();
    });
});
