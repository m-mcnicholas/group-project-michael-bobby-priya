"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
global.window={};require("../landing/fur-sheet.js");
const {geometry,sample,project,revealRadius,revealPolygon}=window.DuckFurSheet;
const model=p=>geometry(900,600,{x:410,y:250},{},p);
test("zero-progress footprint is empty and projected seed is exact",()=>{
  const m=model(0);assert.equal(m.radius,0);assert.equal(m.coverageArea,0);
  const seed=sample(m,0,-1);assert.equal(seed.visible,false);
  assert.deepEqual(project(m,seed),m.origin);
});
test("early growth is localized with no finite initial band or displaced seed",()=>{
  const m=model(.01);assert.ok(m.radius<1);assert.ok(m.band<=m.radius*.55);
  assert.equal(sample(m,0,-1).x,m.origin.x);assert.equal(sample(m,0,-1).y,m.origin.y);
  assert.ok(sample(m,0,-1).z<.2);
});
test("filled material domain grows monotonically and stays connected from seed to crest",()=>{
  let area=0;
  for(const p of [.05,.1,.2,.4,.6,.8,1]){
    const m=model(p);assert.ok(m.coverageArea>=area);area=m.coverageArea;
    for(let i=0;i<=100;i++)assert.ok(sample(m,0,2*(m.radius*i/100)/m.reach-1).visible || i===100);
  }
});
test("a root keeps fixed material coordinates as growth activates it",()=>{
  const a=model(.4),b=model(.7),q=2*20/a.reach-1;
  const first=sample(a,.25,q),second=sample(b,.25,q);
  assert.equal(first.r,second.r);assert.equal(first.x,second.x);assert.equal(first.y,second.y);
  assert.ok(first.visible && second.visible);assert.equal(first.normal.z,1);
});
test("raised rolling crest overturns its normal and carries normal-offset thickness",()=>{
  const m=model(.4),q=2*(m.radius-m.band*.5)/m.reach-1;
  const top=sample(m,0,q),bottom=sample(m,0,q,1);
  assert.ok(top.z>30);assert.ok(top.normal.z<0);
  assert.ok(Math.abs(Math.hypot(top.x-bottom.x,top.y-bottom.y,top.z-bottom.z)-m.settings.thickness)<1e-6);
});
test("reveal follows grounded inner roll foot rather than outer growth or raised crest",()=>{
  const m=model(.4),foot=sample(m,0,2*revealRadius(m)/m.reach-1);
  assert.ok(Math.abs(foot.z)<1e-8);
  assert.ok(revealPolygon(m).includes(`${foot.x.toFixed(2)}px ${foot.y.toFixed(2)}px`));
  assert.notEqual(revealRadius(m),m.radius);
});
test("settlement clears the temporary material only after full workspace coverage",()=>{
  const m=model(1);assert.equal(m.opacity,0);assert.equal(m.amplitude,0);
  for(const [x,y]of [[0,0],[900,0],[0,600],[900,600]])assert.ok(Math.hypot(x-m.origin.x,y-m.origin.y)<revealRadius(m));
});
test("every growth-speed tuning still covers and settles the whole workspace",()=>{
  for(const growthSpeed of [.5,1,2]){
    const m=geometry(900,600,{x:410,y:250},{growthSpeed},1);
    assert.equal(m.radius,m.reach);assert.equal(m.opacity,0);
  }
});
const {flattenAmount,settlement}=window.DuckFurSheet;
const forming=p=>geometry(900,600,{x:410,y:250},{formation:true,flattenWidth:90},p);
test("settlement is uniform across the full sheet with no radial reveal front",()=>{
  const m=forming(.84);
  for(const r of [0,40,200,600,m.reach])assert.ok(Math.abs(flattenAmount(m,r)-.5)<1e-8);
  assert.equal(revealRadius(m),0);
  const state=settlement(m,200);assert.ok(Math.abs(state.thicknessScale-.5)<1e-8);
});
test("a fixed material region physically lowers, loses thickness and becomes native without global fade",()=>{
  const m=forming(.84),r=200,q=2*r/m.reach-1;
  const top=sample(m,0,q),bottom=sample(m,0,q,1);
  assert.ok(top.z>0);assert.ok(Math.abs(Math.hypot(top.x-bottom.x,top.y-bottom.y,top.z-bottom.z)-2.5)<1e-5);
  const end=forming(1),settled=sample(end,0,q),under=sample(end,0,q,1);
  assert.equal(settlement(end,r).formed,true);assert.equal(settled.z,0);assert.equal(settled.normal.z,1);
  assert.equal(settled.x,under.x);assert.equal(settled.z,under.z);assert.equal(settled.visible,false);
  for(const p of [.05,.2,.4,.6,.8,.95,1])assert.equal(forming(p).opacity,1);
});
test("native boundary is on the resting plane and reaches every viewport point before cleanup",()=>{
  for(const p of [.4,.6,.8,.95,1]){
    const m=forming(p),r=revealRadius(m);
    if(r>0){const point=sample(m,0,2*r/m.reach-1);assert.ok(Math.abs(point.z)<1e-7);assert.equal(flattenAmount(m,r),1);}
  }
  const end=forming(1);
  for(const [x,y]of [[0,0],[900,0],[0,600],[900,600],[410,250]]){
    const r=Math.hypot(x-end.origin.x,y-end.origin.y);
    assert.equal(settlement(end,r).formed,true);assert.equal(sample(end,0,2*r/end.reach-1).visible,false);
  }
});
test("settlement never reverses for a fixed root and no region is handed off while raised",()=>{
  for(const r of [0,40,180,400,590]){
    let previous=0;
    for(let step=0;step<=100;step++){
      const m=forming(step/100),flat=flattenAmount(m,r);assert.ok(flat>=previous);previous=flat;
      if(flat===1){const point=sample(m,0,2*r/m.reach-1);assert.equal(point.z,0);assert.equal(point.visible,false);}
    }
  }
});

