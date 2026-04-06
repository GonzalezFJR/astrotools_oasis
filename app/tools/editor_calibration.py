"""AstroEditor — Calibration: master frame creation and light calibration."""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from .editor_project import (
    PROJECTS_DIR,
    _projects_base,
    extract_metadata,
    generate_thumbnail,
    load_project,
    save_project,
)


def _load_image_data(filepath: Path) -> np.ndarray:
    """Load image data as a float64 numpy array, regardless of format."""
    ext = filepath.suffix.lower()

    if ext in (".fits", ".fit", ".fts"):
        from astropy.io import fits
        with fits.open(filepath) as hdul:
            data = hdul[0].data
            if data is None:
                raise ValueError(f"No data in FITS file: {filepath.name}")
            if data.ndim > 2:
                data = data[0]
            return data.astype(np.float64)

    elif ext in (".cr2", ".cr3"):
        import rawpy
        with rawpy.imread(str(filepath)) as raw:
            rgb = raw.postprocess(
                use_auto_wb=False,
                no_auto_bright=True,
                output_bps=16,
                gamma=(1, 1),
            )
        gray = np.mean(rgb.astype(np.float64), axis=2)
        return gray

    elif ext in (".tif", ".tiff"):
        import tifffile
        data = tifffile.imread(str(filepath)).astype(np.float64)
        if data.ndim == 3:
            data = np.mean(data, axis=2)
        return data

    else:
        from PIL import Image
        img = Image.open(filepath)
        arr = np.array(img, dtype=np.float64)
        if arr.ndim == 3:
            arr = np.mean(arr, axis=2)
        return arr


def _save_fits(data: np.ndarray, filepath: Path, header_extras: dict | None = None):
    """Save a numpy array as a FITS file."""
    from astropy.io import fits
    hdr = fits.Header()
    hdr["CREATOR"] = "AstroEditor"
    hdr["DATE"] = datetime.utcnow().isoformat()
    if header_extras:
        for k, v in header_extras.items():
            if len(k) <= 8:
                hdr[k] = v
    fits.writeto(filepath, data.astype(np.float32), hdr, overwrite=True)


def _get_image_paths(project_id: str, frame_type: str, image_ids: list[str] | None = None) -> list[Path]:
    """Get file paths for images of a given type in a project."""
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    images = project["images"].get(frame_type, [])
    if image_ids:
        images = [img for img in images if img["id"] in image_ids]

    paths = []
    for img in images:
        p = _projects_base() / project_id / frame_type / img["stored_name"]
        if p.exists():
            paths.append(p)
    return paths


def _combine_frames(
    paths: list[Path],
    method: str = "median",
    sigma: float = 3.0,
) -> np.ndarray:
    """Combine multiple frames into a single master using the specified method."""
    if not paths:
        raise ValueError("No frames to combine")

    arrays = []
    for p in paths:
        arr = _load_image_data(p)
        arrays.append(arr)

    # Check all same shape
    shape = arrays[0].shape
    for i, arr in enumerate(arrays[1:], 1):
        if arr.shape != shape:
            raise ValueError(
                f"Frame {paths[i].name} has shape {arr.shape}, "
                f"expected {shape} (from {paths[0].name})"
            )

    stack = np.array(arrays)

    if method == "mean":
        return np.mean(stack, axis=0)
    elif method == "median":
        return np.median(stack, axis=0)
    elif method == "sigma_clip":
        return _sigma_clipped_mean(stack, sigma)
    else:
        raise ValueError(f"Unknown method: {method}")


