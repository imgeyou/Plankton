let particles = [];

let normTips = [];
let fingertips = [];
let prevFingertips = [];

let flowVectors = [];
let handMoving = false;

//parameters
const maxParticleNum = 1000;
const V_sensitivity = 20; //detect handmoving speed; px/frame
const M_sensitivity = 10; //detect handmoving; px


// several layers of particles: simulate different depth
const particleLayers = [
  { count: 800, depthMin: 0.15, depthMax: 0.35, sizeMin: 1, sizeMax: 3,  speed: 0.35, react: 0.3, brightness: 38, sat: 70 },
  { count: 500, depthMin: 0.38, depthMax: 0.62, sizeMin: 2, sizeMax: 6,  speed: 0.65, react: 0.6, brightness: 65, sat: 80 },
  { count: 300, depthMin: 0.65, depthMax: 1.0,  sizeMin: 4, sizeMax: 10, speed: 1.0,  react: 1.0, brightness: 90, sat: 90 },
];
const TARGET_TOTAL = particleLayers.reduce((s, l) => s + l.count, 0);

// ── CPU Navier-Stokes fluid solver ───────────────────────────────────────────
// Physics from GPU-Fluid-Experiments-master (Stam 1999):
//   semi-Lagrangian advection + Helmholtz-Hodge projection (divergence-free)
const FLUID_W    = 64;    // grid resolution (independent of screen size)
const FLUID_H    = 64;
const FLUID_ITER = 20;    // Jacobi pressure iterations — more = tighter vortices
const FLUID_DAMP = 0.985; // velocity damping per frame

