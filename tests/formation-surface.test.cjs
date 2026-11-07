"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const code=fs.readFileSync(require.resolve("../landing/formation-surface.js"),"utf8");
test("formation captures destination panel structure with native text excluded",()=>{
  const paints=[];let color;
  const ctx={scale(){},save(){},restore(){},beginPath(){},roundRect(){},clip(){},
    set fillStyle(value){color=value;},fillRect(x,y,w,h){paints.push({color,x,y,w,h});}};
  const rect={left:100,top:200,width:400,height:250};
  const card={getBoundingClientRect:()=>({left:120,top:260,width:360,height:60})};
  const root={getBoundingClientRect:()=>rect,querySelectorAll(selector){assert.equal(selector,"[data-formation-surface]");return [card];}};
  const canvas={getContext:()=>ctx};
  const context={window:{},devicePixelRatio:1,document:{createElement:()=>canvas},getComputedStyle:node=>({
    backgroundColor:node===root?"#ecf5fa":"#fff",borderTopLeftRadius:"14px",borderLeftWidth:node===card?"4px":"0px",borderLeftColor:"#538fc5"})};
  vm.runInNewContext(code,context);
  const result=context.window.DuckFormation.capture(root,rect);
  assert.equal(result.width,400);assert.equal(result.height,250);
  assert.ok(paints.some(p=>p.color==="#fff" && p.x===20 && p.y===60 && p.w===360));
  assert.ok(paints.some(p=>p.color==="#538fc5" && p.x===20 && p.y===60 && p.w===4));
  assert.equal(typeof ctx.fillText,"undefined","this structure-only fixture does not request transient type colors");
});
test("formation retains target geometry and clips native content to scrollports",()=>{
  const dye=[];const ctx={scale(){},save(){},restore(){},beginPath(){},roundRect(){},clip(){},rect(){},fillRect(){},fill(){},stroke(){},fillText(value,x,y){dye.push({value,x,y});},measureText:()=>({fontBoundingBoxAscent:12})};
  const rootRect={left:10,top:20,width:300,height:180,right:310,bottom:200};
  const root={parentElement:null,getBoundingClientRect:()=>rootRect};
  const port={parentElement:root,getBoundingClientRect:()=>({left:20,top:60,width:200,height:80,right:220,bottom:140})};
  const label={parentElement:port,closest:()=>null,getBoundingClientRect:()=>({left:30,top:130,width:120,height:24})};
  const text={textContent:"Native label",parentElement:label};
  root.querySelectorAll=selector=>selector==="[data-formation-surface]"?[port]:[];
  const canvases=[];let yielded=false;
  const context={window:{},devicePixelRatio:1,document:{
    createElement(){const canvas={getContext:()=>ctx};canvases.push(canvas);return canvas;},
    createTreeWalker:()=>({nextNode:()=>yielded?null:(yielded=true,text)}),
    createRange:()=>({selectNodeContents(){},getClientRects:()=>[{left:30,top:130,width:120,height:24}]})
  },getComputedStyle:node=>({display:"block",visibility:"visible",color:"#111",fontSize:"16px",backgroundColor:"#fff",borderTopLeftRadius:"12px",overflowX:node===port?"auto":"visible",overflowY:node===port?"auto":"visible"})};
  vm.runInNewContext(code,context);const result=context.window.DuckFormation.capture(root,rootRect);
  assert.equal(result.formation.targets.length,2);
  assert.equal(result.formation.targets[1].parent,0);
  assert.equal(result.formation.targets[1].radius,12);
  const region=result.formation.contents[0];
  assert.equal(region.y,109);assert.equal(region.height,11,"line is clipped at scrollport bottom 140");
  assert.equal(result.formation.field.width,300);assert.equal(canvases.length,2);
  assert.deepEqual(dye,[{value:"Native label",x:20,y:122}],"transient dye typography uses actual native line position and font ascent");
});
