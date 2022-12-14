"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepare = void 0;
const error_1 = require("../../error");
const client_1 = require("./client");
const projectUtils_1 = require("../../projectUtils");
const normalizedHostingConfigs_1 = require("../../hosting/normalizedHostingConfigs");
const validate_1 = require("./validate");
const convertConfig_1 = require("./convertConfig");
const deploymentTool = require("../../deploymentTool");
async function prepare(context, options, payload) {
    if (options.public) {
        if (Array.isArray(options.config.get("hosting"))) {
            throw new error_1.FirebaseError("Cannot specify --public option with multi-site configuration.");
        }
        options.config.set("hosting.public", options.public);
    }
    const projectNumber = await (0, projectUtils_1.needProjectNumber)(options);
    const configs = (0, normalizedHostingConfigs_1.normalizedHostingConfigs)(options, { resolveTargets: true });
    if (configs.length === 0) {
        return Promise.resolve();
    }
    context.hosting = {
        deploys: configs.map((cfg) => {
            return { config: cfg, site: cfg.site };
        }),
    };
    const versionCreates = [];
    for (const deploy of context.hosting.deploys) {
        const cfg = deploy.config;
        (0, validate_1.validateDeploy)(deploy, options);
        const data = {
            config: await (0, convertConfig_1.convertConfig)(context, payload, cfg, false),
            labels: deploymentTool.labels(),
        };
        versionCreates.push(client_1.client
            .post(`/projects/${projectNumber}/sites/${deploy.site}/versions`, data)
            .then((res) => {
            deploy.version = res.body.name;
        }));
    }
    await Promise.all(versionCreates);
}
exports.prepare = prepare;
//# sourceMappingURL=prepare.js.map