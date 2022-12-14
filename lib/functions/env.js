"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadFirebaseEnvs = exports.loadUserEnvs = exports.writeUserEnvs = exports.hasUserEnvs = exports.parseStrict = exports.validateKey = exports.KeyValidationError = exports.parse = void 0;
const clc = require("colorette");
const fs = require("fs");
const path = require("path");
const error_1 = require("../error");
const logger_1 = require("../logger");
const utils_1 = require("../utils");
const FUNCTIONS_EMULATOR_DOTENV = ".env.local";
const RESERVED_PREFIXES = ["X_GOOGLE_", "FIREBASE_", "EXT_"];
const RESERVED_KEYS = [
    "FIREBASE_CONFIG",
    "CLOUD_RUNTIME_CONFIG",
    "EVENTARC_CLOUD_EVENT_SOURCE",
    "ENTRY_POINT",
    "GCP_PROJECT",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "FUNCTION_TRIGGER_TYPE",
    "FUNCTION_NAME",
    "FUNCTION_MEMORY_MB",
    "FUNCTION_TIMEOUT_SEC",
    "FUNCTION_IDENTITY",
    "FUNCTION_REGION",
    "FUNCTION_TARGET",
    "FUNCTION_SIGNATURE_TYPE",
    "K_SERVICE",
    "K_REVISION",
    "PORT",
    "K_CONFIGURATION",
];
const LINE_RE = new RegExp("^" +
    "\\s*" +
    "(\\w+)" +
    "\\s*=[\\f\\t\\v]*" +
    "(" +
    "\\s*'(?:\\\\'|[^'])*'|" +
    '\\s*"(?:\\\\"|[^"])*"|' +
    "[^#\\r\\n]*" +
    ")?" +
    "\\s*" +
    "(?:#[^\\n]*)?" +
    "$", "gms");
