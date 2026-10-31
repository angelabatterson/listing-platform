// Background removal that runs in the seller's own browser, so it's free and needs no
// API key. The model is BiRefNet lite (MIT licence), downloaded from Hugging Face the
// first time (about 115 MB with WebGPU, 225 MB without) and then cached by the browser.
import type { RawImage } from "@huggingface/transformers";
import { PHOTO_EDGE, THUMB_EDGE } from "./limits";
import { resizeToJpeg } from "./resize";

export const BACKGROUND_MODEL = "onnx-community/BiRefNet_lite-ONNX";

type Remover = (image: string) => Promise<RawImage | RawImage[]>;

let remover: Promise<Remover> | null = null;

function loadRemover(onProgress: (percent: number) => void): Promise<Remover> {
  remover ??= (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const load = (device: "webgpu" | "wasm") =>
      pipeline("background-removal", BACKGROUND_MODEL, {
        device,
        dtype: device === "webgpu" ? "fp16" : "fp32",
        progress_callback: (info) => {
          if (info.status === "progress_total") onProgress(Math.round(info.progress));
        },
      });
    // WebGPU (most current Chrome and Edge) is much faster; older browsers use the CPU.
    const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const segmenter = hasGpu ? await load("webgpu").catch(() => load("wasm")) : await load("wasm");
    return (image: string) => segmenter(image);
  })();
  // A failed download shouldn't stick: let the next click try again.
  remover.catch(() => {
    remover = null;
  });
  return remover;
}

// Cuts the item out of the photo at `url` and puts it on a white background, as most
// marketplaces prefer. Returns the full-size and thumbnail JPEGs, ready to upload.
export async function removeBackground(
  url: string,
  onProgress: (percent: number) => void = () => {},
): Promise<{ photo: Blob; thumb: Blob }> {
  const remove = await loadRemover(onProgress).catch((err) => {
    console.error(err);
    throw new Error("Couldn't download the background tool. Check your internet connection and try again.");
  });
  const result = await remove(url);
  const cutout = Array.isArray(result) ? result[0] : result;
  const bitmap = await createImageBitmap(cutout.toCanvas() as HTMLCanvasElement | OffscreenCanvas);
  try {
    // resizeToJpeg fills white before drawing, so the transparent background turns white.
    const [photo, thumb] = await Promise.all([resizeToJpeg(bitmap, PHOTO_EDGE, 0.9), resizeToJpeg(bitmap, THUMB_EDGE, 0.7)]);
    return { photo, thumb };
  } finally {
    bitmap.close();
  }
}

// The photo's file name when it's one of Relistic's own photo links, which are the only
// ones that can be edited (other sites' photos can't be read by the browser).
export function relisticPhotoFile(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = /^\/api\/photos\/([0-9a-f-]{36}-[A-Za-z0-9_-]{22}\.jpg)$/.exec(pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
