(() => {
  "use strict";
  const TAU=Math.PI*2,COUNT=32,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  // Screen-space CSS pixels and seconds. No DOM/GPU ownership in this immutable handoff.
  function edgeDistance(point,bounds,angle){
    const radius=Math.min(bounds.radius??bounds.height/2,bounds.width/2,bounds.height/2);
    const inside=(x,y)=>{const dx=Math.max(Math.abs(x-bounds.width/2)-(bounds.width/2-radius),0),dy=Math.max(Math.abs(y-bounds.height/2)-(bounds.height/2-radius),0);return dx*dx+dy*dy<=radius*radius;};
    let lo=0,hi=Math.hypot(bounds.width,bounds.height);
    for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(inside(point.x+Math.cos(angle)*mid,point.y+Math.sin(angle)*mid))lo=mid;else hi=mid;}
    return lo;
  }
  function angular(impulse,angle){
    if(!impulse?.samples?.length)return {radial:0,tangential:0,velocity:0,tangentialVelocity:0,compression:0,depression:0,radius:0,edge:0};
    const n=impulse.samples.length,x=((angle/TAU)%1+1)%1*n,i=Math.floor(x),t=x-i,a=impulse.samples[i],b=impulse.samples[(i+1)%n],result={};
    for(const key of ["radial","tangential","velocity","tangentialVelocity","compression","depression","radius","edge"])result[key]=a[key]*(1-t)+b[key]*t;
    return result;
  }
  function evolve(position,velocity,age,hold=0){
    // Continue the initial splay, then retain it until recovery is allowed.
    const delay=Math.max(0,hold),push=.06,elapsed=Math.min(age,delay);
    const held=position+velocity*push*(1-Math.exp(-elapsed/push));
    if(age<delay)return held;
    const recovery=age-delay,v=velocity*Math.exp(-delay/push);
    return (held+(v+3*held)*recovery)*Math.exp(-3*recovery);
  }
  function field(impulse,angle,distance,seconds=0){
    const s=angular(impulse,angle),outside=Math.max(0,distance-s.radius),speed=Math.max(60,impulse?.material?.waveSpeed||540);
    const age=Math.max(0,seconds-outside/speed),attenuation=Math.exp(-outside/Math.max(1,(impulse?.pressRadius||1)*8));
    const hold=Math.max(0,Number(impulse?.material?.recoveryDelay)||0)/1000,recovery=Math.max(0,age-hold),damping=3,decay=Math.exp(-damping*recovery);
    // Critically damped continuation: f(0)=measured displacement, f'(0)=measured velocity.
    const held=s.radial+s.velocity*.06*(1-Math.exp(-hold/.06)),v=s.velocity*Math.exp(-hold/.06);
    return {...s,radial:evolve(s.radial,s.velocity,age,hold)*attenuation,tangential:evolve(s.tangential,s.tangentialVelocity,age,hold)*attenuation,compression:s.compression*decay*attenuation,depression:s.depression*decay*attenuation,
      velocity:(age<hold?s.velocity*Math.exp(-age/.06):(v-damping*(v+damping*held)*recovery)*decay)*attenuation};
  }
  function capture(surface,record={},now=performance.now()){
    if(!surface.state || !surface.roots)return null;
    const bounds=record.bounds||surface.host.getBoundingClientRect(),contact=record.contact||{x:bounds.left+surface.pointer.x,y:bounds.top+surface.pointer.y};
    const point={x:contact.x-bounds.left,y:contact.y-bounds.top},pressRadius=surface.interactionRadius(true),o=surface.options;
    const samples=Array.from({length:COUNT},(_,i)=>({angle:i*TAU/COUNT,radial:0,tangential:0,velocity:0,tangentialVelocity:0,compression:0,depression:0,radius:0,edge:edgeDistance(point,bounds,i*TAU/COUNT),weight:0,response:{state:[0,0,0,0],velocity:[0,0,0,0],target:[0,0,0,0],hold:0,variation:0,length:0}}));
    for(let i=0;i<surface.count;i++){
      const dx=surface.roots[i*2]*surface.width-point.x,dy=surface.roots[i*2+1]*surface.height-point.y,r=Math.hypot(dx,dy);
      if(r<pressRadius*.12 || r>pressRadius*.68)continue;
      const angle=(Math.atan2(dy,dx)+TAU)%TAU,sector=Math.round(angle/TAU*COUNT)%COUNT,s=samples[sector],k=i*4,seed=i*6;
      const c=clamp(surface.state[k+2],0,1),edge=surface.materialMask?.[i*3+1]||0,label=surface.materialMask?.[i*3]||0;
      const variation=(surface.rootSeeds?.[seed]??1)*(1-edge*.78)+edge*.78;
      const length=o.length*variation*(1+label*((o.labelLengthScale??1)-1))*(1+edge*.4),scale=length*1.62*(.68+.77*c);
      const radial=(surface.state[k]*dx+surface.state[k+1]*dy)/r,tangent=(-surface.state[k]*dy+surface.state[k+1]*dx)/r;
      const w=Math.max(.001,surface.constructor.pressProfileForHandoff?.(r/pressRadius,o)?.influence??1);
      s.radial+=radial*scale*w;s.tangential+=tangent*scale*w;
      s.velocity+=((surface.velocity[k]*dx+surface.velocity[k+1]*dy)/r*scale+radial*length*1.62*.77*surface.velocity[k+2])*w;
      s.tangentialVelocity+=((-surface.velocity[k]*dy+surface.velocity[k+1]*dx)/r*scale+tangent*length*1.62*.77*surface.velocity[k+2])*w;
      s.compression+=c*w;s.depression+=surface.state[k+3]*w;s.radius+=r*w;s.weight+=w;
      if(surface.pressTargets && surface.recoveryHold){
        const q=s.response,project=data=>[(data[k]*dx+data[k+1]*dy)/r,(-data[k]*dy+data[k+1]*dx)/r,data[k+2],data[k+3]];
        for(const [name,data] of [["state",surface.state],["velocity",surface.velocity],["target",surface.pressTargets]]){const value=project(data);for(let j=0;j<4;j++)q[name][j]+=value[j]*w;}
        q.hold+=surface.recoveryHold[i]*w;q.variation+=(surface.rootSeeds?.[seed+5]??.5)*w;q.length+=length*w;
      }
    }
    for(const s of samples)if(s.weight)for(const key of ["radial","tangential","velocity","tangentialVelocity","compression","depression","radius"])s[key]/=s.weight;
    const responseVersion=surface.pressTargets && surface.recoveryHold && window.DuckFurResponse?2:1;
    for(const s of samples){const q=s.response;if(s.weight){for(const name of ["state","velocity","target"])for(let j=0;j<4;j++)q[name][j]/=s.weight;for(const name of ["hold","variation","length"])q[name]/=s.weight;}
      // Effective normalized coordinates preserve the measured CSS projection
      // and its derivative despite correlations between strand length and bend.
      const scale=q.length*1.62*(.68+.77*q.state[2]),scaleVelocity=q.length*1.62*.77*q.velocity[2];
      if(responseVersion===2 && scale>1e-8){q.state[0]=s.radial/scale;q.state[1]=s.tangential/scale;q.velocity[0]=(s.velocity-q.state[0]*scaleVelocity)/scale;q.velocity[1]=(s.tangentialVelocity-q.state[1]*scaleVelocity)/scale;}
      for(const name of ["state","velocity","target"])Object.freeze(q[name]);Object.freeze(q);
    }
    // Empty sectors retain zero energy; never manufacture a perimeter kick.
    const material=Object.freeze(Object.fromEntries(["stiffness","damping","length","density","splay","compression","pressDepth","transitionWidth","waveSpeed","recoveryDelay","labelLengthScale","labelWidthScale"].map(key=>[key,o[key]])));
    return Object.freeze({responseVersion,activationId:record.id??null,modality:record.modality||"pointer",contact:Object.freeze({...contact}),bounds:Object.freeze({...bounds}),contactAt:record.contactAt??surface.pressStartedAt??now,responseMs:surface.pressResponseMs??null,capturedAt:now,pressRadius,material,samples:Object.freeze(samples.map(s=>Object.freeze(s)))});
  }
  window.DuckDispersal={COUNT,edgeDistance,angular,evolve,field,capture};
})();
