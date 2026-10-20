<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { cropFrame } from '#lib/camera/image.ts';
	import { recompute } from '#lib/compare/compare.ts';
	import type { Box } from '#lib/geometry/box.ts';
	import { observationsOfScan, lastSeen, observationsOf, roomOfScan } from '#lib/inventory/queries.ts';
	import { setReference } from '#lib/inventory/rooms.ts';
	import { frameAsset, observationCrop } from '#lib/inventory/runner.ts';
	import { addManualObservation, editObservation, finishScan, reviewManually } from '#lib/inventory/scanJob.ts';
	import { candidatesFor } from '#lib/matching/candidates.ts';
	import { answerNo, answerSkip, answerYes, createObjectFrom, dismiss, unlink, type DecisionResult } from '#lib/matching/decisions.ts';
	import { identityLive } from '#lib/providers/live.ts';
	import type { MatchProposal } from '#lib/providers/types.ts';
	import { app, apply, assetBlob } from '#lib/storage/store.svelte.ts';
	import { link, readSession } from '#lib/storage/session.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';
	import FramedImage, { type FrameBox } from '#lib/components/FramedImage.svelte';
	import NotOnDevice from '#lib/components/NotOnDevice.svelte';

	const params = $derived(readSession(page.url));
	const data = $derived(app.data);
	const scan = $derived(data?.scans.find((s) => s.id === params.session));
	const image = $derived(scan && data ? data.assets.find((a) => a.id === scan.imageAssetId) : undefined);
	const job = $derived(scan && data ? data.analysisJobs.filter((j) => j.scanId === scan.id).at(-1) : undefined);
	const viewpoint = $derived(scan && data ? data.viewpoints.find((v) => v.id === scan.viewpointId) : undefined);
	const room = $derived(scan && data ? roomOfScan(data, scan) : undefined);
	const observations = $derived(scan && data ? observationsOfScan(data, scan.id) : []);
	const active = $derived(observations.filter((o) => o.resolution !== 'ignored'));

	let selected = $state<string | null>(null);
	let marking = $state(false);
	let pendingBox = $state<Box | null>(null);
	let pendingLabel = $state('');
	let skipped = $state<string[]>([]);
	let otherRooms = $state(false);
	let newName = $state('');
	let duplicateOf = $state<string | null>(null);
	let proposal = $state<{ observationId: string; objectId: string; outcome: MatchProposal['outcome'] } | null>(null);
	let asking = $state(false);
	let message = $state<string | null>(null);
	let suggestReference = $state(false);

	const queue = $derived(active.filter((o) => o.resolution === 'unresolved' && !skipped.includes(o.id)));
	const current = $derived(
		(selected ? active.find((o) => o.id === selected && o.resolution === 'unresolved') : undefined) ?? queue[0]
	);
	const reviewed = $derived(active.filter((o) => o.resolution !== 'unresolved').length + active.filter((o) => skipped.includes(o.id) && o.resolution === 'unresolved').length);
	const candidates = $derived(current && data ? candidatesFor(data, current.id, { otherRooms, limit: otherRooms ? 20 : 5 }) : []);
	let candidateIndex = $state(0);
	const candidate = $derived(candidates[Math.min(candidateIndex, candidates.length - 1)]);

	$effect(() => {
		// New observation in focus: reset the per-question state.
		void current?.id;
		candidateIndex = 0;
		duplicateOf = null;
		proposal = null;
		newName = current?.label ?? '';
	});

	const boxes = $derived<FrameBox[]>(
		observations.map((o, i) => ({
			id: o.id,
			n: i + 1,
			box: o.box,
			label: o.label,
			style: o.resolution === 'ignored' ? 'dismissed' : o.resolution === 'unresolved' ? 'proposal' : 'confirmed'
		}))
	);

	async function decide(r: DecisionResult) {
		message = null;
		if (r.kind === 'needsDuplicateReview') {
			duplicateOf = r.otherObservationId;
			return;
		}
		if (r.kind === 'invalid') {
			message = r.reason;
			return;
		}
		try {
			await apply(r.mutation);
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
			return;
		}
		selected = null;
		// Keep keyboard and screen-reader users on the next question (PRD-SEC-006.7).
		queueMicrotask(() => document.getElementById('same-title')?.focus());
	}

	async function addMarked() {
		if (!data || !scan || !pendingBox || !pendingLabel.trim()) return;
		const frame = await assetBlob(scan.imageAssetId);
		let crop = null;
		const blobs: { id: string; blob: Blob }[] = [];
		if (frame) {
			const c = await frameAsset(await cropFrame(frame, pendingBox));
			crop = c.asset;
			blobs.push({ id: c.asset.id, blob: c.blob });
		}
		await apply(addManualObservation(data, scan.id, pendingBox, pendingLabel, crop), blobs);
		pendingBox = null;
		pendingLabel = '';
		marking = false;
	}

	async function askAi() {
		if (!current || !candidate) return;
		asking = true;
		proposal = null;
		const prior = observationsOf(data!, candidate.object.id).at(-1);
		const [a, b] = await Promise.all([prior ? observationCrop(prior.id) : null, observationCrop(current.id)]);
		if (a && b) {
			const r = await identityLive(a, b);
			if (r.ok) proposal = { observationId: current.id, objectId: candidate.object.id, outcome: r.value.outcome };
			else message = t(`scan.fail.${r.error.kind}`);
		}
		asking = false;
	}

	async function finish() {
		if (!data || !scan) return;
		if (scan.status !== 'review') await apply(reviewManually(data, scan.id));
		const f = finishScan(app.data!, scan.id);
		if (!f) return;
		await apply(f.mutation);
		if (scan.mode === 'compare') {
			await apply(recompute(app.data!, scan.id));
			await goto(link('/compare', { session: scan.id }));
			return;
		}
		if (f.suggestReference) suggestReference = true;
		else await goto(link('/room', { room: room?.id }));
	}

	function priorObservation(objectId: string) {
		const obs = observationsOf(data!, objectId);
		return obs.filter((o) => o.scanId !== scan?.id).at(-1) ?? obs.at(-1);
	}
