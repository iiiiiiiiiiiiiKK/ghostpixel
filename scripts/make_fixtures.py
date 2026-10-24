#!/usr/bin/env python
"""生成测试用的真实图片素材（含 EXIF/GPS、透明、超大、损坏等情况）。

用法： python scripts/make_fixtures.py
输出： public/fixtures/*.jpg|png|webp|gif
说明： 这些图片是本仓库测试资产，用于验证「检测 → 清理 → 复检」闭环。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageCms
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 640, 480


def gradient(mode="RGB", size=(W, H), alpha=False):
    img = Image.new("RGBA" if alpha else "RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        if alpha:
            d.line([(0, y), (size[0], y)], fill=(int(40 + 180 * t), int(120 + 60 * t), 200, int(120 + 130 * t)))
        else:
            d.line([(0, y), (size[0], y)], fill=(int(30 + 200 * t), int(90 + 120 * t), 190))
    d.rectangle([16, 16, 300, 76], fill=(255, 255, 255) if not alpha else (255, 255, 255, 220))
    d.text((30, 34), "GhostPixel fixture", fill=(20, 20, 20))
    return img


def exif_with_gps():
    exif = Image.Exif()
    exif[0x010F] = "GhostPhone"          # Make
    exif[0x0110] = "GhostPhone 15 Pro"   # Model
    exif[0x0131] = "GhostPixel Fixtures 1.0"  # Software
    exif[0x0132] = "2024:08:14 21:07:33"      # DateTime
    exif[0x013B] = "Ada Lovelace"             # Artist
    exif[0x8298] = "(c) 2024 Ada Lovelace"    # Copyright
    exif[0x010E] = "taken at my apartment window"  # ImageDescription
    exif[0x0112] = 1                          # Orientation
    # EXIF IFD
    exif[0x8769] = {
        0x9003: "2024:08:14 21:07:33",                 # DateTimeOriginal
        0x9004: "2024:08:14 21:07:33",                 # DateTimeDigitized
        0x829A: (1, 120),                              # ExposureTime
        0x829D: (28, 10),                              # FNumber
        0x8827: 400,                                   # ISO
        0x920A: (35, 1),                               # FocalLength
        0x9286: b"ASCII\x00\x00\x00internal note: apt 12F, keypad code 4482",  # UserComment
        0xA431: "SN-GHOST-0001234567",                 # BodySerialNumber
        0xA430: "Ada Lovelace",                        # CameraOwnerName
        0xA433: "GhostLens",                           # LensMake
        0xA434: "GhostLens 35mm f/1.8",                # LensModel
    }
    # GPS IFD —— 北京天安门附近，用于验证坐标检测
    # Pillow 用「3 个 float 组成一个 rational 三元组」的形式写度分秒。
    exif[0x8825] = {
        1: "N",
        2: (39.0, 54.0, 26.87),
        3: "E",
        4: (116.0, 23.0, 17.38),
        5: 0,
        6: (52.0,),
        7: (21.0, 3.0, 41.2),
        29: "2024:08:14",
    }
    return exif


def make_jpeg_with_exif():
    img = gradient()
    img.save(OUT / "with-exif-gps.jpg", "JPEG", quality=88, exif=exif_with_gps(), comment=b"GhostPixel demo comment")
    print("wrote with-exif-gps.jpg")


def make_jpeg_clean():
    img = gradient()
    img.save(OUT / "no-metadata.jpg", "JPEG", quality=88)
    # Pillow 默认会写入 JFIF APP0，这属于结构头，不含隐私信息。
    print("wrote no-metadata.jpg")


def make_png_transparent():
    img = gradient(alpha=True, size=(512, 512))
    info = PngInfo()
    info.add_text("Software", "GhostPixel Fixtures")
    info.add_text("Author", "Ada Lovelace")
    info.add_text("Comment", "transparent png with text chunks")
    info.add_itxt("XML:com.adobe.xmp", '<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Ada Lovelace</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>')
    img.save(OUT / "transparent-with-text.png", "PNG", pnginfo=info)
    print("wrote transparent-with-text.png")


def make_png_clean():
    img = gradient()
    img.save(OUT / "clean.png", "PNG", optimize=True)
    print("wrote clean.png")


def make_webp_with_exif():
    img = gradient()
    img.save(OUT / "with-exif.webp", "WEBP", quality=85, exif=exif_with_gps().tobytes())
    print("wrote with-exif.webp")


def make_gif_with_comment():
    img = gradient().convert("P", palette=Image.ADAPTIVE, colors=64)
    img.save(OUT / "animated-comment.gif", "GIF", comment=b"Created by GhostPixel fixtures")
    print("wrote animated-comment.gif")


def make_large():
    """3000x3000 纯色抖动图，体积可控但像素量大，用于测试资源限制。"""
    img = Image.new("RGB", (3000, 3000))
    d = ImageDraw.Draw(img)
    for i in range(0, 3000, 30):
        d.line([(i, 0), (i, 3000)], fill=(i % 255, (i * 3) % 255, (i * 7) % 255))
    img.save(OUT / "large-3000x3000.jpg", "JPEG", quality=70)
    print("wrote large-3000x3000.jpg")


def make_corrupt():
    data = bytearray((OUT / "with-exif-gps.jpg").read_bytes())
    # 砍掉尾部 40%，模拟下载中断的损坏文件
    cut = int(len(data) * 0.6)
    (OUT / "corrupt-truncated.jpg").write_bytes(bytes(data[:cut]))
    # 完全不是图片的文件
    (OUT / "not-an-image.txt").write_bytes(b"this is a plain text file, not an image\n" * 4)
    # 伪造魔数但内容无效
    (OUT / "fake-png.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    print("wrote corrupt-truncated.jpg / not-an-image.txt / fake-png.png")


def make_icc_jpeg():
    img = gradient()
    profile = ImageCms.createProfile("sRGB")
    img.save(OUT / "with-icc.jpg", "JPEG", quality=85, icc_profile=ImageCms.ImageCmsProfile(profile).tobytes())
    print("wrote with-icc.jpg")


if __name__ == "__main__":
    make_jpeg_with_exif()
    make_jpeg_clean()
    make_png_transparent()
    make_png_clean()
    make_webp_with_exif()
    make_gif_with_comment()
    make_large()
    make_corrupt()
    make_icc_jpeg()
    print("done ->", OUT)
