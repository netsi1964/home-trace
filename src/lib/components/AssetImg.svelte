<script lang="ts">
	import { assetUrl } from '#lib/storage/store.svelte.ts';

	let { assetId, alt, class: cls = '' }: { assetId: string | null | undefined; alt: string; class?: string } = $props();
	let url = $state<string | null>(null);

	$effect(() => {
		let live = true;
		url = null;
		assetUrl(assetId).then((u) => {
			if (live) url = u;
		});
		return () => {
			live = false;
		};
	});
</script>

{#if url}
	<img src={url} {alt} class={cls} draggable="false" />
{:else}
	<span class="placeholder {cls}" role="img" aria-label={alt}></span>
{/if}

<style>
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.placeholder {
		display: block;
		width: 100%;
		height: 100%;
		background: repeating-linear-gradient(45deg, var(--line), var(--line) 6px, transparent 6px, transparent 12px);
	}
</style>
