"""AstroEditor — Stacking: combine aligned frames into a final integrated image."""

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


# ── Combination functions ────────────────────────────────────────────

def _sigma_clipped_mean(stack: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    """Sigma-clipped mean: reject outlier pixels per position."""
    mean = np.mean(stack, axis=0)
    std = np.std(stack, axis=0)
    std[std == 0] = 1.0
    mask = np.abs(stack - mean[np.newaxis]) <= sigma * std[np.newaxis]
    counts = np.sum(mask, axis=0)
    counts[counts == 0] = 1
    return np.sum(stack * mask, axis=0) / counts


def _winsorized_sigma_clip(stack: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    """Winsorized sigma-clip: replace outliers with boundary values instead of rejecting."""
    mean = np.mean(stack, axis=0)
    std = np.std(stack, axis=0)
    std[std == 0] = 1.0
    lo = mean - sigma * std
    hi = mean + sigma * std
    clipped = np.clip(stack, lo[np.newaxis], hi[np.newaxis])
    return np.mean(clipped, axis=0)


def _combine_stack(
    arrays: list[np.ndarray],
    method: str = "sigma_clip",
    sigma: float = 3.0,
    weights: list[float] | None = None,
) -> np.ndarray:
    """Combine an array stack with the chosen method."""
    stack = np.array(arrays, dtype=np.float64)

    if method == "mean":
        if weights:
            w = np.array(weights, dtype=np.float64)
            w /= w.sum()
            return np.average(stack, axis=0, weights=w)
        return np.mean(stack, axis=0)

    elif method == "median":
        return np.median(stack, axis=0)

    elif method == "sigma_clip":
        return _sigma_clipped_mean(stack, sigma)

    elif method == "winsorized":
        return _winsorized_sigma_clip(stack, sigma)

    elif method == "max":
        return np.max(stack, axis=0)

    elif method == "min":
        return np.min(stack, axis=0)

    else:
        raise ValueError(f"Unknown stacking method: {method}")


# ── Main stacking function ──────────────────────────────────────────

def stack_frames(
    project_id: str,
    method: str = "sigma_clip",
    sigma: float = 3.0,
    use_aligned: bool = True,
    normalize: bool = True,
    reject_percent: float = 0.0,
    image_ids: list[str] | None = None,
    weight_by_quality: bool = False,
) -> dict:
    """
    Stack aligned (or calibrated) light frames into a single integrated image.

    Parameters
    ----------
    method : mean | median | sigma_clip | winsorized | max | min
    sigma : sigma threshold for sigma_clip / winsorized
    use_aligned : if True, use aligned lights; else calibrated lights
    normalize : normalize each frame to the same median before stacking
    reject_percent : discard the lowest N% quality frames (0-50)
    image_ids : optional list of specific image IDs to stack
    weight_by_quality : weight frames by quality score (only for mean)
    """
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    # Select source images
    if use_aligned and project.get("aligned_lights"):
        source_images = list(project["aligned_lights"])
        source_dir = "aligned"
    elif project.get("calibrated_lights"):
        source_images = list(project["calibrated_lights"])
        source_dir = "calibrated"
    else:
        source_images = list(project["images"].get("light", []))
        source_dir = "light"

    if image_ids:
        source_images = [img for img in source_images if img["id"] in image_ids]

    if len(source_images) < 2:
        raise ValueError("Need at least 2 frames to stack")

    # Quality-based rejection
    if reject_percent > 0 and reject_percent < 50:
        scored = [(img, img.get("quality_score", 0)) for img in source_images]
        scored.sort(key=lambda x: x[1], reverse=True)
        keep_n = max(2, int(len(scored) * (1 - reject_percent / 100)))
        source_images = [s[0] for s in scored[:keep_n]]

    # Load all frames
    arrays = []
    used_images = []
    for img in source_images:
        fpath = _projects_base() / project_id / source_dir / img["stored_name"]
        if not fpath.exists():
            continue
        data = _load_image_data(fpath)
        arrays.append(data)
        used_images.append(img)

    if len(arrays) < 2:
        raise ValueError("Not enough valid frames to stack")

    # Verify same shape
    shape = arrays[0].shape
    valid_arrays = []
    valid_images = []
    for arr, img in zip(arrays, used_images):
        if arr.shape == shape:
            valid_arrays.append(arr)
            valid_images.append(img)

    if len(valid_arrays) < 2:
        raise ValueError(f"Not enough frames with matching dimensions ({shape})")

    # Normalize to common median if requested
    medians = [float(np.median(a)) for a in valid_arrays]
    if normalize:
        target_median = np.median(medians)
        if target_median > 0:
            for i in range(len(valid_arrays)):
                if medians[i] > 0:
                    valid_arrays[i] = valid_arrays[i] * (target_median / medians[i])

    # Compute weights
    weights = None
    if weight_by_quality and method == "mean":
        scores = [img.get("quality_score", 1.0) for img in valid_images]
        if all(s > 0 for s in scores):
            weights = scores

    # Stack
    result = _combine_stack(valid_arrays, method, sigma, weights)

    # Compute statistics
    stack_stats = {
        "n_frames": len(valid_arrays),
        "method": method,
        "sigma": sigma if method in ("sigma_clip", "winsorized") else None,
        "normalized": normalize,
        "weighted": weight_by_quality and method == "mean",
        "source": source_dir,
        "reject_percent": reject_percent,
        "result_mean": float(np.mean(result)),
        "result_median": float(np.median(result)),
        "result_std": float(np.std(result)),
        "result_min": float(np.min(result)),
        "result_max": float(np.max(result)),
        "width": int(shape[1]),
        "height": int(shape[0]),
        "snr_estimate": float(np.mean(result) / max(np.std(result), 1e-10)),
        "frame_medians": medians[:len(valid_arrays)],
    }

    # Save result
    results_dir = _projects_base() / project_id / "results"
    results_dir.mkdir(exist_ok=True)

    stack_id = uuid.uuid4().hex[:8]
    stack_name = f"stacked_{stack_id}_{method}.fits"
    stack_path = results_dir / stack_name

    _save_fits(result, stack_path, {
        "IMAGETYP": "Stacked",
        "STACKMET": method,
        "STACKN": len(valid_arrays),
        "STACKNRM": str(normalize),
    })

    thumb = generate_thumbnail(stack_path, project_id)

    # Save in project
    project = load_project(project_id)
    stack_record = {
        "id": stack_id,
        "filename": stack_name,
        "stored_name": stack_name,
        "frame_type": "stacked",
        "thumbnail": thumb,
        "stats": stack_stats,
        "used_frames": [img["id"] for img in valid_images],
        "created": datetime.utcnow().isoformat(),
    }

    if "stacked_results" not in project:
        project["stacked_results"] = []
    project["stacked_results"].append(stack_record)

    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "stack_frames",
        "description": (
            f"Apilado: {len(valid_arrays)} frames con método {method}"
            f"{' (σ=' + str(sigma) + ')' if method in ('sigma_clip', 'winsorized') else ''}"
            f", resultado: media={stack_stats['result_mean']:.1f}, SNR≈{stack_stats['snr_estimate']:.1f}"
        ),
    })
    save_project(project_id, project)

    return {
        "stack_id": stack_id,
        "filename": stack_name,
        "thumbnail": thumb,
        "stats": stack_stats,
        "used_frames": len(valid_arrays),
    }


