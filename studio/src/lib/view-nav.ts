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

export interface WheelMove {
  action: NavAction;
  /// The movement in pixels as the drag moves (a drag to the right is positive), already turned the way the fingers go.
  dx: number;
  dy: number;
  /// The factor for a zoom (below 1 comes closer).
  zoom: number;
}

/// What a scroll gesture asks of the view. A trackpad scroll is reported the way the system scrolls a page: with natural scrolling,
/// fingers sliding left or up give positive deltas. The scene should follow the fingers (as if it were grabbed), which is the opposite sign of a
/// drag's movement, so both axes are turned round here; `invert` turns them back for people whose system scrolls the other way.
export function wheelMove(e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "shiftKey" | "metaKey">, scheme: NavScheme, invert: boolean): WheelMove {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // (lines or pages instead of pixels for some devices)
  const sign = invert ? 1 : -1;
  const action = wheelAction(e, scheme);
  let dx = e.deltaX * k * sign;
  let dy = e.deltaY * k * sign;
  // (Shift with the vertical scroll of a mouse wheel moves sideways)
  if (action === "pan" && e.deltaX === 0) {
    dx = dy;
    dy = 0;
  }
  return { action, dx, dy, zoom: Math.exp(e.deltaY * k * 0.01) };
}

/// A pinch as macOS WebKit (the studio's window) reports it: gesture events carrying the whole pinch's scale so far (1 at the start, above 1
/// when the fingers spread). The step between two reports is a zoom: spreading comes closer, pinching goes away.
export function pinchFactor(previousScale: number, scale: number): number {
  if (!(previousScale > 0) || !(scale > 0)) return 1;
  return previousScale / scale;
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
  const onWheel = (e: WheelEvent) => {
    if (scheme !== "trackpad") return;
    e.preventDefault();
    const camera = getCamera();
    const m = wheelMove(e, scheme, !!options.invert);
    if (m.action === "zoom") zoomBy(camera, controls.target, m.zoom);
    else if (m.action === "pan") panBy(camera, controls.target, m.dx, m.dy, canvas.clientHeight);
    else orbitBy(camera, controls.target, m.dx, m.dy);
    controls.update();
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  // a pinch on a Mac's trackpad in WebKit comes as gesture events, not as Ctrl and a scroll (which is how other browsers send it)
  let pinchScale = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    pinchScale = (e as unknown as { scale: number }).scale || 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const scale = (e as unknown as { scale: number }).scale;
    zoomBy(getCamera(), controls.target, pinchFactor(pinchScale, scale));
    pinchScale = scale;
    controls.update();
  };
  const onGestureEnd = (e: Event) => e.preventDefault();
  canvas.addEventListener("gesturestart", onGestureStart);
  canvas.addEventListener("gesturechange", onGestureChange);
  canvas.addEventListener("gestureend", onGestureEnd);
  return () => {
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("gesturestart", onGestureStart);
    canvas.removeEventListener("gesturechange", onGestureChange);
    canvas.removeEventListener("gestureend", onGestureEnd);
    controls.enableZoom = true;
  };
}

/// The one-line reminder of how to move the view for a scheme (shown under the 3D views).
export function navHint(scheme: NavScheme): string {
  if (scheme === "trackpad") return "Two fingers turn the view · Shift and two fingers move it · pinch to zoom · or use the buttons at the top right";
  if (scheme === "pen") return "Drag to turn · the pen's side button or Shift moves the view · scroll or pinch to zoom · or use the buttons at the top right";
  return "Drag to turn · right-drag or Shift-drag to move · scroll to zoom · or use the buttons at the top right";
}
