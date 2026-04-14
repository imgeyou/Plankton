let particles = [];

//parameters
const maxParticleNum = 1000;


// several layers of particles: simulate different depth
const particleLayers = [
  { count: 800, depthMin: 0.15, depthMax: 0.35, sizeMin: 1, sizeMax: 3,  speed: 0.35, react: 0.3, brightness: 38, sat: 70 },
  { count: 500, depthMin: 0.38, depthMax: 0.62, sizeMin: 2, sizeMax: 6,  speed: 0.65, react: 0.6, brightness: 65, sat: 80 },
  { count: 300, depthMin: 0.65, depthMax: 1.0,  sizeMin: 4, sizeMax: 10, speed: 1.0,  react: 1.0, brightness: 90, sat: 90 },
];
const TARGET_TOTAL = particleLayers.reduce((s, l) => s + l.count, 0);


// ------- Wave field 
// Four interfering sine waves traveling in different directions.
// Returns a value in [-1, 1] at screen position (x, y) at time t.
// Particles use this to modulate their color, brightness, and size.
function sampleWave(x, y, t, W, H) {
  const nx = x / W, ny = y / H;
  // Primary diagonal sweep — dominant shine wave
  const wave = Math.sin((nx + ny * 0.65) * 5.0 - t * 0.9);
  return wave;
}

// Sample velocity from the WebGL fluid solver (shared via window.webglFluidVelocity).
// The solver stores velocity in UV-space (xy). We convert to screen-pixel-space using:
//UV displacement per frame = velocity * dt * d * 2  (from the particle-data shader)
//   where dt=0.25, d=1/256 → scale = dt * d * 2 = 1/512
//   → pixel velocity = solverVelocity * screenWidth / 512
function sampleFluidVelocity(x, y, W, H) {
  //read from webGL: window.webglFluidVelocity
  const field = window.webglFluidVelocity;
  if (!field) return { vx: 0, vy: 0 };

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

    updateHandDetection(p.width, p.height);
    if (handMoving) lastMovementFrame = p.frameCount;

    if (window.starfluid) window.starfluid.inject(normTips);

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

// ----- [draw] glowing lines between nearby particles
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
    this.vx += flow.vx * 0.45 * this.reactivity;
    this.vy += flow.vy * 0.45 * this.reactivity;

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
      let radius = 140;
      if (dist < radius && dist > 0) {
        let strength = o.pow(1 - dist / radius, 2) * 10 * this.reactivity;
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
