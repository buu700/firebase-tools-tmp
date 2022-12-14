"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Delegate = exports.tryCreateDelegate = void 0;
const util_1 = require("util");
const fs = require("fs");
const path = require("path");
const portfinder = require("portfinder");
const semver = require("semver");
const spawn = require("cross-spawn");
const node_fetch_1 = require("node-fetch");
const error_1 = require("../../../../error");
const parseRuntimeAndValidateSDK_1 = require("./parseRuntimeAndValidateSDK");
const logger_1 = require("../../../../logger");
const utils_1 = require("../../../../utils");
const discovery = require("../discovery");
const validate = require("./validate");
const versioning = require("./versioning");
const parseTriggers = require("./parseTriggers");
const MIN_FUNCTIONS_SDK_VERSION = "3.20.0";
async function tryCreateDelegate(context) {
    const packageJsonPath = path.join(context.sourceDir, "package.json");
    if (!(await (0, util_1.promisify)(fs.exists)(packageJsonPath))) {
        logger_1.logger.debug("Customer code is not Node");
        return undefined;
    }
    const runtime = (0, parseRuntimeAndValidateSDK_1.getRuntimeChoice)(context.sourceDir, context.runtime);
    if (!runtime.startsWith("nodejs")) {
        logger_1.logger.debug("Customer has a package.json but did not get a nodejs runtime. This should not happen");
        throw new error_1.FirebaseError(`Unexpected runtime ${runtime}`);
    }
    return new Delegate(context.projectId, context.projectDir, context.sourceDir, runtime);
}
exports.tryCreateDelegate = tryCreateDelegate;
class Delegate {
    constructor(projectId, projectDir, sourceDir, runtime) {
        this.projectId = projectId;
        this.projectDir = projectDir;
        this.sourceDir = sourceDir;
        this.runtime = runtime;
        this.name = "nodejs";
        this._sdkVersion = "";
    }
    get sdkVersion() {
        if (!this._sdkVersion) {
            this._sdkVersion = versioning.getFunctionsSDKVersion(this.sourceDir) || "";
        }
        return this._sdkVersion;
    }
    validate() {
        versioning.checkFunctionsSDKVersion(this.sdkVersion);
        const relativeDir = path.relative(this.projectDir, this.sourceDir);
        validate.packageJsonIsValid(relativeDir, this.sourceDir, this.projectDir);
        return Promise.resolve();
    }
    async build() {
    }
    watch() {
        return Promise.resolve(() => Promise.resolve());
    }
    serve(port, config, envs) {
        var _a;
        const env = Object.assign(Object.assign({}, envs), { PORT: port.toString(), FUNCTIONS_CONTROL_API: "true", HOME: process.env.HOME, PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV });
        if (Object.keys(config || {}).length) {
            env.CLOUD_RUNTIME_CONFIG = JSON.stringify(config);
        }
        const childProcess = spawn("./node_modules/.bin/firebase-functions", [this.sourceDir], {
            env,
            cwd: this.sourceDir,
            stdio: ["ignore", "pipe", "inherit"],
        });
        (_a = childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (chunk) => {
            logger_1.logger.debug(chunk.toString());
        });
        return Promise.resolve(async () => {
            const p = new Promise((resolve, reject) => {
                childProcess.once("exit", resolve);
                childProcess.once("error", reject);
            });
            await (0, node_fetch_1.default)(`http://localhost:${port}/__/quitquitquit`);
            setTimeout(() => {
                if (!childProcess.killed) {
                    childProcess.kill("SIGKILL");
                }
            }, 10000);
            return p;
        });
    }
    async discoverBuild(config, env) {
        if (!semver.valid(this.sdkVersion)) {
            logger_1.logger.debug(`Could not parse firebase-functions version '${this.sdkVersion}' into semver. Falling back to parseTriggers.`);
            return parseTriggers.discoverBuild(this.projectId, this.sourceDir, this.runtime, config, env);
        }
        if (semver.lt(this.sdkVersion, MIN_FUNCTIONS_SDK_VERSION)) {
            (0, utils_1.logLabeledWarning)("functions", `You are using an old version of firebase-functions SDK (${this.sdkVersion}). ` +
                `Please update firebase-functions SDK to >=${MIN_FUNCTIONS_SDK_VERSION}`);
            return parseTriggers.discoverBuild(this.projectId, this.sourceDir, this.runtime, config, env);
        }
        let discovered = await discovery.detectFromYaml(this.sourceDir, this.projectId, this.runtime);
        if (!discovered) {
            const getPort = (0, util_1.promisify)(portfinder.getPort);
            const port = await getPort();
            const kill = await this.serve(port, config, env);
            try {
                discovered = await discovery.detectFromPort(port, this.projectId, this.runtime);
            }
            finally {
                await kill();
            }
        }
        return discovered;
    }
}
exports.Delegate = Delegate;
//# sourceMappingURL=index.js.map