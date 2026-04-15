#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;   // uv position

uniform int  uHasHand;
uniform vec2 uTip;
uniform int  uIndexOnly;

out float vBright;
out float vFox;

void main() {
  // 0-1 uv space to -1-1
  vec2 clip = aPos * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  // Brightness increases near fingertip
  float bright = 0.55;
  if (uHasHand == 1) {
    float d = length(aPos - uTip);
    bright += max(0.0, 1.0 - d / 0.14);
  }
  bright = clamp(bright, 0.3, 1.8);

  // Point size: 1.5 baseline, up to ~4.7 near fingertips
  gl_PointSize = 1.5 + min((bright - 0.3) * 0.9, 3.2);

  vBright = bright;
  vFox    = float(uIndexOnly);
}

 