import { DEFAULT_VISION_MODEL } from '../providers/vision/contract.ts';

/**
 * Server configuration from environment variables (PRD-SEC-007). Secrets stay on the server:
 * this module is only imported by server code (`$lib/server`), never by the client bundle.
 */

export type ProviderChoice = 'jev' | 'vision' | 'vision-jev';

export type ServerConfig = {
	configured: boolean;
	apiKey: string;
	accessCode: string;
	sessionSecret: string;
	provider: ProviderChoice;
	visionModel: string;
	dailyRequestLimit: number;
};

export function readConfig(env: Record<string, string | undefined>): ServerConfig {
	const apiKey = env.OPEN_ROUTER_API_KEY ?? '';
	const accessCode = env.HOMETRACE_ACCESS_CODE ?? '';
	const sessionSecret = env.HOMETRACE_SESSION_SECRET ?? '';
	const p = env.HOMETRACE_PROVIDER;
	const provider: ProviderChoice = p === 'jev' || p === 'vision' || p === 'vision-jev' ? p : 'vision-jev';
	const limit = Number(env.HOMETRACE_DAILY_REQUEST_LIMIT);
	return {
		// All three are required: a key without access control must never be reachable (PRD-SEC-007.5).
		configured: !!apiKey && accessCode.length >= 8 && sessionSecret.length >= 32,
		apiKey,
		accessCode,
		sessionSecret,
		provider,
		visionModel: env.VISION_MODEL || DEFAULT_VISION_MODEL,
		dailyRequestLimit: Number.isInteger(limit) && limit > 0 ? limit : 200
	};
}
