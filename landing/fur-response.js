(() => {
  'use strict';
  const STEP=1/120,DT=1/240,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // A small directional response atlas, integrated with the approved button's
  // exact held-target/spring update. No new per-fiber browser simulation.
  function build(impulse){
    if(impulse?.responseVersion!==2)return null;
    const hold=Math.max(0,Number(impulse.material.recoveryDelay)||0)/1000;
    const width=Math.min(1024,Math.ceil((hold+3)/STEP)+1),rows=64,size=width*rows*4;
    const state=new Float32Array(size),velocity=new Float32Array(size),target=new Float32Array(size);
    const stiffness=impulse.material.stiffness??62,damping=impulse.material.damping??22;
    for(let row=0;row<rows;row++){
      const sample=impulse.samples[row%32],c=sample.response;
      const x=new Float32Array(c?.state||[0,0,0,0]),v=new Float32Array(c?.velocity||[0,0,0,0]),goal=new Float32Array(c?.target||[0,0,0,0]);
      let remaining=Math.fround(row<32?(c?.hold||0):hold);
      const variation=c?.variation??.5,rates=[4.6+variation*1.8,4.6+variation*1.8,3.8+variation*1.4,3.25+variation*1.1],retention=rates.map(rate=>Math.exp(-DT*rate));
      const save=i=>{const k=(row*width+i)*4;state.set(x,k);velocity.set(v,k);target.set(goal,k);};save(0);
      for(let i=1;i<width;i++){
        for(let sub=0;sub<2;sub++){
          if(remaining>0)remaining=Math.fround(Math.max(0,remaining-DT));
          else for(let c=0;c<4;c++){goal[c]*=retention[c];if(Math.abs(goal[c])<.001)goal[c]=0;}
          for(let c=0;c<4;c++){
            const k=stiffness*(c===3?.82:1),a=k*(goal[c]-x[c])-damping*v[c];
            v[c]=clamp(v[c]+a*DT,-18,18);x[c]=clamp(x[c]+v[c]*DT,c<2?-1.35:-.08,c<2?1.35:1);
            if(remaining===0 && Math.abs(goal[c])<=.0015 && Math.abs(x[c])<=.0015 && Math.abs(v[c])<=.002)goal[c]=x[c]=v[c]=0;
          }
        }save(i);
      }
    }
    return {width,rows,step:STEP,duration:(width-1)*STEP,state,velocity,target,impulse,bytes:state.byteLength+velocity.byteLength+target.byteLength};
  }
  function sample(atlas,angle,seconds,source=false){
    const sector=((angle/(2*Math.PI))%1+1)%1*32,a=Math.floor(sector),b=(a+1)%32,f=sector-a;
    const time=clamp(seconds/atlas.step,0,atlas.width-1),lo=Math.floor(time),hi=Math.min(atlas.width-1,lo+1),t=time-lo;
    const read=data=>Array.from({length:4},(_,c)=>{
      const row=source?0:32,k=(a+row)*atlas.width*4+c,j=(b+row)*atlas.width*4+c;
      return (data[k+lo*4]*(1-t)+data[k+hi*4]*t)*(1-f)+(data[j+lo*4]*(1-t)+data[j+hi*4]*t)*f;
    });
    return {state:read(atlas.state),velocity:read(atlas.velocity),target:read(atlas.target)};
  }
  function field(atlas,angle,r,{arrival,elapsed,sourceAge,sourceWeight=0}){
    const zero={radial:0,tangential:0,compression:0,depression:0,velocity:0,tangentialVelocity:0,arrival,remaining:0,arrived:false};
    if(elapsed+1e-7<arrival)return zero;
    const age=Math.max(0,elapsed-arrival),wave=sample(atlas,angle,age,false),source=sourceWeight>0?sample(atlas,angle,sourceAge,true):wave;
    const s=wave.state.map((v,i)=>v*(1-sourceWeight)+source.state[i]*sourceWeight),v=wave.velocity.map((x,i)=>x*(1-sourceWeight)+source.velocity[i]*sourceWeight);
    const sector=((angle/(2*Math.PI))%1+1)%1*32,i=Math.floor(sector),f=sector-i,a=atlas.impulse.samples[i],b=atlas.impulse.samples[(i+1)%32];
    const length=(a.response.length*(1-f)+b.response.length*f)||atlas.impulse.material.length;
    const attenuation=Math.exp(-Math.max(0,r-(a.radius*(1-f)+b.radius*f))/Math.max(1,atlas.impulse.pressRadius*8));
    const scale=length*1.62*(.68+.77*s[2]),scaleV=length*1.62*.77*v[2];
    const hold=atlas.impulse.material.recoveryDelay/1000,sourceHold=(a.response.hold*(1-f)+b.response.hold*f),remaining=Math.max(0,hold-age)*(1-sourceWeight)+Math.max(0,sourceHold-sourceAge)*sourceWeight;
    return {radial:s[0]*scale*attenuation,tangential:s[1]*scale*attenuation,compression:s[2]*attenuation,depression:s[3]*attenuation,
      velocity:(v[0]*scale+s[0]*scaleV)*attenuation,tangentialVelocity:(v[1]*scale+s[1]*scaleV)*attenuation,
      arrival,remaining,arrived:true,state:s,target:wave.target,normalizedVelocity:v};
  }
  window.DuckFurResponse={build,sample,field,STEP,DT};
})();
