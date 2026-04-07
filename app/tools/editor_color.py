"""AstroEditor — Color composition: channel assignment, RGB creation, palettes."""

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
from .editor_processing import _load_source


# ── Predefined palettes ─────────────────────────────────────────────

PALETTES = {
    "SHO": {
        "label": "Hubble (SHO)",
        "description": "SII→Rojo, Hα→Verde, OIII→Azul. La paleta icónica del Hubble.",
        "mapping": {"SII": "R", "Ha": "G", "OIII": "B"},
    },
    "HOO": {
        "label": "HOO (bicolor)",
        "description": "Hα→Rojo, OIII→Verde y Azul. Popular para cámaras monocromo con 2 filtros.",
        "mapping": {"Ha": "R", "OIII": "G+B"},
    },
    "LRGB": {
        "label": "LRGB clásico",
        "description": "Luminancia + canales R, G, B estándar.",
        "mapping": {"L": "L", "R": "R", "G": "G", "B": "B"},
    },
    "RGB": {
        "label": "RGB natural",
        "description": "Filtros rojo, verde y azul directamente a los canales de color.",
        "mapping": {"R": "R", "G": "G", "B": "B"},
    },
    "HaRGB": {
        "label": "Hα-RGB",
        "description": "RGB estándar con Hα mezclado en el canal rojo para realzar nebulosas.",
        "mapping": {"Ha": "R+", "R": "R", "G": "G", "B": "B"},
    },
    "SHORGB": {
        "label": "SHO + RGB blend",
        "description": "Mezcla narrowband SHO con broadband RGB para estrellas naturales.",
        "mapping": {"SII": "R", "Ha": "G", "OIII": "B", "R": "star_R", "G": "star_G", "B": "star_B"},
    },
}


def get_palettes() -> dict:
    """Return available palettes."""
    return {k: {"label": v["label"], "description": v["description"]} for k, v in PALETTES.items()}


# ── Palette transform matrices ──────────────────────────────────────

PALETTE_TRANSFORMS = {
    # Standard RGB palettes — identity transform
    "RGB": None,
    "LRGB": None,
    # Hubble palette: SII→R, Hα→G, OIII→B  (already direct mapping)
    "SHO": None,
    # HOO bicolor: Hα→C1, OIII→C2 → R=C1, G=C2, B=C2
    "HOO": {
        "input_labels": ["Hα", "OIII", "—"],
        "matrix": [
            [1.0, 0.0, 0.0],  # R = C1
            [0.0, 1.0, 0.0],  # G = C2
            [0.0, 1.0, 0.0],  # B = C2
        ],
    },
    # HOS: Hα→C1, OIII→C2, SII→C3
    "HOS": {
        "input_labels": ["Hα", "OIII", "SII"],
        "matrix": [
            [0.0, 0.0, 1.0],  # R = SII
            [1.0, 0.0, 0.0],  # G = Hα
            [0.0, 1.0, 0.0],  # B = OIII
        ],
    },
    # Foraxx palette: Hα→C1, OIII→C2, SII→C3
    "Foraxx": {
        "input_labels": ["Hα", "OIII", "SII"],
        "matrix": [
            [0.6, 0.0, 0.4],   # R = 0.6*Hα + 0.4*SII
            [1.0, 0.0, 0.0],   # G = Hα
            [0.0, 0.85, 0.15], # B = 0.85*OIII + 0.15*Hα
        ],
    },
    # CFHT palette: SII→C1, Hα→C2, OIII→C3
    "CFHT": {
        "input_labels": ["SII", "Hα", "OIII"],
        "matrix": [
            [1.0, 0.5, 0.0],  # R = SII + 0.5*Hα
            [0.0, 1.0, 0.0],  # G = Hα
            [0.0, 0.0, 1.0],  # B = OIII
        ],
    },
    # HαRGB: Hα→C1, R→C2, G=C3… but this needs 4+ channels, simplified to 3-input
    "HaRGB": {
        "input_labels": ["Hα+R", "G", "B"],
        "matrix": [
            [1.0, 0.0, 0.0],  # R = C1 (Hα+R blended)
            [0.0, 1.0, 0.0],  # G = C2
            [0.0, 0.0, 1.0],  # B = C3
        ],
    },
}


