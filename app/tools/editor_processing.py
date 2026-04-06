"""AstroEditor — Processing: crop, rotation, stretching, curves."""

import uuid
from datetime import datetime
from pathlib import Path

import numpy as np

from .editor_project import (
    _projects_base,
    generate_thumbnail,
    load_project,
    save_project,
)
from .editor_calibration import _load_image_data, _save_fits


# ── Crop & rotation ─────────────────────────────────────────────────

def crop_image(
    project_id: str,
    source_id: str,
    source_type: str,
    x: int,
    y: int,
    width: int,
    height: int,
) -> dict:
    """Crop a result image to the specified region."""
    data, source_record = _load_source(project_id, source_id, source_type)

    h, w = data.shape[:2]
    # Clamp bounds
    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))
    width = min(width, w - x)
    height = min(height, h - y)

    if width < 10 or height < 10:
        raise ValueError("Crop region too small (min 10×10)")

    cropped = data[y : y + height, x : x + width]

    return _save_processed(project_id, cropped, source_record, "crop", {
        "crop_x": x, "crop_y": y, "crop_w": width, "crop_h": height,
        "original_w": w, "original_h": h,
    })


def rotate_image(
    project_id: str,
    source_id: str,
    source_type: str,
    angle: float,
    auto_crop: bool = True,
) -> dict:
    """Rotate an image by the given angle (degrees, counter-clockwise)."""
    from scipy.ndimage import rotate as ndrotate

    data, source_record = _load_source(project_id, source_id, source_type)

    if angle == 0:
        raise ValueError("Angle is 0, nothing to rotate")

    # Special cases: 90, 180, 270 — exact rotation
    if angle % 90 == 0:
        k = int(angle / 90) % 4
        rotated = np.rot90(data, k=k)
    else:
        rotated = ndrotate(data, angle, reshape=not auto_crop, order=3, mode="constant", cval=0.0)

    return _save_processed(project_id, rotated, source_record, "rotate", {
        "angle": angle, "auto_crop": auto_crop,
    })


def flip_image(
    project_id: str,
    source_id: str,
    source_type: str,
    axis: str,
) -> dict:
    """Flip image horizontally or vertically."""
    data, source_record = _load_source(project_id, source_id, source_type)

    if axis == "horizontal":
        flipped = np.fliplr(data)
    elif axis == "vertical":
        flipped = np.flipud(data)
    else:
        raise ValueError("Axis must be 'horizontal' or 'vertical'")

    return _save_processed(project_id, flipped, source_record, "flip", {"axis": axis})


def auto_crop_borders(
    project_id: str,
    source_id: str,
    source_type: str,
    threshold_percent: float = 1.0,
) -> dict:
    """Auto-crop black borders (common after alignment)."""
    data, source_record = _load_source(project_id, source_id, source_type)

    threshold = np.percentile(data, threshold_percent)

    # Find rows/cols that are not entirely black
    row_mask = np.any(data > threshold, axis=1)
    col_mask = np.any(data > threshold, axis=0)

    rows = np.where(row_mask)[0]
    cols = np.where(col_mask)[0]

    if len(rows) == 0 or len(cols) == 0:
        raise ValueError("Image appears to be entirely black")

    y1, y2 = rows[0], rows[-1] + 1
    x1, x2 = cols[0], cols[-1] + 1

    cropped = data[y1:y2, x1:x2]

    return _save_processed(project_id, cropped, source_record, "auto_crop", {
        "removed_top": int(y1),
        "removed_bottom": int(data.shape[0] - y2),
        "removed_left": int(x1),
        "removed_right": int(data.shape[1] - x2),
        "result_w": int(x2 - x1),
        "result_h": int(y2 - y1),
    })


# ── Stretching functions ────────────────────────────────────────────

