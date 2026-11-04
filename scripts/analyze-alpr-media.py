"""
Extracts geometry from the Persian ALPR pipeline outputs in Assets/ so the
website can re-draw real detections instead of shipping burned-in overlays.

For every scene folder (Assets/Images:Videos/CLPR/Image_N):
  * finds each green detection rectangle in the *_annotated.png output
    (after cropping away matplotlib figure borders when present) and maps
    it into raw-image coordinates;
  * locates every saved character crop inside its plate crop (template match)
    so the site can split a plate into its 8 real character tiles.

Plate text/labels are NOT recognised here - they were read from the pipeline's
own annotations and are stored by hand in src/projects/alpr/scenes.ts.

Usage: python3 scripts/analyze-alpr-media.py > src/projects/alpr/geometry.json
"""
import glob, json, os, sys
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..", "Assets", "Images:Videos", "CLPR")


def content_box(img):
    """Bounding box of the photo inside a matplotlib figure (non-white area)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = gray < 245
    # Ignore thin title text rows: require rows with many non-white pixels.
    rows = np.where(mask.sum(1) > img.shape[1] * 0.5)[0]
    cols = np.where(mask.sum(0) > img.shape[0] * 0.5)[0]
    return cols.min(), rows.min(), cols.max() + 1, rows.max() + 1


def green_rects(img):
    b, g, r = [img[:, :, i].astype(int) for i in range(3)]
    mask = ((g > 180) & (r < 90) & (b < 90)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    rects = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w < 12 or h < 6:
            continue
        comp = labels[y:y + h, x:x + w] == i
        fill = comp.sum() / float(w * h)
        # Rectangle outlines are hollow. The label box is drawn over part of the
        # top edge, so only the bottom edge and both sides are required.
        edges = comp[-1].mean() > 0.8 and comp[:, 0].mean() > 0.8 and comp[:, -1].mean() > 0.8
        if edges and fill < 0.6:
            rects.append([int(x), int(y), int(x + w), int(y + h)])
    return rects


def locate(child, parent):
    if child.shape[0] > parent.shape[0] or child.shape[1] > parent.shape[1]:
        return None
    res = cv2.matchTemplate(parent, child, cv2.TM_SQDIFF_NORMED)
    _, _, loc, _ = cv2.minMaxLoc(res)
    return [int(loc[0]), int(loc[1]), int(loc[0] + child.shape[1]), int(loc[1] + child.shape[0])]


out = {}
for d in sorted(glob.glob(os.path.join(ROOT, "Image_*"))):
    name = os.path.basename(d)
    raw_path = [p for p in glob.glob(os.path.join(d, "*.jpg"))][0]
    ann_path = glob.glob(os.path.join(d, "*_annotated.png"))[0]
    raw = cv2.imread(raw_path)
    ann = cv2.imread(ann_path)
    rh, rw = raw.shape[:2]
    if ann.shape[:2] != raw.shape[:2]:
        x0, y0, x1, y1 = content_box(ann)
        photo = ann[y0:y1, x0:x1]
        sx, sy = rw / photo.shape[1], rh / photo.shape[0]
        rects = [[round(a * sx), round(b * sy), round(c * sx), round(e * sy)] for a, b, c, e in green_rects(photo)]
        crop = [int(x0), int(y0), int(x1), int(y1)]
    else:
        rects = green_rects(ann)
        crop = None
    plates = []
    for pdir in sorted(glob.glob(os.path.join(d, "plate_*"))):
        plate = cv2.imread(os.path.join(pdir, "plate_crop.png"))
        chars = []
        for cp in sorted(glob.glob(os.path.join(pdir, "char_*.png"))):
            c = cv2.imread(cp)
            chars.append(locate(c, plate))
        plates.append({"dir": os.path.basename(pdir), "size": [plate.shape[1], plate.shape[0]], "chars": chars})
    out[name] = {
        "raw": os.path.basename(raw_path),
        "size": [rw, rh],
        "annotatedCrop": crop,
        "boxes": rects,
        "plates": plates,
    }

json.dump(out, sys.stdout, indent=1)
