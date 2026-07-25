/**
 * First-person camera controller for Glyft.
 * Game-agnostic — handles input, mouse look, and movement deltas.
 * The game is responsible for collision detection and setting the final position.
 */

import type { Camera3D } from './terrain';
import type { Vec3 } from './math3d';

export interface FPSCameraConfig {
  /** Mouse sensitivity in radians per pixel. Default: 0.002 */
  sensitivity?: number;
  /** Eye height above the ground position. Default: 1.6 */
  eyeHeight?: number;
  /** Movement speed in world units per second. Default: 5.0 */
  moveSpeed?: number;
  /** Sprint speed multiplier. Default: 1.6 */
  sprintMultiplier?: number;
  /** Head bob amplitude in world units. 0 to disable. Default: 0.04 */
  headBob?: number;
  /** Head bob frequency (steps per second). Default: 8 */
  headBobFreq?: number;
  /** Field of view in radians. Default: Math.PI / 3 (60 degrees) */
  fov?: number;
  /** Near clip plane. Default: 0.1 */
  near?: number;
  /** Far clip plane. Default: 200 */
  far?: number;
  /** Vertical look limit in radians (how far up/down). Default: Math.PI * 0.45 */
  pitchLimit?: number;
}

export class FPSCamera {
  /** Horizontal rotation in radians. 0 = looking along +X. */
  yaw = 0;
  /** Vertical rotation in radians. Positive = looking up. */
  pitch = 0;
  /** World position X. */
  x = 0;
  /** World position Y (height — set by game after terrain sampling). */
  y = 0;
  /** World position Z. */
  z = 0;

  /** The Camera3D struct used by terrain/billboard/mesh renderers. */
  readonly camera: Camera3D;

  // Config
  private sensitivity: number;
  private eyeHeight: number;
  private moveSpeed: number;
  private sprintMultiplier: number;
  private headBob: number;
  private headBobFreq: number;
  private pitchLimit: number;

  // Input state
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private consumed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private locked = false;

  // Head bob state
  private bobPhase = 0;
  private bobActive = false;

  // Listeners (stored for cleanup)
  private canvas: HTMLCanvasElement | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onPointerLock: (() => void) | null = null;
  private onClick: (() => void) | null = null;

  constructor(config?: FPSCameraConfig) {
    const c = config || {};
    this.sensitivity = c.sensitivity ?? 0.002;
    this.eyeHeight = c.eyeHeight ?? 1.6;
    this.moveSpeed = c.moveSpeed ?? 5.0;
    this.sprintMultiplier = c.sprintMultiplier ?? 1.6;
    this.headBob = c.headBob ?? 0.04;
    this.headBobFreq = c.headBobFreq ?? 8;
    this.pitchLimit = c.pitchLimit ?? (Math.PI * 0.45);

    this.camera = {
      position: [0, 0, 0],
      target: [0, 0, 0],
      fov: c.fov ?? (Math.PI / 3),
      near: c.near ?? 0.1,
      far: c.far ?? 200,
    };
  }

