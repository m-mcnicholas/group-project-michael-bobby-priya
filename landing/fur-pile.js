(() => {
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  // Experimental coarse pile coupling. A field cell, not a pairwise fiber
  // collision solver; stable roots and the approved per-fiber spring remain.
  class PileField {
    constructor(width,height,columns=32,rows=16){this.width=width;this.height=height;this.columns=columns;this.rows=rows;const n=columns*rows;this.data=new Float32Array(n*4);this.goal=new Float32Array(n*4);this.hold=new Float32Array(n);this.scratch=new Float32Array(n*4);}
    clear(){this.data.fill(0);this.goal.fill(0);this.hold.fill(0);}
    brush(x0,y0,x1,y1,radius,delay,strength=1){
      const dx=x1-x0,dy=y1-y0,l=Math.hypot(dx,dy);if(l<.2 || !strength)return;
      for(let y=0;y<this.rows;y++)for(let x=0;x<this.columns;x++){
        const px=(x+.5)/this.columns*this.width,py=(y+.5)/this.rows*this.height,t=clamp(((px-x0)*dx+(py-y0)*dy)/(l*l),0,1),d=Math.hypot(px-x0-dx*t,py-y0-dy*t)/radius;if(d>=1)continue;
        const i=y*this.columns+x,k=i*4,w=(1-d*d)**2;this.goal[k]=dx/l*w*.72*strength;this.goal[k+1]=dy/l*w*.72*strength;this.hold[i]=delay;this.data[k]+=(this.goal[k]-this.data[k])*.45;this.data[k+1]+=(this.goal[k+1]-this.data[k+1])*.45;
      }
    }
    press(x,y,radius,delay,strength=1){
      if(!strength)return;
      for(let row=0;row<this.rows;row++)for(let col=0;col<this.columns;col++){
        const dx=(col+.5)/this.columns*this.width-x,dy=(row+.5)/this.rows*this.height-y,d=Math.hypot(dx,dy)/radius;if(d>1.5)continue;
        const i=row*this.columns+col,k=i*4,ring=Math.exp(-(((d-.78)/.38)**2))*strength;
        this.goal[k+2]=Math.max(this.goal[k+2],ring*.46);this.goal[k+3]=Math.max(this.goal[k+3],Math.max(0,1-d*d)*.6*strength);this.hold[i]=delay;
      }
    }
    advance(dt){
      let energy=0;const cols=this.columns,rows=this.rows,old=this.data,next=this.scratch;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const i=y*cols+x,k=i*4;this.hold[i]=Math.max(0,this.hold[i]-dt);
        for(let c=0;c<4;c++){
          if(!this.hold[i])this.goal[k+c]*=Math.exp(-dt*(c<2?1.65:2.8));
          // Bounded nearest-cell coupling smooths group compression, not roots.
          const neighbors=(old[(y*cols+Math.max(0,x-1))*4+c]+old[(y*cols+Math.min(cols-1,x+1))*4+c]+old[(Math.max(0,y-1)*cols+x)*4+c]+old[(Math.min(rows-1,y+1)*cols+x)*4+c])*.25;
          const target=this.goal[k+c]*.86+neighbors*.14;
          let value=old[k+c]+(target-old[k+c])*(1-Math.exp(-dt*(c<2?12:18)));
          if(Math.abs(value)<.0001 && Math.abs(this.goal[k+c])<.0001)value=this.goal[k+c]=0;
          next[k+c]=clamp(value,c<2?-1:0,1);energy=Math.max(energy,Math.abs(next[k+c]));
        }
      }
      this.data=next;this.scratch=old;return energy;
    }
    sample(u,v){const x=clamp(u*this.columns-.5,0,this.columns-1),y=clamp(v*this.rows-.5,0,this.rows-1),a=Math.floor(x),b=Math.floor(y),f=x-a,g=y-b;
      return Array.from({length:4},(_,c)=>{const at=(i,j)=>this.data[(j*this.columns+i)*4+c];return (at(a,b)*(1-f)+at(Math.min(a+1,this.columns-1),b)*f)*(1-g)+(at(a,Math.min(b+1,this.rows-1))*(1-f)+at(Math.min(a+1,this.columns-1),Math.min(b+1,this.rows-1))*f)*g;});}
  }
  function corners(segments=1){const result=[];for(let i=0;i<segments;i++){const a=i/segments,b=(i+1)/segments;result.push(-1,a,1,a,-1,b,-1,b,1,a,1,b);}return new Float32Array(result);}
  function path(t,rest,bend,memory=[0,0],amount=1,pressure=0){const k=.38+(3.781135-.38)*clamp(pressure*1.4,0,1),w=t*t*(k+(1-k)*t),m=t*t*(3-2*t);return rest.map((v,i)=>v*t+bend[i]*(t*(1-amount)+w*amount)+memory[i]*m);}
  window.DuckPile={PileField,corners,path};
})();
