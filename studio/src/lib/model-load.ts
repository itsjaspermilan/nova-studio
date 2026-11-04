// What a scene view draws for a model: the studio's own `models/<name>.model.json`, or, when a model is only a `.glb` (one from a
// kit, say), that file read into a model for drawing: its parts and shapes, with the colours its picture gives (see glb-import).
import { embeddedImage, importGlb } from "./glb-import";
import { parseModel, type ModelDoc } from "./model-doc";
import type { Raster } from "./pixels";
import { loadRaster } from "./png";
import type { Api } from "./types";
import { fromBase64, toBase64 } from "./wav";

/// Decodes a picture to pixels (the browser's canvas does it; tests give their own).
export type Decode = (mime: string, bytes: Uint8Array) => Promise<Raster | undefined>;

const browserDecode: Decode = (mime, bytes) => loadRaster(`data:${mime};base64,${toBase64(bytes)}`).catch(() => undefined);

export async function loadModelDoc(api: Pick<Api, "readFile" | "readModel">, name: string, decode: Decode = browserDecode): Promise<ModelDoc | null> {
  const file = await api.readFile(`models/${name}.model.json`).catch(() => null);
  const own = file?.text != null ? parseModel(file.text) : null;
  if (own?.ok) return own.doc;
  const url = await api.readModel(`models/${name}.glb`).catch(() => null);
  if (!url) return null;
  const bytes = fromBase64(url.slice(url.indexOf(",") + 1));
  const image = embeddedImage(bytes);
  const texture = image ? await decode(image.mime, image.bytes) : undefined;
  const imported = importGlb(bytes, texture ? { texture } : {});
  return imported.ok ? imported.doc : null;
}
