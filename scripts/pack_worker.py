"""
GitHub Actions worker: make the "ready to sell" package for one asset of the online KaytoCraft site.

Env: SITE, ASSET_ID, ASSET_NAME, WORKER_SECRET (same as blend_worker.py).
Downloads the asset's .blend (the user's fixed one when uploaded), runs scripts/render_jual.py on it
(renders from every camera + clay, .glb/.fbx/.obj export, INFO.txt, ZIP), uploads the ZIP
in 4 MB parts and tells the site it is done (or posts the error).
"""

import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

SITE = os.environ.get("SITE", "").rstrip("/")
ASSET_ID = os.environ.get("ASSET_ID", "")
NAME = re.sub(r"[^\w\- ]+", "", os.environ.get("ASSET_NAME", "Model")).strip().replace(" ", "_")[:80] or "Model"
SECRET = os.environ.get("WORKER_SECRET", "")
SAMPLES = os.environ.get("PACK_SAMPLES", "48")
RES = os.environ.get("PACK_RES", "1500")
CHUNK = 4 * 1024 * 1024

if not re.fullmatch(r"https://[\w.-]+(:\d+)?" if not os.environ.get("KC_ALLOW_HTTP") else r"https?://[\w.-]+(:\d+)?", SITE) or not re.fullmatch(r"[a-f0-9]{12}", ASSET_ID):
    sys.exit("bad job payload")
if len(SECRET) < 16:
    sys.exit("BLEND_WORKER_SECRET repo secret is missing or too short")


def call(method, path, data=None, ctype=None):
    req = urllib.request.Request(SITE + path, data=data, method=method)
    req.add_header("User-Agent", "kaytocraft-pack-worker")
    req.add_header("x-worker-secret", SECRET)
    if ctype:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, r.read()


def report_error(msg):
    try:
        call("POST", f"/api/assets/{ASSET_ID}/pack", json.dumps({"error": msg[:400]}).encode(), "application/json")
    except Exception as e:  # noqa: BLE001
        print("could not report error:", e)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in" / f"{NAME}.blend"
        src.parent.mkdir()
        status, body = call("GET", f"/api/assets/{ASSET_ID}/blend?worker=1")
        if status != 200:
            raise RuntimeError(f".blend belum siap ({status})")
        src.write_bytes(body)
        out = Path(tmp) / "out"
        script = Path(__file__).with_name("render_jual.py")
        p = subprocess.run([sys.executable, str(script), "--", "--file", str(src), str(out), SAMPLES, RES], capture_output=True, text=True)
        print(p.stdout[-4000:], p.stderr[-3000:])
        zpath = out / f"{NAME}.zip"
        if p.returncode != 0 or not zpath.exists():
            raise RuntimeError("Blender: " + ((p.stdout + p.stderr).strip().splitlines() or ["exit %d" % p.returncode])[-1][:300])
        data = zpath.read_bytes()
        upload_id = secrets.token_hex(8)
        for i in range(0, max(1, (len(data) + CHUNK - 1) // CHUNK)):
            call("POST", f"/api/upload-chunk?id={upload_id}&index={i}", data[i * CHUNK : (i + 1) * CHUNK], "application/octet-stream")
        call("POST", f"/api/assets/{ASSET_ID}/pack", json.dumps({"uploadId": upload_id}).encode(), "application/json")
        print(f"done: {len(data)} bytes")


try:
    main()
except Exception as e:  # noqa: BLE001
    print("FAILED:", e)
    report_error(str(e))
    sys.exit(1)
