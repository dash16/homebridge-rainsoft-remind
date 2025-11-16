// src/platformAccessory.ts
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainsoftRemindPlatform } from './platform';
const identityStore = require('../lib/identityStore.js');

function formatLocal(dt?: string | number | Date): string {
	if (!dt) return '—';
	try {
		const d = typeof dt === 'string' || typeof dt === 'number' ? new Date(dt) : dt;
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric', month: 'short', day: '2-digit',
			hour: '2-digit', minute: '2-digit',
		}).format(d);
	} catch {
		return '—';
	}
}

function buildFirmwareRevisionString(lastRegen?: string | number | Date): string {
	const last = formatLocal(lastRegen);
	return `Last Regen: ${last}`;
}

export class RainsoftRemindAccessory {
	private statusService: Service;
	private batteryService: Service;
	private capacityService: Service;
	private regenService: Service;
	
	constructor(
		private readonly platform: RainsoftRemindPlatform,
		public readonly accessory: PlatformAccessory,
	) {
		// Core services 
		const HAP = this.platform.api.hap;
				
		this.statusService =
			this.accessory.getService('Status') ||
			this.accessory.addService(HAP.Service.ContactSensor, this.accessory.displayName + ' Status', 'status');
		
		const ServiceCtor = HAP.Service as any;
		const BatteryService =
		  ServiceCtor.BatteryService ??
		  ServiceCtor.Battery ??
		  ServiceCtor['BatteryService'] ??
		  ServiceCtor['Battery'];
		
		this.batteryService =
		  this.accessory.getService(BatteryService) ??
		  this.accessory.addService(BatteryService);
		  		
		this.capacityService =
		  this.accessory.getService(HAP.Service.HumiditySensor) ??
		  this.accessory.addService(HAP.Service.HumiditySensor, 'Capacity Remaining');

		this.regenService =
			this.accessory.getServiceById(HAP.Service.OccupancySensor, 'regen') ??
			this.accessory.addService(HAP.Service.OccupancySensor, 'Regeneration', 'regen');
		
		this.regenService.setCharacteristic(this.platform.Characteristic.Name, 'Regeneration');
		
		// ### 🧩 Friendly Service Names: ensure Home shows the right labels
		(() => {
			const { Characteristic } = this.platform;
		
			// Pull a device/model label if we have identity; fall back to the accessory's current name
			let deviceLabel = this.accessory.displayName;
			try {
				const id = identityStore.load(this.platform.api.user.storagePath());
				// Prefer model (e.g., "EC5"), else use the configured accessory name
				deviceLabel = (id?.model && String(id.model).trim()) || deviceLabel;
			} catch (_) {
				/* no-op: keep fallback */
			}
		
			// Intended names
			const capacityName = 'Capacity Remaining';
			const regenName = 'Regenerating'; // or 'Regeneration' if you prefer
			const statusName = `${deviceLabel} Status`;
		
			// Apply names to each service we expose
			const setName = (svc: Service | undefined, name: string) => {
				if (!svc) return;
				// Standard Name characteristic
				svc.setCharacteristic(Characteristic.Name, name);
				if (Characteristic.ConfiguredName && svc.testCharacteristic?.(Characteristic.ConfiguredName)) {
					svc.setCharacteristic(Characteristic.ConfiguredName, name);
				}
			};
		
			setName(this.capacityService, capacityName); // (HumiditySensor in your current build)
			setName(this.regenService, regenName);       // (OccupancySensor)
			setName(this.statusService, statusName);     // (Switch)
		})();
		
		// Accessory Information from discovery-time identity
		this.refreshAccessoryInfoFromStore();
	}

	public refreshAccessoryInfoFromStore(): void {
		try {
			const storagePath = this.platform.api.user.storagePath();
			const id = identityStore.load(storagePath);
			const ctx = (this.accessory.context as any)?.rainsoft || {};
	
			const info =
				this.accessory.getService(this.platform.Service.AccessoryInformation) ??
				this.accessory.addService(this.platform.Service.AccessoryInformation);
	
			info
				.setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainSoft')
				.setCharacteristic(this.platform.Characteristic.Model, id.model || 'RainSoft')
				.setCharacteristic(
					this.platform.Characteristic.SerialNumber,
					id.serial || String(ctx.deviceId || 'unknown')
				);
	
			// Only set firmware if we actually have one; avoids showing "unknown"
			if (id.firmware) {
				info.setCharacteristic(this.platform.Characteristic.FirmwareRevision, id.firmware);
			}
		} catch (e) {
			this.platform.log.warn('[rainsoft-remind] failed to refresh AccessoryInformation:', String(e));
		}
	}