def get_palette_info() -> dict:
    """Return palette info for the frontend."""
    info = {}
    for key, palette in PALETTES.items():
        transform = PALETTE_TRANSFORMS.get(key)
        info[key] = {
            "label": palette["label"],
            "description": palette["description"],
            "has_transform": transform is not None,
            "input_labels": transform["input_labels"] if transform else ["R", "G", "B"],
        }
    # Add extra palettes not in PALETTES
    for key in PALETTE_TRANSFORMS:
        if key not in info:
            info[key] = {
                "label": key,
                "description": "",
                "has_transform": PALETTE_TRANSFORMS[key] is not None,
                "input_labels": PALETTE_TRANSFORMS[key]["input_labels"] if PALETTE_TRANSFORMS[key] else ["R", "G", "B"],
            }
    return info


# ── Color composition ───────────────────────────────────────────────

def compose_color(
    project_id: str,
    channels: dict,
    saturation: float = 1.0,
    contrast: float = 1.0,
    luminance_id: str | None = None,
    luminance_type: str = "stacked",
    luminance_weight: float = 0.7,
    auto_balance: bool = True,
    stretch_method: str | None = None,
    stretch_params: dict | None = None,
    channel_weights: dict | None = None,
    palette: str | None = None,
) -> dict:
    """
    Create a color image by assigning images to R, G, B channels.

    Parameters
    ----------
    channels : dict mapping channel name to source spec, e.g.:
        {"R": {"source_id": "abc", "source_type": "stacked"},
         "G": {"source_id": "def", "source_type": "stacked"},
         "B": {"source_id": "ghi", "source_type": "stacked"}}
    saturation : 0.0-3.0 saturation multiplier
    luminance_id : optional separate luminance image
    luminance_type : source type of luminance image
    luminance_weight : how much luminance to blend (0-1)
    auto_balance : auto-balance channel backgrounds
    stretch_method : optional stretch to apply before composition
    stretch_params : params for the stretch
    channel_weights : {"C1": 1.0, "C2": 1.0, "C3": 1.0} multipliers per input channel
    palette : palette key for non-RGB transforms (e.g. "HOO", "Foraxx", "HOS")
    """
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    # Load channel data
    channel_data = {}
    for ch_name in ("R", "G", "B"):
        ch_spec = channels.get(ch_name)
        if ch_spec is None:
            continue
        data, _rec = _load_source(project_id, ch_spec["source_id"], ch_spec["source_type"])
        channel_data[ch_name] = data

    if not channel_data:
        raise ValueError("At least one channel (R, G, or B) must be assigned")

    # Determine target shape (use first available channel)
    ref_shape = next(iter(channel_data.values())).shape
    for ch, data in channel_data.items():
        if data.shape != ref_shape:
            raise ValueError(
                f"Channel {ch} has shape {data.shape}, expected {ref_shape}. "
                "All channels must have the same dimensions."
            )

    # Create empty channels for missing ones
    for ch_name in ("R", "G", "B"):
        if ch_name not in channel_data:
            channel_data[ch_name] = np.zeros(ref_shape, dtype=np.float64)

    # Optional stretch per channel before composition
    if stretch_method:
        from .editor_processing import (
            _stretch_asinh,
            _stretch_histogram_eq,
            _stretch_linear,
            _stretch_log,
            _stretch_midtone,
            _stretch_sqrt,
        )
        stretchers = {
            "linear": _stretch_linear, "log": _stretch_log,
            "sqrt": _stretch_sqrt, "asinh": _stretch_asinh,
            "histogram": _stretch_histogram_eq, "midtone": _stretch_midtone,
        }
        fn = stretchers.get(stretch_method)
        if fn:
            sp = stretch_params or {}
            for ch_name in ("R", "G", "B"):
                if np.any(channel_data[ch_name] > 0):
                    channel_data[ch_name] = fn(channel_data[ch_name], sp)

    # Apply channel weights (C1/C2/C3 multipliers mapped to R/G/B)
    if channel_weights:
        weight_map = {"C1": "R", "C2": "G", "C3": "B"}
        for wk, ch_name in weight_map.items():
            w = float(channel_weights.get(wk, 1.0))
            if w != 1.0:
                channel_data[ch_name] = channel_data[ch_name] * w

    # Palette transform: combine input channels → RGB using matrix
    transform = PALETTE_TRANSFORMS.get(palette) if palette else None
    if transform and transform.get("matrix"):
        mat = np.array(transform["matrix"], dtype=np.float64)  # (3, 3)
        # Input channels: R=C1, G=C2, B=C3
        c1 = channel_data["R"]
        c2 = channel_data["G"]
        c3 = channel_data["B"]
        channel_data["R"] = mat[0, 0] * c1 + mat[0, 1] * c2 + mat[0, 2] * c3
        channel_data["G"] = mat[1, 0] * c1 + mat[1, 1] * c2 + mat[1, 2] * c3
        channel_data["B"] = mat[2, 0] * c1 + mat[2, 1] * c2 + mat[2, 2] * c3

    # Normalize each channel to [0, 1]
    for ch_name in ("R", "G", "B"):
        ch = channel_data[ch_name]
        cmin, cmax = float(np.min(ch)), float(np.max(ch))
        if cmax > cmin:
            channel_data[ch_name] = (ch - cmin) / (cmax - cmin)
        else:
            channel_data[ch_name] = np.zeros_like(ch)

    # Auto-balance: match median backgrounds
    if auto_balance:
        medians = {ch: float(np.median(channel_data[ch])) for ch in ("R", "G", "B")}
        active = [m for m in medians.values() if m > 0]
        if active:
            target = np.median(active)
            for ch in ("R", "G", "B"):
                if medians[ch] > 0:
                    channel_data[ch] = channel_data[ch] * (target / medians[ch])
                    channel_data[ch] = np.clip(channel_data[ch], 0, 1)

    # Stack into RGB
    rgb = np.stack([channel_data["R"], channel_data["G"], channel_data["B"]], axis=-1)

    # Saturation adjustment in HSV space
    if saturation != 1.0:
        rgb = _adjust_saturation(rgb, saturation)

    # Contrast adjustment (stretch around mean)
    if contrast != 1.0:
        rgb = _adjust_contrast(rgb, contrast)

    # Luminance blending (LRGB technique)
    if luminance_id:
        lum_data, _lrec = _load_source(project_id, luminance_id, luminance_type)
        if lum_data.shape[:2] != ref_shape:
            raise ValueError("Luminance image dimensions don't match channels")
        # Normalize luminance
        lmin, lmax = float(np.min(lum_data)), float(np.max(lum_data))
        if lmax > lmin:
            lum_norm = (lum_data - lmin) / (lmax - lmin)
        else:
            lum_norm = np.zeros_like(lum_data)

        # Optional stretch for luminance too
        if stretch_method:
            fn = stretchers.get(stretch_method)
            if fn:
                lum_norm = fn(lum_norm, stretch_params or {})

        # Blend: replace luminance while keeping chrominance
        rgb = _blend_luminance(rgb, lum_norm, luminance_weight)

    # Final clip
    rgb = np.clip(rgb, 0, 1)

    # Save result as FITS (3-channel) and generate preview
    results_dir = _projects_base() / project_id / "results"
    results_dir.mkdir(exist_ok=True)

    comp_id = uuid.uuid4().hex[:8]
    comp_name = f"color_{comp_id}.fits"
    comp_path = results_dir / comp_name

    # Save as multi-extension FITS (R, G, B planes)
    from astropy.io import fits as pyfits
    hdr = pyfits.Header()
    hdr["CREATOR"] = "AstroEditor"
    hdr["DATE"] = datetime.utcnow().isoformat()
    hdr["IMAGETYP"] = "Color Composite"
    hdr["NAXIS"] = 3
    hdr["NAXIS3"] = 3

    # Store as (3, H, W) float32
    cube = np.stack([rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]], axis=0).astype(np.float32)
    pyfits.writeto(comp_path, cube, hdr, overwrite=True)

    # Generate color thumbnail (JPEG)
    thumb = _generate_color_thumbnail(rgb, project_id, comp_id)

    # Stats per channel
    ch_stats = {}
    for i, ch_name in enumerate(("R", "G", "B")):
        ch = rgb[:, :, i]
        ch_stats[ch_name] = {
            "mean": float(np.mean(ch)),
            "median": float(np.median(ch)),
            "std": float(np.std(ch)),
        }

    # Save record
    project = load_project(project_id)
    record = {
        "id": comp_id,
        "filename": comp_name,
        "stored_name": comp_name,
        "frame_type": "color_composite",
        "thumbnail": thumb,
        "channels": {ch: {"source_id": channels[ch]["source_id"], "source_type": channels[ch]["source_type"]}
                     for ch in channels if ch in ("R", "G", "B")},
        "luminance_id": luminance_id,
        "saturation": saturation,
        "auto_balance": auto_balance,
        "stretch_method": stretch_method,
        "channel_stats": ch_stats,
        "channel_weights": channel_weights,
        "palette": palette,
        "width": int(ref_shape[1]),
        "height": int(ref_shape[0]),
        "created": datetime.utcnow().isoformat(),
    }

    if "color_composites" not in project:
        project["color_composites"] = []
    project["color_composites"].append(record)

    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "color_compose",
        "description": (
            f"Composición de color: {ref_shape[1]}×{ref_shape[0]}, "
            f"canales={''.join(ch for ch in ('R','G','B') if ch in channels)}"
            f"{', L' if luminance_id else ''}"
            f", sat={saturation}"
        ),
    })
    save_project(project_id, project)

    return {
        "id": comp_id,
        "filename": comp_name,
        "thumbnail": thumb,
        "channel_stats": ch_stats,
        "width": int(ref_shape[1]),
        "height": int(ref_shape[0]),
    }


