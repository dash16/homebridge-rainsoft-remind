// homebridge-ui/server.js
'use strict';

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const identityStore = require('../lib/identityStore.js');

class RainsoftRemindUiServer extends HomebridgePluginUiServer {
	constructor() {
		super();

		// Dealer + regen info
		this.onRequest('/rainsoft/info', async () => {
			const storagePath = this.homebridgeStoragePath;

			const identity = identityStore.load(storagePath) || {};
			const status = identityStore.loadStatus(storagePath) || {};

			return {
				dealerName: identity.dealerName ?? null,
				dealerPhone: identity.dealerPhone ?? null,
				dealerEmail: identity.dealerEmail ?? null,

				lastRegenDate: status.lastRegenDate ?? null,
				asOf: status.asOf ?? null,
			};
		});

		// Auth state: do we have an identity.json that looks "logged in"?
		this.onRequest('/rainsoft/auth-state', async () => {
			const storagePath = this.homebridgeStoragePath;
			const identity = identityStore.load(storagePath) || {};

			const hasIdentity = !!(
				identity.deviceId ||
				identity.model ||
				identity.serial
			);

			return {
				hasIdentity,
				identity,
			};
		});

		// "Sign out": reset identity + status to blank
		this.onRequest('/rainsoft/signout', async () => {
			const storagePath = this.homebridgeStoragePath;

			try {
				identityStore.save(storagePath, {});
			} catch (e) {
				this.log.error('[rainsoft-remind][ui] signout: failed to save identity:', e);
			}

			try {
				identityStore.saveStatus(storagePath, {});
			} catch (e) {
				this.log.error('[rainsoft-remind][ui] signout: failed to save status:', e);
			}

			return { ok: true };
		});

		this.ready();
	}
}

(() => new RainsoftRemindUiServer())();