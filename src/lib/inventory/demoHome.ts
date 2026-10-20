import { DEMO_FIXTURES } from '../providers/demo.ts';
import { emptyHome, newId, now, type HomeData } from './model.ts';

/**
 * "Load demo home" (Developer handoff, T24): the rooms and viewpoints of the Demo drawings,
 * ready to scan with the Demo photos. No items are created: the user does the decisions.
 */
export function demoHome(): HomeData {
	const d = emptyHome('Demo home');
	const rooms = new Map<string, string>();
	const seen = new Set<string>();
	for (const img of DEMO_FIXTURES.images) {
		if (!rooms.has(img.room)) {
			const id = newId();
			rooms.set(img.room, id);
			d.rooms.push({ id, homeId: d.home.id, name: img.room, createdAt: now() });
		}
		const key = `${img.room}/${img.viewpoint}`;
		if (seen.has(key)) continue;
		seen.add(key);
		d.viewpoints.push({ id: newId(), roomId: rooms.get(img.room)!, name: img.viewpoint, referenceScanId: null, createdAt: now() });
	}
	return d;
}
