#version 300 es
precision highp float;

// Particle physics update shader — run via Transform Feedback.
// Input:  aPos (UV 0-1, y=0 top), aVel (UV units/frame)
// Output: vPos, vVel  (captured into the next ping-pong buffer)

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aVel;

uniform float uTime;
uniform vec2  uResolution;    // canvas size in pixels (for normalising flow vectors)
uniform int   uNumTips;
uniform vec2  uTips[10];      // fingertip UV positions (0-1, y=0 top, x-mirrored)
uniform vec2  uFlows[10];     // fingertip velocity in screen pixels/frame
uniform int   uFoxGesture;    // 1 = attract mode,  0 = repel mode
uniform int   uHandMoving;    // 1 = hand moving fast (enlarges influence radius)
uniform int   uVolumeSpike;   // 1 = mic spike (brief radial burst)

out vec2 vPos;
out vec2 vVel;

// ── Value noise helpers ──────────────────────────────────────────────────────
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i),              hash21(i + vec2(1, 0)), f.x),
    mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x),
    f.y
  );
}

// ── Curl noise ───────────────────────────────────────────────────────────────
// Computes ∇×f = (∂f/∂y, −∂f/∂x) of a scalar noise field.
// Divergence-free: no sinks or sources → particles stay spread evenly.
vec2 curlNoise(vec2 p, float t) {
  const float E = 0.0015;
  float n_py = vnoise((p + vec2(0.0,  E)) * 2.8 + t);
  float n_my = vnoise((p - vec2(0.0,  E)) * 2.8 + t);
  float n_px = vnoise((p + vec2(E,  0.0)) * 2.8 + t);
  float n_mx = vnoise((p - vec2(E,  0.0)) * 2.8 + t);
  return vec2(
     (n_py - n_my) / (2.0 * E),   //  ∂f/∂y
    -(n_px - n_mx) / (2.0 * E)    // −∂f/∂x
  );
}

void main() {
  vec2 pos = aPos;
  vec2 vel = aVel;

  // 1. Curl-noise drift — divergence-free, keeps particles spread evenly
  float t = uTime * 0.08;
  vel += curlNoise(pos, t) * 0.00055;

  // 2. Gentle upward float
  vel.y -= 0.000065;

  // 3. Hand influence
  float radius  = uHandMoving == 1 ? 0.22 : 0.14;
  float foxSign = uFoxGesture == 1 ? -1.0 : 1.0; // negative = attract

  for (int i = 0; i < uNumTips; i++) {
    vec2  diff = pos - uTips[i];
    float dist = length(diff);

    if (dist < radius && dist > 0.001) {
      float t2       = 1.0 - dist / radius;
      float strength = t2 * t2 * 0.013;

      // Radial push / pull
      vel += foxSign * normalize(diff) * strength;

      // Swirl: inject hand velocity (pixel → UV space)
      vel += (uFlows[i] / uResolution) * 0.014 * t2;
    }
  }

  // 4. Volume spike: radial burst outward from screen centre
  if (uVolumeSpike == 1) {
    vec2 dir = pos - vec2(0.5, 0.5);
    if (length(dir) > 0.001) vel += normalize(dir) * 0.009;
  }

  // 5. Damping + speed clamp
  vel *= 0.963;
  float spd = length(vel);
  if (spd > 0.02) vel = normalize(vel) * 0.02;

  // 6. Integrate & wrap (torus topology)
  pos = fract(pos + vel + 1.0);

  vPos = pos;
  vVel = vel;
}
