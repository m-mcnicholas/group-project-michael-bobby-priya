"""Run inside Blender 4.5 through MCP. Separate scene; never overwrite the open file.
Custom reduced spring + rooted segment/contact simulation, not native hair dynamics.
Scale: one CSS pixel = 1 mm for reference only. No browser asset dependency.
"""
import bpy, numpy as np, math, json, csv, os
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
if bpy.data.scenes.get('DuckPlan Fur Reference'):
    old=bpy.data.scenes['DuckPlan Fur Reference']
    if '240 Hz custom' not in old.get('reference_method',''):raise RuntimeError('Refusing to replace a non-generated scene')
    bpy.context.window.scene=next(s for s in bpy.data.scenes if s!=old)
    for ob in list(old.objects):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.scenes.remove(old)
original_scene=bpy.context.scene
scene=bpy.data.scenes.new('DuckPlan Fur Reference')
scene.render.engine=original_scene.render.engine
scene.render.resolution_x=1000; scene.render.resolution_y=700; scene.render.resolution_percentage=100
scene.render.fps=60;scene.frame_start=1;scene.frame_end=271
scene.world=bpy.data.worlds.new('DuckPlan Studio World');scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.75,.78,.84,1);bg.inputs[1].default_value=.12
scene.view_settings.exposure=-.7
if hasattr(scene,'eevee') and hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=32
scene['reference_method']='240 Hz custom reduced spring integration; rooted segment constraint/contact probe; baked mesh shape keys. Not native hair simulation and not biological validation.'
scene['source_project_preserved']=True
rng=np.random.default_rng(728)

def material(name,color,rough=.65):
    m=bpy.data.materials.new(name);m.use_nodes=True
    node=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=rough
    return m
cream=[material('Duck down roots',(.72,.61,.40)),material('Duck down middles',(.98,.86,.60)),material('Duck down tips',(1,.96,.79))]
blue=[material('UI roots',(.48,.59,.63)),material('UI middles',(.84,.91,.94)),material('UI tips',(.97,.99,1))]
base_mat=material('Ivory pile body',(1,.91,.63));groundmat=material('Studio ground',(.19,.22,.27));contactmat=material('Contact tool',(.25,.32,.4))

def mesh_obj(name,verts,faces,mats):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new(name,mesh);scene.collection.objects.link(ob)
    for m in mats:mesh.materials.append(m)
    return ob

def key(ob,name,coords,frame):
    if not ob.data.shape_keys:ob.shape_key_add(name='Basis')
    k=ob.shape_key_add(name=name);k.data.foreach_set('co',np.asarray(coords,dtype=np.float32).ravel())
    for f,value in [(max(1,frame-1),0),(frame,1),(min(271,frame+1),0)]:k.value=value;k.keyframe_insert('value',frame=f)
    return k
# Seeded short double-ribbon strands; fixed roots, no global density increase.
N=4000; roots=rng.uniform([-.16,-.09],[.16,.09],(N,2));lengths=rng.uniform(.0036,.0056,N)
angles=rng.uniform(0,2*np.pi,N); directions=np.stack([np.cos(angles),np.sin(angles)],axis=1)
contact=np.array([-.045,-.015]);dist=np.linalg.norm(roots-contact,axis=1);radial=(roots-contact)/np.maximum(dist[:,None],1e-9)
inside=(np.maximum(np.abs(roots[:,0])-.058,0)**2+roots[:,1]**2)<.022**2
state=np.zeros((N,4));velocity=state.copy();target=state.copy();seed=rng.uniform(0,1,N)
# Growth arrival is measured from the same quintic-Hermite front used visually.
reach=.26
soft=lambda t:(np.clip(t,0,1)**3*(np.clip(t,0,1)*(np.clip(t,0,1)*6-15)+10))
def radius(t):
    u=np.clip((t-.12)/.55,0,1);return reach*soft(u)+.55*.54*(u-6*u**3+8*u**4-3*u**5)
lo=np.zeros(N);hi=np.ones(N)*.55
for _ in range(30):
    mid=(lo+hi)/2;choose=radius(mid+.12)<dist;lo=np.where(choose,mid,lo);hi=np.where(choose,hi,mid)
