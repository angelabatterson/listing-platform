// Background removal that runs in the seller's own browser, so it's free and needs no
// API key. The model is BiRefNet lite (MIT licence), downloaded from Hugging Face the
// first time (about 115 MB with WebGPU, 225 MB without) and then cached by the browser.
import type { RawImage } from "@huggingface/transformers";
import { PHOTO_EDGE, THUMB_EDGE } from "./limits";
import { resizeToJpeg } from "./resize";

export const BACKGROUND_MODEL = "onnx-community/BiRefNet_lite-ONNX";

type Device = "webgpu" | "wasm";
type Remover = (image: string) => Promise<RawImage | RawImage[]>;

const loaded: Partial<Record<Device, Promise<Remover>>> = {};
const NO_GPU_KEY = "relistic:background-no-gpu";

// Some graphics cards can't run this model (for example "Too many storage buffers in
// shader"). Once that happens the browser remembers it and goes straight to the CPU.
function gpuUsable(): boolean {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  try {
    return localStorage.getItem(NO_GPU_KEY) !== "1";
  } catch {
    return true;
  }
}

function giveUpOnGpu() {
  try {
    localStorage.setItem(NO_GPU_KEY, "1");
  } catch {
    // Private windows can refuse storage; we'll just try the GPU again next time.
  }
}

function loadRemover(device: Device, onProgress: (percent: number) => void): Promise<Remover> {
  const existing = loaded[device];
  if (existing) return existing;
  const loading = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const segmenter = await pipeline("background-removal", BACKGROUND_MODEL, {
      device,
      dtype: device === "webgpu" ? "fp16" : "fp32",
      progress_callback: (info) => {
        if (info.status === "progress_total") onProgress(Math.round(info.progress));
      },
    });
    return (image: string) => segmenter(image);
  })();
  loaded[device] = loading;
  // A failed download shouldn't stick: let the next click try again.
  loading.catch(() => {
    delete loaded[device];
  });
  return loading;
}

async function runOn(device: Device, url: string, onProgress: (percent: number) => void) {
  const remove = await loadRemover(device, onProgress).catch((err) => {
    console.error(err);
    throw new DownloadError();
  });
  return remove(url);
}

class DownloadError extends Error {
  constructor() {
    super("Couldn't download the background tool. Check your internet connection and try again.");
  }
}

// WebGPU (most current Chrome and Edge) is much faster. If the graphics card can't load
// or run the model, the CPU version does the job instead, more slowly.
async function cutOut(url: string, onProgress: (percent: number) => void) {
  if (gpuUsable()) {
    try {
      return await runOn("webgpu", url, onProgress);
    } catch (err) {
      console.warn("Background removal on the graphics card failed; using the CPU instead.", err);
      giveUpOnGpu();
      delete loaded.webgpu;
    }
  }
  try {
    return await runOn("wasm", url, onProgress);
  } catch (err) {
    if (err instanceof DownloadError) throw err;
    console.error(err);
    throw new Error("Couldn't remove the background from this photo. Try again, or try another photo.");
  }
}

// Cuts the item out of the photo at `url` and puts it on a white background, as most
// marketplaces prefer. Returns the full-size and thumbnail JPEGs, ready to upload.
export async function removeBackground(
  url: string,
  onProgress: (percent: number) => void = () => {},
): Promise<{ photo: Blob; thumb: Blob }> {
  const result = await cutOut(url, onProgress);
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
