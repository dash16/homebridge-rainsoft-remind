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
import { RainsoftRemindAccessory } from './platformAccessory';

const identityStore = require('../lib/identityStore.js');
const RainsoftApi = require('../lib/rainsoftApi.js');

export class RainsoftRemindPlatform implements DynamicPlatformPlugin {
	// Expose HAP classes as getters so we don't access this.api before it's ready
	public get Service() {
		return this.api.hap.Service;
	}
	public get Characteristic() {
		return this.api.hap.Characteristic;
	}
	private ensuredOnce = false;
	private pollTimer: NodeJS.Timeout | null = null;
	private pollSeconds = 300;

	public readonly accessories: PlatformAccessory[] = [];
	private activeAccessory: RainsoftRemindAccessory | null = null;

	private readonly apiClient: any;

	private isConfigured(): boolean {

		if (this.config.email && this.config.password) {
			return true;
		}
	
		if (this.config.authToken && this.config.deviceId) {
			return true;
		}
	
		try {
			const id = identityStore.load(this.api.user.storagePath());
			if (id?.deviceId) {
				return true;
			}
		} catch {

		}
	
		return false;
	}

	constructor(
		public readonly log: Logger,
		public readonly config: PlatformConfig,
		public readonly api: API,
	) {
		this.apiClient = new RainsoftApi(this.log);
		this.pollSeconds = Number((this.config as any)?.pollSeconds ?? 300);

		this.api.on('didFinishLaunching', async () => {
		
			if (!this.isConfigured()) {
				this.log.warn(
					'[rainsoft-remind] Plugin not configured. ' +
					'Add email/password or authToken/deviceId (or have an identity.json with deviceId) to begin polling.',
				);
				return;
			}
		
			try {
				await this.ensureAccessory();
				await this.ensureIdentity();
				this.startPolling();
			} catch (err) {
				this.log.error('[rainsoft-remind] Startup error:', String(err));
			}
		});
		
		// IPC endpoint for UI "force refresh" (used by Dealer Details refresh button)
		const apiWithOnRequest = this.api as unknown as {
			onRequest?: (path: string, handler: (body: unknown, callback: (response: unknown) => void) => void) => void;
		};
		
		apiWithOnRequest.onRequest?.('/rainsoft/force-refresh', async (_body: unknown, callback: (response: unknown) => void) => {
			try {
				// One-shot forced refresh from RainSoft cloud
				await this.refreshFromCloud(true);
		
				const storagePath = this.api.user.storagePath();
				const identity = identityStore.load(storagePath) || {};
				const status = identityStore.loadStatus(storagePath) || {};
		
				callback({
					ok: true,
					dealerName: identity.dealerName ?? null,
					dealerPhone: identity.dealerPhone ?? null,
					dealerEmail: identity.dealerEmail ?? null,
					lastRegenDate: status.lastRegenDate ?? null,
					asOf: status.asOf ?? null,
				});
			} catch (err) {
				this.log.error('[rainsoft-remind] force-refresh IPC failed:', String(err));
				callback({
					ok: false,
					error: String(err),
				});
			}
		});
		
		this.api.on('shutdown', () => this.stopPolling());
	}

	configureAccessory(accessory: PlatformAccessory) {
		// HB is restoring a previously registered accessory
		this.log.info('[rainsoft-remind] restoring cached accessory:', accessory.displayName);
		this.accessories.push(accessory);
		this.activeAccessory = new RainsoftRemindAccessory(this, accessory);
	}

	// --- ensure we have exactly one accessory
	private async ensureAccessory() {
		if (this.ensuredOnce) return;
		this.ensuredOnce = true;

		if (this.accessories.length > 0) {
			// Use first cached accessory
			const accessory = this.accessories[0];
			// normalize context
			accessory.context.rainsoft = {
				...(accessory.context.rainsoft ?? {}),
				...this.buildContextFromConfig(),
			};
			this.activeAccessory = new RainsoftRemindAccessory(this, accessory);
			this.log.info('[rainsoft-remind] using cached accessory');
			return;
		}

		// No cached accessory → register new if we have a deviceId or will learn one later
		const name = (this.config as any)?.name || 'RainSoft System';
		const deviceIdForUuid = this.getConfiguredDeviceId() || 'pending-device';
		const uuid = this.api.hap.uuid.generate(String(deviceIdForUuid));

		const accessory = new this.api.platformAccessory(name, uuid);
		accessory.context.rainsoft = this.buildContextFromConfig();

		this.activeAccessory = new RainsoftRemindAccessory(this, accessory);
		this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

		this.log.info('[rainsoft-remind] registered accessory:', name);
	}
	
