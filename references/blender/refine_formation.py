"""Add measured-in-scene panel colors to the same fur and filled substrate."""
import bpy, os, numpy as np
scene=bpy.data.scenes['DuckPlan Fur Reference']
out=os.path.dirname(os.path.abspath(__file__))
fur=scene.objects['Dense short down — simulated reference'];body=scene.objects['Filled sheet body']
# The reference uses an illustrative background, three cards and their borders.
def region(x,y):
    if -.135<x<.135:
        for center in [-.055,0,.055]:
            if abs(y-center)<.020:
                return 2 if abs(y-center)>.0185 or x<-.132 else 1
    return 0
palette=[(.79,.88,.93),(.98,.985,.97),(.32,.48,.59)]
base=[(.72,.61,.40),(.98,.86,.60),(1,.96,.79)]
def mat(name,start,end):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');n.inputs['Roughness'].default_value=.72
    n.inputs['Base Color'].default_value=(*start,1);n.inputs['Base Color'].keyframe_insert('default_value',frame=65)
    n.inputs['Base Color'].default_value=(*end,1);n.inputs['Base Color'].keyframe_insert('default_value',frame=101)
    return m
# Fixed material-space coordinates keep rectangular panels rectangular through
# the radial tessellation; per-face colors would create misleading polar bands.
image=bpy.data.images.new('DuckPlan illustrative destination field',width=640,height=360,alpha=True)
pixels=np.zeros((360,640,4),dtype=np.float32)
for j in range(360):
    for i in range(640):pixels[j,i]=(*palette[region((i+.5)/640*.32-.16,(j+.5)/360*.18-.09)],1)
image.pixels.foreach_set(pixels.ravel());image.pack()
def field_mat(name,start,mult=1):
    m=bpy.data.materials.new(name);m.use_nodes=True;nodes=m.node_tree.nodes;links=m.node_tree.links
    bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');bsdf.inputs['Roughness'].default_value=.72
    tex=nodes.new('ShaderNodeTexImage');tex.image=image
    mix=nodes.new('ShaderNodeMixRGB');mix.inputs[1].default_value=(*start,1);links.new(tex.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bsdf.inputs['Base Color'])
    mix.inputs[0].default_value=0;mix.inputs[0].keyframe_insert('default_value',frame=65);mix.inputs[0].default_value=1;mix.inputs[0].keyframe_insert('default_value',frame=101)
    return m
fur.data.materials.clear()
for j in range(3):fur.data.materials.append(field_mat(f'Duck mapped pile {j}',base[j]))
uv=fur.data.uv_layers.active or fur.data.uv_layers.new()
N=len(fur.data.vertices)//44
for i,p in enumerate(fur.data.polygons):
    strand=i//8 if i<N*8 else (i-N*8)//6
    root=fur.data.shape_keys.key_blocks[0].data[strand*44].co
    p.material_index=(i%4)//2+1
    for loop in p.loop_indices:uv.data[loop].uv=((root.x+.16)/.32,(root.y+.09)/.18)
body.data.materials.clear();body.data.materials.append(field_mat('Duck mapped substrate',(1,.91,.63)))
uv=body.data.uv_layers.active or body.data.uv_layers.new();final=body.data.shape_keys.key_blocks['Body frame 166']
for p in body.data.polygons:
    p.material_index=0
    for loop in p.loop_indices:
        pos=final.data[body.data.loops[loop].vertex_index].co;uv.data[loop].uv=((pos.x+.16)/.32,(pos.y+.09)/.18)
for ob in [fur,body,scene.objects['Rooted contact probe — segment constraints']]:
    keys=list(ob.data.shape_keys.key_blocks)[1:]
    for i,k in enumerate(keys):k.value=1 if i==len(keys)-1 else 0;k.keyframe_insert('value',frame=271)
scene['formation_reference']='Same opaque fibers and substrate acquire background/card/border colors, then uniformly flatten; illustrative layout only.'
scene.frame_set(101)
bpy.data.libraries.write(os.path.join(out,'duckplan-fur-reference.blend'),{scene},fake_user=True,compress=True)
for frame,name in [(96,'dyed-reference.png'),(166,'flat-reference.png')]:
    scene.frame_set(frame);scene.render.filepath=os.path.join(out,name);bpy.ops.render.render(write_still=True,scene=scene.name)
print('Panel colors and final held frame repaired; separate reference saved.')
