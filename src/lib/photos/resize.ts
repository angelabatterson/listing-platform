// Browser-side photo shrinking, so uploads are small and fast even from a phone.

export function scaledSize(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function resizeToJpeg(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const size = scaledSize(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize photos.");
  // JPEG has no transparency; fill white so PNG cut-outs don't turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't compress the photo."))), "image/jpeg", quality),
  );
}

// Run `worker` over `inputs`, at most `limit` at a time.
export async function eachLimited<T>(inputs: T[], limit: number, worker: (input: T, index: number) => Promise<void>) {
  let next = 0;
  const run = async () => {
    while (next < inputs.length) {
      const index = next++;
      await worker(inputs[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, run));
}
