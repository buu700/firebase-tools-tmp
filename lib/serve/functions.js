"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionsServer = void 0;
const path = require("path");
const functionsEmulator_1 = require("../emulator/functionsEmulator");
const emulatorServer_1 = require("../emulator/emulatorServer");
const functionsEmulatorUtils_1 = require("../emulator/functionsEmulatorUtils");
const projectUtils_1 = require("../projectUtils");
const auth_1 = require("../auth");
const projectConfig = require("../functions/projectConfig");
const utils = require("../utils");
class FunctionsServer {
    assertServer() {
        if (!this.emulatorServer || !this.backends) {
            throw new Error("Must call start() before calling any other operation!");
        }
    }
    async start(options, partialArgs) {
        const projectId = (0, projectUtils_1.needProjectId)(options);
        const config = projectConfig.normalizeAndValidate(options.config.src.functions);
        const backends = [];
        for (const cfg of config) {
            const functionsDir = path.join(options.config.projectDir, cfg.source);
            const nodeMajorVersion = (0, functionsEmulatorUtils_1.parseRuntimeVersion)(cfg.runtime);
            backends.push({
                functionsDir,
                codebase: cfg.codebase,
                nodeMajorVersion,
                env: {},
                secretEnv: [],
            });
        }
        this.backends = backends;
        const account = (0, auth_1.getProjectDefaultAccount)(options.config.projectDir);
        const args = Object.assign({ projectId, projectDir: options.config.projectDir, emulatableBackends: this.backends, projectAlias: options.projectAlias, account }, partialArgs);
        if (options.host) {
            utils.assertIsStringOrUndefined(options.host);
            args.host = options.host;
        }
        if (options.port) {
            utils.assertIsNumber(options.port);
            const targets = options.targets;
            const port = options.port;
            const hostingRunning = targets && targets.includes("hosting");
            if (hostingRunning) {
                args.port = port + 1;
            }
            else {
                args.port = port;
            }
        }
        this.emulatorServer = new emulatorServer_1.EmulatorServer(new functionsEmulator_1.FunctionsEmulator(args));
        await this.emulatorServer.start();
    }
    async connect() {
        this.assertServer();
        await this.emulatorServer.connect();
    }
    async stop() {
        this.assertServer();
        await this.emulatorServer.stop();
    }
    get() {
        this.assertServer();
        return this.emulatorServer.get();
    }
}
exports.FunctionsServer = FunctionsServer;
//# sourceMappingURL=functions.js.map