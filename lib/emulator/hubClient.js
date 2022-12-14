"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmulatorHubClient = void 0;
const hub_1 = require("./hub");
const error_1 = require("../error");
const apiv2_1 = require("../apiv2");
class EmulatorHubClient {
    constructor(projectId) {
        this.projectId = projectId;
        this.locator = hub_1.EmulatorHub.readLocatorFile(projectId);
    }
    foundHub() {
        return this.locator !== undefined;
    }
    async getStatus() {
        const apiClient = new apiv2_1.Client({ urlPrefix: this.origin, auth: false });
        await apiClient.get("/");
    }
    async getEmulators() {
        const apiClient = new apiv2_1.Client({ urlPrefix: this.origin, auth: false });
        const res = await apiClient.get(hub_1.EmulatorHub.PATH_EMULATORS);
        return res.body;
    }
    async postExport(options) {
        const apiClient = new apiv2_1.Client({ urlPrefix: this.origin, auth: false });
        await apiClient.post(hub_1.EmulatorHub.PATH_EXPORT, options);
    }
    get origin() {
        const locator = this.assertLocator();
        return `http://${locator.host}:${locator.port}`;
    }
    assertLocator() {
        if (this.locator === undefined) {
            throw new error_1.FirebaseError(`Cannot contact the Emulator Hub for project ${this.projectId}`);
        }
        return this.locator;
    }
}
exports.EmulatorHubClient = EmulatorHubClient;
//# sourceMappingURL=hubClient.js.map