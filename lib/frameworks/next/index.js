"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevModeHandle = exports.╔ÁcodegenFunctionsDirectory = exports.╔ÁcodegenPublicDirectory = exports.init = exports.build = exports.discover = exports.type = exports.support = exports.name = void 0;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const fs_extra_1 = require("fs-extra");
const url_1 = require("url");
const fs_1 = require("fs");
const __1 = require("..");
const prompt_1 = require("../../prompt");
const semver_1 = require("semver");
const logger_1 = require("../../logger");
const error_1 = require("../../error");
const CLI_COMMAND = (0, path_1.join)("node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
exports.name = "Next.js";
exports.support = "expirimental";
exports.type = 2;
function getNextVersion(cwd) {
    var _a;
    return (_a = (0, __1.findDependency)("next", { cwd, depth: 0, omitDev: false })) === null || _a === void 0 ? void 0 : _a.version;
}
async function discover(dir) {
    if (!(await (0, fs_extra_1.pathExists)((0, path_1.join)(dir, "package.json"))))
        return;
    if (!(await (0, fs_extra_1.pathExists)("next.config.js")) && !getNextVersion(dir))
        return;
    return { mayWantBackend: true, publicDirectory: (0, path_1.join)(dir, "public") };
}
exports.discover = discover;
async function build(dir) {
    const { default: nextBuild } = (0, __1.relativeRequire)(dir, "next/dist/build");
    await nextBuild(dir, null, false, false, true).catch((e) => {
        console.error(e.message);
        throw e;
    });
    try {
        (0, child_process_1.execSync)(`${CLI_COMMAND} export`, { cwd: dir, stdio: "ignore" });
    }
    catch (e) {
    }
    let wantsBackend = true;
    const { distDir } = await getConfig(dir);
    const exportDetailPath = (0, path_1.join)(dir, distDir, "export-detail.json");
    const exportDetailExists = await (0, fs_extra_1.pathExists)(exportDetailPath);
    const exportDetailBuffer = exportDetailExists ? await (0, promises_1.readFile)(exportDetailPath) : undefined;
    const exportDetailJson = exportDetailBuffer && JSON.parse(exportDetailBuffer.toString());
    if (exportDetailJson === null || exportDetailJson === void 0 ? void 0 : exportDetailJson.success) {
        const prerenderManifestJSON = await (0, promises_1.readFile)((0, path_1.join)(dir, distDir, "prerender-manifest.json")).then((it) => JSON.parse(it.toString()));
        const anyDynamicRouteFallbacks = !!Object.values(prerenderManifestJSON.dynamicRoutes || {}).find((it) => it.fallback !== false);
        const pagesManifestJSON = await (0, promises_1.readFile)((0, path_1.join)(dir, distDir, "server", "pages-manifest.json")).then((it) => JSON.parse(it.toString()));
        const prerenderedRoutes = Object.keys(prerenderManifestJSON.routes);
        const dynamicRoutes = Object.keys(prerenderManifestJSON.dynamicRoutes);
        const unrenderedPages = Object.keys(pagesManifestJSON).filter((it) => !(["/_app", "/_error", "/_document", "/404"].includes(it) ||
            prerenderedRoutes.includes(it) ||
            dynamicRoutes.includes(it)));
        if (!anyDynamicRouteFallbacks && unrenderedPages.length === 0) {
            wantsBackend = false;
        }
    }
    const manifestBuffer = await (0, promises_1.readFile)((0, path_1.join)(dir, distDir, "routes-manifest.json"));
    const manifest = JSON.parse(manifestBuffer.toString());
    const { headers: nextJsHeaders = [], redirects: nextJsRedirects = [], rewrites: nextJsRewrites = [], } = manifest;
    const headers = nextJsHeaders.map(({ source, headers }) => ({ source, headers }));
    const redirects = nextJsRedirects
        .filter(({ internal }) => !internal)
        .map(({ source, destination, statusCode: type }) => ({ source, destination, type }));
    const nextJsRewritesToUse = Array.isArray(nextJsRewrites)
        ? nextJsRewrites
        : nextJsRewrites.beforeFiles || [];
    const rewrites = nextJsRewritesToUse
        .map(({ source, destination, has }) => {
        if (has)
            return undefined;
        return { source, destination };
    })
        .filter((it) => it);
    return { wantsBackend, headers, redirects, rewrites };
}
exports.build = build;
async function init(setup) {
    const language = await (0, prompt_1.promptOnce)({
        type: "list",
        default: "JavaScript",
        message: "What language would you like to use?",
        choices: ["JavaScript", "TypeScript"],
    });
    (0, child_process_1.execSync)(`npx --yes create-next-app@latest ${setup.hosting.source} ${language === "TypeScript" ? "--ts" : ""}`, { stdio: "inherit" });
}
exports.init = init;
async function ╔ÁcodegenPublicDirectory(sourceDir, destDir) {
    const { distDir } = await getConfig(sourceDir);
    const exportDetailPath = (0, path_1.join)(sourceDir, distDir, "export-detail.json");
    const exportDetailExists = await (0, fs_extra_1.pathExists)(exportDetailPath);
    const exportDetailBuffer = exportDetailExists ? await (0, promises_1.readFile)(exportDetailPath) : undefined;
    const exportDetailJson = exportDetailBuffer && JSON.parse(exportDetailBuffer.toString());
    if (exportDetailJson === null || exportDetailJson === void 0 ? void 0 : exportDetailJson.success) {
        (0, fs_extra_1.copy)(exportDetailJson.outDirectory, destDir);
    }
    else {
        await (0, promises_1.mkdir)((0, path_1.join)(destDir, "_next", "static"), { recursive: true });
        await (0, fs_extra_1.copy)((0, path_1.join)(sourceDir, "public"), destDir);
        await (0, fs_extra_1.copy)((0, path_1.join)(sourceDir, distDir, "static"), (0, path_1.join)(destDir, "_next", "static"));
        const serverPagesDir = (0, path_1.join)(sourceDir, distDir, "server", "pages");
        await (0, fs_extra_1.copy)(serverPagesDir, destDir, {
            filter: async (filename) => {
                const status = await (0, promises_1.stat)(filename);
                if (status.isDirectory())
                    return true;
                return (0, path_1.extname)(filename) === ".html";
            },
        });
        const prerenderManifestBuffer = await (0, promises_1.readFile)((0, path_1.join)(sourceDir, distDir, "prerender-manifest.json"));
        const prerenderManifest = JSON.parse(prerenderManifestBuffer.toString());
        for (const route in prerenderManifest.routes) {
            if (prerenderManifest.routes[route]) {
                const parts = route
                    .split("/")
                    .slice(1)
                    .filter((it) => !!it);
                const partsOrIndex = parts.length > 0 ? parts : ["index"];
                const dataPath = `${(0, path_1.join)(...partsOrIndex)}.json`;
                const htmlPath = `${(0, path_1.join)(...partsOrIndex)}.html`;
                await (0, promises_1.mkdir)((0, path_1.join)(destDir, (0, path_1.dirname)(htmlPath)), { recursive: true });
                await (0, promises_1.copyFile)((0, path_1.join)(sourceDir, distDir, "server", "pages", htmlPath), (0, path_1.join)(destDir, htmlPath));
                const dataRoute = prerenderManifest.routes[route].dataRoute;
                await (0, promises_1.mkdir)((0, path_1.join)(destDir, (0, path_1.dirname)(dataRoute)), { recursive: true });
                await (0, promises_1.copyFile)((0, path_1.join)(sourceDir, distDir, "server", "pages", dataPath), (0, path_1.join)(destDir, dataRoute));
            }
        }
    }
}
exports.╔ÁcodegenPublicDirectory = ╔ÁcodegenPublicDirectory;
async function ╔ÁcodegenFunctionsDirectory(sourceDir, destDir) {
    const { distDir } = await getConfig(sourceDir);
    const packageJsonBuffer = await (0, promises_1.readFile)((0, path_1.join)(sourceDir, "package.json"));
    const packageJson = JSON.parse(packageJsonBuffer.toString());
    if ((0, fs_1.existsSync)((0, path_1.join)(sourceDir, "next.config.js"))) {
        let esbuild;
        try {
            esbuild = await Promise.resolve().then(() => require("esbuild"));
        }
        catch (e) {
            logger_1.logger.debug(`Failed to load 'esbuild': ${e}`);
            throw new error_1.FirebaseError(`Unable to find 'esbuild'. Install it into your local dev dependencies with 'npm i --save-dev esbuild''`);
        }
        await esbuild.build({
            bundle: true,
            external: Object.keys(packageJson.dependencies),
            absWorkingDir: sourceDir,
            entryPoints: ["next.config.js"],
            outfile: (0, path_1.join)(destDir, "next.config.js"),
            target: `node${__1.NODE_VERSION}`,
            platform: "node",
        });
    }
    await (0, promises_1.mkdir)((0, path_1.join)(destDir, "public"));
    await (0, fs_extra_1.mkdirp)((0, path_1.join)(destDir, distDir));
    await (0, fs_extra_1.copy)((0, path_1.join)(sourceDir, "public"), (0, path_1.join)(destDir, "public"));
    await (0, fs_extra_1.copy)((0, path_1.join)(sourceDir, distDir), (0, path_1.join)(destDir, distDir));
    return { packageJson, frameworksEntry: "next.js" };
}
exports.╔ÁcodegenFunctionsDirectory = ╔ÁcodegenFunctionsDirectory;
async function getDevModeHandle(dir) {
    const { default: next } = (0, __1.relativeRequire)(dir, "next");
    const nextApp = next({
        dev: true,
        dir,
    });
    const handler = nextApp.getRequestHandler();
    await nextApp.prepare();
    return (req, res, next) => {
        const parsedUrl = (0, url_1.parse)(req.url, true);
        const proxy = (0, __1.createServerResponseProxy)(req, res, next);
        handler(req, proxy, parsedUrl);
    };
}
exports.getDevModeHandle = getDevModeHandle;
async function getConfig(dir) {
    let config = {};
    if ((0, fs_1.existsSync)((0, path_1.join)(dir, "next.config.js"))) {
        const version = getNextVersion(dir);
        if (!version)
            throw new Error("Unable to find the next dep, try NPM installing?");
        if ((0, semver_1.gte)(version, "12.0.0")) {
            const { default: loadConfig } = (0, __1.relativeRequire)(dir, "next/dist/server/config");
            const { PHASE_PRODUCTION_BUILD } = (0, __1.relativeRequire)(dir, "next/constants");
            config = await loadConfig(PHASE_PRODUCTION_BUILD, dir, null);
        }
        else {
            try {
                config = await Promise.resolve().then(() => require((0, url_1.pathToFileURL)((0, path_1.join)(dir, "next.config.js")).toString()));
            }
            catch (e) {
                throw new Error("Unable to load next.config.js.");
            }
        }
    }
    return Object.assign({ distDir: ".next" }, config);
}
//# sourceMappingURL=index.js.map