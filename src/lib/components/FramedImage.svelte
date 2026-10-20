<script lang="ts" module>
	import type { Box } from '#lib/geometry/box.ts';

	export type FrameBox = { id: string; n: number; box: Box; style: 'confirmed' | 'proposal' | 'dismissed'; label: string };
</script>

<script lang="ts">
	import { boxFromDrag } from '#lib/evaluation/annotationDraft.ts';
	import AssetImg from './AssetImg.svelte';

	/**
	 * A captured frame with numbered boxes. The image keeps its aspect ratio (no hidden crop) and
	 * boxes are normalised to it, so they line up at any screen size (PRD-FEAT-003). Box styles
	 * differ by line pattern and number, never by colour alone.
	 */

	let {
		assetId,
		width,
		height,
		alt,
		boxes = [],
		selected = null,
		onselect,
		draw = false,
		ondraw
	}: {
		assetId: string;
		width: number;
		height: number;
		alt: string;
		boxes?: FrameBox[];
		selected?: string | null;
		onselect?: (id: string) => void;
		draw?: boolean;
		ondraw?: (box: Box) => void;
	} = $props();

	let drag = $state<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
	const dragBox = $derived(drag ? boxFromDrag(drag.start, drag.end, 0) : null);

	function point(e: PointerEvent) {
		const r = (e.currentTarget as Element).getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
	}
</script>

<div class="frame" style:aspect-ratio="{width} / {height}">
	<AssetImg {assetId} {alt} />
	<svg
		viewBox="0 0 1 1"
		preserveAspectRatio="none"
		class:drawing={draw}
		aria-hidden="true"
		onpointerdown={(e) => {
			if (!draw || e.button !== 0) return;
			(e.currentTarget as Element).setPointerCapture(e.pointerId);
			const p = point(e);
			drag = { start: p, end: p };
		}}
		onpointermove={(e) => {
			if (drag) drag.end = point(e);
		}}
		onpointerup={() => {
			if (!drag) return;
			const b = boxFromDrag(drag.start, drag.end);
			drag = null;
			if (b) ondraw?.(b);
		}}
		onpointercancel={() => (drag = null)}
	>
		{#each boxes as b (b.id)}
			<rect class={b.style} class:selected={selected === b.id} x={b.box.x} y={b.box.y} width={b.box.width} height={b.box.height} />
		{/each}
		{#if dragBox}<rect class="new" x={dragBox.x} y={dragBox.y} width={dragBox.width} height={dragBox.height} />{/if}
	</svg>
	{#each boxes as b (b.id)}
		<button
			type="button"
			class="tag {b.style}"
			class:selected={selected === b.id}
			style:left="{b.box.x * 100}%"
			style:top="{b.box.y * 100}%"
			aria-label="{b.n}. {b.label}"
			aria-pressed={selected === b.id}
			disabled={draw}
			onclick={() => onselect?.(b.id)}
		>
			<span>{b.n}</span>
		</button>
	{/each}
</div>

<style>
	.frame {
		position: relative;
		width: 100%;
		background: #000;
		border-radius: 8px;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
	}
	.frame :global(img),
	.frame :global(.placeholder) {
		position: absolute;
		inset: 0;
		object-fit: fill;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	svg.drawing {
		pointer-events: auto;
		cursor: crosshair;
		touch-action: none;
	}
	rect {
		fill: transparent;
		vector-effect: non-scaling-stroke;
		stroke-width: 3;
		filter: drop-shadow(0 0 1px #000);
	}
	rect.confirmed {
		stroke: var(--box);
	}
	rect.proposal {
		stroke: var(--box);
		stroke-dasharray: 8 6;
	}
	rect.dismissed {
		stroke: var(--ink-muted);
		stroke-dasharray: 2 6;
		stroke-linecap: round;
	}
	rect.selected {
		stroke: var(--box-selected);
		stroke-width: 5;
	}
	rect.new {
		stroke: var(--focus);
		stroke-dasharray: 6 4;
	}
	/* 44 × 44 px hit area (PRD-SEC-006.1) around a compact visible badge. */
	.tag {
		position: absolute;
		min-height: 44px;
		min-width: 44px;
		padding: 0;
		transform: translate(-8px, -8px);
		border: none;
		background: transparent;
		display: grid;
		place-items: start;
	}
	.tag span {
		margin: 8px 0 0 8px;
		min-height: 28px;
		min-width: 28px;
		padding: 0 6px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		border: 2px solid var(--box);
		background: var(--surface);
		font-size: 0.9rem;
		font-family: var(--font-mono);
	}
	.tag.proposal span {
		border-style: dashed;
	}
	.tag.dismissed span {
		opacity: 0.6;
		text-decoration: line-through;
	}
	.tag.selected span {
		background: var(--box-selected);
		border-color: var(--box-selected);
		color: #fff;
	}
</style>
