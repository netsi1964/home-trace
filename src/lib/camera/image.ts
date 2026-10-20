import type { Box } from '../geometry/box.ts';
import { JEV_IMAGE_LIMITS } from '../providers/jev/contract.ts';

/**
 * Browser image handling (PRD-FEAT-002, analysis flow step 2). Frames are drawn from the
 * video element or a decoded file only, never from the screen, so the reference overlay and
 * boxes can never end up in the captured image. Pixels are upright, metadata is dropped by
 * re-encoding, and the size fits the provider limits.
 */

export type Frame = { blob: Blob; bytes: Uint8Array; width: number; height: number; mimeType: 'image/jpeg' };

const L = JEV_IMAGE_LIMITS;

function fitSize(w: number, h: number): { width: number; height: number } {
	const scale = Math.min(1, L.maxSide / Math.max(w, h), Math.sqrt(L.maxPixels / (w * h)));
	return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, quality = 0.85): Promise<Frame> {
	const blob =
		'convertToBlob' in canvas
			? await canvas.convertToBlob({ type: 'image/jpeg', quality })
			: await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality));
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return { blob, bytes, width: canvas.width, height: canvas.height, mimeType: 'image/jpeg' };
}

function canvasOf(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const c = document.createElement('canvas');
	c.width = width;
	c.height = height;
	return c;
}

function draw(source: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement | OffscreenCanvas {
	const { width, height } = fitSize(sw, sh);
	const canvas = canvasOf(width, height);
	const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!ctx) throw new Error('Canvas is not available');
	ctx.drawImage(source, 0, 0, width, height);
	return canvas;
}

/** One clean frame from the live video. The browser delivers video frames upright. */
export async function frameFromVideo(video: HTMLVideoElement): Promise<Frame> {
	if (!video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready yet');
	return encode(draw(video, video.videoWidth, video.videoHeight));
}

/** A frame from a chosen photo, with EXIF orientation applied to the pixels. */
export async function frameFromFile(file: Blob): Promise<Frame> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		if (Math.min(bitmap.width, bitmap.height) < L.minSide) throw new Error(`The photo is too small; the short side must be at least ${L.minSide} px`);
		return await encode(draw(bitmap, bitmap.width, bitmap.height));
	} finally {
		bitmap.close();
	}
}

/**
 * A padded crop of a normalised box, scaled so the short side is at least the provider
 * minimum. Used for "Same object?" previews and identity requests.
 */
export async function cropFrame(frame: Blob, box: Box, pad = 0.05): Promise<Frame> {
	const bitmap = await createImageBitmap(frame);
	try {
		const x0 = Math.max(0, box.x - pad);
		const y0 = Math.max(0, box.y - pad);
		const x1 = Math.min(1, box.x + box.width + pad);
		const y1 = Math.min(1, box.y + box.height + pad);
		const sx = x0 * bitmap.width;
		const sy = y0 * bitmap.height;
		const sw = Math.max(1, (x1 - x0) * bitmap.width);
		const sh = Math.max(1, (y1 - y0) * bitmap.height);
		const up = Math.max(1, L.minSide / Math.min(sw, sh));
		const down = Math.min(1, 640 / Math.max(sw * up, sh * up));
		const scale = Math.max(up * down, L.minSide / Math.min(sw, sh));
		const width = Math.round(sw * scale);
		const height = Math.round(sh * scale);
		const canvas = canvasOf(width, height);
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
		if (!ctx) throw new Error('Canvas is not available');
		ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
		return await encode(canvas, 0.9);
	} finally {
		bitmap.close();
	}
}
