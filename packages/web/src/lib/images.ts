import type { ImageAttachment } from "@lares/shared";

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface PendingImage extends ImageAttachment {
	name: string;
	previewUrl: string;
}

export class ImageRejected extends Error {}

async function toBase64(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	let binary = "";
	const bytes = new Uint8Array(buffer);
	// btoa needs a binary string, and spreading a multi-megabyte array blows
	// the argument limit, so it is chunked.
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

export async function readImage(file: File): Promise<PendingImage> {
	if (!file.type.startsWith("image/")) throw new ImageRejected(`${file.name} is not an image`);
	if (file.size > MAX_IMAGE_BYTES) throw new ImageRejected(`${file.name} is larger than 10 MB`);

	return {
		type: "image",
		data: await toBase64(file),
		mimeType: file.type,
		name: file.name || "pasted image",
		previewUrl: URL.createObjectURL(file),
	};
}

export function releaseImage(image: PendingImage): void {
	URL.revokeObjectURL(image.previewUrl);
}

export function imagesFromDataTransfer(transfer: DataTransfer | null): File[] {
	if (!transfer) return [];
	return [...transfer.files].filter((file) => file.type.startsWith("image/"));
}
