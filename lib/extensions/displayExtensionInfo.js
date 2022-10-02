"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieveRoleInfo = exports.printSourceDownloadLink = exports.displayExtInfo = void 0;
const clc = require("colorette");
const { marked } = require("marked");
const TerminalRenderer = require("marked-terminal");
const utils = require("../utils");
const extensionsHelper_1 = require("./extensionsHelper");
const logger_1 = require("../logger");
const error_1 = require("../error");
const iam = require("../gcp/iam");
marked.setOptions({
    renderer: new TerminalRenderer(),
});
async function displayExtInfo(extensionName, publisher, spec, published = false) {
    var _a, _b;
    const lines = [];
    lines.push(`**Name**: ${spec.displayName}`);
    if (publisher) {
        lines.push(`**Publisher**: ${publisher}`);
    }
    if (spec.description) {
        lines.push(`**Description**: ${spec.description}`);
    }
    if (published) {
        if (spec.license) {
            lines.push(`**License**: ${spec.license}`);
        }
        lines.push(`**Source code**: ${spec.sourceUrl}`);
    }
    if ((_a = spec.apis) === null || _a === void 0 ? void 0 : _a.length) {
        lines.push(displayApis(spec.apis));
    }
    if ((_b = spec.roles) === null || _b === void 0 ? void 0 : _b.length) {
        lines.push(await displayRoles(spec.roles));
    }
    if (lines.length > 0) {
        utils.logLabeledBullet(extensionsHelper_1.logPrefix, `information about '${clc.bold(extensionName)}':`);
        const infoStr = lines.join("\n");
        const formatted = marked(infoStr).replace(/\n+$/, "\n");
        logger_1.logger.info(formatted);
        return lines;
    }
    else {
        throw new error_1.FirebaseError("Error occurred during installation: cannot parse info from source spec", {
            context: {
                spec: spec,
                extensionName: extensionName,
            },
        });
    }
}
exports.displayExtInfo = displayExtInfo;
function printSourceDownloadLink(sourceDownloadUri) {
    const sourceDownloadMsg = `Want to review the source code that will be installed? Download it here: ${sourceDownloadUri}`;
    utils.logBullet(marked(sourceDownloadMsg));
}
exports.printSourceDownloadLink = printSourceDownloadLink;
async function retrieveRoleInfo(role) {
    const res = await iam.getRole(role);
    return `  ${res.title} (${res.description})`;
}
exports.retrieveRoleInfo = retrieveRoleInfo;
async function displayRoles(roles) {
    const lines = await Promise.all(roles.map((role) => {
        return retrieveRoleInfo(role.role);
    }));
    return clc.bold("**Roles granted to this Extension**:\n") + lines.join("\n");
}
function displayApis(apis) {
    const lines = apis.map((api) => {
        return `  ${api.apiName} (${api.reason})`;
    });
    return "**APIs used by this Extension**:\n" + lines.join("\n");
}
//# sourceMappingURL=displayExtensionInfo.js.map