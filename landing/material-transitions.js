(() => {
  "use strict";
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const settings = { duration: 1000, fold: 0.55, reducedMotion: false, effect: "sheet" };
  const metrics = { frames: 0, longFrames: 0, maxFrameMs: 0, durationMs: 0, layers: 0, snapshotMs: 0, snapshotBytes: 0, cancelled: 0 };
  let active = null,prepared=null,preparedTimer;
  function clearPrepared(){if(preparedTimer!==undefined)clearTimeout(preparedTimer);prepared?.sheet.dispose();prepared=null;}
  function prepareWorkspace({root=document.querySelector(".workspace"),source,options={}}={}){
    if(active || prepared || reduced() || document.hidden || !root || !source || !window.DuckFurSheet)return false;
    const r=root.getBoundingClientRect(),width=Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left)),height=Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top));
    const surface=window.DuckFur?.get(source),impulse=surface?.captureDispersalState?.();if(!width||!height||!impulse)return false;
    try{
      const container=document.createElement("div"),start=performance.now();
      const sheet=new window.DuckFurSheet.FurSheet(container,{width,height,origin:{x:width/2,y:height/2},options:{...settings,...options,renderer:"sheet",formation:true,impulse,fiberLength:impulse.material.length??5.5,furDensity:impulse.material.density??1},onFailure:()=>{clearPrepared();cancel("prepared-context-lost");}});
      prepared={sheet};metrics.preparationMs=performance.now()-start;preparedTimer=setTimeout(clearPrepared,2000);return true;
    }catch(error){clearPrepared();metrics.preparationFailure=String(error.message);return false;}
  }

  const morphs = new Map();
  let activation = null;
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const ease = (t) => t*t*(3-2*t);
  const reduced = () => motion.matches || settings.reducedMotion;

  let activationSequence=0;
  const contacts=new WeakMap();
  function captureActivation(source,event={},previous=null) {
    event ||= {};
    const bounds=source?.getBoundingClientRect?.()||{left:0,top:0,width:0,height:0};
    const pointer=previous?.modality!=="keyboard" && (event.pointerType || event.type?.startsWith("pointer") || event.detail>0);
    const contact=previous?.modality!=="keyboard" && previous?.contact ? {...previous.contact} : pointer && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? {x:event.clientX,y:event.clientY} : previous?.modality!=="keyboard" && previous?.contact
      ? {...previous.contact} : {x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};
    return {id:previous?.id||++activationSequence,source,bounds:previous?.bounds||{left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height},
      contact,modality:pointer?(event.pointerType||"pointer"):(previous?.modality||(event.type==="keydown"||event.type==="click"?"keyboard":"programmatic")),
      contactAt:previous?.contactAt??performance.now(),timeline:{startedAt:performance.now(),duration:settings.duration}};
  }
  function mapActivation(record,rect) {
    // The radial center stays at the physical press, even outside this clip rect.
    // Boundary emergence is diagnostic only; never substitute it for the origin.
    return {contact:{...record.contact},origin:{x:record.contact.x-rect.left,y:record.contact.y-rect.top},emergence:{x:clamp(record.contact.x-rect.left,0,rect.width),y:clamp(record.contact.y-rect.top,0,rect.height)},
      external:record.contact.x<rect.left || record.contact.x>rect.left+rect.width || record.contact.y<rect.top || record.contact.y>rect.top+rect.height};
  }
  function origin(source,event,rect) {
    const record=activation && activation.source===source ? activation : captureActivation(source,event);
    return mapActivation(record,rect).origin;
  }

  function measure(root,layer){
    if(typeof getComputedStyle!=="function")return null;
    const box=node=>{if(!node)return null;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,position:s.position,heightStyle:s.height,minHeight:s.minHeight,overflow:s.overflow,transform:s.transform,scroll:[node.scrollLeft,node.scrollTop]};};
    const canvas=layer?.querySelector(".fur-sheet-canvas");
    return {viewport:[innerWidth,innerHeight],visual:window.visualViewport?[window.visualViewport.width,window.visualViewport.height,window.visualViewport.scale]:null,clientWidth:document.documentElement.clientWidth,scroll:[window.scrollX,window.scrollY],root:box(root),overlay:box(layer),canvas:box(canvas),backing:canvas?[canvas.width,canvas.height]:null,panels:[...root.querySelectorAll("[data-formation-surface],.panel")].slice(0,8).map(box)};
  }
  function snapshot(root) {
    const copy = root.cloneNode(true);
    // Snapshot is a decorative, inert tree: no duplicate identifiers or focus stops.
    for (const node of [copy,...copy.querySelectorAll("*")]) {
      node.removeAttribute("id"); node.removeAttribute("autofocus");
      if (node.matches("button,a,input,select,textarea,[tabindex]")) node.tabIndex = -1;
    }
    const oldCanvases = root.querySelectorAll("canvas");
    copy.querySelectorAll("canvas").forEach((canvas,index)=> {
      const source = oldCanvases[index];
      if (!source) return;
      window.DuckFur?.get(source.parentElement)?.draw();
      canvas.width=source.width; canvas.height=source.height;
      try { canvas.getContext("2d").drawImage(source,0,0); } catch { canvas.style.visibility="hidden"; }
      metrics.snapshotBytes += canvas.width*canvas.height*4;
    });
    const originals=[root,...root.querySelectorAll("*")];
    [copy,...copy.querySelectorAll("*")].forEach((node,index)=> {
      // Freeze the measured outgoing boxes, not a second set of responsive CSS rules.
      if(typeof getComputedStyle==="function" && originals[index]?.getClientRects().length){
        const style=getComputedStyle(originals[index]);
        for(const key of ["display","width","height","minWidth","minHeight","maxWidth","maxHeight","boxSizing","padding","margin","gap","gridTemplateColumns","gridTemplateRows","flexDirection","flexWrap","flexBasis","flexGrow","flexShrink"]){node.style[key]=style[key];}
        node.style.animation="none";node.style.transition="none";
      }
      // Scroll offsets are not copied by cloneNode.
      node.scrollTop=originals[index]?.scrollTop||0;
      node.scrollLeft=originals[index]?.scrollLeft||0;
    });
    copy.querySelectorAll("script,dialog,.material-transition-layer").forEach((node)=>node.remove());
    copy.inert=true; copy.setAttribute("aria-hidden","true");
    return copy;
  }

  function finishTimeline(timeline,radius,seconds){if(!timeline)return;timeline.progressAt=()=>1;timeline.radiusAt=()=>radius;timeline.impulseSecondsAt=()=>seconds;timeline.deformationAt=()=>0;}

  function cancel(reason="interrupted") {
    if (!active) return;
    const current=active; active=null;
    cancelAnimationFrame(current.frame);if(current.nativeTimer!==undefined)clearTimeout(current.nativeTimer);
    if(current.sheet){metrics.sheetPeak=current.sheet.getStats();current.sheet.dispose();}
    current.releaseResponse?.();current.recording?.finish();current.releaseSource?.();current.layer.remove(); metrics.layers=0;
    metrics.cancelled++;metrics.lastCancellation=reason;
    current.complete?.({cancelled:true,reason});
  }

  function workspace({root=document.querySelector(".workspace"),source=activation?.source,event=activation?.event,update,complete,effect=settings.effect,sheetOptions={},holdProgress=null}={}) {
    let reusable=(effect==="sheet" || effect==="ribbon") && active?.sheet?.canRetarget && active.effect===effect ? active.sheet : null;
    if(reusable)active.sheet=null;
    cancel();
    if(effect!=="sheet")clearPrepared();
    if(!reusable && effect==="sheet" && prepared){reusable=prepared.sheet;prepared=null;if(preparedTimer!==undefined)clearTimeout(preparedTimer);}
    if (!root || reduced() || document.hidden || !root.getClientRects().length) { reusable?.dispose(); update?.(); complete?.({cancelled:false}); return; }
    const before=measure(root,null);
    const rect=root.getBoundingClientRect();
    const drawer=document.querySelector(".sidebar-open .sidebar")?.getBoundingClientRect();
    const left=Math.max(0,rect.left,drawer?.right||0);
    const bounds={left,top:Math.max(0,rect.top),width:Math.max(0,Math.min(rect.right??rect.left+rect.width,innerWidth)-left),height:Math.max(0,Math.min(rect.bottom??rect.top+rect.height,innerHeight)-Math.max(0,rect.top))};
    if(!bounds.width || !bounds.height){reusable?.dispose();update?.();complete?.({cancelled:false});return;}
    const record=activation && activation.source===source ? activation : captureActivation(source,event);
    record.consumed=true;
    record.impulse ||= source && window.DuckFur?.get(source)?.captureDispersalState?.(record);
    const mapped=mapActivation(record,bounds),point=mapped.origin;
    let impulse=sheetOptions.independentGrowth?null:sheetOptions.legacyRecovery && record.impulse?{...record.impulse,responseVersion:1}:record.impulse;
    if(impulse){
      sheetOptions={...sheetOptions,impulse,sourceRect:{x:record.bounds.left-bounds.left,y:record.bounds.top-bounds.top,width:record.bounds.width,height:record.bounds.height},duration:settings.duration};
      try{const start=performance.now();sheetOptions.response=window.DuckFurResponse?.build(impulse);if(impulse.responseVersion===2 && !sheetOptions.response)throw Error("Shared spring response unavailable");metrics.responseBuildMs=performance.now()-start;metrics.responseFailure=null;}catch(error){metrics.responseFailure=String(error.message);impulse={...impulse,responseVersion:1};sheetOptions.impulse=impulse;sheetOptions.response=null;}
      if(Number.isFinite(impulse.material.length))sheetOptions.fiberLength=impulse.material.length;
      if(Number.isFinite(impulse.material.density))sheetOptions.furDensity=impulse.material.density;
    }
    metrics.sourceAdvanceMs=0;metrics.sheetDrawMs=0;metrics.nativeProxyState=window.DuckFormation?.captureNative?"waiting":"unavailable";metrics.nativeProxyReady=false;metrics.nativeProxyLate=false;metrics.nativeProxyFailure=null;metrics.nativeProxyMs=0;metrics.sourceReleasedAt=null;
    metrics.dispersal=impulse?{activationId:record.id,contactAt:record.contactAt,capturedAt:impulse.capturedAt,clickAt:record.activatedAt??performance.now(),samples:impulse.samples,pressRadius:impulse.pressRadius,responseMs:impulse.responseMs,releaseToPreparationMs:Math.max(0,performance.now()-impulse.capturedAt),sourceRect:sheetOptions.sourceRect}:null;
    metrics.activation={id:record.id,modality:record.modality,contact:record.contact,origin:point,emergence:mapped.emergence,external:mapped.external};
    metrics.snapshotBytes=0;
    const started=performance.now();
    const outgoingRecording=sheetOptions.record && window.DuckFurRecording?window.DuckFormation.capture(root,bounds,sheetOptions.surfaceSelector):null;
    let copy;
    try{copy=snapshot(root);}catch(error){reusable?.dispose();update?.();complete?.({cancelled:false,fallback:true});return;}
    const layer=document.createElement("div");
    layer.className="material-transition-layer"; layer.inert=true; layer.setAttribute("aria-hidden","true");
    Object.assign(layer.style,{left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
    copy.style.cssText+=`;position:absolute!important;left:${rect.left-bounds.left}px!important;top:${rect.top-bounds.top}px!important;width:${rect.width}px!important;height:${rect.height}px!important;margin:0!important;max-width:none!important;`;
    // Retain the outgoing layout's body-dependent CSS while the real app changes.
    const wrapper=document.createElement("div"); wrapper.className="material-outgoing";
    wrapper.dataset.view=document.body.dataset.view||"";
    wrapper.append(copy); layer.append(wrapper);
    const curved=document.createElement("div"); curved.className="material-outgoing material-curved";
    curved.dataset.view=wrapper.dataset.view;
    const curvedCopy=(effect==="sheet" || effect==="ribbon") ? document.createElement("div") : snapshot(root); curvedCopy.style.cssText=copy.style.cssText;
    curved.append(curvedCopy); layer.append(curved);
    const fold=document.createElement("div"); fold.className="material-fold-band"; layer.append(fold);
    const snapshotElapsed=performance.now()-started;
    let sheet=null;
    const renderer=effect==="ribbon"?window.DuckFurRibbon:window.DuckFurSheet;
    if((effect === "sheet" || effect==="ribbon") && renderer) {
      try {
        const options={...settings,...sheetOptions,renderer:effect};
        if(reusable?.canRetarget(bounds.width,bounds.height,options)){
          sheet=reusable;reusable=null;sheet.retarget(layer,point,options);metrics.reusedSheets=(metrics.reusedSheets||0)+1;
        }else{
          reusable?.dispose();reusable=null;
          sheet=new renderer.FurSheet(layer,{width:bounds.width,height:bounds.height,origin:point,options,onFailure:()=>cancel("sheet-context-lost")});
        }
        curved.style.display="none";fold.style.display="none";
        metrics.sheetPeak=sheet.getStats();metrics.sheetFailure=null;
      }catch(error){reusable?.dispose();sheet?.dispose();sheet=null;metrics.sheetFailure=String(error.message);}
    }
    document.body.append(layer);
    metrics.snapshotMs=snapshotElapsed;
    metrics.totalInitializationMs=performance.now()-started;
    metrics.layers=1; metrics.frames=0; metrics.longFrames=0; metrics.maxFrameMs=0; metrics.durationMs=0;
    metrics.qualityReduced=Boolean(sheet?.qualityReduced);
    const focus=document.activeElement;
    const surface=source && window.DuckFur?.get(source);
    let releaseSource=impulse?surface?.retainDispersal?.():null;
    const sourceCanvasBounds=surface?.canvas?.getBoundingClientRect?.();
    const originalCanvases=[...root.querySelectorAll("canvas")],sourceIndex=originalCanvases.indexOf(surface?.canvas);
    const sourceCopy=sourceIndex>=0?copy.querySelectorAll("canvas")[sourceIndex]:null;
    if(impulse && sheet?.setSource && !sheetOptions.previousIntegration && sourceCanvasBounds){
      sheet.setSource(sourceCopy||surface.canvas,{x:sourceCanvasBounds.left-bounds.left,y:sourceCanvasBounds.top-bounds.top,width:sourceCanvasBounds.width,height:sourceCanvasBounds.height});
    }
    if(sourceCopy && surface.canvas.parentElement){
      // Move the live decorative canvas into the inert outgoing button. Leave its
      // captured canvas in the real control for destination capture; no GPU readback per frame.
      const sourceParent=surface.canvas.parentElement,copyParent=sourceCopy.parentElement,release=releaseSource;
      sourceCopy.remove();sourceParent.append(sourceCopy);copyParent.append(surface.canvas);
      releaseSource=()=>{if(!surface.pendingDestroy && sourceParent.isConnected)sourceParent.append(surface.canvas);sourceCopy.remove();release?.();};
    }

    let formationSurface=null;
    try {
      update?.();
      if(sheet && sheetOptions.formation){
        if(!window.DuckFormation || !sheet.setDestination)throw Error("Formation capture unavailable");
        const surface=window.DuckFormation.capture(root,bounds,sheetOptions.surfaceSelector);formationSurface=surface;
        sheet.setDestination(surface);metrics.targets=surface.formation?.targets||[];metrics.contentRegions=surface.formation?.contents||[];
        metrics.registration={before,destination:measure(root,layer),frames:[]};
      }
    } catch(error) { releaseSource?.();sheet?.dispose();layer.remove(); metrics.layers=0;if(sheetOptions.formation){metrics.sheetFailure=String(error.message);complete?.({cancelled:false,fallback:true});return;}throw error; }
    if((effect === "sheet" || effect==="ribbon") && !sheet){releaseSource?.();layer.remove();metrics.layers=0;complete?.({cancelled:false,fallback:true});return;}
    const reach=Math.max(...[[0,0],[bounds.width,0],[0,bounds.height],[bounds.width,bounds.height]].map(([x,y])=>Math.hypot(x-point.x,y-point.y)))+45;
    const job={layer,frame:0,complete,sheet,effect,releaseSource,releaseResponse:()=>{sheetOptions.response=null;sheetOptions.arrival=null;finishTimeline(record.timeline,reach,(metrics.materialSeconds||0));}}; active=job;
    if(outgoingRecording)try{job.recording=new window.DuckFurRecording.Recorder(bounds,outgoingRecording,(blob,sequence)=>window.DuckFurRecording.show(blob,{baseline:Boolean(sheetOptions.previousIntegration||sheetOptions.legacyRecovery),sequence}));job.destinationRecording=formationSurface;}catch(error){metrics.recordingFailure=String(error.message);}
    // Keep physical age, but present measured growth from its contact-sized seed.
    // Setup or a stalled frame must not skip the opening expansion on screen.
    record.timeline.startedAt=record.activatedAt??started;record.timeline.duration=settings.duration;
    const contactGrowth=effect==="sheet" && impulse && !sheetOptions.previousIntegration;
    const recoveryDelay=contactGrowth?Math.max(0,Number(impulse.material.recoveryDelay)||0):0;
    // Let even the most distant region finish the same post-arrival hold before
    // whole-sheet formation flattens it. Coloring can proceed during this hold.
    const sharedResponse=Boolean(sheet?.options?.response),arrival=sheet?.options?.arrival;
    const lastArrival=sharedResponse?renderer.arrivalAt(arrival,reach-45)*1000:(reach-45)/Math.max(60,impulse?.material.waveSpeed||540)*1000;
    const recoveryPause=recoveryDelay?Math.max(0,(sharedResponse?lastArrival:Math.max(settings.duration*.5,lastArrival))+recoveryDelay-settings.duration*.7):0;
    metrics.waveRecoveryDelayMs=recoveryDelay;metrics.waveRecoveryPauseMs=recoveryPause;
    metrics.sharedResponse=sharedResponse;metrics.latestArrivalMs=lastArrival;
    let presentedMs=0;
    if(impulse && sheet?.options)sheet.options.impulseAge=Math.max(0,(record.timeline.startedAt-impulse.capturedAt)/1000);
    record.timeline.progressAt=time=>{const held=typeof holdProgress === "function"?holdProgress():holdProgress;const elapsed=contactGrowth?presentedMs:time-record.timeline.startedAt,settleAt=record.timeline.duration*.7;return held===null?clamp((elapsed-Math.min(recoveryPause,Math.max(0,elapsed-settleAt)))/record.timeline.duration,0,1):clamp(held,0,1);};
    record.timeline.impulseSecondsAt=time=>sharedResponse?presentedMs/1000:Math.max(0,(time-(impulse?.capturedAt??record.timeline.startedAt))/1000);
    record.timeline.deformationAt=time=>1-(window.DuckFurSheet?.formationState?.(record.timeline.progressAt(time)).flatten||0);
    record.timeline.radiusAt=time=>window.DuckFurSheet?.geometry(bounds.width,bounds.height,point,sheetOptions,record.timeline.progressAt(time)).radius||0;
    if(surface && !surface.waves?.some(w=>w.activationId===record.id))surface.emitWave(mapActivation(record,source.getBoundingClientRect()).origin,{timeline:record.timeline,activationId:record.id,impulse});
    let previous=null,lastProgress=null,lastMaterialSeconds=null;
    const debug=sheetOptions.debug && document.createElementNS ? document.createElementNS("http://www.w3.org/2000/svg","svg"):null;
    if(debug){debug.setAttribute("viewBox",`0 0 ${bounds.width} ${bounds.height}`);debug.style.cssText="position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none";layer.append(debug);}
    function diagnostics(model){
      if(!debug || effect!=="sheet")return;
      const paths=renderer.boundaries(model);
      const circle=(x,y,color,label,dy=-8)=>`<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="white"/><text x="${x+8}" y="${Math.max(14,y+dy)}" fill="${color}" stroke="white" stroke-width=".4" font-size="12">${label}</text>`;
      debug.innerHTML=`<path d="${paths.growth}" fill="none" stroke="#2563eb" stroke-dasharray="5 3"/><path d="${paths.crest}" fill="none" stroke="#be185d"/><path d="${paths.reveal}" fill="none" stroke="#059669" stroke-dasharray="3 3"/><path d="${paths.flatten||""}" fill="none" stroke="#ea580c" stroke-dasharray="6 3"/>`+circle(record.contact.x-bounds.left,record.contact.y-bounds.top,"#dc2626","Contact")+circle(point.x,point.y,"#7c3aed","Radial center",18)+(sheetOptions.formation?(metrics.targets||[]).slice(1).map(t=>`<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" rx="${t.radius}" fill="none" stroke="#0891b2" stroke-width="1"/>`).join(""):"")+`<rect x="1" y="1" width="${bounds.width-2}" height="${bounds.height-2}" fill="none" stroke="#a16207" stroke-dasharray="2 4"/>`+[[0,0],[bounds.width,0],[0,bounds.height],[bounds.width,bounds.height]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4" fill="#a16207"/>`).join("");
      if(impulse){
        const sr=sheetOptions.sourceRect;
        const contact={x:record.contact.x-bounds.left,y:record.contact.y-bounds.top};
        debug.innerHTML+=`<rect x="${sr.x}" y="${sr.y}" width="${sr.width}" height="${sr.height}" rx="${sr.height/2}" fill="none" stroke="#dc2626"/>`;
        for(const sample of impulse.samples){const a=sample.angle,c=Math.cos(a),s=Math.sin(a),x=contact.x+c*sample.radius,y=contact.y+s*sample.radius;
          const first=window.DuckDispersal.field(impulse,a,sample.edge,model.progress*settings.duration/1000);
          debug.innerHTML+=`<path d="M${x},${y}l${c*sample.radial-s*sample.tangential},${s*sample.radial+c*sample.tangential}" stroke="#dc2626"/><path d="M${x},${y}l${c*sample.velocity*.06},${s*sample.velocity*.06}" stroke="#2563eb"/><path d="M${point.x+c*sample.edge},${point.y+s*sample.edge}l${c*first.radial-s*first.tangential},${s*first.radial+c*first.tangential}" stroke="#059669"/>`;
        }
      }

    }
    function frame(time) {
      if(active!==job) return;
      time=Math.max(time,performance.now());
      const elapsed=time-record.timeline.startedAt;
      const interval=previous===null?0:time-previous; previous=time;
      const held=typeof holdProgress === "function" ? holdProgress() : holdProgress;
      if(held===null){metrics.frames++; metrics.maxFrameMs=Math.max(metrics.maxFrameMs,interval); if(interval>25) metrics.longFrames++;}
      if(contactGrowth && held===null)presentedMs+=Math.min(32,Math.max(0,interval));
      const progress=record.timeline.progressAt(time);
      if(sharedResponse){
        const inspectedAge=sheetOptions.recoveryAgeAt?.()??(sheetOptions.inspectRecovery?sheetOptions.recoveryAge:null);
        const seconds=held===null?presentedMs/1000:inspectedAge!==null?inspectedAge/1000:progress*record.timeline.duration/1000+(progress>.7?recoveryPause/1000:0);
        sheet.options.materialSeconds=seconds;sheet.options.sourceSeconds=seconds;metrics.materialSeconds=seconds;
      }
      if(contactGrowth && held===null && sheet?.options)sheet.options.impulseAge=Math.max(0,(time-impulse.capturedAt)/1000-progress*record.timeline.duration/1000);
      if(impulse && surface?.gl && releaseSource && (progress!==lastProgress || contactGrowth && held===null)){
        const sourceStart=performance.now();if(sharedResponse){let remaining=Math.min(.032,interval/1000);while(remaining>1e-7){const step=Math.min(1/240,remaining);surface.simulate(step);remaining-=step;}}else surface.advanceWaves(Math.min(.04,(interval||16)/1000));surface.draw();metrics.sourceAdvanceMs=Math.max(metrics.sourceAdvanceMs,performance.now()-sourceStart);
      }

      if(sheet && (progress!==lastProgress || contactGrowth && held===null || sharedResponse && sheet.options.materialSeconds!==lastMaterialSeconds)){
        try {
          const drawStart=performance.now(),model=sheet.draw(progress);metrics.sheetDrawMs=Math.max(metrics.sheetDrawMs,performance.now()-drawStart);lastProgress=progress;lastMaterialSeconds=sheet.options?.materialSeconds;
          if(metrics.dispersal && metrics.dispersal.firstFrameAt===undefined){metrics.dispersal.firstFrameAt=time;metrics.dispersal.pressToFirstFrameMs=time-record.contactAt;metrics.dispersal.clickToFirstFrameMs=time-record.timeline.startedAt;metrics.dispersal.firstRadius=model.radius;}
          if(!model){cancel("sheet-unavailable");return;}
          metrics.sheetPeak=sheet.getStats();
          wrapper.style.clipPath=sheetOptions.growthOnly?"none":renderer.revealPolygon(model);
          const own=renderer.ownership?.(model);
          const covered=sheetOptions.previousIntegration?progress>=.5:(own?.workspaceCovered??progress>=.5);
          wrapper.style.visibility=sheetOptions.formation && !sheetOptions.colorOnly && covered?"hidden":"visible";
          metrics.ownership=own||null;
          if(sharedResponse){
            const corners=[[0,0],[bounds.width,0],[0,bounds.height],[bounds.width,bounds.height]],far=corners.reduce((a,b)=>Math.hypot(b[0]-point.x,b[1]-point.y)>Math.hypot(a[0]-point.x,a[1]-point.y)?b:a),angle=Math.atan2(far[1]-point.y,far[0]-point.x),distance=Math.hypot(far[0]-point.x,far[1]-point.y);
            metrics.responseTraces=[.15,.5,.9].map((fraction,i)=>{const r=distance*fraction,f=renderer.disturbance(model,angle,r),p=renderer.sample(model,angle/Math.PI,2*r/model.reach-1);return {region:["Near","Middle","Far"][i],radius:r,arrivalMs:f.arrival*1000,remainingMs:f.remaining*1000,displacement:f.radial,velocity:f.velocity,compression:f.compression,depression:f.depression,orientation:Math.atan2(f.tangential||0,f.radial||.0001),height:p.z,flatten:model.settleProgress,arrived:f.arrived};});
          }else metrics.responseTraces=null;
          const sourceOwned=sheetOptions.previousIntegration?progress>=.5:(own?own.sourceCovered && own.sourceMerge>=1:progress>=.5);
          if(sourceOwned && releaseSource){releaseSource();releaseSource=null;job.releaseSource=null;metrics.sourceReleasedAt=progress;}
          if(!job.nativeStarted && formationSurface && window.DuckFormation?.captureNative && !sheetOptions.previousIntegration && (!contactGrowth || progress>=.12 || held!==null)){
            job.nativeStarted=true;metrics.nativeProxyState="scheduled";
            // Let the first physical frame paint before assembling its final native proxy.
            job.nativeTimer=setTimeout(()=>{
              if(active!==job)return;
              metrics.nativeProxyState="capturing";
              window.DuckFormation.captureNative(root,bounds,formationSurface.formation).then(canvas=>{
                if(active!==job)return;
                if(held===null && record.timeline.progressAt(performance.now())>=.5){metrics.nativeProxyLate=true;return;}
                sheet.setDestination(canvas);job.destinationRecording=canvas;metrics.nativeProxyMs=canvas.captureMs;metrics.nativeProxyCacheHit=canvas.cacheHit;metrics.nativeProxyReady=true;lastProgress=null;
              }).catch(error=>{if(active===job)metrics.nativeProxyFailure=String(error.message);});
            },0);
          }
          if(sheetOptions.formation && (held!==null || sheetOptions.registration) && metrics.registration){
            const frame={progress,settlement:model.settleProgress,layout:measure(root,layer),anchors:renderer.project?[[0,0],[bounds.width,0],[0,bounds.height],[bounds.width,bounds.height]].map(([x,y])=>({x,y,projected:renderer.project(model,{x,y,z:20.48*(1-model.settleProgress)})})):[]};
            metrics.registration.frames=metrics.registration.frames.filter(item=>Math.abs(item.progress-progress)>.001).slice(-15);metrics.registration.frames.push(frame);
          }
          job.recording?.frame(sheet.canvas,own?.workspaceCovered?job.destinationRecording:null,sheetOptions.debug?{contact:{x:record.contact.x-bounds.left,y:record.contact.y-bounds.top},origin:sheet.origin||point,radius:model.radius}:null);
          diagnostics(model);metrics.phase=model.phase;metrics.materialArea=model.coverageArea||0;metrics.progress=progress;metrics.formation=Boolean(sheetOptions.formation);metrics.settlement=model.settleProgress||0;metrics.tint=model.tintProgress||0;metrics.formedRadius=sheetOptions.formation?renderer.revealRadius(model):0;
          if(held===null && (sheetOptions.previousIntegration?interval>35 && metrics.longFrames>=2:interval>28 && metrics.longFrames>=6) && !job.reducedQuality){sheet.reduceQuality();sheet.draw(progress);job.reducedQuality=true;metrics.qualityReduced=true;}
        }catch(error){metrics.sheetFailure=String(error.message);cancel("sheet-render-error");return;}
      }else if(!sheet){
      const radius=ease(progress)*reach;
      const mask=`radial-gradient(circle at ${point.x}px ${point.y}px,transparent ${Math.max(0,radius-2)}px,#000 ${radius+1}px)`;
      wrapper.style.maskImage=mask; wrapper.style.webkitMaskImage=mask;
      const band=12+settings.fold*18;
      const curvedMask=`radial-gradient(circle at ${point.x}px ${point.y}px,transparent ${Math.max(0,radius-band)}px,#000 ${Math.max(0,radius-band+3)}px,#000 ${radius}px,transparent ${radius+3}px)`;
      curved.style.maskImage=curvedMask;curved.style.webkitMaskImage=curvedMask;
      curvedCopy.style.transformOrigin=`${point.x}px ${point.y}px`;
      curvedCopy.style.transform=`translateY(${-settings.fold*3}px) scale(${1+settings.fold*0.009})`;
      fold.style.background=`radial-gradient(circle at ${point.x}px ${point.y}px,transparent ${Math.max(0,radius-band)}px,rgba(103,76,23,${settings.fold*0.2}) ${Math.max(0,radius-7)}px,rgba(255,247,206,${settings.fold*0.85}) ${radius}px,rgba(255,255,255,${settings.fold*0.65}) ${radius+3}px,rgba(74,52,10,${settings.fold*0.16}) ${radius+9}px,transparent ${radius+band}px)`;
      fold.style.opacity=String(Math.min(1,progress*12,(1-progress)*12));
      // Restrained curvature confined to the moving band, never the sidebar.
      fold.style.filter=`blur(${settings.fold*0.7}px)`;
      }
      if(progress<1 || held!==null) job.frame=requestAnimationFrame(frame);
      else {
        if(sheet){metrics.sheetPeak=sheet.getStats();sheet.dispose();}
        if(job.nativeTimer!==undefined)clearTimeout(job.nativeTimer);job.recording?.frame(null,job.destinationRecording);job.recording?.finish();job.releaseSource?.();job.releaseResponse?.();metrics.durationMs=elapsed; layer.remove(); active=null; metrics.layers=0;
        if(focus && !focus.isConnected && !document.querySelector("dialog[open]")) {
          const heading=root.querySelector(".view.active h2,.view.active h1");
          if(heading) { heading.tabIndex=-1; heading.focus({preventScroll:true}); }
        }
        complete?.({cancelled:false});
      }
    }
    job.frame=requestAnimationFrame(frame);
  }

  function morph(host,label,parameters={}) {
    morphs.get(host)?.();
    const surface=window.DuckFur?.get(host);
    if(!surface) { host.textContent=label; return; }
    if(reduced()) { host.replaceChildren(surface.canvas,document.createTextNode(label)); surface.setParameters({...parameters,label}); return; }
    surface.draw();
    const canvas=document.createElement("canvas"); canvas.className="fur-morph-outgoing";
    canvas.width=surface.canvas.width; canvas.height=surface.canvas.height;
    canvas.getContext("2d").drawImage(surface.canvas,0,0);
    canvas.setAttribute("aria-hidden","true");
    const overscan=surface.overscan||0;
    canvas.style.cssText=`position:absolute;left:${-overscan}px;top:${-overscan}px;width:${surface.width+overscan*2}px;height:${surface.height+overscan*2}px;pointer-events:none;z-index:2;`;
    const savedOrigin=activation?.source===host ? origin(host,activation.event,host.getBoundingClientRect()):{x:surface.width/2,y:surface.height/2};
    host.textContent=label;
    // Restore the live renderer node removed by textContent; it owns the incoming strands.
    host.prepend(surface.canvas); surface.setParameters({...parameters,label}); host.append(canvas);
    surface.waves=[];surface.emitWave(savedOrigin);
    const started=performance.now(),reach=Math.hypot(surface.width,surface.height)+overscan*2;
    let handle;
    const cleanup=()=> { cancelAnimationFrame(handle); canvas.remove(); surface.canvas.style.maskImage="";surface.canvas.style.webkitMaskImage="";morphs.delete(host); };
    morphs.set(host,cleanup);
    function frame(time) {
      if(!host.isConnected) {cleanup();return;}
      const progress=clamp((time-started)/420,0,1),radius=ease(progress)*reach;
      const mask=`radial-gradient(circle at ${savedOrigin.x+overscan}px ${savedOrigin.y+overscan}px,transparent ${Math.max(0,radius-3)}px,#000 ${radius+2}px)`;
      canvas.style.maskImage=mask;canvas.style.webkitMaskImage=mask;
      const incoming=`radial-gradient(circle at ${savedOrigin.x+overscan}px ${savedOrigin.y+overscan}px,#000 ${Math.max(0,radius-2)}px,transparent ${radius+2}px)`;
      surface.canvas.style.maskImage=incoming;surface.canvas.style.webkitMaskImage=incoming;
      if(progress<1)handle=requestAnimationFrame(frame);else cleanup();
    }
    handle=requestAnimationFrame(frame);
  }

  document.addEventListener("pointerdown",event=>{
    const source=event.target.closest("button,a");if(!source || source.disabled)return;
    contacts.set(source,captureActivation(source,event));
  },true);
  document.addEventListener("keydown",event=>{
    if(!["Enter"," "].includes(event.key))return;const source=event.target.closest("button,a");
    if(source && !source.disabled)contacts.set(source,captureActivation(source,{type:"keydown"}));
  },true);
  document.addEventListener("pointercancel",event=>{const source=event.target.closest("button,a");if(source)contacts.delete(source);},true);
  document.addEventListener("click",event=> {
    const source=event.target.closest("button,a");
    if(!source || source.disabled) return;
    const previous=contacts.get(source);contacts.delete(source);
    activation=captureActivation(source,event,previous);
    activation.activatedAt=performance.now();
    activation.impulse=window.DuckFur?.get(source)?.captureDispersalState?.(activation);
    const record=activation;queueMicrotask(()=>{if(activation===record)activation=null;});
  },true);
  const interrupt=()=>{clearPrepared();cancel();for(const cleanup of [...morphs.values()])cleanup();};
  addEventListener("resize",interrupt);
  document.addEventListener("scroll",()=>cancel("scroll"),true);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)interrupt();});
  document.addEventListener("toggle",event=>{if(event.target.matches("dialog"))interrupt();},true);
  motion.addEventListener("change",interrupt);
  window.DuckTransitions={prepareWorkspace,measure,isActive:()=>metrics.layers>0,captureActivation,mapActivation,getContact:source=>contacts.get(source),getActivation:source=>activation?.source===source?activation:null,workspace,morph,cancel:interrupt,settings,metrics,reduced,testSheetContextLoss(){active?.sheet?.gl?.getExtension("WEBGL_lose_context")?.loseContext();},configure(values){Object.assign(settings,values);if(reduced())interrupt();},getStats(){return {...metrics,morphs:morphs.size,fps:metrics.durationMs?Math.round(Math.max(0,metrics.frames-1)*1000/metrics.durationMs):0,contexts:window.DuckFur?.getRendererStats().contexts||0,sheetResources:Object.fromEntries(["contexts","buffers","programs","textures","framebuffers"].map(key=>[key,(window.DuckFurSheet?.resources?.[key]||0)+(window.DuckFurRibbon?.resources?.[key]||0)]))};}};
})();
