"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ɵcodegenFunctionsDirectory = exports.ɵcodegenPublicDirectory = exports.build = exports.discover = exports.type = exports.support = exports.name = void 0;
const fs_extra_1 = require("fs-extra");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const semver_1 = require("semver");
const __1 = require("..");
exports.name = "Nuxt";
exports.support = "expirimental";
exports.type = 4;
async function discover(dir) {
    if (!(await (0, fs_extra_1.pathExists)((0, path_1.join)(dir, "package.json"))))
        return;
    const nuxtDependency = (0, __1.findDependency)("nuxt", { cwd: dir, depth: 0, omitDev: false });
    const configFilesExist = await Promise.all([
        (0, fs_extra_1.pathExists)((0, path_1.join)(dir, "nuxt.config.js")),
        (0, fs_extra_1.pathExists)((0, path_1.join)(dir, "nuxt.config.ts")),
    ]);
    const anyConfigFileExists = configFilesExist.some((it) => it);
    if (!anyConfigFileExists && !nuxtDependency)
        return;
    return { mayWantBackend: true };
}
exports.discover = discover;
async function build(root) {
    const { buildNuxt } = await (0, __1.relativeRequire)(root, "@nuxt/kit");
    const nuxtApp = await getNuxtApp(root);
    await buildNuxt(nuxtApp);
    return { wantsBackend: true };
}
exports.build = build;
async function getNuxtApp(cwd) {
    const { loadNuxt } = await (0, __1.relativeRequire)(cwd, "@nuxt/kit");
    return await loadNuxt({
        cwd,
        overrides: {
            nitro: { preset: "node" },
        },
    });
}
function isNuxt3(cwd) {
    const { version } = (0, __1.findDependency)("nuxt", { cwd, depth: 0, omitDev: false });
    return (0, semver_1.gte)(version, "3.0.0-0");
}
async function ɵcodegenPublicDirectory(root, dest) {
    const app = await getNuxtApp(root);
    const distPath = isNuxt3(root) ? (0, path_1.join)(root, ".output", "public") : app.options.generate.dir;
    await (0, fs_extra_1.copy)(distPath, dest);
}
exports.ɵcodegenPublicDirectory = ɵcodegenPublicDirectory;
async function ɵcodegenFunctionsDirectory(sourceDir, destDir) {
    const packageJsonBuffer = await (0, promises_1.readFile)((0, path_1.join)(sourceDir, "package.json"));
    const packageJson = JSON.parse(packageJsonBuffer.toString());
    if (isNuxt3(sourceDir)) {
        const outputPackageJsonBuffer = await (0, promises_1.readFile)((0, path_1.join)(sourceDir, ".output", "server", "package.json"));
        const outputPackageJson = JSON.parse(outputPackageJsonBuffer.toString());
        await (0, fs_extra_1.copy)((0, path_1.join)(sourceDir, ".output", "server"), destDir);
        return { packageJson: Object.assign(Object.assign({}, packageJson), outputPackageJson), frameworksEntry: "nuxt3" };
    }
    else {
        const { options: { buildDir }, } = await getNuxtApp(sourceDir);
        await (0, fs_extra_1.copy)(buildDir, (0, path_1.join)(destDir, (0, path_1.basename)(buildDir)));
        return { packageJson };
    }
}
exports.ɵcodegenFunctionsDirectory = ɵcodegenFunctionsDirectory;
//# sourceMappingURL=index.js.map