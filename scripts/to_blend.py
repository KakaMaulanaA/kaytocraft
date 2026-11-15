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
import bmesh
import math
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- clean, editable meshes
# The web builds parts as triangle soups (every vertex split, rounded boxes = ~600 triangles).
# Parts tagged by KaytoCraft ("kc" extras) are rebuilt as clean primitives — a box is 8 vertices /
# 6 quads + a Bevel modifier for the rounded edges, a cylinder has n-gon caps. Everything else is
# welded (merge by distance) and its triangles joined back into quads.

def _clear_custom_normals(me):
    for name in ("custom_normal",):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    if getattr(me, "has_custom_normals", False):
        try:
            me.normals_split_custom_set([(0.0, 0.0, 0.0)] * len(me.loops))
        except Exception:
            pass


def _sharp_by_angle(bm, angle=math.radians(30)):
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < angle
        else:
            e.smooth = False


def _kc(o):
    v = o.get("kc")
    if v is None and o.data is not None:
        v = o.data.get("kc")
    if v is None:
        return None
    try:
        return v.to_dict()
    except AttributeError:
        return dict(v) if isinstance(v, dict) else None


def _local_bounds(me):
    xs = [v.co for v in me.vertices]
    lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
    hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
    return lo, hi


def _swap_mesh(o, bm, name):
    new = bpy.data.meshes.new(name)
    bm.to_mesh(new)
    bm.free()
    for m in o.data.materials:
        new.materials.append(m)
    old = o.data
    o.data = new
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return new


def clean_part_as_box(o, me, size, center, bevel, seg=3):
    """8 vertices / 6 quads at the part's place, rounded edges as an editable Bevel modifier."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    for v in bm.verts:
        v.co = Vector((v.co.x * size.x, v.co.y * size.y, v.co.z * size.z)) + center
    for f in bm.faces:
        f.smooth = True
    _swap_mesh(o, bm, me.name)
    if bevel > 1e-5:
        mod = o.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = "NONE"
        mod.harden_normals = True
    else:
        for f in o.data.polygons:
            f.use_smooth = False
    return "box"


def clean_part(o):
    me = o.data
    if not me.vertices:
        return "empty"
    kc = _kc(o)
    lo, hi = _local_bounds(me)
    size, center = hi - lo, (hi + lo) / 2
    shape = (kc or {}).get("shape")
    if shape == "box":
        return clean_part_as_box(o, me, size, center, float(kc.get("bevel") or 0), int(kc.get("seg") or 3))
    if shape == "cyl":
        h = float(kc.get("h") or 0)
        r1, r2 = float(kc.get("rBottom") or 0), float(kc.get("rTop") or 0)
        seg = max(6, int(kc.get("seg") or 24))
        axis = min(range(3), key=lambda i: abs(size[i] - h))  # the height axis in Blender space
        if h > 0 and abs(size[axis] - h) < max(1e-4, h * 0.02):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h, calc_uvs=True)
            # glTF Y-up -> Blender: the cylinder axis may be Y; turn Z to the measured axis
            if axis == 1:
                bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "X"))
            elif axis == 0:
                bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
            bmesh.ops.translate(bm, verts=bm.verts, vec=center)
            _sharp_by_angle(bm)
            _swap_mesh(o, bm, me.name)
            return "cyl"
    # anything else: weld + quads + smooth by angle
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(1e-6, size.length * 1e-5))
    # Untagged (older models): a closed mesh that fills its bounding box is a (rounded) box.
    box_vol = size.x * size.y * size.z
    if box_vol > 0 and min(size) > 0 and all(e.is_manifold for e in bm.edges):
        ratio = abs(bm.calc_volume()) / box_vol
        if ratio > 0.93:
            # corner rounding: nearest vertex to a bounding-box corner sits r*(sqrt(3)-1) away
            corner = Vector((hi.x, hi.y, hi.z))
            d = min((v.co - corner).length for v in bm.verts)
            r = d / (math.sqrt(3) - 1) if d > 1e-6 else 0.0
            bm.free()
            return clean_part_as_box(o, me, size, center, r if r < min(size) / 2 else 0.0)
    bmesh.ops.join_triangles(
        bm, faces=bm.faces, cmp_seam=False, cmp_sharp=False, cmp_uvs=False, cmp_vcols=False, cmp_materials=True,
        angle_face_threshold=math.radians(2), angle_shape_threshold=math.radians(180),
    )
    _sharp_by_angle(bm)
    new = _swap_mesh(o, bm, me.name)
    _clear_custom_normals(new)
    return "weld"



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

cleaned = {}
for o in imported:
    if o.type == "MESH":
        try:
            k = clean_part(o)
        except Exception as e:  # never lose a part over a cleanup problem
            k = f"skip ({e.__class__.__name__})"
        cleaned[k] = cleaned.get(k, 0) + 1
print("clean:", cleaned)

# Make sure everything lives in our collection.
for o in imported:
    for c in list(o.users_collection):
        if c is not col:
            c.objects.unlink(o)
    if col not in o.users_collection:
        col.objects.link(o)

# Parent top-level objects to a single root empty placed at the bottom-center of the model.
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
        root["kc_display_scale"] = k  # enlarged to fit the camera; real size = scale / this
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