def stretch_image(
    project_id: str,
    source_id: str,
    source_type: str,
    method: str = "asinh",
    params: dict | None = None,
) -> dict:
    """
    Apply a stretch to bring out faint details.

    Methods:
    - linear: simple min-max or percentile stretch
    - log: logarithmic stretch
    - sqrt: square root stretch
    - asinh: arc-sinh stretch (the most popular in astrophotography)
    - histogram: histogram equalization
    - midtone (MTF): midtone transfer function (like PixInsight STF)
    - curves: custom control-point interpolation
    """
    data, source_record = _load_source(project_id, source_id, source_type)
    params = params or {}

    if method == "linear":
        stretched = _stretch_linear(data, params)
    elif method == "log":
        stretched = _stretch_log(data, params)
    elif method == "sqrt":
        stretched = _stretch_sqrt(data, params)
    elif method == "asinh":
        stretched = _stretch_asinh(data, params)
    elif method == "histogram":
        stretched = _stretch_histogram_eq(data, params)
    elif method == "midtone":
        stretched = _stretch_midtone(data, params)
    elif method == "curves":
        stretched = _stretch_curves(data, params)
    else:
        raise ValueError(f"Unknown stretch method: {method}")

    return _save_processed(project_id, stretched, source_record, f"stretch_{method}", {
        "stretch_method": method,
        "stretch_params": params,
    })


def _stretch_linear(data: np.ndarray, params: dict) -> np.ndarray:
    """Linear stretch with optional black/white point clipping."""
    bp = params.get("black_point", 0.1)   # percentile
    wp = params.get("white_point", 99.9)  # percentile

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)

    if hi <= lo:
        return np.zeros_like(data)

    result = (data - lo) / (hi - lo)
    return np.clip(result, 0, 1)


def _stretch_log(data: np.ndarray, params: dict) -> np.ndarray:
    """Logarithmic stretch."""
    bp = params.get("black_point", 0.1)
    wp = params.get("white_point", 99.9)
    scale = params.get("scale", 1000.0)

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)
    result = np.log1p(normed * scale) / np.log1p(scale)
    return result


def _stretch_sqrt(data: np.ndarray, params: dict) -> np.ndarray:
    """Square root stretch."""
    bp = params.get("black_point", 0.1)
    wp = params.get("white_point", 99.9)

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)
    return np.sqrt(normed)


def _stretch_asinh(data: np.ndarray, params: dict) -> np.ndarray:
    """Arcsinh stretch — excellent for astrophotography."""
    bp = params.get("black_point", 0.2)
    wp = params.get("white_point", 99.9)
    beta = params.get("beta", 10.0)  # stretch factor

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)
    result = np.arcsinh(normed * beta) / np.arcsinh(beta)
    return result


def _stretch_histogram_eq(data: np.ndarray, params: dict) -> np.ndarray:
    """Histogram equalization stretch."""
    from skimage.exposure import equalize_hist

    bp = params.get("black_point", 0.1)
    wp = params.get("white_point", 99.9)

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)
    return equalize_hist(normed)


def _stretch_midtone(data: np.ndarray, params: dict) -> np.ndarray:
    """
    Midtone Transfer Function (MTF), similar to PixInsight's STF.

    The MTF maps [0,1] → [0,1] using:
        MTF(x, m) = (m-1)*x / ((2m-1)*x - m)
    where m is the midtone balance (0 < m < 1).
    Lower m → more aggressive stretch.
    """
    bp = params.get("black_point", 0.2)
    wp = params.get("white_point", 99.95)
    midtone = params.get("midtone", 0.25)  # lower = more stretch

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)

    m = np.clip(midtone, 0.001, 0.999)
    # MTF formula
    denom = (2 * m - 1) * normed - m
    # Avoid division by zero
    safe_denom = np.where(np.abs(denom) < 1e-10, 1e-10, denom)
    result = (m - 1) * normed / safe_denom
    return np.clip(result, 0, 1)


def _stretch_curves(data: np.ndarray, params: dict) -> np.ndarray:
    """Apply a curve defined by control points (piecewise linear interpolation)."""
    bp = params.get("black_point", 0.0)
    wp = params.get("white_point", 100.0)
    # Control points as list of [input, output] in [0,1]
    points = params.get("points", [[0, 0], [0.5, 0.5], [1, 1]])

    lo = np.percentile(data, bp)
    hi = np.percentile(data, wp)
    if hi <= lo:
        return np.zeros_like(data)

    normed = np.clip((data - lo) / (hi - lo), 0, 1)

    # Sort points by input
    points = sorted(points, key=lambda p: p[0])
    xs = np.array([p[0] for p in points], dtype=np.float64)
    ys = np.array([p[1] for p in points], dtype=np.float64)

    # Ensure endpoints
    if xs[0] > 0:
        xs = np.insert(xs, 0, 0.0)
        ys = np.insert(ys, 0, 0.0)
    if xs[-1] < 1:
        xs = np.append(xs, 1.0)
        ys = np.append(ys, 1.0)

    result = np.interp(normed, xs, ys)
    return np.clip(result, 0, 1)


