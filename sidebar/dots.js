'use strict';

// The animated dot matrix behind the phones: one canvas under the whole row,
// redrawn at a low frame rate. Dots are grouped into a few
// size/opacity levels and each level is drawn as a single path, and frames
// where no dot changes level are skipped, so the cost stays well under 1ms.

const MirrorlyDots = (() => {
  const LOOK = {
    spacing: 11,
    sizeMin: 0.5, sizeMax: 1.3,
    alphaMin: 0.38, alphaMax: 0.47,
    speed: 0.49,
    scale: 0.65, // pattern size
    gamma: 1.8,  // contrast
    levels: 4,
    edge: 0.65,  // fades the dots towards the stage's edges
    clear: 0.33, // and behind the phone
    angle: 115,  // of the colour gradient
    fps: 10,
  };
  // The store slides' indigo, violet and orchid
  const COLOURS = {
    dark: ['#6e8cf6', '#a97bf0', '#e277c3'],
    light: ['#5b63f0', '#8a52c4', '#b65fd8'],
  };
  const TAU = Math.PI * 2;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let field = null;
  let time = 0;
  let last = 0;
  let raf = 0;

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  class Field {
    // `holes` gives the phones' boxes, in px from the area's top left: the
    // dots thin out behind them.
    constructor(area, holes) {
      this.area = area;
      this.holes = holes;
      this.holeRects = [];
      this.count = 0;
      // Fixed under the area, so it stays put while the row scrolls sideways.
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'dots';
      this.canvas.setAttribute('aria-hidden', 'true');
      area.before(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      new ResizeObserver(() => this.build()).observe(area);
      area.addEventListener('scroll', () => this.refresh(), { passive: true });
    }

    // After the phones move.
    refresh() {
      const rects = this.holes();
      const key = rects.map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join()).join('|');
      if (key === this.holeKey) return;
      this.holeKey = key;
      this.holeRects = rects;
      this.weigh();
    }

    build() {
      const r = this.area.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      Object.assign(this.canvas.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${w}px`, height: `${h}px` });
      this.w = w;
      this.h = h;
      // 1x on purpose: soft dots, and a quarter of the pixels on a HiDPI screen.
      this.canvas.width = w;
      this.canvas.height = h;
      const sp = LOOK.spacing;
      const cx = w / 2;
      const cy = h / 2;
      // Centred, so the dots sit evenly around the phone at any width.
      const x0 = cx - Math.floor(cx / sp) * sp;
      const y0 = cy - Math.floor(cy / sp) * sp;
      const nx = Math.max(0, Math.floor((w - x0) / sp) + 1);
      const ny = Math.max(0, Math.floor((h - y0) / sp) + 1);
      const n = nx * ny;
      this.count = n;
      this.xs = new Float32Array(n);
      this.ys = new Float32Array(n);
      this.us = new Float32Array(n);
      this.vs = new Float32Array(n);
      this.wt = new Float32Array(n);
      this.level = new Uint8Array(n);
      this.prev = new Uint8Array(n);
      this.order = new Uint32Array(n);
      let i = 0;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++, i++) {
          this.xs[i] = x0 + x * sp;
          this.ys[i] = y0 + y * sp;
          this.us[i] = (this.xs[i] - cx) / (140 * LOOK.scale);
          this.vs[i] = (this.ys[i] - cy) / (140 * LOOK.scale);
        }
      }
      this.paint();
      this.holeKey = null;
      this.refresh();
    }

    paint() {
      const { ctx, w, h } = this;
      const colours = COLOURS[dark.matches ? 'dark' : 'light'];
      const a = LOOK.angle * Math.PI / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const half = (Math.abs(w * c) + Math.abs(h * s)) / 2;
      const g = ctx.createLinearGradient(w / 2 - c * half, h / 2 - s * half, w / 2 + c * half, h / 2 + s * half);
      colours.forEach((colour, k) => g.addColorStop(k / (colours.length - 1), colour));
      ctx.fillStyle = g;
      this.dirty = true;
    }

    // How much of each dot shows: less near the edges and behind the phone.
    weigh() {
      if (!this.count) return;
      const { w, h, holeRects } = this;
      const sp = LOOK.spacing;
      for (let i = 0; i < this.count; i++) {
        const x = this.xs[i];
        const y = this.ys[i];
        let weight = 1 - LOOK.edge * smooth(0.45, 1.35, Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)));
        for (const p of holeRects) {
          const e = Math.hypot((x - p.x - p.width / 2) / (p.width / 2 + sp), (y - p.y - p.height / 2) / (p.height / 2 + sp));
          weight *= 1 - LOOK.clear * (1 - smooth(0.85, 1.5, e));
        }
        this.wt[i] = weight;
      }
      this.dirty = true;
      this.draw();
    }

    draw() {
      if (!this.count) return;
      const { ctx, xs, ys, us, vs, wt, order } = this;
      const L = LOOK.levels;
      const t = time;
      let changed = this.dirty;
      // Diagonal swells, gently bent so they never quite repeat.
      for (let i = 0; i < this.count; i++) {
        const u = us[i];
        const v = vs[i];
        const val = 0.5 + 0.5 * Math.sin(u * 1.4 + v * 0.9 - t * 1.2 + 0.8 * Math.sin(v * 0.8 + t * 0.5));
        let l = (val ** LOOK.gamma * wt[i] * L) | 0;
        if (l >= L) l = L - 1;
        this.level[i] = l;
        if (l !== this.prev[i]) changed = true;
      }
      if (!changed) return;

      // Sorted by level, then one path and one fill per level.
      const level = this.level;
      const ends = new Int32Array(L + 1);
      for (let i = 0; i < this.count; i++) ends[level[i] + 1]++;
      for (let l = 1; l <= L; l++) ends[l] += ends[l - 1];
      for (let i = 0; i < this.count; i++) order[ends[level[i]]++] = i;

      ctx.clearRect(0, 0, this.w, this.h);
      let start = 0;
      for (let l = 0; l < L; l++) {
        const end = ends[l];
        const k = L > 1 ? l / (L - 1) : 1;
        const r = LOOK.sizeMin + (LOOK.sizeMax - LOOK.sizeMin) * k;
        ctx.globalAlpha = LOOK.alphaMin + (LOOK.alphaMax - LOOK.alphaMin) * k;
        ctx.beginPath();
        for (let j = start; j < end; j++) {
          const i = order[j];
          ctx.moveTo(xs[i] + r, ys[i]);
          ctx.arc(xs[i], ys[i], r, 0, TAU);
        }
        ctx.fill();
        start = end;
      }
      this.level = this.prev;
      this.prev = level;
      this.dirty = false;
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / LOOK.fps - 2) return;
    time += Math.min(now - last, 100) / 1000 * LOOK.speed;
    last = now;
    field.draw();
  }

  // Still (one frame) while the sidebar is hidden or motion is reduced.
  function run() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (document.hidden || reduced.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', run);
  reduced.addEventListener('change', run);
  dark.addEventListener('change', () => {
    if (!field) return;
    field.paint();
    field.draw();
  });

  return {
    attach(area, holes) {
      field = new Field(area, holes);
      run();
      return field;
    },
  };
})();
