let particles = [];

// ----- state variables
let boomActive = false; // particles are currently flying out
let postBoomMode = false; // waiting for stillness before resurfacing
let postBoomFrame = -99999;
let lastMovementFrame = -99999;

//---- parameters
const maxParticleNum = 1600;
const normalParticleNum = 900;
const particleSpeed = 0.3;

let disruptRadius = 140;

const resurfaceWaiting_Time = 300; // ~5s at 60fps before resurfacing starts
const noMovementTime = 180; // ~3s of hand stillness required
const trickleSpeed = 0.8;

const P_INIT     = 0; // startup population — placed randomly, already visible
const P_REFILL   = 1; // trickle back in after clearing — fade in from zero alpha
const P_POPULATE = 2; // ejected from fingertip — golden burst

// several layers of particles: simulate different depth
// size, speed, reactivity all scale from depth directly in the constructor
const particleLayers = [
  { count: 800, depthMin: 0.15, depthMax: 0.35 },
  { count: 500, depthMin: 0.38, depthMax: 0.62 },
  { count: 300, depthMin: 0.65, depthMax: 1.0  },
];
const TARGET_TOTAL = particleLayers.reduce((s, l) => s + l.count, 0);


// ------- p5.js effect
let effect = function (p) {
  p.setup = function () {
    let canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.id("effect-view");
    p.colorMode(p.HSB, 360, 100, 100, 100);

    //create particles
    for (let li = 0; li < particleLayers.length; li++) {
      for (let i = 0; i < particleLayers[li].count; i++) {
        particles.push(new Particle(p, P_INIT, null, li));
      }
    }
  };

  p.windowResized = function () {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = function () {
    p.noStroke();
    p.fill(0, 0, 3, 22); // fade -> Trail effect
    p.rect(0, 0, p.width, p.height);

    if (handMoving) lastMovementFrame = p.frameCount;

    // --- 1. Index-only gesture
      // eject new particles from fingertip
      if (!boomActive && !postBoomMode) {
        if (indexOnly) {
          // index as emitter. pos is x-mirrored to match canvas
          const tip = { x: (1 - hand[8].x) * p.width, y: hand[8].y * p.height };

          if (p.frameCount % 2 === 0) {
            if (particles.length >= maxParticleNum) particles.shift();
            let angle = p.random(p.TWO_PI);
            let speed = p.random(1.5, 4);
            let wobble = p.random(-1, 1);
            particles.push(
              new Particle(
                p,
                P_POPULATE,
                {
                  x: tip.x + p.random(-8, 8),
                  y: tip.y + p.random(-8, 8),
                  vx: Math.cos(angle) * speed + Math.sin(angle) * wobble,
                  vy: Math.sin(angle) * speed - Math.cos(angle) * wobble - 0.5,
                },
                Math.floor(p.random(10)),
              ),
            );
          }
        }
      }

    // ----- 2. Boom Effect
      // triggered by fox gesture + sudden increase in volume
      if (foxGesture && volumeSpike && !boomActive && !postBoomMode) {
        // console.log("boom - fox=true spike=true");
        boomActive = true;
        // blown away
        for (let pt of particles) {
          const angle = -p.HALF_PI + p.random(-0.4, 0.4); // mostly upward, small spread
          const speed = p.random(22, 42) * (0.4 + pt.depth);
          pt.vx = Math.cos(angle) * speed;
          pt.vy = Math.sin(angle) * speed;
          pt.boomed = true;
        }
      }
      // Remove dead boomed particles; detect when all are gone
      if (boomActive) {
        particles = particles.filter((pt) => !pt.dead);
        if (particles.length === 0) {
          boomActive = false;
          postBoomMode = true;
          postBoomFrame = p.frameCount;
        }
      }

    // ---- 3. Particle resurface, filling blank areas left by hand sweeps)
      // Post-boom:  only trickle after wait period AND hand has been still
      const trickleSpeed = 1;
      let canTrickle;
      if (boomActive) {
        canTrickle = false;
      } else if (postBoomMode) {
        let sinceBoom = p.frameCount - postBoomFrame;
        let sinceMove = p.frameCount - lastMovementFrame;
        canTrickle = sinceBoom > resurfaceWaiting_Time && sinceMove > noMovementTime;
        // Exit post-boom mode once particle pool is back to normal again
        if (canTrickle && particles.length >= normalParticleNum)
          postBoomMode = false;
      } else {
        canTrickle = true;
      }
      //add particles back to the scene
      if (canTrickle) {
        for (let li = 0; li < particleLayers.length; li++) {
          for (let i = 0; i < trickleSpeed; i++) {
            if (particles.length >= maxParticleNum) particles.shift();
            particles.push(new Particle(p, P_REFILL, null, li));
          }
        }
      }

    // Draw far -> near so near particles appear on top
    const waveTime = p.frameCount * 0.016; // wave animation time
    for (let pt of particles) {
      pt.update(p.width, p.height);
      pt._applyRepulsion(flowVectors);
    }
    particles = particles.filter((pt) => !pt.dead);
    _drawConnections(p, particles);
    for (let pt of particles) {
      pt.draw(waveTime, p.width, p.height);
    }
  };;
};

// ------ Helper functions
// ------- Wave velocityField
// Four interfering sine waves traveling in different directions.
// Returns a value in [-1, 1] at screen position (x, y) at time t.
// Particles use this to modulate their color, brightness, and size.
function sampleWave(x, y, t, W, H) {
  const nx = x / W,
    ny = y / H;
  // Primary diagonal sweep — dominant shine wave
  const wave = Math.sin((nx + ny * 0.65) * 5.0 - t * 0.9);
  return wave;
}

// Sample velocity from the WebGL fluid solver (shared via window.webglFluidVelocity)
function sampleFluidVelocity(x, y, W, H) {
  //read velocity texture from webGL: window.webglFluidVelocity
  const velocityField = window.webglFluidVelocity;

  if (!velocityField) return { vx: 0, vy: 0 };

  // Map screen coords to GPU texture uv
  const u = x / W; //0-1
  const v = 1.0 - y / H; //1 (top) -0 (bottom)

  //Map uv to Grid cell position
  const Grid_X = u * (velocityField.w - 1); //grid index: 0-> readSize
  const Grid_Y = v * (velocityField.h - 1); //grid index: 0-> readSize

  //locate 4 surround cells
  const x0 = Math.max(0, Math.min(velocityField.w - 1, Math.floor(Grid_X))); //left
  const x1 = Math.min(velocityField.w - 1, x0 + 1); //right

  const y0 = Math.max(0, Math.min(velocityField.h - 1, Math.floor(Grid_Y))); //bottom
  const y1 = Math.min(velocityField.h - 1, y0 + 1); //top

  //the point pos, relative to left-bottom cell pos
  const tx = Grid_X - Math.floor(Grid_X);
  const ty = Grid_Y - Math.floor(Grid_Y);

  //get indexes for 4 surrounding cells
  const i00 = (y0 * velocityField.w + x0) * 4;
  const i10 = (y0 * velocityField.w + x1) * 4;
  const i01 = (y1 * velocityField.w + x0) * 4;
  const i11 = (y1 * velocityField.w + x1) * 4;

  const vd = velocityField.data;

  //influences of all 4 cells on this point: opposite of distance
  const vx =
    ((vd[i00] * (1 - tx) * (1 - ty) +
      vd[i10] * tx * (1 - ty) +
      vd[i01] * (1 - tx) * ty +
      vd[i11] * tx * ty) *
      W) /
    256; // cell/dt -> px/dt
  const vy =
    ((vd[i00 + 1] * (1 - tx) * (1 - ty) +
      vd[i10 + 1] * tx * (1 - ty) +
      vd[i01 + 1] * (1 - tx) * ty +
      vd[i11 + 1] * tx * ty) *
      H) /
    256; // cell/dt -> px/dt

  // return screen pixel velocity, flip y back to screen space
  return { vx: vx * particleSpeed, vy: -vy * particleSpeed };
}

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
const TIER_ALPHA = ["0.025", "0.05", "0.08", "0.13"];
const TIER_WIDTH = [0.4, 0.5, 0.7, 0.9];


function _drawConnections(p, particles) {
  const MAX_DIST = 80;
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
    if (!cell) {
      cell = [];
      _connGrid.set(key, cell);
    }
    cell.push(i);
  }

  _segN[0] = _segN[1] = _segN[2] = _segN[3] = 0;
  const NDX = [0, 1, -1, 0, 1];
  const NDY = [0, 0, 1, 1, 1];

  for (const [key, cell] of _connGrid) {
    const cy = Math.floor(key / 600);
    const cx = key - cy * 600;

    for (let ni = 0; ni < 5; ni++) {
      const nkey = (cy + NDY[ni]) * 600 + (cx + NDX[ni]);
      const nbr = ni === 0 ? cell : _connGrid.get(nkey);
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

          const t = 1 - Math.sqrt(d2) / MAX_DIST; // 0=far, 1=close
          const tier = Math.min(3, Math.floor(t * 4)); // 0–3
          const buf = _segs[tier];
          let n = _segN[tier];
          if (n + 4 <= buf.length) {
            buf[n] = a.x;
            buf[n + 1] = a.y;
            buf[n + 2] = b.x;
            buf[n + 3] = b.y;
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
    ctx.lineWidth = TIER_WIDTH[tier];
    ctx.strokeStyle = `rgba(140, 220, 225, ${TIER_ALPHA[tier]})`;
    ctx.beginPath();
    const buf = _segs[tier];
    for (let i = 0; i < n; i += 4) {
      ctx.moveTo(buf[i], buf[i + 1]);
      ctx.lineTo(buf[i + 2], buf[i + 3]);
    }
    ctx.stroke();
  }
  ctx.restore();
}

class Particle {
  constructor(o, type, opts, layer) {
    this.o = o;
    this.type = type;
    const L = particleLayers[layer ?? 1];
    this.noiseOffset = o.random(1000);

    this.depth = o.random(L.depthMin, L.depthMax);
    this.size = o.random(2, 10) * this.depth;
    this.reactivity = o.random(0.3, 0.8) * this.depth;
    this.speedScale = this.depth;

    //grey
    this.hueBase = o.random(165, 195);

    this.vx = 0; // P_REFILL and P_INIT only set vy, so vx stays 0
    this.vy = 0;

    this.alpha = o.map(this.depth, 0.15, 1.0, 20, 100);
    this.boomed = false;
    this.dead = false;
    this.populate = false;

    switch (type) {
      case P_POPULATE:
        // ejected from fingertip: golden particles
        this.x = opts.x;
        this.y = opts.y;
        this.vx = opts.vx;
        this.vy = opts.vy;
        this.alpha = 80;
        this.populate = true;
        break;
      case P_REFILL:
        // trickle back in: fade in from zero
        this.x = o.random(o.width);
        this.y = o.random(o.height);
        this.vy = o.random(-0.5, -0.1) * this.speedScale;
        this.alpha = 0;
        break;
      case P_INIT: 
        // initialization: already visible
        this.x = o.random(o.width);
        this.y = o.random(o.height);
        this.vy = o.random(-0.3, 0.1);
        break;
    }
  }

  update(W, H) {
    let o = this.o;

    // 1. boom: slow fade, speedup — die when faded
    if (this.boomed) {
      this.alpha -= 3;
      if (this.alpha <= 0) {
        this.dead = true;
        return;
      }
      this.vx *= 1.2;
      this.vy *= 1.2;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }

    //Refill particles fade in slightly slower than Populate ones
    let fadeRate;
    if (this.type === P_REFILL) fadeRate = 3;
    else fadeRate = 4;
    if (this.alpha < 100) this.alpha = Math.min(100, this.alpha + fadeRate);

    // perlin noise for a richer drifting behavious
    let t = o.frameCount * 0.005;
    let angle = o.noise(this.x * 0.003, this.y * 0.003, t + this.noiseOffset) * o.TWO_PI * 2;

    let driftSpeed = 1.8 * this.depth * this.speedScale;
    let targetVx = o.cos(angle) * driftSpeed;
    let targetVy = o.sin(angle) * driftSpeed - 0.18 * this.speedScale;

    this.vx += (targetVx - this.vx) * 0.08;
    this.vy += (targetVy - this.vy) * 0.08;

    // flow velocityField — driven by the WebGL flowfield
    let flow = sampleFluidVelocity(this.x, this.y, W, H);
    this.vx += flow.vx * 0.45 * this.reactivity;
    this.vy += flow.vy * 0.45 * this.reactivity;

    this.vx *= 0.96;
    this.vy *= 0.96;

    this.x += this.vx;
    this.y += this.vy;

    // die when drifted off-screen — trickle will refill
    const pad = 120;
    if (this.x < -pad || this.x > W + pad || this.y < -pad || this.y > H + pad)
      this.dead = true;
  }

  _applyRepulsion(flowVectors) {
    if (this.boomed || this.populate || !handMoving) return;
    let o = this.o;
    for (let v of flowVectors) {
      let speed = o.sqrt(v.vx * v.vx + v.vy * v.vy);
      let dx = this.x - v.x;
      let dy = this.y - v.y;
      let dist = o.sqrt(dx * dx + dy * dy);
      
      if (dist < disruptRadius && dist > 0) {
        let strength = o.pow(1 - dist / disruptRadius, 2) * 10 * this.reactivity;
        this.vx += (dx / dist) * strength;
        this.vy += (dy / dist) * strength;
      }
    }
  }

  draw(waveTime, W, H) {
    if (this.dead) return;
    const o = this.o;

    // ------ Wave influence 
    const wave = sampleWave(this.x, this.y, waveTime, W, H); // -1 - 1
    const waveNorm = (wave + 1) * 0.5; //  0 - 1

    // Size: pulse swells at wave crests
    const basePulse =
      this.size + o.sin(o.frameCount * 0.02 + this.noiseOffset) * 1.2;
    const pulse = basePulse * (0.4 + waveNorm * 1.0);

    // Color: golden for fingertip-spawned, teal/white for ambient
    const hue = this.type === P_POPULATE ? 38 + wave * 14 : 185 + wave * 12;
    const sat = this.type === P_POPULATE
      ? Math.max(0, 75 - waveNorm * 40) // rich gold, whites at crest
      : Math.max(0, 38 - waveNorm * 38); // teal → white
    const bri = Math.min(100, 35 + waveNorm * 65);
    const a = this.alpha / 100;

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
