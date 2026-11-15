"""
Convert a .glb/.fbx into a clean .blend.

Run by the KaytoCraft server with Blender in background mode:
  blender -b --factory-startup --python-exit-code 1 -P scripts/to_blend.py -- <in.glb|in.fbx> <out.blend> [name]

What it does:
  - with scripts/blend_template.blend present (or KC_BLEND_TEMPLATE): opens that studio file
    (cameras, lights, HDR, background) and drops the model into its "Put your object here"
    collection, at the sample object's place, size and angle; colours snap to the file's own
    palette materials (textured parts keep their texture, glass becomes the crystal material)
  - otherwise starts from an empty scene (no default cube/camera/light)
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

import os

tpl = Path(os.environ.get("KC_BLEND_TEMPLATE") or Path(__file__).with_name("blend_template.blend"))
use_tpl = tpl.is_file()
if use_tpl:
    bpy.ops.wm.open_mainfile(filepath=str(tpl))
    scene = bpy.context.scene
    col = next((c for c in bpy.data.collections if "put your object" in c.name.lower()), None)
    if col is None:
        col = bpy.data.collections.new(name)
        scene.collection.children.link(col)
    palette = [m for m in bpy.data.materials if m.asset_data is not None]
else:
    # Empty scene.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    palette = []


def find_layer(lc, target):
    if lc.collection is target:
        return lc
    for ch in lc.children:
        f = find_layer(ch, target)
        if f:
            return f
    return None


bpy.context.view_layer.active_layer_collection = find_layer(bpy.context.view_layer.layer_collection, col)

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
    mn = mx = Vector((0, 0, 0))

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

if use_tpl:
    # Same place and angle as the template's sample object, sized to fill ~78% of the camera frame.
    center = Vector(col.get("kc_center", (0, 0, 0)))
    sample = Vector(col.get("kc_size", (4, 4, 4)))
    cam = scene.camera
    if cam and cam.data.type == "ORTHO":
        limit_w = limit_h = cam.data.ortho_scale * 0.78
    else:
        limit_w, limit_h = sample.x, sample.z
    root.rotation_euler = (0, 0, float(col.get("kc_rot_z", 0.0)))

    def box():
        bpy.context.view_layer.update()
        q = [o.matrix_world @ Vector(c) for o in imported if o.type == "MESH" for c in o.bound_box]
        if not q:
            return None
        return (Vector((min(p.x for p in q), min(p.y for p in q), min(p.z for p in q))),
                Vector((max(p.x for p in q), max(p.y for p in q), max(p.z for p in q))))

    bb = box()
    if bb:
        lo, hi = bb
        k = min(limit_w / max(hi.x - lo.x, 1e-6), limit_h / max(hi.z - lo.z, 1e-6))
        root.scale = (k, k, k)
        lo, hi = box()
        root.location += center - (lo + hi) / 2

    # Colours -> nearest palette material (perceptual distance), so every model shares one look.
    def lab(rgb):
        def lin2srgb(c):
            c = max(0.0, min(1.0, c))
            return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

        def inv(c):
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

        r, g, b = (inv(lin2srgb(c)) for c in rgb[:3])
        x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
        y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
        f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
        fx, fy, fz = f(x), f(y), f(z)
        return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

    def principled(m):
        if not (m and m.use_nodes):
            return None
        return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)

    APP_MATS = {"wood", "metal", "gold", "plastic", "glass", "ceramic", "leather", "fabric", "marble", "stone", "rattan", "rubber", "paper"}
    skip = ("dots stroke",)
    swatches = []
    crystal = None
    for m in palette:
        if m.name.lower().startswith("simple crystal") and crystal is None:
            crystal = m
        b = principled(m)
        if b and not any(m.name.lower().startswith(s_) for s_ in skip) and "." not in m.name:
            swatches.append((m, lab(b.inputs["Base Color"].default_value)))

    swapped = {}
    for o in imported:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            b = principled(m)
            if not b:
                continue
            base_rgb = tuple(b.inputs["Base Color"].default_value)
            if b.inputs["Base Color"].is_linked:
                # KaytoCraft's own generated textures (wood, fabric…) follow the palette too;
                # real textures (Tripo, imports) are kept as they are.
                src_node = b.inputs["Base Color"].links[0].from_node
                if src_node.type != "TEX_IMAGE" or not src_node.image or m.name.split("_")[0].split(".")[0].lower() not in APP_MATS:
                    continue
                px = list(src_node.image.pixels)
                n = len(px) // 4 or 1
                avg = [sum(px[i::4]) / n for i in range(3)]
                base_rgb = tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in avg)
            if m.name in swapped:
                slot.material = swapped[m.name]
                continue
            emit = b.inputs.get("Emission Strength")
            if emit is not None and emit.default_value > 0 and any(v > 0.01 for v in b.inputs["Emission Color"].default_value[:3]):
                continue  # light sources (lamp bulbs) keep their glow
            alpha = b.inputs["Alpha"].default_value
            trans = b.inputs["Transmission Weight"].default_value if "Transmission Weight" in b.inputs else 0
            if crystal and (alpha < 0.6 or trans > 0.5):
                pick = crystal
            elif swatches:
                c = lab(base_rgb)
                # hue/chroma count more than lightness: the palette is bright, models are often darker
                pick = min(swatches, key=lambda s_: (0.45 * (c[0] - s_[1][0])) ** 2 + (c[1] - s_[1][1]) ** 2 + (c[2] - s_[1][2]) ** 2)[0]
            else:
                continue
            swapped[m.name] = pick
            slot.material = pick
    for m in list(bpy.data.materials):
        if m.users == 0 and m.asset_data is None:
            bpy.data.materials.remove(m)
    print("palette:", {k: v.name for k, v in swapped.items()})
else:
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