def _sigma_clipped_mean(stack: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    """Sigma-clipped mean combination."""
    mean = np.mean(stack, axis=0)
    std = np.std(stack, axis=0)
    std[std == 0] = 1

    mask = np.abs(stack - mean[np.newaxis]) <= sigma * std[np.newaxis]
    counts = np.sum(mask, axis=0)
    counts[counts == 0] = 1
    result = np.sum(stack * mask, axis=0) / counts
    return result


def create_master_bias(
    project_id: str,
    method: str = "median",
    sigma: float = 3.0,
    image_ids: list[str] | None = None,
) -> dict:
    """Create a master bias frame from bias frames."""
    paths = _get_image_paths(project_id, "bias", image_ids)
    if not paths:
        raise ValueError("No bias frames found in this project")

    master = _combine_frames(paths, method, sigma)

    master_id = uuid.uuid4().hex[:8]
    master_name = f"master_bias_{master_id}.fits"
    master_dir = _projects_base() / project_id / "masters"
    master_dir.mkdir(exist_ok=True)
    master_path = master_dir / master_name

    _save_fits(master, master_path, {
        "IMAGETYP": "Master Bias",
        "NCOMBINE": len(paths),
        "COMBMETH": method,
    })

    thumb = generate_thumbnail(master_path, project_id)

    record = {
        "id": master_id,
        "type": "master_bias",
        "filename": master_name,
        "method": method,
        "n_combined": len(paths),
        "source_ids": [p.stem.split("_")[0] for p in paths],
        "created": datetime.utcnow().isoformat(),
        "thumbnail": thumb,
        "stats": {
            "mean": float(np.mean(master)),
            "median": float(np.median(master)),
            "std": float(np.std(master)),
            "min": float(np.min(master)),
            "max": float(np.max(master)),
        },
    }

    project = load_project(project_id)
    project["masters"]["master_bias"] = record
    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "create_master_bias",
        "description": f"Master Bias creado ({method}, {len(paths)} frames)",
        "details": record,
    })
    save_project(project_id, project)
    return record


def create_master_dark(
    project_id: str,
    method: str = "median",
    sigma: float = 3.0,
    subtract_bias: bool = True,
    image_ids: list[str] | None = None,
) -> dict:
    """Create a master dark frame, optionally subtracting master bias."""
    paths = _get_image_paths(project_id, "dark", image_ids)
    if not paths:
        raise ValueError("No dark frames found in this project")

    arrays = [_load_image_data(p) for p in paths]

    if subtract_bias:
        project = load_project(project_id)
        mb_record = project.get("masters", {}).get("master_bias")
        if mb_record:
            mb_path = _projects_base() / project_id / "masters" / mb_record["filename"]
            if mb_path.exists():
                master_bias = _load_image_data(mb_path)
                arrays = [a - master_bias for a in arrays]

    shape = arrays[0].shape
    for i, arr in enumerate(arrays[1:], 1):
        if arr.shape != shape:
            raise ValueError(f"Dark frame shape mismatch: {paths[i].name}")

    stack = np.array(arrays)
    if method == "mean":
        master = np.mean(stack, axis=0)
    elif method == "median":
        master = np.median(stack, axis=0)
    elif method == "sigma_clip":
        master = _sigma_clipped_mean(stack, sigma)
    else:
        raise ValueError(f"Unknown method: {method}")

    master_id = uuid.uuid4().hex[:8]
    master_name = f"master_dark_{master_id}.fits"
    master_path = _projects_base() / project_id / "masters" / master_name

    _save_fits(master, master_path, {
        "IMAGETYP": "Master Dark",
        "NCOMBINE": len(paths),
        "COMBMETH": method,
        "BSUB": str(subtract_bias),
    })

    thumb = generate_thumbnail(master_path, project_id)

    record = {
        "id": master_id,
        "type": "master_dark",
        "filename": master_name,
        "method": method,
        "n_combined": len(paths),
        "bias_subtracted": subtract_bias,
        "created": datetime.utcnow().isoformat(),
        "thumbnail": thumb,
        "stats": {
            "mean": float(np.mean(master)),
            "median": float(np.median(master)),
            "std": float(np.std(master)),
            "min": float(np.min(master)),
            "max": float(np.max(master)),
        },
    }

    project = load_project(project_id)
    project["masters"]["master_dark"] = record
    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "create_master_dark",
        "description": f"Master Dark creado ({method}, {len(paths)} frames, bias={'sí' if subtract_bias else 'no'})",
        "details": record,
    })
    save_project(project_id, project)
    return record


