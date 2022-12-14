"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.functionResourceToEmulatedTriggerDefintion = void 0;
const functionsEmulatorShared_1 = require("../../emulator/functionsEmulatorShared");
const emulatorLogger_1 = require("../../emulator/emulatorLogger");
const types_1 = require("../../emulator/types");
const proto = require("../../gcp/proto");
function functionResourceToEmulatedTriggerDefintion(resource) {
    const etd = {
        name: resource.name,
        entryPoint: resource.name,
        platform: "gcfv1",
    };
    const properties = resource.properties || {};
    proto.convertIfPresent(etd, properties, "timeoutSeconds", "timeout", proto.secondsFromDuration);
    proto.convertIfPresent(etd, properties, "regions", "location", (str) => [str]);
    proto.copyIfPresent(etd, properties, "availableMemoryMb");
    if (properties.httpsTrigger) {
        etd.httpsTrigger = properties.httpsTrigger;
    }
    if (properties.eventTrigger) {
        etd.eventTrigger = {
            eventType: properties.eventTrigger.eventType,
            resource: properties.eventTrigger.resource,
            service: (0, functionsEmulatorShared_1.getServiceFromEventType)(properties.eventTrigger.eventType),
        };
    }
    else {
        emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.FUNCTIONS).log("WARN", `Function '${resource.name} is missing a trigger in extension.yaml. Please add one, as triggers defined in code are ignored.`);
    }
    return etd;
}
exports.functionResourceToEmulatedTriggerDefintion = functionResourceToEmulatedTriggerDefintion;
//# sourceMappingURL=triggerHelper.js.map