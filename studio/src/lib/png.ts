// Browser-side PNG helpers: the webview's canvas does the decoding and encoding.
import type { Raster } from "./pixels";

export function loadRaster(url: string): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("no 2D canvas available"));
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ w: canvas.width, h: canvas.height, data: new Uint8ClampedArray(data) });
    };
    img.onerror = () => reject(new Error("the image could not be decoded"));
    img.src = url;
  });
}

export function rasterToDataUrl(r: Raster): string {
  const canvas = document.createElement("canvas");
  canvas.width = r.w;
  canvas.height = r.h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
  return canvas.toDataURL("image/png");
}
