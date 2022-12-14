"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect = exports.start = exports.stop = void 0;
const clc = require("colorette");
const superstatic = require("superstatic").server;
const morgan = require("morgan");
const detectProjectRoot_1 = require("../detectProjectRoot");
const error_1 = require("../error");
const implicitInit_1 = require("../hosting/implicitInit");
const initMiddleware_1 = require("../hosting/initMiddleware");
const normalizedHostingConfigs_1 = require("../hosting/normalizedHostingConfigs");
const cloudRunProxy_1 = require("../hosting/cloudRunProxy");
const functionsProxy_1 = require("../hosting/functionsProxy");
const stream_1 = require("stream");
const emulatorLogger_1 = require("../emulator/emulatorLogger");
const types_1 = require("../emulator/types");
const utils_1 = require("../utils");
const child_process_1 = require("child_process");
const MAX_PORT_ATTEMPTS = 10;
let attempts = 0;
let destroyServer = undefined;
const logger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.HOSTING);
function startServer(options, config, port, init) {
    const firebaseMiddleware = (0, initMiddleware_1.initMiddleware)(init);
    const morganStream = new stream_1.Writable();
    morganStream._write = (chunk, encoding, callback) => {
        if (chunk instanceof Buffer) {
            logger.logLabeled("BULLET", "hosting", chunk.toString().trim());
        }
        callback();
    };
    const morganMiddleware = morgan("combined", {
        stream: morganStream,
    });
    const portInUse = () => {
        const message = "Port " + options.port + " is not available.";
        logger.log("WARN", clc.yellow("hosting: ") + message + " Trying another port...");
        if (attempts < MAX_PORT_ATTEMPTS) {
            attempts++;
            startServer(options, config, port + 5, init);
        }
        else {
            logger.log("WARN", message);
            throw new error_1.FirebaseError("Could not find an open port for hosting development server.", {
                exit: 1,
            });
        }
    };
    if (process.platform === "darwin") {
        try {
            (0, child_process_1.execSync)(`lsof -i :${port} -sTCP:LISTEN`);
            portInUse();
            return;
        }
        catch (e) {
        }
    }
    const after = options.frameworksDevModeHandle && {
        files: options.frameworksDevModeHandle,
    };
    const server = superstatic({
        debug: false,
        port: port,
        host: options.host,
        config: config,
        compression: true,
        cwd: (0, detectProjectRoot_1.detectProjectRoot)(options),
        stack: "strict",
        before: {
            files: (req, res, next) => {
                morganMiddleware(req, res, () => {
                });
                firebaseMiddleware(req, res, next);
            },
        },
        after,
        rewriters: {
            function: (0, functionsProxy_1.functionsProxy)(options),
            run: (0, cloudRunProxy_1.default)(options),
        },
    }).listen(() => {
        const siteName = config.target || config.site;
        const label = siteName ? "hosting[" + siteName + "]" : "hosting";
        if (config.public && config.public !== ".") {
            logger.logLabeled("BULLET", label, "Serving hosting files from: " + clc.bold(config.public));
        }
        logger.logLabeled("SUCCESS", label, "Local server: " + clc.underline(clc.bold("http://" + options.host + ":" + port)));
    });
    destroyServer = (0, utils_1.createDestroyer)(server);
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            portInUse();
        }
        else {
            throw new error_1.FirebaseError("An error occurred while starting the hosting development server:\n\n" + err.toString(), { exit: 1 });
        }
    });
}
function stop() {
    return destroyServer ? destroyServer() : Promise.resolve();
}
exports.stop = stop;
async function start(options) {
    const init = await (0, implicitInit_1.implicitInit)(options);
    const configs = (0, normalizedHostingConfigs_1.normalizedHostingConfigs)(options);
    for (let i = 0; i < configs.length; i++) {
        const port = i === 0 ? options.port : options.port + 4 + i;
        startServer(options, configs[i], port, init);
    }
}
exports.start = start;
async function connect() {
    await Promise.resolve();
}
exports.connect = connect;
//# sourceMappingURL=hosting.js.map