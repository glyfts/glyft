/**
 * Input handling for keyboard and pointer.
 */

import type { Input } from './types';

export class InputImpl implements Input {
  private _keys: Set<string> = new Set();
  private _justPressed: Set<string> = new Set();
  private _justReleased: Set<string> = new Set();
  private _pointerX = 0;
  private _pointerY = 0;
  private _pointerDown = false;
  private _viewportWidth: number;
  private _viewportHeight: number;

  constructor(canvas: HTMLCanvasElement, viewportWidth: number = 0, viewportHeight: number = 0) {
    this._viewportWidth = viewportWidth || canvas.width;
    this._viewportHeight = viewportHeight || canvas.height;

    window.addEventListener('keydown', (e) => {
      if (!this._keys.has(e.code)) {
        this._justPressed.add(e.code);
      }
      this._keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      this._justReleased.add(e.code);
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      // Scale pointer coordinates from canvas space to viewport space
      // This accounts for zoom (viewport smaller than canvas = zoomed in)
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const scaleX = this._viewportWidth / rect.width;
      const scaleY = this._viewportHeight / rect.height;
      this._pointerX = canvasX * scaleX;
      this._pointerY = canvasY * scaleY;
    });

    canvas.addEventListener('pointerdown', () => {
      this._pointerDown = true;
    });

    canvas.addEventListener('pointerup', () => {
      this._pointerDown = false;
    });
  }

  isDown(key: string): boolean {
    return this._keys.has(key);
  }

  justPressed(key: string): boolean {
    return this._justPressed.has(key);
  }

  justReleased(key: string): boolean {
    return this._justReleased.has(key);
  }

  get pointer() {
    return {
      x: this._pointerX,
      y: this._pointerY,
      down: this._pointerDown,
    };
  }

  update(): void {
    this._justPressed.clear();
    this._justReleased.clear();
  }

  /** Update viewport dimensions (call when viewport changes) */
  setViewport(width: number, height: number): void {
    this._viewportWidth = width;
    this._viewportHeight = height;
  }
}