def _adjust_saturation(rgb: np.ndarray, factor: float) -> np.ndarray:
    """Adjust saturation of an RGB image (values in [0,1])."""
    # Convert to a simple luminance + chrominance model
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    result = np.empty_like(rgb)
    for i in range(3):
        result[:, :, i] = lum + factor * (rgb[:, :, i] - lum)
    return np.clip(result, 0, 1)


def _adjust_contrast(rgb: np.ndarray, factor: float) -> np.ndarray:
    """Adjust contrast of an RGB image around its mean (values in [0,1])."""
    mean = np.mean(rgb)
    result = (rgb - mean) * factor + mean
    return np.clip(result, 0, 1)


def _blend_luminance(rgb: np.ndarray, lum: np.ndarray, weight: float) -> np.ndarray:
    """Blend a luminance channel into RGB (LRGB technique)."""
    # Current luminance from RGB
    rgb_lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    rgb_lum = np.clip(rgb_lum, 1e-10, None)

    # Target luminance
    target_lum = (1 - weight) * rgb_lum + weight * lum

    # Scale RGB to match target luminance
    scale = target_lum / rgb_lum
    result = np.empty_like(rgb)
    for i in range(3):
        result[:, :, i] = rgb[:, :, i] * scale
    return np.clip(result, 0, 1)


