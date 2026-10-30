"use client";

import { useRouter } from "next/navigation";
import { useState, type DragEvent } from "react";
import { PHOTO_EDGE, THUMB_EDGE } from "@/lib/photos/limits";
import { eachLimited, resizeToJpeg } from "@/lib/photos/resize";

async function uploadOne(batchId: string, file: File, position: number) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name}: this browser can't open that file type. Try a JPEG or PNG.`);
  }
  const [photo, thumb] = await Promise.all([
    resizeToJpeg(bitmap, PHOTO_EDGE, 0.85),
    resizeToJpeg(bitmap, THUMB_EDGE, 0.7),
  ]).finally(() => bitmap.close());

  const body = new FormData();
  body.set("photo", photo, file.name);
  body.set("thumb", thumb, file.name);
  body.set("position", String(position));
  const res = await fetch(`/api/batches/${batchId}/photos`, { method: "POST", body });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: undefined }));
    throw new Error(error ?? `${file.name}: upload failed.`);
  }
}

export function PhotoUploader(props: { batchId: string; photoCount: number; limit: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const room = Math.max(0, props.limit - props.photoCount);

  async function upload(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (files.length === 0) return;
    const accepted = files.slice(0, room);
    const problems = files.length > room ? [`Only ${room} more photos fit in this batch. Start a new batch for the rest.`] : [];
    // Sort by name so camera files ("IMG_0012") stay in the order they were taken.
    accepted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    setErrors(problems);
    setProgress({ done: 0, total: accepted.length });
    await eachLimited(accepted, 3, async (file, i) => {
      try {
        await uploadOne(props.batchId, file, props.photoCount + i);
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
      setProgress((p) => p && { ...p, done: p.done + 1 });
    });
    setErrors([...problems]);
    setProgress(null);
    router.refresh();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!progress) upload(e.dataTransfer.files);
  };

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-10 text-center ${
          dragging ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"
        }`}
      >
        <span className="font-medium">
          {progress ? `Uploading ${progress.done} of ${progress.total}…` : "Drop photos here, or click to choose"}
        </span>
        <span className="text-sm text-zinc-500">
          Shoot each item one after another; the AI sorts them into listings. Up to {props.limit.toLocaleString("en-US")} photos per batch on your plan.
        </span>
        <input
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="sr-only"
          disabled={Boolean(progress) || room <= 0}
          onChange={(e) => {
            upload(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </label>
      {errors.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-600">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
