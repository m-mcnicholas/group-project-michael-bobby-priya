const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(reduced=false,profile=null){
  const events={},animations=[],timers=new Map();let nextTimer=0;
  class Element {
    constructor(rect={left:100,top:200,width:400,height:300}){
      this.rect=rect;this.isConnected=true;this.style={opacity:'',visibility:'visible'};this.dataset={};this.children=[];this.attributes={};this.inert=false;this.open=false;this.reads=0;
    }
    matches(s){return s==='.task-modal'&&this.className==='task-modal';}
    querySelector(s){return s==='form'?this.form:s==='#modal-title'?this.heading:null;}
    append(...nodes){this.children.push(...nodes);nodes.forEach(n=>n.removed=false);}
    setAttribute(name,value){this.attributes[name]=String(value);}
    getAttribute(name){return this.attributes[name]??null;}
    removeAttribute(name){delete this.attributes[name];}
    remove(){this.removed=true;}
    focus(){this.focused=true;}
    showModal(){this.open=true;}
    getBoundingClientRect(){this.reads++;return this.rect;}
    getClientRects(){return this.isConnected?[this.rect]:[];}
    animate(frames,options){
      let resolve,reject;const a={target:this,frames,options,finished:new Promise((ok,no)=>{resolve=ok;reject=no;}),cancel(){this.cancelled=true;reject();},finish(){resolve();}};
      animations.push(a);return a;
    }
  }
  const ctx={window:{innerWidth:600,innerHeight:700,devicePixelRatio:1,DuckMotion:profile,addEventListener:(name,fn)=>events[name]=fn},
    document:{hidden:false,addEventListener(){},createElement:()=>new Element()},Element,
    setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
    getComputedStyle:()=>({transform:'matrix(1,0,0,1,5,8)',opacity:'.6',backgroundColor:'rgb(248, 201, 67)',backgroundImage:'none',borderRadius:'24px',fontSize:'14px',fontWeight:'700'}),matchMedia:()=>({matches:reduced})};
  vm.runInNewContext(fs.readFileSync('landing/popup-motion.js','utf8'),ctx);
  const panel=()=>{const p=new Element();p.className='task-modal';p.form=new Element();p.heading=new Element({left:120,top:220,width:100,height:30});p.heading.textContent='Add task';return p;};
  return {api:ctx.window.DuckPopupMotion,Element,animations,events,timers,ctx,panel};
}
const settle=async animation=>{animation.finish();await Promise.resolve();};
test('popup geometry maps its center and size toward the launcher rectangle',()=>{const {api}=fixture();assert.equal(api.__testing.transform({left:100,top:200,width:400,height:300},{left:20,top:30,width:80,height:40}),'translate(-240px, -300px) scale(0.2, 0.13333333333333333)');});
test('closing waits for motion and keeps original rectangle when source is removed',async()=>{const {api,Element,animations}=fixture(),source=new Element({left:20,top:30,width:80,height:40}),panel=new Element(),anchor=api.capture(source);source.isConnected=false;let closed=false;api.close(panel,anchor,()=>closed=true);assert(!closed);assert.match(animations[0].frames[1].transform,/translate\(-240px, -300px\)/);await settle(animations[0]);assert(closed);assert(animations[0].cancelled);});
test('reopening cancels a close without firing its stale callback',async()=>{const {api,Element,animations}=fixture(),panel=new Element();let closed=false;api.close(panel,null,()=>closed=true);api.open(panel,null);assert(animations[0].cancelled);assert.equal(animations[1].frames[0].transform,'matrix(1,0,0,1,5,8)');await settle(animations[1]);assert(!closed);});
test('reduced motion is synchronous and shows native form without staging',()=>{
  const {api,animations,panel}=fixture(true),p=panel();let ready=false;api.open(p,null,()=>ready=true);
  assert(ready);assert(p.open);assert(!p.form.inert);assert.equal(animations.length,0);assert.equal(p.dataset.popupStage,undefined);
});
test('resize finishes a pending close',()=>{const {api,Element,animations,events}=fixture();let closed=false;api.close(new Element(),null,()=>closed=true);events.resize();assert(closed);assert(animations[0].cancelled);});
test('popup consumes shared duration and easing',()=>{const profile={easing:'linear(0,0.5,1)',duration:{popupOpen:380,popupClose:300}}, {api,Element,animations}=fixture(false,profile),panel=new Element();api.open(panel,null);assert.equal(animations[0].options.duration,380);assert.equal(animations[0].options.easing,profile.easing);api.close(panel,null);assert.equal(animations[1].options.duration,300);});
test('idle preparation does not open/focus/reset the form, and avoids full-form reads on click',()=>{
  const {api,Element,panel}=fixture(),p=panel();p.form.savedTitle='Keep this';
  assert(api.prepare(p));assert(!p.open);assert(!p.focused);assert.equal(p.dataset.popupPreparing,undefined);assert.equal(p.form.savedTitle,'Keep this');
  const reads=p.form.reads;api.open(p,api.capture(new Element()));assert.equal(p.form.reads,reads);assert.equal(p.dataset.popupPrepared,'true');api.cancel(p);
});
test('shell travels first; fields reveal only at fixed final geometry, then native focus callback runs',async()=>{
  const {api,Element,animations,panel}=fixture(),p=panel(),source=new Element({left:20,top:30,width:80,height:40});api.prepare(p);
  let ready=false;api.open(p,api.capture(source),()=>ready=true);
  assert(p.open);assert(p.focused);assert.equal(p.dataset.popupStage,'shell');assert(p.form.inert);assert.equal(p.form.getAttribute('aria-hidden'),'true');
  assert.equal(source.style.visibility,'hidden');assert.equal(animations.filter(a=>a.target===p.form).length,0);
  for(const a of animations)for(const frame of a.frames)assert(Object.keys(frame).every(k=>['transform','opacity','offset'].includes(k)));
  assert.equal(p.children[0].style.width,'400px');assert.equal(p.children[0].style.backdropFilter,undefined);
  await settle(animations[0]);
  assert.equal(p.dataset.popupStage,'content');assert(!p.form.inert);assert(!ready);assert.equal(p.style.width,'400px');assert.equal(p.style.height,'300px');
  const content=animations.find(a=>a.target===p.form);assert(content);assert(content.frames.every(f=>f.transform===undefined));
  await settle(content);assert(ready);assert.equal(source.style.visibility,'visible');assert(p.children.every(n=>n.removed));assert.equal(p.dataset.popupStage,undefined);
});
test('cold click reserves a scrollable frame without synchronously measuring hidden form',()=>{
  const {api,Element,panel}=fixture(),p=panel();api.open(p,api.capture(new Element()));
  assert.equal(p.form.reads,0);assert.equal(p.heading.reads,0);assert.equal(p.dataset.popupPrepared,'false');assert.equal(p.style.height,'668px');api.cancel(p);
});
test('close resolves fields before shell shrinks and restores source before callback',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();api.prepare(p);api.open(p,api.capture(source));
  await settle(animations[0]);await settle(animations.find(a=>a.target===p.form));
  const start=animations.length;let closed=false;api.close(p,api.capture(source),()=>{assert.equal(source.style.visibility,'visible');assert(p.children.every(n=>n.removed));closed=true;});
  assert.equal(p.dataset.popupStage,'content');assert(!closed);
  const fade=animations.slice(start).find(a=>a.target===p.form);assert.equal(fade.options.duration,60);await settle(fade);
  assert.equal(p.dataset.popupStage,'shell');assert(!closed);
  const movement=animations.slice(start).find(a=>a.target===p.children.at(-3)&&a.options.duration===240);assert(movement);await settle(movement);assert(closed);
});
test('Escape/close during shell reverses without revealing content or firing stale ready callback',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();let ready=false,closed=false;
  api.open(p,api.capture(source),()=>ready=true);const old=animations[0],start=animations.length;
  api.close(p,api.capture(source),()=>closed=true);assert(old.cancelled);assert.equal(p.dataset.popupStage,'shell');
  await settle(animations[start]);await settle(old);assert(closed);assert(!ready);assert.equal(animations.filter(a=>a.target===p.form).length,0);assert(p.children.every(n=>n.removed));
});
test('cancel during content reveal cancels every child, restores fields and leaves no layers',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();api.open(p,api.capture(source));await settle(animations[0]);api.cancel(p);
  assert(animations.every(a=>a.cancelled));assert(p.children.every(n=>n.removed));assert(!p.form.inert);assert.equal(p.form.getAttribute('aria-hidden'),null);assert.equal(p.form.style.opacity,'');assert.equal(source.style.visibility,'visible');
});
test('idle job skips an active modal and resize invalidates prepared geometry',()=>{
  const {api,Element,panel,timers,events}=fixture(),p=panel();api.schedulePrepare(p);p.open=true;[...timers.values()][0]();assert.equal(p.form.reads,0);
  p.open=false;api.prepare(p);events.resize();const reads=p.form.reads;api.open(p,api.capture(new Element()));assert.equal(p.form.reads,reads);assert.equal(p.dataset.popupPrepared,'false');api.cancel(p);
});
test('resize while content is resolving makes dialog usable and reserves the reflowed form',()=>{
  const {api,Element,panel,events}=fixture(),p=panel();let ready=false;api.open(p,api.capture(new Element()),()=>ready=true);events.resize();
  assert(ready);assert(!p.form.inert);assert(p.children.every(n=>n.removed));assert.equal(p.style.width,'400px');assert.equal(p.style.height,'300px');
});
test('opt-in profiler disconnects once on interruption',async()=>{
  const {api,Element,animations,ctx,panel}=fixture();let disconnected=0,cancelled=0,output;
  ctx.window.location={search:'?motionAudit=1'};ctx.performance={now:()=>100,getEntriesByType:()=>[]};ctx.requestAnimationFrame=()=>1;ctx.cancelAnimationFrame=()=>cancelled++;
  ctx.PerformanceObserver=class {static supportedEntryTypes=['longtask'];observe(){}takeRecords(){return [];}disconnect(){disconnected++;}};
  ctx.document.querySelector=()=>output;ctx.document.body={append(node){output=node;}};ctx.document.createElement=()=>{const n=new Element();n.textContent='';return n;};
  const p=panel();api.open(p,api.capture(new Element()));api.cancel(p);await settle(animations[0]);
  assert.equal(disconnected,1);assert.equal(cancelled,1);assert(output.hidden);const records=output.textContent.trim().split('\n').map(JSON.parse);assert.equal(records.length,1);assert.equal(records[0].result,'cancelled');
});
test('normal motion has no audit observer or RAF loop',()=>{
  const {api,Element,ctx,panel}=fixture();ctx.PerformanceObserver=class {constructor(){throw Error('unexpected observer');}};ctx.requestAnimationFrame=()=>{throw Error('unexpected audit RAF');};
  const p=panel();api.open(p,api.capture(new Element()));api.cancel(p);
});

