"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportEmulatorData = exports.startAll = exports.shouldStart = exports.filterEmulatorTargets = exports.cleanShutdown = exports.onExit = exports.exportOnExit = void 0;
const clc = require("colorette");
const fs = require("fs");
const path = require("path");
const logger_1 = require("../logger");
const track_1 = require("../track");
const utils = require("../utils");
const registry_1 = require("./registry");
const types_1 = require("./types");
const constants_1 = require("./constants");
const functionsEmulator_1 = require("./functionsEmulator");
const functionsEmulatorUtils_1 = require("./functionsEmulatorUtils");
const auth_1 = require("./auth");
const databaseEmulator_1 = require("./databaseEmulator");
const firestoreEmulator_1 = require("./firestoreEmulator");
const hostingEmulator_1 = require("./hostingEmulator");
const eventarcEmulator_1 = require("./eventarcEmulator");
const error_1 = require("../error");
const projectUtils_1 = require("../projectUtils");
const pubsubEmulator_1 = require("./pubsubEmulator");
const commandUtils = require("./commandUtils");
const hub_1 = require("./hub");
const hubExport_1 = require("./hubExport");
const ui_1 = require("./ui");
const loggingEmulator_1 = require("./loggingEmulator");
const dbRulesConfig = require("../database/rulesConfig");
const emulatorLogger_1 = require("./emulatorLogger");
const portUtils = require("./portUtils");
const hubClient_1 = require("./hubClient");
const prompt_1 = require("../prompt");
const commandUtils_1 = require("./commandUtils");
const fsutils_1 = require("../fsutils");
const storage_1 = require("./storage");
const config_1 = require("./storage/rules/config");
const getDefaultDatabaseInstance_1 = require("../getDefaultDatabaseInstance");
const auth_2 = require("../auth");
const extensionsEmulator_1 = require("./extensionsEmulator");
const projectConfig_1 = require("../functions/projectConfig");
const downloadableEmulators_1 = require("./downloadableEmulators");
const frameworks_1 = require("../frameworks");
const experiments = require("../experiments");
const START_LOGGING_EMULATOR = utils.envOverride("START_LOGGING_EMULATOR", "false", (val) => val === "true");
async function getAndCheckAddress(emulator, options) {
    var _a, _b, _c, _d;
    if (emulator === types_1.Emulators.EXTENSIONS) {
        emulator = types_1.Emulators.FUNCTIONS;
    }
    let host = ((_b = (_a = options.config.src.emulators) === null || _a === void 0 ? void 0 : _a[emulator]) === null || _b === void 0 ? void 0 : _b.host) || constants_1.Constants.getDefaultHost();
    if (host === "localhost" && utils.isRunningInWSL()) {
        host = "127.0.0.1";
    }
    const portVal = (_d = (_c = options.config.src.emulators) === null || _c === void 0 ? void 0 : _c[emulator]) === null || _d === void 0 ? void 0 : _d.port;
    let port;
    let findAvailablePort = false;
    if (portVal) {
        port = parseInt(`${portVal}`, 10);
    }
    else {
        port = constants_1.Constants.getDefaultPort(emulator);
        findAvailablePort = constants_1.FIND_AVAILBLE_PORT_BY_DEFAULT[emulator];
    }
    const loggerForEmulator = emulatorLogger_1.EmulatorLogger.forEmulator(emulator);
    const portOpen = await portUtils.checkPortOpen(port, host);
    if (!portOpen) {
        if (findAvailablePort) {
            const newPort = await portUtils.findAvailablePort(host, port);
            if (newPort !== port) {
                loggerForEmulator.logLabeled("WARN", emulator, `${constants_1.Constants.description(emulator)} unable to start on port ${port}, starting on ${newPort} instead.`);
                port = newPort;
            }
        }
        else {
            await cleanShutdown();
            const description = constants_1.Constants.description(emulator);
            loggerForEmulator.logLabeled("WARN", emulator, `Port ${port} is not open on ${host}, could not start ${description}.`);
            loggerForEmulator.logLabeled("WARN", emulator, `To select a different host/port, specify that host/port in a firebase.json config file:
      {
        // ...
        "emulators": {
          "${emulator}": {
            "host": "${clc.yellow("HOST")}",
            "port": "${clc.yellow("PORT")}"
          }
        }
      }`);
            return utils.reject(`Could not start ${description}, port taken.`, {});
        }
    }
    if (portUtils.isRestricted(port)) {
        const suggested = portUtils.suggestUnrestricted(port);
        loggerForEmulator.logLabeled("WARN", emulator, `Port ${port} is restricted by some web browsers, including Chrome. You may want to choose a different port such as ${suggested}.`);
    }
    return { host, port };
}
async function getFirestoreWebSocketPort(host, port, emulator) {
    let websocketPort;
    if (port) {
        const portOpen = await portUtils.checkPortOpen(port, host);
        if (!portOpen) {
            await cleanShutdown();
            const logger = emulatorLogger_1.EmulatorLogger.forEmulator(emulator);
            logger.logLabeled("WARN", emulator, `Port ${port} is not open on ${host}, could not start websocket server for Firestore emulator.`);
            logger.logLabeled("WARN", emulator, `To select a different port, specify that port in a firebase.json config file:
      {
        // ...
        "emulators": {
          "${emulator}": {
            "host": "${clc.yellow("HOST")}",
            ...
            "websocketPort": "${clc.yellow("WEBSOCKET_PORT")}"
          }
        }
      }`);
            return utils.reject(`Could not start websocket, port taken.`, {});
        }
        websocketPort = port;
    }
    else {
        websocketPort = await portUtils.findAvailablePort(host, 9150);
    }
    return websocketPort;
}
async function exportOnExit(options) {
    const exportOnExitDir = options.exportOnExit;
    if (exportOnExitDir) {
        try {
            utils.logBullet(`Automatically exporting data using ${commandUtils_1.FLAG_EXPORT_ON_EXIT_NAME} "${exportOnExitDir}" ` +
                "please wait for the export to finish...");
            await exportEmulatorData(exportOnExitDir, options, "exit");
        }
        catch (e) {
            utils.logWarning(e);
            utils.logWarning(`Automatic export to "${exportOnExitDir}" failed, going to exit now...`);
        }
    }
}
exports.exportOnExit = exportOnExit;
async function onExit(options) {
    await exportOnExit(options);
}
exports.onExit = onExit;
async function cleanShutdown() {
    emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.HUB).logLabeled("BULLET", "emulators", "Shutting down emulators.");
    await registry_1.EmulatorRegistry.stopAll();
}
exports.cleanShutdown = cleanShutdown;
function filterEmulatorTargets(options) {
    let targets = [...types_1.ALL_SERVICE_EMULATORS];
    targets.push(types_1.Emulators.EXTENSIONS);
    targets = targets.filter((e) => {
        return options.config.has(e) || options.config.has(`emulators.${e}`);
    });
    const onlyOptions = options.only;
    if (onlyOptions) {
        const only = onlyOptions.split(",").map((o) => {
            return o.split(":")[0];
        });
        targets = targets.filter((t) => only.includes(t));
    }
    return targets;
}
exports.filterEmulatorTargets = filterEmulatorTargets;
function shouldStart(options, name) {
    var _a, _b;
    if (name === types_1.Emulators.HUB) {
        return !!options.project;
    }
    const targets = filterEmulatorTargets(options);
    const emulatorInTargets = targets.includes(name);
    if (name === types_1.Emulators.UI) {
        if (options.ui) {
            return true;
        }
        if (((_b = (_a = options.config.src.emulators) === null || _a === void 0 ? void 0 : _a.ui) === null || _b === void 0 ? void 0 : _b.enabled) === false) {
            return false;
        }
        return (!!options.project && targets.some((target) => types_1.EMULATORS_SUPPORTED_BY_UI.includes(target)));
    }
    if (name === types_1.Emulators.FUNCTIONS && emulatorInTargets) {
        try {
            (0, projectConfig_1.normalizeAndValidate)(options.config.src.functions);
            return true;
        }
        catch (err) {
            emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS).logLabeled("WARN", "functions", `The functions emulator is configured but there is no functions source directory. Have you run ${clc.bold("firebase init functions")}?`);
            return false;
        }
    }
    if (name === types_1.Emulators.HOSTING && emulatorInTargets && !options.config.get("hosting")) {
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.HOSTING).logLabeled("WARN", "hosting", `The hosting emulator is configured but there is no hosting configuration. Have you run ${clc.bold("firebase init hosting")}?`);
        return false;
    }
    return emulatorInTargets;
}
exports.shouldStart = shouldStart;
function findExportMetadata(importPath) {
    const pathIsDirectory = fs.lstatSync(importPath).isDirectory();
    if (!pathIsDirectory) {
        return;
    }
    const importFilePath = path.join(importPath, hubExport_1.HubExport.METADATA_FILE_NAME);
    if ((0, fsutils_1.fileExistsSync)(importFilePath)) {
        return JSON.parse(fs.readFileSync(importFilePath, "utf8").toString());
    }
    const fileList = fs.readdirSync(importPath);
    const firestoreMetadataFile = fileList.find((f) => f.endsWith(".overall_export_metadata"));
    if (firestoreMetadataFile) {
        const metadata = {
            version: hub_1.EmulatorHub.CLI_VERSION,
            firestore: {
                version: "prod",
                path: importPath,
                metadata_file: `${importPath}/${firestoreMetadataFile}`,
            },
        };
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FIRESTORE).logLabeled("BULLET", "firestore", `Detected non-emulator Firestore export at ${importPath}`);
        return metadata;
    }
    const rtdbDataFile = fileList.find((f) => f.endsWith(".json"));
    if (rtdbDataFile) {
        const metadata = {
            version: hub_1.EmulatorHub.CLI_VERSION,
            database: {
                version: "prod",
                path: importPath,
            },
        };
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.DATABASE).logLabeled("BULLET", "firestore", `Detected non-emulator Database export at ${importPath}`);
        return metadata;
    }
}
async function startAll(options, showUI = true) {
    var _a, _b, _c;
    const targets = filterEmulatorTargets(options);
    options.targets = targets;
    if (targets.length === 0) {
        throw new error_1.FirebaseError(`No emulators to start, run ${clc.bold("firebase init emulators")} to get started.`);
    }
    if (targets.some(downloadableEmulators_1.requiresJava)) {
        if ((await commandUtils.checkJavaMajorVersion()) < commandUtils_1.MIN_SUPPORTED_JAVA_MAJOR_VERSION) {
            utils.logLabeledError("emulators", commandUtils_1.JAVA_DEPRECATION_WARNING, "warn");
            throw new error_1.FirebaseError(commandUtils_1.JAVA_DEPRECATION_WARNING);
        }
    }
    const hubLogger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.HUB);
    hubLogger.logLabeled("BULLET", "emulators", `Starting emulators: ${targets.join(", ")}`);
    const projectId = (0, projectUtils_1.getProjectId)(options) || "";
    const isDemoProject = constants_1.Constants.isDemoProject(projectId);
    if (isDemoProject) {
        hubLogger.logLabeled("BULLET", "emulators", `Detected demo project ID "${projectId}", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.`);
    }
    const onlyOptions = options.only;
    if (onlyOptions) {
        const requested = onlyOptions.split(",").map((o) => {
            return o.split(":")[0];
        });
        const ignored = requested.filter((k) => !targets.includes(k));
        for (const name of ignored) {
            if ((0, types_1.isEmulator)(name)) {
                emulatorLogger_1.EmulatorLogger.forEmulator(name).logLabeled("WARN", name, `Not starting the ${clc.bold(name)} emulator, make sure you have run ${clc.bold("firebase init")}.`);
            }
            else {
                throw new error_1.FirebaseError(`${name} is not a valid emulator name, valid options are: ${JSON.stringify(types_1.ALL_SERVICE_EMULATORS)}`, { exit: 1 });
            }
        }
    }
    function startEmulator(instance) {
        const name = instance.getName();
        void (0, track_1.track)("Emulator Run", name);
        void (0, track_1.trackEmulator)("emulator_run", {
            emulator_name: name,
            is_demo_project: String(isDemoProject),
        });
        return registry_1.EmulatorRegistry.start(instance);
    }
    if (shouldStart(options, types_1.Emulators.HUB)) {
        const hubAddr = await getAndCheckAddress(types_1.Emulators.HUB, options);
        const hub = new hub_1.EmulatorHub(Object.assign({ projectId }, hubAddr));
        void (0, track_1.track)("emulators:start", "hub");
        await startEmulator(hub);
    }
    let exportMetadata = {
        version: "unknown",
    };
    if (options.import) {
        utils.assertIsString(options.import);
        const importDir = path.resolve(options.import);
        const foundMetadata = findExportMetadata(importDir);
        if (foundMetadata) {
            exportMetadata = foundMetadata;
            void (0, track_1.trackEmulator)("emulator_import", {
                initiated_by: "start",
                emulator_name: types_1.Emulators.HUB,
            });
        }
        else {
            hubLogger.logLabeled("WARN", "emulators", `Could not find import/export metadata file, ${clc.bold("skipping data import!")}`);
        }
    }
    const hostingConfig = options.config.get("hosting");
    if (Array.isArray(hostingConfig) ? hostingConfig.some((it) => it.source) : hostingConfig === null || hostingConfig === void 0 ? void 0 : hostingConfig.source) {
        experiments.assertEnabled("webframeworks", "emulate a web framework");
        const emulators = [];
        if (experiments.isEnabled("webframeworks")) {
            for (const e of types_1.EMULATORS_SUPPORTED_BY_UI) {
                const info = registry_1.EmulatorRegistry.getInfo(e);
                if (info)
                    emulators.push(info);
            }
        }
        await (0, frameworks_1.prepareFrameworks)(targets, options, options, emulators);
    }
    const emulatableBackends = [];
    const projectDir = (options.extDevDir || options.config.projectDir);
    if (shouldStart(options, types_1.Emulators.FUNCTIONS)) {
        const functionsCfg = (0, projectConfig_1.normalizeAndValidate)(options.config.src.functions);
        utils.assertIsStringOrUndefined(options.extDevDir);
        for (const cfg of functionsCfg) {
            const functionsDir = path.join(projectDir, cfg.source);
            emulatableBackends.push({
                functionsDir,
                codebase: cfg.codebase,
                env: Object.assign({}, options.extDevEnv),
                secretEnv: [],
                predefinedTriggers: options.extDevTriggers,
                nodeMajorVersion: (0, functionsEmulatorUtils_1.parseRuntimeVersion)(options.extDevNodeVersion || cfg.runtime),
            });
        }
    }
    if (shouldStart(options, types_1.Emulators.EXTENSIONS)) {
        const projectNumber = isDemoProject
            ? constants_1.Constants.FAKE_PROJECT_NUMBER
            : await (0, projectUtils_1.needProjectNumber)(options);
        const aliases = (0, projectUtils_1.getAliases)(options, projectId);
        const extensionEmulator = new extensionsEmulator_1.ExtensionsEmulator({
            projectId,
            projectDir: options.config.projectDir,
            projectNumber,
            aliases,
            extensions: options.config.get("extensions"),
        });
        const extensionsBackends = await extensionEmulator.getExtensionBackends();
        const filteredExtensionsBackends = extensionEmulator.filterUnemulatedTriggers(options, extensionsBackends);
        emulatableBackends.push(...filteredExtensionsBackends);
        await startEmulator(extensionEmulator);
    }
    if (emulatableBackends.length) {
        const functionsLogger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS);
        const functionsAddr = await getAndCheckAddress(types_1.Emulators.FUNCTIONS, options);
        const projectId = (0, projectUtils_1.needProjectId)(options);
        let inspectFunctions;
        if (options.inspectFunctions) {
            inspectFunctions = commandUtils.parseInspectionPort(options);
            functionsLogger.logLabeled("WARN", "functions", `You are running the Functions emulator in debug mode (port=${inspectFunctions}). This means that functions will execute in sequence rather than in parallel.`);
        }
        const emulatorsNotRunning = types_1.ALL_SERVICE_EMULATORS.filter((e) => {
            return e !== types_1.Emulators.FUNCTIONS && !shouldStart(options, e);
        });
        if (emulatorsNotRunning.length > 0 && !constants_1.Constants.isDemoProject(projectId)) {
            functionsLogger.logLabeled("WARN", "functions", `The following emulators are not running, calls to these services from the Functions emulator will affect production: ${clc.bold(emulatorsNotRunning.join(", "))}`);
        }
        const account = (0, auth_2.getProjectDefaultAccount)(options.projectRoot);
        const functionsEmulator = new functionsEmulator_1.FunctionsEmulator({
            projectId,
            projectDir,
            emulatableBackends,
            account,
            host: functionsAddr.host,
            port: functionsAddr.port,
            debugPort: inspectFunctions,
            projectAlias: options.projectAlias,
        });
        await startEmulator(functionsEmulator);
        const eventarcAddr = await getAndCheckAddress(types_1.Emulators.EVENTARC, options);
        const eventarcEmulator = new eventarcEmulator_1.EventarcEmulator({
            host: eventarcAddr.host,
            port: eventarcAddr.port,
        });
        await startEmulator(eventarcEmulator);
    }
    if (shouldStart(options, types_1.Emulators.FIRESTORE)) {
        const firestoreLogger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FIRESTORE);
        const firestoreAddr = await getAndCheckAddress(types_1.Emulators.FIRESTORE, options);
        const portVal = (_b = (_a = options.config.src.emulators) === null || _a === void 0 ? void 0 : _a.firestore) === null || _b === void 0 ? void 0 : _b.websocketPort;
        const websocketPort = await getFirestoreWebSocketPort(firestoreAddr.host, portVal, types_1.Emulators.FIRESTORE);
        const args = {
            host: firestoreAddr.host,
            port: firestoreAddr.port,
            websocket_port: websocketPort,
            projectId,
            auto_download: true,
        };
        if (exportMetadata.firestore) {
            utils.assertIsString(options.import);
            const importDirAbsPath = path.resolve(options.import);
            const exportMetadataFilePath = path.resolve(importDirAbsPath, exportMetadata.firestore.metadata_file);
            firestoreLogger.logLabeled("BULLET", "firestore", `Importing data from ${exportMetadataFilePath}`);
            args.seed_from_export = exportMetadataFilePath;
            void (0, track_1.trackEmulator)("emulator_import", {
                initiated_by: "start",
                emulator_name: types_1.Emulators.FIRESTORE,
            });
        }
        const config = options.config;
        const rulesLocalPath = (_c = config.src.firestore) === null || _c === void 0 ? void 0 : _c.rules;
        let rulesFileFound = false;
        if (rulesLocalPath) {
            const rules = config.path(rulesLocalPath);
            rulesFileFound = fs.existsSync(rules);
            if (rulesFileFound) {
                args.rules = rules;
            }
            else {
                firestoreLogger.logLabeled("WARN", "firestore", `Cloud Firestore rules file ${clc.bold(rules)} specified in firebase.json does not exist.`);
            }
        }
        else {
            firestoreLogger.logLabeled("WARN", "firestore", "Did not find a Cloud Firestore rules file specified in a firebase.json config file.");
        }
        if (!rulesFileFound) {
            firestoreLogger.logLabeled("WARN", "firestore", "The emulator will default to allowing all reads and writes. Learn more about this option: https://firebase.google.com/docs/emulator-suite/install_and_configure#security_rules_configuration.");
        }
        const firestoreEmulator = new firestoreEmulator_1.FirestoreEmulator(args);
        await startEmulator(firestoreEmulator);
        firestoreLogger.logLabeled("SUCCESS", types_1.Emulators.FIRESTORE, `Firestore Emulator UI websocket is running on ${websocketPort}.`);
    }
    if (shouldStart(options, types_1.Emulators.DATABASE)) {
        const databaseLogger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.DATABASE);
        const databaseAddr = await getAndCheckAddress(types_1.Emulators.DATABASE, options);
        const args = {
            host: databaseAddr.host,
            port: databaseAddr.port,
            projectId,
            auto_download: true,
        };
        try {
            if (!options.instance) {
                options.instance = await (0, getDefaultDatabaseInstance_1.getDefaultDatabaseInstance)(options);
            }
        }
        catch (e) {
            databaseLogger.log("DEBUG", `Failed to retrieve default database instance: ${JSON.stringify(e)}`);
        }
        const rc = dbRulesConfig.normalizeRulesConfig(dbRulesConfig.getRulesConfig(projectId, options), options);
        logger_1.logger.debug("database rules config: ", JSON.stringify(rc));
        args.rules = rc;
        if (rc.length === 0) {
            databaseLogger.logLabeled("WARN", "database", "Did not find a Realtime Database rules file specified in a firebase.json config file. The emulator will default to allowing all reads and writes. Learn more about this option: https://firebase.google.com/docs/emulator-suite/install_and_configure#security_rules_configuration.");
        }
        else {
            for (const c of rc) {
                const rules = c.rules;
                if (!fs.existsSync(rules)) {
                    databaseLogger.logLabeled("WARN", "database", `Realtime Database rules file ${clc.bold(rules)} specified in firebase.json does not exist.`);
                }
            }
        }
        const databaseEmulator = new databaseEmulator_1.DatabaseEmulator(args);
        await startEmulator(databaseEmulator);
        if (exportMetadata.database) {
            utils.assertIsString(options.import);
            const importDirAbsPath = path.resolve(options.import);
            const databaseExportDir = path.resolve(importDirAbsPath, exportMetadata.database.path);
            const files = fs.readdirSync(databaseExportDir).filter((f) => f.endsWith(".json"));
            void (0, track_1.trackEmulator)("emulator_import", {
                initiated_by: "start",
                emulator_name: types_1.Emulators.DATABASE,
                count: files.length,
            });
            for (const f of files) {
                const fPath = path.join(databaseExportDir, f);
                const ns = path.basename(f, ".json");
                await databaseEmulator.importData(ns, fPath);
            }
        }
    }
    if (shouldStart(options, types_1.Emulators.AUTH)) {
        if (!projectId) {
            throw new error_1.FirebaseError(`Cannot start the ${constants_1.Constants.description(types_1.Emulators.AUTH)} without a project: run 'firebase init' or provide the --project flag`);
        }
        const authAddr = await getAndCheckAddress(types_1.Emulators.AUTH, options);
        const authEmulator = new auth_1.AuthEmulator({
            host: authAddr.host,
            port: authAddr.port,
            projectId,
        });
        await startEmulator(authEmulator);
        if (exportMetadata.auth) {
            utils.assertIsString(options.import);
            const importDirAbsPath = path.resolve(options.import);
            const authExportDir = path.resolve(importDirAbsPath, exportMetadata.auth.path);
            await authEmulator.importData(authExportDir, projectId, { initiatedBy: "start" });
        }
    }
    if (shouldStart(options, types_1.Emulators.PUBSUB)) {
        if (!projectId) {
            throw new error_1.FirebaseError("Cannot start the Pub/Sub emulator without a project: run 'firebase init' or provide the --project flag");
        }
        const pubsubAddr = await getAndCheckAddress(types_1.Emulators.PUBSUB, options);
        const pubsubEmulator = new pubsubEmulator_1.PubsubEmulator({
            host: pubsubAddr.host,
            port: pubsubAddr.port,
            projectId,
            auto_download: true,
        });
        await startEmulator(pubsubEmulator);
    }
    if (shouldStart(options, types_1.Emulators.STORAGE)) {
        const storageAddr = await getAndCheckAddress(types_1.Emulators.STORAGE, options);
        const storageEmulator = new storage_1.StorageEmulator({
            host: storageAddr.host,
            port: storageAddr.port,
            projectId: projectId,
            rules: (0, config_1.getStorageRulesConfig)(projectId, options),
        });
        await startEmulator(storageEmulator);
        if (exportMetadata.storage) {
            utils.assertIsString(options.import);
            const importDirAbsPath = path.resolve(options.import);
            const storageExportDir = path.resolve(importDirAbsPath, exportMetadata.storage.path);
            storageEmulator.storageLayer.import(storageExportDir, { initiatedBy: "start" });
        }
    }
    if (shouldStart(options, types_1.Emulators.HOSTING)) {
        const hostingAddr = await getAndCheckAddress(types_1.Emulators.HOSTING, options);
        const hostingEmulator = new hostingEmulator_1.HostingEmulator({
            host: hostingAddr.host,
            port: hostingAddr.port,
            options,
        });
        await startEmulator(hostingEmulator);
    }
    if (showUI && !shouldStart(options, types_1.Emulators.UI)) {
        hubLogger.logLabeled("WARN", "emulators", "The Emulator UI is not starting, either because none of the emulated " +
            "products have an interaction layer in Emulator UI or it cannot " +
            "determine the Project ID. Pass the --project flag to specify a project.");
    }
    if (showUI && (shouldStart(options, types_1.Emulators.UI) || START_LOGGING_EMULATOR)) {
        const loggingAddr = await getAndCheckAddress(types_1.Emulators.LOGGING, options);
        const loggingEmulator = new loggingEmulator_1.LoggingEmulator({
            host: loggingAddr.host,
            port: loggingAddr.port,
        });
        await startEmulator(loggingEmulator);
    }
    if (showUI && shouldStart(options, types_1.Emulators.UI)) {
        const uiAddr = await getAndCheckAddress(types_1.Emulators.UI, options);
        const ui = new ui_1.EmulatorUI(Object.assign({ projectId: projectId, auto_download: true }, uiAddr));
        await startEmulator(ui);
    }
    let serviceEmulatorCount = 0;
    const running = registry_1.EmulatorRegistry.listRunning();
    for (const name of running) {
        const instance = registry_1.EmulatorRegistry.get(name);
        if (instance) {
            await instance.connect();
        }
        if (types_1.ALL_SERVICE_EMULATORS.includes(name)) {
            serviceEmulatorCount++;
        }
    }
    void (0, track_1.trackEmulator)("emulators_started", {
        count: serviceEmulatorCount,
        count_all: running.length,
        is_demo_project: String(isDemoProject),
    });
    return { deprecationNotices: [] };
}
exports.startAll = startAll;
async function exportEmulatorData(exportPath, options, initiatedBy) {
    const projectId = options.project;
    if (!projectId) {
        throw new error_1.FirebaseError("Could not determine project ID, make sure you're running in a Firebase project directory or add the --project flag.", { exit: 1 });
    }
    const hubClient = new hubClient_1.EmulatorHubClient(projectId);
    if (!hubClient.foundHub()) {
        throw new error_1.FirebaseError(`Did not find any running emulators for project ${clc.bold(projectId)}.`, { exit: 1 });
    }
    try {
        await hubClient.getStatus();
    }
    catch (e) {
        const filePath = hub_1.EmulatorHub.getLocatorFilePath(projectId);
        throw new error_1.FirebaseError(`The emulator hub for ${projectId} did not respond to a status check. If this error continues try shutting down all running emulators and deleting the file ${filePath}`, { exit: 1 });
    }
    utils.logBullet(`Found running emulator hub for project ${clc.bold(projectId)} at ${hubClient.origin}`);
    const exportAbsPath = path.resolve(exportPath);
    if (!fs.existsSync(exportAbsPath)) {
        utils.logBullet(`Creating export directory ${exportAbsPath}`);
        fs.mkdirSync(exportAbsPath);
    }
    const existingMetadata = hubExport_1.HubExport.readMetadata(exportAbsPath);
    if (existingMetadata && !(options.force || options.exportOnExit)) {
        if (options.noninteractive) {
            throw new error_1.FirebaseError("Export already exists in the target directory, re-run with --force to overwrite.", { exit: 1 });
        }
        const prompt = await (0, prompt_1.promptOnce)({
            type: "confirm",
            message: `The directory ${exportAbsPath} already contains export data. Exporting again to the same directory will overwrite all data. Do you want to continue?`,
            default: false,
        });
        if (!prompt) {
            throw new error_1.FirebaseError("Command aborted", { exit: 1 });
        }
    }
    utils.logBullet(`Exporting data to: ${exportAbsPath}`);
    try {
        await hubClient.postExport({ path: exportAbsPath, initiatedBy });
    }
    catch (e) {
        throw new error_1.FirebaseError("Export request failed, see emulator logs for more information.", {
            exit: 1,
            original: e,
        });
    }
    utils.logSuccess("Export complete");
}
exports.exportEmulatorData = exportEmulatorData;
//# sourceMappingURL=controller.js.map