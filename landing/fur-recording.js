(() => {
  "use strict";
  const previousURLs=new Map(),shownSequences=new Map();let recordingSequence=0;
  class Recorder {
    constructor(bounds,outgoing,onResult,{maxDurationMs=12000}={}){
      this.sequence=++recordingSequence;
      this.canvas=document.createElement("canvas");this.canvas.width=Math.round(bounds.width);this.canvas.height=Math.round(bounds.height);
      this.ctx=this.canvas.getContext("2d");this.outgoing=outgoing;this.chunks=[];this.bytes=0;this.onResult=onResult;
      const mime=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(v=>MediaRecorder.isTypeSupported(v));
      this.stream=this.canvas.captureStream(30);
      try{this.recorder=new MediaRecorder(this.stream,mime?{mimeType:mime,videoBitsPerSecond:4000000}:{});}
      catch(error){this.stream.getTracks().forEach(t=>t.stop());this.canvas.width=this.canvas.height=0;this.outgoing=null;throw error;}
      this.recorder.ondataavailable=event=>{if(event.data.size){this.chunks.push(event.data);this.bytes+=event.data.size;if(this.bytes>24000000)this.finish();}};
      this.recorder.onstop=()=>{const blob=new Blob(this.chunks,{type:this.recorder.mimeType});this.chunks=[];this.stream.getTracks().forEach(t=>t.stop());this.onResult?.(blob,this.sequence);this.canvas.width=this.canvas.height=0;this.outgoing=null;};
      this.recorder.start(100);this.timeout=setTimeout(()=>this.finish(),Math.min(20000,Math.max(1000,maxDurationMs)));
    }
    frame(sheet,underlay,diagnostic){if(this.done)return;const {ctx,canvas}=this;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(underlay||this.outgoing,0,0,canvas.width,canvas.height);if(sheet)ctx.drawImage(sheet,0,0,canvas.width,canvas.height);
      if(diagnostic){
        const {contact,origin}=diagnostic;ctx.save();ctx.lineWidth=2;
        ctx.strokeStyle="#dc2626";ctx.beginPath();ctx.moveTo(contact.x-7,contact.y);ctx.lineTo(contact.x+7,contact.y);ctx.moveTo(contact.x,contact.y-7);ctx.lineTo(contact.x,contact.y+7);ctx.stroke();
        ctx.strokeStyle="#2563eb";ctx.beginPath();ctx.arc(origin.x,origin.y,11,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle="rgba(255,255,255,.95)";ctx.fillRect(8,canvas.height-48,Math.min(canvas.width-16,580),40);ctx.fillStyle="#201b10";ctx.font="13px monospace";
        ctx.fillText(`Red +: press (${contact.x.toFixed(1)}, ${contact.y.toFixed(1)}) / blue O: renderer origin`,14,canvas.height-32);
        ctx.fillText(`Origin (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)}) | distance ${Math.hypot(origin.x-contact.x,origin.y-contact.y).toFixed(2)} px${Number.isFinite(diagnostic.radius)?` | radius ${diagnostic.radius.toFixed(1)} px`:""}`,14,canvas.height-16);ctx.restore();
      }
    }
    finish(){if(this.done)return;this.done=true;clearTimeout(this.timeout);if(this.recorder.state!=="inactive")this.recorder.stop();else this.stream.getTracks().forEach(t=>t.stop());}
  }
  function show(blob,{baseline=false,sequence=0}={}){
    const key=baseline?"baseline":"current";if(sequence<(shownSequences.get(key)||0))return;shownSequences.set(key,sequence);if(previousURLs.has(key))URL.revokeObjectURL(previousURLs.get(key));const url=URL.createObjectURL(blob);previousURLs.set(key,url);
    const video=document.querySelector(baseline?"#sheet-video-baseline":"#sheet-video"),link=document.querySelector(baseline?"#sheet-baseline-download":"#sheet-video-download");
    if(video){video.src=url;video.hidden=false;}if(link){link.href=url;link.download=baseline?"duckplan-baseline.webm":"duckplan-refined.webm";link.hidden=false;link.textContent=`Save ${baseline?"baseline":"refined"} recording (${Math.round(blob.size/1024)} KiB)`;}
  }
  addEventListener("pagehide",()=>{for(const url of previousURLs.values())URL.revokeObjectURL(url);});
  window.DuckFurRecording={Recorder,show};
})();
