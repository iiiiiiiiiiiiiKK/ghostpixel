"""用 Pillow 独立复核 GhostPixel 清理后的输出（不依赖本项目代码）。"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tmp-cleaned"
ok = True
for p in sorted(OUT.iterdir()):
    if not p.is_file():
        continue
    try:
        with Image.open(p) as im:
            im.load()
            exif = im.getexif()
            gps = exif.get_ifd(0x8825) if 0x8825 in exif else {}
            text = getattr(im, "text", {}) or {}
            info = {k: v for k, v in im.info.items() if k in ("exif", "icc_profile", "XML:com.adobe.xmp", "comment", "software")}
            print(f"{p.name}: size={im.size} format={im.format} mode={im.mode}")
            print(f"   exif tags={len(exif)} gps_tags={len(gps)} png_text={len(text)} info_keys={list(info)}")
            if len(exif) > 0 or len(gps) > 0 or len(text) > 0 or info:
                print("   !! 仍有残留元数据")
                ok = False
    except Exception as e:
        print(f"{p.name}: FAILED to open -> {e!r}")
        ok = False
sys.exit(0 if ok else 1)
