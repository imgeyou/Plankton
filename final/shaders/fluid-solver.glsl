// Adapted from: https://github.com/JoTrdl/starfluid/blob/master/src/shaders/fluid.html | Copyright (c) 2015 Johann Troendle


//Navier-Stokes physics - flow field
precision highp float;
varying vec2 vUv;
uniform sampler2D tSampler;
uniform sampler2D motion;
uniform float dt;
uniform vec2 d;
vec2 dx = vec2(d.x, 0);
vec2 dy = vec2(0, d.y);

const float v = 0.05;
const float K = 0.15;
const float CentralScale = 1.0/2.0;

vec2 Directions[4];

//check if it hits the boundary
bool IsBoundary(vec2 uv) {
  return (uv.x <= d.x || uv.x > (1.0 - d.x) || uv.y <= d.y || uv.y > (1.0 - d.y));
}

//Read the old cell and its 4 neighbors
vec3 bilerp(sampler2D t, vec2 oldvUv) {
  vec3 x  = texture2D(t, oldvUv).xyz;
  vec3 x0 = texture2D(t, oldvUv - dx).xyz;
  vec3 x1 = texture2D(t, oldvUv + dx).xyz;
  vec3 y0 = texture2D(t, oldvUv - dy).xyz;
  vec3 y1 = texture2D(t, oldvUv + dy).xyz;
  //return average oldvUv
  return (1.0 * x + x0 + x1 + y0 + y1) * 0.2;
}

void main() {
  Directions[0] = vec2(1,0);
  Directions[1] = vec2(0,-1);
  Directions[2] = vec2(-1,0);
  Directions[3] = vec2(0,1);


//Read the current cell and its 4 neighbors
  vec4 FC = texture2D(tSampler, vUv);
  vec3 FR = texture2D(tSampler, vUv + dx).xyz;//right
  vec3 FL = texture2D(tSampler, vUv - dx).xyz;//left
  vec3 FT = texture2D(tSampler, vUv + dy).xyz;//top
  vec3 FD = texture2D(tSampler, vUv - dy).xyz;//down

//Laplacian Operator measures how much the velocity at this cell differs from its neighbors.
  vec2 LaplacianOperator = FR.xy + FL.xy + FT.xy + FD.xy - 4.0 * FC.xy;

//Calculate spatial gradients
  vec3 UdX = (FR - FL) * CentralScale;
  vec3 UdY = (FT - FD) * CentralScale;


  vec2 Viscosity = v * LaplacianOperator;

//Calculate pressure from density gradient
  vec2 DdX = vec2(UdX.z, UdY.z);// gradient of density
  vec2 PdX = (K/dt) * DdX;// pressure force

//Update density
  vec3 Temp = vec3(DdX, UdX.x + UdY.y);

// Keep density in a stable range so it doesn't blow up.
  FC.z = clamp(FC.z - dt * dot(FC.xyz, Temp), 0.3, 1.7);
  
  vec2 Was = vUv - dt * FC.xy * d;
  FC.xy = bilerp(tSampler, Was).xy;
  FC.xy += dt * (Viscosity - PdX + texture2D(motion, vUv).xy);

  for (int i=0; i<4; i++) {
    if (IsBoundary(vUv + (d * Directions[i]))) {
      FC.xy *= 1.0 - abs(Directions[i]);
    }
  }
  gl_FragColor = FC;//output FC(vx, vy, density)
}
