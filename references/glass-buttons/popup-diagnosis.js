// Isolated diagnosis page only. Not imported by the normal planner.
(() => {
  'use strict';
  const params=new URLSearchParams(location.search),variant=params.get('case')||'baseline';
  const rules={
    'no-blur':'.task-modal::backdrop,.task-modal form,.task-modal .glass-button{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    'no-radius':'.popup-morph-surface{border-radius:24px!important}',
    'no-release':'.glass-button.interaction-released,.glass-button.interaction-released::after{animation:none!important;transition:none!important}',
    'no-motion':'.popup-morph-surface,.popup-morph-label{display:none!important}.task-modal form,.task-modal h2{opacity:1!important}.task-modal::backdrop{animation:none!important}'
  };
  if(rules[variant]){const style=document.createElement('style');style.textContent=rules[variant];document.head.append(style);}
  const round=x=>Math.round(x*100)/100,events=[],work=[],reports=[],observers=[],supported=PerformanceObserver.supportedEntryTypes||[];
  const callbacks=[];
  function measured(kind,fn,context,args,source){const start=performance.now();try{return fn.apply(context,args);}finally{const duration=performance.now()-start;if(duration>2){callbacks.push({kind,start,duration,source});if(callbacks.length>250)callbacks.shift();}}}
  const originalAdd=EventTarget.prototype.addEventListener,originalRemove=EventTarget.prototype.removeEventListener,wrapped=new WeakMap();
  EventTarget.prototype.addEventListener=function(type,listener,options){
    if(!listener||!['click','pointerdown','pointerup','keydown','keyup','cancel','close','resize'].includes(type))return originalAdd.call(this,type,listener,options);
    let byType=wrapped.get(listener);if(!byType){byType=new Map();wrapped.set(listener,byType);}const key=type+':'+(typeof options==='boolean'?options:!!options?.capture);
    if(!byType.has(key)){const source=new Error().stack?.split('\n')[2]?.trim();byType.set(key,function(event){return measured(type,typeof listener==='function'?listener:listener.handleEvent,typeof listener==='function'?this:listener,[event],source);});}
    return originalAdd.call(this,type,byType.get(key),options);
  };
  EventTarget.prototype.removeEventListener=function(type,listener,options){const key=type+':'+(typeof options==='boolean'?options:!!options?.capture);return originalRemove.call(this,type,wrapped.get(listener)?.get(key)||listener,options);};
  const originalRAF=window.requestAnimationFrame;
  window.requestAnimationFrame=function(callback){return originalRAF.call(window,function(timestamp){return measured('RAF',callback,this,[timestamp],callback.name||'anonymous');});};

  const output=document.createElement('output');output.id='deep-diagnosis';output.hidden=true;output.setAttribute('aria-hidden','true');document.body.append(output);
  const summarize=e=>({type:e.entryType,name:e.name,start:e.startTime,duration:e.duration,processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId,renderStart:e.renderStart,styleAndLayoutStart:e.styleAndLayoutStart,blockingDuration:e.blockingDuration,attribution:Array.from(e.attribution||[]).map(x=>({name:x.name,container:x.containerType})),scripts:Array.from(e.scripts||[]).map(x=>({url:x.sourceURL,fn:x.sourceFunctionName,invoker:x.invoker,type:x.invokerType,start:x.startTime,duration:x.duration,forcedStyleAndLayout:x.forcedStyleAndLayoutDuration}))});
  for(const type of ['longtask','long-animation-frame','event'])if(supported.includes(type)){
    const observer=new PerformanceObserver(list=>{work.push(...list.getEntries().map(summarize));if(work.length>200)work.splice(0,work.length-200);});
    observer.observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});observers.push(observer);
  }
  const attention=name=>{events.push({name,at:performance.now(),visibility:document.visibilityState});if(events.length>80)events.shift();};
  document.addEventListener('visibilitychange',()=>attention('visibility'));window.addEventListener('focus',()=>attention('focus'));window.addEventListener('blur',()=>attention('blur'));
  const modal=document.querySelector('#task-modal');let current=null,raf=0,reportTimer=0;
  const write=()=>{output.textContent=JSON.stringify({variant,supported,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,reports},null,2);};
  function begin(event){
    if(current)return;
    const source=event.target.closest('button');if(!source)return;
    const start=performance.now(),opening=!modal.open,frames=[];
    current={wall:new Date().toISOString(),start,eventAt:event.timeStamp,delay:round(start-event.timeStamp),trusted:event.isTrusted,input:event.type,source:source.id||source.className,opening,frames,phases:[],ready:document.readyState,fonts:document.fonts.status,visibility:document.visibilityState};
    let last=start;const tick=timestamp=>{const now=performance.now();const frame={at:round(now-start),timestamp:round(timestamp-start),gap:round(now-last),lateness:round(now-timestamp)};
      if(params.get('geometry')==='1'&&modal.dataset.popupStage==='shell'){
        const tiles=[...modal.querySelectorAll('.popup-morph-tile')].map(e=>e.getBoundingClientRect());
        if(tiles.length){const left=Math.min(...tiles.map(r=>r.left)),top=Math.min(...tiles.map(r=>r.top));frame.shell={left,top,width:Math.max(...tiles.map(r=>r.right))-left,height:Math.max(...tiles.map(r=>r.bottom))-top};}
      }
      frames.push(frame);last=now;if(current)raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
    attention('begin');
  }
  // Capture before the app's click listener; include dispatch/setup time.
  document.addEventListener('click',event=>{if(event.target.closest('#plan-selected-date,#cancel-task,#close-task-modal'))begin(event);},true);
  function finish(){
    if(!current)return;
    const record=current;current=null;cancelAnimationFrame(raf);record.end=performance.now();
    clearTimeout(reportTimer);reportTimer=setTimeout(()=>{
      for(const observer of observers)work.push(...observer.takeRecords().map(summarize));
      const end=record.end;record.duration=round(end-record.start);
      record.callbacks=callbacks.filter(e=>e.start<end&&e.start+e.duration>=record.start);
      record.work=work.filter(e=>e.start<end&&e.start+e.duration>=record.start);
      record.attention=events.filter(e=>e.at>=record.start-100&&e.at<=end+100);
      record.resources=performance.getEntriesByType('resource').filter(e=>e.startTime<=end&&e.responseEnd>=record.start).map(e=>e.name.split('/').pop());
      reports.push(record);write();
    },180);
  }
  const mutations=new MutationObserver(()=>{
    if(!current)return;
    const phase=modal.dataset.popupMotion||'rest';if(phase==='closing'&&variant==='no-inert')modal.inert=false;current.phases.push({phase,stage:modal.dataset.popupStage,prepared:modal.dataset.popupPrepared,width:modal.style.width,height:modal.style.height,at:round(performance.now()-current.start),focus:document.activeElement?.id,inert:modal.inert});
    if(phase==='rest')finish();
  });mutations.observe(modal,{attributes:true,attributeFilter:['data-popup-motion','data-popup-stage']});
  window.addEventListener('pagehide',()=>{observers.forEach(o=>o.disconnect());mutations.disconnect();cancelAnimationFrame(raf);clearTimeout(reportTimer);},{once:true});
  async function automatic(){
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    // Timer-driven activation isolates page work from repeated automation checks.
    await sleep(1500);
    if(params.get('idle')==='1'){
      begin({target:document.querySelector('#plan-selected-date'),timeStamp:performance.now(),isTrusted:false,type:'idle'});current.opening=null;current.idle=true;
      await sleep(2500);finish();await sleep(300);output.dataset.finished='true';write();return;
    }
    for(let i=0;i<4;i++){
      document.querySelector('#plan-selected-date').click();await sleep(750);
      document.querySelector('#cancel-task').click();await sleep(800);
    }
    output.dataset.finished='true';write();
  }
  write();if(params.get('auto')==='1')automatic();
})();

// Local held-frame inspection only; never loaded by the normal planner.
(() => {
  const value=new URLSearchParams(location.search).get('holdClosing');if(value===null)return;
  const fraction=Math.min(.999,Math.max(.001,Number(value))),modal=document.querySelector('#task-modal');let held=false;
  new MutationObserver(()=>{
    if(held||modal.dataset.popupMotion!=='closing'||modal.dataset.popupStage!=='shell')return;
    held=true;
    for(const animation of modal.getAnimations({subtree:true})){
      const duration=animation.effect?.getTiming().duration;
      if(duration===240){animation.pause();animation.currentTime=duration*fraction;}
    }
    modal.dataset.heldClosing=String(fraction);
  }).observe(modal,{attributes:true,attributeFilter:['data-popup-stage']});
})();
