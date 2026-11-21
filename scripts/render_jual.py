"""
KAYTORENDER - Paket Siap Jual
=============================
Taruh file .blend dari KaytoCraft (yang sudah kamu perbaiki) di folder JUAL, lalu jalankan:
  - dobel-klik  Jalankan_Render_Jual.bat
  - atau di Blender: tab Scripting > Open > Render_Jual.py > Run Script

Untuk tiap .blend dibuat folder di OUTPUT_JUAL\\<nama>\\ berisi:
  renders\\  <nama>_1.png ... (semua kamera di file, latar transparan)
             <nama>_1_putih.jpg ... (latar putih, untuk thumbnail marketplace)
             <nama>_clay.png (render abu-abu: memperlihatkan bentuk/topologi)
  model\\    <nama>.blend, <nama>.glb, <nama>.fbx, <nama>.obj (+ .mtl)
  INFO.txt   jumlah tris, ukuran, material, format, versi Blender
dan <nama>.zip (siap diunggah). Terakhir: COVER_PAKET.jpg berisi semua barang.

Render.py lama (DAY/NIGHT untuk interior) tidak diubah.
"""

import bpy
import os
import sys
import math
import zipfile

import numpy as np

# ================= PENGATURAN =================
BASE = os.path.dirname(os.path.abspath(__file__))
FOLDER_INPUT = os.path.join(BASE, "JUAL")
FOLDER_OUTPUT = os.path.join(BASE, "OUTPUT_JUAL")
RESOLUSI = 2048          # px, persegi (HD: diterima semua marketplace, tajam saat di-zoom)
SAMPLES = 128            # kualitas render Cycles (naikkan untuk hasil lebih halus)
PAKAI_GPU = True
RENDER_CLAY = True
FORMAT_EKSPOR = ["glb", "fbx", "obj"]
# ===============================================

# Opsional dari command line:
#   ... -- <folder_input> <folder_output> [samples] [resolusi]
#   ... -- --file <file.blend> <folder_output> [samples] [resolusi]   (satu file; dipakai web KaytoCraft)
SATU_FILE = None
if "--" in sys.argv:
    extra = sys.argv[sys.argv.index("--") + 1 :]
    if extra and extra[0] == "--file":
        SATU_FILE = extra[1]
        extra = [os.path.dirname(SATU_FILE)] + extra[2:]
    if len(extra) > 0: FOLDER_INPUT = extra[0]
    if len(extra) > 1: FOLDER_OUTPUT = extra[1]
    if len(extra) > 2: SAMPLES = int(extra[2])
    if len(extra) > 3: RESOLUSI = int(extra[3])


