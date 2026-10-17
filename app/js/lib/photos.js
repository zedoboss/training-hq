// Photos: shrunk on the device (longest side 1280 px, JPEG) before they are stored and synced.
export async function fileToJpeg(file, { max = 1280, quality = 0.8 } = {}) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export const newPhotoId = () => `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
