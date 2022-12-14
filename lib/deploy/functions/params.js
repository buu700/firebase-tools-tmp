"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveParams = exports.ParamValue = exports.isResourceInput = exports.isSelectInput = exports.isTextInput = exports.resolveBoolean = exports.resolveString = exports.resolveInt = void 0;
const logger_1 = require("../../logger");
const error_1 = require("../../error");
const prompt_1 = require("../../prompt");
const functional_1 = require("../../functional");
const secretManager = require("../../gcp/secretManager");
const storage_1 = require("../../gcp/storage");
const cel_1 = require("./cel");
function dependenciesCEL(expr) {
    const deps = [];
    const paramCapture = /{{ params\.(\w+) }}/g;
    let match;
    while ((match = paramCapture.exec(expr)) != null) {
        deps.push(match[1]);
    }
    return deps;
}
function resolveInt(from, paramValues) {
    if (typeof from === "number") {
        return from;
    }
    return (0, cel_1.resolveExpression)("number", from, paramValues);
}
exports.resolveInt = resolveInt;
function resolveString(from, paramValues) {
    let output = from;
    const celCapture = /{{ .+? }}/g;
    const subExprs = from.match(celCapture);
    if (!subExprs || subExprs.length === 0) {
        return output;
    }
    for (const expr of subExprs) {
        const resolved = (0, cel_1.resolveExpression)("string", expr, paramValues);
        output = output.replace(expr, resolved);
    }
    return output;
}
exports.resolveString = resolveString;
function resolveBoolean(from, paramValues) {
    if (typeof from === "boolean") {
        return from;
    }
    return (0, cel_1.resolveExpression)("boolean", from, paramValues);
}
exports.resolveBoolean = resolveBoolean;
function isTextInput(input) {
    return {}.hasOwnProperty.call(input, "text");
}
exports.isTextInput = isTextInput;
function isSelectInput(input) {
    return {}.hasOwnProperty.call(input, "select");
}
exports.isSelectInput = isSelectInput;
function isResourceInput(input) {
    return {}.hasOwnProperty.call(input, "resource");
}
exports.isResourceInput = isResourceInput;
class ParamValue {
    constructor(rawValue, internal, types) {
        this.rawValue = rawValue;
        this.internal = internal;
        this.legalString = types.string || false;
        this.legalBoolean = types.boolean || false;
        this.legalNumber = types.number || false;
    }
    toString() {
        return this.rawValue;
    }
    asString() {
        return this.rawValue;
    }
    asBoolean() {
        return ["true", "y", "yes", "1"].includes(this.rawValue);
    }
    asNumber() {
        return +this.rawValue;
    }
}
exports.ParamValue = ParamValue;
function resolveDefaultCEL(type, expr, currentEnv) {
    const deps = dependenciesCEL(expr);
    const allDepsFound = deps.every((dep) => !!currentEnv[dep]);
    if (!allDepsFound) {
        throw new error_1.FirebaseError("Build specified parameter with un-resolvable default value " +
            expr +
            "; dependencies missing.");
    }
    switch (type) {
        case "boolean":
            return resolveBoolean(expr, currentEnv);
        case "string":
            return resolveString(expr, currentEnv);
        case "int":
            return resolveInt(expr, currentEnv);
        default:
            throw new error_1.FirebaseError("Build specified parameter with default " + expr + " of unsupported type");
    }
}
function canSatisfyParam(param, value) {
    if (param.type === "string") {
        return typeof value === "string";
    }
    else if (param.type === "int") {
        return typeof value === "number" && Number.isInteger(value);
    }
    else if (param.type === "boolean") {
        return typeof value === "boolean";
    }
    else if (param.type === "secret") {
        return false;
    }
    (0, functional_1.assertExhaustive)(param);
}
async function resolveParams(params, firebaseConfig, userEnvs, nonInteractive) {
    const paramValues = populateDefaultParams(firebaseConfig);
    const [resolved, outstanding] = (0, functional_1.partition)(params, (param) => {
        return {}.hasOwnProperty.call(userEnvs, param.name);
    });
    for (const param of resolved) {
        paramValues[param.name] = userEnvs[param.name];
    }
    const [needSecret, needPrompt] = (0, functional_1.partition)(outstanding, (param) => param.type === "secret");
    for (const param of needSecret) {
        await handleSecret(param, firebaseConfig.projectId);
    }
    if (nonInteractive && needPrompt.length > 0) {
        const envNames = outstanding.map((p) => p.name).join(", ");
        throw new error_1.FirebaseError(`In non-interactive mode but have no value for the following environment variables: ${envNames}\n` +
            "To continue, either run `firebase deploy` with an interactive terminal, or add values to a dotenv file. " +
            "For information regarding how to use dotenv files, see https://firebase.google.com/docs/functions/config-env");
    }
    for (const param of needPrompt) {
        const promptable = param;
        let paramDefault = promptable.default;
        if (paramDefault && (0, cel_1.isCelExpression)(paramDefault)) {
            paramDefault = resolveDefaultCEL(param.type, paramDefault, paramValues);
        }
        if (paramDefault && !canSatisfyParam(param, paramDefault)) {
            throw new error_1.FirebaseError("Parameter " + param.name + " has default value " + paramDefault + " of wrong type");
        }
        paramValues[param.name] = await promptParam(param, firebaseConfig.projectId, paramDefault);
    }
    return paramValues;
}
exports.resolveParams = resolveParams;
function populateDefaultParams(config) {
    const defaultParams = {};
    if (config.databaseURL !== "") {
        defaultParams["DATABASE_URL"] = new ParamValue(config.databaseURL, true, {
            string: true,
            boolean: false,
            number: false,
        });
    }
    defaultParams["PROJECT_ID"] = new ParamValue(config.projectId, true, {
        string: true,
        boolean: false,
        number: false,
    });
    defaultParams["GCLOUD_PROJECT"] = new ParamValue(config.projectId, true, {
        string: true,
        boolean: false,
        number: false,
    });
    if (config.storageBucket !== "") {
        defaultParams["STORAGE_BUCKET"] = new ParamValue(config.storageBucket, true, {
            string: true,
            boolean: false,
            number: false,
        });
    }
    return defaultParams;
}
async function handleSecret(secretParam, projectId) {
    const metadata = await secretManager.getSecretMetadata(projectId, secretParam.name, "latest");
    if (!metadata.secret) {
        throw new error_1.FirebaseError(`Your project currently doesn't have any secret named ${secretParam.name}. Create one by running firebase functions:secrets:set ${secretParam.name} command and try the deploy again.`);
    }
    else if (!metadata.secretVersion) {
        throw new error_1.FirebaseError(`Cloud Secret Manager has no latest version of the secret defined by param ${secretParam.label || secretParam.name}`);
    }
    else if (metadata.secretVersion.state === "DESTROYED" ||
        metadata.secretVersion.state === "DISABLED") {
        throw new error_1.FirebaseError(`Cloud Secret Manager's latest version of secret '${secretParam.label || secretParam.name} is in illegal state ${metadata.secretVersion.state}`);
    }
}
async function promptParam(param, projectId, resolvedDefault) {
    if (param.type === "string") {
        const provided = await promptStringParam(param, projectId, resolvedDefault);
        return new ParamValue(provided.toString(), false, { string: true });
    }
    else if (param.type === "int") {
        const provided = await promptIntParam(param, resolvedDefault);
        return new ParamValue(provided.toString(), false, { number: true });
    }
    else if (param.type === "boolean") {
        const provided = await promptBooleanParam(param, resolvedDefault);
        return new ParamValue(provided.toString(), false, { boolean: true });
    }
    else if (param.type === "secret") {
        throw new error_1.FirebaseError(`Somehow ended up trying to interactively prompt for secret parameter ${param.name}, which should never happen.`);
    }
    (0, functional_1.assertExhaustive)(param);
}
async function promptBooleanParam(param, resolvedDefault) {
    if (!param.input) {
        const defaultToText = { text: {} };
        param.input = defaultToText;
    }
    const isTruthyInput = (res) => ["true", "y", "yes", "1"].includes(res.toLowerCase());
    let prompt;
    if (isSelectInput(param.input)) {
        prompt = `Select a value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        prompt += "\nSelect an option with the arrow keys, and use Enter to confirm your choice. ";
        return promptSelect(prompt, param.input, resolvedDefault, isTruthyInput);
    }
    else if (isTextInput(param.input)) {
        prompt = `Enter a boolean value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        return promptText(prompt, param.input, resolvedDefault, isTruthyInput);
    }
    else if (isResourceInput(param.input)) {
        throw new error_1.FirebaseError("Boolean params cannot have Cloud Resource selector inputs");
    }
    else {
        (0, functional_1.assertExhaustive)(param.input);
    }
}
async function promptStringParam(param, projectId, resolvedDefault) {
    if (!param.input) {
        const defaultToText = { text: {} };
        param.input = defaultToText;
    }
    let prompt;
    if (isResourceInput(param.input)) {
        prompt = `Select a value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        return promptResourceString(prompt, param.input, projectId, resolvedDefault);
    }
    else if (isSelectInput(param.input)) {
        prompt = `Select a value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        prompt += "\nSelect an option with the arrow keys, and use Enter to confirm your choice. ";
        return promptSelect(prompt, param.input, resolvedDefault, (res) => res);
    }
    else if (isTextInput(param.input)) {
        prompt = `Enter a string value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        return promptText(prompt, param.input, resolvedDefault, (res) => res);
    }
    else {
        (0, functional_1.assertExhaustive)(param.input);
    }
}
async function promptIntParam(param, resolvedDefault) {
    if (!param.input) {
        const defaultToText = { text: {} };
        param.input = defaultToText;
    }
    let prompt;
    if (isSelectInput(param.input)) {
        prompt = `Select a value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        prompt += "\nSelect an option with the arrow keys, and use Enter to confirm your choice. ";
        return promptSelect(prompt, param.input, resolvedDefault, (res) => {
            if (isNaN(+res)) {
                return { message: `"${res}" could not be converted to a number.` };
            }
            if (res.includes(".")) {
                return { message: `${res} is not an integer value.` };
            }
            return +res;
        });
    }
    if (isTextInput(param.input)) {
        prompt = `Enter an integer value for ${param.label || param.name}:`;
        if (param.description) {
            prompt += ` \n(${param.description})`;
        }
        return promptText(prompt, param.input, resolvedDefault, (res) => {
            if (isNaN(+res)) {
                return { message: `"${res}" could not be converted to a number.` };
            }
            if (res.includes(".")) {
                return { message: `${res} is not an integer value.` };
            }
            return +res;
        });
    }
    else if (isResourceInput(param.input)) {
        throw new error_1.FirebaseError("Numeric params cannot have Cloud Resource selector inputs");
    }
    else {
        (0, functional_1.assertExhaustive)(param.input);
    }
}
async function promptResourceString(prompt, input, projectId, resolvedDefault) {
    const notFound = new error_1.FirebaseError(`No instances of ${input.resource.type} found.`);
    switch (input.resource.type) {
        case "storage.googleapis.com/Bucket":
            const buckets = await (0, storage_1.listBuckets)(projectId);
            if (buckets.length === 0) {
                throw notFound;
            }
            const forgedInput = {
                select: {
                    options: buckets.map((bucketName) => {
                        return { label: bucketName, value: bucketName };
                    }),
                },
            };
            return promptSelect(prompt, forgedInput, resolvedDefault, (res) => res);
        default:
            logger_1.logger.warn(`Warning: unknown resource type ${input.resource.type}; defaulting to raw text input...`);
            return promptText(prompt, { text: {} }, resolvedDefault, (res) => res);
    }
}
async function promptText(prompt, input, resolvedDefault, converter) {
    const res = await (0, prompt_1.promptOnce)({
        type: "input",
        default: resolvedDefault,
        message: prompt,
    });
    if (input.text.validationRegex) {
        const userRe = new RegExp(input.text.validationRegex);
        if (!userRe.test(res)) {
            logger_1.logger.error(input.text.validationErrorMessage ||
                `Input did not match provided validator ${userRe.toString()}, retrying...`);
            return promptText(prompt, input, resolvedDefault, converter);
        }
    }
    const converted = converter(res);
    if (typeof converted === "object") {
        logger_1.logger.error(converted.message);
        return promptText(prompt, input, resolvedDefault, converter);
    }
    return converted;
}
async function promptSelect(prompt, input, resolvedDefault, converter) {
    const response = await (0, prompt_1.promptOnce)({
        name: "input",
        type: "list",
        default: resolvedDefault,
        message: prompt,
        choices: input.select.options.map((option) => {
            return {
                checked: false,
                name: option.label,
                value: option.value.toString(),
            };
        }),
    });
    const converted = converter(response);
    if (typeof converted === "object") {
        logger_1.logger.error(converted.message);
        return promptSelect(prompt, input, resolvedDefault, converter);
    }
    return converted;
}
//# sourceMappingURL=params.js.map