"""
Convert a .blend into a .glb for the Knowledge Library / web viewer.
  blender -b --factory-startup --python-exit-code 1 -P scripts/from_blend.py -- <in.blend> <out.glb>
Exports all mesh objects (cameras/lights are skipped), modifiers applied.
"""
import sys
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 2:
    print("usage: from_blend.py -- <in.blend> <out.glb>")
    sys.exit(2)
src, dst = Path(argv[0]), Path(argv[1])
bpy.ops.wm.open_mainfile(filepath=str(src))
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("no mesh objects in file")
    sys.exit(4)
dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(dst), export_format="GLB", use_selection=False, export_apply=True, export_cameras=False, export_lights=False)
print(f"OK {dst} meshes={len(meshes)}")
