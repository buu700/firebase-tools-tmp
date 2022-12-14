"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceTokenScraper = void 0;
const logger_1 = require("../../../logger");
class SourceTokenScraper {
    constructor() {
        this.firstCall = true;
        this.promise = new Promise((resolve) => (this.resolve = resolve));
    }
    tokenPromise() {
        if (this.firstCall) {
            this.firstCall = false;
            return Promise.resolve(undefined);
        }
        return this.promise;
    }
    get poller() {
        return (op) => {
            var _a, _b, _c, _d, _e;
            if (((_a = op.metadata) === null || _a === void 0 ? void 0 : _a.sourceToken) || op.done) {
                const [, , , region] = ((_c = (_b = op.metadata) === null || _b === void 0 ? void 0 : _b.target) === null || _c === void 0 ? void 0 : _c.split("/")) || [];
                logger_1.logger.debug(`Got source token ${(_d = op.metadata) === null || _d === void 0 ? void 0 : _d.sourceToken} for region ${region}`);
                this.resolve((_e = op.metadata) === null || _e === void 0 ? void 0 : _e.sourceToken);
            }
        };
    }
}
exports.SourceTokenScraper = SourceTokenScraper;
//# sourceMappingURL=sourceTokenScraper.js.map