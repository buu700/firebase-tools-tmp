"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.release = void 0;
const client_1 = require("./client");
const logger_1 = require("../../logger");
const projectUtils_1 = require("../../projectUtils");
const utils = require("../../utils");
const convertConfig_1 = require("./convertConfig");
async function release(context, options, payload) {
    if (!context.hosting || !context.hosting.deploys) {
        return;
    }
    const projectNumber = await (0, projectUtils_1.needProjectNumber)(options);
    logger_1.logger.debug(JSON.stringify(context.hosting.deploys, null, 2));
    await Promise.all(context.hosting.deploys.map(async (deploy) => {
        utils.logLabeledBullet(`hosting[${deploy.site}]`, "finalizing version...");
        const config = await (0, convertConfig_1.convertConfig)(context, payload, deploy.config, true);
        const data = { status: "FINALIZED", config };
        const queryParams = { updateMask: "status,config" };
        const finalizeResult = await client_1.client.patch(`/${deploy.version}`, data, { queryParams });
        logger_1.logger.debug(`[hosting] finalized version for ${deploy.site}:${finalizeResult.body}`);
        utils.logLabeledSuccess(`hosting[${deploy.site}]`, "version finalized");
        utils.logLabeledBullet(`hosting[${deploy.site}]`, "releasing new version...");
        const channelSegment = context.hostingChannel && context.hostingChannel !== "live"
            ? `/channels/${context.hostingChannel}`
            : "";
        if (channelSegment) {
            logger_1.logger.debug("[hosting] releasing to channel:", context.hostingChannel);
        }
        const releaseResult = await client_1.client.post(`/projects/${projectNumber}/sites/${deploy.site}${channelSegment}/releases`, { message: options.message || null }, { queryParams: { versionName: deploy.version } });
        logger_1.logger.debug("[hosting] release:", releaseResult.body);
        utils.logLabeledSuccess(`hosting[${deploy.site}]`, "release complete");
    }));
}
exports.release = release;
//# sourceMappingURL=release.js.map