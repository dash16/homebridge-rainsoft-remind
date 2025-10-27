//
// homebridge-rainsoft-remind
// Poll RainSoft Remind API and expose device metrics (salt %, capacity %, status)
// as HomeKit services via Homebridge.
//

const RainsoftApi = require("./lib/rainsoftApi.js");

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

		// user-supplied config (may be partial now)
		this.email = config.email;
		this.password = config.password;
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

		this.forceUpdate =
			(typeof config.forceUpdate === "boolean")
				? config.forceUpdate
				: true;

		// runtime values from polling
		this.saltPct = 0;
		this.capacityRemaining = 0;
		this.systemStatusName = "Unknown";

		// less spammy heartbeat timer
		this._lastHeartbeat = 0;

		// ### 🧩 API client: central axios-based RainSoft caller
		this.api = new RainsoftApi(this.log);

		// HomeKit services
		this.infoService = new hap.Service.AccessoryInformation();
		this.infoService
			.setCharacteristic(hap.Characteristic.Manufacturer, "RainSoft")
			.setCharacteristic(hap.Characteristic.Model, this.modelLabel)
			.setCharacteristic(hap.Characteristic.SerialNumber, this.serialNumber)
			.setCharacteristic(hap.Characteristic.Name, this.name);

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

		this.statusService = new hap.Service.ContactSensor(this.name + " Status");
		this.statusService
			.getCharacteristic(hap.Characteristic.ContactSensorState)
			.on("get", (cb) => {
				const needsAttention = (this.systemStatusName !== "Normal");
				cb(null, needsAttention
					? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
					: hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
			});

		this.capacityService = new hap.Service.HumiditySensor(this.name + " Capacity");
		this.capacityService
			.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
			.on("get", (cb) => cb(null, this.capacityRemaining));

		// async bootstrap before we actually start polling
		this._bootstrap().then(() => {
			// after bootstrap finishes (either success or graceful fallback),
			// log final config and start polling loop

			if (!this.deviceId || !this.authToken) {
				// We might still be able to discover token/deviceId on first poll,
				// so we don't bail completely. We'll warn instead.
				this.log.warn("[rainsoft-remind] Missing deviceId or authToken at init; will attempt to discover on first poll.");
			}

			this.log(
				`[rainsoft-remind] init "${this.name}" Model=${this.modelLabel}, `
				+ `Serial=${this.serialNumber}, DeviceID=${this.deviceId}, `
				+ `poll=${this.pollSeconds}s forceUpdate=${this.forceUpdate}`
			);

			this._pollNow();
			this._schedulePoll();
		});
	}

	//
	// ### 🧩 _bootstrap: if deviceId/authToken aren't provided,
	// try to log in with email/password and discover them.
	//
	async _bootstrap() {
		// if we already have both, nothing to do
		if (this.deviceId && this.authToken) {
			return;
		}

		// if we don't have creds, we can't auto-discover
		if (!this.email || !this.password) {
			this.log.warn("[rainsoft-remind] No authToken/deviceId AND no email/password provided. You must fill config manually.");
			return;
		}

		this.log.info("[rainsoft-remind] Attempting automatic RainSoft login...");

		// step 1: login -> authentication_token
		const token = await this.api.login(this.email, this.password);
		if (!token) {
			this.log.warn("[rainsoft-remind] Login failed. Cannot auto-discover device.");
			return;
		}

		// step 2: /locations -> pick first device
		const locations = await this.api.getLocations(token);
		if (!locations || !locations.locationListData || !locations.locationListData[0]) {
			this.log.warn("[rainsoft-remind] /locations returned nothing usable.");
			return;
		}

		const loc0 = locations.locationListData[0];
		const dev0 = loc0.devices && loc0.devices[0];
		if (!dev0) {
			this.log.warn("[rainsoft-remind] /locations had no devices.");
			return;
		}

		// hydrate our runtime with discovered values
		this.authToken = this.authToken || token;
		this.deviceId = this.deviceId || String(dev0.id);

		// Opportunistically improve modelLabel / serialNumber if user left defaults
		if ((!this.modelLabel || this.modelLabel === "EC5-75-CV") && dev0.model) {
			const baseModel = (dev0.model || "").toString().trim();
			const sizePart = (dev0.unitSizeName || "").toString().trim();
			let resinPart = (dev0.resinTypeName || "").toString().trim();
			if (resinPart.toUpperCase().startsWith("TYPE")) {
				resinPart = resinPart.substring(4).trim();
			}
			const prettyParts = [baseModel, sizePart, resinPart].filter(Boolean);
			const prettyModel = prettyParts.join("-");
			this.modelLabel = prettyModel || baseModel || this.modelLabel;
		}

		if ((!this.serialNumber || this.serialNumber === "Unknown") && dev0.serialNumber) {
			this.serialNumber = String(dev0.serialNumber);
		}

		this.log.info(`[rainsoft-remind] Discovered DeviceID=${this.deviceId}, Serial=${this.serialNumber}, Model=${this.modelLabel}`);
	}

	_schedulePoll() {
		setInterval(() => {
			this._pollNow();
		}, this.pollSeconds * 1000);
	}

	//
	// ### 🧩 _pollNow: NEW VERSION
	// Ask RainSoftApi for a fresh snapshot, then update HomeKit.
	// Also handles quiet logging / heartbeat.
	//
	async _pollNow() {
		// Try to fetch a new snapshot from the cloud
		const snap = await this.api.fetchDeviceSnapshot(this);
		if (!snap) {
			this.log.warn("[rainsoft-remind] Poll failed (no snapshot).");
			return;
		}

		// update local runtime state
		this.saltPct = snap.saltPct;
		this.capacityRemaining = snap.capacityRemaining;
		this.systemStatusName = snap.systemStatusName;

		// keep labels nice if cloud knows better names
		if (snap.prettyModel && snap.prettyModel !== this.modelLabel) {
			this.modelLabel = snap.prettyModel;
			this.infoService.setCharacteristic(hap.Characteristic.Model, this.modelLabel);
		}

		if (snap.serialNumber && snap.serialNumber !== this.serialNumber) {
			this.serialNumber = snap.serialNumber;
			this.infoService.setCharacteristic(hap.Characteristic.SerialNumber, this.serialNumber);
		}

		if (snap.displayName && snap.displayName !== this.name) {
			this.name = snap.displayName;
			this.infoService.setCharacteristic(hap.Characteristic.Name, this.name);
			// Note: renaming services here won't rename them in Home app UI once paired,
			// but we can keep internal state tidy.
		}

		// push values into HomeKit characteristics
		this.batteryService
			.getCharacteristic(hap.Characteristic.BatteryLevel)
			.updateValue(this.saltPct);

		const low = (this.saltPct < 20)
			? hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
			: hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
		this.batteryService
			.getCharacteristic(hap.Characteristic.StatusLowBattery)
			.updateValue(low);

		const needsAttention = (this.systemStatusName !== "Normal")
			? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
			: hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
		this.statusService
			.getCharacteristic(hap.Characteristic.ContactSensorState)
			.updateValue(needsAttention);

		this.capacityService
			.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
			.updateValue(this.capacityRemaining);

		// quiet logging: only heartbeat once per hour-ish
		const now = Date.now();
		if (now - this._lastHeartbeat > 3600000) { // 1 hour
			this.log(`[rainsoft-remind] heartbeat OK saltPct=${this.saltPct.toFixed(1)} cap=${this.capacityRemaining} status=${this.systemStatusName}`);
			this._lastHeartbeat = now;
		}
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
