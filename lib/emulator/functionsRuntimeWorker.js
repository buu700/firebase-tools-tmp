"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuntimeWorkerPool = exports.RuntimeWorker = exports.RuntimeWorkerState = void 0;
const http = require("http");
const uuid = require("uuid");
const types_1 = require("./types");
const events_1 = require("events");
const emulatorLogger_1 = require("./emulatorLogger");
const error_1 = require("../error");
var RuntimeWorkerState;
(function (RuntimeWorkerState) {
    RuntimeWorkerState["IDLE"] = "IDLE";
    RuntimeWorkerState["BUSY"] = "BUSY";
    RuntimeWorkerState["FINISHING"] = "FINISHING";
    RuntimeWorkerState["FINISHED"] = "FINISHED";
})(RuntimeWorkerState = exports.RuntimeWorkerState || (exports.RuntimeWorkerState = {}));
class RuntimeWorker {
    constructor(key, runtime) {
        this.stateEvents = new events_1.EventEmitter();
        this.logListeners = [];
        this._state = RuntimeWorkerState.IDLE;
        this.id = uuid.v4();
        this.key = key;
        this.runtime = runtime;
        const childProc = this.runtime.process;
        let msgBuffer = "";
        childProc.on("message", (msg) => {
            msgBuffer = this.processStream(msg, msgBuffer);
        });
        let stdBuffer = "";
        if (childProc.stdout) {
            childProc.stdout.on("data", (data) => {
                stdBuffer = this.processStream(data, stdBuffer);
            });
        }
        if (childProc.stderr) {
            childProc.stderr.on("data", (data) => {
                stdBuffer = this.processStream(data, stdBuffer);
            });
        }
        childProc.on("exit", () => {
            this.log("exited");
            this.state = RuntimeWorkerState.FINISHED;
        });
    }
    processStream(s, buf) {
        buf += s.toString();
        const lines = buf.split("\n");
        if (lines.length > 1) {
            lines.slice(0, -1).forEach((line) => {
                const log = types_1.EmulatorLog.fromJSON(line);
                this.runtime.events.emit("log", log);
                if (log.level === "FATAL") {
                    this.runtime.events.emit("log", new types_1.EmulatorLog("SYSTEM", "runtime-status", "killed"));
                    this.runtime.process.kill();
                }
            });
        }
        return lines[lines.length - 1];
    }
    sendDebugMsg(debug) {
        return new Promise((resolve, reject) => {
            this.runtime.process.send(JSON.stringify(debug), (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    request(req, resp, body) {
        this.state = RuntimeWorkerState.BUSY;
        const onFinish = () => {
            if (this.state === RuntimeWorkerState.BUSY) {
                this.state = RuntimeWorkerState.IDLE;
            }
            else if (this.state === RuntimeWorkerState.FINISHING) {
                this.log(`IDLE --> FINISHING`);
                this.runtime.process.kill();
            }
        };
        return new Promise((resolve) => {
            const proxy = http.request({
                method: req.method,
                path: req.path,
                headers: req.headers,
                socketPath: this.runtime.socketPath,
            }, (_resp) => {
                resp.writeHead(_resp.statusCode || 200, _resp.headers);
                const piped = _resp.pipe(resp);
                piped.on("finish", () => {
                    onFinish();
                    resolve();
                });
            });
            proxy.on("error", (err) => {
                resp.writeHead(500);
                resp.write(JSON.stringify(err));
                resp.end();
                this.runtime.process.kill();
                resolve();
            });
            if (body) {
                proxy.write(body);
            }
            proxy.end();
        });
    }
    get state() {
        return this._state;
    }
    set state(state) {
        if (state === RuntimeWorkerState.IDLE) {
            for (const l of this.logListeners) {
                this.runtime.events.removeListener("log", l);
            }
            this.logListeners = [];
        }
        if (state === RuntimeWorkerState.FINISHED) {
            this.runtime.events.removeAllListeners();
        }
        this.log(state);
        this._state = state;
        this.stateEvents.emit(this._state);
    }
    onLogs(listener, forever = false) {
        if (!forever) {
            this.logListeners.push(listener);
        }
        this.runtime.events.on("log", listener);
    }
    isSocketReady() {
        return new Promise((resolve, reject) => {
            const req = http
                .request({
                method: "GET",
                path: "/__/health",
                socketPath: this.runtime.socketPath,
            }, () => resolve())
                .end();
            req.on("error", (error) => {
                reject(error);
            });
        });
    }
    async waitForSocketReady() {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const timeout = new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new error_1.FirebaseError("Failed to load function."));
            }, 30000);
        });
        while (true) {
            try {
                await Promise.race([this.isSocketReady(), timeout]);
                break;
            }
            catch (err) {
                if (["ECONNREFUSED", "ENOENT"].includes(err === null || err === void 0 ? void 0 : err.code)) {
                    await sleep(100);
                    continue;
                }
                throw err;
            }
        }
    }
    log(msg) {
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS).log("DEBUG", `[worker-${this.key}-${this.id}]: ${msg}`);
    }
}
exports.RuntimeWorker = RuntimeWorker;
class RuntimeWorkerPool {
    constructor(mode = types_1.FunctionsExecutionMode.AUTO) {
        this.mode = mode;
        this.workers = new Map();
    }
    getKey(triggerId) {
        if (this.mode === types_1.FunctionsExecutionMode.SEQUENTIAL) {
            return "~shared~";
        }
        else {
            return triggerId || "~diagnostic~";
        }
    }
    refresh() {
        for (const arr of this.workers.values()) {
            arr.forEach((w) => {
                if (w.state === RuntimeWorkerState.IDLE) {
                    this.log(`Shutting down IDLE worker (${w.key})`);
                    w.state = RuntimeWorkerState.FINISHING;
                    w.runtime.process.kill();
                }
                else if (w.state === RuntimeWorkerState.BUSY) {
                    this.log(`Marking BUSY worker to finish (${w.key})`);
                    w.state = RuntimeWorkerState.FINISHING;
                }
            });
        }
    }
    exit() {
        for (const arr of this.workers.values()) {
            arr.forEach((w) => {
                if (w.state === RuntimeWorkerState.IDLE) {
                    w.runtime.process.kill();
                }
                else {
                    w.runtime.process.kill();
                }
            });
        }
    }
    readyForWork(triggerId) {
        const idleWorker = this.getIdleWorker(triggerId);
        return !!idleWorker;
    }
    async submitRequest(triggerId, req, resp, body, debug) {
        this.log(`submitRequest(triggerId=${triggerId})`);
        const worker = this.getIdleWorker(triggerId);
        if (!worker) {
            throw new error_1.FirebaseError("Internal Error: can't call submitRequest without checking for idle workers");
        }
        if (debug) {
            await worker.sendDebugMsg(debug);
        }
        return worker.request(req, resp, body);
    }
    getIdleWorker(triggerId) {
        this.cleanUpWorkers();
        const triggerWorkers = this.getTriggerWorkers(triggerId);
        if (!triggerWorkers.length) {
            this.setTriggerWorkers(triggerId, []);
            return;
        }
        for (const worker of triggerWorkers) {
            if (worker.state === RuntimeWorkerState.IDLE) {
                return worker;
            }
        }
        return;
    }
    addWorker(triggerId, runtime, extensionLogInfo) {
        const worker = new RuntimeWorker(this.getKey(triggerId), runtime);
        this.log(`addWorker(${worker.key})`);
        const keyWorkers = this.getTriggerWorkers(triggerId);
        keyWorkers.push(worker);
        this.setTriggerWorkers(triggerId, keyWorkers);
        const logger = triggerId
            ? emulatorLogger_1.EmulatorLogger.forFunction(triggerId, extensionLogInfo)
            : emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS);
        worker.onLogs((log) => {
            logger.handleRuntimeLog(log);
        }, true);
        this.log(`Adding worker with key ${worker.key}, total=${keyWorkers.length}`);
        return worker;
    }
    getTriggerWorkers(triggerId) {
        return this.workers.get(this.getKey(triggerId)) || [];
    }
    setTriggerWorkers(triggerId, workers) {
        this.workers.set(this.getKey(triggerId), workers);
    }
    cleanUpWorkers() {
        for (const [key, keyWorkers] of this.workers.entries()) {
            const notDoneWorkers = keyWorkers.filter((worker) => {
                return worker.state !== RuntimeWorkerState.FINISHED;
            });
            if (notDoneWorkers.length !== keyWorkers.length) {
                this.log(`Cleaned up workers for ${key}: ${keyWorkers.length} --> ${notDoneWorkers.length}`);
            }
            this.setTriggerWorkers(key, notDoneWorkers);
        }
    }
    log(msg) {
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS).log("DEBUG", `[worker-pool] ${msg}`);
    }
}
exports.RuntimeWorkerPool = RuntimeWorkerPool;
//# sourceMappingURL=functionsRuntimeWorker.js.map