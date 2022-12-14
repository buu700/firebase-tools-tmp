"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionsEmulator = void 0;
const fs = require("fs");
const path = require("path");
const express = require("express");
const clc = require("colorette");
const http = require("http");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const url_1 = require("url");
const events_1 = require("events");
const logger_1 = require("../logger");
const track_1 = require("../track");
const constants_1 = require("./constants");
const types_1 = require("./types");
const chokidar = require("chokidar");
const spawn = require("cross-spawn");
const functionsEmulatorShared_1 = require("./functionsEmulatorShared");
const registry_1 = require("./registry");
const emulatorLogger_1 = require("./emulatorLogger");
const functionsRuntimeWorker_1 = require("./functionsRuntimeWorker");
const error_1 = require("../error");
const workQueue_1 = require("./workQueue");
const utils_1 = require("../utils");
const defaultCredentials_1 = require("../defaultCredentials");
const adminSdkConfig_1 = require("./adminSdkConfig");
const validate_1 = require("../deploy/functions/validate");
const secretManager_1 = require("../gcp/secretManager");
const runtimes = require("../deploy/functions/runtimes");
const backend = require("../deploy/functions/backend");
const functionsEnv = require("../functions/env");
const v1_1 = require("../functions/events/v1");
const apiv2_1 = require("../apiv2");
const build_1 = require("../deploy/functions/build");
const EVENT_INVOKE = "functions:invoke";
const EVENT_INVOKE_GA4 = "functions_invoke";
const DATABASE_PATH_PATTERN = new RegExp("^projects/[^/]+/instances/([^/]+)/refs(/.*)$");
class FunctionsEmulator {
    constructor(args) {
        this.args = args;
        this.triggers = {};
        this.triggerGeneration = 0;
        this.logger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS);
        this.multicastTriggers = {};
        this.blockingFunctionsConfig = {};
        emulatorLogger_1.EmulatorLogger.verbosity = this.args.quiet ? emulatorLogger_1.Verbosity.QUIET : emulatorLogger_1.Verbosity.DEBUG;
        if (this.args.debugPort) {
            this.args.disabledRuntimeFeatures = this.args.disabledRuntimeFeatures || {};
            this.args.disabledRuntimeFeatures.timeout = true;
        }
        this.adminSdkConfig = Object.assign(Object.assign({}, this.args.adminSdkConfig), { projectId: this.args.projectId });
        const mode = this.args.debugPort
            ? types_1.FunctionsExecutionMode.SEQUENTIAL
            : types_1.FunctionsExecutionMode.AUTO;
        this.workerPools = {};
        for (const backend of this.args.emulatableBackends) {
            const pool = new functionsRuntimeWorker_1.RuntimeWorkerPool(mode);
            this.workerPools[backend.codebase] = pool;
        }
        this.workQueue = new workQueue_1.WorkQueue(mode);
    }
    static getHttpFunctionUrl(host, port, projectId, name, region) {
        return `http://${host}:${port}/${projectId}/${region}/${name}`;
    }
    async getCredentialsEnvironment() {
        const credentialEnv = {};
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            this.logger.logLabeled("WARN", "functions", `Your GOOGLE_APPLICATION_CREDENTIALS environment variable points to ${process.env.GOOGLE_APPLICATION_CREDENTIALS}. Non-emulated services will access production using these credentials. Be careful!`);
        }
        else if (this.args.account) {
            const defaultCredPath = await (0, defaultCredentials_1.getCredentialPathAsync)(this.args.account);
            if (defaultCredPath) {
                this.logger.log("DEBUG", `Setting GAC to ${defaultCredPath}`);
                credentialEnv.GOOGLE_APPLICATION_CREDENTIALS = defaultCredPath;
            }
        }
        else {
            this.logger.logLabeled("WARN", "functions", "You are not signed in to the Firebase CLI. If you have authorized this machine using gcloud application-default credentials those may be discovered and used to access production services.");
        }
        return credentialEnv;
    }
    createHubServer() {
        this.workQueue.start();
        const hub = express();
        const dataMiddleware = (req, res, next) => {
            const chunks = [];
            req.on("data", (chunk) => {
                chunks.push(chunk);
            });
            req.on("end", () => {
                req.rawBody = Buffer.concat(chunks);
                next();
            });
        };
        const backgroundFunctionRoute = `/functions/projects/:project_id/triggers/:trigger_name(*)`;
        const httpsFunctionRoute = `/${this.args.projectId}/:region/:trigger_name`;
        const multicastFunctionRoute = `/functions/projects/:project_id/trigger_multicast`;
        const httpsFunctionRoutes = [httpsFunctionRoute, `${httpsFunctionRoute}/*`];
        const listBackendsRoute = `/backends`;
        const httpsHandler = (req, res) => {
            this.workQueue.submit(() => {
                return this.handleHttpsTrigger(req, res);
            });
        };
        const multicastHandler = (req, res) => {
            var _a;
            const projectId = req.params.project_id;
            const rawBody = req.rawBody;
            const event = JSON.parse(rawBody.toString());
            let triggerKey;
            if ((_a = req.headers["content-type"]) === null || _a === void 0 ? void 0 : _a.includes("cloudevent")) {
                triggerKey = `${this.args.projectId}:${event.type}`;
            }
            else {
                triggerKey = `${this.args.projectId}:${event.eventType}`;
            }
            if (event.data.bucket) {
                triggerKey += `:${event.data.bucket}`;
            }
            const triggers = this.multicastTriggers[triggerKey] || [];
            const { host, port } = this.getInfo();
            triggers.forEach((triggerId) => {
                this.workQueue.submit(() => {
                    return new Promise((resolve, reject) => {
                        const trigReq = http.request({
                            host,
                            port,
                            method: req.method,
                            path: `/functions/projects/${projectId}/triggers/${triggerId}`,
                            headers: req.headers,
                        }, resolve);
                        trigReq.on("error", reject);
                        trigReq.write(rawBody);
                        trigReq.end();
                    });
                });
            });
            res.json({ status: "multicast_acknowledged" });
        };
        const listBackendsHandler = (req, res) => {
            res.json({ backends: this.getBackendInfo() });
        };
        hub.get(listBackendsRoute, cors({ origin: true }), listBackendsHandler);
        hub.post(backgroundFunctionRoute, dataMiddleware, httpsHandler);
        hub.post(multicastFunctionRoute, dataMiddleware, multicastHandler);
        hub.all(httpsFunctionRoutes, dataMiddleware, httpsHandler);
        hub.all("*", dataMiddleware, (req, res) => {
            logger_1.logger.debug(`Functions emulator received unknown request at path ${req.path}`);
            res.sendStatus(404);
        });
        return hub;
    }
    async sendRequest(trigger, body) {
        const record = this.getTriggerRecordByKey(this.getTriggerKey(trigger));
        const pool = this.workerPools[record.backend.codebase];
        if (!pool.readyForWork(trigger.id)) {
            await this.startRuntime(record.backend, trigger);
        }
        const worker = pool.getIdleWorker(trigger.id);
        const reqBody = JSON.stringify(body);
        const headers = {
            "Content-Type": "application/json",
            "Content-Length": `${reqBody.length}`,
        };
        return new Promise((resolve, reject) => {
            const req = http.request({
                path: `/`,
                socketPath: worker.runtime.socketPath,
                headers: headers,
            }, resolve);
            req.on("error", reject);
            req.write(reqBody);
            req.end();
        });
    }
    async start() {
        for (const backend of this.args.emulatableBackends) {
            backend.nodeBinary = this.getNodeBinary(backend);
        }
        const credentialEnv = await this.getCredentialsEnvironment();
        for (const e of this.args.emulatableBackends) {
            e.env = Object.assign(Object.assign({}, credentialEnv), e.env);
        }
        if (Object.keys(this.adminSdkConfig || {}).length <= 1) {
            const adminSdkConfig = await (0, adminSdkConfig_1.getProjectAdminSdkConfigOrCached)(this.args.projectId);
            if (adminSdkConfig) {
                this.adminSdkConfig = adminSdkConfig;
            }
            else {
                this.logger.logLabeled("WARN", "functions", "Unable to fetch project Admin SDK configuration, Admin SDK behavior in Cloud Functions emulator may be incorrect.");
                this.adminSdkConfig = (0, adminSdkConfig_1.constructDefaultAdminSdkConfig)(this.args.projectId);
            }
        }
        const { host, port } = this.getInfo();
        this.workQueue.start();
        const server = this.createHubServer().listen(port, host);
        this.destroyServer = (0, utils_1.createDestroyer)(server);
        return Promise.resolve();
    }
    async connect() {
        for (const backend of this.args.emulatableBackends) {
            this.logger.logLabeled("BULLET", "functions", `Watching "${backend.functionsDir}" for Cloud Functions...`);
            const watcher = chokidar.watch(backend.functionsDir, {
                ignored: [
                    /.+?[\\\/]node_modules[\\\/].+?/,
                    /(^|[\/\\])\../,
                    /.+\.log/,
                ],
                persistent: true,
            });
            const debouncedLoadTriggers = (0, utils_1.debounce)(() => this.loadTriggers(backend), 1000);
            watcher.on("change", (filePath) => {
                this.logger.log("DEBUG", `File ${filePath} changed, reloading triggers`);
                return debouncedLoadTriggers();
            });
            await this.loadTriggers(backend, true);
        }
        await this.performPostLoadOperations();
        return;
    }
    async stop() {
        try {
            await this.workQueue.flush();
        }
        catch (e) {
            this.logger.logLabeled("WARN", "functions", "Functions emulator work queue did not empty before stopping");
        }
        this.workQueue.stop();
        for (const pool of Object.values(this.workerPools)) {
            pool.exit();
        }
        if (this.destroyServer) {
            await this.destroyServer();
        }
    }
    async discoverTriggers(emulatableBackend) {
        if (emulatableBackend.predefinedTriggers) {
            return (0, functionsEmulatorShared_1.emulatedFunctionsByRegion)(emulatableBackend.predefinedTriggers, emulatableBackend.secretEnv);
        }
        else {
            const runtimeConfig = this.getRuntimeConfig(emulatableBackend);
            const runtimeDelegateContext = {
                projectId: this.args.projectId,
                projectDir: this.args.projectDir,
                sourceDir: emulatableBackend.functionsDir,
            };
            if (emulatableBackend.nodeMajorVersion) {
                runtimeDelegateContext.runtime = `nodejs${emulatableBackend.nodeMajorVersion}`;
            }
            const runtimeDelegate = await runtimes.getRuntimeDelegate(runtimeDelegateContext);
            logger_1.logger.debug(`Validating ${runtimeDelegate.name} source`);
            await runtimeDelegate.validate();
            logger_1.logger.debug(`Building ${runtimeDelegate.name} source`);
            await runtimeDelegate.build();
            logger_1.logger.debug(`Analyzing ${runtimeDelegate.name} backend spec`);
            const firebaseConfig = this.getFirebaseConfig();
            const environment = Object.assign(Object.assign(Object.assign(Object.assign({}, this.getSystemEnvs()), this.getEmulatorEnvs()), { FIREBASE_CONFIG: firebaseConfig }), emulatableBackend.env);
            const userEnvOpt = {
                functionsSource: emulatableBackend.functionsDir,
                projectId: this.args.projectId,
                projectAlias: this.args.projectAlias,
            };
            const discoveredBuild = await runtimeDelegate.discoverBuild(runtimeConfig, environment);
            const resolution = await (0, build_1.resolveBackend)(discoveredBuild, JSON.parse(firebaseConfig), userEnvOpt, environment);
            const discoveredBackend = resolution.backend;
            const endpoints = backend.allEndpoints(discoveredBackend);
            (0, functionsEmulatorShared_1.prepareEndpoints)(endpoints);
            for (const e of endpoints) {
                e.codebase = emulatableBackend.codebase;
            }
            return (0, functionsEmulatorShared_1.emulatedFunctionsFromEndpoints)(endpoints);
        }
    }
    async loadTriggers(emulatableBackend, force = false) {
        if (!emulatableBackend.nodeBinary) {
            throw new error_1.FirebaseError(`No node binary for ${emulatableBackend.functionsDir}. This should never happen.`);
        }
        let triggerDefinitions = [];
        try {
            triggerDefinitions = await this.discoverTriggers(emulatableBackend);
            this.logger.logLabeled("SUCCESS", "functions", `Loaded functions definitions from source: ${triggerDefinitions
                .map((t) => t.entryPoint)
                .join(", ")}.`);
        }
        catch (e) {
            this.logger.logLabeled("ERROR", "functions", `Failed to load function definition from source: ${e}`);
            return;
        }
        this.workerPools[emulatableBackend.codebase].refresh();
        this.blockingFunctionsConfig = {};
        const toSetup = triggerDefinitions.filter((definition) => {
            if (force) {
                return true;
            }
            const anyEnabledMatch = Object.values(this.triggers).some((record) => {
                const sameEntryPoint = record.def.entryPoint === definition.entryPoint;
                const sameEventTrigger = JSON.stringify(record.def.eventTrigger) === JSON.stringify(definition.eventTrigger);
                if (sameEntryPoint && !sameEventTrigger) {
                    this.logger.log("DEBUG", `Definition for trigger ${definition.entryPoint} changed from ${JSON.stringify(record.def.eventTrigger)} to ${JSON.stringify(definition.eventTrigger)}`);
                }
                return record.enabled && sameEntryPoint && sameEventTrigger;
            });
            return !anyEnabledMatch;
        });
        for (const definition of toSetup) {
            try {
                (0, validate_1.functionIdsAreValid)([Object.assign(Object.assign({}, definition), { id: definition.name })]);
            }
            catch (e) {
                throw new error_1.FirebaseError(`functions[${definition.id}]: Invalid function id: ${e.message}`);
            }
            let added = false;
            let url = undefined;
            const { host, port } = this.getInfo();
            if (definition.httpsTrigger) {
                added = true;
                url = FunctionsEmulator.getHttpFunctionUrl(host, port, this.args.projectId, definition.name, definition.region);
            }
            else if (definition.eventTrigger) {
                const service = (0, functionsEmulatorShared_1.getFunctionService)(definition);
                const key = this.getTriggerKey(definition);
                const signature = (0, functionsEmulatorShared_1.getSignatureType)(definition);
                switch (service) {
                    case constants_1.Constants.SERVICE_FIRESTORE:
                        added = await this.addFirestoreTrigger(this.args.projectId, key, definition.eventTrigger);
                        break;
                    case constants_1.Constants.SERVICE_REALTIME_DATABASE:
                        added = await this.addRealtimeDatabaseTrigger(this.args.projectId, key, definition.eventTrigger);
                        break;
                    case constants_1.Constants.SERVICE_PUBSUB:
                        added = await this.addPubsubTrigger(definition.name, key, definition.eventTrigger, signature, definition.schedule);
                        break;
                    case constants_1.Constants.SERVICE_EVENTARC:
                        added = await this.addEventarcTrigger(this.args.projectId, key, definition.eventTrigger);
                        break;
                    case constants_1.Constants.SERVICE_AUTH:
                        added = this.addAuthTrigger(this.args.projectId, key, definition.eventTrigger);
                        break;
                    case constants_1.Constants.SERVICE_STORAGE:
                        added = this.addStorageTrigger(this.args.projectId, key, definition.eventTrigger);
                        break;
                    default:
                        this.logger.log("DEBUG", `Unsupported trigger: ${JSON.stringify(definition)}`);
                        break;
                }
            }
            else if (definition.blockingTrigger) {
                const { host, port } = this.getInfo();
                url = FunctionsEmulator.getHttpFunctionUrl(host, port, this.args.projectId, definition.name, definition.region);
                added = this.addBlockingTrigger(url, definition.blockingTrigger);
            }
            else {
                this.logger.log("WARN", `Unsupported function type on ${definition.name}. Expected either an httpsTrigger, eventTrigger, or blockingTrigger.`);
            }
            const ignored = !added;
            this.addTriggerRecord(definition, { backend: emulatableBackend, ignored, url });
            const type = definition.httpsTrigger
                ? "http"
                : constants_1.Constants.getServiceName((0, functionsEmulatorShared_1.getFunctionService)(definition));
            if (ignored) {
                const msg = `function ignored because the ${type} emulator does not exist or is not running.`;
                this.logger.logLabeled("BULLET", `functions[${definition.id}]`, msg);
            }
            else {
                const msg = url
                    ? `${clc.bold(type)} function initialized (${url}).`
                    : `${clc.bold(type)} function initialized.`;
                this.logger.logLabeled("SUCCESS", `functions[${definition.id}]`, msg);
            }
        }
        if (this.args.debugPort) {
            await this.startRuntime(emulatableBackend);
        }
    }
    addEventarcTrigger(projectId, key, eventTrigger) {
        const eventarcEmu = registry_1.EmulatorRegistry.get(types_1.Emulators.EVENTARC);
        if (!eventarcEmu) {
            return Promise.resolve(false);
        }
        const bundle = {
            eventTrigger: Object.assign(Object.assign({}, eventTrigger), { service: "eventarc.googleapis.com" }),
        };
        logger_1.logger.debug(`addEventarcTrigger`, JSON.stringify(bundle));
        const client = new apiv2_1.Client({
            urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(eventarcEmu.getInfo())}`,
            auth: false,
        });
        return client
            .post(`/emulator/v1/projects/${projectId}/triggers/${key}`, bundle)
            .then(() => true)
            .catch((err) => {
            this.logger.log("WARN", "Error adding Eventarc function: " + err);
            return false;
        });
    }
    async performPostLoadOperations() {
        if (!this.blockingFunctionsConfig.triggers &&
            !this.blockingFunctionsConfig.forwardInboundCredentials) {
            return;
        }
        const authEmu = registry_1.EmulatorRegistry.get(types_1.Emulators.AUTH);
        if (!authEmu) {
            return;
        }
        const path = `/identitytoolkit.googleapis.com/v2/projects/${this.getProjectId()}/config?updateMask=blockingFunctions`;
        try {
            const client = new apiv2_1.Client({
                urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(authEmu.getInfo())}`,
                auth: false,
            });
            await client.patch(path, { blockingFunctions: this.blockingFunctionsConfig }, {
                headers: { Authorization: "Bearer owner" },
            });
        }
        catch (err) {
            this.logger.log("WARN", "Error updating blocking functions config to the auth emulator: " + err);
            throw err;
        }
    }
    async addRealtimeDatabaseTrigger(projectId, key, eventTrigger) {
        const databaseEmu = registry_1.EmulatorRegistry.get(types_1.Emulators.DATABASE);
        if (!databaseEmu) {
            return false;
        }
        const result = DATABASE_PATH_PATTERN.exec(eventTrigger.resource);
        if (result === null || result.length !== 3) {
            this.logger.log("WARN", `Event function "${key}" has malformed "resource" member. ` + `${eventTrigger.resource}`);
            throw new error_1.FirebaseError(`Event function ${key} has malformed resource member`);
        }
        const instance = result[1];
        const bundle = JSON.stringify({
            name: `projects/${projectId}/locations/_/functions/${key}`,
            path: result[2],
            event: eventTrigger.eventType,
            topic: `projects/${projectId}/topics/${key}`,
        });
        logger_1.logger.debug(`addRealtimeDatabaseTrigger[${instance}]`, JSON.stringify(bundle));
        let setTriggersPath = "/.settings/functionTriggers.json";
        if (instance !== "") {
            setTriggersPath += `?ns=${instance}`;
        }
        else {
            this.logger.log("WARN", `No project in use. Registering function for sentinel namespace '${constants_1.Constants.DEFAULT_DATABASE_EMULATOR_NAMESPACE}'`);
        }
        const client = new apiv2_1.Client({
            urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(databaseEmu.getInfo())}`,
            auth: false,
        });
        try {
            await client.post(setTriggersPath, bundle, { headers: { Authorization: "Bearer owner" } });
        }
        catch (err) {
            this.logger.log("WARN", "Error adding Realtime Database function: " + err);
            throw err;
        }
        return true;
    }
    async addFirestoreTrigger(projectId, key, eventTrigger) {
        const firestoreEmu = registry_1.EmulatorRegistry.get(types_1.Emulators.FIRESTORE);
        if (!firestoreEmu) {
            return Promise.resolve(false);
        }
        const bundle = JSON.stringify({
            eventTrigger: Object.assign(Object.assign({}, eventTrigger), { service: "firestore.googleapis.com" }),
        });
        logger_1.logger.debug(`addFirestoreTrigger`, JSON.stringify(bundle));
        const client = new apiv2_1.Client({
            urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(firestoreEmu.getInfo())}`,
            auth: false,
        });
        try {
            await client.put(`/emulator/v1/projects/${projectId}/triggers/${key}`, bundle);
        }
        catch (err) {
            this.logger.log("WARN", "Error adding firestore function: " + err);
            throw err;
        }
        return true;
    }
    async addPubsubTrigger(triggerName, key, eventTrigger, signatureType, schedule) {
        const pubsubEmulator = registry_1.EmulatorRegistry.get(types_1.Emulators.PUBSUB);
        if (!pubsubEmulator) {
            return false;
        }
        logger_1.logger.debug(`addPubsubTrigger`, JSON.stringify({ eventTrigger }));
        const resource = eventTrigger.resource;
        let topic;
        if (schedule) {
            topic = "firebase-schedule-" + triggerName;
        }
        else {
            const resourceParts = resource.split("/");
            topic = resourceParts[resourceParts.length - 1];
        }
        try {
            await pubsubEmulator.addTrigger(topic, key, signatureType);
            return true;
        }
        catch (e) {
            return false;
        }
    }
    addAuthTrigger(projectId, key, eventTrigger) {
        logger_1.logger.debug(`addAuthTrigger`, JSON.stringify({ eventTrigger }));
        const eventTriggerId = `${projectId}:${eventTrigger.eventType}`;
        const triggers = this.multicastTriggers[eventTriggerId] || [];
        triggers.push(key);
        this.multicastTriggers[eventTriggerId] = triggers;
        return true;
    }
    addStorageTrigger(projectId, key, eventTrigger) {
        logger_1.logger.debug(`addStorageTrigger`, JSON.stringify({ eventTrigger }));
        const bucket = eventTrigger.resource.startsWith("projects/_/buckets/")
            ? eventTrigger.resource.split("/")[3]
            : eventTrigger.resource;
        const eventTriggerId = `${projectId}:${eventTrigger.eventType}:${bucket}`;
        const triggers = this.multicastTriggers[eventTriggerId] || [];
        triggers.push(key);
        this.multicastTriggers[eventTriggerId] = triggers;
        return true;
    }
    addBlockingTrigger(url, blockingTrigger) {
        logger_1.logger.debug(`addBlockingTrigger`, JSON.stringify({ blockingTrigger }));
        const eventType = blockingTrigger.eventType;
        if (!v1_1.AUTH_BLOCKING_EVENTS.includes(eventType)) {
            return false;
        }
        if (blockingTrigger.eventType === v1_1.BEFORE_CREATE_EVENT) {
            this.blockingFunctionsConfig.triggers = Object.assign(Object.assign({}, this.blockingFunctionsConfig.triggers), { beforeCreate: {
                    functionUri: url,
                } });
        }
        else {
            this.blockingFunctionsConfig.triggers = Object.assign(Object.assign({}, this.blockingFunctionsConfig.triggers), { beforeSignIn: {
                    functionUri: url,
                } });
        }
        this.blockingFunctionsConfig.forwardInboundCredentials = {
            accessToken: !!blockingTrigger.options.accessToken,
            idToken: !!blockingTrigger.options.idToken,
            refreshToken: !!blockingTrigger.options.refreshToken,
        };
        return true;
    }
    getProjectId() {
        return this.args.projectId;
    }
    getInfo() {
        const host = this.args.host || constants_1.Constants.getDefaultHost();
        const port = this.args.port || constants_1.Constants.getDefaultPort(types_1.Emulators.FUNCTIONS);
        return {
            name: this.getName(),
            host,
            port,
        };
    }
    getName() {
        return types_1.Emulators.FUNCTIONS;
    }
    getTriggerDefinitions() {
        return Object.values(this.triggers).map((record) => record.def);
    }
    getTriggerRecordByKey(triggerKey) {
        const record = this.triggers[triggerKey];
        if (!record) {
            logger_1.logger.debug(`Could not find key=${triggerKey} in ${JSON.stringify(this.triggers)}`);
            throw new error_1.FirebaseError(`No function with key ${triggerKey}`);
        }
        return record;
    }
    getTriggerKey(def) {
        if (def.eventTrigger) {
            const triggerKey = `${def.id}-${this.triggerGeneration}`;
            return def.eventTrigger.channel ? `${triggerKey}-${def.eventTrigger.channel}` : triggerKey;
        }
        else {
            return def.id;
        }
    }
    getBackendInfo() {
        const cf3Triggers = this.getCF3Triggers();
        return this.args.emulatableBackends.map((e) => {
            return (0, functionsEmulatorShared_1.toBackendInfo)(e, cf3Triggers);
        });
    }
    getCF3Triggers() {
        return Object.values(this.triggers)
            .filter((t) => !t.backend.extensionInstanceId)
            .map((t) => t.def);
    }
    addTriggerRecord(def, opts) {
        const key = this.getTriggerKey(def);
        this.triggers[key] = {
            def,
            enabled: true,
            backend: opts.backend,
            ignored: opts.ignored,
            url: opts.url,
        };
    }
    setTriggersForTesting(triggers, backend) {
        this.triggers = {};
        triggers.forEach((def) => this.addTriggerRecord(def, { backend, ignored: false }));
    }
    getNodeBinary(backend) {
        const pkg = require(path.join(backend.functionsDir, "package.json"));
        if ((!pkg.engines || !pkg.engines.node) && !backend.nodeMajorVersion) {
            this.logger.log("WARN", `Your functions directory ${backend.functionsDir} does not specify a Node version.\n   ` +
                "- Learn more at https://firebase.google.com/docs/functions/manage-functions#set_runtime_options");
            return process.execPath;
        }
        const hostMajorVersion = process.versions.node.split(".")[0];
        const requestedMajorVersion = backend.nodeMajorVersion
            ? `${backend.nodeMajorVersion}`
            : pkg.engines.node;
        let localMajorVersion = "0";
        const localNodePath = path.join(backend.functionsDir, "node_modules/.bin/node");
        try {
            const localNodeOutput = spawn.sync(localNodePath, ["--version"]).stdout.toString();
            localMajorVersion = localNodeOutput.slice(1).split(".")[0];
        }
        catch (err) {
        }
        if (requestedMajorVersion === localMajorVersion) {
            this.logger.logLabeled("SUCCESS", "functions", `Using node@${requestedMajorVersion} from local cache.`);
            return localNodePath;
        }
        if (requestedMajorVersion === hostMajorVersion) {
            this.logger.logLabeled("SUCCESS", "functions", `Using node@${requestedMajorVersion} from host.`);
        }
        else {
            if (process.env.FIREPIT_VERSION) {
                this.logger.log("WARN", `You've requested "node" version "${requestedMajorVersion}", but the standalone Firebase CLI comes with bundled Node "${hostMajorVersion}".`);
                this.logger.log("INFO", `To use a different Node.js version, consider removing the standalone Firebase CLI and switching to "firebase-tools" on npm.`);
            }
            else {
                this.logger.log("WARN", `Your requested "node" version "${requestedMajorVersion}" doesn't match your global version "${hostMajorVersion}". Using node@${hostMajorVersion} from host.`);
            }
        }
        return process.execPath;
    }
    getRuntimeConfig(backend) {
        const configPath = `${backend.functionsDir}/.runtimeconfig.json`;
        try {
            const configContent = fs.readFileSync(configPath, "utf8");
            return JSON.parse(configContent.toString());
        }
        catch (e) {
        }
        return {};
    }
    getUserEnvs(backend) {
        const projectInfo = {
            functionsSource: backend.functionsDir,
            projectId: this.args.projectId,
            projectAlias: this.args.projectAlias,
            isEmulator: true,
        };
        if (functionsEnv.hasUserEnvs(projectInfo)) {
            try {
                return functionsEnv.loadUserEnvs(projectInfo);
            }
            catch (e) {
                logger_1.logger.debug("Failed to load local environment variables", e);
            }
        }
        return {};
    }
    getSystemEnvs(trigger) {
        const envs = {};
        envs.GCLOUD_PROJECT = this.args.projectId;
        envs.K_REVISION = "1";
        envs.PORT = "80";
        if (trigger === null || trigger === void 0 ? void 0 : trigger.timeoutSeconds) {
            envs.FUNCTIONS_EMULATOR_TIMEOUT_SECONDS = trigger.timeoutSeconds.toString();
        }
        if (trigger) {
            const target = trigger.entryPoint;
            envs.FUNCTION_TARGET = target;
            envs.FUNCTION_SIGNATURE_TYPE = (0, functionsEmulatorShared_1.getSignatureType)(trigger);
            envs.K_SERVICE = trigger.name;
        }
        return envs;
    }
    getEmulatorEnvs() {
        const envs = {};
        envs.FUNCTIONS_EMULATOR = "true";
        envs.TZ = "UTC";
        envs.FIREBASE_DEBUG_MODE = "true";
        envs.FIREBASE_DEBUG_FEATURES = JSON.stringify({
            skipTokenVerification: true,
            enableCors: true,
        });
        const firestoreEmulator = this.getEmulatorInfo(types_1.Emulators.FIRESTORE);
        if (firestoreEmulator != null) {
            envs[constants_1.Constants.FIRESTORE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(firestoreEmulator);
        }
        const databaseEmulator = this.getEmulatorInfo(types_1.Emulators.DATABASE);
        if (databaseEmulator) {
            envs[constants_1.Constants.FIREBASE_DATABASE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(databaseEmulator);
        }
        const authEmulator = this.getEmulatorInfo(types_1.Emulators.AUTH);
        if (authEmulator) {
            envs[constants_1.Constants.FIREBASE_AUTH_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(authEmulator);
        }
        const storageEmulator = this.getEmulatorInfo(types_1.Emulators.STORAGE);
        if (storageEmulator) {
            envs[constants_1.Constants.FIREBASE_STORAGE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(storageEmulator);
            envs[constants_1.Constants.CLOUD_STORAGE_EMULATOR_HOST] = `http://${(0, functionsEmulatorShared_1.formatHost)(storageEmulator)}`;
        }
        const pubsubEmulator = this.getEmulatorInfo(types_1.Emulators.PUBSUB);
        if (pubsubEmulator) {
            const pubsubHost = (0, functionsEmulatorShared_1.formatHost)(pubsubEmulator);
            process.env.PUBSUB_EMULATOR_HOST = pubsubHost;
        }
        const eventarcEmulator = this.getEmulatorInfo(types_1.Emulators.EVENTARC);
        if (eventarcEmulator) {
            envs[constants_1.Constants.CLOUD_EVENTARC_EMULATOR_HOST] = `http://${(0, functionsEmulatorShared_1.formatHost)(eventarcEmulator)}`;
        }
        if (this.args.debugPort) {
            envs["FUNCTION_DEBUG_MODE"] = "true";
        }
        return envs;
    }
    getFirebaseConfig() {
        const databaseEmulator = this.getEmulatorInfo(types_1.Emulators.DATABASE);
        let emulatedDatabaseURL = undefined;
        if (databaseEmulator) {
            let ns = this.args.projectId;
            if (this.adminSdkConfig.databaseURL) {
                const asUrl = new url_1.URL(this.adminSdkConfig.databaseURL);
                ns = asUrl.hostname.split(".")[0];
            }
            emulatedDatabaseURL = `http://${(0, functionsEmulatorShared_1.formatHost)(databaseEmulator)}/?ns=${ns}`;
        }
        return JSON.stringify({
            storageBucket: this.adminSdkConfig.storageBucket,
            databaseURL: emulatedDatabaseURL || this.adminSdkConfig.databaseURL,
            projectId: this.args.projectId,
        });
    }
    getRuntimeEnvs(backend, trigger) {
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, this.getUserEnvs(backend)), this.getSystemEnvs(trigger)), this.getEmulatorEnvs()), { FIREBASE_CONFIG: this.getFirebaseConfig() }), backend.env);
    }
    async resolveSecretEnvs(backend, trigger) {
        let secretEnvs = {};
        const secretPath = (0, functionsEmulatorShared_1.getSecretLocalPath)(backend, this.args.projectDir);
        try {
            const data = fs.readFileSync(secretPath, "utf8");
            secretEnvs = functionsEnv.parseStrict(data);
        }
        catch (e) {
            if (e.code !== "ENOENT") {
                this.logger.logLabeled("ERROR", "functions", `Failed to read local secrets file ${secretPath}: ${e.message}`);
            }
        }
        if (trigger) {
            const secrets = trigger.secretEnvironmentVariables || [];
            const accesses = secrets
                .filter((s) => !secretEnvs[s.key])
                .map(async (s) => {
                var _a;
                this.logger.logLabeled("INFO", "functions", `Trying to access secret ${s.secret}@latest`);
                const value = await (0, secretManager_1.accessSecretVersion)(this.getProjectId(), s.secret, (_a = s.version) !== null && _a !== void 0 ? _a : "latest");
                return [s.key, value];
            });
            const accessResults = await (0, utils_1.allSettled)(accesses);
            const errs = [];
            for (const result of accessResults) {
                if (result.status === "rejected") {
                    errs.push(result.reason);
                }
                else {
                    const [k, v] = result.value;
                    secretEnvs[k] = v;
                }
            }
            if (errs.length > 0) {
                this.logger.logLabeled("ERROR", "functions", "Unable to access secret environment variables from Google Cloud Secret Manager. " +
                    "Make sure the credential used for the Functions Emulator have access " +
                    `or provide override values in ${secretPath}:\n\t` +
                    errs.join("\n\t"));
            }
        }
        return secretEnvs;
    }
    async startRuntime(backend, trigger) {
        var _a;
        const emitter = new events_1.EventEmitter();
        const args = [path.join(__dirname, "functionsEmulatorRuntime")];
        if (this.args.debugPort) {
            if (process.env.FIREPIT_VERSION && process.execPath === backend.nodeBinary) {
                this.logger.log("WARN", `To enable function inspection, please run "${process.execPath} is:npm i node@${backend.nodeMajorVersion} --save-dev" in your functions directory`);
            }
            else {
                const { host } = this.getInfo();
                args.unshift(`--inspect=${host}:${this.args.debugPort}`);
            }
        }
        const pnpPath = path.join(backend.functionsDir, ".pnp.js");
        if (fs.existsSync(pnpPath)) {
            emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS).logLabeled("WARN_ONCE", "functions", "Detected yarn@2 with PnP. " +
                "Cloud Functions for Firebase requires a node_modules folder to work correctly and is therefore incompatible with PnP. " +
                "See https://yarnpkg.com/getting-started/migration#step-by-step for more information.");
        }
        const runtimeEnv = this.getRuntimeEnvs(backend, trigger);
        const secretEnvs = await this.resolveSecretEnvs(backend, trigger);
        const socketPath = (0, functionsEmulatorShared_1.getTemporarySocketPath)();
        const childProcess = spawn(backend.nodeBinary, args, {
            cwd: backend.functionsDir,
            env: Object.assign(Object.assign(Object.assign(Object.assign({ node: backend.nodeBinary }, process.env), runtimeEnv), secretEnvs), { PORT: socketPath }),
            stdio: ["pipe", "pipe", "pipe", "ipc"],
        });
        const runtime = {
            process: childProcess,
            events: emitter,
            cwd: backend.functionsDir,
            socketPath,
        };
        const extensionLogInfo = {
            instanceId: backend.extensionInstanceId,
            ref: (_a = backend.extensionVersion) === null || _a === void 0 ? void 0 : _a.ref,
        };
        const pool = this.workerPools[backend.codebase];
        const worker = pool.addWorker(trigger === null || trigger === void 0 ? void 0 : trigger.id, runtime, extensionLogInfo);
        await worker.waitForSocketReady();
        return worker;
    }
    async disableBackgroundTriggers() {
        Object.values(this.triggers).forEach((record) => {
            if (record.def.eventTrigger && record.enabled) {
                this.logger.logLabeled("BULLET", `functions[${record.def.entryPoint}]`, "function temporarily disabled.");
                record.enabled = false;
            }
        });
        await this.workQueue.flush();
    }
    async reloadTriggers() {
        this.triggerGeneration++;
        for (const backend of this.args.emulatableBackends) {
            await this.loadTriggers(backend);
        }
        await this.performPostLoadOperations();
        return;
    }
    getEmulatorInfo(emulator) {
        if (this.args.remoteEmulators) {
            if (this.args.remoteEmulators[emulator]) {
                return this.args.remoteEmulators[emulator];
            }
        }
        return registry_1.EmulatorRegistry.getInfo(emulator);
    }
    tokenFromAuthHeader(authHeader) {
        const match = /^Bearer (.*)$/.exec(authHeader);
        if (!match) {
            return;
        }
        let idToken = match[1];
        logger_1.logger.debug(`ID Token: ${idToken}`);
        if (idToken && idToken.includes("=")) {
            idToken = idToken.replace(/[=]+?\./g, ".");
            logger_1.logger.debug(`ID Token contained invalid padding, new value: ${idToken}`);
        }
        try {
            const decoded = jwt.decode(idToken, { complete: true });
            if (!decoded || typeof decoded !== "object") {
                logger_1.logger.debug(`Failed to decode ID Token: ${decoded}`);
                return;
            }
            const claims = decoded.payload;
            claims.uid = claims.sub;
            return claims;
        }
        catch (e) {
            return;
        }
    }
    async handleHttpsTrigger(req, res) {
        const method = req.method;
        let triggerId = req.params.trigger_name;
        if (req.params.region) {
            triggerId = `${req.params.region}-${triggerId}`;
        }
        if (!this.triggers[triggerId]) {
            res
                .status(404)
                .send(`Function ${triggerId} does not exist, valid functions are: ${Object.keys(this.triggers).join(", ")}`);
            return;
        }
        const record = this.getTriggerRecordByKey(triggerId);
        const trigger = record.def;
        logger_1.logger.debug(`Accepted request ${method} ${req.url} --> ${triggerId}`);
        const reqBody = req.rawBody;
        const isCallable = trigger.labels && trigger.labels["deployment-callable"] === "true";
        const authHeader = req.header("Authorization");
        if (authHeader && isCallable && trigger.platform !== "gcfv2") {
            const token = this.tokenFromAuthHeader(authHeader);
            if (token) {
                const contextAuth = {
                    uid: token.uid,
                    token: token,
                };
                req.headers[functionsEmulatorShared_1.HttpConstants.ORIGINAL_AUTH_HEADER] = req.headers["authorization"];
                delete req.headers["authorization"];
                req.headers[functionsEmulatorShared_1.HttpConstants.CALLABLE_AUTH_HEADER] = encodeURIComponent(JSON.stringify(contextAuth));
            }
        }
        void (0, track_1.track)(EVENT_INVOKE, (0, functionsEmulatorShared_1.getFunctionService)(trigger));
        void (0, track_1.trackEmulator)(EVENT_INVOKE_GA4, {
            function_service: (0, functionsEmulatorShared_1.getFunctionService)(trigger),
        });
        this.logger.log("DEBUG", `[functions] Runtime ready! Sending request!`);
        const url = new url_1.URL(`${req.protocol}://${req.hostname}${req.url}`);
        const path = `${url.pathname}${url.search}`.replace(new RegExp(`\/${this.args.projectId}\/[^\/]*\/${req.params.trigger_name}\/?`), "/");
        this.logger.log("DEBUG", `[functions] Got req.url=${req.url}, mapping to path=${path}`);
        const pool = this.workerPools[record.backend.codebase];
        if (!pool.readyForWork(trigger.id)) {
            await this.startRuntime(record.backend, trigger);
        }
        const debugBundle = this.args.debugPort
            ? {
                functionTarget: trigger.entryPoint,
                functionSignature: (0, functionsEmulatorShared_1.getSignatureType)(trigger),
            }
            : undefined;
        await pool.submitRequest(trigger.id, {
            method,
            path,
            headers: req.headers,
        }, res, reqBody, debugBundle);
    }
}
exports.FunctionsEmulator = FunctionsEmulator;
//# sourceMappingURL=functionsEmulator.js.map