def set_gpu_rendering(scene, use_gpu=True):
    """Sama seperti Render.py: pakai GPU kalau ada, kalau tidak CPU."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type != "CPU"]
        if use_gpu and gpus:
            for d in prefs.devices:
                d.use = d.type != "CPU"
            prefs.compute_device_type = gpus[0].type
            scene.cycles.device = "GPU"
            return
    except Exception as e:
        print("GPU tidak bisa dipakai:", e)
    scene.cycles.device = "CPU"


def objek_barang():
    """Objek di koleksi 'Put your object here' (template KaytoCraft); kalau tidak ada, semua mesh."""
    col = next((c for c in bpy.data.collections if "put your object" in c.name.lower()), None)
    objs = list(col.all_objects) if col else [o for o in bpy.context.scene.objects if o.type == "MESH"]
    return objs


def pilih(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        if o.name in bpy.context.view_layer.objects:
            o.select_set(True)
    meshes = [o for o in objs if o.type == "MESH"]
    if meshes:
        bpy.context.view_layer.objects.active = meshes[0]


def latar_putih(png_path, jpg_path):
    """Versi latar putih dari render transparan."""
    img = bpy.data.images.load(png_path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    a = px[:, 3:4]
    px[:, :3] = px[:, :3] * a + (1 - a)
    px[:, 3] = 1.0
    new = bpy.data.images.new("putih", w, h, alpha=False)
    new.pixels.foreach_set(px.ravel())
    new.filepath_raw = jpg_path
    new.file_format = "JPEG"
    new.save()
    bpy.data.images.remove(new)
    bpy.data.images.remove(img)


def info_barang(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    mats = set()
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
        for s in o.material_slots:
            if s.material:
                mats.add(s.material.name)
        for c in o.bound_box:
            p = o.matrix_world @ __import__("mathutils").Vector(c)
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    size = [round(hi[k] - lo[k], 3) for k in range(3)] if tris else [0, 0, 0]
    return tris, sorted(mats), size


def render_ke(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def file_hilang():
    """External files the .blend points to that are not packed and not there (textures, HDR)."""
    hilang = []
    for img in bpy.data.images:
        if img.packed_file or img.source not in {"FILE", "SEQUENCE", "TILED"} or not img.filepath:
            continue
        path = bpy.path.abspath(img.filepath)
        if not os.path.exists(path):
            hilang.append(os.path.basename(img.filepath.replace("\\", "/")) or img.name)
    return sorted(set(hilang))


def kamera_otomatis(scene, objs):
    """No camera in the file: three orthographic shots (front, 45° right, 45° left) that frame the object."""
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    if not pts:
        return []
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center, size = (lo + hi) / 2, hi - lo
    dist = max(size) * 4 + 1
    cams = []
    for name, ang in (("Auto_Depan", 0.0), ("Auto_Kanan", 45.0), ("Auto_Kiri", -45.0)):
        data = bpy.data.cameras.new(name)
        data.type = "ORTHO"
        data.ortho_scale = max(size.x, size.y, size.z) * 1.35
        data.clip_end = dist * 4
        cam = bpy.data.objects.new(name, data)
        scene.collection.objects.link(cam)
        a = math.radians(ang)
        direction = Vector((math.sin(a), -math.cos(a), 0.18)).normalized()
        cam.location = center + direction * dist
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        cams.append(cam)
    return cams


def cahaya_otomatis(scene, objs):
    """No light in the file: a simple soft key/fill/rim so the object is not black."""
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    if not pts:
        return
    size = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.z for p in pts) - min(p.z for p in pts), 0.1)
    for name, loc, power in (("Auto_Key", (1.5, -2.0, 2.0), 600), ("Auto_Fill", (-2.0, -1.5, 1.0), 250), ("Auto_Rim", (0.0, 2.5, 2.0), 350)):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power * size * size
        data.size = size
        o = bpy.data.objects.new(name, data)
        o.location = tuple(v * size for v in loc)
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(o.location)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)


def buat_paket(blend_file):
    nama = os.path.splitext(os.path.basename(blend_file))[0]
    print(f"\n=== {nama} ===")
    bpy.ops.wm.open_mainfile(filepath=blend_file)
    scene = bpy.context.scene
    try:
        bpy.ops.file.pack_all()
    except Exception:
        pass

    out = os.path.join(FOLDER_OUTPUT, nama)
    d_render = os.path.join(out, "renders")
    d_model = os.path.join(out, "model")
    os.makedirs(d_render, exist_ok=True)
    os.makedirs(d_model, exist_ok=True)

    scene.render.engine = "CYCLES"
    set_gpu_rendering(scene, PAKAI_GPU)
    scene.cycles.samples = SAMPLES
    # Adaptive sampling: noisy areas get more samples, clean ones stop early (sharper for the same time).
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.use_denoising = True
    try:  # OpenImageDenoise with albedo + normal guides keeps texture detail instead of smearing it
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
        scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        scene.cycles.denoising_prefilter = "ACCURATE"
        scene.cycles.denoising_quality = "HIGH"
    except (AttributeError, TypeError):
        pass
    scene.render.resolution_x = scene.render.resolution_y = RESOLUSI
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # 0) File perbaikan sendiri bisa kurang lengkap: cek file luar yang hilang, kamera, cahaya.
    hilang = file_hilang()
    if hilang:
        print(f"PERINGATAN_HILANG: {len(hilang)}: " + "; ".join(hilang[:20]))
    # 1) Render dari semua kamera di file (template: depan, kanan 45°, kiri 45°).
    cams = sorted([o for o in scene.objects if o.type == "CAMERA"], key=lambda o: o.name)
    if not cams and scene.camera:
        cams = [scene.camera]
    auto_cam = False
    if not cams:
        cams = kamera_otomatis(scene, objek_barang())
        auto_cam = bool(cams)
        if auto_cam:
            scene.camera = cams[0]
            print("PERINGATAN_KAMERA: file tidak punya kamera, dibuat 3 kamera otomatis")
    if not any(o.type == "LIGHT" for o in scene.objects) and not (scene.world and scene.world.use_nodes):
        cahaya_otomatis(scene, objek_barang())
        print("PERINGATAN_CAHAYA: file tidak punya lampu, dibuat pencahayaan otomatis")
    utama = scene.camera
    # Marker timeline bisa mengunci kamera per frame (template KaytoCraft: F_00/F_10/F_20); lepas sementara.
    ikatan = [(m, m.camera) for m in scene.timeline_markers]
    for m, _ in ikatan:
        m.camera = None
    hasil = []
    for i, cam in enumerate(cams, 1):
        scene.camera = cam
        png = os.path.join(d_render, f"{nama}_{i}.png")
        print(f"  render kamera {cam.name} -> {os.path.basename(png)}")
        render_ke(scene, png)
        latar_putih(png, os.path.join(d_render, f"{nama}_{i}_putih.jpg"))
        hasil.append(png)
    scene.camera = utama or (cams[0] if cams else None)

    # 2) Render clay (abu-abu polos) dari kamera utama.
    if RENDER_CLAY and scene.camera:
        clay = bpy.data.materials.new("KC_Clay")
        clay.use_nodes = True
        b = clay.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = (0.62, 0.62, 0.62, 1)
            b.inputs["Roughness"].default_value = 0.6
        vl = bpy.context.view_layer
        old = vl.material_override
        vl.material_override = clay
        render_ke(scene, os.path.join(d_render, f"{nama}_clay.png"))
        vl.material_override = old
        bpy.data.materials.remove(clay)

    for m, c in ikatan:
        m.camera = c

    # 3) .blend dengan studio apa adanya, lalu ukuran asli (meter) untuk ekspor & INFO.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(d_model, f"{nama}.blend"), copy=True, compress=True)
    for o in bpy.context.scene.objects:
        k = o.get("kc_display_scale")
        if k:  # KaytoCraft memperbesar model agar pas di kamera; kembalikan ke ukuran asli
            o.scale = tuple(v / float(k) for v in o.scale)
            o.location = (0, 0, 0)
            o.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    objs = objek_barang()
    tris, mats, size = info_barang(objs)
    pilih(objs)
    if "glb" in FORMAT_EKSPOR:
        bpy.ops.export_scene.gltf(filepath=os.path.join(d_model, f"{nama}.glb"), export_format="GLB", use_selection=True)
    if "fbx" in FORMAT_EKSPOR:
        bpy.ops.export_scene.fbx(filepath=os.path.join(d_model, f"{nama}.fbx"), use_selection=True, path_mode="COPY", embed_textures=True)
    if "obj" in FORMAT_EKSPOR:
        bpy.ops.wm.obj_export(filepath=os.path.join(d_model, f"{nama}.obj"), export_selected_objects=True, path_mode="COPY")

    # 4) INFO.txt untuk halaman produk.
    fmts = ["blend"] + FORMAT_EKSPOR
    with open(os.path.join(out, "INFO.txt"), "w", encoding="utf-8") as f:
        f.write(f"Nama        : {nama.replace('_', ' ')}\n")
        f.write(f"Poligon     : {tris:,} tris\n")
        f.write(f"Ukuran      : {size[0]} x {size[1]} x {size[2]} m (P x L x T)\n")
        f.write(f"Material    : {', '.join(mats) if mats else '-'}\n")
        f.write(f"Format      : {', '.join('.' + x for x in fmts)}\n")
        f.write(f"Blender     : {bpy.app.version_string} (Cycles)\n")
        f.write(f"Render      : {len(hasil)} sudut + clay, {RESOLUSI}x{RESOLUSI} px\n")
        f.write("Tekstur     : tertanam di .blend / .glb / .fbx\n")
        if auto_cam:
            f.write("Catatan     : file tidak punya kamera — render memakai 3 kamera otomatis\n")
        if hilang:
            f.write(f"PERINGATAN  : {len(hilang)} file tekstur/HDR tidak ikut (tidak di-pack di .blend): {', '.join(hilang)}\n")
            f.write("              Di Blender: File > External Data > Pack Resources, simpan, lalu unggah ulang.\n")

    # 5) ZIP siap unggah.
    zpath = os.path.join(FOLDER_OUTPUT, f"{nama}.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(out):
            for fn in files:
                full = os.path.join(root, fn)
                z.write(full, os.path.relpath(full, FOLDER_OUTPUT))
    print(f"  OK: {tris:,} tris -> {os.path.basename(zpath)}")
    print(f"RENDERS: {len(hasil)}")
    return hasil[0] if hasil else None


def cover(pngs, path, kolom=4, sel=500):
    """Satu gambar sampul berisi semua barang (render kamera pertama), latar putih."""
    pngs = [p for p in pngs if p and os.path.exists(p)]
    if not pngs:
        return
    kolom = min(kolom, len(pngs))
    baris = (len(pngs) + kolom - 1) // kolom
    W, H = kolom * sel, baris * sel
    canvas = np.ones((H, W, 4), dtype=np.float32)
    for n, p in enumerate(pngs):
        img = bpy.data.images.load(p)
        img.scale(sel, sel)
        px = np.empty(sel * sel * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(sel, sel, 4)
        a = px[:, :, 3:4]
        cx, cy = (n % kolom) * sel, (baris - 1 - n // kolom) * sel  # Blender: baris bawah dulu
        canvas[cy:cy + sel, cx:cx + sel, :3] = px[:, :, :3] * a + (1 - a)
        bpy.data.images.remove(img)
    out = bpy.data.images.new("cover", W, H, alpha=False)
    out.pixels.foreach_set(canvas.ravel())
    out.filepath_raw = path
    out.file_format = "JPEG"
    out.save()
    print(f"\nSampul paket: {path}")


if __name__ == "__main__" and SATU_FILE:
    os.makedirs(FOLDER_OUTPUT, exist_ok=True)
    buat_paket(SATU_FILE)
elif __name__ == "__main__":
    os.makedirs(FOLDER_INPUT, exist_ok=True)
    os.makedirs(FOLDER_OUTPUT, exist_ok=True)
    files = sorted(os.path.join(FOLDER_INPUT, f) for f in os.listdir(FOLDER_INPUT) if f.lower().endswith(".blend"))
    print(f"Ketemu {len(files)} file .blend di {FOLDER_INPUT}")
    depan = []
    for fpath in files:
        try:
            depan.append(buat_paket(fpath))
        except Exception as e:
            print(f"  GAGAL {os.path.basename(fpath)}: {e}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cover(depan, os.path.join(FOLDER_OUTPUT, "COVER_PAKET.jpg"))
    print("\n✅ Kelar king — paket siap jual ada di", FOLDER_OUTPUT)
