#version 300 es
precision highp float;

// Update particle physics: 
// run by Transform Feedback.
// Input:  aPos (uv 0-1, y=0 top), aVel (uv/frame)
// Output: vPos, vVel (captured into the next pingpong buffer)

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aVel;

uniform float uTime;
uniform int   uHasHand; // 1 = hand detected
uniform vec2  uTip; // fingertip uv position (0-1)
uniform vec2  uFlow; // fingertip velocity in uv/frame
uniform int   uIndexOnly;  // 1 = attract, 0 = repel
uniform int   uHandMoving; // 1 = hand moving fast
uniform int   uVolumeSpike;   // 1 = mic spike

out vec2 vPos;
out vec2 vVel;

void main() {
  vec2 pos = aPos;
  vec2 vel = aVel;

  // 1. Sine-wave drift
  vel += vec2(
    sin(pos.y * 3.1 + uTime * 0.7),
    cos(pos.x * 2.8 + uTime * 0.5)
  ) * 0.00055;

  // 2. slowly float upward
  vel.y -= 0.000065;

  // 3. hand influence
  if (uHasHand == 1) {
  float radius  = uHandMoving == 1 ? 0.22 : 0.14;
  float attract = uIndexOnly == 1 ? -1.0 : 1.0; // negative -> attract

  vec2  diff = pos - uTip;
  float dist = length(diff);
  if (dist < radius && dist > 0.001) {
    float falloff = 1.0 - dist / radius;

    // Gentle radial part — just opens a path, doesn't dominate
    vel += attract * normalize(diff) * (falloff * falloff * 0.004);

    // Current — particles stream in the direction the hand moves
    // uFlow is already in UV/frame (normalised in detection.js), no extra divide needed
    vel += uFlow * 0.5 * falloff;
  }
  } // end uHasHand

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
