/**
 * Phase 0 evaluation (PRD-SEC-008): runs a provider over annotated fixtures and reports
 * precision, recall, usable-box rate, repeated-instance failures and identity errors.
 *
 *   npm run eval -- --fixtures fixtures/demo                     # demo provider, free
 *   npm run eval -- --fixtures private-fixtures/home --provider jev --dry-run
 *   npm run eval -- --fixtures private-fixtures/home --provider jev --confirm-paid --max-requests 40
 *   npm run eval -- --fixtures private-fixtures/home --provider vision-jev --confirm-paid
 *
 * Providers: demo (free), jev, vision (vision-LLM, model from VISION_MODEL), vision-jev
 * (vision-LLM finds objects, JEV checks each box and judges identity).
 * Live providers need OPEN_ROUTER_API_KEY in .env. Paid requests are never retried automatically.
 * Results on demo fixtures or with the demo provider never represent JEV quality (T24).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { GroundTruthSchema, identityPairs, type AnnotatedImage, type GroundTruth, type IdentityPair } from '../src/lib/evaluation/groundTruth.ts';
import {
	GATE,
	scoreImage,
	summariseDetection,
	summariseIdentity,
	type IdentityOutcome,
	type ImageDetectionResult
} from '../src/lib/evaluation/metrics.ts';
import { BudgetExceededError, JobBudget, type AnalysisProvider, type Usage } from '../src/lib/providers/types.ts';
import { JEV_MODEL } from '../src/lib/providers/jev/contract.ts';
import { createJevTransport } from '../src/lib/providers/jev/jev.server.ts';
import { addUsage, emptyUsage } from '../src/lib/providers/shared.ts';
import { createJevProvider, createJevVerifier } from '../src/lib/providers/jev/provider.server.ts';
import { DEFAULT_VISION_MODEL } from '../src/lib/providers/vision/contract.ts';
import { createChatTransport, createVisionProvider } from '../src/lib/providers/vision/vision.server.ts';
import { createDemoProvider } from './lib/demoProvider.ts';
import { cropBox, cropRegion, prepareFrame, type PreparedImage } from './lib/images.ts';

const PER_JOB_LIMIT = 20; // PRD-FEAT-010 suggested MVP limit

const { values: args } = parseArgs({
	options: {
		fixtures: { type: 'string', default: 'fixtures/demo' },
		provider: { type: 'string', default: 'demo' },
		images: { type: 'string' },
		'max-requests': { type: 'string', default: '40' },
		'max-identity-pairs': { type: 'string', default: '10' },
		'no-identity': { type: 'boolean', default: false },
		'dry-run': { type: 'boolean', default: false },
		'confirm-paid': { type: 'boolean', default: false },
		out: { type: 'string', default: 'eval-results' }
	}
});

const PROVIDERS = ['demo', 'jev', 'vision', 'vision-jev'] as const;
type ProviderId = (typeof PROVIDERS)[number];
const providerId: ProviderId = (PROVIDERS as readonly string[]).includes(args.provider)
	? (args.provider as ProviderId)
	: fail(`Unknown provider "${args.provider}". Use one of: ${PROVIDERS.join(', ')}`);
const visionModel = process.env.VISION_MODEL || DEFAULT_VISION_MODEL;
const modelLabel =
	providerId === 'jev' ? JEV_MODEL : providerId === 'vision' ? visionModel : providerId === 'vision-jev' ? `${visionModel} + ${JEV_MODEL}` : null;
const maxRequests = positiveInt(args['max-requests'], 'max-requests');
const maxPairs = positiveInt(args['max-identity-pairs'], 'max-identity-pairs');

const fixturesDir = path.resolve(args.fixtures);
const gt = await loadGroundTruth(fixturesDir);
const selected = args.images ? new Set(args.images.split(',')) : null;
const images = gt.images.filter((i) => !selected || selected.has(i.id));
const pairs = args['no-identity'] ? [] : pickPairs(identityPairs({ ...gt, images }), maxPairs);

// Upper bound per image: JEV count + locate + 3 strips; vision 1 (+ JEV checks). One per identity pair.
const plannedRequests = images.length * (providerId === 'vision' ? 1 : providerId === 'vision-jev' ? 3 : 5) + pairs.length;
const isDemo = providerId === 'demo' || gt.demo;

console.log(`Fixtures: ${fixturesDir}${gt.demo ? ' [Demo fixtures]' : ''}`);
console.log(`Provider: ${providerId}${modelLabel ? ` (${modelLabel} via OpenRouter)` : ' [Demo]'}`);
console.log(`Images: ${images.length}, identity pairs: ${pairs.length}, planned requests ≤ ${plannedRequests}, run budget ${maxRequests}`);

if (args['dry-run']) {
	console.log('Dry run: no requests sent.');
	process.exit(0);
}
if (providerId !== 'demo' && !args['confirm-paid']) {
	fail('Provider requests are paid. Re-run with --confirm-paid (and check --max-requests) to send them.');
}

const technicalLog: unknown[] = [];
// Lets the demo provider recognise which fixture or crop it was handed.
const frameSource = new WeakMap<object, AnnotatedImage>();
const cropSource = new WeakMap<object, IdentityPair['a']>();

const apiKey = process.env.OPEN_ROUTER_API_KEY ?? '';
const log = (e: unknown) => technicalLog.push(e);
const provider: AnalysisProvider = createProvider(providerId);

function createProvider(id: ProviderId): AnalysisProvider {
	if (id === 'demo') return createDemoProvider({ frame: (img) => frameSource.get(img), crop: (img) => cropSource.get(img) });
	if (id === 'jev') {
		return createJevProvider({ transport: createJevTransport({ apiKey, log }), crop: (image, region) => cropRegion(image, region) });
	}
	const chat = createChatTransport({ apiKey, log });
	if (id === 'vision') return createVisionProvider({ transport: chat, model: visionModel });
	// vision-jev: the vision-LLM proposes boxes, JEV checks each one and judges identity.
	const jevTransport = createJevTransport({ apiKey, log });
	const jev = createJevProvider({ transport: jevTransport });
	const vision = createVisionProvider({
		transport: chat,
		model: visionModel,
		verifier: createJevVerifier({ transport: jevTransport, crop: (image, box) => cropBox(image, box) })
	});
	return { id: 'vision', discover: vision.discover, compareIdentity: jev.compareIdentity };
}

const runBudget = new JobBudget(maxRequests);
let usage: Usage = emptyUsage();
const frames = new Map<string, PreparedImage>();
const detectionResults: (ImageDetectionResult & { durationMs: number; requests: number; detections: unknown[]; rejected: unknown[] })[] = [];
const errors: { stage: string; id: string; message: string }[] = [];
let validBoxes = 0;
let rejectedBoxes = 0;
let stopped: string | null = null;

for (const image of images) {
	if (stopped) break;
	try {
		const frame = await loadFrame(image);
		const job = new JobBudget(PER_JOB_LIMIT, runBudget);
		const r = await provider.discover(frame, job);
		usage = addUsage(usage, r.usage);
		validBoxes += r.detections.length;
		rejectedBoxes += r.rejected.filter((x) => /^box(__|:)/.test(x.reason)).length;
		const score = scoreImage(image, r.detections.map((d) => ({ label: d.label, box: d.box })));
		detectionResults.push({ ...score, durationMs: r.durationMs, requests: r.usage.requests, detections: r.detections, rejected: r.rejected });
		console.log(`  ${image.id}: TP ${score.truePositives} FP ${score.falsePositives} FN ${score.falseNegatives} (${r.usage.requests} req, ${r.durationMs} ms)`);
	} catch (e) {
		stopped = recordError('discover', image.id, e);
	}
}

const identityOutcomes: (IdentityOutcome & { rawScore: number | null; durationMs: number })[] = [];
for (const pair of pairs) {
	if (stopped) break;
	try {
		const a = await crop(pair.a);
		const b = await crop(pair.b);
		const r = await provider.compareIdentity(a, b, new JobBudget(1, runBudget));
		usage = addUsage(usage, r.usage);
		identityOutcomes.push({ pair, outcome: r.outcome, rawScore: r.rawScore, durationMs: r.durationMs });
		console.log(`  ${pair.a.imageId}/${pair.a.objectKey} vs ${pair.b.imageId}/${pair.b.objectKey}: ${r.outcome} (expected ${pair.expectedSame ? 'same' : 'different'})`);
	} catch (e) {
		stopped = recordError('identity', `${pair.a.objectKey}~${pair.b.objectKey}`, e);
	}
}

const detection = summariseDetection(detectionResults, validBoxes, rejectedBoxes);
const identity = summariseIdentity(identityOutcomes);
const latencies = [...detectionResults.map((r) => r.durationMs), ...identityOutcomes.map((r) => r.durationMs)].sort((a, b) => a - b);

const report = {
	label: isDemo ? 'DEMO — not a measurement of provider quality' : 'Live provider measurement',
	createdAt: new Date().toISOString(),
	provider: providerId,
	model: modelLabel,
	fixtures: { path: path.relative(process.cwd(), fixturesDir), demo: gt.demo, images: images.length },
	gate: GATE,
	detection,
	identity,
	usage,
	latencyMs: { median: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), max: latencies.at(-1) ?? null },
	stoppedEarly: stopped,
	errors,
	perImage: detectionResults,
	identityOutcomes,
	technicalLog
};

const outDir = path.resolve(args.out, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, 'report.md'), markdown(report));
console.log(`\n${markdown(report)}\nWritten to ${path.relative(process.cwd(), outDir)}`);

// ---------------------------------------------------------------------------

async function loadGroundTruth(dir: string): Promise<GroundTruth> {
	const file = path.join(dir, 'groundtruth.json');
	const parsed = GroundTruthSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
	if (!parsed.success) {
		fail(`Invalid ${file}:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
	}
	return parsed.data;
}

async function loadFrame(image: AnnotatedImage): Promise<PreparedImage> {
	const cached = frames.get(image.id);
	if (cached) return cached;
	const file = path.join(fixturesDir, image.file);
	if (path.dirname(file) !== fixturesDir) fail(`Fixture file "${image.file}" must sit directly in the fixture folder`);
	const frame = await prepareFrame(await readFile(file));
	const declared = image.width / image.height;
	const actual = frame.width / frame.height;
	if (Math.abs(declared - actual) > 0.02) {
		throw new Error(`Annotated as ${image.width}×${image.height} but the oriented file is ${frame.sourceWidth}×${frame.sourceHeight}; boxes would not line up (T16)`);
	}
	frames.set(image.id, frame);
	frameSource.set(frame, image);
	return frame;
}

async function crop(ref: IdentityPair['a']) {
	const image = images.find((i) => i.id === ref.imageId)!;
	const obj = image.objects.find((o) => o.objectKey === ref.objectKey)!;
	const c = await cropBox(await loadFrame(image), obj.box);
	cropSource.set(c, ref);
	return c;
}

/** Balanced sample: positives first, then hard negatives, then other negatives. */
function pickPairs(all: IdentityPair[], n: number): IdentityPair[] {
	const pos = all.filter((p) => p.expectedSame);
	const hard = all.filter((p) => p.hardNegative);
	const out: IdentityPair[] = [];
	for (let i = 0; out.length < n && (i < pos.length || i < hard.length); i++) {
		if (i < pos.length && out.length < n) out.push(pos[i]);
		if (i < hard.length && out.length < n) out.push(hard[i]);
	}
	return out;
}

