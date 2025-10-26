//
// homebridge-rainsoft-remind
// Poll RainSoft Remind API and expose device metrics (salt %, capacity %, status)
// as HomeKit services via Homebridge.
//
// Includes:
// - AccessoryInformation service
// - Optional forceUpdate GET before polling
//
//

const https = require("https");

let apiRef;
let hap;

module.exports = (homebridge) => {
	apiRef = homebridge;
	hap = homebridge.hap;
	homebridge.registerAccessory(
		"homebridge-rainsoft-remind",
		"RainsoftRemind",
		RainsoftRemindAccessory
	);
};

class RainsoftRemindAccessory {
	constructor(log, config) {
		this.log = log;

		// --- pull config first ---
		// required
		this.deviceId = config.deviceId;
		this.authToken = config.authToken;

		// identity / nice-to-have
		this.name = config.name || "RainSoft EC5";
		this.modelLabel = config.modelLabel || "EC5-75-CV";
		this.serialNumber = config.serialNumber || this.deviceId || "Unknown";

		// polling behavior
		this.pollSeconds =
			(typeof config.pollSeconds === "number" && config.pollSeconds > 0)
				? config.pollSeconds
				: 300;

		// forceUpdate needs to respect explicit false, not just truthy/falsy
		this.forceUpdate =
			(typeof config.forceUpdate === "boolean")
				? config.forceUpdate
				: true;

		// sanity check required fields
		if (!this.deviceId || !this.authToken) {
			this.log.error("[rainsoft-remind] Missing deviceId or authToken in config!");
		}

		// snapshot log AFTER assignments
		this.log(
			`[rainsoft-remind] init "${this.name}" Model=${this.modelLabel}, `
			+ `Serial=${this.serialNumber}, DeviceID=${this.deviceId}, `
			+ `poll=${this.pollSeconds}s forceUpdate=${this.forceUpdate}`
		);

		// runtime values from polling
		this.saltPct = 0;
		this.capacityRemaining = 0;
		this.systemStatusName = "Unknown";

		// --- HomeKit services ---

		// AccessoryInformation
		this.infoService = new hap.Service.AccessoryInformation();
		this.infoService
			.setCharacteristic(hap.Characteristic.Manufacturer, "RainSoft")
			.setCharacteristic(hap.Characteristic.Model, this.modelLabel)
			.setCharacteristic(hap.Characteristic.SerialNumber, this.serialNumber)
			.setCharacteristic(hap.Characteristic.Name, this.name);

		// BatteryService (salt %)
		this.batteryService = new hap.Service.BatteryService(this.name + " Salt");
		this.batteryService
			.getCharacteristic(hap.Characteristic.BatteryLevel)
			.on("get", (cb) => cb(null, this.saltPct));

		this.batteryService
			.getCharacteristic(hap.Characteristic.ChargingState)
			.on("get", (cb) => cb(null, hap.Characteristic.ChargingState.NOT_CHARGING));

		this.batteryService
			.getCharacteristic(hap.Characteristic.StatusLowBattery)
			.on("get", (cb) => {
				const low = (this.saltPct < 20)
					? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
					: hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
				cb(null, low);
			});

		// ContactSensor (system health)
		this.statusService = new hap.Service.ContactSensor(this.name + " Status");
		this.statusService
			.getCharacteristic(hap.Characteristic.ContactSensorState)
			.on("get", (cb) => {
				const needsAttention = (this.systemStatusName !== "Normal");
				cb(null, needsAttention
					? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
					: hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
			});

		// HumiditySensor (capacityRemaining %)
		this.capacityService = new hap.Service.HumiditySensor(this.name + " Capacity");
		this.capacityService
			.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
			.on("get", (cb) => cb(null, this.capacityRemaining));

		// Start polling
		this._pollNow();
		this._schedulePoll();
	}

	_schedulePoll() {
		setInterval(() => {
			this._pollNow();
		}, this.pollSeconds * 1000);
	}

	_forceUpdateNow(cb) {
		if (!this.forceUpdate) {
			if (cb) cb();
			return;
		}

		const options = {
			method: "GET",
			hostname: "remind.rainsoft.com",
			path: "/api/remindapp/v2/forceupdate",
			headers: {
				"Accept": "application/json",
				"X-Remind-Auth-Token": this.authToken
			}
		};

		let raw = "";
		const req = https.request(options, (res) => {
			res.setEncoding("utf8");
			res.on("data", (chunk) => { raw += chunk; });
			res.on("end", () => {
				this.log(`[rainsoft-remind] forceupdate code=${res.statusCode}`);
				if (cb) cb();
			});
		});

		req.on("error", (e) => {
			this.log("[rainsoft-remind] forceupdate error:", e);
			if (cb) cb();
		});

		req.end();
	}

	_pollNow() {
		if (!this.deviceId || !this.authToken) {
			return;
		}

		this._forceUpdateNow(() => {
			const options = {
				method: "GET",
				hostname: "remind.rainsoft.com",
				path: `/api/remindapp/v2/device/${this.deviceId}`,
				headers: {
					"Accept": "application/json",
					"X-Remind-Auth-Token": this.authToken
				}
			};

			let raw = "";
			const req = https.request(options, (res) => {
				res.setEncoding("utf8");
				res.on("data", (chunk) => { raw += chunk; });
				res.on("end", () => {
					try {
						const data = JSON.parse(raw);

						//
						// Build the human-friendly model string
						// e.g. EC5-75-CV from:
						//   data.model         = "EC5"
						//   data.unitSizeName  = "75"
						//   data.resinTypeName = "TYPE CV"
						//
						const baseModel = (data.model || "RainSoft").toString().trim();
						const sizePart = (data.unitSizeName || "").toString().trim(); // "75"
						let resinPart = (data.resinTypeName || "").toString().trim();  // "TYPE CV"
						if (resinPart.toUpperCase().startsWith("TYPE")) {
							resinPart = resinPart.substring(4).trim(); // "CV"
						}
						const prettyModelParts = [baseModel, sizePart, resinPart].filter(Boolean);
						const prettyModel = prettyModelParts.join("-");

						// Try to get a "real" serial number (not just deviceId)
						// We haven't located this yet; for now fall back to deviceId.
						const serialGuess = this.deviceId;

						const saltLbs = data.saltLbs;
						const maxSalt = data.maxSalt || 250;
						const capRemain = data.capacityRemaining;
						const statusName = data.systemStatusName || "Unknown";
						const dispName = data.name || this.name;

						// compute % salt remaining
						let saltPct = 0;
						if (typeof saltLbs === "number" && typeof maxSalt === "number" && maxSalt > 0) {
							saltPct = (saltLbs / maxSalt) * 100.0;
							if (saltPct < 0) saltPct = 0;
							if (saltPct > 100) saltPct = 100;
						}

						// update snapshot
						this.saltPct = saltPct;
						this.capacityRemaining = (typeof capRemain === "number") ? capRemain : 0;
						this.systemStatusName = statusName;
						this.modelReported = prettyModel || baseModel;
						this.deviceDisplayName = dispName;
						
						// Update Salt "Battery"
						this.batteryService
							.getCharacteristic(hap.Characteristic.BatteryLevel)
							.updateValue(this.saltPct);

						const low = (this.saltPct < 20)
							? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
							: hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
						this.batteryService
							.getCharacteristic(hap.Characteristic.StatusLowBattery)
							.updateValue(low);

						// Update Status contact sensor
						const needsAttention = (this.systemStatusName !== "Normal")
							? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
							: hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
						this.statusService
							.getCharacteristic(hap.Characteristic.ContactSensorState)
							.updateValue(needsAttention);

						// Update Capacity humidity
						this.capacityService
							.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
							.updateValue(this.capacityRemaining);

					} catch (e) {
						this.log("[rainsoft-remind] parse error:", e, raw);
					}
				});
			});

			req.on("error", (e) => {
				this.log("[rainsoft-remind] request error:", e);
			});

			req.end();
		});
	}

	getServices() {
		return [
			this.infoService,
			this.batteryService,
			this.statusService,
			this.capacityService
		];
	}
}
