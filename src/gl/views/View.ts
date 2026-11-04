import type { WebGPURenderer } from 'three/webgpu';

/**
 * A View is a small 3D scene anchored to a DOM element. It is drawn into the
 * shared canvas with a scissor rectangle that tracks the element, so pages can
 * embed interactive 3D without creating extra WebGL/WebGPU contexts.
 */
export interface View {
  render(renderer: WebGPURenderer): void;
  dispose(): void;
}
