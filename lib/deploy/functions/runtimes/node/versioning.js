"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFunctionsSDKVersion = exports.getLatestSDKVersion = exports.getFunctionsSDKVersion = exports.FUNCTIONS_SDK_VERSION_TOO_OLD_WARNING = void 0;
const _ = require("lodash");
const clc = require("colorette");
const semver = require("semver");
const spawn = require("cross-spawn");
const utils = require("../../../../utils");
const logger_1 = require("../../../../logger");
const track_1 = require("../../../../track");
const MIN_SDK_VERSION = "2.0.0";
exports.FUNCTIONS_SDK_VERSION_TOO_OLD_WARNING = clc.bold(clc.yellow("functions: ")) +
    "You must have a " +
    clc.bold("firebase-functions") +
    " version that is at least 2.0.0. Please run " +
    clc.bold("npm i --save firebase-functions@latest") +
    " in the functions folder.";
function getFunctionsSDKVersion(sourceDir) {
    try {
        const child = spawn.sync("npm", ["list", "firebase-functions", "--json=true"], {
            cwd: sourceDir,
            encoding: "utf8",
        });
        if (child.error) {
            logger_1.logger.debug("getFunctionsSDKVersion encountered error:", child.error.stack);
            return;
        }
        const output = JSON.parse(child.stdout);
        return _.get(output, ["dependencies", "firebase-functions", "version"]);
    }
    catch (e) {
        logger_1.logger.debug("getFunctionsSDKVersion encountered error:", e);
        return;
    }
}
exports.getFunctionsSDKVersion = getFunctionsSDKVersion;
function getLatestSDKVersion() {
    const child = spawn.sync("npm", ["show", "firebase-functions", "--json=true"], {
        encoding: "utf8",
    });
    if (child.error) {
        logger_1.logger.debug("checkFunctionsSDKVersion was unable to fetch information from NPM", child.error.stack);
        return;
    }
    const output = JSON.parse(child.stdout);
    if (_.isEmpty(output)) {
        return;
    }
    return _.get(output, ["dist-tags", "latest"]);
}
exports.getLatestSDKVersion = getLatestSDKVersion;
function checkFunctionsSDKVersion(currentVersion) {
    try {
        if (semver.lt(currentVersion, MIN_SDK_VERSION)) {
            void (0, track_1.track)("functions_runtime_notices", "functions_sdk_too_old");
            utils.logWarning(exports.FUNCTIONS_SDK_VERSION_TOO_OLD_WARNING);
        }
        const latest = exports.getLatestSDKVersion();
        if (!latest) {
            return;
        }
        if (semver.eq(currentVersion, latest)) {
            return;
        }
        utils.logWarning(clc.bold(clc.yellow("functions: ")) +
            "package.json indicates an outdated version of firebase-functions. Please upgrade using " +
            clc.bold("npm install --save firebase-functions@latest") +
            " in your functions directory.");
        if (semver.major(currentVersion) < semver.major(latest)) {
            utils.logWarning(clc.bold(clc.yellow("functions: ")) +
                "Please note that there will be breaking changes when you upgrade.");
        }
    }
    catch (e) {
        logger_1.logger.debug("checkFunctionsSDKVersion encountered error:", e);
        return;
    }
}
exports.checkFunctionsSDKVersion = checkFunctionsSDKVersion;
//# sourceMappingURL=versioning.js.map