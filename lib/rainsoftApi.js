'use strict';

const axios = require('axios');

//
// ### 🧩 RainSoft API client: login + discovery
//

class RainsoftApi {
	constructor(log) {
		this.log = log;
		this.client = axios.create({
			baseURL: 'https://remind.rainsoft.com/api/remindapp/v2',
			headers: {
				'Accept': 'application/json',
				'Origin': 'ionic://localhost',
				'User-Agent': 'RainSoftRemind/Homebridge',
			},
		});
	}

	async login(email, password) {
		try {
			const body = new URLSearchParams({
				email,
				password,
			}).toString();

			const res = await this.client.post('/login', body, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});

			if (res.data && res.data.authentication_token) {
				return res.data.authentication_token;
			} else {
				this.log.warn('[rainsoft-remind] login response missing authentication_token');
				return null;
			}
		} catch (err) {
			this._logAxiosError('login failed', err);
			return null;
		}
	}

	async getLocations(token) {
			try {
				const resp = await this.client.get('/locations/', {
					headers: {
						'X-Remind-Auth-Token': token,
					},
					validateStatus: () => true // we'll handle non-200 manually
				});
	
				if (resp.status !== 200) {
					this.log(`[rainsoft-remind] getLocations failed: HTTP ${resp.status}`);
					return null;
				}
	
				return resp.data;
			} catch (err) {
				this._logAxiosError('getLocations exception', err);
				return null;
			}
		}

	_logAxiosError(prefix, err) {
		if (err.response) {
			this.log.error(`[rainsoft-remind] ${prefix}: HTTP ${err.response.status}`);
		} else if (err.request) {
			this.log.error(`[rainsoft-remind] ${prefix}: no response from server`);
		} else {
			this.log.error(`[rainsoft-remind] ${prefix}: ${err.message}`);
		}
	}
}

module.exports = RainsoftApi;
