// figures out the image type from the actual bytes instead of trusting
// whatever the client said. the multipart Content-Type and the file
// extension are both just strings the uploader picked — sniffing the magic
// number is what actually stops someone uploading an HTML/SVG file that
// later gets served back from our own origin (stored XSS via file upload,
// basically)

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const EXTENSIONS: Record<SupportedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export function extensionFor(mime: SupportedImageMime): string {
  return EXTENSIONS[mime];
}

export function detectImageMime(buffer: Buffer): SupportedImageMime | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // RIFF container — "RIFF" ... "WEBP"
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // HEIC/HEIF — what an iPhone camera actually produces by default. ISO
  // base media format: bytes 4-8 are "ftyp" then a brand code like heic/mif1
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      return 'image/heic';
    }
  }

  return null;
}
