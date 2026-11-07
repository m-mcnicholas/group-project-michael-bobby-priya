(() => {
  const form=document.querySelector("#sheet-controls"),root=document.querySelector("#sheet-workspace"),output=document.querySelector("#sheet-metrics");
  let destination=false,timers=[],inspection=null,boundaryFrame=0;
  const cancelBoundary=()=>{if(boundaryFrame)cancelAnimationFrame(boundaryFrame);boundaryFrame=0;};
  document.querySelectorAll("#sheet-lab button:not([data-progress]):not(#sheet-press-hold):not(#sheet-press-release):not(#sheet-crossing)").forEach(host=>DuckFur.mount(host,{silhouette:true,quality:"medium",length:5.2,label:host.textContent.trim()}));
  function values(){const result={};for(const input of form.querySelectorAll("input,select")){result[input.name]=input.type==="checkbox"?input.checked:Number(input.value);const out=input.parentElement.querySelector("output");if(out)out.value=input.value;}return result;}
  function report(){const s=DuckTransitions.getStats(),peak=s.sheetPeak||{},live=s.sheetResources||{};
    const traces=document.querySelector("#sheet-response-traces");
    if(traces){const rows=s.responseTraces||[];traces.dataset.traces=JSON.stringify(rows);traces.textContent=rows.length?`Shared button spring · material age ${Math.round((s.materialSeconds||0)*1000)} ms · atlas ${(s.responseBuildMs||0).toFixed(1)} ms · CPU ${((peak.cpuResponseBytes||0)/1048576).toFixed(2)} MiB\n${rows.map(r=>`${r.region}: ${r.arrived?"arrived":"pending"} · arrival ${Math.round(r.arrivalMs)} ms · hold ${Math.round(r.remainingMs)} ms · bend ${r.displacement.toFixed(2)} px · velocity ${r.velocity.toFixed(2)} px/s · compression ${r.compression.toFixed(3)} · depression ${r.depression.toFixed(3)} · orientation ${(r.orientation*180/Math.PI).toFixed(1)}° · height ${r.height.toFixed(2)} px · flat ${Math.round(r.flatten*100)}%`).join("\n")}`:s.sharedResponse?"Awaiting response samples":"Previous analytic recovery / no measured source";}
    const diagnostic=document.querySelector("#sheet-registration");
    if(diagnostic){const r=s.registration,last=r?.frames?.at(-1),a=r?.before,b=last?.layout||r?.destination;
      if(r)diagnostic.dataset.registration=JSON.stringify(r);
      diagnostic.textContent=a&&b?`Viewport ${b.viewport} · scroll ${b.scroll}\nRoot ${b.root?.width.toFixed(1)} × ${b.root?.height.toFixed(1)} at ${b.root?.x.toFixed(1)}, ${b.root?.y.toFixed(1)}\nOverlay ${b.overlay?.width.toFixed(1)} × ${b.overlay?.height.toFixed(1)} · canvas ${b.backing}\nTargets ${s.targets?.length||0} · content regions ${s.contentRegions?.length||0} · Δ scroll ${b.scroll.map((v,i)=>(v-a.scroll[i]).toFixed(1))}\nAnchor drift ${Math.max(0,...(last?.anchors||[]).map(p=>Math.hypot(p.x-p.projected.x,p.y-p.projected.y))).toFixed(3)} px · held frames ${r.frames.length}`:"Registration measurements appear after a transition.";
    }
    const continuity=document.querySelector("#sheet-continuity"),d=s.dispersal;
    if(continuity){const impulse=inspection?.impulse||d;if(!impulse){continuity.textContent=values().independentGrowth?"Independent growth baseline — no measured handoff.":"Press continuity measurements appear here.";delete continuity.dataset.dispersal;}if(impulse){const samples=impulse.samples,avg=key=>samples.reduce((n,v)=>n+v[key],0)/samples.length;
      continuity.dataset.dispersal=JSON.stringify(impulse);
      continuity.textContent=`${inspection?.stage||s.phase||"Ready"} · activation ${d?.activationId??"held"} · ${samples.length} angular sectors\nMean displacement ${avg("radial").toFixed(3)} px · radial velocity ${avg("velocity").toFixed(3)} px/s · compression ${avg("compression").toFixed(3)}\nPress radius ${impulse.pressRadius.toFixed(2)} px · perimeter ${Math.min(...samples.map(v=>v.edge)).toFixed(1)}–${Math.max(...samples.map(v=>v.edge)).toFixed(1)} px\nButton response ${(d?.responseMs||0).toFixed(1)} ms · release → prep ${(d?.releaseToPreparationMs||0).toFixed(1)} ms\nPress → first sheet ${(d?.pressToFirstFrameMs||0).toFixed(1)} ms · click → first sheet ${(d?.clickToFirstFrameMs||0).toFixed(1)} ms · first radius ${(d?.firstRadius||0).toFixed(2)} px\nRecovery delay ${s.waveRecoveryDelayMs||0} ms · full-sheet hold ${Math.round(s.waveRecoveryPauseMs||0)} ms\nSource merged ${Math.round((s.ownership?.sourceMerge||0)*100)}% · source released ${s.sourceReleasedAt??"retained"} · covered ${Boolean(s.ownership?.workspaceCovered)}\nNative proxy ${s.nativeProxyReady?"ready":s.nativeProxyLate?"late":s.nativeProxyFailure||s.nativeProxyState||"pending"} ${(s.nativeProxyMs||0).toFixed(1)} ms${s.nativeProxyCacheHit?" cached":""} · idle preparation ${(s.preparationMs||0).toFixed(1)} ms\nMax source submission ${(s.sourceAdvanceMs||0).toFixed(1)} ms · sheet submission ${(s.sheetDrawMs||0).toFixed(1)} ms\n${values().independentGrowth?"Independent-growth comparison":"Measured dispersal continuation"} · red displacement / blue velocity / green sheet field (enable diagnostics)`;
    }}
    output.value=`${Math.round((s.progress||0)*100)}% · ${s.phase||"Ready"} · ${s.formation?`fur color: ${Math.round((s.tint||0)*100)}% · flatten: ${Math.round((s.settlement||0)*100)}%`:"growth / baseline"} · material domain ${Math.round(s.materialArea||0)} px² · origin ${s.activation?.modality||"—"}${s.activation?.external?" (click-centered; workspace clipped)":""} · ${s.fps} FPS · max ${s.maxFrameMs.toFixed(1)} ms · ${s.longFrames} long frames · sheet init ${(peak.initializationMs||0).toFixed(1)} ms · ${peak.meshVertices||0} mesh vertices · ${peak.fiberInstances||0} fibers · GPU estimate ${((peak.gpuBytes||0)/1048576).toFixed(2)} MiB · live sheet: ${live.contexts||0} contexts / ${live.buffers||0} buffers / ${live.programs||0} programs / ${live.textures||0} textures / ${live.framebuffers||0} FBOs · ${s.layers} overlay · ${s.reusedSheets||0} interrupted renderer reuses · quality reduced ${Boolean(s.qualityReduced)} · last cancel ${s.lastCancellation||"none"}${s.sheetFailure?` · fallback: ${s.sheetFailure}`:""}`;
  }
  function turn(source,event,effect="sheet"){
    cancelBoundary();
    const live=DuckFur.get(document.querySelector("#sheet-inside"));if(live)live.options.inspectionFreeze=false;
    inspection=null;
    const settings=values();if(effect==="sheet" && settings.ribbon)effect="ribbon";settings.recoveryAgeAt=()=>{const v=values();return v.inspectRecovery?v.recoveryAge:null;};settings.registration=true;settings.formation=effect==="sheet" && !settings.growthOnly && !settings.legacyFade;DuckTransitions.configure({duration:settings.duration});
    DuckTransitions.workspace({root,source,event,effect,sheetOptions:settings,holdProgress:()=>{const v=values();return v.hold?v.inspectProgress:null;},update:()=>{
      if(settings.growthOnly)return;
      destination=!destination;root.classList.toggle("destination",destination);
      root.querySelector("h3").textContent=destination?"Your week, in focus":"Today’s study plan";
      root.querySelector(".section-kicker").textContent=destination?"Destination workspace":"Outgoing workspace";
    },complete:report});
    if(settings.contextLoss)requestAnimationFrame(()=>DuckTransitions.testSheetContextLoss());
  }
  const inside=document.querySelector("#sheet-inside");
  let preparationObserver;
  if("requestIdleCallback" in window && "IntersectionObserver" in window){
    preparationObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))requestIdleCallback(()=>{if(DuckTransitions.prepareWorkspace({root,source:inside}))preparationObserver.disconnect();},{timeout:1000});});
    preparationObserver.observe(root);
  }
  function centerSource(callback){
    cancelBoundary();DuckTransitions.cancel();inside.scrollIntoView({block:"center",behavior:"instant"});
    // Explicit inspection controls center the source before taking any measures.
    boundaryFrame=requestAnimationFrame(()=>{boundaryFrame=0;callback(DuckFur.get(inside));});
  }
  function inspectAt(progress=null){
    centerSource(surface=>{
      surface.options.inspectionFreeze=false;surface.resetFibers();surface.onKeyDown({key:" ",repeat:false});surface.onKeyUp({key:" "});
      if(progress===null){
        const impulse=surface.captureDispersalState(),rect=root.getBoundingClientRect(),b=inside.getBoundingClientRect(),origin={x:b.left+b.width/2-rect.left,y:b.top+b.height/2-rect.top};
        let lo=0,hi=.5;const edge=Math.min(...impulse.samples.map(v=>v.edge));
        for(let i=0;i<24;i++){const mid=(lo+hi)/2,m=DuckFurSheet.geometry(rect.width,rect.height,origin,{...values(),formation:true,impulse},mid);if(m.radius<edge)lo=mid;else hi=mid;}progress=hi;
      }
      form.elements.hold.checked=true;form.elements.inspectProgress.value=String(progress);turn(inside,null);
    });
  }
  document.querySelector("#sheet-press-hold").addEventListener("click",()=>centerSource(surface=>{
    surface.resetFibers();surface.onKeyDown({key:" ",repeat:false});surface.options.inspectionFreeze=true;
    inspection={stage:"Held press",impulse:surface.captureDispersalState({modality:"keyboard"})};report();
  }));
  document.querySelector("#sheet-press-release").addEventListener("click",()=>centerSource(surface=>{
    if(!surface.pressed){surface.resetFibers();surface.onKeyDown({key:" ",repeat:false});}
    surface.onKeyUp({key:" "});surface.options.inspectionFreeze=true;
    inspection={stage:"Just released",impulse:surface.captureDispersalState({modality:"keyboard"})};report();
  }));
  document.querySelector("#sheet-crossing").addEventListener("click",()=>inspectAt());
  document.querySelector("#sheet-new").addEventListener("click",e=>turn(e.currentTarget,e));
  document.querySelector("#sheet-inside").addEventListener("click",e=>turn(e.currentTarget,e));
  document.querySelector("#sheet-ribbon").addEventListener("click",e=>turn(e.currentTarget,e,"ribbon"));
  document.querySelectorAll("#sheet-frames button").forEach(button=>button.addEventListener("click",()=>inspectAt(Number(button.dataset.progress))));
  document.querySelector("#sheet-old").addEventListener("click",e=>turn(e.currentTarget,e,"radial"));
  document.querySelector("#sheet-stress").addEventListener("click",e=>{timers.forEach(clearTimeout);timers=[];const source=e.currentTarget;for(let i=0;i<4;i++)timers.push(setTimeout(()=>turn(source,null),i*130));});
  document.querySelector("#sheet-reset").addEventListener("click",()=>{timers.forEach(clearTimeout);timers=[];cancelBoundary();DuckTransitions.cancel();inspection=null;const surface=DuckFur.get(inside);surface.options.inspectionFreeze=false;surface.finishPress();form.reset();values();applyDelay();report();});
  function applyDelay(){const delay=Number(form.elements.responseDelay.value);for(const button of document.querySelectorAll("#sheet-lab button")){const surface=DuckFur.get(button);if(surface)surface.setParameters({recoveryDelay:delay});}}
  form.addEventListener("input",event=>{values();if(event.target.name==="responseDelay"){DuckTransitions.cancel();applyDelay();}if(event.target.name==="contextLoss" && event.target.checked)DuckTransitions.testSheetContextLoss();});values();applyDelay();setInterval(report,100);
  addEventListener("pagehide",()=>{cancelBoundary();preparationObserver?.disconnect();timers.forEach(clearTimeout);DuckTransitions.cancel();});
})();
