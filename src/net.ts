/**
 * Multiplayer (config.network): players in the same room see each other.
 *
 * Speaks to a Wyrt server running wyrt_sync. You move locally with no lag;
 * your state (position, facing, height, what you ride) goes out up to
 * `rate` times a second. Everyone else is an ordinary sprite here, shown a
 * moment in the past and blended between updates so they glide instead of
 * stepping. Shared vehicles (controller.board) follow whoever rides them.
 */

import type { Network, NetworkConfig, NetworkPlayer, Sprite } from './types';
import type { WorldSystem } from './world3d';

/** What the engine lends the network */
export interface NetHost {
  readonly world: WorldSystem | null;
  /** The local player's sprite, if it's in play */
  findPlayer(): Sprite | undefined;
  getById(id: string): Sprite | undefined;
  /** Create a sprite for another player (no tags: your rules don't touch it) */
  spawn(type: string): Sprite;
  /** Height in world units (3D), for jumps, roofs and seats */
  heightOf(id: string): number;
  /** Shared world sprites (vehicles) have the same key on every client */
  keyOf(id: string): string | undefined;
  idOf(key: string): string | undefined;
}

interface RideState { k: string; x: number; y: number; z: number; f: number; m: boolean }
interface State { a: string; x: number; y: number; z: number; f: number; vx: number; vy: number; r?: RideState | null }
interface Sample { t: number; s: State }

interface Remote {
  id: number;
  name: string;
  samples: Sample[];
  sprite: Sprite | null;
  /** Local id of the shared vehicle they're riding */
  vehicle: string | null;
}

/** How far in the past others are shown, so there's always a later update to blend towards */
const DELAY = 0.15;
const KEEP = 12;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface NetworkSystem extends Network {
  update(dt: number): void;
  destroy(): void;
}