	private isRegenerating(status: { systemStatusName?: string }): boolean {
		const name = (status.systemStatusName || '').toLowerCase();
		return name.includes('regeneration');
	}
	public async updateFromSnapshot(status: {
		displayName: string;
		serialNumber: string;
		prettyModel: string;
		systemStatusName: string;
		capacityRemaining: number; // 0–100
		saltPct: number;           // 0–100
	}): Promise<void> {
		// Optional: reflect server-side name changes
		if (status.displayName && this.accessory.displayName !== status.displayName) {
			this.accessory.displayName = status.displayName;
		}

		// Accessory Information (live refinements)
		const info =
			this.accessory.getService(this.platform.Service.AccessoryInformation) ??
			this.accessory.addService(this.platform.Service.AccessoryInformation);

		info
			.setCharacteristic(this.platform.Characteristic.Model, status.prettyModel || 'RainSoft System')
			.setCharacteristic(this.platform.Characteristic.SerialNumber, status.serialNumber || 'unknown');
		// --- Display Regen + Dealer in AccessoryInformation -------------------
		const base = this.platform.api.user.storagePath();
		const id = identityStore.load(base);
		const st = identityStore.loadStatus(base);
		
		// Firmware (from identity) + last/next regen (from status.json)
		const fw = id.firmware || 'unknown';
		const last = st?.lastRegenDate ? String(st.lastRegenDate).split('T')[0] : '—';
		// "HH:MM" from ISO for next regen
		const next = st?.nextRegenTime ? new Date(st.nextRegenTime).toISOString().substring(11, 16) : '—';
		
		info.setCharacteristic(
			this.platform.Characteristic.FirmwareRevision,
			`${fw} • Last ${last} • Next ${next}`
		);
		
		// Optional: show dealer name on HardwareRevision line
		if (id.dealerName) {
			info.setCharacteristic(this.platform.Characteristic.HardwareRevision, id.dealerName);
		}
		// ----------------------------------------------------------------------

		// ### 🧩 Map alert → ContactSensorState (OPEN = alert)
		const alertRaised = String(status.systemStatusName || '').toLowerCase() !== 'normal';
		const CS = this.platform.Characteristic.ContactSensorState;
		
		this.statusService
			.getCharacteristic(CS)
			.updateValue(alertRaised ? CS.CONTACT_NOT_DETECTED /* Open = alert */
			                         : CS.CONTACT_DETECTED     /* Closed = normal */);

		// Battery: salt %
		if (typeof status.saltPct === 'number') {
			const pct = Math.max(0, Math.min(100, Math.round(status.saltPct)));
			this.batteryService
				.setCharacteristic(this.platform.Characteristic.BatteryLevel, pct)
				.setCharacteristic(
					this.platform.Characteristic.StatusLowBattery,
					pct <= 20
						? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
						: this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
				);
		}

		// HumiditySensor: capacity remaining %
		if (typeof status.capacityRemaining === 'number') {
			const cap = Math.max(0, Math.min(100, Math.round(status.capacityRemaining)));
			this.capacityService.setCharacteristic(
				this.platform.Characteristic.CurrentRelativeHumidity,
				cap,
			);
		}
		// Update Regeneration occupancy state
		const regenActive = this.isRegenerating(status);
		this.regenService.updateCharacteristic(
			this.platform.Characteristic.OccupancyDetected,
			regenActive
				? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
				: this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
		);
		// cache for getOn()
		(this.accessory.context as any).lastRainsoftStatus = status;
	}

	// ignore control writes
	async setOn(value: CharacteristicValue) {
		this.platform.log.debug('[rainsoft-remind] Set System Status ->', value);
	}

	// normal = OFF, alert = ON
	async getOn(): Promise<CharacteristicValue> {
		const last = (this.accessory.context as any).lastRainsoftStatus;
		if (!last) return false;
		return String(last.systemStatusName || '').toLowerCase() !== 'normal';
	}
}