test('reset releases reserved bounds and restores native form state after dismissal',()=>{
  const {api,Element,panel}=fixture(),p=panel();p.style.width='80%';api.open(p,api.capture(new Element()));p.open=false;api.reset(p);
  assert.equal(p.style.width,'80%');assert.equal(p.dataset.popupStaged,undefined);assert.equal(p.dataset.popupStage,undefined);assert(!p.form.inert);assert(p.children.every(n=>n.removed));
});

test('sliced corners stay circular and meet their neighboring edges throughout closing',()=>{
  const {api}=fixture(),box={left:250,top:40,width:680,height:680,radius:24};
  for(const target of [{left:350,top:40,width:124,height:44,radius:22},{left:20,top:240,width:44,height:44,radius:22},{left:900,top:60,width:88,height:32,radius:8}]){
    const slices=api.__testing.sliceGeometry(box,target,target.radius);
    for(const progress of [0,.1,.25,.5,.75,.9,.99,1]){
      const rects=slices.map(s=>Object.fromEntries(['x','y','width','height'].map(k=>[k,s.base[k]+(s.end[k]-s.base[k])*progress])));
      for(const [index,s] of slices.entries())if(s.corner){
        const sx=rects[index].width/s.base.width,sy=rects[index].height/s.base.height;
        assert(Math.abs(sx-sy)<1e-9,'corner must never be flattened by unequal scale');
        assert(s.radius*sx>=Math.min(box.radius,target.radius)-1e-9);
      }
      for(let row=0;row<3;row++)for(let col=0;col<2;col++){
        const a=rects[row*3+col],b=rects[row*3+col+1];assert(Math.abs(a.x+a.width-b.x)<1e-8,'horizontal edges must stay joined');
      }
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        const a=rects[row*3+col],b=rects[(row+1)*3+col];assert(Math.abs(a.y+a.height-b.y)<1e-8,'vertical edges must stay joined');
      }
      const width=Math.max(...rects.map(r=>r.x+r.width))-Math.min(...rects.map(r=>r.x));
      const height=Math.max(...rects.map(r=>r.y+r.height))-Math.min(...rects.map(r=>r.y));
      assert(Math.abs(width-(box.width+(target.width-box.width)*progress))<1e-8);
      assert(Math.abs(height-(box.height+(target.height-box.height)*progress))<1e-8);
    }
  }
});
test('reversing a sliced shell preserves each live corner transform',()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();api.open(p,api.capture(source));const start=animations.length;
  api.close(p,api.capture(source));
  const transforms=animations.slice(start).filter(a=>a.target.className==='popup-morph-tile');assert.equal(transforms.length,9);
  assert(transforms.every(a=>a.frames[0].transform==='matrix(1,0,0,1,5,8)'));api.cancel(p);
});

