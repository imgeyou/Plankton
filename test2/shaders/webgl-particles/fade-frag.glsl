#version 300 es
precision mediump float;

// uFade: fraction of brightness to retain each frame (e.g. 0.89).
// Paired with blendFunc(ZERO, ONE_MINUS_SRC_ALPHA):
//   result = dst * (1 - srcAlpha) = dst * uFade
uniform float uFade;

out vec4 fragColor;

void main() {
  fragColor = vec4(0.0, 0.0, 0.0, 1.0 - uFade);
}
