"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseModule = void 0;
const logger_1 = require("../../../../logger");
function parseModule(mod) {
    const module = {
        module: "",
        version: "",
        dependencies: {},
        replaces: {},
    };
    const lines = mod.split("\n");
    let inBlock = undefined;
    for (const line of lines) {
        if (inBlock) {
            const endRequireMatch = /\)/.exec(line);
            if (endRequireMatch) {
                inBlock = undefined;
                continue;
            }
            let regex;
            if (inBlock === module.dependencies) {
                regex = /([^ ]+) ([^ ]+)/;
            }
            else {
                regex = /([^ ]+) => ([^ ]+)/;
            }
            const mapping = regex.exec(line);
            if (mapping) {
                inBlock[mapping[1]] = mapping[2];
                continue;
            }
            if (line.trim()) {
                logger_1.logger.debug("Don't know how to handle line", line, "inside a mod.go require block");
            }
            continue;
        }
        const modMatch = /^module (.*)$/.exec(line);
        if (modMatch) {
            module.module = modMatch[1];
            continue;
        }
        const versionMatch = /^go (\d+\.\d+)$/.exec(line);
        if (versionMatch) {
            module.version = versionMatch[1];
            continue;
        }
        const requireMatch = /^require ([^ ]+) ([^ ]+)/.exec(line);
        if (requireMatch) {
            module.dependencies[requireMatch[1]] = requireMatch[2];
            continue;
        }
        const replaceMatch = /^replace ([^ ]+) => ([^ ]+)$/.exec(line);
        if (replaceMatch) {
            module.replaces[replaceMatch[1]] = replaceMatch[2];
            continue;
        }
        const requireBlockMatch = /^require +\(/.exec(line);
        if (requireBlockMatch) {
            inBlock = module.dependencies;
            continue;
        }
        const replaceBlockMatch = /^replace +\(/.exec(line);
        if (replaceBlockMatch) {
            inBlock = module.replaces;
            continue;
        }
        if (line.trim()) {
            logger_1.logger.debug("Don't know how to handle line", line, "in mod.go");
        }
    }
    return module;
}
exports.parseModule = parseModule;
//# sourceMappingURL=gomod.js.map