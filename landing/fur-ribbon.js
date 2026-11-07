// Frozen rejected ribbon baseline from 36197fa. Lab comparison only.
(() => {
  "use strict";
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(x)=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
  const defaults={growthSpeed:1,thickness:5,elevation:64,curvature:0.72,furDensity:1,fiberLength:5.5,sheetWidth:110,lighting:0.8};
  const resources={contexts:0,buffers:0,programs:0};

  function geometry(width,height,origin,options={},progress=0) {
    const settings={...defaults,...options};
    const diagonal=Math.hypot(width,height);
    let dx=width/2-origin.x,dy=height/2-origin.y;
    if(Math.hypot(dx,dy)<20){dx=1;dy=0;}
    const length=Math.hypot(dx,dy),nx=dx/length,ny=dy/length;
    const projections=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>(x-origin.x)*nx+(y-origin.y)*ny);
    const reach=Math.max(...projections);
    const p=clamp(progress,0,1);
    const travel=smooth(p)*(reach+settings.sheetWidth*1.8+settings.elevation);
    const growth=smooth(p*3*settings.growthSpeed);
    const span=20+diagonal*1.2*growth;
    const amplitude=smooth(p/.12)*(1-smooth((p-.88)/.12));
    return {width,height,origin,nx,ny,diagonal,reach,progress:p,travel,span,amplitude,settings};
  }
  function frontAt(model,v) {
    return model.travel-model.settings.curvature*v*v/model.diagonal*(1-model.progress)*0.65;
  }
  function sample(model,v,q,layer=0) {
    const {settings:s}=model;
    const width=s.sheetWidth*(.2+.8*smooth(model.progress/.2));
    const theta=Math.PI*(q+1);
    const radius=s.elevation*.6*s.curvature*model.amplitude;
    const u=frontAt(model,v)+width*.5*q+radius*Math.sin(theta);
    const z=s.elevation*model.amplitude*Math.sin(theta*.5)**2;
    const du=width*.5+radius*Math.PI*Math.cos(theta);
    const dz=s.elevation*model.amplitude*Math.PI*.5*Math.sin(theta);
    const lateralSlope=-2*s.curvature*v/model.diagonal*(1-model.progress)*.65;
    const normalLength=Math.hypot(dz,lateralSlope*dz,du)||1;
    const normal={x:(-model.nx*dz-model.ny*lateralSlope*dz)/normalLength,y:(-model.ny*dz+model.nx*lateralSlope*dz)/normalLength,z:du/normalLength};
    return {x:model.origin.x+model.nx*u-model.ny*v-normal.x*layer*s.thickness,
      y:model.origin.y+model.ny*u+model.nx*v-normal.y*layer*s.thickness,
      z:z-normal.z*layer*s.thickness,normal,u};
  }
  function revealPolygon(model) {
    const points=[],extent=model.diagonal*2;
    const width=model.settings.sheetWidth*(.2+.8*smooth(model.progress/.2));
    for(let i=0;i<=80;i++) {
      const v=-extent+extent*2*i/80;
      const u=Math.abs(v)>model.span ? -extent*2 : frontAt(model,v)-width*.5;
      points.push([model.origin.x+model.nx*u-model.ny*v,model.origin.y+model.ny*u+model.nx*v]);
    }
    for(const v of [extent,-extent])points.push([model.origin.x+model.nx*extent*2-model.ny*v,model.origin.y+model.ny*extent*2+model.nx*v]);
    return `polygon(${points.map(([x,y])=>`${x.toFixed(2)}px ${y.toFixed(2)}px`).join(",")})`;
  }

  const common=`
    precision highp float;
    uniform vec2 u_size,u_origin,u_direction;
    uniform float u_progress,u_travel,u_span,u_diagonal,u_amplitude;
    uniform float u_width,u_elevation,u_curvature,u_thickness,u_lighting,u_length;
    vec3 positionAt(float v,float q,out vec3 normal,out vec3 tangent) {
      float theta=3.14159265*(q+1.0);
      float width=u_width*(0.2+0.8*smoothstep(0.0,0.2,u_progress));
      float radius=u_elevation*0.6*u_curvature*u_amplitude;
      float front=u_travel-u_curvature*v*v/u_diagonal*(1.0-u_progress)*0.65;
      float u=front+width*0.5*q+radius*sin(theta);
      float z=u_elevation*u_amplitude*pow(sin(theta*0.5),2.0);
      float du=width*0.5+radius*3.14159265*cos(theta);
      float dz=u_elevation*u_amplitude*1.57079633*sin(theta);
      tangent=normalize(vec3(u_direction*du,dz));
      vec2 side=vec2(-u_direction.y,u_direction.x);
      float lateralSlope=-2.0*u_curvature*v/u_diagonal*(1.0-u_progress)*0.65;
      normal=normalize(vec3(-u_direction*dz+side*lateralSlope*dz,du));
      return vec3(u_origin+u_direction*u+side*v,z);
    }
    vec4 project(vec3 p) {
      float perspective=1800.0/(1800.0-p.z);
      vec2 pixel=(p.xy-u_size*0.5)*perspective+u_size*0.5;
      pixel.y-=p.z*0.65;
      vec2 clip=pixel/u_size*2.0-1.0;
      return vec4(clip.x,-clip.y,clamp(-p.z/400.0,-0.95,0.95),1.0);
    }
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  `;
  const meshVertex=`#version 300 es
    ${common}
    layout(location=0) in vec3 a_param;
    uniform float u_shadow;
    out vec3 v_normal;out vec2 v_uv;out float v_layer,v_height;
    void main(){
      vec3 normal,tangent;float v=a_param.x*u_span;
      vec3 p=positionAt(v,a_param.y,normal,tangent);
      p-=normal*a_param.z*u_thickness;
      v_normal=normal*(1.0-2.0*a_param.z);v_uv=vec2(v,a_param.y*u_width);
      v_layer=a_param.z;v_height=p.z;
      if(u_shadow>0.5){p.xy+=vec2(5.0,11.0)*u_amplitude;p.z=-2.0;}
      gl_Position=project(p);
    }
  `;
  const meshFragment=`#version 300 es
    ${common}
    uniform float u_shadow;
    in vec3 v_normal;in vec2 v_uv;in float v_layer,v_height;out vec4 color;
    void main(){
      float edge=1.0-smoothstep(u_span*0.96,u_span,abs(v_uv.x));
      if(u_shadow>0.5){color=vec4(0.18,0.12,0.025,edge*u_amplitude*u_lighting*0.16);return;}
      vec3 n=normalize(v_normal);
      float light=0.52+0.48*max(0.0,dot(n,normalize(vec3(-0.3,-0.5,1.0))));
      float grain=hash(floor(v_uv*2.4));
      vec3 top=mix(vec3(0.88,0.69,0.27),vec3(1.0,0.95,0.76),grain);
      vec3 underside=mix(vec3(0.43,0.29,0.065),vec3(0.72,0.55,0.2),grain);
      vec3 base=mix(top,underside,smoothstep(0.25,0.75,v_layer));
      color=vec4(base*mix(1.0,light,u_lighting),edge);
    }
  `;
  const furVertex=`#version 300 es
    ${common}
    layout(location=0) in vec4 a_seed;
    out float v_height,v_side,v_light,v_seed,v_edge;
    void main(){
      vec2 corners[6]=vec2[6](vec2(-1,0),vec2(1,0),vec2(-1,1),vec2(-1,1),vec2(1,0),vec2(1,1));
      vec2 corner=corners[gl_VertexID];
      float v=a_seed.x*u_span,q=a_seed.y;
      vec3 normal,tangent;vec3 p=positionAt(v,q,normal,tangent);
      vec3 across=vec3(-u_direction.y,u_direction.x,0);
      float sway=sin(a_seed.w*6.283+u_progress*9.0+q*3.0)*0.3;
      vec3 strand=normalize(normal+across*sway+tangent*(0.15+a_seed.z*0.28));
      float length=u_length*(0.65+a_seed.z*0.65);
      float compression=1.0-0.28*pow(abs(q),2.0);
      p+=strand*length*corner.y*compression;
      p+=across*corner.x*mix(0.55,0.07,corner.y);
      gl_Position=project(p);
      v_height=corner.y;v_side=corner.x;v_seed=a_seed.z;
      v_light=0.62+0.38*max(0.0,dot(normal,normalize(vec3(-0.3,-0.5,1.0))));
      v_edge=1.0-smoothstep(0.95,1.0,abs(a_seed.x));
    }
  `;
  const furFragment=`#version 300 es
    precision highp float;
    in float v_height,v_side,v_light,v_seed,v_edge;out vec4 color;
    void main(){
      vec3 root=mix(vec3(0.72,0.49,0.10),vec3(0.86,0.66,0.22),v_seed);
      vec3 middle=mix(vec3(0.98,0.84,0.46),vec3(1.0,0.92,0.65),v_seed);
      vec3 tip=mix(vec3(1.0,0.95,0.76),vec3(1.0,0.985,0.88),v_seed);
      vec3 fur=mix(root,middle,smoothstep(0.0,0.58,v_height));
      fur=mix(fur,tip,smoothstep(0.58,1.0,v_height));
      color=vec4(fur*v_light,(1.0-smoothstep(0.55,1.0,abs(v_side)))*v_edge*0.94);
    }
  `;

  function meshData(columns,rows) {
    const vertices=[];
    const add=(a,b,c)=>vertices.push(...a,...b,...c);
    for(let layer=0;layer<=1;layer++)for(let x=0;x<columns;x++)for(let y=0;y<rows;y++){
      const a=[x/columns*2-1,y/rows*2-1,layer],b=[(x+1)/columns*2-1,y/rows*2-1,layer];
      const c=[x/columns*2-1,(y+1)/rows*2-1,layer],d=[(x+1)/columns*2-1,(y+1)/rows*2-1,layer];
      add(a,b,c);add(c,b,d);
    }
    for(const q of [-1,1])for(let x=0;x<columns;x++){
      const a=[x/columns*2-1,q,0],b=[(x+1)/columns*2-1,q,0],c=[x/columns*2-1,q,1],d=[(x+1)/columns*2-1,q,1];add(a,b,c);add(c,b,d);
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
        this.dpr=Math.min(devicePixelRatio||1,small?1.15:1.5);
        this.canvas.width=Math.round(width*this.dpr);this.canvas.height=Math.round(height*this.dpr);
        this.meshProgram=program(gl,meshVertex,meshFragment);this.programs.push(this.meshProgram);
        this.furProgram=program(gl,furVertex,furFragment);this.programs.push(this.furProgram);
        const mesh=meshData(small?72:112,small?24:36);this.meshVertices=mesh.length/3;
        this.meshBuffer=this.buffer(mesh);
        this.fibers=Math.round((small?9000:26000)*clamp(this.options.furDensity,.35,1.8));
        const seeds=new Float32Array(this.fibers*4);
        const random=i=>{const n=Math.sin(i*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
        for(let i=0;i<this.fibers;i++){
          // Every prefix covers the whole sheet, so adaptive draw-count reduction
          // cannot remove an entire side of the fur-covered crest.
          seeds[i*4]=random(i+1)*2-1;
          const q=random(i+9)*2-1;
          seeds[i*4+1]=Math.sign(q)*Math.abs(q)**1.25;
          seeds[i*4+2]=random(i+45);seeds[i*4+3]=random(i+91);
        }
        this.furBuffer=this.buffer(seeds);
        this.bufferBytes=mesh.byteLength+seeds.byteLength;
        this.gpuBytes=this.bufferBytes+this.canvas.width*this.canvas.height*8;
        this.uniforms=new Map();
        for(const target of this.programs){const uniforms={};for(const name of ["size","origin","direction","progress","travel","span","diagonal","amplitude","width","elevation","curvature","thickness","lighting","length","shadow"])uniforms[name]=gl.getUniformLocation(target,`u_${name}`);this.uniforms.set(target,uniforms);}
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
        // Compile/validate the first draw before starting the visible frame clock.
        // Initialization latency is reported separately, not hidden in FPS.
        this.draw(0);
        this.initializationMs=performance.now()-start;
      }catch(error){this.dispose();throw error;}
    }
    buffer(data){const gl=this.gl,buffer=gl.createBuffer();this.buffers.push(buffer);resources.buffers++;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return buffer;}
    uniformsFor(target,model){const gl=this.gl,u=this.uniforms.get(target),s=this.options;gl.useProgram(target);
      gl.uniform2f(u.size,this.width,this.height);gl.uniform2f(u.origin,this.origin.x,this.origin.y);gl.uniform2f(u.direction,model.nx,model.ny);
      for(const [name,value]of Object.entries({progress:model.progress,travel:model.travel,span:model.span,diagonal:model.diagonal,amplitude:model.amplitude,width:s.sheetWidth,elevation:s.elevation,curvature:s.curvature,thickness:s.thickness,lighting:s.lighting,length:s.fiberLength}))gl.uniform1f(u[name],value);
    }
    draw(progress){if(this.disposed)return null;const gl=this.gl;
      const model=geometry(this.width,this.height,this.origin,this.options,progress);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      this.uniformsFor(this.meshProgram,model);gl.bindBuffer(gl.ARRAY_BUFFER,this.meshBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,0);
      gl.depthMask(false);gl.uniform1f(this.uniforms.get(this.meshProgram).shadow,1);gl.drawArrays(gl.TRIANGLES,0,this.meshVertices);
      gl.depthMask(true);gl.uniform1f(this.uniforms.get(this.meshProgram).shadow,0);gl.drawArrays(gl.TRIANGLES,0,this.meshVertices);
      this.uniformsFor(this.furProgram,model);gl.bindBuffer(gl.ARRAY_BUFFER,this.furBuffer);gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,1);
      const grownArea=clamp(model.span/(model.diagonal*1.2),.025,1)*(.2+.8*smooth(progress/.2));
      this.visibleFibers=Math.max(300,Math.round(this.fibers*grownArea));
      gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.visibleFibers);gl.vertexAttribDivisor(0,0);
      return model;
    }
    reduceQuality(){if(this.disposed)return;this.qualityReduced=true;this.fibers=Math.max(4000,Math.round(this.fibers*.7));this.canvas.width=Math.round(this.width);this.canvas.height=Math.round(this.height);this.gpuBytes=this.bufferBytes+this.canvas.width*this.canvas.height*8;}
    canRetarget(width,height,options){return !this.disposed && this.width===width && this.height===height && this.options.furDensity===(options.furDensity??defaults.furDensity);}
    retarget(container,origin,options){this.origin=origin;this.options={...defaults,...options};container.append(this.canvas);this.initializationMs=0;this.draw(0);}
    getStats(){return {meshVertices:this.meshVertices||0,fiberInstances:this.visibleFibers||0,fiberCapacity:this.fibers||0,gpuBytes:this.gpuBytes||0,initializationMs:this.initializationMs||0,temporaryCanvases:this.disposed?0:1,...resources};}
    dispose(){if(this.disposed)return;this.disposed=true;const gl=this.gl;
      if(gl){for(const buffer of this.buffers){gl.deleteBuffer(buffer);resources.buffers--;}for(const item of this.programs){gl.deleteProgram(item);resources.programs--;}
        this.canvas.removeEventListener("webglcontextlost",this.onLost);gl.getExtension("WEBGL_lose_context")?.loseContext();resources.contexts--;}
      this.gl=null;this.canvas.remove();
    }
  }
  window.DuckFurRibbon={FurSheet,defaults,geometry,sample,revealPolygon,resources};
})();
