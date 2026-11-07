"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../landing/fur-material.js");

const {
  DuckFurSurface,
  encodeSignedDistance,
  pressProfile,
  stableRandom,
  motionGuardProtection,
  overscanLayout,
  silhouetteRootIncluded,
  REST_TOLERANCE,
  ROOT_STRIDE,
  STATE_STRIDE,
} = window.DuckFur.__testing;

test("signed-distance texture encoding preserves outside, boundary, and inside order", () => {
  const encoded = encodeSignedDistance(new Float32Array([-12, -1, 0, 1, 12]));
  assert.deepEqual([...encoded], [0, 117, 128, 138, 255]);
});

test("stratified fiber randomness is stable across rebuilds", () => {
  const first = Array.from({ length: 12 }, (_, index) => stableRandom(index, 4));
  const second = Array.from({ length: 12 }, (_, index) => stableRandom(index, 4));
  assert.deepEqual(first, second);
  assert.ok(new Set(first).size > 10);
});

test("motion guard keeps tiny movement sharp and releases smoothly for strong deformation", () => {
  assert.equal(motionGuardProtection(0.08), 1);
  const ordinaryMotion = motionGuardProtection(0.24);
  const strongerMotion = motionGuardProtection(0.42);
  assert.ok(ordinaryMotion < 1 && ordinaryMotion > strongerMotion);
  assert.ok(strongerMotion > 0.04);
  assert.ok(Math.abs(motionGuardProtection(0.7) - 0.04) < 1e-9);
});

test("silhouette overscan keeps the semantic surface centered inside a larger canvas", () => {
  const layout = overscanLayout(208, 44, 10, 2);
  assert.deepEqual(layout, {
    canvasWidth: 456,
    canvasHeight: 128,
    surfaceWidth: 416,
    surfaceHeight: 88,
    offset: 20,
  });
  assert.equal(layout.offset + layout.surfaceWidth / 2, layout.canvasWidth / 2);
  assert.equal(layout.offset + layout.surfaceHeight / 2, layout.canvasHeight / 2);
});

test("silhouette fringe keeps roots in a narrow aligned boundary", () => {
  assert.equal(silhouetteRootIncluded(-0.45, 0.55), true);
  assert.equal(silhouetteRootIncluded(0.55, 0.55), true);
  assert.equal(silhouetteRootIncluded(0.551, 0.55), false);
});

test("approved label tuning is saved as the material default", () => {
  assert.equal(window.DuckFur.defaults.labelLengthScale, 0.8);
  assert.equal(window.DuckFur.defaults.labelWidthScale, 0.9);
});

test("unmount safely ignores controls without a mounted surface", () => {
  assert.equal(window.DuckFur.unmount({}), false);
});

function makeSurface(points, overrides = {}) {
  const surface = Object.create(DuckFurSurface.prototype);
  surface.options = {
    stiffness: 62,
    damping: 22,
    radius: 28,
    pressRadius: null,
    brushStrength: 5.8,
    compression: 0.92,
    recoveryDelay: 280,
    pressDepth: 0.78,
    splay: 0.76,
    transitionWidth: 0.36,
    ...overrides,
  };
  surface.width = 100;
  surface.height = 100;
  surface.count = points.length;
  surface.roots = new Float32Array(points.flatMap(([x, y]) => [x / 100, y / 100]));
  surface.rootSeeds = new Float32Array(surface.count * ROOT_STRIDE);
  points.forEach((_, index) => {
    const offset = index * ROOT_STRIDE;
    surface.rootSeeds[offset] = surface.roots[index * 2];
    surface.rootSeeds[offset + 1] = surface.roots[index * 2 + 1];
    surface.rootSeeds[offset + 2] = 1;
    surface.rootSeeds[offset + 3] = index * 0.7;
    surface.rootSeeds[offset + 4] = index / Math.max(1, points.length - 1);
    surface.rootSeeds[offset + 5] = 1 - index / Math.max(1, points.length - 1);
  });
  surface.state = new Float32Array(surface.count * STATE_STRIDE);
  surface.velocity = new Float32Array(surface.count * STATE_STRIDE);
  surface.pressTargets = new Float32Array(surface.count * STATE_STRIDE);
  surface.recoveryHold = new Float32Array(surface.count);
  surface.activePress = new Uint8Array(surface.count);
  surface.pointer = { x: 50, y: 50 };
  surface.pressed = false;
  surface.recoveringFibers = 0;
  surface.draw = () => {};
  return surface;
}

function advanceUntilSettled(surface, seconds = 8) {
  const step = 1 / 120;
  for (let elapsed = 0; elapsed < seconds && surface.simulate(step) > 0; elapsed += step) {
    // Simulation intentionally advances in small, deterministic increments.
  }
}

function assertAtRest(surface) {
  for (let index = 0; index < surface.state.length; index += 1) {
    assert.ok(Math.abs(surface.state[index]) <= REST_TOLERANCE.state, `state ${index} did not settle: ${surface.state[index]}`);
    assert.ok(Math.abs(surface.velocity[index]) <= REST_TOLERANCE.velocity, `velocity ${index} did not settle: ${surface.velocity[index]}`);
    assert.ok(Math.abs(surface.pressTargets[index]) <= REST_TOLERANCE.target, `target ${index} did not settle: ${surface.pressTargets[index]}`);
  }
}

