<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { displayStatus, newToInventory, recompute, reviewMovement, STATUS_ICON, summarise, type DisplayStatus } from '#lib/compare/compare.ts';
	import { roomOfScan } from '#lib/inventory/queries.ts';
	import { setUncertainViewpoint } from '#lib/inventory/scanJob.ts';
	import { app, apply } from '#lib/storage/store.svelte.ts';
	import { link, readSession } from '#lib/storage/session.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import FramedImage, { type FrameBox } from '#lib/components/FramedImage.svelte';
	import NotOnDevice from '#lib/components/NotOnDevice.svelte';

	const params = $derived(readSession(page.url));
	const data = $derived(app.data);
	const scan = $derived(data?.scans.find((s) => s.id === params.session));
	const ref = $derived(scan?.referenceScanId ? data?.scans.find((s) => s.id === scan.referenceScanId) : undefined);
	const curImg = $derived(scan ? data?.assets.find((a) => a.id === scan.imageAssetId) : undefined);
	const refImg = $derived(ref ? data?.assets.find((a) => a.id === ref.imageAssetId) : undefined);
	const room = $derived(scan && data ? roomOfScan(data, scan) : undefined);
	const items = $derived(scan && data ? data.comparisonItems.filter((c) => c.scanId === scan.id) : []);
	const summary = $derived(scan && data ? summarise(data, scan.id) : null);
	let selected = $state<string | null>(null);

	// Links may have changed in review since the last visit; derive again (user verdicts are kept).
	onMount(() => {
		if (app.data && scan) void apply(recompute(app.data, scan.id));
	});

	const ORDER: DisplayStatus[] = ['possibly_moved', 'not_rediscovered', 'unresolved', 'moved_confirmed', 'found_no_change', 'new_to_inventory'];

	// Numbers are shared by both images: item n has the same number on the reference and the current frame.
	const numbered = $derived(items.map((c, i) => ({ c, n: i + 1 })));
	const obsById = $derived(new Map((data?.observations ?? []).map((o) => [o.id, o])));
	const refBoxes = $derived<FrameBox[]>(
		numbered.flatMap(({ c, n }) => {
			const o = obsById.get(c.baselineObservationId);
			return o ? [{ id: c.id, n, box: o.box, label: o.label, style: 'confirmed' as const }] : [];
		})
	);
	const curBoxes = $derived<FrameBox[]>(
		numbered.flatMap(({ c, n }) => {
			const o = c.currentObservationId ? obsById.get(c.currentObservationId) : undefined;
			return o ? [{ id: c.id, n, box: o.box, label: o.label, style: displayStatus(c) === 'found_no_change' || displayStatus(c) === 'moved_confirmed' ? ('confirmed' as const) : ('proposal' as const) }] : [];
		})
	);

	function nameOf(baselineObservationId: string) {
		const o = obsById.get(baselineObservationId);
		const obj = o?.objectId ? data?.objects.find((x) => x.id === o.objectId) : undefined;
		return obj?.name ?? o?.label ?? '?';
	}
</script>

{#if !data || !scan || !curImg}
	<NotOnDevice />
{:else if !ref || !refImg}
	<p class="notice error">{t('compare.noReference')}</p>
{:else}
	<p><a href={link('/room', { room: room?.id })}>← {room?.name}</a></p>
	<h1>{t('compare.title')}</h1>
	<p class="small muted">
		{t('compare.reference')}: {new Date(ref.capturedAt).toLocaleString()} → {t('compare.current')}: {new Date(scan.capturedAt).toLocaleString()}
		{#if scan.demo}<span class="badge demo">◆ {t('mode.demo')}</span>{/if}
	</p>

	<label class="check">
		<input
			type="checkbox"
			checked={scan.uncertainViewpoint}
			onchange={async (e) => {
				await apply(setUncertainViewpoint(data, scan.id, e.currentTarget.checked));
				await apply(recompute(app.data!, scan.id));
			}}
		/>
		{t('compare.uncertainViewpoint')}
	</label>

	<div class="pair">
		<figure>
			<figcaption class="small">{t('compare.reference')}</figcaption>
			<FramedImage assetId={refImg.id} width={refImg.width} height={refImg.height} alt={t('compare.reference')} boxes={refBoxes} {selected} onselect={(id) => (selected = id)} />
		</figure>
		<figure>
			<figcaption class="small">{t('compare.current')}</figcaption>
			<FramedImage assetId={curImg.id} width={curImg.width} height={curImg.height} alt={t('compare.current')} boxes={curBoxes} {selected} onselect={(id) => (selected = id)} />
		</figure>
	</div>

	{#if summary}
		<h2>{t('compare.summary')}</h2>
		<ul class="summary">
			{#each ORDER as s (s)}
				<li><span aria-hidden="true" class="icon">{STATUS_ICON[s]}</span> {t(`compare.status.${s}`)} <strong class="num">{summary[s]}</strong></li>
			{/each}
		</ul>
	{/if}

	<h2>{t('compare.items')}</h2>
	<ol class="list">
		{#each numbered as { c, n } (c.id)}
			{@const status = displayStatus(c)}
			<li class:sel={selected === c.id}>
				<div class="row">
					<button type="button" class="num-btn" aria-pressed={selected === c.id} onclick={() => (selected = c.id)}>{n}</button>
					<span class="grow">
						<strong>{nameOf(c.baselineObservationId)}</strong><br />
						<span class="small"><span aria-hidden="true">{STATUS_ICON[status]}</span> {t(`compare.status.${status}`)}</span>
						{#if c.reviewedAt}<span class="small muted"> · {t('compare.reviewedByYou')}</span>{/if}
					</span>
				</div>
				{#if status === 'possibly_moved' || (c.identityState === 'confirmed' && c.visibilityState === 'found' && c.movementState !== 'unknown')}
					<div class="row actions">
						<span class="small muted">{t('compare.moveQuestion')}</span>
						<button type="button" aria-pressed={c.movementState === 'confirmed_moved'} onclick={() => apply(reviewMovement(data, c.id, true))}>↔ {t('compare.moved')}</button>
						<button type="button" aria-pressed={c.movementState === 'no_change_detected' && !!c.reviewedAt} onclick={() => apply(reviewMovement(data, c.id, false))}>✓ {t('compare.notMoved')}</button>
					</div>
				{/if}
			</li>
		{/each}
		{#each newToInventory(data, scan.id) as o (o.id)}
			<li><span aria-hidden="true">＋</span> {data.objects.find((x) => x.id === o.objectId)?.name ?? o.label} · <span class="small">{t('compare.status.new_to_inventory')}</span></li>
		{/each}
	</ol>

	<p class="notice small">{t('compare.noChangeExplain')}</p>
	<div class="row">
		<a class="button" href={link('/review', { session: scan.id })}>{t('compare.backToReview')}</a>
		<a class="button primary" href={link('/room', { room: room?.id })}>{t('common.done')}</a>
	</div>
{/if}

<style>
	.pair {
		display: grid;
		gap: 12px;
	}
	@media (min-width: 720px) {
		.pair {
			grid-template-columns: 1fr 1fr;
		}
	}
	figure {
		margin: 0;
	}
	.summary {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 6px;
	}
	.summary li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding: 8px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.summary strong {
		margin-left: auto;
	}
	.icon {
		min-width: 1.6em;
		font-family: var(--font-mono);
	}
	.grow {
		flex: 1;
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
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: var(--tap);
	}
</style>