def get_stacking_status(project_id: str) -> dict:
    """Get current stacking status for a project."""
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}

    return {
        "stacked_results": project.get("stacked_results", []),
        "has_aligned": len(project.get("aligned_lights", [])) > 0,
        "has_calibrated": len(project.get("calibrated_lights", [])) > 0,
        "n_lights": len(project.get("images", {}).get("light", [])),
        "n_aligned": len(project.get("aligned_lights", [])),
        "n_calibrated": len(project.get("calibrated_lights", [])),
    }


def delete_stacked_result(project_id: str, stack_id: str) -> bool:
    """Delete a stacked result."""
    project = load_project(project_id)
    if project is None:
        return False

    results = project.get("stacked_results", [])
    target = None
    for r in results:
        if r["id"] == stack_id:
            target = r
            break

    if target is None:
        return False

    # Delete file
    fpath = _projects_base() / project_id / "results" / target["stored_name"]
    if fpath.exists():
        fpath.unlink()

    # Delete thumbnail
    if target.get("thumbnail"):
        tpath = _projects_base() / project_id / "thumbnails" / Path(target["thumbnail"]).name
        if tpath.exists():
            tpath.unlink()

    project["stacked_results"] = [r for r in results if r["id"] != stack_id]
    save_project(project_id, project)
    return True
