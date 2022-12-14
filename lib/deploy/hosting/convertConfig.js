"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertConfig = void 0;
const error_1 = require("../../error");
const backend_1 = require("../functions/backend");
const backend = require("../functions/backend");
const utils_1 = require("../../utils");
function has(obj, k) {
    return obj[k] !== undefined;
}
function extractPattern(type, spec) {
    let glob = "";
    let regex = "";
    if ("source" in spec) {
        glob = spec.source;
    }
    if ("glob" in spec) {
        glob = spec.glob;
    }
    if ("regex" in spec) {
        regex = spec.regex;
    }
    if (glob && regex) {
        throw new error_1.FirebaseError(`Cannot specify a ${type} pattern with both a glob and regex.`);
    }
    else if (glob) {
        return { glob: glob };
    }
    else if (regex) {
        return { regex: regex };
    }
    throw new error_1.FirebaseError(`Cannot specify a ${type} with no pattern (either a glob or regex required).`);
}
async function convertConfig(context, payload, config, finalize) {
    if (Array.isArray(config)) {
        throw new error_1.FirebaseError(`convertConfig should be given a single configuration, not an array.`, {
            exit: 2,
        });
    }
    const out = {};
    if (!config) {
        return out;
    }
    const endpointFromBackend = (targetBackend, functionsEndpointInfo) => {
        const backendsForId = backend.allEndpoints(targetBackend).filter((endpoint) => {
            return endpoint.id === functionsEndpointInfo.serviceId;
        });
        const matchingBackends = backendsForId.filter((endpoint) => {
            return ((!functionsEndpointInfo.region || endpoint.region === functionsEndpointInfo.region) &&
                (!functionsEndpointInfo.platform || endpoint.platform === functionsEndpointInfo.platform));
        });
        if (matchingBackends.length > 1) {
            for (const endpoint of matchingBackends) {
                if (endpoint.region === "us-central1") {
                    (0, utils_1.logLabeledBullet)(`hosting[${config.site}]`, `Function \`${functionsEndpointInfo.serviceId}\` found in multiple regions, defaulting to \`us-central1\`. ` +
                        `To rewrite to a different region, specify a \`region\` for the rewrite in \`firebase.json\`.`);
                    return endpoint;
                }
            }
            throw new error_1.FirebaseError(`More than one backend found for function name: ${functionsEndpointInfo.serviceId}. If the function is deployed in multiple regions, you must specify a region.`);
        }
        if (matchingBackends.length === 1) {
            const endpoint = matchingBackends[0];
            if (endpoint && ((0, backend_1.isHttpsTriggered)(endpoint) || (0, backend_1.isCallableTriggered)(endpoint))) {
                return endpoint;
            }
        }
        return;
    };
    const endpointBeingDeployed = (functionsEndpointInfo) => {
        for (const { wantBackend } of Object.values(payload.functions || {})) {
            if (!wantBackend) {
                continue;
            }
            const endpoint = endpointFromBackend(wantBackend, functionsEndpointInfo);
            if (endpoint) {
                return endpoint;
            }
        }
        return;
    };
    const matchingEndpoint = async (functionsEndpointInfo) => {
        const pendingEndpoint = endpointBeingDeployed(functionsEndpointInfo);
        if (pendingEndpoint)
            return pendingEndpoint;
        const backend = await (0, backend_1.existingBackend)(context);
        return (0, backend_1.allEndpoints)(backend).find((it) => (0, backend_1.isHttpsTriggered)(it) &&
            it.id === functionsEndpointInfo.serviceId &&
            (!functionsEndpointInfo.platform || it.platform === functionsEndpointInfo.platform) &&
            (!functionsEndpointInfo.region || it.region === functionsEndpointInfo.region));
    };
    const findEndpointWithValidRegion = async (rewrite, context) => {
        if ("function" in rewrite) {
            const foundEndpointToBeDeployed = endpointBeingDeployed({
                serviceId: rewrite.function,
                region: rewrite.region,
            });
            if (foundEndpointToBeDeployed) {
                return foundEndpointToBeDeployed;
            }
            const existingBackend = await backend.existingBackend(context);
            const endpointAlreadyDeployed = endpointFromBackend(existingBackend, {
                serviceId: rewrite.function,
                region: rewrite.region,
            });
            if (endpointAlreadyDeployed) {
                return endpointAlreadyDeployed;
            }
        }
        return;
    };
    if (Array.isArray(config.rewrites)) {
        out.rewrites = [];
        for (const rewrite of config.rewrites) {
            const vRewrite = extractPattern("rewrite", rewrite);
            if ("destination" in rewrite) {
                vRewrite.path = rewrite.destination;
            }
            else if ("function" in rewrite) {
                if (!finalize &&
                    endpointBeingDeployed({
                        serviceId: rewrite.function,
                        platform: "gcfv2",
                        region: rewrite.region,
                    })) {
                    continue;
                }
                const endpoint = await matchingEndpoint({
                    serviceId: rewrite.function,
                    platform: "gcfv2",
                    region: rewrite.region,
                });
                if (endpoint) {
                    vRewrite.run = { serviceId: endpoint.id, region: endpoint.region };
                }
                else {
                    vRewrite.function = rewrite.function;
                    const foundEndpoint = await findEndpointWithValidRegion(rewrite, context);
                    if (foundEndpoint) {
                        vRewrite.functionRegion = foundEndpoint.region;
                    }
                    else {
                        if (rewrite.region && rewrite.region !== "us-central1") {
                            throw new error_1.FirebaseError(`Unable to find a valid endpoint for function \`${vRewrite.function}\``);
                        }
                        (0, utils_1.logLabeledWarning)(`hosting[${config.site}]`, `Unable to find a valid endpoint for function \`${vRewrite.function}\`, but still including it in the config`);
                    }
                }
            }
            else if ("dynamicLinks" in rewrite) {
                vRewrite.dynamicLinks = rewrite.dynamicLinks;
            }
            else if ("run" in rewrite) {
                if (!finalize &&
                    endpointBeingDeployed({
                        serviceId: rewrite.run.serviceId,
                        platform: "gcfv2",
                        region: rewrite.run.region,
                    })) {
                    continue;
                }
                vRewrite.run = Object.assign({ region: "us-central1" }, rewrite.run);
            }
            out.rewrites.push(vRewrite);
        }
    }
    if (Array.isArray(config.redirects)) {
        out.redirects = config.redirects.map((redirect) => {
            const vRedirect = extractPattern("redirect", redirect);
            vRedirect.location = redirect.destination;
            if (redirect.type) {
                vRedirect.statusCode = redirect.type;
            }
            return vRedirect;
        });
    }
    if (Array.isArray(config.headers)) {
        out.headers = config.headers.map((header) => {
            const vHeader = extractPattern("header", header);
            vHeader.headers = {};
            if (Array.isArray(header.headers) && header.headers.length) {
                header.headers.forEach((h) => {
                    vHeader.headers[h.key] = h.value;
                });
            }
            return vHeader;
        });
    }
    if (has(config, "cleanUrls")) {
        out.cleanUrls = config.cleanUrls;
    }
    if (config.trailingSlash === true) {
        out.trailingSlashBehavior = "ADD";
    }
    else if (config.trailingSlash === false) {
        out.trailingSlashBehavior = "REMOVE";
    }
    if (has(config, "appAssociation")) {
        out.appAssociation = config.appAssociation;
    }
    if (has(config, "i18n")) {
        out.i18n = config.i18n;
    }
    return out;
}
exports.convertConfig = convertConfig;
//# sourceMappingURL=convertConfig.js.map