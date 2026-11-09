// How a person moves around a 3D view (docs/studio-ux.md, section 4). Three input schemes share one set of moves, orbit, pan and zoom:
//  - mouse: left or middle button drags orbit, right drag (or Shift with a drag) pans, the wheel zooms;
//  - trackpad: two fingers sliding orbit, Shift and two fingers pan, a pinch (or Ctrl and the scroll) zooms, plus the mouse moves;
//  - pen: a pen drags like a mouse (its barrel button is the right button), and the wheel zooms.
// The views use three.js OrbitControls for the drags; this adds the trackpad's scroll gestures and sets the buttons.

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export type NavScheme = "mouse" | "trackpad" | "pen";
export type NavAction = "orbit" | "pan" | "zoom";

/// What a wheel event does: a pinch arrives as a wheel event with Ctrl held, so Ctrl is zoom everywhere; on a trackpad a plain scroll
/// orbits and Shift pans, on a mouse and a pen the wheel zooms and Shift pans.
export function wheelAction(e: { ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean }, scheme: NavScheme): NavAction {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (scheme === "trackpad") return e.shiftKey ? "pan" : "orbit";
  return e.shiftKey ? "pan" : "zoom";
}

const TURN_PER_PIXEL = 0.005;
const MIN_DISTANCE = 0.05;

/// Turns the camera around its target by a movement in pixels (right turns the view left, as dragging the scene would).
export function orbitBy(camera: THREE.Camera, target: THREE.Vector3, dx: number, dy: number): void {
  const offset = camera.position.clone().sub(target);
  const s = new THREE.Spherical().setFromVector3(offset);
  s.theta -= dx * TURN_PER_PIXEL;
  s.phi = Math.min(Math.PI - 0.01, Math.max(0.01, s.phi - dy * TURN_PER_PIXEL));
  offset.setFromSpherical(s);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

/// Slides the camera and its target across the view by a movement in pixels.
export function panBy(camera: ViewCamera, target: THREE.Vector3, dx: number, dy: number, viewHeight: number): void {
  const perPixel =
    camera instanceof THREE.OrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom / Math.max(1, viewHeight)
      : (2 * camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewHeight);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
  const move = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));
  camera.position.add(move);
  target.add(move);
}

/// Moves the camera toward (factor < 1) or away from (factor > 1) its target.
export function zoomBy(camera: ViewCamera, target: THREE.Vector3, factor: number): void {
  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = Math.max(0.01, camera.zoom / factor);
    camera.updateProjectionMatrix();
    return;
  }
  const offset = camera.position.clone().sub(target);
  const length = Math.max(MIN_DISTANCE, offset.length() * factor);
  camera.position.copy(target).add(offset.setLength(length));
}

export interface NavOptions {
  /// Flips the direction of the scroll gestures (the opposite of the system's "natural scrolling").
  invert?: boolean;
}

/// Sets the controls' buttons for a scheme and, for a trackpad, takes over the scroll gestures. Returns a function that undoes it.
export function applyNavigation(controls: OrbitControls, getCamera: () => ViewCamera, canvas: HTMLElement, scheme: NavScheme, options: NavOptions = {}): () => void {
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  // (OrbitControls swaps rotate and pan while Shift, Ctrl or Cmd is held, so Shift with a drag pans in every scheme)
  controls.enableZoom = scheme !== "trackpad";
  const sign = options.invert ? -1 : 1;
  const onWheel = (e: WheelEvent) => {
    if (scheme !== "trackpad") return;
    e.preventDefault();
    const camera = getCamera();
    const action = wheelAction(e, scheme);
    // (the browser reports lines instead of pixels for some devices)
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * k * sign;
    const dy = e.deltaY * k * sign;
    if (action === "zoom") zoomBy(camera, controls.target, Math.exp(e.deltaY * k * 0.01));
    else if (action === "pan") panBy(camera, controls.target, e.shiftKey && dx === 0 ? dy : dx, e.shiftKey && dx === 0 ? 0 : dy, canvas.clientHeight);
    else orbitBy(camera, controls.target, dx, dy);
    controls.update();
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    canvas.removeEventListener("wheel", onWheel);
    controls.enableZoom = true;
  };
}
