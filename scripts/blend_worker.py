"""
GitHub Actions worker: make a .blend for one asset of the online KaytoCraft site.

Env: SITE (https://...), ASSET_ID (12 hex), ASSET_NAME, ASSET_FORMAT (glb|fbx), WORKER_SECRET.
Downloads the model, runs scripts/to_blend.py with the bpy module, uploads the result
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
NAME = re.sub(r"[^\w\- ]+", "", os.environ.get("ASSET_NAME", "Model")).strip()[:80] or "Model"
FMT = os.environ.get("ASSET_FORMAT", "glb")
SECRET = os.environ.get("WORKER_SECRET", "")
CHUNK = 4 * 1024 * 1024

if not re.fullmatch(r"https://[\w.-]+(:\d+)?" if not os.environ.get("KC_ALLOW_HTTP") else r"https?://[\w.-]+(:\d+)?", SITE) or not re.fullmatch(r"[a-f0-9]{12}", ASSET_ID) or FMT not in ("glb", "fbx"):
    sys.exit("bad job payload")
if len(SECRET) < 16:
    sys.exit("BLEND_WORKER_SECRET repo secret is missing or too short")


def call(method, path, data=None, ctype=None):
    req = urllib.request.Request(SITE + path, data=data, method=method)
    req.add_header("User-Agent", "kaytocraft-blend-worker")
    if SECRET and method == "POST":
        req.add_header("x-worker-secret", SECRET)
    if ctype:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def report_error(msg):
    try:
        call("POST", f"/api/assets/{ASSET_ID}/blend", json.dumps({"error": msg[:400]}).encode(), "application/json")
    except Exception as e:  # noqa: BLE001
        print("could not report error:", e)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in.{FMT}"
        dst = Path(tmp) / "out.blend"
        src.write_bytes(call("GET", f"/api/assets/{ASSET_ID}/file"))
        script = Path(__file__).with_name("to_blend.py")
        p = subprocess.run([sys.executable, str(script), "--", str(src), str(dst), NAME], capture_output=True, text=True)
        print(p.stdout[-3000:], p.stderr[-3000:])
        if p.returncode != 0 or not dst.exists():
            raise RuntimeError("Blender: " + (p.stderr.strip().splitlines() or ["exit %d" % p.returncode])[-1])
        data = dst.read_bytes()
        upload_id = secrets.token_hex(8)
        for i in range(0, max(1, (len(data) + CHUNK - 1) // CHUNK)):
            call("POST", f"/api/upload-chunk?id={upload_id}&index={i}", data[i * CHUNK : (i + 1) * CHUNK], "application/octet-stream")
        call("POST", f"/api/assets/{ASSET_ID}/blend", json.dumps({"uploadId": upload_id}).encode(), "application/json")
        print(f"done: {len(data)} bytes")


try:
    main()
except Exception as e:  # noqa: BLE001
    print("FAILED:", e)
    report_error(str(e))
    sys.exit(1)