class FluidSolver {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.vx = new Float32Array(n); // velocity x  (grid cells / frame)
    this.vy = new Float32Array(n); // velocity y
    this.vx0 = new Float32Array(n); // advection scratch buffers
    this.vy0 = new Float32Array(n);
    this.p = new Float32Array(n); // pressure field
    this.div = new Float32Array(n); // divergence scratch
  }

  ix(x, y) {
    return y * this.w + x;
  }

  // Inject a Gaussian velocity impulse at grid position (gx, gy).
  // dvx/dvy in grid cells/frame; radius in grid cells.
  addVelocity(gx, gy, dvx, dvy, radius) {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(gx - radius * 2.5));
    const x1 = Math.min(this.w - 1, Math.ceil(gx + radius * 2.5));
    const y0 = Math.max(0, Math.floor(gy - radius * 2.5));
    const y1 = Math.min(this.h - 1, Math.ceil(gy + radius * 2.5));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const dx = i - gx,
          dy = j - gy;
        const f = Math.exp(-(dx * dx + dy * dy) / r2);
        const k = this.ix(i, j);
        this.vx[k] += dvx * f;
        this.vy[k] += dvy * f;
      }
    }
  }

  // Semi-Lagrangian self-advection: trace each cell back along velocity, resample.
  _advect() {
    const { w, h, vx, vy, vx0, vy0 } = this;
    vx0.set(vx);
    vy0.set(vy);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.ix(i, j);
        const bx = Math.max(0.5, Math.min(w - 1.5, i - vx0[k]));
        const by = Math.max(0.5, Math.min(h - 1.5, j - vy0[k]));
        const x0 = Math.floor(bx),
          y0 = Math.floor(by);
        const x1 = Math.min(w - 1, x0 + 1),
          y1 = Math.min(h - 1, y0 + 1);
        const tx = bx - x0,
          ty = by - y0;
        vx[k] =
          vx0[this.ix(x0, y0)] * (1 - tx) * (1 - ty) +
          vx0[this.ix(x1, y0)] * tx * (1 - ty) +
          vx0[this.ix(x0, y1)] * (1 - tx) * ty +
          vx0[this.ix(x1, y1)] * tx * ty;
        vy[k] =
          vy0[this.ix(x0, y0)] * (1 - tx) * (1 - ty) +
          vy0[this.ix(x1, y0)] * tx * (1 - ty) +
          vy0[this.ix(x0, y1)] * (1 - tx) * ty +
          vy0[this.ix(x1, y1)] * tx * ty;
      }
    }
  }

  // Helmholtz-Hodge projection: subtract pressure gradient → divergence-free field.
  // This is what creates realistic vortices that persist after the hand moves.
  _project() {
    const { w, h, vx, vy, p, div } = this;
    // 1. Compute velocity divergence
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        div[this.ix(i, j)] =
          -0.5 *
          (vx[this.ix(i + 1, j)] -
            vx[this.ix(i - 1, j)] +
            vy[this.ix(i, j + 1)] -
            vy[this.ix(i, j - 1)]);
        p[this.ix(i, j)] = 0;
      }
    }
    // 2. Jacobi pressure solve:  ∇²p = ∇·u
    for (let iter = 0; iter < FLUID_ITER; iter++) {
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = this.ix(i, j);
          p[k] =
            (div[k] +
              p[this.ix(i - 1, j)] +
              p[this.ix(i + 1, j)] +
              p[this.ix(i, j - 1)] +
              p[this.ix(i, j + 1)]) *
            0.25;
        }
      }
    }
    // 3. Subtract pressure gradient:  u = u − ∇p
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = this.ix(i, j);
        vx[k] -= 0.5 * (p[this.ix(i + 1, j)] - p[this.ix(i - 1, j)]);
        vy[k] -= 0.5 * (p[this.ix(i, j + 1)] - p[this.ix(i, j - 1)]);
      }
    }
    // 4. No-slip boundary: zero velocity on walls
    for (let i = 0; i < w; i++) {
      vx[this.ix(i, 0)] = vy[this.ix(i, 0)] = 0;
      vx[this.ix(i, h - 1)] = vy[this.ix(i, h - 1)] = 0;
    }
    for (let j = 0; j < h; j++) {
      vx[this.ix(0, j)] = vy[this.ix(0, j)] = 0;
      vx[this.ix(w - 1, j)] = vy[this.ix(w - 1, j)] = 0;
    }
  }

  // One simulation step: advect → project → damp
  step() {
    this._advect();
    this._project();
    for (let k = 0; k < this.vx.length; k++) {
      this.vx[k] *= FLUID_DAMP;
      this.vy[k] *= FLUID_DAMP;
    }
  }

  // Sample velocity at screen pixel (x, y). Returns screen-space px/frame.
  sample(x, y, W, H) {
    const gx = (x / W) * this.w;
    const gy = (y / H) * this.h;
    const x0 = Math.max(0, Math.min(this.w - 1, Math.floor(gx)));
    const x1 = Math.min(this.w - 1, x0 + 1);
    const y0 = Math.max(0, Math.min(this.h - 1, Math.floor(gy)));
    const y1 = Math.min(this.h - 1, y0 + 1);
    const tx = gx - Math.floor(gx),
      ty = gy - Math.floor(gy);
    const svx =
      this.vx[this.ix(x0, y0)] * (1 - tx) * (1 - ty) +
      this.vx[this.ix(x1, y0)] * tx * (1 - ty) +
      this.vx[this.ix(x0, y1)] * (1 - tx) * ty +
      this.vx[this.ix(x1, y1)] * tx * ty;
    const svy =
      this.vy[this.ix(x0, y0)] * (1 - tx) * (1 - ty) +
      this.vy[this.ix(x1, y0)] * tx * (1 - ty) +
      this.vy[this.ix(x0, y1)] * (1 - tx) * ty +
      this.vy[this.ix(x1, y1)] * tx * ty;
    // grid cells/frame → screen px/frame
    return { vx: (svx * W) / this.w, vy: (svy * H) / this.h };
  }
}

const fluid = new FluidSolver(FLUID_W, FLUID_H);