test("one raised wave clears the workspace before the whole sheet starts settling",()=>{
  const m=forming(.5);assert.equal(m.radius,m.reach);assert.equal(m.settleProgress,0);
  for(const [x,y]of [[0,0],[900,0],[0,600],[900,600]])assert.ok(Math.hypot(x-m.origin.x,y-m.origin.y)<m.radius-m.band);
  for(const p of [.1,.3,.5,.52])assert.equal(flattenAmount(forming(p),0),0);
  assert.ok(forming(.8).settleProgress>0);
});
test("whole-sheet settlement has no second ridge, curl or spatial slope",()=>{
  const m=forming(.75);let previous=-1;
  const maxRadius=Math.max(...[[0,0],[900,0],[0,600],[900,600]].map(([x,y])=>Math.hypot(x-m.origin.x,y-m.origin.y)));
  for(let r=0;r<=maxRadius;r+=2){
    const point=sample(m,0,2*r/m.reach-1);
    assert.ok(Math.abs(point.x-m.origin.x-r)<1e-6); // No second radial curl.
    assert.ok(point.z<=m.settings.elevation*.32+1e-6);
    if(previous>=0)assert.ok(Math.abs(point.z-previous)<1e-6);
    previous=point.z;
  }
});
test("raised whole-sheet body stays registered to native pixel anchors while settling",()=>{
  for(const progress of [.5,.7,.8,.9,.95,1]){
    const m=forming(progress),height=20.48*(1-m.settleProgress);
    for(const [x,y] of [[0,0],[900,0],[0,600],[900,600],[410,250]])assert.deepEqual(project(m,{x,y,z:height}),{x,y});
  }
  const old=geometry(900,600,{x:410,y:250},{formation:true,colorOnly:true},.5);
  assert.notDeepEqual(project(old,{x:0,y:0,z:20.48}),{x:0,y:0});
});

test("fur completes its color transformation before any whole-sheet flattening or native resolve",()=>{
  const state=window.DuckFurSheet.formationState;
  assert.equal(state(.5).tint,0);assert.equal(state(.5).flatten,0);
  assert.ok(state(.6).tint>0 && state(.6).tint<1);
  for(const p of [.6,.65,.7])assert.equal(state(p).flatten,0);
  assert.equal(state(.7).tint,1);assert.equal(state(.74).tint,1);
  assert.equal(state(.98).flatten,1);
  const dyed=forming(.7);assert.equal(dyed.settleProgress,0);assert.equal(dyed.tintProgress,1);assert.equal(revealRadius(dyed),0);
});

test("color and compression meet with zero velocity and acceleration instead of a held pause",()=>{
  const f=window.DuckFurSheet.formationState,h=1e-5;
  for(const [key,edge]of [["tint",.5],["tint",.7],["flatten",.7],["flatten",.98]]){
    const a=f(edge-h)[key],b=f(edge)[key],c=f(edge+h)[key];
    assert.ok(Math.abs((c-a)/(2*h))<.001);
    assert.ok(Math.abs((c-2*b+a)/(h*h))<.1);
  }
  assert.ok(f(.701).flatten>0,"compression begins gently as soon as the dye completes");
});