test("three-zone press keeps the center compressed and reserves splay for the transition", () => {
  const options = { pressDepth: 0.8, compression: 0.9, splay: 0.75, transitionWidth: 0.36 };
  const center = pressProfile(0.05, options);
  const transition = pressProfile(0.42, options);
  const outer = pressProfile(0.98, options);

  assert.ok(center.depression > 0.7);
  assert.ok(center.compression > 0.8);
  assert.ok(center.splay < 0.05);
  assert.ok(transition.splay > center.splay + 0.25);
  assert.ok(outer.depression < 0.01);
  assert.ok(outer.splay < 0.01);
});

test("press radius can exceed hover radius without widening ordinary brushing", () => {
  const surface = makeSurface([[50, 50], [70, 50], [90, 50]], { radius: 12, pressRadius: 36 });

  surface.brush(45, 50, 55, 50, 16);
  assert.equal(surface.recoveryHold[1], 0, "hover should not reach a fiber outside the normal radius");

  surface.pointer = { x: 50, y: 50 };
  surface.pressed = true;
  surface.imprintPress();
  assert.equal(surface.activePress[0], 1);
  assert.equal(surface.activePress[1], 1, "click should reach a fiber inside the larger press radius");
  assert.equal(surface.activePress[2], 0, "click should not reach beyond the press radius");
});

test("press radius falls back to the normal radius when it is not configured", () => {
  const surface = makeSurface([[50, 50], [70, 50]], { radius: 12, pressRadius: null });
  surface.pressed = true;
  surface.imprintPress();
  assert.equal(surface.activePress[0], 1);
  assert.equal(surface.activePress[1], 0);
});

test("brushing uses independent per-fiber recovery holds", () => {
  const surface = makeSurface([[20, 50], [80, 50]], { radius: 16, recoveryDelay: 400 });
  surface.brush(10, 50, 30, 50, 16);
  assert.ok(surface.recoveryHold[0] > 0);
  assert.equal(surface.recoveryHold[1], 0);

  surface.simulate(0.2);
  const firstHold = surface.recoveryHold[0];
  surface.brush(70, 50, 90, 50, 16);
  assert.equal(surface.recoveryHold[0], firstHold);
  assert.ok(surface.recoveryHold[1] > surface.recoveryHold[0]);
});

test("an interrupted press releases every active fiber and fully recovers", () => {
  const surface = makeSurface([[50, 50], [58, 50], [68, 50], [90, 50]], { radius: 32 });
  surface.pressed = true;
  surface.imprintPress();
  assert.ok(surface.activePress.some((value) => value === 1));
  assert.ok(surface.state[3] > 0.4, "center fiber should be visibly depressed");

  surface.pressed = false;
  surface.releaseActivePressFibers();
  advanceUntilSettled(surface);

  assert.equal(surface.activePress.some((value) => value === 1), false);
  assertAtRest(surface);
});

test("rapid repeated brush and press gestures cannot leave residual deformation", () => {
  const surface = makeSurface([[35, 50], [45, 50], [50, 50], [55, 50], [65, 50]], { radius: 30, recoveryDelay: 120 });
  for (let gesture = 0; gesture < 10; gesture += 1) {
    surface.pressed = gesture % 2 === 0;
    surface.pointer = { x: 42 + gesture, y: 50 };
    if (surface.pressed) surface.imprintPress(0.9);
    surface.brush(25, 48 + gesture % 3, 75, 52 - gesture % 3, 12);
    surface.simulate(1 / 120);
    surface.pressed = false;
    surface.releaseActivePressFibers();
  }

  advanceUntilSettled(surface, 10);
  assertAtRest(surface);
  assert.equal(surface.recoveringFibers, 0);
});

test("wavefront reaches near fibers before distant fibers and fully recovers", () => {
  const surface=makeSurface([[10,50],[60,50],[95,50]],{waveSpeed:100,waveWidth:5,waveBend:.6,waveCompression:.2});
  surface.waves=[{x:0,y:50,radius:0,reach:100}];
  surface.advanceWaves(.1);
  assert.ok(surface.state[0]>.1);
  assert.equal(surface.state[4],0);
  surface.advanceWaves(.5);
  assert.ok(surface.state[4]>.1);
  assert.equal(surface.state[8],0);
  for(let i=0;i<1200;i++)surface.simulate(1/120);
  assert.equal(surface.waves.length,0);
  assertAtRest(surface);
});

test("swept wavefront does not skip fibers when the frame interval is long",()=> {
  const surface=makeSurface([[30,50],[40,50],[50,50]],{waveSpeed:600,waveWidth:4,waveBend:.5,waveCompression:.2});
  surface.waves=[{x:0,y:50,radius:0,reach:100}];
  surface.advanceWaves(.1);
  assert.ok(surface.state[0]>0 && surface.state[4]>0 && surface.state[8]>0);
});
test("shared workspace timeline owns the local wave radius without duplicate activation",()=>{
  const surface=makeSurface([[10,50],[60,50],[95,50]],{waveWidth:5,waveBend:.6,waveCompression:.2});
  surface.gl={};surface.wake=()=>{};let radius=30;
  const timeline={radiusAt:()=>radius};
  surface.emitWave({x:0,y:50},{timeline,activationId:42});
  surface.emitWave({x:0,y:50},{timeline,activationId:42});
  assert.equal(surface.waves.length,1);assert.equal(surface.waves[0].timeline,timeline);
  surface.advanceWaves(.016);assert.equal(surface.waves[0].radius,30);
  radius=70;surface.advanceWaves(.016);assert.equal(surface.waves[0].radius,70);
  assert.ok(surface.state[STATE_STRIDE]>0,"the swept front still reaches intermediate fibers");
});
