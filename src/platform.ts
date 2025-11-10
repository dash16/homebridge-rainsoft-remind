// src/platform.ts
import {
	API,
	DynamicPlatformPlugin,
	Logger,
	PlatformAccessory,
	PlatformConfig,
	Service,
	Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

const RainsoftApi = require('../lib/rainsoftApi');
const identityStore = require('../lib/identityStore');

export class RainsoftRemindPlatform implements DynamicPlatformPlugin {
	public readonly Service: typeof Service;
	public readonly Characteristic: typeof Characteristic;
	private readonly accessories: PlatformAccessory[] = [];

	private readonly email?: string;
	private readonly password?: string;
	private authToken?: string;
	private deviceId?: string;

	private readonly apiClient: any;
	private readonly storagePath!: string;
	private readonly pollSeconds!: number;

	constructor(
		public readonly log: Logger,
		public readonly config: PlatformConfig,
		public readonly api: API,
	) {
		this.Service = this.api.hap.Service;
		this.Characteristic = this.api.hap.Characteristic;

		if (!config) {
			this.log.warn('[rainsoft-remind] no config found, plugin will not start.');
			return;
		}

		this.email = config.email;
		this.password = config.password;
		this.authToken = config.authToken;
		this.deviceId = config.deviceId;

		this.pollSeconds = (config.pollSeconds as number) || 300;
		this.storagePath = this.api.user.storagePath();

		this.apiClient = new RainsoftApi(this.log);

		this.log.info('[rainsoft-remind] platform starting…');

		this.api.on('didFinishLaunching', () => {
			this.log.debug('[rainsoft-remind] didFinishLaunching');
			this.bootstrap().catch((err: any) => {
				this.log.error('[rainsoft-remind] bootstrap failed: ' + err?.message);
			});
		});
	}

	configureAccessory(accessory: PlatformAccessory): void {
		this.log.info('Loading accessory from cache:', accessory.displayName);
		this.accessories.push(accessory);
	}

	private async bootstrap(): Promise<void> {
		// case 1: email + password in config
		if (this.config.email && this.config.password) {
			this.log.info('[rainsoft-remind] using email/password from config to discover account…');
	
			const acct = await this.apiClient.discoverAccount(
				this.config.email,
				this.config.password,
			);
	
			this.authToken = acct.authToken;
			this.deviceId = acct.deviceId;
	
			identityStore.save(this.storagePath, {
				name: acct.deviceName || acct.prettyModel || 'RainSoft',
				model: acct.prettyModel || acct.deviceId,
				serial: acct.serialNumber || acct.deviceId,
				firmware: null,
				dealerName: null,
				dealerPhone: null,
				dealerEmail: null,
				authToken: acct.authToken,
				deviceId: acct.deviceId,
			});
	
			await this.pollOnce();
			this.startPolling();
			return;
		}
	
		// case 2: manual auth in config
		if (this.config.authToken && this.config.deviceId) {
			this.log.info('[rainsoft-remind] using manual auth/device from config…');
	
			this.authToken = this.config.authToken;
			this.deviceId = this.config.deviceId;
	
			await this.pollOnce();
			this.startPolling();
			return;
		}
	
		// case 3: load from identity store
		const ident = identityStore.load(this.storagePath);
		this.log.info('[rainsoft-remind] no creds in config; using stored identity: ' + (ident?.name || 'unknown'));
	
		if (!ident?.authToken || !ident?.deviceId) {
			this.log.warn('[rainsoft-remind] identity store is missing token or deviceId; plugin will not poll.');
			return;
		}
	
		this.authToken = ident.authToken;
		this.deviceId = ident.deviceId;
	
		await this.pollOnce();
		this.startPolling();
	}


	private async pollOnce(): Promise<void> {
		if (!this.authToken || !this.deviceId) {
			this.log.warn('[rainsoft-remind] pollOnce: missing token or deviceId');
			return;
		}

		const ctx = {
			email: this.email,
			password: this.password,
			authToken: this.authToken,
			deviceId: this.deviceId,
			forceUpdate: false,
		};

		const snap = await this.apiClient.fetchDeviceSnapshot(ctx, { force: false });
		if (!snap) {
			this.log.warn('[rainsoft-remind] pollOnce: no snapshot returned');
			return;
		}

		const statusName = snap.systemStatusName || 'unknown';
		const saltPct = typeof snap.saltPct === 'number' ? Math.round(snap.saltPct) : null;
		this.log.info(
			`[rainsoft-remind] ${snap.displayName || 'RainSoft'} — status=${statusName}` +
				(saltPct !== null ? ` salt=${saltPct}%` : ''),
		);
	}

	private startPolling(): void {
		if (!this.pollSeconds || this.pollSeconds <= 0) {
			return;
		}
		this.log.info(`[rainsoft-remind] starting poll loop every ${this.pollSeconds}s`);
		setInterval(() => {
			this.pollOnce().catch((err: any) => {
				this.log.error('[rainsoft-remind] poll failed: ' + err?.message);
			});
		}, this.pollSeconds * 1000);
	}
}