export function createNetwork(config: NetworkConfig, host: NetHost): NetworkSystem {
  const room = config.room ?? location.pathname;
  const interval = 1 / Math.max(1, config.rate ?? 15);
  const remotes = new Map<number, Remote>();
  const listeners = new Map<string, ((player: NetworkPlayer | null, data: unknown) => void)[]>();
  let ws: WebSocket | null = null;
  let myId: number | null = null;
  let retry = 2000;
  let closed = false;
  let sendTimer = 0;
  let lastSent = '';
  let lastSentAt = 0;
  let warned = false;

  const now = () => performance.now() / 1000;

  function emit(name: string, player: NetworkPlayer | null, data?: unknown): void {
    for (const cb of listeners.get(name) ?? []) cb(player, data);
  }

  function view(r: Remote): NetworkPlayer {
    return {
      id: r.id,
      name: r.name,
      area: r.samples.length ? r.samples[r.samples.length - 1].s.a : null,
      sprite: r.sprite,
    };
  }

  function addRemote(id: number, name: string, s: State | null): Remote {
    const r: Remote = { id, name, samples: [], sprite: null, vehicle: null };
    if (s) r.samples.push({ t: now(), s });
    remotes.set(id, r);
    return r;
  }

  /** Stop drawing someone (left, or somewhere you can't see); whatever they rode stays put */
  function hide(r: Remote): void {
    if (r.sprite) {
      host.world?.clearRemote(r.sprite.id);
      r.sprite.destroy();
      r.sprite = null;
    }
    letGo(r);
  }

  function letGo(r: Remote): void {
    if (!r.vehicle) return;
    host.world?.clearRemote(r.vehicle);
    const v = host.getById(r.vehicle);
    if (v) { v.vx = 0; v.vy = 0; }
    r.vehicle = null;
  }

  /** Put shared things where others left them */
  function placeObjects(objects: { k: string; x: number; y: number; f: number }[]): void {
    for (const o of objects) {
      const id = host.idOf(o.k);
      const v = id ? host.getById(id) : undefined;
      if (!v) continue;
      v.x = o.x; v.y = o.y;
      host.world?.setFacing(v.id, o.f);
    }
  }

  function onMessage(raw: string): void {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (typeof m.type === 'number') {
      if (m.type === 1) console.warn('[Glyft] Network:', m.msg);
      return;
    }
    switch (m.type) {
      case 'sync:welcome':
        myId = m.id;
        retry = 2000;
        for (const p of m.players ?? []) addRemote(p.id, p.name, p.s);
        placeObjects(m.objects ?? []);
        emit('connect', null);
        break;
      case 'sync:joined': {
        const r = addRemote(m.id, m.name, null);
        emit('join', view(r));
        break;
      }
      case 'sync:left': {
        const r = remotes.get(m.id);
        if (!r) break;
        hide(r);
        remotes.delete(m.id);
        emit('leave', view(r));
        break;
      }
      case 'sync:snap':
        for (const p of m.players ?? []) {
          const r = remotes.get(p.id) ?? addRemote(p.id, `Player ${p.id}`, null);
          r.samples.push({ t: now(), s: p.s });
          if (r.samples.length > KEEP) r.samples.shift();
        }
        break;
      case 'sync:event': {
        const r = remotes.get(m.id);
        if (!r) break;
        if (m.n === '_attack') { if (r.sprite) host.world?.playAttack(r.sprite.id); }
        else emit(m.n, view(r), m.d);
        break;
      }
    }
  }

  function connect(): void {
    if (closed) return;
    try {
      ws = new WebSocket(config.server);
    } catch (err) {
      console.warn(`[Glyft] network.server '${config.server}' is not a WebSocket URL (use ws:// or wss://)`, err);
      return;
    }
    ws.onopen = () => ws!.send(JSON.stringify({ type: 'syncJoin', room, name: config.name }));
    ws.onmessage = (e) => onMessage(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => {
      const was = myId !== null;
      myId = null;
      lastSent = '';
      for (const r of remotes.values()) hide(r);
      remotes.clear();
      if (was) emit('disconnect', null);
      else if (!warned) {
        warned = true;
        console.warn(`[Glyft] Couldn't reach ${config.server}; playing alone and retrying in the background.`);
      }
      if (!closed) setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }

  // Your swings show on everyone else's screen
  host.world?.onAttack(() => send('_attack'));

  function send(name: string, data?: unknown): void {
    if (ws?.readyState === WebSocket.OPEN && myId !== null) ws.send(JSON.stringify({ type: 'syncEvent', n: name, d: data }));
  }

  // ---- Every frame ----

  function sendState(): void {
    const p = host.findPlayer();
    if (!p || !ws || ws.readyState !== WebSocket.OPEN || myId === null) return;
    const world = host.world;
    const s: State = {
      a: world?.area ?? 'main',
      x: r2(p.x), y: r2(p.y), z: r2(world ? host.heightOf(p.id) : 0),
      f: r2(world?.facingOf(p.id) ?? 0), vx: r2(p.vx), vy: r2(p.vy),
    };
    const ride = world?.rideOf(p.id);
    const key = ride ? host.keyOf(ride.vehicle) : undefined;
    const v = ride ? host.getById(ride.vehicle) : undefined;
    if (ride && key && v) {
      s.r = { k: key, x: r2(v.x), y: r2(v.y), z: r2(host.heightOf(v.id)), f: r2(world!.facingOf(v.id)), m: ride.mounted };
    }
    // Only changes go out, plus a heartbeat so the server knows you're still there
    const json = JSON.stringify(s);
    const t = now();
    if (json === lastSent && t - lastSentAt < 1) return;
    lastSent = json;
    lastSentAt = t;
    ws.send(`{"type":"syncState","s":${json}}`);
  }

  /** Where someone was DELAY seconds ago, blended between the updates either side */
  function sampleAt(r: Remote, t: number): { s: State; vvx: number; vvy: number } | null {
    const list = r.samples;
    if (list.length === 0) return null;
    let i = list.length - 1;
    while (i > 0 && list[i].t > t) i--;
    const a = list[i], b = list[i + 1];
    if (!b || t <= a.t) return { s: a.s, vvx: 0, vvy: 0 };
    const k = Math.min(1, (t - a.t) / Math.max(0.001, b.t - a.t));
    const A = a.s, B = b.s;
    // Area changes and long jumps (doors, respawns) snap rather than slide
    if (A.a !== B.a || Math.hypot(B.x - A.x, B.y - A.y) > 200) return { s: k < 0.5 ? A : B, vvx: 0, vvy: 0 };
    const s: State = {
      a: B.a,
      x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), z: lerp(A.z, B.z, k),
      f: lerpAngle(A.f, B.f, k), vx: B.vx, vy: B.vy,
    };
    let vvx = 0, vvy = 0;
    const ra = A.r, rb = B.r;
    if (rb) {
      if (ra && ra.k === rb.k) {
        s.r = { k: rb.k, m: rb.m, x: lerp(ra.x, rb.x, k), y: lerp(ra.y, rb.y, k), z: lerp(ra.z, rb.z, k), f: lerpAngle(ra.f, rb.f, k) };
        const span = Math.max(0.001, b.t - a.t);
        vvx = (rb.x - ra.x) / span; vvy = (rb.y - ra.y) / span;
      } else {
        s.r = rb;
      }
    }
    return { s, vvx, vvy };
  }

  function showRemote(r: Remote, t: number): void {
    const p = sampleAt(r, t);
    const world = host.world;
    if (!p || (world && p.s.a !== world.area)) { hide(r); return; }
    const s = p.s;

    if (!r.sprite) {
      const me = host.findPlayer();
      const type = me?.type ?? config.player;
      if (!type) return;
      const g = host.spawn(type);
      if (me) {
        g.scale = me.scale; g.visualOffsetY = me.visualOffsetY;
        g.walkFrames = me.walkFrames; g.idleFrames = me.idleFrames; g.tint = me.tint;
      }
      g.tags = [];
      g.physics = false;
      g.label = r.name;
      r.sprite = g;
    }
    const g = r.sprite;
    g.x = s.x; g.y = s.y;
    g.vx = s.r ? 0 : s.vx; g.vy = s.r ? 0 : s.vy;

    // What they ride: the shared vehicle with the same key here
    const vid = s.r ? host.idOf(s.r.k) : undefined;
    const v = vid ? host.getById(vid) : undefined;
    if (r.vehicle && r.vehicle !== v?.id) letGo(r);
    if (s.r && v) {
      r.vehicle = v.id;
      v.x = s.r.x; v.y = s.r.y; v.vx = p.vvx; v.vy = p.vvy;
      world?.setRemote(v.id, s.r.f, s.r.z, null);
    }
    world?.setRemote(g.id, s.f, s.z, s.r && v ? { vehicle: v.id, mounted: s.r.m } : null);
  }

  connect();

  return {
    get connected() { return myId !== null; },
    get id() { return myId; },
    get players() { return [...remotes.values()].map(view); },
    send,
    on(name, cb) {
      let list = listeners.get(name);
      if (!list) { list = []; listeners.set(name, list); }
      list.push(cb);
    },
    update(dt) {
      sendTimer += dt;
      if (sendTimer >= interval) { sendTimer %= interval; sendState(); }
      const t = now() - DELAY;
      for (const r of remotes.values()) showRemote(r, t);
    },
    destroy() {
      closed = true;
      for (const r of remotes.values()) hide(r);
      remotes.clear();
      ws?.close();
    },
  };
}