const ESCAPE_SEQUENCES_TO_CHARACTERS = {
    "\\n": "\n",
    "\\r": "\r",
    "\\t": "\t",
    "\\v": "\v",
    "\\\\": "\\",
    "\\'": "'",
    '\\"': '"',
};
const ALL_ESCAPE_SEQUENCES_RE = /\\[nrtv\\'"]/g;
const CHARACTERS_TO_ESCAPE_SEQUENCES = {
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\v": "\\v",
    "\\": "\\\\",
    "'": "\\'",
    '"': '\\"',
};
const ALL_ESCAPABLE_CHARACTERS_RE = /[\n\r\t\v\\'"]/g;
function parse(data) {
    const envs = {};
    const errors = [];
    data = data.replace(/\r\n?/, "\n");
    let match;
    while ((match = LINE_RE.exec(data))) {
        let [, k, v] = match;
        v = (v || "").trim();
        let quotesMatch;
        if ((quotesMatch = /^(["'])(.*)\1$/ms.exec(v)) != null) {
            v = quotesMatch[2];
            if (quotesMatch[1] === '"') {
                v = v.replace(ALL_ESCAPE_SEQUENCES_RE, (match) => ESCAPE_SEQUENCES_TO_CHARACTERS[match]);
            }
        }
        envs[k] = v;
    }
    const nonmatches = data.replace(LINE_RE, "");
    for (let line of nonmatches.split(/[\r\n]+/)) {
        line = line.trim();
        if (line.startsWith("#")) {
            continue;
        }
        if (line.length)
            errors.push(line);
    }
    return { envs, errors };
}
exports.parse = parse;
class KeyValidationError extends Error {
    constructor(key, message) {
        super(`Failed to validate key ${key}: ${message}`);
        this.key = key;
        this.message = message;
    }
}
exports.KeyValidationError = KeyValidationError;
function validateKey(key) {
    if (RESERVED_KEYS.includes(key)) {
        throw new KeyValidationError(key, `Key ${key} is reserved for internal use.`);
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        throw new KeyValidationError(key, `Key ${key} must start with an uppercase ASCII letter or underscore` +
            ", and then consist of uppercase ASCII letters, digits, and underscores.");
    }
    if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        throw new KeyValidationError(key, `Key ${key} starts with a reserved prefix (${RESERVED_PREFIXES.join(" ")})`);
    }
}
exports.validateKey = validateKey;
function parseStrict(data) {
    const { envs, errors } = parse(data);
    if (errors.length) {
        throw new error_1.FirebaseError(`Invalid dotenv file, error on lines: ${errors.join(",")}`);
    }
    const validationErrors = [];
    for (const key of Object.keys(envs)) {
        try {
            validateKey(key);
        }
        catch (err) {
            logger_1.logger.debug(`Failed to validate key ${key}: ${err}`);
            if (err instanceof KeyValidationError) {
                validationErrors.push(err);
            }
            else {
                throw err;
            }
        }
    }
    if (validationErrors.length > 0) {
        throw new error_1.FirebaseError("Validation failed", { children: validationErrors });
    }
    return envs;
}
exports.parseStrict = parseStrict;
function findEnvfiles(functionsSource, projectId, projectAlias, isEmulator) {
    const files = [".env"];
    files.push(`.env.${projectId}`);
    if (projectAlias) {
        files.push(`.env.${projectAlias}`);
    }
    if (isEmulator) {
        files.push(FUNCTIONS_EMULATOR_DOTENV);
    }
    return files
        .map((f) => path.join(functionsSource, f))
        .filter(fs.existsSync)
        .map((p) => path.basename(p));
}
function hasUserEnvs({ functionsSource, projectId, projectAlias, isEmulator, }) {
    return findEnvfiles(functionsSource, projectId, projectAlias, isEmulator).length > 0;
}
exports.hasUserEnvs = hasUserEnvs;
function writeUserEnvs(toWrite, envOpts) {
    if (Object.keys(toWrite).length === 0) {
        return;
    }
    const { functionsSource, projectId, projectAlias, isEmulator } = envOpts;
    const envFiles = findEnvfiles(functionsSource, projectId, projectAlias, isEmulator);
    const projectScopedFileName = `.env.${projectId}`;
    const projectScopedFileExists = envFiles.includes(projectScopedFileName);
    if (!projectScopedFileExists) {
        createEnvFile(envOpts);
    }
    const currentEnvs = loadUserEnvs(envOpts);
    for (const k of Object.keys(toWrite)) {
        validateKey(k);
        if (currentEnvs.hasOwnProperty(k)) {
            throw new error_1.FirebaseError(`Attempted to write param-defined key ${k} to .env files, but it was already defined.`);
        }
    }
    (0, utils_1.logBullet)(clc.cyan(clc.bold("functions: ")) +
        `Writing new parameter values to disk: ${projectScopedFileName}`);
    for (const k of Object.keys(toWrite)) {
        fs.appendFileSync(path.join(functionsSource, projectScopedFileName), formatUserEnvForWrite(k, toWrite[k]));
    }
}
exports.writeUserEnvs = writeUserEnvs;
function createEnvFile(envOpts) {
    const fileToWrite = envOpts.isEmulator ? FUNCTIONS_EMULATOR_DOTENV : `.env.${envOpts.projectId}`;
    logger_1.logger.debug(`Creating ${fileToWrite}...`);
    fs.writeFileSync(path.join(envOpts.functionsSource, fileToWrite), "", { flag: "wx" });
    return fileToWrite;
}
function formatUserEnvForWrite(key, value) {
    const escapedValue = value.replace(ALL_ESCAPABLE_CHARACTERS_RE, (match) => CHARACTERS_TO_ESCAPE_SEQUENCES[match]);
    if (escapedValue !== value) {
        return `${key}="${escapedValue}"\n`;
    }
    return `${key}=${escapedValue}\n`;
}
function loadUserEnvs({ functionsSource, projectId, projectAlias, isEmulator, }) {
    var _a;
    const envFiles = findEnvfiles(functionsSource, projectId, projectAlias, isEmulator);
    if (envFiles.length === 0) {
        return {};
    }
    if (projectAlias) {
        if (envFiles.includes(`.env.${projectId}`) && envFiles.includes(`.env.${projectAlias}`)) {
            throw new error_1.FirebaseError(`Can't have both dotenv files with projectId (env.${projectId}) ` +
                `and projectAlias (.env.${projectAlias}) as extensions.`);
        }
    }
    let envs = {};
    for (const f of envFiles) {
        try {
            const data = fs.readFileSync(path.join(functionsSource, f), "utf8");
            envs = Object.assign(Object.assign({}, envs), parseStrict(data));
        }
        catch (err) {
            throw new error_1.FirebaseError(`Failed to load environment variables from ${f}.`, {
                exit: 2,
                children: ((_a = err.children) === null || _a === void 0 ? void 0 : _a.length) > 0 ? err.children : [err],
            });
        }
    }
    (0, utils_1.logBullet)(clc.cyan(clc.bold("functions: ")) + `Loaded environment variables from ${envFiles.join(", ")}.`);
    return envs;
}
exports.loadUserEnvs = loadUserEnvs;
function loadFirebaseEnvs(firebaseConfig, projectId) {
    return {
        FIREBASE_CONFIG: JSON.stringify(firebaseConfig),
        GCLOUD_PROJECT: projectId,
    };
}
exports.loadFirebaseEnvs = loadFirebaseEnvs;
//# sourceMappingURL=env.js.map