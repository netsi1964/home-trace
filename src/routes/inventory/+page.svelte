<script lang="ts">
	import { page } from '$app/state';
	import { categories, lastSeen, observationsOf, searchInventory, unresolvedObservations, roomOfScan } from '#lib/inventory/queries.ts';
	import { app } from '#lib/storage/store.svelte.ts';
	import { link, readSession } from '#lib/storage/session.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';
	import NotOnDevice from '#lib/components/NotOnDevice.svelte';
	import Item from './Item.svelte';

	const params = $derived(readSession(page.url));
	const data = $derived(app.data);

	let text = $state('');
	let roomId = $state('');
	let category = $state('');
	let view = $state<'items' | 'unresolved'>('items');

	const items = $derived(data ? searchInventory(data, { text, roomId: roomId || null, category: category || null }) : []);
	const unresolved = $derived(data ? unresolvedObservations(data) : []);
</script>

{#if !data}
	<NotOnDevice />
{:else if params.object}
	<Item objectId={params.object} />
{:else}
	<h1>{t('inventory.title')}</h1>
	<p class="small muted">{t('inventory.explain')}</p>

	<div class="filters">
		<label>{t('inventory.search')}<input type="search" bind:value={text} placeholder={t('inventory.searchPlaceholder')} /></label>
		<label>{t('inventory.room')}
			<select bind:value={roomId}>
				<option value="">{t('inventory.allRooms')}</option>
				{#each [...data.rooms].sort((a, b) => a.name.localeCompare(b.name)) as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
			</select>
		</label>
		<label>{t('inventory.category')}
			<select bind:value={category}>
				<option value="">{t('inventory.allCategories')}</option>
				{#each categories(data) as c (c)}<option value={c}>{c}</option>{/each}
			</select>
		</label>
	</div>

	<div class="row tabs" role="tablist" aria-label={t('inventory.status')}>
		<button role="tab" type="button" aria-selected={view === 'items'} onclick={() => (view = 'items')}>✓ {t('inventory.confirmed')} <span class="num">{items.length}</span></button>
		<button role="tab" type="button" aria-selected={view === 'unresolved'} onclick={() => (view = 'unresolved')}>◌ {t('inventory.unresolved')} <span class="num">{unresolved.length}</span></button>
	</div>

	{#if view === 'items'}
		{#if items.length === 0}<p class="muted">{t('inventory.empty')}</p>{/if}
		<ul class="list">
			{#each items as o (o.id)}
				{@const seen = lastSeen(data, o.id)}
				<li>
					<a class="item" href={link('/inventory', { object: o.id })}>
						<span class="thumb"><AssetImg assetId={seen?.observation.cropAssetId} alt="" /></span>
						<span class="grow">
							<strong>{o.name}</strong>{#if o.category}<span class="small muted"> · {o.category}</span>{/if}<br />
							<span class="small muted">
								{seen ? t('inventory.lastSeen', { room: seen.room?.name ?? '—', date: new Date(seen.scan.capturedAt).toLocaleDateString() }) : ''}
								· {t('inventory.observations', { n: observationsOf(data, o.id).length })}
							</span>
						</span>
						<span aria-hidden="true">→</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="small muted">{t('inventory.unresolvedExplain')}</p>
		<ul class="list">
			{#each unresolved as o (o.id)}
				{@const scan = data.scans.find((s) => s.id === o.scanId)}
				<li>
					<a class="item" href={link('/review', { session: o.scanId })}>
						<span class="thumb"><AssetImg assetId={o.cropAssetId} alt="" /></span>
						<span class="grow">
							<strong>{o.label}</strong><br />
							<span class="small muted">{scan ? `${roomOfScan(data, scan)?.name ?? ''} · ${new Date(scan.capturedAt).toLocaleDateString()}` : ''}</span>
						</span>
						<span aria-hidden="true">→</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.filters {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		margin-bottom: 12px;
	}
	label {
		display: grid;
		gap: 4px;
	}
	.tabs {
		margin-bottom: 12px;
	}
	.tabs [aria-selected='true'] {
		background: var(--brand);
		color: var(--brand-ink);
		border-color: var(--brand);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: var(--tap);
		text-decoration: none;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
</style>
