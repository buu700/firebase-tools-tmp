"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("util");
const fs = require("fs");
const path = require("path");
const spawn = require("cross-spawn");
const clc = require("colorette");
const error_1 = require("../../../error");
const prompt_1 = require("../../../prompt");
const utils = require("../../../utils");
const go = require("../../../deploy/functions/runtimes/golang");
const logger_1 = require("../../../logger");
const RUNTIME_VERSION = "1.13";
const TEMPLATE_ROOT = path.resolve(__dirname, "../../../../templates/init/functions/golang");
const MAIN_TEMPLATE = fs.readFileSync(path.join(TEMPLATE_ROOT, "functions.go"), "utf8");
const GITIGNORE_TEMPLATE = fs.readFileSync(path.join(TEMPLATE_ROOT, "_gitignore"), "utf8");
async function init(setup, config) {
    await writeModFile(config);
    const modName = config.get("functions.go.module");
    const [pkg] = modName.split("/").slice(-1);
    await config.askWriteProjectFile("functions/functions.go", MAIN_TEMPLATE.replace("PACKAGE", pkg));
    await config.askWriteProjectFile("functions/.gitignore", GITIGNORE_TEMPLATE);
}
async function writeModFile(config) {
    const modPath = config.path("functions/go.mod");
    if (await (0, util_1.promisify)(fs.exists)(modPath)) {
        const shoudlWriteModFile = await (0, prompt_1.promptOnce)({
            type: "confirm",
            message: "File " + clc.underline("functions/go.mod") + " already exists. Overwrite?",
            default: false,
        });
        if (!shoudlWriteModFile) {
            return;
        }
        await (0, util_1.promisify)(fs.unlink)(modPath);
    }
    const modName = await (0, prompt_1.promptOnce)({
        type: "input",
        message: "What would you like to name your module?",
        default: "acme.com/functions",
    });
    config.set("functions.go.module", modName);
    config.writeProjectFile("functions/go.mod", `module ${modName} \n\ngo ${RUNTIME_VERSION}\n\n`);
    utils.logSuccess("Wrote " + clc.bold("functions/go.mod"));
    for (const dep of [go.FUNCTIONS_SDK, go.ADMIN_SDK, go.FUNCTIONS_CODEGEN, go.FUNCTIONS_RUNTIME]) {
        const result = spawn.sync("go", ["get", dep], {
            cwd: config.path("functions"),
            stdio: "inherit",
        });
        if (result.error) {
            logger_1.logger.debug("Full output from go get command:", JSON.stringify(result, null, 2));
            throw new error_1.FirebaseError("Error installing dependencies", { children: [result.error] });
        }
    }
    utils.logSuccess("Installed dependencies");
}
module.exports = init;
//# sourceMappingURL=golang.js.map