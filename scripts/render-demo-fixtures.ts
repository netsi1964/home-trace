/**
 * Renders the synthetic Demo fixture set (Developer handoff, PRD): two rooms, two living-room
 * viewpoints, one item in both views, two identical cups, one moved item and one hidden item.
 * Boxes come from the same scene description that draws the shapes, so ground truth is exact.
 *
 *   npm run fixtures:demo
 *
 * These are drawings, not photos. They exercise the pipeline and the provider contract only.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { GroundTruthSchema, GROUND_TRUTH_SCHEMA_VERSION, type GroundTruth } from '../src/lib/evaluation/groundTruth.ts';

const W = 1200;
const H = 900;
const OUT = path.resolve('fixtures/demo');

type Kind = 'lamp' | 'chair' | 'cup' | 'plant' | 'picture' | 'table' | 'book' | 'clock' | 'bottle';
type Item = { key: string; label: string; kind: Kind; x: number; y: number; w: number; h: number; partial?: boolean };
type Scene = { id: string; room: string; viewpoint: string; wall: string; floor: string; items: Item[]; empty?: [number, number, number, number][] };

const scenes: Scene[] = [
	{
		id: 'living-doorway-1',
		room: 'Living room',
		viewpoint: 'From the doorway',
		wall: '#e9e1d3',
		floor: '#b48a62',
		items: [
			{ key: 'lamp-1', label: 'lamp', kind: 'lamp', x: 90, y: 260, w: 160, h: 420 },
			{ key: 'table-1', label: 'table', kind: 'table', x: 420, y: 520, w: 420, h: 180 },
			{ key: 'cup-1', label: 'cup', kind: 'cup', x: 500, y: 440, w: 70, h: 80 },
			{ key: 'cup-2', label: 'cup', kind: 'cup', x: 680, y: 440, w: 70, h: 80 },
			{ key: 'chair-1', label: 'chair', kind: 'chair', x: 900, y: 420, w: 200, h: 320 },
			{ key: 'picture-1', label: 'picture', kind: 'picture', x: 480, y: 120, w: 240, h: 170 }
		],
		empty: [[260, 80, 180, 140]]
	},
	{
		id: 'living-sofa-1',
		room: 'Living room',
		viewpoint: 'Bookshelf from the sofa',
		wall: '#dfe6e3',
		floor: '#a77f5a',
		items: [
			{ key: 'lamp-1', label: 'lamp', kind: 'lamp', x: 820, y: 240, w: 170, h: 440 },
			{ key: 'plant-1', label: 'plant', kind: 'plant', x: 140, y: 380, w: 220, h: 340 },
			{ key: 'book-1', label: 'book', kind: 'book', x: 450, y: 300, w: 60, h: 200 },
			{ key: 'clock-1', label: 'clock', kind: 'clock', x: 520, y: 80, w: 160, h: 160 }
		],
		empty: [[1010, 80, 160, 160]]
	},
	{
		id: 'kitchen-counter-1',
		room: 'Kitchen',
		viewpoint: 'Counter by the window',
		wall: '#f2efe6',
		floor: '#8f9aa3',
		items: [
			{ key: 'bottle-1', label: 'bottle', kind: 'bottle', x: 200, y: 330, w: 90, h: 260 },
			{ key: 'cup-3', label: 'cup', kind: 'cup', x: 420, y: 480, w: 80, h: 90 },
			{ key: 'clock-2', label: 'clock', kind: 'clock', x: 820, y: 90, w: 170, h: 170 }
		]
	},
	{
		id: 'living-doorway-2',
		room: 'Living room',
		viewpoint: 'From the doorway',
		wall: '#e9e1d3',
		floor: '#b48a62',
		// Revisit: chair moved left, cup-2 hidden behind a book (partial), lamp unchanged.
		items: [
			{ key: 'lamp-1', label: 'lamp', kind: 'lamp', x: 95, y: 262, w: 160, h: 420 },
			{ key: 'table-1', label: 'table', kind: 'table', x: 420, y: 520, w: 420, h: 180 },
			{ key: 'cup-1', label: 'cup', kind: 'cup', x: 500, y: 440, w: 70, h: 80 },
			{ key: 'book-2', label: 'book', kind: 'book', x: 660, y: 360, w: 60, h: 165 },
			{ key: 'cup-2', label: 'cup', kind: 'cup', x: 690, y: 440, w: 70, h: 80, partial: true },
			{ key: 'chair-1', label: 'chair', kind: 'chair', x: 260, y: 430, w: 200, h: 320 },
			{ key: 'picture-1', label: 'picture', kind: 'picture', x: 480, y: 120, w: 240, h: 170 }
		]
	}
];

function draw(it: Item): string {
	const { x, y, w, h } = it;
	const s = 'stroke="#2b2b2b" stroke-width="4"';
	switch (it.kind) {
		case 'lamp':
			return `<polygon points="${x + w * 0.15},${y + h * 0.3} ${x + w * 0.85},${y + h * 0.3} ${x + w},${y} ${x},${y}" fill="#f3c969" ${s}/>
<rect x="${x + w * 0.46}" y="${y + h * 0.3}" width="${w * 0.08}" height="${h * 0.62}" fill="#555"/>
<rect x="${x + w * 0.2}" y="${y + h * 0.92}" width="${w * 0.6}" height="${h * 0.08}" fill="#444" ${s}/>`;
		case 'chair':
			return `<rect x="${x}" y="${y}" width="${w * 0.2}" height="${h}" fill="#7b4b2a" ${s}/>
<rect x="${x}" y="${y + h * 0.5}" width="${w}" height="${h * 0.14}" fill="#9a5f36" ${s}/>
<rect x="${x + w * 0.85}" y="${y + h * 0.5}" width="${w * 0.15}" height="${h * 0.5}" fill="#7b4b2a" ${s}/>`;
		case 'cup':
			return `<rect x="${x}" y="${y}" width="${w * 0.75}" height="${h}" rx="8" fill="#ffffff" ${s}/>
<path d="M${x + w * 0.75} ${y + h * 0.25} h${w * 0.2} v${h * 0.45} h-${w * 0.2}" fill="none" ${s}/>`;
		case 'plant':
			return `<polygon points="${x + w * 0.2},${y + h * 0.6} ${x + w * 0.8},${y + h * 0.6} ${x + w * 0.7},${y + h} ${x + w * 0.3},${y + h}" fill="#c2643c" ${s}/>
<ellipse cx="${x + w * 0.5}" cy="${y + h * 0.33}" rx="${w * 0.5}" ry="${h * 0.32}" fill="#3f8f4f" ${s}/>`;
		case 'picture':
			return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#3c4f76" ${s}/>
<rect x="${x + w * 0.1}" y="${y + h * 0.12}" width="${w * 0.8}" height="${h * 0.76}" fill="#a9c6e8"/>
<circle cx="${x + w * 0.7}" cy="${y + h * 0.35}" r="${h * 0.12}" fill="#f7e27a"/>`;
		case 'table':
			return `<rect x="${x}" y="${y}" width="${w}" height="${h * 0.15}" fill="#6d4c33" ${s}/>
<rect x="${x + w * 0.05}" y="${y + h * 0.15}" width="${w * 0.06}" height="${h * 0.85}" fill="#6d4c33" ${s}/>
<rect x="${x + w * 0.89}" y="${y + h * 0.15}" width="${w * 0.06}" height="${h * 0.85}" fill="#6d4c33" ${s}/>`;
		case 'book':
			return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#8e2f3c" ${s}/>
<rect x="${x + w * 0.15}" y="${y + h * 0.1}" width="${w * 0.7}" height="${h * 0.08}" fill="#e7c76a"/>`;
		case 'clock':
			return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2 - 2}" fill="#fafafa" ${s}/>
<path d="M${x + w / 2} ${y + h / 2} v-${h * 0.32} M${x + w / 2} ${y + h / 2} h${w * 0.22}" ${s}/>`;
		case 'bottle':
			return `<rect x="${x + w * 0.35}" y="${y}" width="${w * 0.3}" height="${h * 0.25}" fill="#2f6f5e" ${s}/>
<rect x="${x}" y="${y + h * 0.25}" width="${w}" height="${h * 0.75}" rx="12" fill="#3d8c74" ${s}/>`;
	}
}

function svg(scene: Scene): string {
	const horizon = H * 0.62;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${horizon}" fill="${scene.wall}"/>
<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${scene.floor}"/>
${scene.items.map(draw).join('\n')}
<text x="${W - 24}" y="${H - 24}" text-anchor="end" font-family="sans-serif" font-size="36" font-weight="bold" fill="#ffffff" stroke="#000" stroke-width="1">Demo</text>
</svg>`;
}

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

await mkdir(OUT, { recursive: true });
const gt: GroundTruth = {
	schemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
	kind: 'hometrace-phase0-ground-truth',
	demo: true,
	description:
		'Synthetic Demo drawings for pipeline and contract checks. Not photos; results on them say nothing about real-home quality.',
	images: []
};

for (const scene of scenes) {
	const file = `${scene.id}.png`;
	await sharp(Buffer.from(svg(scene))).png().toFile(path.join(OUT, file));
	gt.images.push({
		id: scene.id,
		file,
		width: W,
		height: H,
		room: scene.room,
		viewpoint: scene.viewpoint,
		conditions: ['normal'],
		objects: scene.items.map((it) => ({
			objectKey: it.key,
			label: it.label,
			aliases: it.label === 'cup' ? ['mug'] : it.label === 'picture' ? ['frame', 'painting', 'photo'] : it.label === 'plant' ? ['potted plant'] : [],
			category: it.label,
			box: { x: r4(it.x / W), y: r4(it.y / H), width: r4(it.w / W), height: r4(it.h / H) },
			visibility: it.partial ? 'partial' : 'clear'
		})),
		emptyRegions: (scene.empty ?? []).map(([x, y, w, h]) => ({ x: r4(x / W), y: r4(y / H), width: r4(w / W), height: r4(h / H) }))
	});
}

GroundTruthSchema.parse(gt);
await writeFile(path.join(OUT, 'groundtruth.json'), JSON.stringify(gt, null, '\t') + '\n');
console.log(`Wrote ${gt.images.length} Demo fixtures to ${path.relative(process.cwd(), OUT)}`);
