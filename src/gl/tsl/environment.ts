import { Color, Vector2 } from 'three/webgpu';
import { Fn, uniform, vec2, float, length, exp, mix, smoothstep, dot, pow, max } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * The environment is a studio sweep lit by one soft key light. It is a pure
 * function of screen position so the glass slabs can evaluate the exact same
 * light when they refract the backdrop — DOM, background and objects all share
 * one lighting model.
 */
export class EnvironmentUniforms {
  key = uniform(new Color('#28292c'));
  rim = uniform(new Color('#0f1b20'));
  top = uniform(new Color('#101113'));
  bottom = uniform(new Color('#060606'));
  lumen = uniform(new Color('#fff0dd'));
  /** Key light centre in screen UV (0,0 = top left). */
  light = uniform(new Vector2(0.62, 0.32));
  aspect = uniform(1);
  intensity = uniform(1);
  /** 0 = normal, 1 = porcelain daylight room. */
  daylight = uniform(0);
}

const DAY_TOP = new Color('#f4f1ec');
const DAY_BOTTOM = new Color('#dcd6cd');

export function createEnvironment(u: EnvironmentUniforms) {
  const dayTop = uniform(DAY_TOP);
  const dayBottom = uniform(DAY_BOTTOM);

  return (uv: Node<'vec2'>) =>
    Fn(() => {
    const p = uv.sub(u.light).mul(vec2(u.aspect, 1.0));
    const dk = length(p.mul(vec2(0.58, 1.0)));

    // Tight pool + broad halo: reads as a softbox rather than a gradient.
    const pool = exp(dk.mul(dk).mul(-3.8));
    const halo = exp(dk.mul(-2.1)).mul(0.32);
    const sweep = smoothstep(1.1, 0.0, uv.y);

    const night = mix(u.bottom, u.top, sweep).toVar();
    night.addAssign(u.key.mul(pool.mul(1.05).add(halo)).mul(u.intensity));
    night.addAssign(u.lumen.mul(pow(pool, float(4.0))).mul(0.045).mul(u.intensity));

    // Cool rim bouncing up from the lower left.
    const pr = uv.sub(vec2(-0.12, 1.12)).mul(vec2(u.aspect, 1.0));
    night.addAssign(u.rim.mul(exp(length(pr).mul(-1.5))).mul(0.8));

    // Daylight room: porcelain sweep with the same key pool, much gentler.
    const day = mix(dayBottom, dayTop, sweep).add(u.lumen.mul(pool).mul(0.06));

    const col = mix(night, day, u.daylight).toVar();

    // Optical vignette.
    const q = uv.sub(0.5).mul(vec2(u.aspect.mul(0.72), 1.0));
    col.mulAssign(max(float(0), float(1).sub(dot(q, q).mul(mix(float(0.62), float(0.25), u.daylight)))));
    return col;
    })();
}
