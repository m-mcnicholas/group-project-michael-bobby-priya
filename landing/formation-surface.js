(() => {
  "use strict";
  const nativeCache=new Map();
  // Temporary dye image and target geometry; final text and controls stay native.
  function capture(root,bounds,selector="[data-formation-surface]") {
    const canvas=document.createElement("canvas");
    const scale=Math.min(devicePixelRatio||1,1.25,1536/Math.max(bounds.width,bounds.height));
    canvas.width=Math.max(1,Math.round(bounds.width*scale));canvas.height=Math.max(1,Math.round(bounds.height*scale));
    const ctx=canvas.getContext("2d");if(!ctx)throw Error("Formation surface canvas unavailable");
    ctx.scale(scale,scale);ctx.fillStyle="#fff";ctx.fillRect(0,0,bounds.width,bounds.height);
    const surfaces=[root,...root.querySelectorAll(selector)].slice(0,768),targets=[],contents=[];
    const styles=new WeakMap(),rects=new WeakMap();
    const styleOf=node=>{if(!styles.has(node))styles.set(node,getComputedStyle(node));return styles.get(node);};
    const rectOf=node=>{if(!rects.has(node))rects.set(node,node.getBoundingClientRect());return rects.get(node);};
    for(const node of surfaces){
      const rect=rectOf(node),style=styleOf(node);
      if(!rect.width || !rect.height || style.visibility==="hidden" || style.display==="none" || rect.right<bounds.left || rect.left>bounds.left+bounds.width || rect.bottom<bounds.top || rect.top>bounds.top+bounds.height)continue;
      const x=rect.left-bounds.left,y=rect.top-bounds.top;
      const radius=Math.min(parseFloat(style.borderTopLeftRadius)||0,rect.width/2,rect.height/2);
      let clip={left:bounds.left,top:bounds.top,right:bounds.left+bounds.width,bottom:bounds.top+bounds.height};
      let depth=0;for(let parent=node.parentElement;parent && parent!==root;parent=parent.parentElement)depth++;
      const target={x,y,width:rect.width,height:rect.height,radius,depth,parent:targets.findLastIndex(t=>t.node===node.parentElement),background:style.backgroundColor,borders:{},clip,node};
      ctx.save();
      // Respect scrollports: offscreen calendar rows must not paint over headers.
      for(let parent=node.parentElement;parent && parent!==root.parentElement;parent=parent.parentElement){
        const ps=styleOf(parent),pr=rectOf(parent);
        if(/auto|scroll|hidden|clip/.test(`${ps.overflowX} ${ps.overflowY}`)){
          clip={left:Math.max(clip.left,pr.left),top:Math.max(clip.top,pr.top),right:Math.min(clip.right,pr.right??pr.left+pr.width),bottom:Math.min(clip.bottom,pr.bottom??pr.top+pr.height)};
          ctx.beginPath();ctx.rect(pr.left-bounds.left,pr.top-bounds.top,pr.width,pr.height);ctx.clip();
        }
        if(parent===root)break;
      }
      ctx.beginPath();ctx.roundRect(x,y,rect.width,rect.height,radius);ctx.clip();
      ctx.fillStyle=style.backgroundColor;ctx.fillRect(x,y,rect.width,rect.height);
      for(const [side,bx,by,bw,bh] of [["Top",x,y,rect.width,parseFloat(style.borderTopWidth)||0],
        ["Bottom",x,y+rect.height-(parseFloat(style.borderBottomWidth)||0),rect.width,parseFloat(style.borderBottomWidth)||0],
        ["Left",x,y,parseFloat(style.borderLeftWidth)||0,rect.height],
        ["Right",x+rect.width-(parseFloat(style.borderRightWidth)||0),y,parseFloat(style.borderRightWidth)||0,rect.height]]){
        ctx.fillStyle=style[`border${side}Color`];target.borders[side]={color:ctx.fillStyle,width:side==="Top"||side==="Bottom"?bh:bw};if(bw && bh)ctx.fillRect(bx,by,bw,bh);
      }
      if(node.classList?.contains("calendar-slot")){
        ctx.fillStyle=style.getPropertyValue("--line").trim()||"#ead9ad";ctx.fillRect(x,y+rect.height-1,rect.width,1);
      }
      ctx.restore();targets.push(target);
    }
    // Semantic content regions use actual line boxes, never guessed glyph positions.
    if(document.createTreeWalker){
      const addContent=(item,node)=>{
        if(contents.length>=512)return;
        let left=Math.max(bounds.left,item.x+bounds.left),top=Math.max(bounds.top,item.y+bounds.top),right=Math.min(bounds.left+bounds.width,item.x+bounds.left+item.width),bottom=Math.min(bounds.top+bounds.height,item.y+bounds.top+item.height);
        for(let parent=node.parentElement;parent;parent=parent.parentElement){
          const style=styleOf(parent),rect=rectOf(parent);
          if(/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)){left=Math.max(left,rect.left);top=Math.max(top,rect.top);right=Math.min(right,rect.right??rect.left+rect.width);bottom=Math.min(bottom,rect.bottom??rect.top+rect.height);}
          if(parent===root)break;
        }
        if(right>left&&bottom>top)contents.push({...item,x:left-bounds.left,y:top-bounds.top,width:right-left,height:bottom-top});
      };
      const walker=document.createTreeWalker(root,4);let text;
      while((text=walker.nextNode())){
        if(!text.textContent.trim() || text.parentElement.closest("canvas,script,style,[aria-hidden='true'],.sr-only"))continue;
        const style=styleOf(text.parentElement);if(style.visibility==="hidden"||style.display==="none")continue;
        const range=document.createRange();range.selectNodeContents(text);
        const lines=[...range.getClientRects()];
        // Temporary dye colors include single-line type. Native DOM remains final.
        if(lines.length && style.color && ctx.fillText && ctx.measureText){
          ctx.save();
          for(let parent=text.parentElement;parent;parent=parent.parentElement){
            const ps=styleOf(parent),pr=rectOf(parent);
            if(/auto|scroll|hidden|clip/.test(`${ps.overflowX} ${ps.overflowY}`)){ctx.beginPath();ctx.rect(pr.left-bounds.left,pr.top-bounds.top,pr.width,pr.height);ctx.clip();}
            if(parent===root)break;
          }
          ctx.font=`${style.fontStyle||"normal"} ${style.fontWeight||400} ${style.fontSize||"16px"} ${style.fontFamily||"sans-serif"}`;
          ctx.letterSpacing=style.letterSpacing||"0px";ctx.fillStyle=style.color;ctx.textBaseline="alphabetic";
          const value=text.textContent.replace(/\s+/g," "),words=value.trim().split(" ");let word=0;
          for(const r of lines){
            let line=lines.length===1?value:"";
            if(lines.length>1){while(word<words.length){const candidate=line?line+" "+words[word]:words[word];if(line && ctx.measureText(candidate).width>r.width+1)break;line=candidate;word++;}}
            const metrics=ctx.measureText(line);ctx.fillText(line,r.left-bounds.left,r.top-bounds.top+(metrics.fontBoundingBoxAscent||parseFloat(style.fontSize)*.85));
          }ctx.restore();
        }
        for(const r of lines)if(r.width&&r.height)addContent({x:r.left-bounds.left-2,y:r.top-bounds.top-1,width:r.width+4,height:r.height+2,radius:2,kind:"text"},text.parentElement);
      }
      for(const node of root.querySelectorAll("button,input,select,textarea,img,svg")){
        const r=rectOf(node);
        const pile=node.querySelector?.("canvas.fur-canvas");
        if(pile && ctx.drawImage){
          window.DuckFur?.get(node)?.draw();const pr=rectOf(pile);
          ctx.drawImage(pile,pr.left-bounds.left,pr.top-bounds.top,pr.width,pr.height);
        }
        if(r.width&&r.height)addContent({x:r.left-bounds.left-3,y:r.top-bounds.top-3,width:r.width+6,height:r.height+6,radius:parseFloat(styleOf(node).borderTopLeftRadius)||4,kind:"control"},node);
      }
    }
    const field=document.createElement("canvas");field.width=canvas.width;field.height=canvas.height;
    const f=field.getContext("2d");f.scale(scale,scale);f.fillStyle="rgb(0,0,0)";f.fillRect(0,0,bounds.width,bounds.height);
    for(const t of targets.slice(1)){
      f.save();f.beginPath();f.rect?.(t.clip.left-bounds.left,t.clip.top-bounds.top,Math.max(0,t.clip.right-t.clip.left),Math.max(0,t.clip.bottom-t.clip.top));f.clip();
      f.fillStyle=`rgb(${Math.min(180,65+t.depth*12)},0,0)`;f.beginPath();f.roundRect(t.x,t.y,t.width,t.height,t.radius);f.fill?.();
      f.strokeStyle="rgb(90,255,0)";f.lineWidth=3;f.stroke?.();f.restore();
    }
    for(const c of contents){f.fillStyle="rgb(40,0,255)";f.beginPath();f.roundRect(c.x,c.y,c.width,c.height,Math.min(c.radius,c.height/2,c.width/2));f.fill?.();}
    canvas.formation={field,targets:targets.map(({node,...target})=>target),contents,bounds:{...bounds}};
    return canvas;
  }
  // Bounded transient native-paint proxy for the final resting plane. This is not
  // persisted application content; live HTML owns semantics and the final frame.
  async function captureNative(root,bounds,formation){
    const started=performance.now();
    const key=[bounds.left,bounds.top,bounds.width,bounds.height,devicePixelRatio,scrollX,scrollY,getComputedStyle(document.body).backgroundImage,root.innerHTML.replace(/fur-(hovered|pressed)/g,"")].join("|");
    if(nativeCache.has(key)){const canvas=nativeCache.get(key);nativeCache.delete(key);nativeCache.set(key,canvas);canvas.formation=formation;canvas.captureMs=performance.now()-started;canvas.cacheHit=true;return canvas;}
    const copy=root.cloneNode(true),originals=[root,...root.querySelectorAll("*")],copies=[copy,...copy.querySelectorAll("*")];
    if(originals.length>4096)throw Error("Native proxy exceeds node budget");
    const properties="display position isolation contain filter backdrop-filter box-sizing width height min-width min-height max-width max-height margin padding top right bottom left overflow overflow-x overflow-y border border-radius border-top border-bottom border-left border-right background-color background-image background-size background-position background-repeat box-shadow color font font-family font-size font-weight font-style line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent white-space word-break overflow-wrap vertical-align opacity visibility z-index flex flex-direction flex-wrap align-items align-content align-self justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow grid-auto-rows float clear object-fit transform transform-origin clip-path".split(" ");
    for(let i=0;i<originals.length;i++){
      const original=originals[i],node=copies[i],r=original.getBoundingClientRect();
      if(!r.width || !r.height || r.bottom<bounds.top || r.top>bounds.top+bounds.height || r.right<bounds.left || r.left>bounds.left+bounds.width){node.remove();continue;}
      const style=getComputedStyle(original);
      node.removeAttribute("id");node.removeAttribute("autofocus");
      if(original.matches("script,style,dialog,.material-transition-layer")){node.remove();continue;}
      for(const key of properties){const value=style.getPropertyValue(key);if(value && !/url\(/i.test(value))node.style.setProperty(key,value);}
      if(/url\(/i.test(style.backgroundImage))node.style.backgroundImage="none";
      node.removeAttribute("srcset");
      node.style.setProperty("animation","none");node.style.setProperty("transition","none");node.style.setProperty("caret-color","transparent");
      if(original.tagName==="CANVAS"){
        const image=document.createElement("img"),surface=window.DuckFur?.get(original.parentElement);image.src=surface?.captureRestFrame?.()||original.toDataURL();image.style.cssText=node.style.cssText;node.replaceWith(image);
      }else if(original.tagName==="IMG" && original.src && !original.src.startsWith("data:")){node.removeAttribute("src");}
      if(original.scrollTop || original.scrollLeft){
        // Scrollport children retain their native offset, without scrolling the page.
        const content=document.createElement("div");while(node.firstChild)content.append(node.firstChild);content.style.cssText=`transform:translate(${-original.scrollLeft}px,${-original.scrollTop}px)`;node.append(content);
      }
    }
    const rect=root.getBoundingClientRect(),sx=scrollX,sy=scrollY;
    Object.assign(copy.style,{position:"absolute",left:`${rect.left+sx}px`,top:`${rect.top+sy}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:"0",transform:"none"});
    const outer=document.createElement("div"),body=getComputedStyle(document.body);
    outer.setAttribute("xmlns","http://www.w3.org/1999/xhtml");
    outer.style.cssText=`position:relative;width:${document.documentElement.clientWidth}px;height:${Math.max(innerHeight,document.body.scrollHeight)}px;background-color:${body.backgroundColor};background-image:${body.backgroundImage};font:${body.font};color:${body.color};`;
    outer.append(copy);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}"><foreignObject x="${-bounds.left-sx}" y="${-bounds.top-sy}" width="${document.documentElement.clientWidth}" height="${Math.max(innerHeight,document.body.scrollHeight)}">${new XMLSerializer().serializeToString(outer)}</foreignObject></svg>`;
    const url="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
    try{
      const image=new Image();await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error("Native proxy decode timeout")),1500);image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(Error("Native proxy unavailable"));};image.src=url;});
      const canvas=document.createElement("canvas"),scale=Math.min(devicePixelRatio||1,1.5,2048/Math.max(bounds.width,bounds.height));
      canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
      const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.getImageData(0,0,1,1); // Detect taint before upload.
      canvas.formation=formation;canvas.nativeProxy=true;canvas.captureMs=performance.now()-started;canvas.cacheHit=false;
      nativeCache.set(key,canvas);if(nativeCache.size>2)nativeCache.delete(nativeCache.keys().next().value);
      return canvas;
    }finally{/* Inline SVG holds no object URL or persistent resource. */}
  }
  window.DuckFormation={capture,captureNative};
})();
