import sharp from 'sharp';
import type { Box } from '../geometry/box.ts';
import type { AnalysisImage } from '../providers/types.ts';
import { JEV_IMAGE_LIMITS } from '../providers/jev/contract.ts';

/**
 * Node-side image preparation for Phase 0 (PRD-SEC-004 analysis flow, step 2):
 * apply EXIF orientation to the pixels, fit inside the provider limits, re-encode as JPEG
 * and drop metadata. Ground-truth boxes are normalised, so resizing does not move them.
 */

export type PreparedImage = AnalysisImage & { sourceWidth: number; sourceHeight: number };

export async function prepareFrame(input: Buffer): Promise<PreparedImage> {
	const L = JEV_IMAGE_LIMITS;
	const oriented = sharp(input).rotate(); // rotate() with no angle applies EXIF orientation
	const { data: raw, info: src } = await oriented.clone().toBuffer({ resolveWithObject: true });
	let width = src.width;
	let height = src.height;

	const scale = Math.min(1, L.maxSide / Math.max(width, height), Math.sqrt(L.maxPixels / (width * height)));
	width = Math.floor(width * scale);
	height = Math.floor(height * scale);
	if (Math.min(width, height) < L.minSide) {
		throw new Error(`Image is ${src.width}×${src.height}; the short side must be at least ${L.minSide} px`);
	}

	const bytes = await sharp(raw).resize(width, height, { fit: 'fill' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
	return { mimeType: 'image/jpeg', width, height, bytes: new Uint8Array(bytes), sourceWidth: src.width, sourceHeight: src.height };
}

/**
 * Crops a normalised box with padding, and upscales small crops so the short side meets the
 * provider minimum. Upscaling adds no detail; it only satisfies the documented size limit.
 */
export async function cropBox(frame: AnalysisImage, box: Box, pad = 0.05): Promise<AnalysisImage> {
	const L = JEV_IMAGE_LIMITS;
	const x0 = Math.max(0, box.x - pad);
	const y0 = Math.max(0, box.y - pad);
	const x1 = Math.min(1, box.x + box.width + pad);
	const y1 = Math.min(1, box.y + box.height + pad);
	const left = Math.floor(x0 * frame.width);
	const top = Math.floor(y0 * frame.height);
	const w = Math.max(1, Math.min(frame.width - left, Math.ceil((x1 - x0) * frame.width)));
	const h = Math.max(1, Math.min(frame.height - top, Math.ceil((y1 - y0) * frame.height)));

	let outW = w;
	let outH = h;
	const up = Math.max(1, L.minSide / Math.min(w, h));
	outW = Math.round(w * up);
	outH = Math.round(h * up);
	const down = Math.min(1, L.maxSide / Math.max(outW, outH), Math.sqrt(L.maxPixels / (outW * outH)));
	outW = Math.max(L.minSide, Math.floor(outW * down));
	outH = Math.max(L.minSide, Math.floor(outH * down));

	const bytes = await sharp(Buffer.from(frame.bytes))
		.extract({ left, top, width: w, height: h })
		.resize(outW, outH, { fit: 'fill' })
		.jpeg({ quality: 90 })
		.toBuffer();
	return { mimeType: 'image/jpeg', width: outW, height: outH, bytes: new Uint8Array(bytes) };
}

/** Crops a normalised region without padding or upscaling. Strips below the provider minimum are rejected later. */
export async function cropRegion(frame: AnalysisImage, region: Box): Promise<AnalysisImage> {
	const left = Math.round(region.x * frame.width);
	const top = Math.round(region.y * frame.height);
	const width = Math.min(frame.width - left, Math.round(region.width * frame.width));
	const height = Math.min(frame.height - top, Math.round(region.height * frame.height));
	const bytes = await sharp(Buffer.from(frame.bytes)).extract({ left, top, width, height }).jpeg({ quality: 90 }).toBuffer();
	return { mimeType: 'image/jpeg', width, height, bytes: new Uint8Array(bytes) };
}