def create_master_flat(
    project_id: str,
    method: str = "median",
    sigma: float = 3.0,
    subtract_bias: bool = True,
    image_ids: list[str] | None = None,
) -> dict:
    """Create a normalized master flat frame."""
    paths = _get_image_paths(project_id, "flat", image_ids)
    if not paths:
        raise ValueError("No flat frames found in this project")

    arrays = [_load_image_data(p) for p in paths]

    if subtract_bias:
        project = load_project(project_id)
        mb_record = project.get("masters", {}).get("master_bias")
        if mb_record:
            mb_path = _projects_base() / project_id / "masters" / mb_record["filename"]
            if mb_path.exists():
                master_bias = _load_image_data(mb_path)
                arrays = [a - master_bias for a in arrays]

    shape = arrays[0].shape
    for i, arr in enumerate(arrays[1:], 1):
        if arr.shape != shape:
            raise ValueError(f"Flat frame shape mismatch: {paths[i].name}")

    stack = np.array(arrays)
    if method == "mean":
        master = np.mean(stack, axis=0)
    elif method == "median":
        master = np.median(stack, axis=0)
    elif method == "sigma_clip":
        master = _sigma_clipped_mean(stack, sigma)
    else:
        raise ValueError(f"Unknown method: {method}")

    # Normalize
    med = np.median(master)
    if med > 0:
        master = master / med
    master[master <= 0] = 1.0  # Prevent division by zero

    master_id = uuid.uuid4().hex[:8]
    master_name = f"master_flat_{master_id}.fits"
    master_path = _projects_base() / project_id / "masters" / master_name

    _save_fits(master, master_path, {
        "IMAGETYP": "Master Flat",
        "NCOMBINE": len(paths),
        "COMBMETH": method,
        "BSUB": str(subtract_bias),
    })

    thumb = generate_thumbnail(master_path, project_id)

    record = {
        "id": master_id,
        "type": "master_flat",
        "filename": master_name,
        "method": method,
        "n_combined": len(paths),
        "bias_subtracted": subtract_bias,
        "normalized_median": float(med),
        "created": datetime.utcnow().isoformat(),
        "thumbnail": thumb,
        "stats": {
            "mean": float(np.mean(master)),
            "median": float(np.median(master)),
            "std": float(np.std(master)),
            "min": float(np.min(master)),
            "max": float(np.max(master)),
        },
    }

    project = load_project(project_id)
    project["masters"]["master_flat"] = record
    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "create_master_flat",
        "description": f"Master Flat creado ({method}, {len(paths)} frames, normalizado)",
        "details": record,
    })
    save_project(project_id, project)
    return record


