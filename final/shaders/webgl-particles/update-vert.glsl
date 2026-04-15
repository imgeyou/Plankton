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

  // 1. sine-wave drift
  vel += vec2(
    sin(pos.y * 3.1 + uTime * 0.25),
    cos(pos.x * 2.8 + uTime * 0.18)
  ) * 0.00022;

  // 2. slowly float upward
  vel.y -= 0.000025;

  // 3. hand influence
  if (uHasHand == 1) {
  float radius  = uHandMoving == 1 ? 0.22 : 0.14;
  float influDirection = uIndexOnly == 1 ? -1.0 : 1.0; // negative -> attract

  //calculate influence of fingerTips on particles, based on dist
  vec2  diff = pos - uTip;
  float dist = length(diff);

  if (dist < radius && dist > 0.001) {
    float falloff = 1.0 - dist / radius;

    //influDirection: positive-> repel; negative-> attract
    vel += influDirection * normalize(diff) * (falloff * falloff * 0.004);

    // introduce flowField influence
    vel += uFlow * 0.5;
  }
  }

  // 4. volume spike: burst outward from the centre
  if (uVolumeSpike == 1) {
    //direction: from screen center to particle
    vec2 dir = pos - vec2(0.5, 0.5);
    if (length(dir) > 0.001) vel += normalize(dir) * 0.009;
  }

  // 5. damping + speed clamp
  vel *= 0.963;
  float spd = length(vel);
  if (spd > 0.02) vel = normalize(vel) * 0.02;

  // 6. integrate & wrap
  pos = fract(pos + vel + 1.0);

  vPos = pos;
  vVel = vel;
}
