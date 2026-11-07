import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

/**
 * How the scan is drawn, as one per-splat GPU modifier (object space):
 *
 * - Sparse: each splat gets a fixed pseudo-random number from its index and is
 *   drawn only if it's under the density, so the share drawn matches the
 *   setting. Kept splats grow to fill gaps. Dropped splats are inactive, so the
 *   headset doesn't sort or draw them, which is what makes big scans fit a Quest.
 * - Hologram: one colour, brighter where the original was brighter, see-through,
 *   small round points, and a scan band sweeping up the object.
 */
export class Look {
  density = dyno.dynoFloat(1);
  holo = dyno.dynoFloat(0);
  tint = dyno.dynoVec3(new THREE.Vector3(0, 0.94, 1));
  time = dyno.dynoFloat(0);
  /** Object-space up direction and height range, for the scan band. */
  up = dyno.dynoVec3(new THREE.Vector3(0, 1, 0));
  hMin = dyno.dynoFloat(0);
  hMax = dyno.dynoFloat(1);

  modifier() {
    return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      const fx = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          density: "float",
          holo: "float",
          tint: "vec3",
          time: "float",
          up: "vec3",
          hMin: "float",
          hMax: "float",
        },
        outTypes: { gsplat: dyno.Gsplat },
        statements: ({ inputs: i, outputs: o }) =>
          dyno.unindentLines(`
            ${o.gsplat} = ${i.gsplat};

            // Sparse: stable per-splat random number (PCG hash of the index).
            uint h = uint(${i.gsplat}.index) * 747796405u + 2891336453u;
            h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
            h = (h >> 22u) ^ h;
            float r = float(h) * (1.0 / 4294967295.0);
            float d = ${i.density};
            if (d < 0.999) {
              if (r > d) {
                ${o.gsplat}.flags = 0u;
                ${o.gsplat}.rgba.a = 0.0;
              } else {
                ${o.gsplat}.scales *= clamp(pow(1.0 / max(d, 1e-4), 0.3333) * 0.7, 1.0, 2.2);
              }
            }

            // Hologram.
            if (${i.holo} > 0.5) {
              float span = max(1e-4, ${i.hMax} - ${i.hMin});
              float y = clamp((dot(${i.gsplat}.center, ${i.up}) - ${i.hMin}) / span, 0.0, 1.0);
              float band = fract(${i.time} * 0.3) * 1.3 - 0.15;
              float scan = smoothstep(0.08, 0.0, abs(y - band));
              float lum = dot(${i.gsplat}.rgba.rgb, vec3(0.299, 0.587, 0.114));
              float bright = min(1.6, 0.3 + 0.8 * lum + scan * 1.2);
              vec3 s = ${o.gsplat}.scales;
              float r0 = min(s.x, min(s.y, s.z));
              float r1 = max(s.x, max(s.y, s.z));
              ${o.gsplat}.scales = vec3(mix(r0, r1, 0.35) * 0.6);
              ${o.gsplat}.rgba = vec4(${i.tint} * bright, min(1.0, ${o.gsplat}.rgba.a * 0.45 * (1.0 + scan)));
            }
          `),
      });
      return {
        gsplat: fx.apply({
          gsplat: gsplat!,
          density: this.density,
          holo: this.holo,
          tint: this.tint,
          time: this.time,
          up: this.up,
          hMin: this.hMin,
          hMax: this.hMax,
        }).gsplat,
      };
    });
  }
}
