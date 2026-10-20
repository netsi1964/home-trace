import type { Box } from '../geometry/box.ts';

/**
 * Internal application analysis contract (PRD-SEC-004). This is not a provider HTTP format;
 * only adapters in this folder translate between this contract and a provider.
 */

/** `vision`: a vision-language model via OpenRouter (Phase 0 comparison, PRD-SEC-009 question 1). */
export type DetectionSource = 'jev' | 'vision' | 'manual' | 'demo';

export type Detection = {
	id: string;
	label: string;
	category: string | null;
	box: Box;
	source: DetectionSource;
	/** Missing provider confidence stays null. Never invented, never a calibrated probability. */
	providerConfidence: number | null;
	presence: 'supported' | 'uncertain';
};

export type MatchProposal = {
	observationId: string;
	candidateObjectId: string;
	outcome: 'possible_same' | 'unlikely_same' | 'uncertain';
	providerConfidence: number | null;
};

/** A captured, correctly oriented frame ready for analysis. Never contains overlay or UI. */
export type AnalysisImage = {
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
	width: number;
	height: number;
	bytes: Uint8Array;
};

/**
 * Hard request budget (PRD-FEAT-010). Adapters must call `spend()` before each request.
 * A job budget can sit inside a larger one, e.g. a whole evaluation run.
 */
export class JobBudget {
	#used = 0;
	readonly maxRequests: number;
	readonly parent: JobBudget | null;

	constructor(maxRequests: number, parent: JobBudget | null = null) {
		this.maxRequests = maxRequests;
		this.parent = parent;
	}

	get used(): number {
		return this.#used;
	}

	get remaining(): number {
		const own = this.maxRequests - this.#used;
		return this.parent ? Math.min(own, this.parent.remaining) : own;
	}

	/** Reserves one request or throws. Never retried automatically. */
	spend(): void {
		if (this.#used >= this.maxRequests) {
			throw new BudgetExceededError(this.maxRequests);
		}
		this.parent?.spend();
		this.#used += 1;
	}
}

export class BudgetExceededError extends Error {
	readonly maxRequests: number;

	constructor(maxRequests: number) {
		super(`Job budget of ${maxRequests} provider requests reached`);
		this.name = 'BudgetExceededError';
		this.maxRequests = maxRequests;
	}
}

export type Usage = {
	requests: number;
	inputTokens: number | null;
	outputTokens: number | null;
	/** Only set when the provider reports it. Never computed from guessed prices. */
	reportedCost: number | null;
};

export type DiscoveryResult = {
	detections: Detection[];
	/** Labels or text the provider returned that could not be turned into a valid detection. */
	rejected: { reason: string; raw: string }[];
	usage: Usage;
	durationMs: number;
};

export type IdentityResult = {
	outcome: MatchProposal['outcome'];
	providerConfidence: number | null;
	/** Raw provider score behind the outcome, kept for threshold tuning in Phase 0. Never shown as a probability. */
	rawScore: number | null;
	usage: Usage;
	durationMs: number;
};

export interface AnalysisProvider {
	readonly id: 'demo' | 'jev' | 'vision';
	/** Finds visible object candidates in one frame. */
	discover(image: AnalysisImage, budget: JobBudget, signal?: AbortSignal): Promise<DiscoveryResult>;
	/** Judges whether two crops show the same physical object. */
	compareIdentity(
		a: AnalysisImage,
		b: AnalysisImage,
		budget: JobBudget,
		signal?: AbortSignal
	): Promise<IdentityResult>;
}
