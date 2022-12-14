"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeVersion = exports.getFunctionProperties = exports.getFunctionResourcesWithParamSubstitution = exports.readFileFromDirectory = exports.readPostinstall = exports.readExtensionYaml = void 0;
const yaml = require("js-yaml");
const path = require("path");
const fs = require("fs-extra");
const error_1 = require("../../error");
const extensionsHelper_1 = require("../extensionsHelper");
const functionsEmulatorUtils_1 = require("../../emulator/functionsEmulatorUtils");
const SPEC_FILE = "extension.yaml";
const POSTINSTALL_FILE = "POSTINSTALL.md";
const validFunctionTypes = [
    "firebaseextensions.v1beta.function",
    "firebaseextensions.v1beta.scheduledFunction",
];
function wrappedSafeLoad(source) {
    try {
        return yaml.safeLoad(source);
    }
    catch (err) {
        if (err instanceof yaml.YAMLException) {
            throw new error_1.FirebaseError(`YAML Error: ${err.message}`, { original: err });
        }
        throw err;
    }
}
async function readExtensionYaml(directory) {
    const extensionYaml = await readFileFromDirectory(directory, SPEC_FILE);
    const source = extensionYaml.source;
    return wrappedSafeLoad(source);
}
exports.readExtensionYaml = readExtensionYaml;
async function readPostinstall(directory) {
    const content = await readFileFromDirectory(directory, POSTINSTALL_FILE);
    return content.source;
}
exports.readPostinstall = readPostinstall;
function readFileFromDirectory(directory, file) {
    return new Promise((resolve, reject) => {
        fs.readFile(path.resolve(directory, file), "utf8", (err, data) => {
            if (err) {
                if (err.code === "ENOENT") {
                    return reject(new error_1.FirebaseError(`Could not find "${file}" in "${directory}"`, { original: err }));
                }
                reject(new error_1.FirebaseError(`Failed to read file "${file}" in "${directory}"`, { original: err }));
            }
            else {
                resolve(data);
            }
        });
    }).then((source) => {
        return {
            source,
            sourceDirectory: directory,
        };
    });
}
exports.readFileFromDirectory = readFileFromDirectory;
function getFunctionResourcesWithParamSubstitution(extensionSpec, params) {
    const rawResources = extensionSpec.resources.filter((resource) => validFunctionTypes.includes(resource.type));
    return (0, extensionsHelper_1.substituteParams)(rawResources, params);
}
exports.getFunctionResourcesWithParamSubstitution = getFunctionResourcesWithParamSubstitution;
function getFunctionProperties(resources) {
    return resources.map((r) => r.properties);
}
exports.getFunctionProperties = getFunctionProperties;
function getNodeVersion(resources) {
    const invalidRuntimes = [];
    const versions = resources.map((r) => {
        var _a, _b;
        if ((_a = r.properties) === null || _a === void 0 ? void 0 : _a.runtime) {
            const runtimeName = (_b = r.properties) === null || _b === void 0 ? void 0 : _b.runtime;
            const runtime = (0, functionsEmulatorUtils_1.parseRuntimeVersion)(runtimeName);
            if (!runtime) {
                invalidRuntimes.push(runtimeName);
            }
            else {
                return runtime;
            }
        }
        return 14;
    });
    if (invalidRuntimes.length) {
        throw new error_1.FirebaseError(`The following runtimes are not supported by the Emulator Suite: ${invalidRuntimes.join(", ")}. \n Only Node runtimes are supported.`);
    }
    return Math.max(...versions);
}
exports.getNodeVersion = getNodeVersion;
//# sourceMappingURL=specHelper.js.map