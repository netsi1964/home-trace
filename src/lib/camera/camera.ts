/**
 * Camera access (PRD-FEAT-002.1). Rear camera preferred, never the microphone. The live
 * preview itself never triggers any analysis; only an explicit Scan does.
 */

export type CameraError = 'denied' | 'unavailable' | 'insecure' | 'unknown';

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
	if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { code: 'insecure' as CameraError });
	if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unavailable'), { code: 'unavailable' as CameraError });
	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }
		});
		video.srcObject = stream;
		video.muted = true;
		video.playsInline = true;
		await video.play();
		return stream;
	} catch (e) {
		const name = e instanceof DOMException ? e.name : '';
		const code: CameraError =
			name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'unknown';
		throw Object.assign(new Error(code), { code });
	}
}

export function stopCamera(stream: MediaStream | null): void {
	stream?.getTracks().forEach((t) => t.stop());
}

export function cameraErrorCode(e: unknown): CameraError {
	return ((e as { code?: CameraError })?.code ?? 'unknown') as CameraError;
}
