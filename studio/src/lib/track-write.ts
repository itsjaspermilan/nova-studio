// Writes a track out as plain project files: `tracks/<name>.track.json` (what the editor reopens), `scenes/<name>.scene.json` and the
// road, `models/road_<name>.glb`. The desktop and browser-preview backends both go through this, on top of their own file writes.
import type { TrackDoc } from "./track-doc";
import { buildTrack, roadOf, sceneOf, serializeTrack, trackOf } from "./track-doc";
import { toBase64 } from "./wav";

export interface TrackIo {
  writeFile(path: string, text: string): Promise<void>;
  writeModel(path: string, dataUrl: string): Promise<void>;
}

/// Generates the scene and the road for a track and writes all three files. Returns a one-line report.
export async function writeTrack(io: TrackIo, name: string, doc: TrackDoc): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw "Track names use letters, numbers, - and _.";
  const files = buildTrack(doc); // (everything is made before anything is written)
  await io.writeFile(trackOf(name), serializeTrack(doc));
  await io.writeFile(sceneOf(name), files.scene);
  await io.writeModel(roadOf(name), `data:model/gltf-binary;base64,${toBase64(files.glb)}`);
  return `${name}: ${files.report}`;
}