# ── Preview generation (for live stretch preview) ────────────────────

def get_stretch_preview(
    project_id: str,
    source_id: str,
    source_type: str,
    method: str = "asinh",
    params: dict | None = None,
    max_size: int = 800,
) -> bytes:
    """
    Generate a JPEG preview of what a stretch would look like without saving.
    Returns JPEG bytes for direct display.
    """
    from PIL import Image
    import io

    data, _record = _load_source(project_id, source_id, source_type)
    params = params or {}

    # Downsample for speed
    h, w = data.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        from skimage.transform import resize
        data = resize(data, (new_h, new_w), anti_aliasing=True, preserve_range=True)

    # Apply stretch
    stretchers = {
        "linear": _stretch_linear,
        "log": _stretch_log,
        "sqrt": _stretch_sqrt,
        "asinh": _stretch_asinh,
        "histogram": _stretch_histogram_eq,
        "midtone": _stretch_midtone,
        "curves": _stretch_curves,
    }
    fn = stretchers.get(method, _stretch_asinh)
    stretched = fn(data, params)

    # Convert to 8-bit image
    img_array = (np.clip(stretched, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="L")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def get_image_histogram(
    project_id: str,
    source_id: str,
    source_type: str,
    n_bins: int = 256,
) -> dict:
    """Compute histogram of an image for display."""
    data, _record = _load_source(project_id, source_id, source_type)

    # Normalize to [0,1] for display
    dmin, dmax = float(np.min(data)), float(np.max(data))
    if dmax > dmin:
        normed = (data - dmin) / (dmax - dmin)
    else:
        normed = np.zeros_like(data)

    counts, bin_edges = np.histogram(normed.ravel(), bins=n_bins, range=(0, 1))

    return {
        "counts": counts.tolist(),
        "bin_edges": bin_edges.tolist(),
        "data_min": dmin,
        "data_max": dmax,
        "data_mean": float(np.mean(data)),
        "data_median": float(np.median(data)),
        "data_std": float(np.std(data)),
        "width": int(data.shape[1]),
        "height": int(data.shape[0]),
    }


def get_rgb_histogram(project_id: str, composite_id: str, n_bins: int = 256) -> dict:
    """
    Compute per-channel (R, G, B) + luminance histograms for a color composite.
    Returns counts for L, R, G, B channels.
    """
    from .editor_project import load_project
    from astropy.io import fits as pyfits

    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    composites = project.get("color_composites", [])
    record = None
    for c in composites:
        if c["id"] == composite_id:
            record = c
            break
    if record is None:
        raise ValueError(f"Composite {composite_id} not found")

    fpath = _projects_base() / project_id / "results" / record["stored_name"]
    if not fpath.exists():
        raise ValueError("Composite file not found")

    with pyfits.open(fpath) as hdul:
        cube = hdul[0].data.astype(np.float64)

    # cube is (3, H, W)
    if cube.ndim != 3 or cube.shape[0] != 3:
        raise ValueError("Invalid composite data")

    r_ch, g_ch, b_ch = cube[0], cube[1], cube[2]
    lum = 0.2126 * r_ch + 0.7152 * g_ch + 0.0722 * b_ch

    result = {"width": int(cube.shape[2]), "height": int(cube.shape[1])}
    for name, ch_data in [("L", lum), ("R", r_ch), ("G", g_ch), ("B", b_ch)]:
        cmin, cmax = float(np.min(ch_data)), float(np.max(ch_data))
        if cmax > cmin:
            normed = (ch_data - cmin) / (cmax - cmin)
        else:
            normed = np.zeros_like(ch_data)
        counts, _ = np.histogram(normed.ravel(), bins=n_bins, range=(0, 1))
        result[name] = {
            "counts": counts.tolist(),
            "data_min": cmin,
            "data_max": cmax,
            "data_mean": float(np.mean(ch_data)),
            "data_std": float(np.std(ch_data)),
        }

    return result


# ── Helpers ──────────────────────────────────────────────────────────

def _load_source(project_id: str, source_id: str, source_type: str) -> tuple[np.ndarray, dict]:
    """Load an image from the project by type and id."""
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    # Map source types to project keys and directories
    source_map = {
        "stacked": ("stacked_results", "results"),
        "processed": ("processed_results", "results"),
        "aligned": ("aligned_lights", "aligned"),
        "calibrated": ("calibrated_lights", "calibrated"),
        "light": (("images", "light"), "light"),
    }

    if source_type not in source_map:
        raise ValueError(f"Unknown source type: {source_type}")

    keys, subdir = source_map[source_type]

    # Navigate to the record
    if isinstance(keys, tuple):
        collection = project.get(keys[0], {}).get(keys[1], [])
    else:
        collection = project.get(keys, [])

    record = None
    for item in collection:
        if item["id"] == source_id:
            record = item
            break

    if record is None:
        raise ValueError(f"Image {source_id} not found in {source_type}")

    fpath = _projects_base() / project_id / subdir / record["stored_name"]
    if not fpath.exists():
        raise ValueError(f"File not found: {record['stored_name']}")

    data = _load_image_data(fpath)
    return data, record


def _save_processed(
    project_id: str,
    data: np.ndarray,
    source_record: dict,
    operation: str,
    op_params: dict,
) -> dict:
    """Save a processed image result."""
    results_dir = _projects_base() / project_id / "results"
    results_dir.mkdir(exist_ok=True)

    proc_id = uuid.uuid4().hex[:8]
    proc_name = f"proc_{proc_id}_{operation}.fits"
    proc_path = results_dir / proc_name

    _save_fits(data, proc_path, {
        "IMAGETYP": "Processed",
        "PROCTYPE": operation,
        "ORIGFILE": source_record.get("filename", ""),
    })

    thumb = generate_thumbnail(proc_path, project_id)

    # Compute stats
    stats = {
        "mean": float(np.mean(data)),
        "median": float(np.median(data)),
        "std": float(np.std(data)),
        "min": float(np.min(data)),
        "max": float(np.max(data)),
        "width": int(data.shape[1]),
        "height": int(data.shape[0]),
    }

    record = {
        "id": proc_id,
        "filename": proc_name,
        "stored_name": proc_name,
        "frame_type": "processed",
        "operation": operation,
        "params": op_params,
        "source_id": source_record["id"],
        "source_filename": source_record.get("filename", ""),
        "thumbnail": thumb,
        "stats": stats,
        "created": datetime.utcnow().isoformat(),
    }

    project = load_project(project_id)
    if "processed_results" not in project:
        project["processed_results"] = []
    project["processed_results"].append(record)

    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": operation,
        "description": f"{operation}: {stats['width']}×{stats['height']}, media={stats['mean']:.1f}",
    })
    save_project(project_id, project)

    return {
        "id": proc_id,
        "filename": proc_name,
        "thumbnail": thumb,
        "operation": operation,
        "params": op_params,
        "stats": stats,
    }


def get_processing_status(project_id: str) -> dict:
    """Get processing results status."""
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}

    return {
        "processed_results": project.get("processed_results", []),
        "stacked_results": project.get("stacked_results", []),
    }


def delete_processed_result(project_id: str, result_id: str) -> bool:
    """Delete a processed result."""
    project = load_project(project_id)
    if project is None:
        return False

    results = project.get("processed_results", [])
    target = None
    for r in results:
        if r["id"] == result_id:
            target = r
            break

    if target is None:
        return False

    fpath = _projects_base() / project_id / "results" / target["stored_name"]
    if fpath.exists():
        fpath.unlink()

    if target.get("thumbnail"):
        tpath = _projects_base() / project_id / "thumbnails" / Path(target["thumbnail"]).name
        if tpath.exists():
            tpath.unlink()

    project["processed_results"] = [r for r in results if r["id"] != result_id]
    save_project(project_id, project)
    return True
