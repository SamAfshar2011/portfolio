import { Scene, PerspectiveCamera } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import type { View } from './View';

/**
 * Base class for 3D scenes that live inside a DOM element. The element is
 * the layout box; the scene is drawn into the shared canvas with a scissor
 * rectangle that follows the element as the page scrolls. Rendering stops
 * automatically while the element is off-screen.
 */
export abstract class DomView implements View {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.1, 100);
  protected visible = false;
  protected rect = { x: 0, y: 0, w: 1, h: 1 };
  /** The drawn (clamped) part of the element, in CSS px — the camera's view offset. */
  private slice = { x: 0, y: 0, w: 1, h: 1 };
  private io: IntersectionObserver;
  private last = performance.now();

  constructor(readonly el: HTMLElement) {
    this.io = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        this.onVisibility(this.visible);
      },
      { rootMargin: '10% 0px' },
    );
    this.io.observe(el);
  }

  protected onVisibility(_visible: boolean) {}
  protected abstract update(dt: number): void;

  render(renderer: WebGPURenderer) {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (!this.visible) return;
    const r = this.el.getBoundingClientRect();
    const canvas = renderer.domElement;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H) return;
    this.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    this.update(dt);

    // Only the part of the element inside the canvas is drawn. WebGPU rejects
    // viewports and scissors that reach past the render target (WebKit
    // enforces it), so the rectangle is clamped in device pixels and the
    // camera renders the matching slice of its full view (a view offset),
    // keeping the projection identical to the unclipped element.
    const dpr = renderer.getPixelRatio();
    const bw = Math.floor(W * dpr);
    const bh = Math.floor(H * dpr);
    const x0 = Math.ceil(Math.max(0, r.left) * dpr);
    const y0 = Math.ceil(Math.max(0, r.top) * dpr);
    const x1 = Math.floor(Math.min(bw, r.right * dpr));
    const y1 = Math.floor(Math.min(bh, r.bottom * dpr));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const vx = x0 / dpr;
    const vy = y0 / dpr;
    const vw = (x1 - x0) / dpr;
    const vh = (y1 - y0) / dpr;
    this.camera.aspect = r.width / r.height;
    this.camera.setViewOffset(r.width, r.height, vx - r.left, vy - r.top, vw, vh);
    this.slice = { x: vx, y: vy, w: vw, h: vh };

    const prevColor = renderer.autoClearColor;
    renderer.autoClearColor = false;
    renderer.setViewport(vx, vy, vw, vh);
    renderer.setScissor(vx, vy, vw, vh);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.autoClearColor = prevColor;
  }

  /**
   * Converts a client-space point into normalised device coords for this
   * view's camera (which may be rendering only the visible slice).
   */
  toNdc(clientX: number, clientY: number) {
    const v = this.slice;
    return { x: ((clientX - v.x) / v.w) * 2 - 1, y: -(((clientY - v.y) / v.h) * 2 - 1) };
  }

  dispose() {
    this.io.disconnect();
  }
}