test('closing returns the original launcher caption, including its icon',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();source.textContent='＋ Add task';const anchor=api.capture(source);
  api.open(p,anchor);assert.equal(p.children.at(-1).textContent,'Add task');await settle(animations[0]);await settle(animations.find(a=>a.target===p.form));
  api.close(p,anchor);assert.equal(p.children.at(-1).textContent,'＋ Add task');api.cancel(p);
});

test('normal closing retraces opening endpoints for every corner, source paint and title',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element({left:360,top:33,width:100,height:38}),anchor=api.capture(source);
  api.prepare(p);api.open(p,anchor);
  const opening=animations.filter(a=>['popup-morph-tile','popup-morph-source','popup-morph-label'].includes(a.target.className)&&a.frames[0].transform!==undefined);
  assert.equal(opening.length,11);
  await settle(animations[0]);await settle(animations.find(a=>a.target===p.form));
  const start=animations.length;api.close(p,anchor);await settle(animations.slice(start).find(a=>a.target===p.form));
  const closing=animations.slice(start).filter(a=>a.options.duration===240&&['popup-morph-tile','popup-morph-source','popup-morph-label'].includes(a.target.className)&&a.frames[0].transform!==undefined);
  assert.equal(closing.length,11);
  for(let i=0;i<opening.length;i++){
    assert.equal(closing[i].frames.length,2);
    assert.deepEqual(closing[i].frames[0],opening[i].frames[1]);assert.deepEqual(closing[i].frames[1],opening[i].frames[0]);
    assert.equal(closing[i].options.easing,opening[i].options.easing);
  }
  api.cancel(p);
});

test('native prototype-backed button rectangle yields valid closing transforms',async()=>{
  const {api,Element,panel,animations}=fixture(),p=panel(),source=new Element();const anchor=api.capture(source);
  source.getBoundingClientRect=()=>Object.create({left:20,top:30,width:100,height:38});
  api.prepare(p);api.open(p,anchor);await settle(animations[0]);await settle(animations.find(a=>a.target===p.form));
  const start=animations.length;api.close(p,anchor);await settle(animations.slice(start).find(a=>a.target===p.form));
  const tiles=animations.slice(start).filter(a=>a.target.className==='popup-morph-tile');assert.equal(tiles.length,9);
  for(const tile of tiles)for(const frame of tile.frames)assert(!/NaN|undefined|Infinity/.test(frame.transform),frame.transform);
  api.cancel(p);
});
