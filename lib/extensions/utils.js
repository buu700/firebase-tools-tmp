"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTimestamp = exports.getRandomString = exports.convertOfficialExtensionsToList = exports.convertExtensionOptionToLabeledList = exports.onceWithJoin = void 0;
const prompt_1 = require("../prompt");
async function onceWithJoin(question) {
    const response = await (0, prompt_1.promptOnce)(question);
    if (Array.isArray(response)) {
        return response.join(",");
    }
    return response;
}
exports.onceWithJoin = onceWithJoin;
function convertExtensionOptionToLabeledList(options) {
    return options.map((option) => {
        return {
            checked: false,
            name: option.label,
            value: option.value,
        };
    });
}
exports.convertExtensionOptionToLabeledList = convertExtensionOptionToLabeledList;
function convertOfficialExtensionsToList(officialExts) {
    const l = Object.entries(officialExts).map(([key, entry]) => {
        return {
            checked: false,
            value: `${entry.publisher}/${key}`,
        };
    });
    l.sort((a, b) => a.value.localeCompare(b.value));
    return l;
}
exports.convertOfficialExtensionsToList = convertOfficialExtensionsToList;
function getRandomString(length) {
    const SUFFIX_CHAR_SET = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += SUFFIX_CHAR_SET.charAt(Math.floor(Math.random() * SUFFIX_CHAR_SET.length));
    }
    return result;
}
exports.getRandomString = getRandomString;
function formatTimestamp(timestamp) {
    if (!timestamp) {
        return "";
    }
    const withoutMs = timestamp.split(".")[0];
    return withoutMs.replace("T", " ");
}
exports.formatTimestamp = formatTimestamp;
//# sourceMappingURL=utils.js.map