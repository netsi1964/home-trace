import { createJevTransport } from '../providers/jev/jev.server.ts';
import { createJevProvider, createJevVerifier } from '../providers/jev/provider.server.ts';
import { BudgetExceededError, JobBudget, type AnalysisImage, type AnalysisProvider } from '../providers/types.ts';
import { createChatTransport, createVisionProvider } from '../providers/vision/vision.server.ts';
import { JEV_MODEL } from '../providers/jev/contract.ts';
import { blobsLog, budgetedFetch, memoryLog, type BudgetState, type RequestLog } from './budget.ts';
import type { ServerConfig } from './config.ts';

/**
 * The private analysis proxy (PRD-SEC-004, PRD-SEC-007). Images are processed in memory and
 * never stored or logged; technical logs carry status, duration and usage only.
 */

export const PER_JOB_LIMIT = 20; // PRD-FEAT-010
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

let logPromise: Promise<RequestLog> | null = null;

/** Netlify Blobs in production; in local development without Blobs, an in-memory log. */
export function requestLog(): Promise<RequestLog> {
	logPromise ??= (async () => {
		try {
			const log = await blobsLog();
			await log.countToday('0000-00-00');
			return log;
		} catch {
			console.warn('[hometrace] Netlify Blobs unavailable; using an in-memory daily budget (development only).');
			return memoryLog();
		}
	})();
	return logPromise;
}

export type ApiResult = { status: number; body: Record<string, unknown> };

const techLog = (e: { status: number | null; durationMs: number; usage?: unknown; error?: string }) =>
	console.info(JSON.stringify({ at: 'provider', status: e.status, durationMs: e.durationMs, usage: e.usage ?? null, error: e.error?.slice(0, 200) ?? null }));

function providers(config: ServerConfig, log: RequestLog, state: BudgetState, crop: Crops) {
	const fetchWithBudget = budgetedFetch(log, config.dailyRequestLimit, state);
	const jevTransport = createJevTransport({ apiKey: config.apiKey, fetch: fetchWithBudget, log: techLog });
	const chat = createChatTransport({ apiKey: config.apiKey, fetch: fetchWithBudget, log: techLog });
	const jev = createJevProvider({ transport: jevTransport, crop: crop.region });
	if (config.provider === 'jev') return { discover: jev, identity: jev, model: JEV_MODEL };
	if (config.provider === 'vision') {
		const vision = createVisionProvider({ transport: chat, model: config.visionModel });
		return { discover: vision as AnalysisProvider, identity: vision as AnalysisProvider, model: config.visionModel };
	}
	const vision = createVisionProvider({
		transport: chat,
		model: config.visionModel,
		verifier: createJevVerifier({ transport: jevTransport, crop: crop.box })
	});
	return { discover: vision as AnalysisProvider, identity: jev, model: `${config.visionModel} + ${JEV_MODEL}` };
}

export type Crops = {
	prepare: (bytes: Uint8Array) => Promise<AnalysisImage>;
	region: (image: AnalysisImage, region: { x: number; y: number; width: number; height: number }) => Promise<AnalysisImage>;
	box: (image: AnalysisImage, box: { x: number; y: number; width: number; height: number }) => Promise<AnalysisImage>;
};

async function defaultCrops(): Promise<Crops> {
	// sharp is loaded lazily so the rest of the server never depends on its native binary.
	const m = await import('./images.ts');
	return { prepare: (b) => m.prepareFrame(Buffer.from(b)), region: m.cropRegion, box: (i, b) => m.cropBox(i, b) };
}

function failure(e: unknown, state: BudgetState): ApiResult {
	if (state.limitHit) return { status: 429, body: { message: 'Daily analysis budget reached', requests: state.sent } };
	if (e instanceof BudgetExceededError) return { status: 429, body: { message: e.message, requests: state.sent } };
	const message = e instanceof Error ? e.message : 'Analysis failed';
	return { status: 502, body: { message: message.slice(0, 300), requests: state.sent } };
}

function imageFrom(form: FormData, name: string): File | string {
	const f = form.get(name);
	if (!(f instanceof File)) return `missing ${name}`;
	if (!['image/jpeg', 'image/png'].includes(f.type)) return `${name} must be JPEG or PNG`;
	if (f.size > MAX_UPLOAD_BYTES) return `${name} is larger than 16 MiB`;
	return f;
}

export async function discover(config: ServerConfig, form: FormData, deps: { log?: RequestLog; crops?: Crops } = {}): Promise<ApiResult> {
	const file = imageFrom(form, 'image');
	if (typeof file === 'string') return { status: 400, body: { message: file } };
	const state: BudgetState = { sent: 0, limitHit: false };
	try {
		const crops = deps.crops ?? (await defaultCrops());
		const frame = await crops.prepare(new Uint8Array(await file.arrayBuffer()));
		const p = providers(config, deps.log ?? (await requestLog()), state, crops);
		const r = await p.discover.discover(frame, new JobBudget(PER_JOB_LIMIT));
		return {
			status: 200,
			body: { detections: r.detections, rejected: r.rejected.length, usage: r.usage, durationMs: r.durationMs, provider: config.provider, model: p.model }
		};
	} catch (e) {
		return failure(e, state);
	}
}

export async function identity(config: ServerConfig, form: FormData, deps: { log?: RequestLog; crops?: Crops } = {}): Promise<ApiResult> {
	const a = imageFrom(form, 'earlier');
	const b = imageFrom(form, 'later');
	if (typeof a === 'string' || typeof b === 'string') return { status: 400, body: { message: typeof a === 'string' ? a : b } };
	const state: BudgetState = { sent: 0, limitHit: false };
	try {
		const crops = deps.crops ?? (await defaultCrops());
		const [ia, ib] = await Promise.all([crops.prepare(new Uint8Array(await a.arrayBuffer())), crops.prepare(new Uint8Array(await b.arrayBuffer()))]);
		const p = providers(config, deps.log ?? (await requestLog()), state, crops);
		const r = await p.identity.compareIdentity(ia, ib, new JobBudget(1));
		return { status: 200, body: { outcome: r.outcome, usage: r.usage, durationMs: r.durationMs } };
	} catch (e) {
		return failure(e, state);
	}
}
