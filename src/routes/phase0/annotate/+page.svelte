<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		boxFromDrag,
		CONDITIONS,
		emptyDraft,
		fromGroundTruth,
		imageIdFor,
		knownKeys,
		nextKey,
		stats,
		toGroundTruth,
		type Draft,
		type DraftImage
	} from '#lib/evaluation/annotationDraft.ts';
	import { GroundTruthSchema } from '#lib/evaluation/groundTruth.ts';
	import { GATE } from '#lib/evaluation/metrics.ts';
	import type { Box } from '#lib/geometry/box.ts';
	import { t } from '#lib/i18n/index.svelte.ts';

	/**
	 * Phase 0 annotation tool (PRD-SEC-008). Photos are shown from local object URLs and are never
	 * uploaded or stored; only the metadata draft is kept in localStorage.
	 */

	const STORAGE_KEY = 'hometrace.phase0.annotationDraft';
	const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(jpe?g|png|webp)$/i;

	let draft = $state<Draft>(loadDraft());
	let urls = $state<Record<string, string>>({});
	let current = $state(0);
	let selected = $state<{ kind: 'object' | 'empty'; index: number } | null>(null);
	let mode = $state<'object' | 'empty'>('object');
	let drag = $state<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
	let saveFailed = $state(false);
	let issues = $state<string[]>([]);
	let importIssues = $state<string[]>([]);
	let exported = $state(false);
	let confirmClear = $state(false);
	/** Objects whose key was generated and should follow the name until the user edits the key. */
	const autoKey = new WeakSet<object>();

	const image: DraftImage | undefined = $derived(draft.images[current]);
	const keys = $derived(knownKeys(draft));
	const summary = $derived(stats(draft));
	const dragBox = $derived(drag ? boxFromDrag(drag.start, drag.end, 0) : null);

	$effect(() => {
		const json = JSON.stringify(draft);
		try {
			localStorage.setItem(STORAGE_KEY, json);
			saveFailed = false;
		} catch {
			saveFailed = true;
		}
	});

	onDestroy(() => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)));

	function loadDraft(): Draft {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return emptyDraft();
			const parsed = JSON.parse(raw) as Draft;
			return Array.isArray(parsed?.images) ? parsed : emptyDraft();
		} catch {
			return emptyDraft();
		}
	}

	async function addPhotos(files: FileList | null) {
		if (!files) return;
		for (const file of Array.from(files)) {
			if (!/^image\/(jpeg|png|webp)$/.test(file.type)) continue;
			const url = URL.createObjectURL(file);
			// The browser applies EXIF orientation when drawing, so these are the oriented dimensions.
			const size = await naturalSize(url).catch(() => null);
			if (!size) {
				URL.revokeObjectURL(url);
				continue;
			}
			if (urls[file.name]) URL.revokeObjectURL(urls[file.name]);
			urls[file.name] = url;
			const existing = draft.images.find((i) => i.file === file.name);
			if (existing) {
				existing.width = size.width;
				existing.height = size.height;
			} else {
				const previous = draft.images.at(-1);
				draft.images.push({
					id: imageIdFor(file.name, new Set(draft.images.map((i) => i.id))),
					file: file.name,
					width: size.width,
					height: size.height,
					room: previous?.room ?? '',
					viewpoint: '',
					conditions: ['normal'],
					objects: [],
					emptyRegions: []
				});
			}
		}
	}

	function naturalSize(url: string): Promise<{ width: number; height: number }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
			img.onerror = reject;
			img.src = url;
		});
	}

	async function importGroundTruth(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		importIssues = [];
		try {
			const r = GroundTruthSchema.safeParse(JSON.parse(await file.text()));
			if (!r.success) {
				importIssues = r.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`);
				return;
			}
			draft = fromGroundTruth(r.data);
			current = 0;
			selected = null;
		} catch (e) {
			importIssues = [e instanceof Error ? e.message : String(e)];
		}
	}

	function exportGroundTruth() {
		const r = toGroundTruth(draft);
		if (!r.ok) {
			issues = r.issues.slice(0, 20);
			exported = false;
			return;
		}
		issues = [];
		const blob = new Blob([JSON.stringify(r.value, null, '\t') + '\n'], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'groundtruth.json';
		a.click();
		URL.revokeObjectURL(a.href);
		exported = true;
	}

	function clearAll() {
		if (!confirmClear) {
			confirmClear = true;
			return;
		}
		draft = emptyDraft();
		current = 0;
		selected = null;
		confirmClear = false;
	}

	function removeImage(index: number) {
		draft.images.splice(index, 1);
		current = Math.max(0, Math.min(current, draft.images.length - 1));
		selected = null;
	}

	function point(e: PointerEvent): { x: number; y: number } {
		const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		const p = point(e);
		drag = { start: p, end: p };
	}

	function onPointerMove(e: PointerEvent) {
		if (drag) drag.end = point(e);
	}

	function onPointerUp() {
		if (!drag || !image) return;
		const box = boxFromDrag(drag.start, drag.end);
		drag = null;
		if (!box) return;
		if (mode === 'empty') {
			image.emptyRegions.push(box);
			selected = { kind: 'empty', index: image.emptyRegions.length - 1 };
		} else {
			image.objects.push({ objectKey: nextKey(draft, 'object'), label: '', aliasesText: '', visibility: 'clear', box });
			autoKey.add(image.objects[image.objects.length - 1]);
			selected = { kind: 'object', index: image.objects.length - 1 };
			queueMicrotask(() => document.getElementById(`label-${image.objects.length - 1}`)?.focus());
		}
	}

	function onLabelChange(index: number, label: string) {
		if (!image) return;
		const o = image.objects[index];
		o.label = label;
		if (autoKey.has(o)) {
			o.objectKey = ''; // so the object's own old key does not count as taken
			o.objectKey = nextKey(draft, label.trim() || 'object');
		}
	}

	function setBoxField(b: Box, field: keyof Box, percent: number) {
		if (!Number.isFinite(percent)) return;
		b[field] = Math.round(Math.min(100, Math.max(0, percent)) * 100) / 10_000;
	}

	const pct = (v: number) => Math.round(v * 1000) / 10;
</script>

<svelte:head>
	<title>{t('annotate.title')} · {t('app.name')}</title>
</svelte:head>

<h1>{t('annotate.title')}</h1>
<p class="intro">{t('annotate.intro')}</p>

<div class="toolbar">
	<label class="button primary">
		{t('annotate.pick')}
		<input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onchange={(e) => addPhotos(e.currentTarget.files)} />
	</label>
	<label class="button">
		{t('annotate.import')}
		<input class="visually-hidden" type="file" accept="application/json,.json" onchange={(e) => importGroundTruth(e.currentTarget.files)} />
	</label>
	<button type="button" onclick={exportGroundTruth} disabled={draft.images.length === 0}>{t('annotate.export')}</button>
	<button type="button" class="danger" onclick={clearAll} onblur={() => (confirmClear = false)} disabled={draft.images.length === 0}>
		{confirmClear ? t('annotate.clear.confirm') : t('annotate.clear')}
	</button>
</div>

<p class="summary" aria-live="polite">
	{t('annotate.summary', summary)}
	{#if summary.photos < GATE.minImages}{t('annotate.gate', { min: GATE.minImages })}{/if}
	<span class="muted">{saveFailed ? t('annotate.notSaved') : t('annotate.saved')}</span>
</p>

{#if importIssues.length}
	<div class="issues" role="alert">
		<p>{t('annotate.import.invalid')}</p>
		<ul>{#each importIssues as issue, i (i)}<li>{issue}</li>{/each}</ul>
	</div>
{/if}

{#if issues.length}
	<div class="issues" role="alert">
		<p>{t('annotate.export.invalid')}</p>
		<ul>{#each issues as issue, i (i)}<li>{issue}</li>{/each}</ul>
	</div>
{/if}

{#if exported}
	<div class="next" role="status">
		<p>{t('annotate.export.next')}</p>
		<pre>npm run eval -- --fixtures private-fixtures/&lt;name&gt; --provider jev --dry-run</pre>
	</div>
{/if}

<div class="set">
	<label class="check">
		<input type="checkbox" bind:checked={draft.demo} />
		{t('annotate.demo')}
	</label>
	<label>
		{t('annotate.description')}
		<input type="text" bind:value={draft.description} maxlength="2000" />
	</label>
</div>

{#if image}
	<nav class="pager" aria-label={t('annotate.photos', { count: draft.images.length })}>
		<button type="button" onclick={() => ((current -= 1), (selected = null))} disabled={current === 0}>
			<span aria-hidden="true">←</span> {t('annotate.photo.previous')}
		</button>
		<span>{t('annotate.photo.of', { n: current + 1, total: draft.images.length })} · <code>{image.file}</code></span>
		<button type="button" onclick={() => ((current += 1), (selected = null))} disabled={current >= draft.images.length - 1}>
			{t('annotate.photo.next')} <span aria-hidden="true">→</span>
		</button>
	</nav>

	{#if !FILE_NAME.test(image.file)}
		<p class="warning" role="alert"><span aria-hidden="true">⚠</span> {t('annotate.photo.badName')}</p>
	{/if}

	<div class="workspace">
		<div class="stage-wrap">
			{#if urls[image.file]}
				<div class="stage" style:aspect-ratio="{image.width} / {image.height}">
					<img src={urls[image.file]} alt={image.file} draggable="false" />
					<svg
						viewBox="0 0 1 1"
						preserveAspectRatio="none"
						role="application"
						aria-label={mode === 'object' ? t('annotate.mode.object') : t('annotate.mode.empty')}
						onpointerdown={onPointerDown}
						onpointermove={onPointerMove}
						onpointerup={onPointerUp}
						onpointercancel={() => (drag = null)}
					>
						{#each image.emptyRegions as b, i (i)}
							<rect class="empty" class:selected={selected?.kind === 'empty' && selected.index === i} x={b.x} y={b.y} width={b.width} height={b.height} />
						{/each}
						{#each image.objects as o, i (i)}
							<rect
								class="object"
								class:partial={o.visibility === 'partial'}
								class:selected={selected?.kind === 'object' && selected.index === i}
								x={o.box.x}
								y={o.box.y}
								width={o.box.width}
								height={o.box.height}
							/>
						{/each}
						{#if dragBox}
							<rect class="drawing" x={dragBox.x} y={dragBox.y} width={dragBox.width} height={dragBox.height} />
						{/if}
					</svg>
					{#each image.objects as o, i (i)}
						<button
							type="button"
							class="badge"
							class:selected={selected?.kind === 'object' && selected.index === i}
							style:left="{o.box.x * 100}%"
							style:top="{o.box.y * 100}%"
							aria-label={t('annotate.box.select', { n: i + 1 })}
							onclick={() => (selected = { kind: 'object', index: i })}
						>
							{i + 1}
						</button>
					{/each}
					{#each image.emptyRegions as b, i (i)}
						<span class="badge empty-badge" style:left="{b.x * 100}%" style:top="{b.y * 100}%" aria-hidden="true">∅{i + 1}</span>
					{/each}
				</div>
			{:else}
				<p class="warning" role="status">{t('annotate.photo.missing', { file: image.file })}</p>
			{/if}
		</div>

		<aside>
			<fieldset class="mode">
				<legend>{t('annotate.mode')}</legend>
				<label class="check"><input type="radio" bind:group={mode} value="object" /> {t('annotate.mode.object')}</label>
				<label class="check"><input type="radio" bind:group={mode} value="empty" /> {t('annotate.mode.empty')}</label>
				{#if mode === 'empty'}<p class="muted">{t('annotate.mode.emptyHint')}</p>{/if}
			</fieldset>

			<div class="meta">
				<label>{t('annotate.room')}<input type="text" bind:value={image.room} maxlength="80" /></label>
				<label>{t('annotate.viewpoint')}<input type="text" bind:value={image.viewpoint} maxlength="80" /></label>
				<fieldset>
					<legend>{t('annotate.conditions')}</legend>
					<div class="conditions">
						{#each CONDITIONS as c (c)}
							<label class="check"><input type="checkbox" bind:group={image.conditions} value={c} /> {t(`annotate.condition.${c}`)}</label>
						{/each}
					</div>
				</fieldset>
			</div>

			<h2>{t('annotate.boxes', { count: image.objects.length })}</h2>
			{#if image.objects.length === 0}
				<p class="muted">{t('annotate.boxes.none')}</p>
			{/if}
			<datalist id="known-keys">
				{#each [...keys] as [key, label] (key)}<option value={key}>{label}</option>{/each}
			</datalist>
			<ol class="boxes">
				{#each image.objects as o, i (i)}
					<li class:selected={selected?.kind === 'object' && selected.index === i}>
						<div class="box-head">
							<button type="button" class="num" aria-pressed={selected?.kind === 'object' && selected.index === i} onclick={() => (selected = { kind: 'object', index: i })}>
								{t('annotate.box.number', { n: i + 1 })}
							</button>
							<span class="vis">{o.visibility === 'clear' ? '■' : '◩'} {t(`annotate.visibility.${o.visibility}`)}</span>
							<button type="button" class="danger" onclick={() => (image.objects.splice(i, 1), (selected = null))}>{t('annotate.box.delete')}</button>
						</div>
						<label>{t('annotate.box.label')}<input id="label-{i}" type="text" value={o.label} oninput={(e) => onLabelChange(i, e.currentTarget.value)} maxlength="80" /></label>
						<label>
							{t('annotate.box.key')}
							<input type="text" list="known-keys" bind:value={o.objectKey} oninput={() => autoKey.delete(o)} maxlength="100" autocapitalize="none" spellcheck="false" />
							<small class="muted">{t('annotate.box.keyHint')}</small>
						</label>
						<label>{t('annotate.box.aliases')}<input type="text" bind:value={o.aliasesText} /></label>
						<fieldset class="inline">
							<legend>{t('annotate.box.visibility')}</legend>
							<label class="check"><input type="radio" bind:group={o.visibility} value="clear" /> {t('annotate.visibility.clear')}</label>
							<label class="check"><input type="radio" bind:group={o.visibility} value="partial" /> {t('annotate.visibility.partial')}</label>
						</fieldset>
						<fieldset class="position">
							<legend>{t('annotate.box.position')}</legend>
							{#each ['x', 'y', 'width', 'height'] as const as f (f)}
								<label>{t(`annotate.box.${f}`)}<input type="number" min="0" max="100" step="0.1" value={pct(o.box[f])} onchange={(e) => setBoxField(o.box, f, e.currentTarget.valueAsNumber)} /></label>
							{/each}
						</fieldset>
					</li>
				{/each}
			</ol>

			{#if image.emptyRegions.length}
				<h2>{t('annotate.empties', { count: image.emptyRegions.length })}</h2>
				<ol class="boxes">
					{#each image.emptyRegions as b, i (i)}
						<li class="box-head">
							<span>∅ {t('annotate.box.empty', { n: i + 1 })} · {pct(b.x)}, {pct(b.y)} · {pct(b.width)} × {pct(b.height)} %</span>
							<button type="button" class="danger" onclick={() => (image.emptyRegions.splice(i, 1), (selected = null))}>{t('annotate.box.delete')}</button>
						</li>
					{/each}
				</ol>
			{/if}

			<button type="button" class="danger remove" onclick={() => removeImage(current)}>{t('annotate.photo.remove')}</button>
		</aside>
	</div>
{/if}

<style>
	.intro,
	.muted {
		color: var(--ink-muted);
	}

	.intro {
		max-width: 70ch;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 16px 0 8px;
	}

	.summary .muted {
		display: block;
		font-size: 0.9rem;
	}

	.issues,
	.next,
	.warning {
		border: 2px solid var(--danger);
		border-radius: var(--radius);
		padding: 8px var(--gutter);
		background: var(--surface);
	}

	.next {
		border-color: var(--brand);
	}

	.next pre {
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.set {
		display: grid;
		gap: 8px;
		margin: 16px 0;
		max-width: 560px;
	}

	label {
		display: grid;
		gap: 4px;
	}

	label.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: var(--tap);
	}

	label.check input {
		width: 22px;
		height: 22px;
	}

	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 8px 12px;
		margin: 0;
	}

	.pager {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 16px 0 8px;
	}

	.pager code {
		word-break: break-all;
	}

	.workspace {
		display: grid;
		gap: var(--gutter);
	}

	@media (min-width: 900px) {
		.workspace {
			grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
			align-items: start;
		}

		.stage-wrap {
			position: sticky;
			top: 8px;
		}
	}

	.stage {
		position: relative;
		width: 100%;
		background: #000;
		user-select: none;
		-webkit-user-select: none;
	}

	.stage img,
	.stage svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.stage svg {
		touch-action: none;
		cursor: crosshair;
	}

	rect {
		fill: transparent;
		vector-effect: non-scaling-stroke;
		stroke-width: 3;
	}

	rect.object {
		stroke: var(--box);
		filter: drop-shadow(0 0 1px #000);
	}

	rect.object.partial {
		stroke-dasharray: 2 6;
		stroke-linecap: round;
	}

	rect.empty {
		stroke: var(--empty);
		stroke-dasharray: 10 6;
		fill: color-mix(in srgb, var(--empty) 15%, transparent);
	}

	rect.selected {
		stroke: var(--box-selected);
		stroke-width: 5;
	}

	rect.drawing {
		stroke: var(--focus);
		stroke-dasharray: 6 4;
	}

	.badge {
		position: absolute;
		min-height: 28px;
		min-width: 28px;
		padding: 0 6px;
		border-radius: 6px;
		border: 2px solid var(--box);
		background: var(--surface);
		font-size: 0.9rem;
		transform: translate(-2px, -2px);
		pointer-events: auto;
	}

	.badge.selected {
		background: var(--box-selected);
		border-color: var(--box-selected);
		color: #fff;
	}

	.empty-badge {
		display: inline-flex;
		align-items: center;
		border-style: dashed;
		border-color: var(--empty);
		pointer-events: none;
	}

	aside {
		display: grid;
		gap: 12px;
	}

	aside h2 {
		font-size: 1.1rem;
		margin: 8px 0 0;
	}

	.meta,
	.conditions {
		display: grid;
		gap: 8px;
	}

	.conditions {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	}

	.boxes {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
	}

	.boxes > li {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.boxes > li.selected {
		border: 3px solid var(--box-selected);
	}

	.box-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0 16px;
	}

	.position {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 6px;
	}

	.position input {
		padding: 8px 4px;
	}

	.remove {
		justify-self: start;
	}
</style>