def _generate_color_thumbnail(rgb: np.ndarray, project_id: str, comp_id: str) -> str:
    """Generate a color JPEG thumbnail from an RGB array in [0,1]."""
    from PIL import Image

    thumb_dir = _projects_base() / project_id / "thumbnails"
    thumb_dir.mkdir(exist_ok=True)

    # Resize to thumbnail
    h, w = rgb.shape[:2]
    max_dim = 300
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        from skimage.transform import resize
        rgb = resize(rgb, (new_h, new_w, 3), anti_aliasing=True, preserve_range=True)

    img_array = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="RGB")

    thumb_name = f"color_{comp_id}_thumb.jpg"
    thumb_path = thumb_dir / thumb_name
    img.save(thumb_path, "JPEG", quality=85)
    return f"thumbnails/{thumb_name}"


# ── Preview ──────────────────────────────────────────────────────────

def get_color_preview(
    project_id: str,
    composite_id: str,
    max_size: int = 1200,
    stretch_method: str | None = None,
    stretch_params: dict | None = None,
) -> bytes:
    """Generate a JPEG preview of a color composite."""
    from PIL import Image
    import io

    project = load_project(project_id)
    if project is None:
        raise ValueError("Project not found")

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

    from astropy.io import fits as pyfits
    with pyfits.open(fpath) as hdul:
        cube = hdul[0].data.astype(np.float64)

    # cube is (3, H, W)
    if cube.ndim == 3 and cube.shape[0] == 3:
        rgb = np.stack([cube[0], cube[1], cube[2]], axis=-1)
    else:
        raise ValueError("Invalid color composite data")

    # Downsample
    h, w = rgb.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        from skimage.transform import resize
        rgb = resize(rgb, (new_h, new_w, 3), anti_aliasing=True, preserve_range=True)

    rgb = np.clip(rgb, 0, 1)
    img_array = (rgb * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def adjust_rgb_levels(
    project_id: str,
    composite_id: str,
    levels: dict,
    max_size: int = 1200,
) -> bytes:
    """
    Apply per-channel level adjustments on an existing composite and return JPEG.

    levels: {"R": {"zmin": 0.0, "zmax": 1.0}, "G": {...}, "B": {...}}
    Each channel is remapped: out = clip((ch - zmin) / (zmax - zmin), 0, 1)
    """
    from PIL import Image
    import io

    project = load_project(project_id)
    if project is None:
        raise ValueError("Project not found")

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

    from astropy.io import fits as pyfits
    with pyfits.open(fpath) as hdul:
        cube = hdul[0].data.astype(np.float64)

    if cube.ndim != 3 or cube.shape[0] != 3:
        raise ValueError("Invalid color composite data")

    rgb = np.stack([cube[0], cube[1], cube[2]], axis=-1)
    rgb = np.nan_to_num(rgb, nan=0.0, posinf=1.0, neginf=0.0)

    # Apply per-channel level adjustment
    ch_names = ["R", "G", "B"]
    for i, ch_name in enumerate(ch_names):
        if ch_name in levels:
            zmin = float(levels[ch_name].get("zmin", 0.0))
            zmax = float(levels[ch_name].get("zmax", 1.0))
            if zmax > zmin:
                rgb[:, :, i] = (rgb[:, :, i] - zmin) / (zmax - zmin)
            else:
                rgb[:, :, i] = 0.0

    rgb = np.clip(rgb, 0, 1)

    # Downsample
    h, w = rgb.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        from skimage.transform import resize
        rgb = resize(rgb, (new_h, new_w, 3), anti_aliasing=True, preserve_range=True)

    img_array = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def get_mono_preview(
    project_id: str,
    source_id: str,
    source_type: str,
    stretch_method: str = "asinh",
    stretch_params: dict | None = None,
    max_size: int = 1200,
) -> bytes:
    """Generate a JPEG preview of any mono image with stretch."""
    from PIL import Image
    import io
    from .editor_processing import (
        _stretch_asinh,
        _stretch_histogram_eq,
        _stretch_linear,
        _stretch_log,
        _stretch_midtone,
        _stretch_sqrt,
    )

    data, _rec = _load_source(project_id, source_id, source_type)
    params = stretch_params or {}

    # Downsample
    h, w = data.shape[:2]
    if max(h, w) > max_size:
        scale = max_size / max(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        from skimage.transform import resize
        data = resize(data, (new_h, new_w), anti_aliasing=True, preserve_range=True)

    stretchers = {
        "linear": _stretch_linear, "log": _stretch_log,
        "sqrt": _stretch_sqrt, "asinh": _stretch_asinh,
        "histogram": _stretch_histogram_eq, "midtone": _stretch_midtone,
    }
    fn = stretchers.get(stretch_method, _stretch_asinh)
    stretched = fn(data, params)

    img_array = (np.clip(stretched, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="L")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ── Export ───────────────────────────────────────────────────────────

def export_image(
    project_id: str,
    source_id: str,
    source_type: str,
    format: str = "fits",
    bit_depth: int = 16,
    stretch_on_export: bool = False,
    stretch_method: str = "asinh",
    stretch_params: dict | None = None,
) -> tuple[Path, str]:
    """
    Export an image to the requested format.
    Returns (file_path, media_type).

    Supported formats: fits, tiff, png, jpg
    """
    is_color = source_type == "color_composite"

    if is_color:
        project = load_project(project_id)
        if project is None:
            raise ValueError("Project not found")
        composites = project.get("color_composites", [])
        record = None
        for c in composites:
            if c["id"] == source_id:
                record = c
                break
        if record is None:
            raise ValueError(f"Composite {source_id} not found")

        fpath = _projects_base() / project_id / "results" / record["stored_name"]
        from astropy.io import fits as pyfits
        with pyfits.open(fpath) as hdul:
            cube = hdul[0].data.astype(np.float64)
        # (3, H, W) -> (H, W, 3)
        rgb = np.stack([cube[0], cube[1], cube[2]], axis=-1)
    else:
        data, _rec = _load_source(project_id, source_id, source_type)
        rgb = None

    # Apply stretch if requested
    if stretch_on_export:
        from .editor_processing import (
            _stretch_asinh,
            _stretch_histogram_eq,
            _stretch_linear,
            _stretch_log,
            _stretch_midtone,
            _stretch_sqrt,
        )
        stretchers = {
            "linear": _stretch_linear, "log": _stretch_log,
            "sqrt": _stretch_sqrt, "asinh": _stretch_asinh,
            "histogram": _stretch_histogram_eq, "midtone": _stretch_midtone,
        }
        fn = stretchers.get(stretch_method, _stretch_asinh)
        sp = stretch_params or {}
        if is_color:
            for i in range(3):
                rgb[:, :, i] = fn(rgb[:, :, i], sp)
        else:
            data = fn(data, sp)

    # Create export directory
    export_dir = _projects_base() / project_id / "exports"
    export_dir.mkdir(exist_ok=True)
    export_id = uuid.uuid4().hex[:8]

    if format == "fits":
        out_name = f"export_{export_id}.fits"
        out_path = export_dir / out_name
        if is_color:
            cube_out = np.stack([rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]], axis=0)
            _save_fits(cube_out.astype(np.float32) if bit_depth == 32 else cube_out, out_path, {"IMAGETYP": "Export"})
        else:
            _save_fits(data, out_path, {"IMAGETYP": "Export"})
        return out_path, "application/fits"

    elif format == "tiff":
        import tifffile
        out_name = f"export_{export_id}.tiff"
        out_path = export_dir / out_name
        if is_color:
            if bit_depth == 8:
                arr = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
            else:
                arr = (np.clip(rgb, 0, 1) * 65535).astype(np.uint16)
            tifffile.imwrite(str(out_path), arr)
        else:
            if bit_depth == 8:
                dmin, dmax = float(np.min(data)), float(np.max(data))
                if dmax > dmin:
                    arr = ((data - dmin) / (dmax - dmin) * 255).astype(np.uint8)
                else:
                    arr = np.zeros(data.shape, dtype=np.uint8)
            elif bit_depth == 32:
                arr = data.astype(np.float32)
            else:
                dmin, dmax = float(np.min(data)), float(np.max(data))
                if dmax > dmin:
                    arr = ((data - dmin) / (dmax - dmin) * 65535).astype(np.uint16)
                else:
                    arr = np.zeros(data.shape, dtype=np.uint16)
            tifffile.imwrite(str(out_path), arr)
        return out_path, "image/tiff"

    elif format == "png":
        from PIL import Image
        out_name = f"export_{export_id}.png"
        out_path = export_dir / out_name
        if is_color:
            if bit_depth == 16:
                arr = (np.clip(rgb, 0, 1) * 65535).astype(np.uint16)
                import tifffile
                # PIL doesn't support 16-bit PNG well, use raw approach
                _save_16bit_png(arr, out_path)
            else:
                arr = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
                Image.fromarray(arr, mode="RGB").save(out_path, "PNG")
        else:
            dmin, dmax = float(np.min(data)), float(np.max(data))
            if dmax > dmin:
                normed = (data - dmin) / (dmax - dmin)
            else:
                normed = np.zeros_like(data)
            if bit_depth == 16:
                arr = (normed * 65535).astype(np.uint16)
                _save_16bit_png(arr[:, :, np.newaxis] if arr.ndim == 2 else arr, out_path, mono=True)
            else:
                arr = (normed * 255).astype(np.uint8)
                Image.fromarray(arr, mode="L").save(out_path, "PNG")
        return out_path, "image/png"

    elif format == "jpg":
        from PIL import Image
        out_name = f"export_{export_id}.jpg"
        out_path = export_dir / out_name
        quality = 95
        if is_color:
            arr = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
            Image.fromarray(arr, mode="RGB").save(out_path, "JPEG", quality=quality)
        else:
            dmin, dmax = float(np.min(data)), float(np.max(data))
            if dmax > dmin:
                normed = (data - dmin) / (dmax - dmin)
            else:
                normed = np.zeros_like(data)
            arr = (normed * 255).astype(np.uint8)
            Image.fromarray(arr, mode="L").save(out_path, "JPEG", quality=quality)
        return out_path, "image/jpeg"

    else:
        raise ValueError(f"Unknown export format: {format}")


def _save_16bit_png(arr: np.ndarray, path: Path, mono: bool = False):
    """Save 16-bit PNG using cv2 (if available) or fall back to 8-bit."""
    try:
        import cv2
        if mono and arr.ndim == 3 and arr.shape[2] == 1:
            cv2.imwrite(str(path), arr[:, :, 0])
        elif arr.ndim == 3 and arr.shape[2] == 3:
            # OpenCV uses BGR
            cv2.imwrite(str(path), arr[:, :, ::-1])
        else:
            cv2.imwrite(str(path), arr)
    except ImportError:
        # Fall back to 8-bit PIL
        from PIL import Image
        arr8 = (arr.astype(np.float64) / 65535 * 255).astype(np.uint8)
        if mono:
            if arr8.ndim == 3:
                arr8 = arr8[:, :, 0]
            Image.fromarray(arr8, mode="L").save(path, "PNG")
        else:
            Image.fromarray(arr8, mode="RGB").save(path, "PNG")


# ── Status / delete ──────────────────────────────────────────────────

def get_color_status(project_id: str) -> dict:
    """Get color composition status."""
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}

    return {
        "color_composites": project.get("color_composites", []),
        "stacked_results": project.get("stacked_results", []),
        "processed_results": project.get("processed_results", []),
    }


def delete_color_composite(project_id: str, composite_id: str) -> bool:
    """Delete a color composite."""
    project = load_project(project_id)
    if project is None:
        return False

    composites = project.get("color_composites", [])
    target = None
    for c in composites:
        if c["id"] == composite_id:
            target = c
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

    project["color_composites"] = [c for c in composites if c["id"] != composite_id]
    save_project(project_id, project)
    return True