	// --- first-run identity bootstrap (writes deviceId/serial/model/firmware/dealer to disk)
	private async ensureIdentity() {
		const storagePath = this.api.user.storagePath();
		const ctx = this.activeAccessory?.accessory.context.rainsoft || this.buildContextFromConfig();
		const store = identityStore.load(storagePath);
	
		// If we already have a deviceId on disk, propagate it and refresh info
		if (store.deviceId) {
			ctx.deviceId = ctx.deviceId ?? store.deviceId;
			if (this.activeAccessory) this.activeAccessory.accessory.context.rainsoft = ctx;
			this.log.info('[rainsoft-remind] using stored deviceId:', store.deviceId);
			this.activeAccessory?.refreshAccessoryInfoFromStore?.();
			return;
		}
	
		// Otherwise, discover account and seed identity on disk
		if (!ctx.email || !ctx.password) {
			this.log.warn('[rainsoft-remind] missing email/password; cannot discover deviceId yet');
			return;
		}
	
		try {
			const acct = await this.apiClient.discoverAccount(ctx.email, ctx.password);
			if (!acct?.deviceId) {
				this.log.warn('[rainsoft-remind] discovery returned no deviceId');
				return;
			}
			identityStore.merge(storagePath, {
				deviceId: acct.deviceId,
				name: acct.deviceName ?? undefined,
				model: acct.prettyModel ?? undefined,
				serial: acct.serialNumber ?? undefined,
				firmware: (acct.firmwareVersion ?? acct.firmware) ?? undefined,
				dealerName: acct.dealerName ?? undefined,
				dealerPhone: acct.dealerPhone ?? undefined,
				dealerEmail: acct.dealerEmail ?? undefined,
			});
			ctx.deviceId = acct.deviceId;
			if (this.activeAccessory) this.activeAccessory.accessory.context.rainsoft = ctx;
			this.log.info('[rainsoft-remind] discovered deviceId:', acct.deviceId);
			this.activeAccessory?.refreshAccessoryInfoFromStore?.();
		} catch (e) {
			this.log.error('[rainsoft-remind] ensureIdentity error:', String(e));
		}
	}
	
	// --- poll loop
	private startPolling() {
		this.stopPolling();
		const run = async () => {
			try {
				await this.pollOnce();
			} finally {
				this.pollTimer = setTimeout(run, this.pollSeconds * 1000);
			}
		};
		run();
	}
	private stopPolling() {
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = null;
	}
	// --- core refresh: shared by poll loop and UI "force refresh"
	private async refreshFromCloud(force: boolean): Promise<void> {
		const wrapped = this.activeAccessory;
		if (!wrapped) {
			return;
		}
	
		const ctx = wrapped.accessory.context?.rainsoft || this.buildContextFromConfig();
		const storagePath = this.api.user.storagePath();
		const store = identityStore.load(storagePath);
	
		// Ensure we have a deviceId
		ctx.deviceId = ctx.deviceId ?? store.deviceId;
		if (!ctx.deviceId) {
			this.log.warn('[rainsoft-remind] refreshFromCloud: no deviceId yet; skipping');
			return;
		}
	
		// For a forced refresh, make sure the context allows forceUpdate
		if (force) {
			ctx.forceUpdate = true;
		}
	
		// Fetch normalized live snapshot (salt %, capacity %, status)
		const snap = await this.apiClient.fetchDeviceSnapshot(ctx, { force });
		if (!snap) {
			this.log.warn('[rainsoft-remind] refreshFromCloud: no snapshot returned');
			return;
		}
	
		// Persist identity details
		identityStore.merge(storagePath, {
			name: snap.displayName ?? undefined,
			model: snap.prettyModel ?? undefined,
			serial: snap.serialNumber ?? undefined,
			firmware: snap.firmware ?? undefined,
			dealerName: snap.dealerName ?? undefined,
			dealerPhone: snap.dealerPhone ?? undefined,
			dealerEmail: snap.dealerEmail ?? undefined,
		});
	
		// Persist dynamic status
		identityStore.mergeStatus(storagePath, {
			lastRegenDate: snap.lastRegenDate || null,
			nextRegenTime: snap.regenTime || null,
			asOf: snap.asOf || new Date().toISOString(),
		});
	
		// Update context + accessory state
		wrapped.accessory.context.rainsoft = ctx;
		wrapped.accessory.context.lastRainsoftStatus = snap;
		await wrapped.updateFromSnapshot(snap);
	}

	// Single poll tick
	private async pollOnce() {
		await this.refreshFromCloud(false);
	}
	
	// ### 🧩 Config → context: normalize user config into what the API expects
	private buildContextFromConfig(): any {
		return {
			email: (this.config as any)?.email || undefined,
			password: (this.config as any)?.password || undefined,
			deviceId: (this.config as any)?.deviceId || (this.config as any)?.deviceID || undefined,
			authToken: (this.config as any)?.authToken || undefined,
			forceUpdate: (this.config as any)?.forceUpdate === true,
		};
	}

	private getConfiguredDeviceId(): string | undefined {
		const cfg = this.buildContextFromConfig();
		return cfg.deviceId ? String(cfg.deviceId) : undefined;
	}
}