arrival=hi+.12
arrival=np.where(inside,.06,arrival)
frames=[1,5,10,18,29,41,56,73,96,126,166,211,271];snapshots={};rows=[]
held=np.zeros(N);activated=np.zeros(N,dtype=bool)
for step in range(1081):
    t=step/240;dt=1/240
    fresh=(t>=arrival)&~activated;activated|=fresh
    profile=np.clip(1-dist/.045,0,1)
    # Central contact compresses; neighboring fibers splay with seeded tangential variation.
    target[fresh,0]=(.42+.22*profile[fresh]);target[fresh,1]=np.sin(angles[fresh]*2)*.07
    target[fresh,2]=.3+.58*profile[fresh]**2;target[fresh,3]=.22+.62*profile[fresh]**3
    held[fresh]=.28
    pressed=inside&(t>=.06)&(t<.12);held=np.where(pressed,.28,np.maximum(0,held-dt))
    decay=(held<=0)&~pressed
    for c,rate in enumerate([4.6+seed*1.8,4.6+seed*1.8,3.8+seed*1.4,3.25+seed*1.1]):target[:,c]*=np.where(decay,np.exp(-dt*rate),1)
    velocity+=(62*np.array([1,1,1,.82])*(target-state)-22*velocity)*dt;state+=velocity*dt
    state[:,:2]=np.clip(state[:,:2],-1.35,1.35);state[:,2:]=np.clip(state[:,2:],-.08,1)
    if step%4==0:
        i=int(np.argmin(dist));rows.append([t,*state[i],*velocity[i],held[i]])
    frame=round(t*60)+1
    if frame in frames and frame not in snapshots:snapshots[frame]=(t,state.copy())

def strand_vertices(t,states):
    front=radius(t);flat=float(soft((t-2.1)/.6));grown=soft((front-dist)/.002)
    visible=np.maximum(grown,inside.astype(float))
    merge=float(soft((front-.08)/.05));source_height=.0015*inside*(1-merge)
    zbody=.0015*(1-flat)+source_height
    # One shoulder and rolling crest, filled behind it. No second flatten front.
    crest=np.exp(-((dist-(front-.012))/.009)**2)*min(front*.25,.012)*(1-flat) if t<.7 else np.zeros(N)
    rootz=zbody+crest
    bend=radial*states[:,0,None]+np.stack([-radial[:,1],radial[:,0]],axis=1)*states[:,1,None]+directions*.1
    verts=[]
    for ribbon in range(2):
        side=directions if ribbon==0 else np.stack([-directions[:,1],directions[:,0]],axis=1)
        for j in range(5):
            u=j/4;curve=u*u*(3-2*u)
            xy=roots+bend*lengths[:,None]*curve*.9*(1-flat)
            z=rootz+lengths*u*(1-.84*np.clip(states[:,2],0,1))*(1-flat)-lengths*.3*states[:,3]*curve*(1-flat)
            z=np.maximum(rootz+.00005,z)
            width=.000055*(1-u*.88)*visible
            for sign in [-1,1]:verts.append(np.column_stack([xy+side*width[:,None]*sign,z*visible]))
    # Fine paired barbs break up the broad-ribbon/grass appearance; every barb
    # follows the same rooted bending state instead of a second radial force.
    for j in range(3):
        u=.3+j*.2;curve=u*u*(3-2*u)
        stem=roots+bend*lengths[:,None]*curve*.9*(1-flat)
        z=rootz+lengths*u*(1-.84*np.clip(states[:,2],0,1))*(1-flat)-lengths*.3*states[:,3]*curve*(1-flat)
        z=np.maximum(rootz+.00005,z)
        for branch_sign in [-1,1]:
            branch_angle=angles+branch_sign*.85
            direction=np.stack([np.cos(branch_angle),np.sin(branch_angle)],axis=1)
            tip=stem+direction*lengths[:,None]*.18*(1-flat)
            tipz=z+lengths*.1*(1-flat)*(1-.8*np.clip(states[:,2],0,1))
            side=np.stack([-direction[:,1],direction[:,0]],axis=1)*.000025*visible[:,None]
            for xy,zz,w in [(stem,z,side),(stem,z,-side),(tip,tipz,side*.2),(tip,tipz,-side*.2)]:verts.append(np.column_stack([xy+w,zz*visible]))
    return np.stack(verts,axis=1).reshape(-1,3)
