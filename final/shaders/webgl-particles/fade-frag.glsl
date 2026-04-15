#version 300 es
// WebGL2 for gpu-canvas.js

//fading effect: 
// Paired with blendFunc(ZERO, ONE_MINUS_SRC_ALPHA):
// result = destination * (1 - srcAlpha) = destination * pFade


precision mediump float;
uniform float pFade;
out vec4 fragColor;

void main() {
  //particles slowly fade away -> leave trail
  fragColor = vec4(0.0, 0.0, 0.0, 1.0 - pFade);
}