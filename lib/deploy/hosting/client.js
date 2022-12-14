"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.client = void 0;
const api_1 = require("../../api");
const apiv2_1 = require("../../apiv2");
exports.client = new apiv2_1.Client({
    urlPrefix: api_1.hostingApiOrigin,
    apiVersion: "v1beta1",
});
//# sourceMappingURL=client.js.map