"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const command_1 = require("../command");
const controller = require("../emulator/controller");
const commandUtils = require("../emulator/commandUtils");
const logger_1 = require("../logger");
const registry_1 = require("../emulator/registry");
const types_1 = require("../emulator/types");
const clc = require("colorette");
const constants_1 = require("../emulator/constants");
const utils_1 = require("../utils");
const Table = require("cli-table");
function stylizeLink(url) {
    return clc.underline(clc.bold(url));
}
exports.command = new command_1.Command("emulators:start")
    .before(commandUtils.setExportOnExitOptions)
    .before(commandUtils.beforeEmulatorCommand)
    .description("start the local Firebase emulators")
    .option(commandUtils.FLAG_ONLY, commandUtils.DESC_ONLY)
    .option(commandUtils.FLAG_INSPECT_FUNCTIONS, commandUtils.DESC_INSPECT_FUNCTIONS)
    .option(commandUtils.FLAG_IMPORT, commandUtils.DESC_IMPORT)
    .option(commandUtils.FLAG_EXPORT_ON_EXIT, commandUtils.DESC_EXPORT_ON_EXIT)
    .action((options) => {
    const killSignalPromise = commandUtils.shutdownWhenKilled(options);
    return Promise.race([
        killSignalPromise,
        (async () => {
            let deprecationNotices;
            try {
                ({ deprecationNotices } = await controller.startAll(options));
            }
            catch (e) {
                await controller.cleanShutdown();
                throw e;
            }
            printEmulatorOverview(options);
            for (const notice of deprecationNotices) {
                (0, utils_1.logLabeledWarning)("emulators", notice, "warn");
            }
            return killSignalPromise;
        })(),
    ]);
});
function printEmulatorOverview(options) {
    const reservedPorts = [];
    for (const internalEmulator of [types_1.Emulators.LOGGING]) {
        const info = registry_1.EmulatorRegistry.getInfo(internalEmulator);
        if (info) {
            reservedPorts.push(info.port);
        }
        controller.filterEmulatorTargets(options).forEach((emulator) => {
            var _a;
            reservedPorts.push(...(((_a = registry_1.EmulatorRegistry.getInfo(emulator)) === null || _a === void 0 ? void 0 : _a.reservedPorts) || []));
        });
    }
    const reservedPortsString = reservedPorts.length > 0 ? reservedPorts.join(", ") : "None";
    const uiInfo = registry_1.EmulatorRegistry.getInfo(types_1.Emulators.UI);
    const hubInfo = registry_1.EmulatorRegistry.getInfo(types_1.Emulators.HUB);
    const uiUrl = uiInfo ? `http://${registry_1.EmulatorRegistry.getInfoHostString(uiInfo)}` : "unknown";
    const head = ["Emulator", "Host:Port"];
    if (uiInfo) {
        head.push(`View in ${constants_1.Constants.description(types_1.Emulators.UI)}`);
    }
    const successMessageTable = new Table();
    let successMsg = `${clc.green("???")}  ${clc.bold("All emulators ready! It is now safe to connect your app.")}`;
    if (uiInfo) {
        successMsg += `\n${clc.cyan("i")}  View Emulator UI at ${stylizeLink(uiUrl)}`;
    }
    successMessageTable.push([successMsg]);
    const emulatorsTable = new Table({
        head: head,
        style: {
            head: ["yellow"],
        },
    });
    emulatorsTable.push(...controller
        .filterEmulatorTargets(options)
        .map((emulator) => {
        const emulatorName = constants_1.Constants.description(emulator).replace(/ emulator/i, "");
        const isSupportedByUi = types_1.EMULATORS_SUPPORTED_BY_UI.includes(emulator);
        const info = registry_1.EmulatorRegistry.getInfo(emulator);
        if (!info) {
            return [emulatorName, "Failed to initialize (see above)", "", ""];
        }
        return [
            emulatorName,
            registry_1.EmulatorRegistry.getInfoHostString(info),
            isSupportedByUi && uiInfo ? stylizeLink(`${uiUrl}/${emulator}`) : clc.blackBright("n/a"),
        ];
    })
        .map((col) => col.slice(0, head.length))
        .filter((v) => v));
    let extensionsTable = "";
    if (registry_1.EmulatorRegistry.isRunning(types_1.Emulators.EXTENSIONS)) {
        const extensionsEmulatorInstance = registry_1.EmulatorRegistry.get(types_1.Emulators.EXTENSIONS);
        extensionsTable = extensionsEmulatorInstance.extensionsInfoTable(options);
    }
    logger_1.logger.info(`\n${successMessageTable}

${emulatorsTable}
${hubInfo
        ? clc.blackBright("  Emulator Hub running at ") + registry_1.EmulatorRegistry.getInfoHostString(hubInfo)
        : clc.blackBright("  Emulator Hub not running.")}
${clc.blackBright("  Other reserved ports:")} ${reservedPortsString}
${extensionsTable}
Issues? Report them at ${stylizeLink("https://github.com/firebase/firebase-tools/issues")} and attach the *-debug.log files.
 `);
}
//# sourceMappingURL=emulators-start.js.map