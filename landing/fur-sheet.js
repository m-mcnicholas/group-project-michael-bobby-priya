(() => {
  "use strict";
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(x)=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
  const soft=(x)=>{const t=clamp(x,0,1);return t>=1-1e-12?1:t*t*t*(t*(t*6-15)+10);};
  const defaults={growthSpeed:1,thickness:5,elevation:64,curvature:0.72,furDensity:1,fiberLength:5.5,sheetWidth:110,lighting:0.8,formation:false};
  const pileCache=new Map(); // Bounded CPU-only tiles; never retain a GPU context.
  const resources={contexts:0,buffers:0,programs:0,textures:0,framebuffers:0};

  // The domain is fixed in material space: angle v in [-1,1], radius q in [-1,1].
  // Growth activates roots; it never stretches or redistributes existing roots.
  function formationState(progress){return {tint:soft((progress-.5)/.2),flatten:soft((progress-.7)/.28)};}
  function radialCurve(reach,settings){
    const impulse=settings.impulse,end=settings.formation?.5:.88;
    if(!impulse)return p=>reach*Math.pow((settings.formation?soft:smooth)(Math.min(1,p/end)),1/settings.growthSpeed);
    const mean=key=>impulse.samples.reduce((sum,s)=>sum+s[key],0)/impulse.samples.length;
    const seed=settings.previousIntegration?mean("radius"):0,duration=(settings.duration||1000)/1000*end;
    const speed=Math.min((reach-seed)*2/duration,Math.max(60,(impulse.material.waveSpeed||540)+mean("velocity")));
    return p=>{const t=Math.min(1,p/end);
      return settings.previousIntegration?(2*t*t*t-3*t*t+1)*seed+(-2*t*t*t+3*t*t)*reach+(t*t*t-2*t*t+t)*duration*speed:seed+(reach-seed)*soft(t)+(t-6*t**3+8*t**4-3*t**5)*duration*speed;
    };
  }
  function geometry(width,height,origin,options={},progress=0) {
    const settings={...defaults,...options},p=clamp(progress,0,1);
    const reach=Math.max(...[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>Math.hypot(x-origin.x,y-origin.y)))+settings.sheetWidth+8;
    // One radius curve owns both presented growth and local arrival inversion.
    const impulse=settings.impulse,radius=radialCurve(reach,settings)(p),mean=key=>impulse?impulse.samples.reduce((sum,s)=>sum+s[key],0)/impulse.samples.length:0;
    const state=formationState(p),settleProgress=settings.formation?state.flatten:0,tintProgress=settings.formation?state.tint:0;
    const band=Math.min(settings.sheetWidth,radius*.55);
    const amplitude=(impulse?(.15+clamp((mean("compression")+Math.abs(mean("velocity"))/100),0,.7))*(1-smooth(p/.2))+smooth(p/.2):smooth(p/.18))*(settings.formation?1:(1-smooth((p-.88)/.12)));
    return {width,height,origin,settings,materialSeconds:settings.materialSeconds??p*(settings.duration||1000)/1000,sourceSeconds:settings.sourceSeconds??p*(settings.duration||1000)/1000,impulseSeconds:(settings.impulseAge||0)+p*(settings.duration||1000)/1000,progress:p,reach,radius,settleProgress,tintProgress,band,amplitude,phase:settings.formation?(p<.5?"Grow / roll":p<.7?"Fur takes UI colors":"Colored fur settles into UI"):"Growth / baseline",
      opacity:settings.formation?1:1-smooth((p-.92)/.08),coverageArea:Math.PI*radius*radius};
  }
  function arrivalMap(width,height,origin,options,count=256){
    const end=options.formation?.5:.88,model=geometry(width,height,origin,options,end),curve=radialCurve(model.reach,model.settings),data=new Float32Array(count*4);
    for(let i=1;i<count;i++){
      const r=i/(count-1)*model.reach;let lo=0,hi=end;
      for(let n=0;n<24;n++){const p=(lo+hi)/2;if(curve(p)<r)lo=p;else hi=p;}
      data[i*4]=hi*(options.duration||1000)/1000;
    }
    return {data,count,reach:model.reach};
  }
  function arrivalAt(map,r){const x=clamp(r/map.reach,0,1)*(map.count-1),i=Math.floor(x),j=Math.min(i+1,map.count-1),t=x-i;return map.data[i*4]*(1-t)+map.data[j*4]*t;}
  function disturbance(model,angle,r){
    const s=model.settings;
    if(s.response && s.arrival){
      const edge=window.DuckDispersal.angular(s.impulse,angle).edge;
      return window.DuckFurResponse.field(s.response,angle,r,{arrival:arrivalAt(s.arrival,r),elapsed:r>model.radius?-1:model.materialSeconds,sourceAge:model.sourceSeconds,sourceWeight:1-smooth((r-edge+4)/10)});
    }
    return s.impulse?window.DuckDispersal.field(s.impulse,angle,r,model.impulseSeconds):null;
  }
  function ownership(model){
    const {origin,settings:s}=model;
    const grounded=Math.max(0,model.radius-model.band-2);
    const far=Math.max(...[[0,0],[model.width,0],[0,model.height],[model.width,model.height]].map(([x,y])=>Math.hypot(x-origin.x,y-origin.y)));
    const box=s.sourceRect;
    let sourceFar=0;
    if(box && box.x<model.width && box.y<model.height && box.x+box.width>0 && box.y+box.height>0){
      const x0=clamp(box.x-18,0,model.width),y0=clamp(box.y-18,0,model.height),x1=clamp(box.x+box.width+18,0,model.width),y1=clamp(box.y+box.height+18,0,model.height);
      sourceFar=Math.max(...[[x0,y0],[x1,y0],[x0,y1],[x1,y1]].map(([x,y])=>Math.hypot(x-origin.x,y-origin.y)));
    }
    const near=s.impulse?Math.min(...s.impulse.samples.map(v=>v.edge))*.4:0;
    const sourceMerge=s.impulse?soft((grounded-near)/Math.max(1,sourceFar+(s.impulse.pressRadius||0)*.5-near)):1;
    return {grounded,sourceFar,sourceMerge,sourceCovered:!sourceFar || grounded>=sourceFar+2,workspaceCovered:grounded>=far,fullyFormed:model.settleProgress>=1};
  }
  function flattenAmount(model,r) {
    return model.settings.formation?model.settleProgress:0;
  }
  function settlement(model,r){const flat=flattenAmount(model,r);return {flat,heightScale:(1-flat)**2,thicknessScale:1-flat,appearance:model.tintProgress||0,formed:flat>=1};}
  function profile(model,r) {
    const {settings:s,radius,band,amplitude}=model;
    const t=clamp((r-radius+band)/Math.max(.001,band),0,1);
    const crestHeight=Math.min(s.elevation,radius*.38)*amplitude;
    const curl=crestHeight*.6*s.curvature;
    const inCrest=r>=radius-band && r<=radius;
    const tuft=(s.impulse?0:1)*radius*.18*(1-smooth(model.progress/.18));
    const tuftShape=Math.max(0,1-r*r/Math.max(.001,radius*radius));
    const flat=flattenAmount(model,r);
    const lift=s.formation?Math.min(s.elevation*.32,radius*.15)*amplitude:0;
    const shoulder=lift*(1-flat)*(r<radius-band?1:1-smooth(t));
    return {u:r+(inCrest?curl*Math.sin(2*Math.PI*t)*(1-flat):0),
      z:(inCrest?crestHeight*Math.sin(Math.PI*t)**2*(1-flat):0)+shoulder+tuft*tuftShape*tuftShape*(1-flat)};
  }
  function sample(model,v,q,layer=0) {
    const angle=v*Math.PI,r=(q+1)*.5*model.reach;
    const impulse=model.settings.impulse,field=disturbance(model,angle,r);
    const seamProfile=radius=>{const p=profile(model,radius);if(!impulse)return p;const edge=window.DuckDispersal.angular(impulse,angle).edge,w=smooth((radius-edge)/Math.max(12,impulse.pressRadius*.8))+(1-smooth((radius-edge)/Math.max(12,impulse.pressRadius*.8)))*(model.settings.previousIntegration?0:ownership(model).sourceMerge);return {u:radius+(p.u-radius)*w,z:p.z*w};};
    const center=seamProfile(r),delta=.05;
    const lo=seamProfile(Math.max(0,r-delta)),hi=seamProfile(r+delta);
    const du=hi.u-lo.u,dz=hi.z-lo.z,len=Math.hypot(du,dz)||1;
    const thicknessScale=1-flattenAmount(model,r);
    const nx=Math.cos(angle),ny=Math.sin(angle),normal={x:-nx*dz/len,y:-ny*dz/len,z:du/len};
    const fade=(model.settings.previousIntegration?1-smooth(model.progress/.5):1)*(1-model.settleProgress),pin=smooth(r/Math.max(1,(impulse?.pressRadius||0)*.12));
    const dx=field?(nx*field.radial-ny*field.tangential)*fade*pin:0,dy=field?(ny*field.radial+nx*field.tangential)*fade*pin:0;
    return {x:model.origin.x+nx*center.u+dx-normal.x*layer*model.settings.thickness*thicknessScale* Math.min(1,model.radius/20),
      y:model.origin.y+ny*center.u+dy-normal.y*layer*model.settings.thickness*thicknessScale*Math.min(1,model.radius/20),
      z:Math.max(0,center.z-(field?.depression||0)*model.settings.fiberLength*fade)-normal.z*layer*model.settings.thickness*thicknessScale*Math.min(1,model.radius/20),normal,r,visible:r<=model.radius && model.radius>0 && flattenAmount(model,r)<1};
  }
  function project(model,p){const lift=model.settings.formation && !model.settings.colorOnly?p.z*smooth((p.z-model.settings.elevation*.34)/Math.max(1,model.settings.elevation*.4)):p.z;const scale=1800/(1800-lift);return {x:model.origin.x+(p.x-model.origin.x)*scale,y:model.origin.y+(p.y-model.origin.y)*scale-lift*.65};}
  function contour(model,r,projected=false){return Array.from({length:129},(_,i)=>{
    const p=sample(model,i/64-1,2*r/model.reach-1);return projected?project(model,p):p;
  });}
  function revealRadius(model){return Math.max(0,model.settings.formation?(model.settleProgress>=1?model.reach:0):model.radius-model.band);}
  function revealPolygon(model) {
    // An even-odd polygon cuts a hole behind the grounded inner foot of the roll.
    const ring=contour(model,revealRadius(model));
    const outer=[{x:0,y:0},{x:model.width,y:0},{x:model.width,y:model.height},{x:0,y:model.height},{x:0,y:0}];
    return `polygon(evenodd,${[...outer,...ring,ring[0],outer[0]].map(p=>`${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})`;
  }
  function boundaries(model){const path=points=>points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+'Z';
    return {growth:path(contour(model,model.radius)),crest:path(contour(model,model.radius-model.band*.5,true)),flatten:path(contour(model,Math.max(0,model.settings.formation?0:model.radius-model.band),true)),reveal:path(contour(model,revealRadius(model)))};
  }
  const common=`
    precision highp float;
    uniform vec2 u_size,u_origin;
    uniform float u_progress,u_reach,u_radius,u_settleProgress,u_tintProgress,u_band,u_opacity,u_bodyFloor,u_amplitude,u_formation;
    uniform float u_width,u_elevation,u_curvature,u_thickness,u_lighting,u_length,u_hasField,u_colorOnly;
    uniform sampler2D u_targets;
    uniform float u_hasImpulse,u_impulseSeconds,u_pressRadius,u_waveSpeed,u_sourceMerge,u_previousIntegration,u_recoveryDelay;
    uniform sampler2D u_response,u_arrival;
    uniform float u_curve;
    ${window.DuckFur?.materialShaders?.curve||""}
    uniform float u_hasResponse,u_responseWidth,u_responseStep,u_materialSeconds,u_sourceSeconds,u_arrivalCount;
    uniform float u_responseLengths[32];
    vec4 responseAt(float sector,float seconds,float row){
      int a=int(floor(sector)),b=(a+1)%32;float f=fract(sector),time=clamp(seconds/u_responseStep,0.0,u_responseWidth-1.0);
      int lo=int(floor(time)),hi=min(lo+1,int(u_responseWidth)-1);float t=fract(time);
      return mix(mix(texelFetch(u_response,ivec2(lo,a+int(row)),0),texelFetch(u_response,ivec2(hi,a+int(row)),0),t),mix(texelFetch(u_response,ivec2(lo,b+int(row)),0),texelFetch(u_response,ivec2(hi,b+int(row)),0),t),f);
    }
    float arrivalAt(float r){
      float x=clamp(r/u_reach,0.0,1.0)*(u_arrivalCount-1.0);int a=int(floor(x)),b=min(a+1,int(u_arrivalCount)-1);
      return mix(texelFetch(u_arrival,ivec2(a,0),0).r,texelFetch(u_arrival,ivec2(b,0),0).r,fract(x));
    }
    vec2 heldMotion(vec2 position,vec2 velocity,float age){
      float elapsed=min(age,u_recoveryDelay),push=0.06;
      vec2 held=position+velocity*push*(1.0-exp(-elapsed/push));
      if(age<u_recoveryDelay)return held;
      float recovery=age-u_recoveryDelay;vec2 v=velocity*exp(-u_recoveryDelay/push);
      return (held+(v+3.0*held)*recovery)*exp(-3.0*recovery);
    }
    uniform vec4 u_impulse[32],u_motion[32],u_sourceRect;
    vec4 impulseAt(float angle,float r){
      float sector=mod(angle/6.2831853+1.0,1.0)*32.0;int i=int(floor(sector));int j=(i+1)%32;float f=fract(sector);
      vec4 s=mix(u_impulse[i],u_impulse[j],f),m=mix(u_motion[i],u_motion[j],f);
      if(u_hasResponse>0.5){
        float arrival=arrivalAt(r);if(r>u_radius || u_materialSeconds+0.0000001<arrival)return vec4(0.0);
        float source=1.0-smoothstep(m.w-4.0,m.w+6.0,r);vec4 state;
        if(source>0.999)state=responseAt(sector,u_sourceSeconds,0.0);
        else{state=responseAt(sector,max(0.0,u_materialSeconds-arrival),32.0);if(source>0.001)state=mix(state,responseAt(sector,u_sourceSeconds,0.0),source);}
        float length=mix(u_responseLengths[i],u_responseLengths[j],f),attenuation=exp(-max(0.0,r-m.z)/max(1.0,u_pressRadius*8.0));
        return vec4(state.xy*length*1.62*(0.68+0.77*state.z),state.zw)*attenuation;
      }
      float outside=max(0.0,r-m.z),age=max(0.0,u_impulseSeconds-outside/max(60.0,u_waveSpeed));
      float attenuation=exp(-outside/max(1.0,u_pressRadius*8.0)),decay=exp(-3.0*max(0.0,age-u_recoveryDelay));
      return vec4(heldMotion(s.xy,m.xy,age)*attenuation,s.zw*decay*attenuation)*u_hasImpulse;
    }
    float impulseWeight(){return u_hasImpulse*(u_previousIntegration>0.5?1.0-smoothstep(0.0,0.5,u_progress):1.0)*(1.0-u_settleProgress);}
    bool sourceInterior(vec2 pixel){
      vec2 halfSize=u_sourceRect.zw*0.5;float radius=min(halfSize.x,halfSize.y);
      vec2 q=abs(pixel-u_sourceRect.xy-halfSize)-(halfSize-vec2(radius));
      return u_previousIntegration>0.5 && u_hasImpulse>0.5 && u_progress<0.5 && length(max(q,0.0))+min(max(q.x,q.y),0.0)<radius-1.0;
    }

    vec3 targetAt(vec2 pixel){if(u_hasField<0.5)return vec3(0.0);return texture(u_targets,clamp(pixel/u_size,vec2(0.0),vec2(1.0))).rgb*u_hasField;}
    float qstep(float a,float b,float x);
    float reliefAt(vec2 pixel){if(u_settleProgress<=0.12 || u_settleProgress>=1.0)return 0.0;vec3 f=targetAt(pixel);return (f.r*7.0+f.g*3.0)*qstep(0.12,0.55,u_settleProgress)*(1.0-qstep(0.72,1.0,u_settleProgress));}
    float qstep(float a,float b,float x){float t=clamp((x-a)/(b-a),0.0,1.0);return t*t*t*(t*(t*6.0-15.0)+10.0);}
    float resolveAt(vec2 pixel,float amount){
      if(u_previousIntegration>0.5)return max(targetAt(pixel).b*smoothstep(0.60,0.92,amount),smoothstep(0.86,1.0,amount));
      return qstep(0.50,1.0,amount);
    }


    float flattenAmount(float r){return u_formation*u_settleProgress;}
    vec2 profile(float r){
      float t=clamp((r-u_radius+u_band)/max(0.001,u_band),0.0,1.0);
      float height=min(u_elevation,u_radius*0.38)*u_amplitude;
      float curl=height*0.6*u_curvature;
      float inside=step(u_radius-u_band,r)*step(r,u_radius);
      float tuft=(1.0-u_hasImpulse)*u_radius*0.18*(1.0-smoothstep(0.0,0.18,u_progress));
      float shape=max(0.0,1.0-r*r/max(0.001,u_radius*u_radius));
      float settled=flattenAmount(r);
      float lift=u_formation*min(u_elevation*0.32,u_radius*0.15)*u_amplitude;
      float shoulder=lift*(1.0-settled)*(r<u_radius-u_band?1.0:1.0-smoothstep(0.0,1.0,t));
      return vec2(r+inside*curl*sin(6.2831853*t)*(1.0-settled),inside*height*pow(sin(3.14159265*t),2.0)*(1.0-settled)+shoulder+tuft*shape*shape*(1.0-settled));
    }
    vec2 seamProfile(float r,float edge){
      vec2 p=profile(r);if(u_hasImpulse<0.5)return p;
      float weight=mix(smoothstep(edge,edge+max(12.0,u_pressRadius*0.8),r),1.0,u_sourceMerge*(1.0-u_previousIntegration));
      return vec2(mix(r,p.x,weight),p.y*weight);
    }
    vec3 positionAt(float v,float q,out vec3 normal,out vec3 tangent) {
      float r=(q+1.0)*0.5*u_reach;vec2 direction=vec2(cos(v*3.14159265),sin(v*3.14159265));
      float sector=mod(v*0.5+1.0,1.0)*32.0;int i=int(floor(sector));float edge=mix(u_motion[i].w,u_motion[(i+1)%32].w,fract(sector));
      vec2 center=seamProfile(r,edge),delta=seamProfile(r+0.05,edge)-seamProfile(max(0.0,r-0.05),edge);
      tangent=normalize(vec3(direction*delta.x,delta.y));
      normal=normalize(vec3(-direction*delta.y,delta.x));
      vec2 pixel=u_origin+direction*center.x;
      float relief=reliefAt(pixel);
      vec2 gradient=vec2(reliefAt(pixel+vec2(1,0))-reliefAt(pixel-vec2(1,0)),reliefAt(pixel+vec2(0,1))-reliefAt(pixel-vec2(0,1)))*0.5;
      normal=normalize(normal+vec3(-gradient,0));
      vec4 impulse=impulseAt(v*3.14159265,r);float weight=impulseWeight();
      // Annular measured splay must not displace the common radial center.
      pixel+=(direction*impulse.x+vec2(-direction.y,direction.x)*impulse.y)*weight*smoothstep(0.0,max(1.0,u_pressRadius*0.12),r);
      return vec3(pixel,max(0.0,center.y-impulse.w*u_length*weight)+relief);
    }
    vec4 project(vec3 p) {
      float lift=mix(p.z,p.z*smoothstep(u_elevation*0.34,u_elevation*0.74,p.z),u_formation*(1.0-u_colorOnly));
      float perspective=1800.0/(1800.0-lift);
      vec2 pixel=(p.xy-u_origin)*perspective+u_origin;
      pixel.y-=lift*0.65;vec2 clip=pixel/u_size*2.0-1.0;
      return vec4(clip.x,-clip.y,clamp(-p.z/400.0,-0.95,0.95),1.0);
    }
    float bodyVisibility(float r){
      if(u_formation>0.5)return 1.0;
      // Legacy comparison only: the prototype below uses opaque local formation.
      float foot=max(0.0,u_radius-u_band);
      return mix(u_bodyFloor,1.0,smoothstep(max(0.0,foot-35.0),max(0.001,foot),r));
    }
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  `;
  const meshVertex=`#version 300 es
    ${common}
    layout(location=0) in vec3 a_param;
    uniform float u_shadow;
    out vec3 v_normal;out vec2 v_uv;out float v_layer,v_height,v_radius;
    void main(){
      vec3 normal,tangent;float v=a_param.x;
      float layer=mod(a_param.z,2.0);
      float q=a_param.z>=2.0 ? 2.0*u_radius/max(0.001,u_reach)-1.0 : a_param.y;
      vec3 p=positionAt(v,q,normal,tangent);
      p-=normal*layer*u_thickness*(1.0-flattenAmount((q+1.0)*0.5*u_reach));
      v_normal=normal*(1.0-2.0*layer);v_radius=(q+1.0)*0.5*u_reach;v_uv=vec2(cos(v*3.14159265),sin(v*3.14159265))*v_radius;
      v_layer=layer;v_height=p.z;
      if(a_param.z>=2.0)v_radius=max(0.0,u_radius-0.7);
      if(u_shadow>0.5){p.xy+=vec2(5.0,11.0)*u_amplitude;p.z=-2.0;}
      gl_Position=project(p);
    }
  `;
  const meshFragment=`#version 300 es
    ${common}
    uniform float u_shadow;
    uniform sampler2D u_pile,u_destination,u_source;
    uniform vec4 u_sourceImageRect;uniform float u_hasSource;
    uniform float u_hasDestination;
    in vec3 v_normal;in vec2 v_uv;in float v_layer,v_height,v_radius;out vec4 color;
    void main(){
      float settled=flattenAmount(v_radius);
      vec2 pixel=v_uv+u_origin;
      float coverage=1.0;
      if(u_previousIntegration>0.5 && u_formation>0.5 && u_hasField>0.5){
        float resolve=resolveAt(pixel,settled);
        float distanceToFiber=length(fract(pixel/2.0)-0.5),radius=0.708*(1.0-resolve);
        float feather=max(0.02,fwidth(distanceToFiber));
        coverage=resolve<=0.0?1.0:resolve>=0.999?0.0:1.0-smoothstep(radius-feather,radius+feather,distanceToFiber);
        if(coverage<0.001)discard;
      }
      if(sourceInterior(v_uv+u_origin))discard;
      if(v_radius>u_radius || u_radius<0.01 || u_opacity<0.001)discard;
      // Fully settled regions have already become the native UI. No alpha ghost.
      if(u_formation>0.5 && settled>=1.0)discard;
      float edge=(1.0-smoothstep(max(0.0,u_radius-1.0),u_radius,v_radius))*u_opacity*bodyVisibility(v_radius);
      if(u_shadow>0.5){color=vec4(0.18,0.12,0.025,edge*coverage*u_amplitude*u_lighting*0.16*(1.0-settled));return;}
      vec3 n=normalize(v_normal);
      // The underlying pile is baked with the *button's* unmodified shaders.
      // UVs are material-space CSS pixels: growth does not enlarge the fibers.
      float light=0.82+0.18*clamp(dot(n,normalize(vec3(-0.3,-0.5,1.0)))/0.86387,0.0,1.0);
      vec4 texel=texture(u_pile,v_uv/64.0);
      // Match the button canvas' premultiplied-alpha composition over ivory.
      vec3 pile=min(vec3(1.0),texel.rgb+vec3(1.0,0.99,0.96)*(1.0-texel.a));
      vec2 sourceUV=(pixel-u_sourceImageRect.xy)/max(vec2(1.0),u_sourceImageRect.zw);
      if(u_hasSource>0.5 && u_sourceMerge<1.0 && all(greaterThanEqual(sourceUV,vec2(0))) && all(lessThanEqual(sourceUV,vec2(1)))){
        vec4 source=texture(u_source,sourceUV);
        // Pigment and local pile relief homogenize into the spread material; the
        // filled mesh stays opaque. No pill mask shrinks and no source alpha fades.
        vec3 imprint=mix(pile,source.rgb,source.a);
        pile=mix(imprint,pile,u_sourceMerge);
      }
      vec3 base=pile*mix(1.0,0.87,smoothstep(0.25,0.75,v_layer));
      vec3 destination=texture(u_destination,(v_uv+u_origin)/u_size).rgb;
      // Dye the existing pile first: retain strand luminance, lighting and depth.
      float pileDetail=clamp(dot(base,vec3(0.2126,0.7152,0.0722))/0.91,0.72,1.12);
      vec3 dyed=destination*pileDetail*mix(1.0,light,u_lighting);
      vec3 coloredPile=mix(base*mix(1.0,light,u_lighting),dyed,u_tintProgress*u_hasDestination);
      vec3 surface=mix(coloredPile,destination,qstep(0.30,0.9,settled)*u_hasDestination);
      color=vec4(surface,edge*coverage);
    }
  `;
  const furVertex=`#version 300 es
    ${common}
    layout(location=0) in vec4 a_seed;
    out float v_height,v_side,v_light,v_seed,v_edge,v_flat;out vec2 v_materialUv;
    void main(){
      vec2 corners[6]=vec2[6](vec2(-1,0),vec2(1,0),vec2(-1,1),vec2(-1,1),vec2(1,0),vec2(1,1));
      vec2 corner=corners[gl_VertexID%6];if(u_curve>0.5)corner.y=(float(gl_VertexID/6)+corner.y)/3.0;
      float v=a_seed.x,q=a_seed.y;
      vec3 normal,tangent;vec3 p=positionAt(v,q,normal,tangent);
      vec3 across=vec3(-sin(v*3.14159265),cos(v*3.14159265),0);
      float angle=a_seed.w*6.2831853;
      vec3 lean=normalize(tangent*cos(angle)+across*sin(angle));
      vec3 side=normalize(cross(normal,lean));
      float r=(q+1.0)*0.5*u_reach;
      float settled=flattenAmount(r);v_flat=settled;v_materialUv=(u_origin+vec2(cos(v*3.14159265),sin(v*3.14159265))*r)/u_size;
      vec2 pixel=v_materialUv*u_size;
      vec2 gradient=vec2(targetAt(pixel+vec2(2,0)).g-targetAt(pixel-vec2(2,0)).g,targetAt(pixel+vec2(0,2)).g-targetAt(pixel-vec2(0,2)).g);
      if(length(gradient)>0.01){lean=normalize(mix(lean,vec3(-gradient.y,gradient.x,0.05),smoothstep(0.15,0.65,settled)*0.85));side=normalize(cross(normal,lean));}
      float resolve=resolveAt(pixel,settled);
      float length=u_length*(0.78+a_seed.z*0.44)*(1.0-qstep(0.50,1.0,settled));
      vec4 impulse=impulseAt(v*3.14159265,r);float weight=impulseWeight();
      vec3 radial=vec3(cos(v*3.14159265),sin(v*3.14159265),0);
      lean=normalize(lean+radial*impulse.x*weight/max(1.0,u_length)+across*impulse.y*weight/max(1.0,u_length));
      length*=1.0-clamp(impulse.z*weight,0.0,1.0)*0.78-clamp(impulse.w*weight,0.0,1.0)*0.16;
      if(u_curve>0.5){
        vec3 rest=normal*0.5*pow(1.0-settled,2.0)*length+normalize(tangent*cos(angle)+across*sin(angle))*mix(0.28,0.38,a_seed.z)*length;
        vec3 bend=(radial*impulse.x+across*impulse.y)*weight;
        vec2 xy=furPath(corner.y,rest.xy,bend.xy,vec2(0.0),1.0,clamp(impulse.z,0.0,1.0));
        p+=vec3(xy,rest.z*corner.y);
      }else p+=(normal*0.5*pow(1.0-settled,2.0)+lean*(mix(0.28,0.38,a_seed.z)+settled*0.5))*length*corner.y;
      float rootWidth=mix(1.05,1.5,a_seed.z)*(1.0-resolve)*(1.0+clamp(impulse.z*weight,0.0,1.0)*0.3+clamp(impulse.w*weight,0.0,1.0)*0.18);
      p+=side*corner.x*mix(rootWidth,rootWidth*0.36,corner.y);
      gl_Position=project(p);
      v_height=corner.y;v_side=corner.x;v_seed=a_seed.z;
      v_light=(0.78+0.22*max(0.0,dot(normalize(vec3(cos(angle),sin(angle),0.7)),normalize(vec3(-0.35,-0.45,0.82)))))*(0.82+0.18*max(0.0,dot(normal,normalize(vec3(-0.3,-0.5,1.0)))));
      v_edge=step(r,u_radius)*step(0.01,u_radius)*u_opacity*bodyVisibility(r);
      if(sourceInterior(pixel) || v_edge<0.001 || settled>=1.0 || resolve>=0.999)gl_Position=vec4(2.0,2.0,2.0,1.0);
    }
  `;
  const furFragment=`#version 300 es
    precision highp float;
    uniform sampler2D u_destination;
    uniform float u_tintProgress;
    uniform vec2 u_size,u_origin;
    in float v_height,v_side,v_light,v_seed,v_edge,v_flat;in vec2 v_materialUv;out vec4 color;
    void main(){
      vec3 root=mix(vec3(0.72,0.49,0.10),vec3(0.86,0.66,0.22),v_seed);
      vec3 middle=mix(vec3(0.98,0.84,0.46),vec3(1.0,0.92,0.65),v_seed);
      vec3 tip=mix(vec3(1.0,0.95,0.76),vec3(1.0,0.985,0.88),v_seed);
      vec3 fur=mix(root,middle,smoothstep(0.0,0.58,v_height));
      fur=mix(fur,tip,smoothstep(0.58,1.0,v_height));
      float tipGlow=1.0+smoothstep(0.76,1.0,v_height)*0.11;
      float alpha=(1.0-smoothstep(0.62,1.0,abs(v_side)))*(1.0-smoothstep(0.86,1.0,v_height)*0.24)*mix(0.82,0.94,v_height);
      // Geometry collapses into the forming surface; opacity is not the mechanism.
      // Small final fibers no longer project above finished native text.
      vec3 destination=texture(u_destination,v_materialUv).rgb;
      float strandDetail=mix(0.57,1.08,smoothstep(0.0,1.0,v_height))*(0.96+0.08*v_seed);
      vec3 dyed=destination*strandDetail*v_light*tipGlow;
      vec3 colored=mix(fur*v_light*tipGlow,dyed,u_tintProgress);
      color=vec4(mix(colored,destination,smoothstep(0.30,0.9,v_flat)),alpha*v_edge);
    }
  `;

  function meshData(columns,rows) {
    const vertices=[];
    const add=(a,b,c)=>{for(const p of [a,b,c])vertices.push(p[0],2*((p[1]+1)*.5)**2-1,p[2]);};
    for(let layer=0;layer<=1;layer++)for(let x=0;x<columns;x++)for(let y=0;y<rows;y++){
      const a=[x/columns*2-1,y/rows*2-1,layer],b=[(x+1)/columns*2-1,y/rows*2-1,layer];
      const c=[x/columns*2-1,(y+1)/rows*2-1,layer],d=[(x+1)/columns*2-1,(y+1)/rows*2-1,layer];
      add(a,b,c);add(c,b,d);
    }
    // A dynamic outer seam follows the growth edge, closing top to underside.
    for(const q of [1])for(let x=0;x<columns;x++){
      const a=[x/columns*2-1,q,2],b=[(x+1)/columns*2-1,q,2],c=[x/columns*2-1,q,3],d=[(x+1)/columns*2-1,q,3];add(a,b,c);add(c,b,d);
    }
    return new Float32Array(vertices);
  }
  function program(gl,vertex,fragment) {
    const shaders=[];let result;
    try {
      for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
        const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      }
      result=gl.createProgram();shaders.forEach(shader=>gl.attachShader(result,shader));gl.linkProgram(result);
      if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(result));
      resources.programs++;return result;
    }catch(error){if(result)gl.deleteProgram(result);throw error;}finally{shaders.forEach(shader=>gl.deleteShader(shader));}
  }

  class FurSheet {
    constructor(container,{width,height,origin,options={},onFailure=()=>{}}) {
      this.options={...defaults,...options};this.width=width;this.height=height;this.origin=origin;
      this.buffers=[];this.programs=[];this.disposed=false;this.onFailure=onFailure;
      this.canvas=document.createElement("canvas");this.canvas.className="fur-sheet-canvas";this.canvas.setAttribute("aria-hidden","true");
      this.onLost=event=>{event.preventDefault();this.dispose();onFailure("WebGL context lost");};
      this.canvas.addEventListener("webglcontextlost",this.onLost);
      container.append(this.canvas);
      const start=performance.now();
      try{
        const gl=this.canvas.getContext("webgl2",{alpha:true,antialias:true,premultipliedAlpha:false,depth:true});
        if(!gl)throw Error("WebGL2 unavailable");this.gl=gl;resources.contexts++;
        const small=width<600 || (navigator.hardwareConcurrency||8)<=4;
        this.dpr=Math.min(devicePixelRatio||1,this.options.previousIntegration?(small?1.15:1.5):(small?1:1.25));
        this.canvas.width=Math.round(width*this.dpr);this.canvas.height=Math.round(height*this.dpr);
        this.meshProgram=program(gl,meshVertex,meshFragment);this.programs.push(this.meshProgram);
        this.furProgram=program(gl,furVertex,furFragment);this.programs.push(this.furProgram);
        const mesh=meshData(small||this.options.impulse?80:120,small||this.options.impulse?48:72);this.meshVertices=mesh.length/3;
        this.meshBuffer=this.buffer(mesh);
        this.fibers=Math.round((small?9000:26000)*clamp(this.options.furDensity,.35,1.8));
        const seeds=new Float32Array(this.fibers*4);
        const random=i=>{const n=Math.sin(i*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
        for(let i=0;i<this.fibers;i++){
          // Every prefix covers the whole sheet, so adaptive draw-count reduction
          // cannot remove an entire side of the fur-covered crest.
          seeds[i*4]=random(i+1)*2-1;
          const q=random(i+9)*2-1;
          const t=(q+1)*.5;
          seeds[i*4+1]=2*(random(i+200)<.35?t**1.5:Math.sqrt(t))-1;
          seeds[i*4+2]=random(i+45);seeds[i*4+3]=random(i+91);
        }
        this.sortedRadii=Array.from({length:this.fibers},(_,i)=>(seeds[i*4+1]+1)*.5).sort((a,b)=>a-b);
        this.furBuffer=this.buffer(seeds);
        this.bufferBytes=mesh.byteLength+seeds.byteLength;
        this.gpuBytes=this.bufferBytes+(this.textureBytes||0)+(this.destinationBytes||0)+(this.targetBytes||0)+(this.sourceBytes||0)+(this.responseBytes||0)+this.canvas.width*this.canvas.height*8;
        this.uniforms=new Map();
        for(const target of this.programs){const uniforms={};for(const name of ["size","origin","progress","reach","radius","settleProgress","tintProgress","band","opacity","bodyFloor","amplitude","width","elevation","curvature","thickness","lighting","length","shadow","pile","destination","hasDestination","targets","hasField","colorOnly","formation","hasImpulse","impulseSeconds","pressRadius","waveSpeed","recoveryDelay","sourceRect","impulse[0]","motion[0]","sourceMerge","previousIntegration","source","sourceImageRect","hasSource","curve","response","arrival","hasResponse","responseWidth","responseStep","materialSeconds","sourceSeconds","arrivalCount","responseLengths[0]"])uniforms[name]=gl.getUniformLocation(target,`u_${name}`);this.uniforms.set(target,uniforms);}
        this.bakeButtonPile();
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
        // Compile/validate the first draw before starting the visible frame clock.
        // Initialization latency is reported separately, not hidden in FPS.
        this.setResponse(this.options.response);this.draw(0);
        this.initializationMs=performance.now()-start;
      }catch(error){this.dispose();throw error;}
    }
    bakeButtonPile(){
      const gl=this.gl,shared=window.DuckFur?.materialShaders;
      if(!shared)throw Error("Shared button fur shaders unavailable");
      const tile=64,dpr=2,size=tile*dpr,temporaryBuffers=[];
      let target,framebuffer,glyph,vao;
      const buffer=data=>{const value=gl.createBuffer();temporaryBuffers.push(value);resources.buffers++;gl.bindBuffer(gl.ARRAY_BUFFER,value);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);};
      const key=`${this.options.fiberLength}:${this.options.furDensity}`,cached=pileCache.get(key);
      this.materialTexture=gl.createTexture();resources.textures++;
      gl.bindTexture(gl.TEXTURE_2D,this.materialTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,cached||null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      const finish=()=>{gl.bindTexture(gl.TEXTURE_2D,this.materialTexture);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);this.textureBytes=Math.ceil(size*size*4*4/3);this.gpuBytes+=this.textureBytes;};
      if(cached){finish();return;}
      try{
        target=program(gl,shared.vertex,shared.fragment);
        framebuffer=gl.createFramebuffer();resources.framebuffers++;gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.materialTexture,0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error("Button pile framebuffer incomplete");
        // Dummy glyph field keeps the original sampler valid; labels are disabled.
        glyph=gl.createTexture();resources.textures++;gl.bindTexture(gl.TEXTURE_2D,glyph);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,1,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([0]));
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        const count=Math.round(tile*tile*shared.fibersPerPixel*this.options.furDensity),columns=Math.ceil(Math.sqrt(count));
        const data=[];const rand=i=>{const n=Math.sin(i*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
        for(let i=0;i<count;i++){
          const x=((i%columns)+.5+(rand(i+1)-.5)*.78)/columns;
          const y=(Math.floor(i/columns)+.5+(rand(i+2)-.5)*.78)/Math.ceil(count/columns);
          const seed=[.78+rand(i+3)*.44,rand(i+4)*Math.PI*2,rand(i+5),rand(i+6)];
          // Wrapped neighbors make identical fiber fragments meet at tile borders.
          for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)data.push(x+dx,y+dy,...seed);
        }
        vao=gl.createVertexArray();gl.bindVertexArray(vao);
        buffer(new Float32Array([-1,0,1,0,-1,1,-1,1,1,0,1,1]));
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
        buffer(new Float32Array(data));
        gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(1,1);
        gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,24,8);gl.vertexAttribDivisor(2,1);
        gl.disableVertexAttribArray(3);gl.vertexAttrib4f(3,0,0,0,0);gl.disableVertexAttribArray(4);gl.vertexAttrib3f(4,0,0,0);
        gl.useProgram(target);
        const loc=name=>gl.getUniformLocation(target,name);
        gl.uniform2f(loc("u_canvasResolution"),size,size);gl.uniform2f(loc("u_surfaceResolution"),size,size);gl.uniform2f(loc("u_surfaceOffset"),0,0);
        gl.uniform1f(loc("u_length"),this.options.fiberLength);gl.uniform1f(loc("u_dpr"),dpr);
        for(const name of ["u_labelLengthScale","u_labelWidthScale","u_boundaryLabelWidthScale","u_boundaryLabelLeanScale"])gl.uniform1f(loc(name),1);
        gl.uniform1f(loc("u_hasGlyph"),0);gl.uniform1f(loc("u_glyphTransition"),.55);gl.uniform1f(loc("u_sdfRange"),12);
        gl.uniform1f(loc("u_motionGuardStart"),.12);gl.uniform1f(loc("u_motionGuardEnd"),.58);gl.uniform1i(loc("u_glyphField"),0);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,glyph);
        gl.viewport(0,0,size,size);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArraysInstanced(gl.TRIANGLES,0,6,data.length/6);
        const pixels=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        pileCache.set(key,pixels);if(pileCache.size>4)pileCache.delete(pileCache.keys().next().value);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);finish();
      }finally{
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
        if(vao)gl.deleteVertexArray(vao);
        if(framebuffer){gl.deleteFramebuffer(framebuffer);resources.framebuffers--;}
        if(glyph){gl.deleteTexture(glyph);resources.textures--;}
        for(const value of temporaryBuffers){gl.deleteBuffer(value);resources.buffers--;}
        if(target){gl.deleteProgram(target);resources.programs--;}
      }
    }
    setSource(canvas,rect){
      if(!this.gl || this.disposed)return;
      const gl=this.gl;
      if(!this.sourceTexture){this.sourceTexture=gl.createTexture();resources.textures++;}
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.LINEAR);
      for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
      this.sourceImageRect={...rect};this.sourceBytes=canvas.width*canvas.height*4;
    }
    setDestination(canvas){
      const gl=this.gl;if(!gl || this.disposed)return;
      if(!this.destinationTexture){this.destinationTexture=gl.createTexture();resources.textures++;}
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.destinationTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.destinationBytes=canvas.width*canvas.height*4;
      if(canvas.formation?.field){
        const field=canvas.formation.field;
        if(!this.targetTexture){this.targetTexture=gl.createTexture();resources.textures++;}
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.targetTexture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,field);
        for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
        for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
        this.targetBytes=field.width*field.height*4;this.formationTargets=canvas.formation.targets;
      }
      this.gpuBytes=this.bufferBytes+(this.textureBytes||0)+this.destinationBytes+(this.targetBytes||0)+(this.sourceBytes||0)+(this.responseBytes||0)+this.canvas.width*this.canvas.height*8;
    }
    buffer(data){const gl=this.gl,buffer=gl.createBuffer();this.buffers.push(buffer);resources.buffers++;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return buffer;}
    uniformsFor(target,model){const gl=this.gl,u=this.uniforms.get(target),s=this.options;gl.useProgram(target);gl.uniform1i(u.destination,1);gl.uniform1i(u.targets,2);
      const own=ownership(model);
      gl.uniform1f(u.curve,s.experimentalStrands?1:0);gl.uniform1f(u.sourceMerge,own.sourceMerge);gl.uniform1f(u.previousIntegration,s.previousIntegration?1:0);
      gl.uniform1i(u.source,3);gl.uniform1f(u.hasSource,this.sourceTexture?1:0);
      const sr=this.sourceImageRect||{x:0,y:0,width:0,height:0};gl.uniform4f(u.sourceImageRect,sr.x,sr.y,sr.width,sr.height);
      const impulse=s.impulse,response=s.response,map=s.arrival;
      gl.uniform1i(u.response,4);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.responseTexture||this.materialTexture);
      gl.uniform1i(u.arrival,5);gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.arrivalTexture||this.materialTexture);
      gl.uniform1f(u.hasResponse,response?1:0);gl.uniform1f(u.responseWidth,response?.width||1);gl.uniform1f(u.responseStep,response?.step||1);
      gl.uniform1f(u.arrivalCount,map?.count||2);gl.uniform1f(u.materialSeconds,model.materialSeconds||0);gl.uniform1f(u.sourceSeconds,model.sourceSeconds||0);
      if(response)gl.uniform1fv(u["responseLengths[0]"],this.responseLengths);
      gl.uniform1f(u.recoveryDelay,s.previousIntegration?0:Math.max(0,Number(impulse?.material.recoveryDelay)||0)/1000);gl.uniform1f(u.hasImpulse,impulse?1:0);gl.uniform1f(u.impulseSeconds,model.impulseSeconds||0);gl.uniform1f(u.pressRadius,impulse?.pressRadius||1);gl.uniform1f(u.waveSpeed,impulse?.material.waveSpeed||540);
      const rect=s.sourceRect||{x:0,y:0,width:0,height:0};gl.uniform4f(u.sourceRect,rect.x,rect.y,rect.width,rect.height);
      if(impulse){gl.uniform4fv(u["impulse[0]"],(this.impulseData ||= new Float32Array(impulse.samples.flatMap(v=>[v.radial,v.tangential,v.compression,v.depression]))));gl.uniform4fv(u["motion[0]"],(this.motionData ||= new Float32Array(impulse.samples.flatMap(v=>[v.velocity,v.tangentialVelocity,v.radius,v.edge]))));}
      gl.uniform2f(u.size,this.width,this.height);gl.uniform2f(u.origin,this.origin.x,this.origin.y);
      for(const [name,value]of Object.entries({progress:model.progress,reach:model.reach,radius:model.radius,settleProgress:model.settleProgress,tintProgress:model.tintProgress,band:model.band,opacity:model.opacity,formation:s.formation?1:0,hasDestination:this.destinationTexture?1:0,hasField:this.targetTexture && !s.colorOnly?1:0,colorOnly:s.colorOnly?1:0,bodyFloor:s.growthOnly?1:.42,amplitude:model.amplitude,width:s.sheetWidth,elevation:s.elevation,curvature:s.curvature,thickness:s.thickness*Math.min(1,model.radius/20),lighting:s.lighting,length:s.fiberLength}))gl.uniform1f(u[name],value);
    }
    draw(progress){if(this.disposed)return null;const gl=this.gl;
      const model=geometry(this.width,this.height,this.origin,this.options,progress);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.sourceTexture||this.materialTexture);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.targetTexture||this.materialTexture);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.destinationTexture||this.materialTexture);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      this.uniformsFor(this.meshProgram,model);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.materialTexture);gl.uniform1i(this.uniforms.get(this.meshProgram).pile,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.meshBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,0);
      gl.depthMask(false);gl.uniform1f(this.uniforms.get(this.meshProgram).shadow,1);gl.drawArrays(gl.TRIANGLES,0,this.meshVertices);
      gl.depthMask(true);gl.uniform1f(this.uniforms.get(this.meshProgram).shadow,0);gl.drawArrays(gl.TRIANGLES,0,this.meshVertices);
      this.uniformsFor(this.furProgram,model);gl.bindBuffer(gl.ARRAY_BUFFER,this.furBuffer);gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,1);
      // All fixed roots are submitted; shader activation never re-samples the domain.
      const countAt=limit=>{let low=0,high=this.sortedRadii.length;
        while(low<high){const mid=(low+high)>>1;if(this.sortedRadii[mid]<=limit)low=mid+1;else high=mid;}return low;};
      const grown=countAt(model.radius/model.reach),formed=model.settings.formation?countAt(revealRadius(model)/model.reach):0;
      this.visibleFibers=Math.round((grown-formed)*this.fibers/this.sortedRadii.length);
      gl.drawArraysInstanced(gl.TRIANGLES,0,this.options.experimentalStrands?18:6,this.fibers);gl.vertexAttribDivisor(0,0);
      return model;
    }
    setResponse(response){
      const gl=this.gl;
      for(const key of ["responseTexture","arrivalTexture"])if(this[key]){gl.deleteTexture(this[key]);resources.textures--;this[key]=null;}
      this.responseBytes=0;this.options.response=response;this.options.arrival=null;
      if(!response)return;
      const map=arrivalMap(this.width,this.height,this.origin,this.options);this.options.arrival=map;
      const upload=(key,unit,width,height,data)=>{this[key]=gl.createTexture();resources.textures++;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this[key]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,data);for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.NEAREST);for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.CLAMP_TO_EDGE);};
      upload("responseTexture",4,response.width,response.rows,response.state);upload("arrivalTexture",5,map.count,1,map.data);
      this.responseLengths=new Float32Array(this.options.impulse.samples.map(s=>s.response?.length||this.options.fiberLength));
      this.responseBytes=response.state.byteLength+map.data.byteLength;
      this.gpuBytes=this.bufferBytes+(this.textureBytes||0)+(this.destinationBytes||0)+(this.targetBytes||0)+(this.sourceBytes||0)+this.responseBytes+this.canvas.width*this.canvas.height*8;
    }
    reduceQuality(){if(this.disposed)return;this.qualityReduced=true;this.fibers=Math.max(4000,Math.round(this.fibers*.7));this.canvas.width=Math.round(this.width);this.canvas.height=Math.round(this.height);this.gpuBytes=this.bufferBytes+(this.textureBytes||0)+(this.destinationBytes||0)+(this.targetBytes||0)+(this.sourceBytes||0)+(this.responseBytes||0)+this.canvas.width*this.canvas.height*8;}
    canRetarget(width,height,options){return !this.disposed && this.width===width && this.height===height && this.options.renderer===options.renderer && Boolean(this.options.previousIntegration)===Boolean(options.previousIntegration) && Boolean(this.options.impulse)===Boolean(options.impulse) && this.options.furDensity===(options.furDensity??defaults.furDensity) && this.options.fiberLength===(options.fiberLength??defaults.fiberLength);}
    retarget(container,origin,options){if(this.sourceTexture){this.gl.deleteTexture(this.sourceTexture);resources.textures--;this.sourceTexture=null;}this.sourceImageRect=null;this.sourceBytes=0;this.impulseData=null;this.motionData=null;this.origin=origin;this.options={...defaults,...options};container.append(this.canvas);this.initializationMs=0;this.setResponse(this.options.response);this.draw(0);}
    getStats(){return {meshVertices:this.meshVertices||0,fiberInstances:this.visibleFibers||0,strandVertices:this.options.experimentalStrands?18:6,fiberCapacity:this.fibers||0,gpuBytes:this.gpuBytes||0,initializationMs:this.initializationMs||0,temporaryCanvases:this.disposed?0:1,material:"shared-button-shaders",cpuResponseBytes:this.options.response?.bytes||0,textureBytes:(this.responseBytes||0)+(this.textureBytes||0)+(this.destinationBytes||0)+(this.targetBytes||0)+(this.sourceBytes||0),...resources};}
    dispose(){if(this.disposed)return;this.disposed=true;const gl=this.gl;
      if(gl){for(const key of ["responseTexture","arrivalTexture"])if(this[key]){gl.deleteTexture(this[key]);resources.textures--;this[key]=null;}this.options.response=null;this.options.arrival=null;if(this.sourceTexture){gl.deleteTexture(this.sourceTexture);resources.textures--;this.sourceTexture=null;}if(this.targetTexture){gl.deleteTexture(this.targetTexture);resources.textures--;this.targetTexture=null;}if(this.destinationTexture){gl.deleteTexture(this.destinationTexture);resources.textures--;this.destinationTexture=null;}if(this.materialTexture){gl.deleteTexture(this.materialTexture);resources.textures--;this.materialTexture=null;}for(const buffer of this.buffers){gl.deleteBuffer(buffer);resources.buffers--;}for(const item of this.programs){gl.deleteProgram(item);resources.programs--;}
        this.canvas.removeEventListener("webglcontextlost",this.onLost);gl.getExtension("WEBGL_lose_context")?.loseContext();resources.contexts--;}
      this.gl=null;this.canvas.remove();
    }
  }
  window.DuckFurSheet={FurSheet,defaults,formationState,ownership,geometry,arrivalMap,arrivalAt,disturbance,sample,project,profile,flattenAmount,settlement,revealRadius,revealPolygon,boundaries,resources};
})();
