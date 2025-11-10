import type { API } from 'homebridge';
import { RainsoftRemindPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export = (api: API) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, RainsoftRemindPlatform);
};
