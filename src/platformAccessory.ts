// src/platformAccessory.ts
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainsoftRemindPlatform } from './platform';

export class RainsoftRemindAccessory {
	private service: Service;

	constructor(
		private readonly platform: RainsoftRemindPlatform,
		private readonly accessory: PlatformAccessory,
	) {
		this.accessory
			.getService(this.platform.Service.AccessoryInformation)!
			.setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainSoft')
			.setCharacteristic(this.platform.Characteristic.Model, 'Remind')
			.setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.UUID);

		this.service =
			this.accessory.getService(this.platform.Service.Switch) ??
			this.accessory.addService(this.platform.Service.Switch);

		this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

		this.service
			.getCharacteristic(this.platform.Characteristic.On)
			.onSet(this.setOn.bind(this))
			.onGet(this.getOn.bind(this));
	}

	async setOn(value: CharacteristicValue) {
		this.platform.log.debug('Set Characteristic On ->', value);
	}

	async getOn(): Promise<CharacteristicValue> {
		this.platform.log.debug('Get Characteristic On');
		return true;
	}
}
