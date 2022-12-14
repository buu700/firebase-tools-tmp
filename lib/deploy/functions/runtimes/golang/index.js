"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Delegate = exports.tryCreateDelegate = exports.FUNCTIONS_RUNTIME = exports.FUNCTIONS_CODEGEN = exports.FUNCTIONS_SDK = exports.ADMIN_SDK = void 0;
const util_1 = require("util");
const node_fetch_1 = require("node-fetch");
const fs = require("fs");
const path = require("path");
const spawn = require("cross-spawn");
const error_1 = require("../../../../error");
const logger_1 = require("../../../../logger");
const gomod = require("./gomod");
const VERSION_TO_RUNTIME = {
    "1.13": "go113",
};
exports.ADMIN_SDK = "firebase.google.com/go/v4";
exports.FUNCTIONS_SDK = "github.com/FirebaseExtended/firebase-functions-go";
exports.FUNCTIONS_CODEGEN = exports.FUNCTIONS_SDK + "/support/codegen";
exports.FUNCTIONS_RUNTIME = exports.FUNCTIONS_SDK + "/support/runtime";
async function tryCreateDelegate(context) {
    const goModPath = path.join(context.sourceDir, "go.mod");
    let module;
    try {
        const modBuffer = await (0, util_1.promisify)(fs.readFile)(goModPath);
        module = gomod.parseModule(modBuffer.toString("utf8"));
    }
    catch (err) {
        logger_1.logger.debug("Customer code is not Golang code (or they aren't using gomod)");
        return;
    }
    let runtime = context.runtime;
    if (!runtime) {
        if (!module.version) {
            throw new error_1.FirebaseError("Could not detect Golang version from go.mod");
        }
        if (!VERSION_TO_RUNTIME[module.version]) {
            throw new error_1.FirebaseError(`go.mod specifies Golang version ${module.version} which is unsupported by Google Cloud Functions. Valid values are ${Object.keys(VERSION_TO_RUNTIME).join(", ")}`);
        }
        runtime = VERSION_TO_RUNTIME[module.version];
    }
    return new Delegate(context.projectId, context.sourceDir, runtime, module);
}
exports.tryCreateDelegate = tryCreateDelegate;
class Delegate {
    constructor(projectId, sourceDir, runtime, module) {
        this.projectId = projectId;
        this.sourceDir = sourceDir;
        this.runtime = runtime;
        this.module = module;
        this.name = "golang";
    }
    validate() {
        return Promise.resolve();
    }
    async build() {
        try {
            await (0, util_1.promisify)(fs.mkdir)(path.join(this.sourceDir, "autogen"));
        }
        catch (err) {
            if ((err === null || err === void 0 ? void 0 : err.code) !== "EEXIST") {
                throw new error_1.FirebaseError("Failed to create codegen directory", { children: [err] });
            }
        }
        const genBinary = spawn.sync("go", ["run", exports.FUNCTIONS_CODEGEN, this.module.module], {
            cwd: this.sourceDir,
            env: Object.assign(Object.assign({}, process.env), { HOME: process.env.HOME, PATH: process.env.PATH, GOPATH: process.env.GOPATH }),
            stdio: ["ignore", "pipe", "pipe"],
        });
        if (genBinary.status !== 0) {
            throw new error_1.FirebaseError("Failed to run codegen", {
                children: [new Error(genBinary.stderr.toString())],
            });
        }
        await (0, util_1.promisify)(fs.writeFile)(path.join(this.sourceDir, "autogen", "main.go"), genBinary.stdout);
    }
    watch() {
        return Promise.resolve(() => Promise.resolve());
    }
    serve(port, adminPort, envs) {
        var _a;
        const childProcess = spawn("go", ["run", "./autogen"], {
            env: Object.assign(Object.assign(Object.assign({}, process.env), envs), { PORT: port.toString(), ADMIN_PORT: adminPort.toString(), HOME: process.env.HOME, PATH: process.env.PATH, GOPATH: process.env.GOPATH }),
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
            await (0, node_fetch_1.default)(`http://localhost:${adminPort}/__/quitquitquit`);
            setTimeout(() => {
                if (!childProcess.killed) {
                    childProcess.kill("SIGKILL");
                }
            }, 10000);
            return p;
        });
    }
    async discoverBuild() {
        return Promise.resolve({ requiredAPIs: [], endpoints: {}, params: [] });
    }
}
exports.Delegate = Delegate;
//# sourceMappingURL=index.js.map