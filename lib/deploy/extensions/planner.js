"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVersion = exports.want = exports.have = exports.getExtensionSpec = exports.getExtension = exports.getExtensionVersion = void 0;
const semver = require("semver");
const extensionsApi = require("../../extensions/extensionsApi");
const refs = require("../../extensions/refs");
const error_1 = require("../../error");
const extensionsHelper_1 = require("../../extensions/extensionsHelper");
const logger_1 = require("../../logger");
const manifest_1 = require("../../extensions/manifest");
const specHelper_1 = require("../../extensions/emulator/specHelper");
async function getExtensionVersion(i) {
    if (!i.extensionVersion) {
        if (!i.ref) {
            throw new error_1.FirebaseError(`Can't get ExtensionVersion for ${i.instanceId} because it has no ref`);
        }
        i.extensionVersion = await extensionsApi.getExtensionVersion(refs.toExtensionVersionRef(i.ref));
    }
    return i.extensionVersion;
}
exports.getExtensionVersion = getExtensionVersion;
async function getExtension(i) {
    if (!i.ref) {
        throw new error_1.FirebaseError(`Can't get Extension for ${i.instanceId} because it has no ref`);
    }
    if (!i.extension) {
        i.extension = await extensionsApi.getExtension(refs.toExtensionRef(i.ref));
    }
    return i.extension;
}
exports.getExtension = getExtension;
async function getExtensionSpec(i) {
    if (!i.extensionSpec) {
        if (i.ref) {
            const extensionVersion = await getExtensionVersion(i);
            i.extensionSpec = extensionVersion.spec;
        }
        else if (i.localPath) {
            i.extensionSpec = await (0, specHelper_1.readExtensionYaml)(i.localPath);
            i.extensionSpec.postinstallContent = await (0, specHelper_1.readPostinstall)(i.localPath);
        }
        else {
            throw new error_1.FirebaseError("InstanceSpec had no ref or localPath, unable to get extensionSpec");
        }
    }
    return i.extensionSpec;
}
exports.getExtensionSpec = getExtensionSpec;
async function have(projectId) {
    const instances = await extensionsApi.listInstances(projectId);
    return instances.map((i) => {
        const dep = {
            instanceId: i.name.split("/").pop(),
            params: i.config.params,
            allowedEventTypes: i.config.allowedEventTypes,
            eventarcChannel: i.config.eventarcChannel,
            etag: i.etag,
        };
        if (i.config.extensionRef) {
            const ref = refs.parse(i.config.extensionRef);
            dep.ref = ref;
            dep.ref.version = i.config.extensionVersion;
        }
        return dep;
    });
}
exports.have = have;
async function want(args) {
    const instanceSpecs = [];
    const errors = [];
    for (const e of Object.entries(args.extensions)) {
        try {
            const instanceId = e[0];
            const params = (0, manifest_1.readInstanceParam)({
                projectDir: args.projectDir,
                instanceId,
                projectId: args.projectId,
                projectNumber: args.projectNumber,
                aliases: args.aliases,
                checkLocal: args.emulatorMode,
            });
            const autoPopulatedParams = await (0, extensionsHelper_1.getFirebaseProjectParams)(args.projectId, args.emulatorMode);
            const subbedParams = (0, extensionsHelper_1.substituteParams)(params, autoPopulatedParams);
            const allowedEventTypes = subbedParams.ALLOWED_EVENT_TYPES !== undefined
                ? subbedParams.ALLOWED_EVENT_TYPES.split(",").filter((e) => e !== "")
                : undefined;
            const eventarcChannel = subbedParams.EVENTARC_CHANNEL;
            delete subbedParams["EVENTARC_CHANNEL"];
            delete subbedParams["ALLOWED_EVENT_TYPES"];
            if ((0, extensionsHelper_1.isLocalPath)(e[1])) {
                instanceSpecs.push({
                    instanceId,
                    localPath: e[1],
                    params: subbedParams,
                    allowedEventTypes: allowedEventTypes,
                    eventarcChannel: eventarcChannel,
                });
            }
            else {
                const ref = refs.parse(e[1]);
                ref.version = await resolveVersion(ref);
                instanceSpecs.push({
                    instanceId,
                    ref,
                    params: subbedParams,
                    allowedEventTypes: allowedEventTypes,
                    eventarcChannel: eventarcChannel,
                });
            }
        }
        catch (err) {
            logger_1.logger.debug(`Got error reading extensions entry ${e}: ${err}`);
            errors.push(err);
        }
    }
    if (errors.length) {
        const messages = errors.map((err) => `- ${err.message}`).join("\n");
        throw new error_1.FirebaseError(`Errors while reading 'extensions' in 'firebase.json'\n${messages}`);
    }
    return instanceSpecs;
}
exports.want = want;
async function resolveVersion(ref) {
    const extensionRef = refs.toExtensionRef(ref);
    const versions = await extensionsApi.listExtensionVersions(extensionRef);
    if (versions.length === 0) {
        throw new error_1.FirebaseError(`No versions found for ${extensionRef}`);
    }
    if (!ref.version || ref.version === "latest") {
        return versions
            .map((ev) => ev.spec.version)
            .sort(semver.compare)
            .pop();
    }
    const maxSatisfying = semver.maxSatisfying(versions.map((ev) => ev.spec.version), ref.version);
    if (!maxSatisfying) {
        throw new error_1.FirebaseError(`No version of ${extensionRef} matches requested version ${ref.version}`);
    }
    return maxSatisfying;
}
exports.resolveVersion = resolveVersion;
//# sourceMappingURL=planner.js.map