faces=[]
for i in range(N):
    for ribbon in range(2):
        for j in range(4):
            a=i*44+ribbon*10+j*2;faces.append((a,a+1,a+3,a+2))
for i in range(N):
    for j in range(6):a=i*44+20+j*4;faces.append((a,a+1,a+3,a+2))
fur=mesh_obj('Dense short down — simulated reference',strand_vertices(0,np.zeros((N,4))).tolist(),faces,cream+blue)
for i,p in enumerate(fur.data.polygons):p.material_index=(i%4)//2+1
fur.shape_key_add(name='Basis')
# Sparse samples are baked with crossfading keys, rather than recording an opaque movie.
for frame,(t,st) in snapshots.items():
    k=fur.shape_key_add(name=f'Sim frame {frame}');k.data.foreach_set('co',strand_vertices(t,st).astype(np.float32).ravel())
    index=frames.index(frame);prev=frames[max(0,index-1)];nxt=frames[min(len(frames)-1,index+1)]
    for f,value in [(prev,0),(frame,1),(nxt,0)]:k.value=value;k.keyframe_insert('value',frame=f)
# Opaque filled radial substrate behind the crest.
segments=96;rings=24
verts=[(contact[0],contact[1],.0001)];faces=[]
for j in range(1,rings+1):
    for a in range(segments):verts.append((contact[0]+math.cos(a/segments*2*math.pi)*reach*j/rings,contact[1]+math.sin(a/segments*2*math.pi)*reach*j/rings,.0001))
for a in range(segments):faces.append((0,1+a,1+(a+1)%segments))
for j in range(rings-1):
    for a in range(segments):x=1+j*segments+a;y=1+j*segments+(a+1)%segments;faces.append((x,y,y+segments,x+segments))
body=mesh_obj('Filled sheet body',verts,faces,[base_mat]);body.shape_key_add(name='Basis')
for frame,(t,st) in snapshots.items():
    coords=np.array(verts);delta=coords[:,:2]-contact;rr=np.linalg.norm(delta,axis=1);front=radius(t);factor=np.minimum(1,front/np.maximum(rr,1e-9));coords[:,:2]=contact+delta*factor[:,None]
    coords[:,:2]=np.clip(coords[:,:2],[-.16,-.09],[.16,.09])
    coords[:,2]+=(np.exp(-((rr*factor-(front-.012))/.009)**2)*min(front*.25,.012) if t<.7 else .0015)*(1-float(soft((t-2.1)/.6)))
    k=body.shape_key_add(name=f'Body frame {frame}');k.data.foreach_set('co',coords.astype(np.float32).ravel());idx=frames.index(frame)
    for f,value in [(frames[max(0,idx-1)],0),(frame,1),(frames[min(len(frames)-1,idx+1)],0)]:k.value=value;k.keyframe_insert('value',frame=f)
# Dye the same material, without alpha changes. Final UI palette is illustrative only.
for mats,colors in [(cream,[(.48,.59,.63),(.84,.91,.94),(.97,.99,1)])]:
    for m,col in zip(mats,colors):
        n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');n.inputs['Base Color'].keyframe_insert('default_value',frame=65);n.inputs['Base Color'].default_value=(*col,1);n.inputs['Base Color'].keyframe_insert('default_value',frame=101)
# Rooted segment contact probe: independent Verlet/PBD reference, no radial per-strand force.
M=64;grid=np.array([(x,y) for x in np.linspace(-.004,.004,8) for y in np.linspace(-.004,.004,8)])
rest=np.zeros((M,5,3));rest[:,:,:2]=grid[:,None,:];rest[:,:,2]=np.linspace(0,.005,5)
pos=rest.copy();old=pos.copy();held_rest=rest.copy();probe_snaps={};probe_rows=[]
for step in range(1081):
    t=step/240;dt=1/240;was=pos.copy();pos+=(pos-old)*math.exp(-22*dt);old=was
    contact_on=.06<=t<.3
    if abs(t-.3)<dt/2:held_rest=pos.copy()
    blend=float(soft((t-.58)/.7)) if t>=.3 else 1
    target_rest=held_rest*(1-blend)+rest*blend if t>=.3 else rest
    # Elastic bending about roots and segment-length constraints.
    pos+=(target_rest-pos)*.025
    for iteration in range(8):
        pos[:,0]=rest[:,0]
        for j in range(1,5):
            d=pos[:,j]-pos[:,j-1];length=np.linalg.norm(d,axis=1);corr=d*((length-.00125)/np.maximum(length,1e-9))[:,None]
            if j==1:pos[:,j]-=corr
            else:pos[:,j]-=corr*.5;pos[:,j-1]+=corr*.5
        if contact_on:
            sphere=np.array([0,0,.008-.004*float(soft((t-.06)/.13))]);d=pos-sphere;length=np.linalg.norm(d,axis=2);inside_s=length<.0045
            pos=np.where(inside_s[:,:,None],sphere+d/np.maximum(length[:,:,None],1e-9)*.0045,pos)
        pos[:,:,2]=np.maximum(0,pos[:,:,2]);pos[:,0]=rest[:,0]
    if step%4==0:probe_rows.append([t,float(np.mean(pos[:,-1,2])),float(np.max(np.linalg.norm(pos[:,-1,:2]-grid,axis=1))),float(np.max(np.abs(pos-old))/dt)])
    f=round(t*60)+1
    if f in frames and f not in probe_snaps:probe_snaps[f]=pos.copy()
