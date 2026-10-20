<script lang="ts">
	import { activeObjects, observationsOf, roomOfScan } from '#lib/inventory/queries.ts';
	import { mergeObjects, renameObject, setNote, undo, unlink, type DecisionResult } from '#lib/matching/decisions.ts';
	import { app, apply } from '#lib/storage/store.svelte.ts';
	import { link } from '#lib/storage/session.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';

	let { objectId }: { objectId: string } = $props();

	const data = $derived(app.data!);
	const obj = $derived(data.objects.find((o) => o.id === objectId));
	const canonical = $derived(obj?.mergedIntoId ? data.objects.find((o) => o.id === obj.mergedIntoId) : undefined);
	const history = $derived(
		obj
			? observationsOf(data, obj.id)
					.map((o) => ({ o, scan: data.scans.find((s) => s.id === o.scanId)! }))
					.filter((x) => x.scan)
					.sort((a, b) => b.scan.capturedAt.localeCompare(a.scan.capturedAt))
			: []
	);
	const events = $derived(
		data.reviewEvents
			.filter((e) => !e.undoneAt && (e.entityId === objectId || history.some((h) => h.o.id === e.entityId)))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 10)
	);

	let name = $state('');
	let note = $state('');
	let mergeTarget = $state('');
	let error = $state<string | null>(null);

	$effect(() => {
		name = obj?.name ?? '';
		note = obj?.notes ?? '';
	});

	async function run(r: DecisionResult) {
		error = null;
		if (r.kind === 'ok') await apply(r.mutation);
		else if (r.kind === 'invalid') error = r.reason;
	}
</script>

<p><a href="/inventory">← {t('nav.inventory')}</a></p>
{#if !obj}
	<p class="notice error">{t('inventory.notFound')}</p>
{:else}
	{#if canonical}
		<p class="notice">{t('inventory.mergedInto')} <a href={link('/inventory', { object: canonical.id })}>{canonical.name}</a></p>
	{/if}
	<form class="row" onsubmit={(e) => (e.preventDefault(), run(renameObject(data, obj.id, name)))}>
		<label class="grow"><span class="visually-hidden">{t('inventory.name')}</span><input class="title" type="text" bind:value={name} maxlength="80" /></label>
		<button type="submit" disabled={name.trim() === obj.name}>{t('common.save')}</button>
	</form>
	<form class="stack" onsubmit={(e) => (e.preventDefault(), run(setNote(data, obj.id, note)))}>
		<label>{t('inventory.note')}<textarea rows="2" maxlength="2000" bind:value={note}></textarea></label>
		<button type="submit" disabled={note === obj.notes}>{t('inventory.saveNote')}</button>
	</form>

	<h2>{t('inventory.history', { n: history.length })}</h2>
	<ol class="list">
		{#each history as { o, scan } (o.id)}
			<li class="row">
				<span class="thumb"><AssetImg assetId={o.cropAssetId} alt="" /></span>
				<span class="grow small">
					{new Date(scan.capturedAt).toLocaleString()} · {roomOfScan(data, scan)?.name} ·
					{data.viewpoints.find((v) => v.id === scan.viewpointId)?.name}
					{#if scan.demo}<span class="badge demo">◆ {t('mode.demo')}</span>{/if}
				</span>
				<a class="button" href={link('/review', { session: scan.id })}>{t('common.open')}</a>
				<button type="button" onclick={() => run(unlink(data, o.id))}>↺ {t('review.unlink')}</button>
			</li>
		{/each}
	</ol>

	{#if !obj.mergedIntoId}
		<h2>{t('inventory.mergeTitle')}</h2>
		<p class="small muted">{t('inventory.mergeExplain')}</p>
		<form class="row" onsubmit={(e) => (e.preventDefault(), mergeTarget && run(mergeObjects(data, obj.id, mergeTarget)))}>
			<label class="grow"><span class="visually-hidden">{t('inventory.mergeInto')}</span>
				<select bind:value={mergeTarget}>
					<option value="">{t('inventory.mergeInto')}</option>
					{#each activeObjects(data).filter((o) => o.id !== obj.id).sort((a, b) => a.name.localeCompare(b.name)) as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
				</select>
			</label>
			<button type="submit" disabled={!mergeTarget}>{t('inventory.merge')}</button>
		</form>
	{/if}

	{#if events.length}
		<h2>{t('inventory.changes')}</h2>
		<ol class="list">
			{#each events as e (e.id)}
				<li class="row">
					<span class="grow small">{new Date(e.createdAt).toLocaleString()} · {t(`event.${e.action}`)}</span>
					<button type="button" onclick={() => run(undo(data, e.id))}>↶ {t('common.undo')}</button>
				</li>
			{/each}
		</ol>
	{/if}
	{#if error}<p class="notice error" role="alert">{error}</p>{/if}
{/if}

<style>
	.grow {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: 1.4rem;
	}
	label {
		display: grid;
		gap: 4px;
	}
	textarea {
		width: 100%;
		min-height: var(--tap);
		padding: 8px 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		font: inherit;
		color: inherit;
	}
</style>
