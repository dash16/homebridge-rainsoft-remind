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
		this.name = config.name || "RainSoft System";
		this.modelLabel = config.modelLabel || "Model-Size-Resin";
		this.serialNumber = config.serialNumber || this.deviceId || "Unknown";

		// polling behavior
		this.pollSeconds =
			(typeof config.pollSeconds === "number" && config.pollSeconds > 0)
				? config.pollSeconds
				: 1800;

		this.forceUpdate =
			(typeof config.forceUpdate === "boolean")
				? config.forceUpdate
				: true;
		
		this.refreshOnStartup =
			(typeof config.refreshOnStartup === "boolean")
				? config.refreshOnStartup
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

			this._pollNow({ force: this.refreshOnStartup });
			this._schedulePoll();
		});
	}

	//
	// ### 🧩 _bootstrap: first-run setup / self-heal
	// If deviceId/authToken aren't provided in config, try to discover them with email/password.
	//
	async _bootstrap() {
		// If we already have both, we're done.
		if (this.deviceId && this.authToken) {
			return;
		}
	
		// If we don't have creds, we can't self-discover.
		if (!this.email || !this.password) {
			this.log.warn("[rainsoft-remind] No authToken/deviceId AND no email/password provided. Please fill config or enable login.");
			return;
		}
	
		this.log.info("[rainsoft-remind] Attempting automatic RainSoft discovery...");
	
		const discovered = await this.api.discoverAccount(this.email, this.password);
		if (!discovered) {
			this.log.warn("[rainsoft-remind] Discovery failed. Cannot auto-populate device info.");
			return;
		}
	
		// Hydrate runtime/accessory state from discovery result
		this.authToken = this.authToken || discovered.authToken;
		this.deviceId = this.deviceId || discovered.deviceId;
	
		// Improve labels if user left defaults
		if ((!this.modelLabel || this.modelLabel === "EC5-75-CV") && discovered.prettyModel) {
			this.modelLabel = discovered.prettyModel;
		}
		if ((!this.serialNumber || this.serialNumber === "Unknown") && discovered.serialNumber) {
			this.serialNumber = discovered.serialNumber;
		}
		if (this.name === "RainSoft System" && discovered.deviceName) {
			this.name = discovered.deviceName;
		}
	
		// Push updated identity info into the AccessoryInformation service
		this.infoService
			.setCharacteristic(hap.Characteristic.Model, this.modelLabel)
			.setCharacteristic(hap.Characteristic.SerialNumber, this.serialNumber)
			.setCharacteristic(hap.Characteristic.Name, this.name);
	
		this.log.info(`[rainsoft-remind] Discovered DeviceID=${this.deviceId}, Serial=${this.serialNumber}, Model=${this.modelLabel}`);
	}

	_schedulePoll() {
		setInterval(() => {
			this._pollNow({ force: false });
		}, this.pollSeconds * 1000);
	}


	//
	// ### 🧩 _pollNow: ask RainsoftApi for snapshot, maybe forcing refresh
	// Also handles quiet logging / heartbeat.
	//
	async _pollNow(opts = { force: false }) {
		const snap = await this.api.fetchDeviceSnapshot(this, opts);
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
			this.log(
				`[rainsoft-remind] heartbeat OK saltPct=${this.saltPct.toFixed(1)} cap=${this.capacityRemaining} status=${this.systemStatusName}`
			);
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