function recordError(stage: string, id: string, e: unknown): string | null {
	const message = e instanceof Error ? e.message : String(e);
	errors.push({ stage, id, message });
	console.error(`  ${stage} ${id}: ${message}`);
	// Stop on budget exhaustion and on any provider error: no automatic retry of paid requests.
	if (e instanceof BudgetExceededError) return 'run budget reached';
	if (e instanceof Error && (e.name === 'JevRequestError' || e.name === 'VisionRequestError')) return `provider error: ${message}`;
	return null;
}

function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function pct(x: number | null): string {
	return x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`;
}

function mark(ok: boolean | null): string {
	return ok === null ? 'n/a' : ok ? 'PASS' : 'FAIL';
}

function markdown(r: typeof report): string {
	const d = r.detection;
	const i = r.identity;
	return [
		`# Phase 0 evaluation — ${r.label}`,
		'',
		`Provider: ${r.provider}${r.model ? ` (${r.model})` : ''}. Fixtures: ${r.fixtures.path} (${r.fixtures.images} images${r.fixtures.demo ? ', Demo' : ''}).`,
		'',
		'## Detection',
		'',
		'| Metric | Value | Gate |',
		'| --- | --- | --- |',
		`| Precision | ${pct(d.precision)} | ≥ ${GATE.precision * 100} %: ${mark(d.gate.precision)} |`,
		`| Recall | ${pct(d.recall)} | ≥ ${GATE.recall * 100} %: ${mark(d.gate.recall)} |`,
		`| Images | ${d.images} | ≥ ${GATE.minImages}: ${mark(d.gate.enoughImages)} |`,
		`| Usable-box rate | ${pct(d.usableBoxRate)} | |`,
		`| Label agreement (of matched) | ${pct(d.labelAgreementRate)} | |`,
		`| TP / FP / FN | ${d.truePositives} / ${d.falsePositives} / ${d.falseNegatives} | IoU ≥ ${GATE.iouThreshold} |`,
		`| Hallucinations in empty regions | ${d.hallucinationsInEmptyRegions} | T11 |`,
		`| Repeated-instance failures | ${d.repeatedInstanceFailures} | T03 |`,
		'',
		'## Identity',
		'',
		`Pairs: ${i.pairs}. Same object: ${i.positives.possibleSame} possible same, ${i.positives.unlikelySame} unlikely same, ${i.positives.uncertain} uncertain.`,
		`Different objects: ${i.negatives.possibleSame} possible same, ${i.negatives.unlikelySame} unlikely same, ${i.negatives.uncertain} uncertain.`,
		`False-same rate ${pct(i.falseSameRate)} (hard negatives proposed as same: ${i.hardNegativeFalseSame}). False-different rate ${pct(i.falseDifferentRate)}. Uncertain ${pct(i.uncertainRate)}.`,
		'',
		'## Cost and latency',
		'',
		`Requests: ${r.usage.requests}. Input tokens: ${r.usage.inputTokens ?? 'not reported'}. Reported cost: ${r.usage.reportedCost === null ? 'not reported' : `$${r.usage.reportedCost.toFixed(6)}`}.`,
		`Latency per job: median ${r.latencyMs.median ?? 'n/a'} ms, p90 ${r.latencyMs.p90 ?? 'n/a'} ms, max ${r.latencyMs.max ?? 'n/a'} ms.`,
		r.stoppedEarly ? `\n**Stopped early:** ${r.stoppedEarly}.` : '',
		r.errors.length ? `\nErrors: ${r.errors.length}. See report.json.` : ''
	].join('\n');
}

function positiveInt(v: string | undefined, name: string): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a positive integer`);
	return n;
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}