// ── Wave field ────────────────────────────────────────────────────────────────
// Four interfering sine waves traveling in different directions.
// Returns a value in [-1, 1] at screen position (x, y) at time t.
// Particles use this to modulate their color, brightness, and size.
function sampleWave(x, y, t, W, H) {
  const nx = x / W, ny = y / H;
  // Primary diagonal sweep — dominant shine wave
  const w1 = Math.sin((nx + ny * 0.65) * 5.0 - t * 0.9);
  // Secondary wave for subtle variation
  const w2 = Math.sin((nx * 0.4 + ny) * 3.5 - t * 0.45 + 1.8);
  return w1 * 0.72 + w2 * 0.28;                                        // -1 … 1
}

// Sample velocity from the real WebGL fluid solver (shared via window.webglFluidVelocity).
// Falls back to the CPU flow field if the GPU readback is unavailable.
// The solver stores velocity in UV-space (xy). We convert to screen-pixel-space using:
//   UV displacement per frame = velocity * dt * d * 2  (from the particle-data shader)
//   where dt=0.25, d=1/256 → scale = dt * d * 2 = 1/512
//   → pixel velocity = solverVelocity * screenWidth / 512
function sampleFluidVelocity(x, y, W, H) {
  const field = window.webglFluidVelocity;
  if (!field) return fluid.sample(x, y, W, H);

  // Map screen coords → UV. WebGL y=0 is at bottom, screen y=0 is at top.
  const u = x / W;
  const v = 1.0 - y / H;

  const fw = field.w, fh = field.h;
  const gx = u * (fw - 1);
  const gy = v * (fh - 1);

  const x0 = Math.max(0, Math.min(fw - 1, Math.floor(gx)));
  const x1 = Math.min(fw - 1, x0 + 1);
  const y0 = Math.max(0, Math.min(fh - 1, Math.floor(gy)));
  const y1 = Math.min(fh - 1, y0 + 1);
  const tx = gx - Math.floor(gx);
  const ty = gy - Math.floor(gy);

  const d = field.data;
  const i00 = (y0 * fw + x0) * 4, i10 = (y0 * fw + x1) * 4;
  const i01 = (y1 * fw + x0) * 4, i11 = (y1 * fw + x1) * 4;

  const vx = d[i00]*(1-tx)*(1-ty) + d[i10]*tx*(1-ty) + d[i01]*(1-tx)*ty + d[i11]*tx*ty;
  const vy = d[i00+1]*(1-tx)*(1-ty) + d[i10+1]*tx*(1-ty) + d[i01+1]*(1-tx)*ty + d[i11+1]*tx*ty;

  // Convert UV-space velocity → screen pixel velocity, flip y back to screen space
  return { vx: vx * W / 512, vy: -vy * H / 512 };
}

// --- Audio: microphone volume spike detection ---
let _analyser = null, _micData = null, _avgVolume = 0;
let _audioCtx = null;

async function _startAudio() {
  if (_analyser) return; // already running
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    _audioCtx = new AudioCtx();
    await _audioCtx.resume(); // force out of suspended state
    const src = _audioCtx.createMediaStreamSource(stream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    src.connect(_analyser);
    _micData = new Uint8Array(_analyser.frequencyBinCount);
  } catch (e) {
    console.warn('Mic unavailable — sound trigger disabled:', e);
  }
}

// Start on first user interaction so AudioContext is allowed by the browser
['click', 'touchstart', 'keydown'].forEach(evt =>
  window.addEventListener(evt, _startAudio, { once: true })
);
_startAudio(); // also try immediately (works if page already has a gesture)

