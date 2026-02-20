/**
 * Camera system with smooth follow and bounds.
 */

import type { Camera, Sprite } from './types';

interface InternalSprite {
  x: number;
  y: number;
  exists: boolean;
  atlas: {
    frames: Map<string, { x: number; y: number; w: number; h: number }>;
  };
}

export class CameraImpl implements Camera {
  x = 0;
  y = 0;
  zoom = 1;

  private _targetId: string | null = null;
  private _smoothing = 0.1;
  private _bounds: { x: number; y: number; w: number; h: number } | null = null;
  private _viewport: [number, number];
  private _sprites: Map<string, InternalSprite>;

  constructor(viewport: [number, number], sprites: Map<string, InternalSprite>) {
    this._viewport = viewport;
    this._sprites = sprites;
  }

  follow(target: Sprite, options?: { smoothing?: number; deadzone?: number }): void {
    this._targetId = target.id;
    this._smoothing = options?.smoothing ?? 0.1;
  }

  unfollow(): void {
    this._targetId = null;
  }

  setBounds(x: number, y: number, w: number, h: number): void {
    this._bounds = { x, y, w, h };
  }

  clearBounds(): void {
    this._bounds = null;
  }

  shake(_intensity: number, _duration: number): void {
    // TODO: implement camera shake
  }

  update(dt: number): void {
    const target = this._targetId ? this._sprites.get(this._targetId) : null;
    if (target && target.exists) {
      // Get sprite frame dimensions to center on sprite's visual center
      const firstFrame = target.atlas?.frames?.values().next().value;
      const frameW = firstFrame?.w ?? 0;
      const frameH = firstFrame?.h ?? 0;

      // Center camera on sprite center (not top-left corner)
      const targetX = target.x + frameW / 2 - this._viewport[0] / 2;
      const targetY = target.y + frameH / 2 - this._viewport[1] / 2;

      // Smooth follow
      const t = 1 - Math.pow(1 - this._smoothing, dt * 60);
      this.x += (targetX - this.x) * t;
      this.y += (targetY - this.y) * t;
    }

    // Apply bounds
    if (this._bounds) {
      this.x = Math.max(this._bounds.x, Math.min(this.x, this._bounds.x + this._bounds.w - this._viewport[0]));
      this.y = Math.max(this._bounds.y, Math.min(this.y, this._bounds.y + this._bounds.h - this._viewport[1]));
    }
  }
}
