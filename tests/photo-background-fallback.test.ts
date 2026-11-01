import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({ pipeline: (...args: unknown[]) => pipeline(...args) }));
vi.mock("@/lib/photos/resize", () => ({ resizeToJpeg: async () => new Blob(["jpg"]) }));

const cutout = { toCanvas: () => ({}) };
const devicesUsed = () => pipeline.mock.calls.map((c) => (c[2] as { device: string }).device);

describe("background removal when the graphics card can't run the model", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    pipeline.mockReset();
    storage = new Map();
    vi.stubGlobal("navigator", { gpu: {} });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    });
    vi.stubGlobal("createImageBitmap", async () => ({ close: () => {} }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("switches to the CPU when the GPU fails mid-run, and remembers it next time", async () => {
    pipeline.mockImplementation(async (_task: string, _model: string, opts: { device: string }) =>
      opts.device === "webgpu"
        ? async () => {
            throw new Error("Too many storage buffers in shader. Current: 11, Max is 10");
          }
        : async () => cutout,
    );
    const { removeBackground } = await import("@/lib/photos/background");
    await expect(removeBackground("https://x/a.jpg")).resolves.toHaveProperty("photo");
    expect(devicesUsed()).toEqual(["webgpu", "wasm"]);

    vi.resetModules();
    pipeline.mockClear();
    const again = await import("@/lib/photos/background");
    await again.removeBackground("https://x/b.jpg");
    expect(devicesUsed()).toEqual(["wasm"]);
  });

  it("uses the GPU when it works", async () => {
    pipeline.mockImplementation(async () => async () => cutout);
    const { removeBackground } = await import("@/lib/photos/background");
    await removeBackground("https://x/a.jpg");
    await removeBackground("https://x/b.jpg");
    expect(devicesUsed()).toEqual(["webgpu"]);
  });
});
