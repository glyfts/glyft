/**
 * DOM-based floating text system.
 *
 * Provides crisp text rendering at any scale by using CSS-animated DOM elements
 * instead of GPU-rendered text. Best for pixel art games where text clarity matters.
 *
 * Features:
 * - Pre-allocated element pool (zero allocations during gameplay)
 * - CSS animations for rise/pop effects
 * - Color tinting via CSS
 * - Automatic cleanup after duration
 * - World-to-screen coordinate conversion
 */

import type { FloatTextOptions, Camera } from './types';

// Pool configuration
const POOL_SIZE = 64;

interface TextParticle {
  element: HTMLDivElement;
  active: boolean;
  endTime: number;
  worldX: number;
  worldY: number;
  style: 'rise' | 'pop';
  speed: number;
  startTime: number;
}

export interface DomTextManager {
  /** Spawn floating text at world coordinates */
  spawn(x: number, y: number, text: string, options?: FloatTextOptions): void;
  /** Update positions and cleanup expired texts (call each frame) */
  update(dt: number, camera: Camera, viewportWidth: number, viewportHeight: number, displayWidth: number, displayHeight: number): void;
  /** Get the container element (attach to DOM) */
  getContainer(): HTMLDivElement;
  /** Destroy and cleanup */
  destroy(): void;
}

/** Convert 0xRRGGBB to CSS color string */
function hexToRgb(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Create a DOM-based floating text manager.
 */
export function createDomTextManager(): DomTextManager {
  // Create container
  const container = document.createElement('div');
  container.className = 'glyft-domtext-container';
  container.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
    z-index: 10;
  `;

  // Add CSS for animations
  const style = document.createElement('style');
  style.textContent = `
    .glyft-domtext {
      position: absolute;
      font-family: monospace;
      font-weight: bold;
      white-space: nowrap;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000,
                   -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000;
      transform: translate(-50%, -50%);
      will-change: transform, opacity;
    }
    .glyft-domtext-rise {
      animation: glyft-rise var(--duration) ease-out forwards;
    }
    .glyft-domtext-pop {
      animation: glyft-pop var(--duration) ease-out forwards;
    }
    @keyframes glyft-rise {
      0% { opacity: 1; }
      70% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes glyft-pop {
      0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
      20% { transform: translate(-50%, -50%) scale(1.2); }
      40% { transform: translate(-50%, -50%) scale(1); }
      70% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  container.appendChild(style);

  // Pre-allocate pool
  const pool: TextParticle[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'glyft-domtext';
    el.style.display = 'none';
    container.appendChild(el);
    pool.push({
      element: el,
      active: false,
      endTime: 0,
      worldX: 0,
      worldY: 0,
      style: 'rise',
      speed: 30,
      startTime: 0,
    });
  }

  let nextSlot = 0;
  let currentTime = 0;

  return {
    spawn(x: number, y: number, text: string, options?: FloatTextOptions) {
      // Find inactive slot
      let particle: TextParticle | null = null;
      for (let i = 0; i < POOL_SIZE; i++) {
        const idx = (nextSlot + i) % POOL_SIZE;
        if (!pool[idx].active) {
          particle = pool[idx];
          nextSlot = (idx + 1) % POOL_SIZE;
          break;
        }
      }

      // Recycle oldest if all active
      if (!particle) {
        particle = pool[nextSlot];
        particle.active = false;
        nextSlot = (nextSlot + 1) % POOL_SIZE;
      }

      const color = options?.color ?? 0xffffff;
      const style = options?.style ?? 'rise';
      const duration = options?.duration ?? 1.0;
      const speed = options?.speed ?? 30;
      const scale = options?.scale ?? 1;

      const el = particle.element;
      el.textContent = text;
      el.style.color = hexToRgb(color);
      el.style.fontSize = `${14 * scale}px`;
      el.style.setProperty('--duration', `${duration}s`);
      el.className = `glyft-domtext glyft-domtext-${style}`;
      el.style.display = 'block';

      // Small random X jitter for pop style
      const jitterX = style === 'pop' ? (Math.random() - 0.5) * 6 : 0;

      particle.active = true;
      particle.worldX = x + jitterX;
      particle.worldY = y;
      particle.style = style as 'rise' | 'pop';
      particle.speed = speed;
      particle.startTime = currentTime;
      particle.endTime = currentTime + duration;
    },

    update(dt: number, camera: Camera, viewportWidth: number, viewportHeight: number, displayWidth: number, displayHeight: number) {
      currentTime += dt;
      const scaleX = displayWidth / viewportWidth;
      const scaleY = displayHeight / viewportHeight;

      for (const particle of pool) {
        if (!particle.active) continue;

        // Check expiration
        if (currentTime >= particle.endTime) {
          particle.active = false;
          particle.element.style.display = 'none';
          continue;
        }

        // Update world Y position for rise animation
        if (particle.style === 'rise') {
          particle.worldY -= particle.speed * dt;
        }

        // Convert world to screen coordinates
        const screenX = (particle.worldX - camera.x) * scaleX;
        const screenY = (particle.worldY - camera.y) * scaleY;

        // Hide if off-screen
        if (screenX < -50 || screenX > displayWidth + 50 ||
            screenY < -50 || screenY > displayHeight + 50) {
          particle.element.style.visibility = 'hidden';
        } else {
          particle.element.style.visibility = 'visible';
          particle.element.style.left = `${screenX}px`;
          particle.element.style.top = `${screenY}px`;
        }
      }
    },

    getContainer() {
      return container;
    },

    destroy() {
      container.remove();
    },
  };
}