def calibrate_lights(
    project_id: str,
    use_dark: bool = True,
    use_flat: bool = True,
    hot_pixel_correction: bool = True,
    hot_pixel_sigma: float = 5.0,
    image_ids: list[str] | None = None,
) -> dict:
    """Calibrate light frames: subtract master dark, divide by master flat."""
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    masters = project.get("masters", {})

    master_dark = None
    if use_dark:
        md_record = masters.get("master_dark")
        if md_record:
            md_path = _projects_base() / project_id / "masters" / md_record["filename"]
            if md_path.exists():
                master_dark = _load_image_data(md_path)

    master_flat = None
    if use_flat:
        mf_record = masters.get("master_flat")
        if mf_record:
            mf_path = _projects_base() / project_id / "masters" / mf_record["filename"]
            if mf_path.exists():
                master_flat = _load_image_data(mf_path)

    if master_dark is None and master_flat is None:
        raise ValueError("No master dark or flat available for calibration")

    light_images = project["images"].get("light", [])
    if image_ids:
        light_images = [img for img in light_images if img["id"] in image_ids]

    if not light_images:
        raise ValueError("No light frames to calibrate")

    calibrated_dir = _projects_base() / project_id / "calibrated"
    calibrated_dir.mkdir(exist_ok=True)

    results = []
    for img in light_images:
        light_path = _projects_base() / project_id / "light" / img["stored_name"]
        if not light_path.exists():
            continue

        data = _load_image_data(light_path)

        # Subtract dark
        if master_dark is not None:
            if data.shape == master_dark.shape:
                data = data - master_dark
            else:
                pass  # Shape mismatch, skip

        # Divide by flat
        if master_flat is not None:
            if data.shape == master_flat.shape:
                data = data / master_flat

        # Hot pixel correction
        if hot_pixel_correction:
            data = _correct_hot_pixels(data, hot_pixel_sigma)

        cal_id = uuid.uuid4().hex[:8]
        cal_name = f"cal_{cal_id}_{img['filename']}"
        if not cal_name.lower().endswith(('.fits', '.fit', '.fts')):
            cal_name = cal_name.rsplit('.', 1)[0] + '.fits'
        cal_path = calibrated_dir / cal_name

        _save_fits(data, cal_path, {
            "IMAGETYP": "Calibrated Light",
            "ORIGFILE": img["filename"],
            "DARKUSED": str(use_dark and master_dark is not None),
            "FLATUSED": str(use_flat and master_flat is not None),
            "HOTPXCOR": str(hot_pixel_correction),
        })

        thumb = generate_thumbnail(cal_path, project_id)

        cal_record = {
            "id": cal_id,
            "original_id": img["id"],
            "filename": cal_name,
            "stored_name": cal_name,
            "frame_type": "calibrated_light",
            "source_frame_type": "light",
            "dark_applied": use_dark and master_dark is not None,
            "flat_applied": use_flat and master_flat is not None,
            "hot_pixel_corrected": hot_pixel_correction,
            "thumbnail": thumb,
            "metadata": {
                "format": "FITS",
                "width": data.shape[1],
                "height": data.shape[0],
                "filter": img.get("metadata", {}).get("filter"),
                "exposure": img.get("metadata", {}).get("exposure"),
                "data_mean": float(np.mean(data)),
                "data_median": float(np.median(data)),
                "data_min": float(np.min(data)),
                "data_max": float(np.max(data)),
            },
            "created": datetime.utcnow().isoformat(),
        }
        results.append(cal_record)

    # Store calibrated lights in project
    project = load_project(project_id)
    if "calibrated_lights" not in project:
        project["calibrated_lights"] = []
    project["calibrated_lights"].extend(results)

    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "calibrate_lights",
        "description": f"{len(results)} lights calibrados (dark={'sí' if use_dark else 'no'}, flat={'sí' if use_flat else 'no'}, hotpix={'sí' if hot_pixel_correction else 'no'})",
    })
    save_project(project_id, project)

    return {"calibrated": len(results), "images": results}


def _correct_hot_pixels(data: np.ndarray, sigma: float = 5.0) -> np.ndarray:
    """Replace hot/cold pixels with local median."""
    from scipy.ndimage import median_filter

    filtered = median_filter(data, size=3)
    diff = np.abs(data - filtered)
    threshold = sigma * np.std(diff)

    hot_mask = diff > threshold
    result = data.copy()
    result[hot_mask] = filtered[hot_mask]
    return result


def get_calibration_status(project_id: str) -> dict:
    """Get current calibration status for a project."""
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}

    imgs = project.get("images", {})
    masters = project.get("masters", {})
    cal_lights = project.get("calibrated_lights", [])

    return {
        "counts": {
            "bias": len(imgs.get("bias", [])),
            "dark": len(imgs.get("dark", [])),
            "flat": len(imgs.get("flat", [])),
            "light": len(imgs.get("light", [])),
        },
        "masters": {
            "master_bias": masters.get("master_bias"),
            "master_dark": masters.get("master_dark"),
            "master_flat": masters.get("master_flat"),
        },
        "calibrated_lights": cal_lights,
        "n_calibrated": len(cal_lights),
    }