</script>

{#if !data || !scan || !image}
	<NotOnDevice />
{:else}
	<p><a href={link('/room', { room: room?.id })}>← {room?.name}</a></p>
	<h1>{t('review.title')} <span class="small muted">· {viewpoint?.name} · {new Date(scan.capturedAt).toLocaleString()}</span></h1>

	<!-- Analysis status: no detections, partial, technical failure and Demo are all distinguished (PRD-FEAT-003.5). -->
	{#if scan.demo}<p class="notice"><span class="badge demo">◆ {t('mode.demo')}</span> {t('review.demoNote')}</p>{/if}
	{#if job?.status === 'done' && active.some((o) => o.source !== 'manual')}
		<p class="notice">✓ {t('review.completeMaybeMissed')}</p>
	{:else if job?.status === 'done'}
		<p class="notice">◌ {t('review.noDetections')}</p>
	{:else if job?.status === 'failed' || job?.status === 'cancelled'}
		<p class="notice error">⚠ {t('review.failed')} <code>{job.error}</code> <a href={link('/scan', { room: room?.id, viewpoint: viewpoint?.id, mode: scan.mode })}>{t('review.scanAgain')}</a></p>
	{/if}
	{#if job && job.callCount > 0}
		<p class="small muted">{t('review.usage', { requests: job.callCount, cost: job.usage.reportedCost !== null ? `$${job.usage.reportedCost.toFixed(4)}` : t('review.costUnknown') })}</p>
	{/if}

	<div class="grid-2">
		<div class="stack">
			<FramedImage
				assetId={image.id}
				width={image.width}
				height={image.height}
				alt={t('review.frozenAlt')}
				{boxes}
				{selected}
				onselect={(id) => (selected = id)}
				draw={marking}
				ondraw={(b) => (pendingBox = b)}
			/>
			<div class="row">
				<button type="button" aria-pressed={marking} onclick={() => ((marking = !marking), (pendingBox = null))}>
					{marking ? t('review.stopMarking') : `＋ ${t('review.markMissed')}`}
				</button>
				<span class="small muted">{t('review.legend')}</span>
			</div>
			{#if pendingBox}
				<form class="row card" onsubmit={(e) => (e.preventDefault(), addMarked())}>
					<label class="grow">{t('review.whatIsIt')}<input type="text" bind:value={pendingLabel} maxlength="80" /></label>
					<button class="primary" type="submit" disabled={!pendingLabel.trim()}>{t('common.add')}</button>
				</form>
			{/if}

			<h2>{t('review.listTitle', { n: active.length })}</h2>
			<ol class="list">
				{#each observations as o, i (o.id)}
					{@const obj = o.objectId ? data.objects.find((x) => x.id === o.objectId) : undefined}
					<li class:sel={selected === o.id}>
						<div class="row">
							<button type="button" class="num-btn" aria-pressed={selected === o.id} onclick={() => (selected = o.id)}>{i + 1}</button>
							<span class="thumb"><AssetImg assetId={o.cropAssetId} alt="" /></span>
							<span class="grow">
								<strong>{o.label}</strong>
								{#if o.source === 'demo'}<span class="badge demo">◆ {t('mode.demo')}</span>{/if}
								{#if o.presence === 'uncertain'}<span class="badge">? {t('review.presenceUncertain')}</span>{/if}
								<br />
								<span class="small muted">
									{#if o.resolution === 'unresolved'}◌ {t('status.unresolved')}
									{:else if o.resolution === 'ignored'}✕ {t('review.dismissed')}
									{:else if o.resolution === 'created'}＋ {t('status.newItem', { name: obj?.name ?? '' })}
									{:else}✓ {t('status.linked', { name: obj?.name ?? '' })}{/if}
								</span>
							</span>
						</div>
						{#if selected === o.id}
							<div class="row actions">
								<label class="grow">{t('review.label')}
									<input type="text" value={o.label} maxlength="80" onchange={(e) => apply(editObservation(data, o.id, { label: e.currentTarget.value }))} />
								</label>
								{#if o.resolution === 'unresolved'}
									<button type="button" onclick={() => decide(dismiss(data, o.id))}>✕ {t('review.dismiss')}</button>
								{:else if o.resolution === 'linked' || o.resolution === 'created'}
									<button type="button" onclick={() => decide(unlink(data, o.id))}>↺ {t('review.unlink')}</button>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		</div>

		<aside class="stack">
			{#if current}
				<section class="card stack" aria-labelledby="same-title">
					<div class="row between">
						<h2 id="same-title" tabindex="-1">{t('same.title')}</h2>
						<span class="num small" aria-live="polite">{t('same.progress', { done: reviewed, total: active.length })}</span>
					</div>

					{#if candidate}
						{@const prior = priorObservation(candidate.object.id)}
						{@const seen = lastSeen(data, candidate.object.id)}
						<div class="pair">
							<figure>
								<div class="crop"><AssetImg assetId={prior?.cropAssetId} alt={t('same.before')} /></div>
								<figcaption class="small">
									{t('same.before')}: <strong>{candidate.object.name}</strong><br />
									{seen?.room?.name ?? '—'} · {seen ? new Date(seen.scan.capturedAt).toLocaleDateString() : ''}
								</figcaption>
							</figure>
							<figure>
								<div class="crop"><AssetImg assetId={current.cropAssetId} alt={t('same.now')} /></div>
								<figcaption class="small">{t('same.now')}: <strong>{current.label}</strong> ({observations.indexOf(current) + 1})<br />{room?.name}</figcaption>
							</figure>
						</div>

						{#if proposal?.objectId === candidate.object.id}
							<p class="notice small">🤖 {t('same.aiProposal')}: {t(`same.outcome.${proposal.outcome}`)} — {t('same.aiNotProof')}</p>
						{/if}

						{#if duplicateOf}
							<div class="notice warn" role="alert">
								<p>⚠ {t('same.duplicateWarning', { n: observations.findIndex((o) => o.id === duplicateOf) + 1 })}</p>
								<div class="row">
									<button type="button" onclick={() => decide(answerYes(data, current.id, candidate.object.id, { confirmDuplicate: true }))}>{t('same.duplicateConfirm')}</button>
									<button type="button" onclick={() => (duplicateOf = null)}>{t('common.cancel')}</button>
								</div>
							</div>
						{:else}
							<div class="answers">
								<button class="primary" type="button" onclick={() => decide(answerYes(data, current.id, candidate.object.id))}>✓ {t('same.yes')}</button>
								<button type="button" onclick={() => decide(answerNo(data, current.id, candidate.object.id))}>✕ {t('same.no')}</button>
								<button
									type="button"
									onclick={async () => {
										await decide(answerSkip(data, current.id, candidate.object.id));
										skipped = [...skipped, current.id];
									}}>→ {t('same.skip')}</button
								>
							</div>
						{/if}
						{#if candidates.length > 1}
							<p class="small muted">{t('same.candidateOf', { n: Math.min(candidateIndex, candidates.length - 1) + 1, total: candidates.length })}
								<button type="button" class="link" onclick={() => (candidateIndex = (candidateIndex + 1) % candidates.length)}>{t('same.nextCandidate')}</button>
							</p>
						{/if}
						{#if app.mode === 'live'}
							<button type="button" disabled={asking} onclick={askAi}>🤖 {asking ? t('scan.analysing') : t('same.askAi')}</button>
						{/if}
					{:else}
						<p>{t('same.noCandidates', { label: current.label })}</p>
						<button
							type="button"
							onclick={async () => {
								await decide(answerSkip(data, current.id, null));
								skipped = [...skipped, current.id];
							}}>→ {t('same.skip')}</button
						>
					{/if}

					<label class="check"><input type="checkbox" bind:checked={otherRooms} /> {t('same.searchOtherRooms')}</label>

					<form class="stack" onsubmit={(e) => (e.preventDefault(), decide(createObjectFrom(data, current.id, newName, null)))}>
						<label>{t('same.newItemName')}<input type="text" bind:value={newName} maxlength="80" /></label>
						<button type="submit" disabled={!newName.trim()}>＋ {t('same.createNew')}</button>
					</form>
					{#if message}<p class="notice error small" role="alert">{message}</p>{/if}
				</section>
			{:else}
				<section class="card stack">
					<p>✓ {t('review.allReviewed', { n: active.length })}</p>
					{#if skipped.length}<button type="button" onclick={() => (skipped = [])}>{t('review.revisitSkipped', { n: skipped.length })}</button>{/if}
				</section>
			{/if}

			{#if suggestReference && viewpoint}
				<div class="card stack" role="alertdialog" aria-labelledby="ref-q">
					<p id="ref-q">★ {t('review.suggestReference', { viewpoint: viewpoint.name })}</p>
					<div class="row">
						<button
							class="primary"
							type="button"
							onclick={async () => {
								await apply(setReference(app.data!, viewpoint.id, scan.id));
								await goto(link('/room', { room: room?.id }));
							}}>{t('common.yes')}</button
						>
						<a class="button" href={link('/room', { room: room?.id })}>{t('common.notNow')}</a>
					</div>
				</div>
			{:else if scan.status !== 'complete'}
				<button class="primary" type="button" onclick={finish}>{scan.mode === 'compare' ? t('review.finishCompare') : t('review.finish')}</button>
			{:else if scan.mode === 'compare'}
				<a class="button primary" href={link('/compare', { session: scan.id })}>{t('review.openComparison')}</a>
			{/if}
		</aside>
	</div>
{/if}

<style>
	h1 {
		font-size: 1.4rem;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.between {
		justify-content: space-between;
	}
	.num-btn {
		font-family: var(--font-mono);
		min-width: 44px;
		padding: 0;
	}
	li.sel {
		border: 3px solid var(--box-selected);
	}
	.actions {
		margin-top: 8px;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.pair figure {
		margin: 0;
	}
	.crop {
		aspect-ratio: 1;
		border-radius: 8px;
		overflow: hidden;
		background: var(--line);
	}
	.crop :global(img) {
		object-fit: contain;
		background: #000;
	}
	.answers {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.answers button {
		min-height: 52px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: var(--tap);
	}
	.link {
		border: none;
		background: transparent;
		text-decoration: underline;
		min-height: var(--tap);
		padding: 0 4px;
	}
</style>
