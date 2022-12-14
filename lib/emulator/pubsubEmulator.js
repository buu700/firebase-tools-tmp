"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubsubEmulator = void 0;
const uuid = require("uuid");
const pubsub_1 = require("@google-cloud/pubsub");
const downloadableEmulators = require("./downloadableEmulators");
const apiv2_1 = require("../apiv2");
const emulatorLogger_1 = require("./emulatorLogger");
const types_1 = require("../emulator/types");
const constants_1 = require("./constants");
const error_1 = require("../error");
const registry_1 = require("./registry");
class PubsubEmulator {
    constructor(args) {
        this.args = args;
        this.logger = emulatorLogger_1.EmulatorLogger.forEmulator(types_1.Emulators.PUBSUB);
        const { host, port } = this.getInfo();
        this.pubsub = new pubsub_1.PubSub({
            apiEndpoint: `${host}:${port}`,
            projectId: this.args.projectId,
        });
        this.triggersForTopic = new Map();
        this.subscriptionForTopic = new Map();
    }
    async start() {
        return downloadableEmulators.start(types_1.Emulators.PUBSUB, this.args);
    }
    connect() {
        return Promise.resolve();
    }
    async stop() {
        await downloadableEmulators.stop(types_1.Emulators.PUBSUB);
    }
    getInfo() {
        const host = this.args.host || constants_1.Constants.getDefaultHost();
        const port = this.args.port || constants_1.Constants.getDefaultPort(types_1.Emulators.PUBSUB);
        return {
            name: this.getName(),
            host,
            port,
            pid: downloadableEmulators.getPID(types_1.Emulators.PUBSUB),
        };
    }
    getName() {
        return types_1.Emulators.PUBSUB;
    }
    async maybeCreateTopicAndSub(topicName) {
        const topic = this.pubsub.topic(topicName);
        try {
            this.logger.logLabeled("DEBUG", "pubsub", `Creating topic: ${topicName}`);
            await topic.create();
        }
        catch (e) {
            if (e && e.code === 6) {
                this.logger.logLabeled("DEBUG", "pubsub", `Topic ${topicName} exists`);
            }
            else {
                throw new error_1.FirebaseError(`Could not create topic ${topicName}`, { original: e });
            }
        }
        const subName = `emulator-sub-${topicName}`;
        let sub;
        try {
            this.logger.logLabeled("DEBUG", "pubsub", `Creating sub for topic: ${topicName}`);
            [sub] = await topic.createSubscription(subName);
        }
        catch (e) {
            if (e && e.code === 6) {
                this.logger.logLabeled("DEBUG", "pubsub", `Sub for ${topicName} exists`);
                sub = topic.subscription(subName);
            }
            else {
                throw new error_1.FirebaseError(`Could not create sub ${subName}`, { original: e });
            }
        }
        sub.on("message", (message) => {
            this.onMessage(topicName, message);
        });
        return sub;
    }
    async addTrigger(topicName, triggerKey, signatureType) {
        this.logger.logLabeled("DEBUG", "pubsub", `addTrigger(${topicName}, ${triggerKey}, ${signatureType})`);
        const sub = await this.maybeCreateTopicAndSub(topicName);
        const triggers = this.triggersForTopic.get(topicName) || [];
        if (triggers.some((t) => t.triggerKey === triggerKey) &&
            this.subscriptionForTopic.has(topicName)) {
            this.logger.logLabeled("DEBUG", "pubsub", "Trigger already exists");
            return;
        }
        triggers.push({ triggerKey, signatureType });
        this.triggersForTopic.set(topicName, triggers);
        this.subscriptionForTopic.set(topicName, sub);
    }
    ensureFunctionsClient() {
        if (this.client !== undefined)
            return;
        const funcEmulator = registry_1.EmulatorRegistry.get(types_1.Emulators.FUNCTIONS);
        if (!funcEmulator) {
            throw new error_1.FirebaseError(`Attempted to execute pubsub trigger but could not find the Functions emulator`);
        }
        this.client = new apiv2_1.Client({
            urlPrefix: `http://${registry_1.EmulatorRegistry.getInfoHostString(funcEmulator.getInfo())}`,
            auth: false,
        });
    }
    createLegacyEventRequestBody(topic, message) {
        return {
            context: {
                eventId: uuid.v4(),
                resource: {
                    service: "pubsub.googleapis.com",
                    name: `projects/${this.args.projectId}/topics/${topic}`,
                },
                eventType: "google.pubsub.topic.publish",
                timestamp: message.publishTime.toISOString(),
            },
            data: {
                data: message.data,
                attributes: message.attributes,
            },
        };
    }
    createCloudEventRequestBody(topic, message) {
        const data = {
            message: {
                messageId: message.id,
                publishTime: message.publishTime,
                attributes: message.attributes,
                orderingKey: message.orderingKey,
                data: message.data.toString("base64"),
            },
            subscription: this.subscriptionForTopic.get(topic).name,
        };
        return {
            specversion: "1",
            id: uuid.v4(),
            time: message.publishTime.toISOString(),
            type: "google.cloud.pubsub.topic.v1.messagePublished",
            source: `//pubsub.googleapis.com/projects/${this.args.projectId}/topics/${topic}`,
            data,
        };
    }
    async onMessage(topicName, message) {
        this.logger.logLabeled("DEBUG", "pubsub", `onMessage(${topicName}, ${message.id})`);
        const triggers = this.triggersForTopic.get(topicName);
        if (!triggers || triggers.length === 0) {
            throw new error_1.FirebaseError(`No trigger for topic: ${topicName}`);
        }
        this.logger.logLabeled("DEBUG", "pubsub", `Executing ${triggers.length} matching triggers (${JSON.stringify(triggers.map((t) => t.triggerKey))})`);
        this.ensureFunctionsClient();
        for (const { triggerKey, signatureType } of triggers) {
            try {
                const path = `/functions/projects/${this.args.projectId}/triggers/${triggerKey}`;
                if (signatureType === "event") {
                    await this.client.post(path, this.createLegacyEventRequestBody(topicName, message));
                }
                else if (signatureType === "cloudevent") {
                    await this.client.post(path, this.createCloudEventRequestBody(topicName, message), { headers: { "Content-Type": "application/cloudevents+json; charset=UTF-8" } });
                }
                else {
                    throw new error_1.FirebaseError(`Unsupported trigger signature: ${signatureType}`);
                }
            }
            catch (e) {
                this.logger.logLabeled("DEBUG", "pubsub", e);
            }
        }
        this.logger.logLabeled("DEBUG", "pubsub", `Acking message ${message.id}`);
        message.ack();
    }
}
exports.PubsubEmulator = PubsubEmulator;
//# sourceMappingURL=pubsubEmulator.js.map