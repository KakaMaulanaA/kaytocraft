"""
Convert a .glb/.fbx into a clean .blend.

Run by the KaytoCraft server with Blender in background mode:
  blender -b --factory-startup --python-exit-code 1 -P scripts/to_blend.py -- <in.glb|in.fbx> <out.blend> [name]

What it does:
  - starts from an empty scene (no default cube/camera/light)
  - imports the model into a collection named after the asset
  - groups everything under one empty "<name>_Root" sitting on the floor at the origin
  - packs textures inside the .blend so the file is self-contained
"""

import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 2:
    print("usage: to_blend.py -- <in> <out.blend> [name]")
    sys.exit(2)

src, dst = Path(argv[0]), Path(argv[1])
name = (argv[2] if len(argv) > 2 else src.stem).strip() or "Model"

# Empty scene.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0

col = bpy.data.collections.new(name)
scene.collection.children.link(col)
layer_col = bpy.context.view_layer.layer_collection.children[col.name]
bpy.context.view_layer.active_layer_collection = layer_col

before = set(bpy.data.objects)
ext = src.suffix.lower()
if ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=str(src))
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=str(src))
else:
    print(f"unsupported format: {ext}")
    sys.exit(3)
imported = [o for o in bpy.data.objects if o not in before]
if not imported:
    print("nothing imported")
    sys.exit(4)

# Make sure everything lives in our collection.
for o in imported:
    for c in list(o.users_collection):
        if c is not col:
            c.objects.unlink(o)
    if col not in o.users_collection:
        col.objects.link(o)

# Parent top-level objects to a single root empty placed at the bottom-center of the model.
from mathutils import Vector

bpy.context.view_layer.update()
pts = []
for o in imported:
    if o.type == "MESH":
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
if pts:
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    base = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
else:
    base = Vector((0, 0, 0))

root = bpy.data.objects.new(f"{name}_Root", None)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = 0.25
col.objects.link(root)
for o in imported:
    if o.parent is None:
        mw = o.matrix_world.copy()
        o.parent = root
        o.matrix_world = mw
# Move the whole thing so its base sits on the world origin.
for o in imported:
    if o.parent is root:
        o.location -= base

# Smooth shading on curved meshes keeps the look from the web viewer.
for o in imported:
    if o.type == "MESH" and len(o.data.polygons) > 0:
        o.data.shade_smooth_by_angle(angle=0.6) if hasattr(o.data, "shade_smooth_by_angle") else None

# Add a camera + light so the file renders right away.
cam_data = bpy.data.cameras.new("Camera")
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
size = max((mx - mn).length if pts else 2.0, 0.5)
cam.location = (size * 1.2, -size * 1.5, size * 0.9)
direction = Vector((0, 0, size * 0.3)) - Vector(cam.location)
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
light_data = bpy.data.lights.new("Sun", type="SUN")
light_data.energy = 3.0
light = bpy.data.objects.new("Sun", light_data)
light.rotation_euler = (0.8, 0.2, 0.6)
scene.collection.objects.link(light)

try:
    bpy.ops.file.pack_all()
except Exception as e:  # nothing to pack is fine
    print("pack_all:", e)

dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(dst), compress=True)
print(f"OK {dst} objects={len(imported)}")
