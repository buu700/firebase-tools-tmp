"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirestoreEmulator = void 0;
const chokidar = require("chokidar");
const fs = require("fs");
const clc = require("colorette");
const path = require("path");
const utils = require("../utils");
const downloadableEmulators = require("./downloadableEmulators");
const types_1 = require("../emulator/types");
const registry_1 = require("./registry");
const constants_1 = require("./constants");
const apiv2_1 = require("../apiv2");
class FirestoreEmulator {
    constructor(args) {
        this.args = args;
    }
    async start() {
        const functionsInfo = registry_1.EmulatorRegistry.getInfo(types_1.Emulators.FUNCTIONS);
        if (functionsInfo) {
            this.args.functions_emulator = registry_1.EmulatorRegistry.getInfoHostString(functionsInfo);
        }
        if (this.args.rules && this.args.projectId) {
            const rulesPath = this.args.rules;
            this.rulesWatcher = chokidar.watch(rulesPath, { persistent: true, ignoreInitial: true });
            this.rulesWatcher.on("change", async () => {
                await new Promise((res) => setTimeout(res, 5));
                utils.logLabeledBullet("firestore", "Change detected, updating rules...");
                const newContent = fs.readFileSync(rulesPath, "utf8").toString();
                const issues = await this.updateRules(newContent);
                if (issues) {
                    for (const issue of issues) {
                        utils.logWarning(this.prettyPrintRulesIssue(rulesPath, issue));
                    }
                }
                if (issues.some((issue) => issue.severity === types_1.Severity.ERROR)) {
                    utils.logWarning("Failed to update rules");
                }
                else {
                    utils.logLabeledSuccess("firestore", "Rules updated.");
                }
            });
        }
        return downloadableEmulators.start(types_1.Emulators.FIRESTORE, this.args);
    }
    connect() {
        return Promise.resolve();
    }
    stop() {
        if (this.rulesWatcher) {
            this.rulesWatcher.close();
        }
        return downloadableEmulators.stop(types_1.Emulators.FIRESTORE);
    }
    getInfo() {
        const host = this.args.host || constants_1.Constants.getDefaultHost();
        const port = this.args.port || constants_1.Constants.getDefaultPort(types_1.Emulators.FIRESTORE);
        const reservedPorts = this.args.websocket_port ? [this.args.websocket_port] : [];
        return {
            name: this.getName(),
            host,
            port,
            pid: downloadableEmulators.getPID(types_1.Emulators.FIRESTORE),
            reservedPorts: reservedPorts,
        };
    }
    getName() {
        return types_1.Emulators.FIRESTORE;
    }
    async updateRules(content) {
        const projectId = this.args.projectId;
        const info = this.getInfo();
        const body = {
            ignore_errors: true,
            rules: {
                files: [
                    {
                        name: "security.rules",
                        content,
                    },
                ],
            },
        };
        const client = new apiv2_1.Client({
            urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(info)}`,
            auth: false,
        });
        const res = await client.put(`/emulator/v1/projects/${projectId}:securityRules`, body);
        if (res.body && Array.isArray(res.body.issues)) {
            return res.body.issues;
        }
        return [];
    }
    prettyPrintRulesIssue(filePath, issue) {
        const relativePath = path.relative(process.cwd(), filePath);
        const line = issue.sourcePosition.line || 0;
        const col = issue.sourcePosition.column || 0;
        return `${clc.cyan(relativePath)}:${clc.yellow(line)}:${clc.yellow(col)} - ${clc.red(issue.severity)} ${issue.description}`;
    }
}
exports.FirestoreEmulator = FirestoreEmulator;
FirestoreEmulator.FIRESTORE_EMULATOR_ENV_ALT = "FIREBASE_FIRESTORE_EMULATOR_ADDRESS";
//# sourceMappingURL=firestoreEmulator.js.map