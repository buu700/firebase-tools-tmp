"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const clc = require("colorette");
const loadCJSON_1 = require("../../loadCJSON");
const rulesDeploy_1 = require("../../rulesDeploy");
const utils = require("../../utils");
async function prepareRules(context, options) {
    var _a;
    const rulesFile = (_a = options.config.src.firestore) === null || _a === void 0 ? void 0 : _a.rules;
    if (context.firestoreRules && rulesFile) {
        const rulesDeploy = new rulesDeploy_1.RulesDeploy(options, rulesDeploy_1.RulesetServiceType.CLOUD_FIRESTORE);
        _.set(context, "firestore.rulesDeploy", rulesDeploy);
        rulesDeploy.addFile(rulesFile);
        await rulesDeploy.compile();
    }
}
function prepareIndexes(context, options) {
    var _a;
    if (!context.firestoreIndexes || !((_a = options.config.src.firestore) === null || _a === void 0 ? void 0 : _a.indexes)) {
        return;
    }
    const indexesFileName = options.config.src.firestore.indexes;
    const indexesPath = options.config.path(indexesFileName);
    const parsedSrc = (0, loadCJSON_1.loadCJSON)(indexesPath);
    utils.logBullet(`${clc.bold(clc.cyan("firestore:"))} reading indexes from ${clc.bold(indexesFileName)}...`);
    context.firestore = context.firestore || {};
    context.firestore.indexes = {
        name: indexesFileName,
        content: parsedSrc,
    };
}
async function default_1(context, options) {
    if (options.only) {
        const targets = options.only.split(",");
        const onlyIndexes = targets.indexOf("firestore:indexes") >= 0;
        const onlyRules = targets.indexOf("firestore:rules") >= 0;
        const onlyFirestore = targets.indexOf("firestore") >= 0;
        context.firestoreIndexes = onlyIndexes || onlyFirestore;
        context.firestoreRules = onlyRules || onlyFirestore;
    }
    else {
        context.firestoreIndexes = true;
        context.firestoreRules = true;
    }
    prepareIndexes(context, options);
    await prepareRules(context, options);
}
exports.default = default_1;
//# sourceMappingURL=prepare.js.map