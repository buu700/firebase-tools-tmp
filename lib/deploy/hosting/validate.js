"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDeploy = void 0;
const path = require("path");
const clc = require("colorette");
const error_1 = require("../../error");
const projectPath_1 = require("../../projectPath");
const fsutils_1 = require("../../fsutils");
const utils_1 = require("../../utils");
function validateDeploy(deploy, options) {
    var _a, _b, _c;
    const cfg = deploy.config;
    const hasPublicDir = !!cfg.public;
    const hasAnyStaticRewrites = !!((_a = (cfg.rewrites || []).filter((rw) => rw.destination)) === null || _a === void 0 ? void 0 : _a.length);
    const hasAnyDynamicRewrites = !!((_b = (cfg.rewrites || []).filter((rw) => !rw.destination)) === null || _b === void 0 ? void 0 : _b.length);
    const hasAnyRedirects = !!((_c = cfg.redirects) === null || _c === void 0 ? void 0 : _c.length);
    if (!hasPublicDir && hasAnyStaticRewrites) {
        throw new error_1.FirebaseError('Must supply a "public" directory when using "destination" rewrites.');
    }
    if (!hasPublicDir && !hasAnyDynamicRewrites && !hasAnyRedirects) {
        throw new error_1.FirebaseError('Must supply a "public" directory or at least one rewrite or redirect in each "hosting" config.');
    }
    if (hasPublicDir && !(0, fsutils_1.dirExistsSync)((0, projectPath_1.resolveProjectPath)(options, cfg.public))) {
        throw new error_1.FirebaseError(`Specified "public" directory "${cfg.public}" does not exist, can't deploy hosting to site "${deploy.site}"`);
    }
    if (cfg.i18n) {
        if (!hasPublicDir) {
            throw new error_1.FirebaseError('Must supply a "public" directory when using "i18n" configuration.');
        }
        if (!cfg.i18n.root) {
            throw new error_1.FirebaseError('Must supply a "root" in "i18n" config.');
        }
        else {
            const i18nPath = path.join(cfg.public, cfg.i18n.root);
            if (!(0, fsutils_1.dirExistsSync)((0, projectPath_1.resolveProjectPath)(options, i18nPath))) {
                (0, utils_1.logLabeledWarning)("hosting", `Couldn't find specified i18n root directory ${clc.bold(cfg.i18n.root)} in public directory ${clc.bold(cfg.public || "")}.`);
            }
        }
    }
}
exports.validateDeploy = validateDeploy;
//# sourceMappingURL=validate.js.map