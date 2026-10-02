/**
 * Config-driven 3D camera: follow, orbit, fps and fixed modes.
 *
 * Works in world units. The world system feeds it the target position
 * each frame and a ground-height function for follow-cam collision.
 */

import type { CameraDef } from './types';
import type { Camera3D } from './terrain';
import type { Vec3 } from './math3d';

export interface CameraRig {
  readonly camera: Camera3D;
  /** Current yaw (radians). Forward on the ground is (-sin yaw, -cos yaw). */
  readonly yaw: number;
  readonly mode: CameraDef['mode'];
  /** Advance one frame. `target` is the followed point in world units, or null. */
  update(dt: number, target: Vec3 | null, groundAt: (x: number, z: number) => number): void;
  /** Jump straight to the target next update instead of easing (area changes) */
  snap(): void;
  /** Turn the camera (radians) */
  setYaw(yaw: number): void;
  destroy(): void;
}

export function createCameraRig(canvas: HTMLCanvasElement, def: CameraDef, tileSize: number): CameraRig {
  const mode = def.mode;
  const fps = mode === 'fps';
  let yaw = def.yaw ?? 0;
  let pitch = def.pitch ?? (fps ? 0 : 0.5);
  let dist = def.distance ?? 14;
  const [zoomMin, zoomMax] = def.zoom ?? [4, 60];
  const collide = def.collide ?? true;
  const eyeHeight = def.eyeHeight ?? 1.6;

  const toWorld = (p: [number, number, number]): Vec3 => [p[0] / tileSize, p[2], p[1] / tileSize];
  const fixedPos = def.position ? toWorld(def.position) : null;
  const lookAt = def.lookAt ? toWorld(def.lookAt) : null;

  const camera: Camera3D = {
    position: fixedPos ? [...fixedPos] as Vec3 : [0, 10, 10],
    target: lookAt ? [...lookAt] as Vec3 : [0, 0, 0],
    fov: def.fov ?? (fps ? Math.PI / 3 : Math.PI / 4),
    near: fps ? 0.05 : 0.3,
    far: def.far ?? 400,
  };

  // ---- Input ----
  let dragging = false;
  let lastX = 0, lastY = 0;
  const rotateKeys = new Set<string>();

  const onDown = (e: PointerEvent) => {
    if (fps) {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
      return;
    }
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e: PointerEvent | MouseEvent) => {
    if (fps) {
      if (document.pointerLockElement !== canvas) return;
      yaw -= e.movementX * 0.0025;
      pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0025));
      return;
    }
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.006;
    pitch = Math.max(0.05, Math.min(1.45, pitch + (e.clientY - lastY) * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => { dragging = false; };
  const onWheel = (e: WheelEvent) => {
    dist = Math.max(zoomMin, Math.min(zoomMax, dist * (1 + Math.sign(e.deltaY) * 0.1)));
    e.preventDefault();
  };
  const onContext = (e: Event) => e.preventDefault();
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyQ' && e.code !== 'KeyE') return;
    if (e.type === 'keydown') rotateKeys.add(e.code); else rotateKeys.delete(e.code);
  };

  const interactive = mode !== 'fixed';
  if (interactive) {
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onContext);
    if (!fps) canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
  }

  const smoothTarget: Vec3 = [0, 0, 0];
  let first = true;

  return {
    camera,
    get yaw() { return yaw; },
    mode,

    update(dt, target, groundAt) {
      if (rotateKeys.has('KeyQ')) yaw += 2 * dt;
      if (rotateKeys.has('KeyE')) yaw -= 2 * dt;

      if (mode === 'fixed') {
        if (target && !lookAt) camera.target = [target[0], target[1] + 1, target[2]];
        return;
      }

      if (fps) {
        const base = target ?? fixedPos ?? [0, 0, 0];
        const eye: Vec3 = [base[0], base[1] + eyeHeight, base[2]];
        const cp = Math.cos(pitch);
        camera.position = eye;
        camera.target = [eye[0] - Math.sin(yaw) * cp, eye[1] + Math.sin(pitch), eye[2] - Math.cos(yaw) * cp];
        return;
      }

      // follow / orbit: circle the focus point
      const focus = target ?? lookAt ?? [0, 0, 0];
      const k = first ? 1 : 1 - Math.pow(0.0005, dt);
      first = false;
      smoothTarget[0] += (focus[0] - smoothTarget[0]) * k;
      smoothTarget[1] += (focus[1] + 1.2 - smoothTarget[1]) * k;
      smoothTarget[2] += (focus[2] - smoothTarget[2]) * k;

      const dirX = Math.sin(yaw) * Math.cos(pitch);
      const dirY = Math.sin(pitch);
      const dirZ = Math.cos(yaw) * Math.cos(pitch);

      // Pull in when the ground blocks the view (follow mode)
      let d = dist;
      if (mode === 'follow' && collide) {
        for (let i = 10; i >= 1; i--) {
          const t = (dist * i) / 10;
          const x = smoothTarget[0] + dirX * t, y = smoothTarget[1] + dirY * t, z = smoothTarget[2] + dirZ * t;
          if (y < groundAt(x, z) + 0.6) d = (dist * (i - 1)) / 10;
          else break;
        }
        d = Math.max(zoomMin * 0.5, d);
      }

      camera.target = [smoothTarget[0], smoothTarget[1], smoothTarget[2]];
      camera.position = [smoothTarget[0] + dirX * d, smoothTarget[1] + dirY * d, smoothTarget[2] + dirZ * d];
    },

    snap() {
      first = true;
    },

    setYaw(v) {
      yaw = v;
    },

    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    },
  };
}