  /** Attach input listeners to the canvas. Enables pointer lock on click. */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    this.onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!this.keys.has(key)) {
        this.pressedThisFrame.add(key);
      }
      this.keys.add(key);
      // Prevent scrolling for game keys
      if (['w', 'a', 's', 'd', ' ', 'shift', 'e', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      this.keys.delete(key);
      this.consumed.delete(key);
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    };

    this.onPointerLock = () => {
      this.locked = document.pointerLockElement === canvas;
    };

    this.onClick = () => {
      if (!this.locked) {
        canvas.requestPointerLock();
      }
    };

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Remove all input listeners. */
  detach(): void {
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onKeyUp) document.removeEventListener('keyup', this.onKeyUp);
    if (this.onMouseMove) document.removeEventListener('mousemove', this.onMouseMove);
    if (this.onPointerLock) document.removeEventListener('pointerlockchange', this.onPointerLock);
    if (this.onClick && this.canvas) this.canvas.removeEventListener('click', this.onClick);
    this.canvas = null;
  }

  /** Whether pointer lock is active. */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Check if a key is currently held down. */
  isDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /** Check if a key was pressed this frame (single-shot). */
  wasPressed(key: string): boolean {
    const k = key.toLowerCase();
    return this.pressedThisFrame.has(k) && !this.consumed.has(k);
  }

  /** Consume a key press so it won't trigger again until re-pressed. */
  consumePress(key: string): void {
    this.consumed.add(key.toLowerCase());
  }

  /**
   * Process mouse look and calculate the desired movement delta.
   * Returns [dx, dz] — the world-space movement vector BEFORE collision.
   * The game should:
   *   1. Apply collision detection to the delta
   *   2. Set fps.x, fps.z to the final position
   *   3. Set fps.y to terrain height + eyeHeight
   *   4. Call fps.updateCamera()
   */
  getMoveDelta(dt: number): [number, number] {
    // Mouse look
    if (this.mouseDX !== 0 || this.mouseDY !== 0) {
      this.yaw += this.mouseDX * this.sensitivity;
      this.pitch -= this.mouseDY * this.sensitivity;
      this.pitch = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.pitch));
      this.mouseDX = 0;
      this.mouseDY = 0;
    }

    // Keyboard look (fallback for no mouse)
    if (this.keys.has('arrowleft')) this.yaw -= 2.0 * dt;
    if (this.keys.has('arrowright')) this.yaw += 2.0 * dt;
    if (this.keys.has('arrowup')) this.pitch = Math.min(this.pitchLimit, this.pitch + 1.5 * dt);
    if (this.keys.has('arrowdown')) this.pitch = Math.max(-this.pitchLimit, this.pitch - 1.5 * dt);

    // Movement
    let moveX = 0, moveZ = 0;
    const cosYaw = Math.cos(this.yaw);
    const sinYaw = Math.sin(this.yaw);

    if (this.keys.has('w')) { moveX += cosYaw; moveZ += sinYaw; }
    if (this.keys.has('s')) { moveX -= cosYaw; moveZ -= sinYaw; }
    if (this.keys.has('a')) { moveX += sinYaw; moveZ -= cosYaw; }
    if (this.keys.has('d')) { moveX -= sinYaw; moveZ += cosYaw; }

    let speed = this.moveSpeed;
    if (this.keys.has('shift')) speed *= this.sprintMultiplier;

    let dx = 0, dz = 0;
    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      dx = (moveX / len) * speed * dt;
      dz = (moveZ / len) * speed * dt;
      this.bobActive = true;
    } else {
      this.bobActive = false;
    }

    // Head bob
    if (this.bobActive && this.headBob > 0) {
      this.bobPhase += dt * this.headBobFreq * Math.PI * 2;
    } else {
      // Smoothly return to center
      this.bobPhase *= 0.9;
    }

    // Clear per-frame state
    this.pressedThisFrame.clear();

    return [dx, dz];
  }

  /**
   * Update the Camera3D struct from current position + angles.
   * Call this AFTER setting x, y, z to the final collision-resolved position.
   */
  updateCamera(): void {
    const bobOffset = this.headBob > 0 ? Math.sin(this.bobPhase) * this.headBob : 0;
    const eyeY = this.y + this.eyeHeight + bobOffset;

    // Camera position = eye position
    this.camera.position[0] = this.x;
    this.camera.position[1] = eyeY;
    this.camera.position[2] = this.z;

    // Target = position + look direction
    const cosPitch = Math.cos(this.pitch);
    this.camera.target[0] = this.x + Math.cos(this.yaw) * cosPitch;
    this.camera.target[1] = eyeY + Math.sin(this.pitch);
    this.camera.target[2] = this.z + Math.sin(this.yaw) * cosPitch;
  }

  /**
   * Get the forward direction as a unit vector [x, y, z].
   * Useful for projectiles, raycasting, etc.
   */
  getForward(): Vec3 {
    const cosPitch = Math.cos(this.pitch);
    return [
      Math.cos(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.sin(this.yaw) * cosPitch,
    ];
  }

  /**
   * Get the horizontal forward direction [x, 0, z] (ignoring pitch).
   * Useful for movement direction checks.
   */
  getHorizontalForward(): Vec3 {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }
}
