(() => {
  'use strict';
  function trace(name,delay=280){
    const events=[],add=(t,type,x,y)=>events.push({t,type,x,y});
    function press(offset,x,y){add(offset,'press',x,y);add(offset+180,'release',x,y);}
    function brush(offset,duration){for(let i=0;i<=24;i++)add(offset+i*duration/24,'move',.15+.7*i/24,.5);add(offset+duration+1,'leave',.85,.5);}
    if(name==='center')press(0,.5,.5);else if(name==='offset')press(0,.25,.38);else if(name==='slow')brush(0,850);else if(name==='fast')brush(0,90);
    else{press(0,.5,.5);press(1100,.25,.38);brush(2200,850);brush(3800,90);}
    return {version:1,name,recoveryDelay:delay,simulationHz:120,events,duration:events.at(-1).t+delay+3500};
  }
  window.DuckFurExperiment={trace};if(typeof document==='undefined')return;
  const form=document.querySelector('#experiment-controls'),status=document.querySelector('#replay-status');
  const ids=['stage-a','stage-b','button-a','button-b'];let surfaces=[],raf=0,playing=false,held=false,clock=0,last=0,accumulator=0,cursor=0,currentTrace=null,recorder=null,url=null,traceURL=null;
  let performanceRows={},gpuTimers=[],peakCurve=[0,0],representative=[0,0],timers=[];
  const params={quality:'medium',density:1,length:5.2,stiffness:62,damping:22,radius:12.8,pressRadius:38.4,recoveryDelay:280,silhouette:false,waveEnabled:false};
  const stopNative=s=>{if(s.frameId)cancelAnimationFrame(s.frameId);s.frameId=0;s.running=false;};
  function releaseTimers(){gpuTimers.forEach(t=>{if(t?.query && !t.gl.isContextLost())t.gl.deleteQuery(t.query);});gpuTimers=[];}
  function gpuTimer(s){const gl=s.gl,ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');return ext?{gl,ext,query:null,max:0}:null;}
  function submit(s,index){const t=gpuTimers[index];if(!t || !s.gl || s.gl.isContextLost()){s.draw();return;}
    if(t.query && t.gl.getQueryParameter(t.query,t.gl.QUERY_RESULT_AVAILABLE)){if(!t.gl.getParameter(t.ext.GPU_DISJOINT_EXT))t.max=Math.max(t.max,t.gl.getQueryParameter(t.query,t.gl.QUERY_RESULT)/1e6);t.gl.deleteQuery(t.query);t.query=null;}
    const measure=!t.query;if(measure){t.query=t.gl.createQuery();t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT,t.query);}s.draw();if(measure)t.gl.endQuery(t.ext.TIME_ELAPSED_EXT);
  }
  function mount(){
    releaseTimers();
    surfaces.forEach(s=>DuckFur.unmount(s.host));surfaces=[];const variant=form.elements.variant.value;
    for(let i=0;i<ids.length;i++){const enhanced=i%2===1,host=document.getElementById(ids[i]);surfaces.push(DuckFur.mount(host,{...params,recoveryDelay:Number(form.elements.delay.value),experimentalStrands:enhanced,strandCurvature:true,pileMemory:enhanced&&['comb','combined'].includes(variant)?1:0,pileNeighbors:enhanced&&['neighbors','combined'].includes(variant)?1:0,reducedMotion:form.elements.reduced.checked,silhouette:i>1,label:i>1?'Plan task':null}));}
    gpuTimers=surfaces.map(gpuTimer);
    const a=surfaces[0],b=surfaces[1];if(a.count!==b.count)status.value='Counts differ; resize/reset before comparing.';
    surfaces.forEach((s,i)=>{if(i<2){const target={x:s.width*.5+s.interactionRadius(true)*.43,y:s.height*.5};representative[i]=nearest(s,target);}});report();
  }
  function nearest(s,p){let selected=0,d=Infinity;for(let i=0;i<s.count;i++){const n=Math.hypot(s.roots[i*2]*s.width-p.x,s.roots[i*2+1]*s.height-p.y);if(n<d){d=n;selected=i;}}return selected;}
  function reset(){surfaces.forEach(s=>{stopNative(s);s.pressed=false;s.activePress?.fill(0);s.resetFibers();s.cancelledDispersal=false;s.releasedDispersal=null;});}
  function finish(resetState=false){playing=false;held=false;if(raf)cancelAnimationFrame(raf);raf=0;recorder?.finish();recorder=null;surfaces.forEach(s=>{stopNative(s);if(s.pressed)s.finishPress({},false);stopNative(s);});if(resetState)reset();document.querySelector('#freeze').textContent='Hold / resume';report();}
  function deliver(t){
    for(let i=0;i<surfaces.length;i++){const s=surfaces[i],point={x:t.x*s.width,y:t.y*s.height};
      if(t.type==='press'){s.pointer={...point,time:t.t};s.pressed=true;s.releaseActivePressFibers();if(!s.options.reducedMotion && !s.reducedMotion.matches)s.imprintPress();if(i<2)representative[i]=nearest(s,{x:point.x+s.interactionRadius(true)*.43,y:point.y});}
      if(t.type==='move'){if(!s.options.reducedMotion && !s.reducedMotion.matches && s.pointer.time!==undefined)s.brush(s.pointer.x,s.pointer.y,point.x,point.y,Math.max(1,t.t-s.pointer.time));s.pointer={...point,time:t.t};if(i<2)representative[i]=nearest(s,point);}
      if(t.type==='release'){s.finishPress({},false);stopNative(s);}
    }
  }
  function composite(){const width=Math.round(surfaces[0].width),height=Math.round(surfaces[0].height),c=document.createElement('canvas');c.width=width*2+48;c.height=height+140;return c;}
  let compositeCanvas=null;
  function recordFrame(){if(!recorder)return;const c=compositeCanvas,ctx=c.getContext('2d'),w=surfaces[0].width,h=surfaces[0].height;ctx.fillStyle='#fffbed';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#292210';ctx.font='bold 15px system-ui';for(let i=0;i<2;i++){const x=16+i*(w+16);ctx.fillText(i?'B · curved prototype':'A · approved baseline',x,24);ctx.drawImage(surfaces[i].canvas,x,40,w,h);const p=surfaces[i+2];ctx.drawImage(p.canvas,x+(w-p.width-p.overscan*2)/2,h+64,p.width+p.overscan*2,p.height+p.overscan*2);}ctx.font='12px monospace';ctx.fillText(`${currentTrace.name} · identical ${currentTrace.events.length} input events · hold ${currentTrace.recoveryDelay} ms · t=${Math.round(clock)} ms`,16,c.height-8);recorder.frame(null,c);}
  function start(){
    finish(true);reset();surfaces.forEach(s=>{stopNative(s);s.pointer={x:0,y:s.height*.5,time:undefined};});
    currentTrace=trace(form.elements.gesture.value,Number(form.elements.delay.value));cursor=0;clock=0;last=0;accumulator=0;peakCurve=[0,0];performanceRows={frames:0,maxFrame:0,simulateMs:0,drawMs:0,start:0,pairMax:[0,0],pairDraw:[0,0]};playing=true;
    if(form.elements.record.checked){compositeCanvas=composite();try{recorder=new DuckFurRecording.Recorder({width:compositeCanvas.width,height:compositeCanvas.height},compositeCanvas,blob=>{if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);const video=document.querySelector('#comparison-video'),link=document.querySelector('#comparison-download');video.src=url;video.hidden=false;link.href=url;link.download=`duckplan-${currentTrace.name}-${form.elements.variant.value}.webm`;link.textContent='Save synchronized A/B recording';link.hidden=false;},{maxDurationMs:18000});}catch(error){status.value=`Recording unavailable: ${error.message}`;}}
    raf=requestAnimationFrame(frame);
  }
  function frame(now){
    if(!playing || held)return;
    if(!last){last=now;performanceRows.start=now;}
    const interval=now-last;last=now;performanceRows.maxFrame=Math.max(performanceRows.maxFrame,interval);performanceRows.frames++;accumulator+=Math.min(100,interval);
    const before=performance.now(),cost=[0,0];
    while(accumulator>=1000/120){while(cursor<currentTrace.events.length && currentTrace.events[cursor].t<=clock+.001)deliver(currentTrace.events[cursor++]);for(let i=0;i<surfaces.length;i++){const s=surfaces[i],start=performance.now();if(!s.options.reducedMotion && !s.reducedMotion.matches)s.simulate(1/120);cost[i%2]+=performance.now()-start;}clock+=1000/120;accumulator-=1000/120;}
    performanceRows.simulateMs=Math.max(performanceRows.simulateMs,performance.now()-before);const draw=performance.now(),drawCost=[0,0];surfaces.forEach((s,i)=>{const t=performance.now();submit(s,i);drawCost[i%2]+=performance.now()-t;});for(let i=0;i<2;i++){performanceRows.pairMax[i]=Math.max(performanceRows.pairMax[i],cost[i]);performanceRows.pairDraw[i]=Math.max(performanceRows.pairDraw[i],drawCost[i]);}performanceRows.drawMs=Math.max(performanceRows.drawMs,performance.now()-draw);recordFrame();
    for(let i=0;i<2;i++)peakCurve[i]=Math.max(peakCurve[i],shape(surfaces[i],representative[i]).deviation);
    performanceRows.elapsed=(performanceRows.elapsed||0)+interval;status.value=`${Math.round(clock)} / ${currentTrace.duration} ms · event ${cursor}/${currentTrace.events.length} · fixed 120 Hz · ${Math.round((performanceRows.frames-1)*1000/Math.max(1,performanceRows.elapsed))} FPS · max frame ${performanceRows.maxFrame.toFixed(1)} ms · sim ${performanceRows.simulateMs.toFixed(2)} ms · submission ${performanceRows.drawMs.toFixed(2)} ms`;
    if(clock>=currentTrace.duration){finish();status.value+=' · complete';return;}raf=requestAnimationFrame(frame);
  }
  function shape(s,index){const i=index*4,r=index*6,c=s.state?.[i+2]||0,d=s.state?.[i+3]||0,field=s.pileField?.sample(s.roots?.[index*2]||0,s.roots?.[index*2+1]||0)||[0,0,0,0],compression=Math.min(1,c+field[2]*.5),depression=Math.min(1,d+field[3]*.3),length=s.options.length*(s.rootSeeds?.[r+2]||1),angle=s.rootSeeds?.[r+3]||0,seed=s.rootSeeds?.[r+4]||0;
    const rest=[Math.cos(angle),Math.sin(angle)].map(v=>v*length*(.28+.1*seed)*(1-.78*compression-.16*depression)),bend=[s.state?.[i]||0,s.state?.[i+1]||0].map(v=>v*length*1.62*(.68+.77*compression)),memory=field.slice(0,2).map(v=>v*length*.85),amount=s.options.experimentalStrands?1:0;
    const points=Array.from({length:13},(_,j)=>DuckPile.path(j/12,rest,bend,memory,amount,compression)),end=points.at(-1),deviation=Math.max(...points.map((p,i)=>Math.hypot(p[0]-end[0]*i/12,p[1]-end[1]*i/12)));return {points,deviation,field};}
  function report(){if(!surfaces.length)return;for(let i=0;i<2;i++){const s=surfaces[i],p=surfaces[i+2],stats=s.getStats(),q=shape(s,representative[i]);document.querySelector(i?'#metrics-b':'#metrics-a').textContent=`${stats.renderer} · ${s.count} inspection + ${p.count} label fibers\n${s.strandVertices||6} vertices/fiber · ${s.count*(s.strandVertices||6)} submitted vertices\ncurvature deviation ${q.deviation.toFixed(3)} CSS px · replay peak ${peakCurve[i].toFixed(3)} px\nsim max ${(performanceRows.pairMax?.[i]||0).toFixed(2)} ms · submission ${(performanceRows.pairDraw?.[i]||0).toFixed(2)} ms · GPU ${gpuTimers[i]?gpuTimers[i].max.toFixed(2)+" ms max":"timing unavailable"}\nrebuild ${stats.rebuildMs.toFixed(2)} ms · GPU buffers/texture ${stats.gpuBytes} bytes\nroot drift ${Math.hypot(...q.points[0]).toFixed(3)} px · pile field ${s.pileField?(s.pileField.data.byteLength*3+s.pileField.hold.byteLength):0} CPU bytes\n${s.options.pileMemory?'combing memory on':'combing memory off'} · ${s.options.pileNeighbors?'neighbor compression on':'neighbor compression off'}\n${s.fallbackReason||''}`;
      const canvas=document.querySelector(i?'#lens-b':'#lens-a'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#aa9a70';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(80,115);ctx.lineTo(80+q.points.at(-1)[0]*14,115-q.points.at(-1)[1]*14);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle=i?'#9b6810':'#655e4d';ctx.lineWidth=3;ctx.beginPath();q.points.forEach((p,j)=>j?ctx.lineTo(80+p[0]*14,115-p[1]*14):ctx.moveTo(80,115));ctx.stroke();ctx.fillStyle='#292210';ctx.font='14px system-ui';ctx.fillText('Representative shaft · 14× diagram',12,22);ctx.beginPath();ctx.arc(80,115,4,0,Math.PI*2);ctx.fill();}
  }
  document.querySelector('#play').addEventListener('click',start);document.querySelector('#stop').addEventListener('click',()=>{finish(true);DuckTransitions.cancel();status.value='Reset. Approved renderer remains unchanged.';});
  document.querySelector('#freeze').addEventListener('click',()=>{if(!playing)return;held=!held;if(held){cancelAnimationFrame(raf);raf=0;recorder?.finish();recorder=null;}else{last=0;raf=requestAnimationFrame(frame);}document.querySelector('#freeze').textContent=held?'Resume replay':'Hold / resume';});
  document.querySelector('#rest-check').addEventListener('click',()=>{finish(true);const values=[];for(const pair of [[0,1],[2,3]]){const [a,b]=pair.map(i=>surfaces[i].canvas),read=c=>{const x=document.createElement('canvas');x.width=c.width;x.height=c.height;const ctx=x.getContext('2d');ctx.drawImage(c,0,0);return ctx.getImageData(0,0,x.width,x.height).data;};const x=read(a),y=read(b);if(x.length!==y.length){values.push('size mismatch');continue;}let sum=0;for(let i=0;i<x.length;i++)sum+=(x[i]-y[i])**2;values.push(Math.sqrt(sum/x.length).toFixed(3));}status.value=`Resting pixel RMSE: inspection ${values[0]} / 255 · label ${values[1]} / 255. Same backing size and seeds.`;});
  document.querySelector('#save-trace').addEventListener('click',()=>{if(traceURL)URL.revokeObjectURL(traceURL);traceURL=URL.createObjectURL(new Blob([JSON.stringify(currentTrace||trace(form.elements.gesture.value,Number(form.elements.delay.value)),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=traceURL;a.download='duckplan-input-trace.json';a.click();});
  document.querySelector('#lose-context').addEventListener('click',()=>{finish();surfaces[1].gl?.getExtension('WEBGL_lose_context')?.loseContext();});document.querySelector('#restore-context').addEventListener('click',()=>{finish();mount();});
  form.addEventListener('change',()=>{finish(true);mount();mountWave();status.value='Settings matched; replay starts both from rest.';});
  ids.forEach(id=>document.getElementById(id).addEventListener('pointerdown',()=>{if(playing)finish();},{capture:true}));
  let destination=false;const waveRoot=document.querySelector('#physics-workspace'),waveSource=document.querySelector('#physics-wave-source'),waveForm=document.querySelector('#wave-controls-physics');
  function mountWave(){DuckTransitions.cancel();DuckFur.unmount(waveSource);const enhanced=waveForm.elements.mode.value==='enhanced';DuckFur.mount(waveSource,{...params,silhouette:true,label:'Turn workspace',experimentalStrands:enhanced,recoveryDelay:Number(form.elements.delay.value),pileMemory:0,pileNeighbors:0,reducedMotion:form.elements.reduced.checked});}
  waveForm.addEventListener('change',mountWave);waveSource.addEventListener('click',event=>{finish();DuckTransitions.configure({duration:1000,reducedMotion:form.elements.reduced.checked});const s=DuckFur.get(waveSource);DuckTransitions.workspace({root:waveRoot,source:waveSource,event,effect:'sheet',sheetOptions:{formation:true,experimentalStrands:s.options.experimentalStrands,record:waveForm.elements.record.checked},update:()=>{destination=!destination;waveRoot.classList.toggle('destination',destination);waveRoot.querySelector('h3').textContent=destination?'Your week, in focus':'Your day, in focus';}});});
  const update=setInterval(()=>{report();const s=DuckTransitions.getStats();document.querySelector('#wave-report').textContent=`${s.phase||'Ready'} · ${Math.round((s.progress||0)*100)}% · ${s.fps} FPS · max ${s.maxFrameMs.toFixed(1)} ms · ${s.layers} overlay\n${JSON.stringify(s.sheetResources)}${s.sheetFailure?' · '+s.sheetFailure:''}`;},200);
  addEventListener('resize',()=>{finish(true);DuckTransitions.cancel();status.value='Replay interrupted by resize; reset before comparing.';});document.addEventListener('visibilitychange',()=>{if(document.hidden){finish();DuckTransitions.cancel();}});addEventListener('pagehide',()=>{finish();clearInterval(update);timers.forEach(clearTimeout);releaseTimers();surfaces.forEach(s=>DuckFur.unmount(s.host));DuckFur.unmount(waveSource);DuckTransitions.cancel();if(url)URL.revokeObjectURL(url);if(traceURL)URL.revokeObjectURL(traceURL);});mount();mountWave();
})();
