"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerResponseProxy = exports.prepareFrameworks = exports.findDependency = exports.discover = exports.relativeRequire = exports.WebFrameworks = exports.NODE_VERSION = exports.DEFAULT_REGION = exports.FIREBASE_ADMIN_VERSION = exports.FIREBASE_FUNCTIONS_VERSION = exports.FIREBASE_FRAMEWORKS_VERSION = void 0;
const path_1 = require("path");
const process_1 = require("process");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const url_1 = require("url");
const http_1 = require("http");
const promises_1 = require("fs/promises");
const fs_extra_1 = require("fs-extra");
const clc = require("colorette");
const process = require("node:process");
const semver = require("semver");
const projectUtils_1 = require("../projectUtils");
const normalizedHostingConfigs_1 = require("../hosting/normalizedHostingConfigs");
const api_1 = require("../hosting/api");
const apps_1 = require("../management/apps");
const prompt_1 = require("../prompt");
const types_1 = require("../emulator/types");
const defaultCredentials_1 = require("../defaultCredentials");
const auth_1 = require("../auth");
const functionsEmulatorShared_1 = require("../emulator/functionsEmulatorShared");
const constants_1 = require("../emulator/constants");
const error_1 = require("../error");
const { dynamicImport } = require(true && "../dynamicImport");
const SupportLevelWarnings = {
    ["expirimental"]: clc.yellow(`This is an expirimental integration, proceed with caution.`),
    ["community-supported"]: clc.yellow(`This is a community-supported integration, support is best effort.`),
};
exports.FIREBASE_FRAMEWORKS_VERSION = "^0.6.0";
exports.FIREBASE_FUNCTIONS_VERSION = "^3.23.0";
exports.FIREBASE_ADMIN_VERSION = "^11.0.1";
exports.DEFAULT_REGION = "us-central1";
exports.NODE_VERSION = parseInt(process.versions.node, 10).toString();
const DEFAULT_FIND_DEP_OPTIONS = {
    cwd: process.cwd(),
    omitDev: true,
};
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
exports.WebFrameworks = Object.fromEntries((0, fs_1.readdirSync)(__dirname)
    .filter((path) => (0, fs_1.statSync)((0, path_1.join)(__dirname, path)).isDirectory())
    .map((path) => [path, require((0, path_1.join)(__dirname, path))])
    .filter(([, obj]) => obj.name && obj.discover && obj.build && obj.type !== undefined && obj.support));