function getRMS() {
  if (!_analyser) return 0;
  _analyser.getByteTimeDomainData(_micData);
  let sum = 0;
  for (let i = 0; i < _micData.length; i++) {
    let v = (_micData[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / _micData.length);
}

// Debug: toggle mic overlay from browser console with: _dbg.showVol = true
window._dbg = { showVol: false };

// Spike latch: keeps volumeSpike true for several frames after detection
let _spikeLatch = 0;
const SPIKE_LATCH_FRAMES = 8;

// Fox latch: keeps foxGesture true for several frames after detection
let _foxLatch = 0;
const FOX_LATCH_FRAMES = 20;

// --- Blast state ---
let blastActive   = false;  // particles are currently flying out
let postBlastMode = false;  // waiting for stillness before resurfacing
let postBlastFrame     = -99999;
let lastMovementFrame  = -99999;

const BLAST_RESURFACE_WAIT = 300; // ~5s at 60fps before resurfacing starts
const MOVEMENT_COOLDOWN    = 180; // ~3s of hand stillness required



// ------------
// p5.js effect
// -------------

let effect = function (p) {
  p.setup = function () {
    let canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.id("effect-view");
    p.colorMode(p.HSB, 360, 100, 100, 100);

    //create particles
    for (let li = 0; li < particleLayers.length; li++) {
      for (let i = 0; i < particleLayers[li].count; i++) {
        particles.push(new Particle(p, undefined, li));
      }
    }
  };

  p.windowResized = function () {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = function () {
    // Trail effect: fade previous frame instead of clearing
    p.noStroke();
    p.fill(0, 0, 3, 22);
    p.rect(0, 0, p.width, p.height);

    _updateFingertips(p);

    _updateFlowField(flowVectors, p.width, p.height);
    if (window.starfluid) window.starfluid.inject(normTips);

    // --- Fox gesture: index + middle up, ring + pinky down ---
    let foxGesture = false;
    if (detections != undefined && detections.multiHandLandmarks != undefined) {
      for (let hand of detections.multiHandLandmarks) {
        let indexUp = hand[8].y < hand[5].y; // index tip above index MCP
        let middleDown = hand[12].y > hand[9].y; // middle tip below middle MCP
        let ringDown = hand[16].y > hand[13].y; // ring tip below ring MCP
        let pinkyUp = hand[20].y < hand[17].y; // pinky tip above pinky MCP
        if (indexUp && middleDown && ringDown && pinkyUp)
          _foxLatch = FOX_LATCH_FRAMES;
      }
    }
    if (_foxLatch > 0) {
      foxGesture = true;
      _foxLatch--;
    }

    // --- Volume spike detection ---
    let vol = getRMS();
    _avgVolume = _avgVolume * 0.97 + vol * 0.03;
    if (vol > Math.max(_avgVolume * 2.5, 0.025))
      _spikeLatch = SPIKE_LATCH_FRAMES;
    else if (_spikeLatch > 0) _spikeLatch--;
    let volumeSpike = _spikeLatch > 0;

    // --- Trigger blast (fox gesture + sudden sound) ---
    if (foxGesture && volumeSpike && !blastActive && !postBlastMode) {
      console.log("BLAST TRIGGERED — fox=true spike=true");
      blastActive = true;

      // Wind direction: use hand movement if fast enough, otherwise random side
      let windAngle;
      const avgVx = flowVectors.reduce((s, v) => s + v.vx, 0) / (flowVectors.length || 1);
      const avgVy = flowVectors.reduce((s, v) => s + v.vy, 0) / (flowVectors.length || 1);
      const handSpeed = Math.sqrt(avgVx * avgVx + avgVy * avgVy);
      if (handSpeed > 2) {
        windAngle = Math.atan2(avgVy, avgVx);
      } else {
        // Random left or right gust with slight downward drift
        windAngle = p.random() > 0.5 ? p.random(-0.3, 0.3) : p.random(Math.PI - 0.3, Math.PI + 0.3);
      }

      for (let pt of particles) {
        const speed  = pt.o.random(22, 42) * (0.4 + pt.depth);
        const spread = pt.o.random(-0.35, 0.35); // narrow cone around wind direction
        const angle  = windAngle + spread;
        pt.vx = Math.cos(angle) * speed;
        pt.vy = Math.sin(angle) * speed + pt.o.random(0, 2); // slight gravity droop
        pt.blasted = true;
      }
    }

    // Remove dead blasted particles; detect when all are gone
    if (blastActive) {
      particles = particles.filter((pt) => !pt.dead);
      if (particles.length === 0) {
        blastActive = false;
        postBlastMode = true;
        postBlastFrame = p.frameCount;
      }
    }

    // --- Index-only gesture: eject new particles from fingertip ---
    if (!blastActive && !postBlastMode) {
      if (
        detections != undefined &&
        detections.multiHandLandmarks != undefined
      ) {
        for (let hand of detections.multiHandLandmarks) {
          let indexUp = hand[8].y < hand[5].y; // index tip above index MCP
          let middleDown = hand[12].y > hand[9].y; // middle tip below middle MCP
          let ringDown = hand[16].y > hand[13].y; // ring tip below ring MCP
          let pinkyDown = hand[20].y > hand[17].y; // pinky tip below pinky MCP
          if (indexUp && middleDown && ringDown && pinkyDown) {
            // Use actual index finger tip (landmark 8), x-mirrored to match canvas
            const tip = { x: (1 - hand[8].x) * p.width, y: hand[8].y * p.height };
            if (p.frameCount % 2 === 0) {
              if (particles.length >= maxParticleNum) particles.shift();
              let angle = p.random(p.TWO_PI);
              let speed = p.random(1.5, 4);
              let wobble = p.random(-1, 1);
              particles.push(
                new Particle(
                  p,
                  {
                    x: tip.x + p.random(-8, 8),
                    y: tip.y + p.random(-8, 8),
                    vx: Math.cos(angle) * speed + Math.sin(angle) * wobble,
                    vy: Math.sin(angle) * speed - Math.cos(angle) * wobble - 0.5,
                    fromTip: true,
                  },
                  Math.floor(p.random(3)),
                ),
              );
            }
          }
        }
      }
    }

    // --- Trickle refill ---
    // Normal mode: always trickle (fills blank areas left by hand sweeps)
    // Post-blast:  only trickle after wait period AND hand has been still
    const TRICKLE = 1;
    let canTrickle;
    if (blastActive) {
      canTrickle = false;
    } else if (postBlastMode) {
      let sinceBlast = p.frameCount - postBlastFrame;
      let sinceMove = p.frameCount - lastMovementFrame;
      canTrickle =
        sinceBlast > BLAST_RESURFACE_WAIT && sinceMove > MOVEMENT_COOLDOWN;
      // Exit post-blast mode once particle pool is reasonably full again
      if (canTrickle && particles.length >= maxParticleNum - 50)
        postBlastMode = false;
    } else {
      canTrickle = true;
    }

    if (canTrickle) {
      for (let li = 0; li < particleLayers.length; li++) {
        for (let i = 0; i < TRICKLE; i++) {
          if (particles.length >= maxParticleNum) particles.shift();
          particles.push(new Particle(p, null, li));
        }
      }
    }

    // Mic volume debug overlay (toggle: _dbg.showVol = true)
    if (window._dbg.showVol) {
      let vol = getRMS();
      let spike = vol > Math.max(_avgVolume * 3.5, 0.04);
      p.noStroke();
      p.fill(0, 0, 0, 55);
      p.rect(8, p.height - 48, 300, 40, 6);
      p.textSize(12);
      p.fill(0, 0, spike ? 100 : 80, 100);
      p.text(
        `vol: ${vol.toFixed(4)}  avg: ${_avgVolume.toFixed(4)}  SPIKE: ${spike}`,
        16,
        p.height - 26,
      );
      // bar
      p.fill(spike ? 30 : 160, 80, 90, 80);
      p.rect(16, p.height - 16, vol * 1200, 6, 3);
      p.fill(0, 0, 50, 60);
      p.rect(16 + _avgVolume * 3.5 * 1200, p.height - 18, 2, 10, 1); // spike threshold line
    }

    // Draw far → near so near particles appear on top
    const waveT = p.frameCount * 0.016; // wave animation time
    for (let particle of particles) {
      particle.update(p.width, p.height);
      particle.applyRepulsion(flowVectors);
    }
    _drawConnections(p, particles);
    for (let particle of particles) {
      particle.draw(waveT, p.width, p.height);
    }
  };
};


// --------------------------------------
// Helper functions
// -------------------------------------

// ----- A. [update] fingertip pos, x-y velocity
function _updateFingertips(p) {
  //1. reset fingertip pos
  normTips = [];
  fingertips = [];
  //2. get fingertips position: only thumb, middle, ring, pinky
  if (detections?.multiHandLandmarks) {
    for (let hand of detections.multiHandLandmarks) {
      for (let index of [4, 12, 16, 20]) {
        let lm = hand[index];
        //2a. pos on mediapipe 0-1 cooridnate
        normTips.push({ x: lm.x, y: lm.y });
        //2b. real pos on canvas, selfie-mirrored
        fingertips.push({ x: (1 - lm.x) * p.width, y: lm.y * p.height });
      }
    }
  }
  //3. calculate flowvector
  flowVectors = fingertips.map((tip, i) => {
    let p = prevFingertips[i];
    return p
      ? { x: tip.x, y: tip.y, vx: tip.x - p.x, vy: tip.y - p.y }
      : { x: tip.x, y: tip.y, vx: 0, vy: 0 };
  });

  //4. update previous fingertip []
  prevFingertips = fingertips.slice();

  //5. detect handmoving - sensitivity check
  handMoving = flowVectors.some(
    (v) => Math.sqrt(v.vx * v.vx + v.vy * v.vy) > M_sensitivity,
  );
  if (handMoving) lastMovementFrame = p.frameCount;
}

// ----- B. [draw] glowing lines between nearby particles
// 4 opacity tiers, each batched into a single ctx.stroke() call.
const _connGrid = new Map();
const _segs = [
  new Float32Array(24000), // tier 0 — farthest, barely visible
  new Float32Array(24000), // tier 1
  new Float32Array(24000), // tier 2
  new Float32Array(24000), // tier 3 — closest, most visible
];
const _segN = [0, 0, 0, 0];
// opacity and lineWidth per tier — subtle falloff so lines support particles, not compete
const TIER_ALPHA = ['0.025', '0.05', '0.08', '0.13'];
const TIER_WIDTH = [0.4,      0.5,    0.7,    0.9  ];

function _drawConnections(p, particles) {
  const MAX_DIST  = 80;
  const MAX_DIST2 = MAX_DIST * MAX_DIST;
  const CS = MAX_DIST;

  // Build spatial grid
  _connGrid.clear();
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    if (a.dead || a.alpha < 15) continue;
    const cx = Math.floor(a.x / CS) + 2;
    const cy = Math.floor(a.y / CS) + 2;
    const key = cy * 600 + cx;
    let cell = _connGrid.get(key);
    if (!cell) { cell = []; _connGrid.set(key, cell); }
    cell.push(i);
  }

  _segN[0] = _segN[1] = _segN[2] = _segN[3] = 0;
  const NDX = [0,  1, -1, 0,  1];
  const NDY = [0,  0,  1, 1,  1];

  for (const [key, cell] of _connGrid) {
    const cy = Math.floor(key / 600);
    const cx = key - cy * 600;

    for (let ni = 0; ni < 5; ni++) {
      const nkey = (cy + NDY[ni]) * 600 + (cx + NDX[ni]);
      const nbr  = ni === 0 ? cell : _connGrid.get(nkey);
      if (!nbr) continue;

      for (let ii = 0; ii < cell.length; ii++) {
        const a = particles[cell[ii]];
        const jStart = ni === 0 ? ii + 1 : 0;
        for (let jj = jStart; jj < nbr.length; jj++) {
          const b = particles[nbr[jj]];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > MAX_DIST2) continue;

          const t    = 1 - Math.sqrt(d2) / MAX_DIST; // 0=far, 1=close
          const tier = Math.min(3, Math.floor(t * 4)); // 0–3
          const buf  = _segs[tier];
          let   n    = _segN[tier];
          if (n + 4 <= buf.length) {
            buf[n] = a.x; buf[n+1] = a.y;
            buf[n+2] = b.x; buf[n+3] = b.y;
            _segN[tier] = n + 4;
          }
        }
      }
    }
  }

  const ctx = p.drawingContext;
  ctx.save();
  for (let tier = 0; tier < 4; tier++) {
    const n = _segN[tier];
    if (n === 0) continue;
    ctx.lineWidth   = TIER_WIDTH[tier];
    ctx.strokeStyle = `rgba(140, 220, 225, ${TIER_ALPHA[tier]})`;
    ctx.beginPath();
    const buf = _segs[tier];
    for (let i = 0; i < n; i += 4) {
      ctx.moveTo(buf[i], buf[i+1]);
      ctx.lineTo(buf[i+2], buf[i+3]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ----- utils: step the Navier-Stokes solver and inject hand velocity as impulses
function _updateFlowField(flowVectors, W, H) {
  // Advance the simulation: advect velocity, project to divergence-free, damp
  fluid.step();

  // Inject each fingertip's motion as a Gaussian velocity impulse
  for (let v of flowVectors) {
    const speed = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    if (speed < V_sensitivity) continue;

    // Convert screen position and velocity → grid space
    const gx  = (v.x  / W) * FLUID_W;
    const gy  = (v.y  / H) * FLUID_H;
    const dvx = (v.vx / W) * FLUID_W;
    const dvy = (v.vy / H) * FLUID_H;

    // Injection radius in grid cells (grows slightly with speed)
    const radius = 3 + speed * 0.03;
    fluid.addVelocity(gx, gy, dvx, dvy, radius);
  }
}

class Particle {
  constructor(o, opts, layer) {
    this.o = o;
    this.layer = layer ?? 1;
    const L = particleLayers[this.layer];
    this.noiseOffset = o.random(1000);
    this.depth = o.random(L.depthMin, L.depthMax);
    this.size = o.random(L.sizeMin, L.sizeMax) * this.depth;
    this.reactivity = o.random(0.3, 0.8) * L.react;
    this.speedScale = L.speed;
    this.brightness = L.brightness;
    this.sat = L.sat;
    this.hueBase = o.random(165, 195);
    this.vx = 0;
    this.vy = 0;
    this.blasted = false;
    this.dead = false;
    this.fromTip = false;

    if (opts && opts !== null) {
      // ejected from index finger — golden burst
      this.x = opts.x;
      this.y = opts.y;
      this.vx = opts.vx || 0;
      this.vy = opts.vy || 0;
      this.fromTip = opts.fromTip || false;
      this.hueRange = this.hueBase;
      this.alpha = 80;
      this.fromDeep = false;
    } else if (opts === null) {
      // refill from the deep — appear anywhere, fade in
      this.hueRange = this.hueBase;
      this.x = o.random(o.width);
      this.y = o.random(o.height);
      this.vy = o.random(-0.5, -0.1) * this.speedScale;
      this.alpha = 0;
      this.fromDeep = true;
    } else {
      // initial population — already visible
      this.hueRange = this.hueBase;
      this.x = o.random(o.width);
      this.y = o.random(o.height);
      this.vy = o.random(-0.3, 0.1);
      this.alpha = 100;
      this.fromDeep = false;
    }
  }

  update(W, H) {
    let o = this.o;

    // Blasted: radial flight, fast fade, no wrapping — die when faded
    if (this.blasted) {
      this.alpha -= 6;
      if (this.alpha <= 0) {
        this.dead = true;
        return;
      }
      this.vx *= 0.92;
      this.vy *= 0.92;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }

    let t = o.frameCount * 0.005;

    let fadeRate = this.fromDeep ? 3.5 : 4;
    if (this.alpha < 100) this.alpha = Math.min(100, this.alpha + fadeRate);

    // slowly assimilate to cool hue
    this.hueRange = o.lerp(this.hueRange, this.hueBase, 0.005);

    // noise drift target
    let angle =
      o.noise(this.x * 0.003, this.y * 0.003, t + this.noiseOffset) *
      o.TWO_PI *
      2;
    let driftSpeed = 1.8 * this.depth * this.speedScale;
    let targetVx = o.cos(angle) * driftSpeed;
    let targetVy = o.sin(angle) * driftSpeed - 0.18 * this.speedScale;

    this.vx += (targetVx - this.vx) * 0.08;
    this.vy += (targetVy - this.vy) * 0.08;

    // flow field — driven by the real WebGL fluid velocity when available
    let flow = sampleFluidVelocity(this.x, this.y, W, H);
    this.vx += flow.vx * 0.18 * this.reactivity;
    this.vy += flow.vy * 0.18 * this.reactivity;

    this.vx *= 0.96;
    this.vy *= 0.96;

    this.x += this.vx;
    this.y += this.vy;

    // wrap edges
    let pad = 80;
    if (this.x < -pad) this.x = W + pad;
    if (this.x > W + pad) this.x = -pad;
    if (this.y < -pad) this.y = H + pad;
    if (this.y > H + pad) this.y = -pad;
  }

  applyRepulsion(flowVectors) {
    if (this.blasted) return;
    let o = this.o;
    for (let f of flowVectors) {
      let speed = o.sqrt(f.vx * f.vx + f.vy * f.vy);
      if (speed < 1.5) continue;
      let dx = this.x - f.x;
      let dy = this.y - f.y;
      let dist = o.sqrt(dx * dx + dy * dy);
      let radius = 100;
      if (dist < radius && dist > 0) {
        let strength = o.pow(1 - dist / radius, 2) * 5 * this.reactivity;
        this.vx += (dx / dist) * strength;
        this.vy += (dy / dist) * strength;
      }
    }
  }

  draw(waveT, W, H) {
    if (this.dead) return;
    const o = this.o;

    // ── Wave influence ────────────────────────────────────────────────────────
    const wave     = sampleWave(this.x, this.y, waveT, W, H); // -1 … 1
    const waveNorm = (wave + 1) * 0.5;                         //  0 … 1

    // Size: pulse swells at wave crests
    const basePulse = this.size + o.sin(o.frameCount * 0.02 + this.noiseOffset) * 1.2;
    const pulse = basePulse * (0.4 + waveNorm * 1.0);

    // Color: golden for fingertip-spawned, teal/white for ambient
    const hue = this.fromTip ? 38 + wave * 14 : 185 + wave * 12;
    const sat = this.fromTip
      ? Math.max(0, 75 - waveNorm * 40)    // rich gold, whites at crest
      : Math.max(0, 38 - waveNorm * 38);   // teal → white
    const bri = Math.min(100, 35 + waveNorm * 65);
    const a   = this.alpha / 100;

    o.noStroke();

    // Layer 1 — soft outer glow
    o.fill(hue, sat * 0.45, bri, (3 + this.depth * 5) * a);
    o.circle(this.x, this.y, pulse * 4.5);

    // Layer 2 — inner glow + core
    o.fill(hue, sat * 0.8, bri, (12 + this.depth * 18) * a);
    o.circle(this.x, this.y, pulse * 1.8);

    // Layer 3 — white-hot centre at wave crests
    if (waveNorm > 0.5) {
      const coreFrac = (waveNorm - 0.5) / 0.5;
      o.fill(hue, sat * 0.1, 100, coreFrac * 88 * a);
      o.circle(this.x, this.y, pulse * 0.4);
    }
  }
}

let effectWindow = new p5(effect);
