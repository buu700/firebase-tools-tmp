"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.functionsProxy = void 0;
const lodash_1 = require("lodash");
const proxy_1 = require("./proxy");
const projectUtils_1 = require("../projectUtils");
const registry_1 = require("../emulator/registry");
const types_1 = require("../emulator/types");
const functionsEmulator_1 = require("../emulator/functionsEmulator");
const error_1 = require("../error");
function functionsProxy(options) {
    return (rewrite) => {
        return new Promise((resolve) => {
            const projectId = (0, projectUtils_1.needProjectId)(options);
            if (!("function" in rewrite)) {
                throw new error_1.FirebaseError(`A non-function rewrite cannot be used in functionsProxy`, {
                    exit: 2,
                });
            }
            if (!rewrite.region) {
                rewrite.region = "us-central1";
            }
            let url = `https://${rewrite.region}-${projectId}.cloudfunctions.net/${rewrite.function}`;
            let destLabel = "live";
            if ((0, lodash_1.includes)(options.targets, "functions")) {
                destLabel = "local";
                const functionsEmu = registry_1.EmulatorRegistry.get(types_1.Emulators.FUNCTIONS);
                if (functionsEmu) {
                    url = functionsEmulator_1.FunctionsEmulator.getHttpFunctionUrl(functionsEmu.getInfo().host, functionsEmu.getInfo().port, projectId, rewrite.function, rewrite.region);
                }
            }
            resolve((0, proxy_1.proxyRequestHandler)(url, `${destLabel} Function ${rewrite.region}/${rewrite.function}`));
        });
    };
}
exports.functionsProxy = functionsProxy;
//# sourceMappingURL=functionsProxy.js.map