probe_faces=[]
for i in range(M):
    for j in range(4):a=i*10+j*2;probe_faces.append((a,a+1,a+3,a+2))
def probe_verts(p):
    result=np.repeat(p,2,axis=1);result[:,::2,0]-=.0001;result[:,1::2,0]+=.0001;result[:,:,0]+=.205;return result.reshape(-1,3)
probe=mesh_obj('Rooted contact probe — segment constraints',probe_verts(rest).tolist(),probe_faces,[cream[1]]);probe.shape_key_add(name='Basis')
for f,p in probe_snaps.items():
    k=probe.shape_key_add(name=f'Contact frame {f}');k.data.foreach_set('co',probe_verts(p).astype(np.float32).ravel());idx=frames.index(f)
    for ff,value in [(frames[max(0,idx-1)],0),(f,1),(frames[min(len(frames)-1,idx+1)],0)]:k.value=value;k.keyframe_insert('value',frame=ff)
# Studio, camera and lighting in the separate reference scene.
ground=mesh_obj('Reference ground',[(-.5,-.4,-.002),(.5,-.4,-.002),(.5,.4,-.002),(-.5,.4,-.002)],[(0,1,2,3)],[groundmat])
def camera(name,location,target,lens):
    data=bpy.data.cameras.new(name);data.lens=lens;data.clip_start=.0001;ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=location;ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler();return ob
scene.camera=camera('DuckPlan reference camera',(.23,-.31,.39),(0,0,0),52)
probe_cam=camera('Contact probe camera',(.219,-.019,.023),(.205,0,.002),55)
for name,loc,power,size in [('Duck key',(-.15,-.12,.3),.8,.25),('Duck rim',(.16,.18,.22),.5,.18)]:
    data=bpy.data.lights.new(name,type=next(i.identifier for i in bpy.types.Light.bl_rna.properties['type'].enum_items if i.name=='Area'));data.energy=power;data.shape=next(i.identifier for i in data.bl_rna.properties['shape'].enum_items if i.name=='Disk');data.size=size;ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
with open(os.path.join(OUT,'spring-reference.csv'),'w') as f:w=csv.writer(f);w.writerow(['seconds','radial','tangent','compression','depression','vr','vt','vc','vd','remaining_hold']);w.writerows(rows)
with open(os.path.join(OUT,'contact-probe.csv'),'w') as f:w=csv.writer(f);w.writerow(['seconds','mean_tip_z_m','max_tip_splay_m','max_speed_m_s']);w.writerows(probe_rows)
summary={'method':scene['reference_method'],'strands':N,'probe_fibers':M,'steps_hz':240,'baked_frames':frames,'max_probe_splay_mm':max(r[2] for r in probe_rows)*1000,'min_mean_tip_height_mm':min(r[1] for r in probe_rows)*1000,'rest_tip_height_mm':5,'final_mean_tip_height_mm':probe_rows[-1][1]*1000,'reference_hold_ms':280,'file':'duckplan-fur-reference.blend'}
with open(os.path.join(OUT,'measurements.json'),'w') as f:json.dump(summary,f,indent=2)
scene.frame_set(41)
bpy.data.libraries.write(os.path.join(OUT,summary['file']),{scene},fake_user=True,compress=True)
print(json.dumps(summary))