function relativeRequire(dir, mod) {
    try {
        const path = require.resolve(mod, { paths: [dir] });
        if ((0, path_1.extname)(path) === ".mjs") {
            return dynamicImport((0, url_1.pathToFileURL)(path).toString());
        }
        else {
            return require(path);
        }
    }
    catch (e) {
        const path = (0, path_1.relative)(process.cwd(), dir);
        console.error(`Could not load dependency ${mod} in ${path.startsWith("..") ? path : `./${path}`}, have you run \`npm install\`?`);
        throw e;
    }
}
exports.relativeRequire = relativeRequire;
async function discover(dir, warn = true) {
    const allFrameworkTypes = [
        ...new Set(Object.values(exports.WebFrameworks).map(({ type }) => type)),
    ].sort();
    for (const discoveryType of allFrameworkTypes) {
        const frameworksDiscovered = [];
        for (const framework in exports.WebFrameworks) {
            if (exports.WebFrameworks[framework]) {
                const { discover, type } = exports.WebFrameworks[framework];
                if (type !== discoveryType)
                    continue;
                const result = await discover(dir);
                if (result)
                    frameworksDiscovered.push(Object.assign({ framework }, result));
            }
        }
        if (frameworksDiscovered.length > 1) {
            if (warn)
                console.error("Multiple conflicting frameworks discovered. TODO link");
            return;
        }
        if (frameworksDiscovered.length === 1)
            return frameworksDiscovered[0];
    }
    if (warn)
        console.warn("We can't detirmine the web framework in use. TODO link");
    return;
}
exports.discover = discover;
function scanDependencyTree(searchingFor, dependencies = {}) {
    for (const [name, dependency] of Object.entries(dependencies)) {
        if (name === searchingFor)
            return dependency;
        const result = scanDependencyTree(searchingFor, dependency.dependencies);
        if (result)
            return result;
    }
    return;
}
function findDependency(name, options = {}) {
    const { cwd, depth, omitDev } = Object.assign(Object.assign({}, DEFAULT_FIND_DEP_OPTIONS), options);
    const result = (0, child_process_1.spawnSync)(NPM_COMMAND, [
        "list",
        name,
        "--json",
        ...(omitDev ? ["--omit", "dev"] : []),
        ...(depth === undefined ? [] : ["--depth", depth.toString(10)]),
    ], { cwd });
    if (!result.stdout)
        return;
    const json = JSON.parse(result.stdout.toString());
    return scanDependencyTree(name, json.dependencies);
}
exports.findDependency = findDependency;
async function prepareFrameworks(targetNames, context, options, emulators = []) {
    var _a;
    var _b, _c, _d, _e;
    const nodeVersion = process.version;
    if (!semver.satisfies(nodeVersion, ">=16.0.0")) {
        throw new error_1.FirebaseError(`The frameworks awareness feature requires Node.JS >= 16 and npm >= 8 in order to work correctly, due to some of the downstream dependencies. Please upgrade your version of Node.JS, reinstall firebase-tools, and give it another go.`);
    }
    const project = (0, projectUtils_1.needProjectId)(context);
    const { projectRoot } = options;
    const account = (0, auth_1.getProjectDefaultAccount)(projectRoot);
    const configs = (0, normalizedHostingConfigs_1.normalizedHostingConfigs)(Object.assign({ site: project }, options), { resolveTargets: true });
    options.normalizedHostingConfigs = configs;
    let firebaseDefaults = undefined;
    if (configs.length === 0)
        return;
    for (const config of configs) {
        const { source, site, public: publicDir } = config;
        if (!source)
            continue;
        config.rewrites || (config.rewrites = []);
        config.redirects || (config.redirects = []);
        config.headers || (config.headers = []);
        (_a = config.cleanUrls) !== null && _a !== void 0 ? _a : (config.cleanUrls = true);
        const dist = (0, path_1.join)(projectRoot, ".firebase", site);
        const hostingDist = (0, path_1.join)(dist, "hosting");
        const functionsDist = (0, path_1.join)(dist, "functions");
        if (publicDir)
            throw new Error(`hosting.public and hosting.source cannot both be set in firebase.json`);
        const getProjectPath = (...args) => (0, path_1.join)(projectRoot, source, ...args);
        const functionName = `ssr${site.replace(/-/g, "")}`;
        const usesFirebaseAdminSdk = !!findDependency("firebase-admin", { cwd: getProjectPath() });
        const usesFirebaseJsSdk = !!findDependency("@firebase/app", { cwd: getProjectPath() });
        if (usesFirebaseAdminSdk) {
            process.env.GOOGLE_CLOUD_PROJECT = project;
            if (account && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                const defaultCredPath = await (0, defaultCredentials_1.getCredentialPathAsync)(account);
                if (defaultCredPath)
                    process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultCredPath;
            }
        }
        emulators.forEach((info) => {
            if (usesFirebaseAdminSdk) {
                if (info.name === types_1.Emulators.FIRESTORE)
                    process.env[constants_1.Constants.FIRESTORE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(info);
                if (info.name === types_1.Emulators.AUTH)
                    process.env[constants_1.Constants.FIREBASE_AUTH_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(info);
                if (info.name === types_1.Emulators.DATABASE)
                    process.env[constants_1.Constants.FIREBASE_DATABASE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(info);
                if (info.name === types_1.Emulators.STORAGE)
                    process.env[constants_1.Constants.FIREBASE_STORAGE_EMULATOR_HOST] = (0, functionsEmulatorShared_1.formatHost)(info);
            }
            if (usesFirebaseJsSdk) {
                firebaseDefaults || (firebaseDefaults = {});
                firebaseDefaults.emulatorHosts || (firebaseDefaults.emulatorHosts = {});
                firebaseDefaults.emulatorHosts[info.name] = (0, functionsEmulatorShared_1.formatHost)(info);
            }
        });
        let firebaseConfig = null;
        if (usesFirebaseJsSdk) {
            const sites = await (0, api_1.listSites)(project);
            const selectedSite = sites.find((it) => it.name && it.name.split("/").pop() === site);
            if (selectedSite) {
                const { appId } = selectedSite;
                if (appId) {
                    firebaseConfig = await (0, apps_1.getAppConfig)(appId, apps_1.AppPlatform.WEB);
                    firebaseDefaults || (firebaseDefaults = {});
                    firebaseDefaults.config = firebaseConfig;
                }
                else {
                    console.warn(`No Firebase app associated with site ${site}, unable to provide authenticated server context.
You can link a Web app to a Hosting site here https://console.firebase.google.com/project/_/settings/general/web`);
                    if (!options.nonInteractive) {
                        const continueDeploy = await (0, prompt_1.promptOnce)({
                            type: "confirm",
                            default: true,
                            message: "Would you like to continue with the deploy?",
                        });
                        if (!continueDeploy)
                            (0, process_1.exit)(1);
                    }
                }
            }
        }
        if (firebaseDefaults)
            process.env.__FIREBASE_DEFAULTS__ = JSON.stringify(firebaseDefaults);
        const results = await discover(getProjectPath());
        if (!results)
            throw new Error("Epic fail.");
        const { framework, mayWantBackend, publicDirectory } = results;
        const { build, ??codegenPublicDirectory, ??codegenFunctionsDirectory: codegenProdModeFunctionsDirectory, getDevModeHandle, name, support, } = exports.WebFrameworks[framework];
        console.log(`Detected a ${name} codebase. ${SupportLevelWarnings[support] || ""}\n`);
        const isDevMode = context._name === "serve" || context._name === "emulators:start";
        const devModeHandle = isDevMode && getDevModeHandle && (await getDevModeHandle(getProjectPath()));
        let codegenFunctionsDirectory;
        if (devModeHandle) {
            config.public = (0, path_1.relative)(projectRoot, publicDirectory);
            options.frameworksDevModeHandle = devModeHandle;
            if (mayWantBackend && firebaseDefaults)
                codegenFunctionsDirectory = codegenDevModeFunctionsDirectory;
        }
        else {
            const { wantsBackend = false, rewrites = [], redirects = [], headers = [], } = (await build(getProjectPath())) || {};
            config.rewrites.push(...rewrites);
            config.redirects.push(...redirects);
            config.headers.push(...headers);
            if (await (0, fs_extra_1.pathExists)(hostingDist))
                await (0, promises_1.rm)(hostingDist, { recursive: true });
            await (0, fs_extra_1.mkdirp)(hostingDist);
            await ??codegenPublicDirectory(getProjectPath(), hostingDist);
            config.public = (0, path_1.relative)(projectRoot, hostingDist);
            if (wantsBackend)
                codegenFunctionsDirectory = codegenProdModeFunctionsDirectory;
        }
        if (codegenFunctionsDirectory) {
            if (firebaseDefaults)
                firebaseDefaults._authTokenSyncURL = "/__session";
            config.rewrites.push({
                source: "**",
                function: functionName,
            });
            const existingFunctionsConfig = options.config.get("functions")
                ? [].concat(options.config.get("functions"))
                : [];
            options.config.set("functions", [
                ...existingFunctionsConfig,
                {
                    source: (0, path_1.relative)(projectRoot, functionsDist),
                    codebase: `firebase-frameworks-${site}`,
                },
            ]);
            if (!targetNames.includes("functions"))
                targetNames.unshift("functions");
            if (await (0, fs_extra_1.pathExists)(functionsDist)) {
                const functionsDistStat = await (0, fs_extra_1.stat)(functionsDist);
                if (functionsDistStat === null || functionsDistStat === void 0 ? void 0 : functionsDistStat.isDirectory()) {
                    const files = await (0, promises_1.readdir)(functionsDist);
                    for (const file of files) {
                        if (file !== "node_modules" && file !== "package-lock.json")
                            await (0, promises_1.rm)((0, path_1.join)(functionsDist, file), { recursive: true });
                    }
                }
                else {
                    await (0, promises_1.rm)(functionsDist);
                }
            }
            else {
                await (0, fs_extra_1.mkdirp)(functionsDist);
            }
            const { packageJson, bootstrapScript, frameworksEntry = framework, } = await codegenFunctionsDirectory(getProjectPath(), functionsDist);
            await (0, promises_1.writeFile)((0, path_1.join)(functionsDist, "functions.yaml"), JSON.stringify({
                endpoints: {
                    [functionName]: {
                        platform: "gcfv2",
                        region: [exports.DEFAULT_REGION],
                        labels: {},
                        httpsTrigger: {},
                        entryPoint: "ssr",
                    },
                },
                specVersion: "v1alpha1",
                requiredAPIs: [],
            }, null, 2));
            packageJson.main = "server.js";
            delete packageJson.devDependencies;
            packageJson.dependencies || (packageJson.dependencies = {});
            (_b = packageJson.dependencies)["firebase-frameworks"] || (_b["firebase-frameworks"] = exports.FIREBASE_FRAMEWORKS_VERSION);
            (_c = packageJson.dependencies)["firebase-functions"] || (_c["firebase-functions"] = exports.FIREBASE_FUNCTIONS_VERSION);
            (_d = packageJson.dependencies)["firebase-admin"] || (_d["firebase-admin"] = exports.FIREBASE_ADMIN_VERSION);
            packageJson.engines || (packageJson.engines = {});
            (_e = packageJson.engines).node || (_e.node = exports.NODE_VERSION);
            await (0, promises_1.writeFile)((0, path_1.join)(functionsDist, "package.json"), JSON.stringify(packageJson, null, 2));
            await (0, promises_1.writeFile)((0, path_1.join)(functionsDist, ".env"), `__FIREBASE_FRAMEWORKS_ENTRY__=${frameworksEntry}
${firebaseDefaults ? `__FIREBASE_DEFAULTS__=${JSON.stringify(firebaseDefaults)}\n` : ""}`);
            await (0, promises_1.copyFile)(getProjectPath("package-lock.json"), (0, path_1.join)(functionsDist, "package-lock.json")).catch(() => {
            });
            (0, child_process_1.execSync)(`${NPM_COMMAND} i --omit dev --no-audit`, {
                cwd: functionsDist,
                stdio: "inherit",
            });
            if (bootstrapScript)
                await (0, promises_1.writeFile)((0, path_1.join)(functionsDist, "bootstrap.js"), bootstrapScript);
            await (0, promises_1.writeFile)((0, path_1.join)(functionsDist, "server.js"), `const { onRequest } = require('firebase-functions/v2/https');
const server = import('firebase-frameworks');
exports.ssr = onRequest((req, res) => server.then(it => it.handle(req, res)));
`);
        }
        else {
            config.rewrites.push({
                source: "**",
                destination: "/index.html",
            });
        }
        if (firebaseDefaults) {
            const encodedDefaults = Buffer.from(JSON.stringify(firebaseDefaults)).toString("base64url");
            const expires = new Date(new Date().getTime() + 60000000000);
            const sameSite = "Strict";
            const path = `/`;
            config.headers.push({
                source: "**/*.js",
                headers: [
                    {
                        key: "Set-Cookie",
                        value: `__FIREBASE_DEFAULTS__=${encodedDefaults}; SameSite=${sameSite}; Expires=${expires.toISOString()}; Path=${path};`,
                    },
                ],
            });
        }
    }
}
exports.prepareFrameworks = prepareFrameworks;
function codegenDevModeFunctionsDirectory() {
    const packageJson = {};
    return Promise.resolve({ packageJson, frameworksEntry: "_devMode" });
}
function createServerResponseProxy(req, res, next) {
    const proxiedRes = new http_1.ServerResponse(req);
    const buffer = [];
    proxiedRes.write = new Proxy(proxiedRes.write.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["write", args]);
        },
    });
    proxiedRes.setHeader = new Proxy(proxiedRes.setHeader.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["setHeader", args]);
        },
    });
    proxiedRes.removeHeader = new Proxy(proxiedRes.removeHeader.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["removeHeader", args]);
        },
    });
    proxiedRes.writeHead = new Proxy(proxiedRes.writeHead.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            buffer.push(["writeHead", args]);
        },
    });
    proxiedRes.end = new Proxy(proxiedRes.end.bind(proxiedRes), {
        apply: (target, thisArg, args) => {
            target.call(thisArg, ...args);
            if (proxiedRes.statusCode === 404) {
                next();
            }
            else {
                for (const [fn, args] of buffer) {
                    res[fn](...args);
                }
                res.end(...args);
            }
        },
    });
    return proxiedRes;
}
exports.createServerResponseProxy = createServerResponseProxy;
//# sourceMappingURL=index.js.map