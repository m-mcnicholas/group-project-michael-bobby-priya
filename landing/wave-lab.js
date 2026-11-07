(() => {
  const controls=document.querySelector("#wave-controls");
  const root=document.querySelector("#wave-workspace");
  const output=document.querySelector("#wave-metrics");
  const surfaces=[];
  const options={silhouette:true,quality:"medium",length:5.2,recoveryDelay:160};
  document.querySelectorAll("#wave-lab button").forEach(host=>surfaces.push(DuckFur.mount(host,{...options,label:host.textContent.trim()})));
  // Existing inspection and lettering comparisons retain their baseline behavior.
  DuckFur.get(document.querySelector("#fur-stage"))?.setParameters({waveEnabled:false});
  DuckFur.get(document.querySelector("#fur-demo-button"))?.setParameters({waveEnabled:false});
  function configure() {
    const values={};
    controls.querySelectorAll("input").forEach(input=> {
      values[input.name]=input.type==="checkbox"?input.checked:Number(input.value);
      const label=input.closest("label");if(label.querySelector("output"))label.querySelector("output").value=input.value;
    });
    surfaces.forEach(surface=>surface.setParameters(values));
    DuckTransitions.configure(values);
  }
  controls.addEventListener("input",configure);configure();
  let page="tasks",week=false,paused=false,rapidTimers=[];
  function report() {
    const stats=DuckTransitions.getStats();
    const gpuBytes=surfaces.reduce((sum,surface)=>sum+surface.getStats().gpuBytes,0);
    output.value=`${stats.fps} FPS · max frame ${stats.maxFrameMs.toFixed(1)} ms · ${stats.longFrames} frames >25 ms · capture ${stats.snapshotMs.toFixed(1)} ms · ${stats.layers} workspace layers · ${stats.morphs} morphs · ${stats.contexts} WebGL contexts · snapshot ${(stats.snapshotBytes/1048576).toFixed(2)} MiB · demo GPU ${(gpuBytes/1048576).toFixed(2)} MiB · cancelled ${stats.cancelled}`;
  }
  function show(source,event,next=page,toggle=false) {
    DuckTransitions.workspace({root,source,event,effect:"radial",update:()=> {
      page=next;if(toggle)week=!week;
      root.querySelector("h3").textContent=page==="tasks"?"Tasks":"Calendar";
      document.querySelector("#wave-calendar-content").innerHTML=week?'<div class="wave-demo-days">'+["M","T","W","T","F","S","S"].map(day=>`<span>${day}</span>`).join("")+'</div>':'<p>Today · Calculus practice · 3:30 PM</p>';
      DuckTransitions.morph(document.querySelector("#wave-calendar-mode"),week?"Show day":"Show week");
    },complete:report});
  }
  document.querySelectorAll("[data-wave-page]").forEach(button=>button.addEventListener("click",event=>show(button,event,button.dataset.wavePage)));
  document.querySelector("#wave-calendar-mode").addEventListener("click",event=>show(event.currentTarget,event,"calendar",true));
  document.querySelector("#wave-morph").addEventListener("click",event=> {
    paused=!paused;event.currentTarget.setAttribute("aria-pressed",String(paused));
    DuckTransitions.morph(event.currentTarget,paused?"Pause":"Start");
  });
  const clearTimers=()=> {rapidTimers.forEach(clearTimeout);rapidTimers=[];};
  document.querySelector("#wave-rapid").addEventListener("click",event=> {
    clearTimers();const source=event.currentTarget;
    for(let index=0;index<5;index++)rapidTimers.push(setTimeout(()=>show(source,null,index%2?"tasks":"calendar",true),index*90));
  });
  document.querySelector("#wave-reset").addEventListener("click",()=> {
    clearTimers();DuckTransitions.cancel();controls.reset();configure();
    surfaces.forEach(surface=>surface.resetFibers());paused=false;week=false;page="tasks";
    const host=document.querySelector("#wave-morph");host.setAttribute("aria-pressed","false");DuckTransitions.morph(host,"Start");
    DuckTransitions.morph(document.querySelector("#wave-calendar-mode"),"Show week");
    root.querySelector("h3").textContent="Tasks";document.querySelector("#wave-calendar-content").textContent="Today · Calculus practice · 3:30 PM";report();
  });
  addEventListener("pagehide",()=>{clearTimers();DuckTransitions.cancel();});
  setInterval(report,600);
})();
