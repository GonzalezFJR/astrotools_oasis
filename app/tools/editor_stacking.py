"""AstroEditor — Stacking: combine aligned frames into a final integrated image.

Memory-efficient: uses running accumulators for mean/weighted-mean, and chunked
row-block processing for median / sigma_clip / winsorized / max / min, so peak
memory stays bounded regardless of the number of frames.
"""

import gc
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


# ── Slab-level combination helpers (operate on (N, chunk_H, W) slabs) ──

def _sigma_clipped_mean_slab(slab: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    mean = np.mean(slab, axis=0)
    std = np.std(slab, axis=0)
    std[std == 0] = 1.0
    mask = np.abs(slab - mean[np.newaxis]) <= sigma * std[np.newaxis]
    counts = np.sum(mask, axis=0)
    counts[counts == 0] = 1
    return np.sum(slab * mask, axis=0) / counts


def _winsorized_slab(slab: np.ndarray, sigma: float = 3.0) -> np.ndarray:
    mean = np.mean(slab, axis=0)
    std = np.std(slab, axis=0)
    std[std == 0] = 1.0
    lo = mean - sigma * std
    hi = mean + sigma * std
    clipped = np.clip(slab, lo[np.newaxis], hi[np.newaxis])
    return np.mean(clipped, axis=0)


def _combine_slab(slab: np.ndarray, method: str, sigma: float,
                  weights: np.ndarray | None = None) -> np.ndarray:
    """Combine a (N, chunk_H, W) slab with the chosen method."""
    if method == "mean":
        if weights is not None:
            return np.average(slab, axis=0, weights=weights)
        return np.mean(slab, axis=0)
    elif method == "median":
        return np.median(slab, axis=0)
    elif method == "sigma_clip":
        return _sigma_clipped_mean_slab(slab, sigma)
    elif method == "winsorized":
        return _winsorized_slab(slab, sigma)
    elif method == "max":
        return np.max(slab, axis=0)
    elif method == "min":
        return np.min(slab, axis=0)
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

    Memory-efficient: for ``mean`` (with or without weights) uses a single-pass
    running accumulator (peak ~ 1 frame).  For all other methods uses chunked
    row-block processing so peak memory ~ chunk_rows x width x N (capped ~256 MB).

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

    # ── Pre-scan: resolve paths, check shapes, compute medians (1 frame at a time) ──
    valid_images: list[dict] = []
    valid_paths: list[Path] = []
    medians: list[float] = []
    shape = None

    for img in source_images:
        fpath = _projects_base() / project_id / source_dir / img["stored_name"]
        if not fpath.exists():
            continue
        data = _load_image_data(fpath)
        if shape is None:
            shape = data.shape
        elif data.shape != shape:
            del data; gc.collect()
            continue
        medians.append(float(np.median(data)))
        valid_images.append(img)
        valid_paths.append(fpath)
        del data; gc.collect()

    n = len(valid_images)
    if n < 2:
        raise ValueError("Not enough valid frames to stack")

    # Normalization factors
    norm_factors = [1.0] * n
    if normalize:
        target_median = float(np.median(medians))
        if target_median > 0:
            norm_factors = [(target_median / m) if m > 0 else 1.0 for m in medians]

    # Weights
    w_arr: np.ndarray | None = None
    if weight_by_quality and method == "mean":
        scores = [img.get("quality_score", 1.0) for img in valid_images]
        if all(s > 0 for s in scores):
            w_arr = np.array(scores, dtype=np.float64)
            w_arr /= w_arr.sum()

    # ── MEAN (weighted or not): single-pass running accumulator ──
    if method == "mean":
        running_sum = np.zeros(shape, dtype=np.float64)
        for fi, (fpath, nf) in enumerate(zip(valid_paths, norm_factors)):
            data = _load_image_data(fpath).astype(np.float64) * nf
            if w_arr is not None:
                running_sum += data * w_arr[fi]
            else:
                running_sum += data
            del data; gc.collect()
        result = running_sum if w_arr is not None else running_sum / n
        del running_sum; gc.collect()

    else:
        # ── Chunked row-block approach ──
        bytes_per_pixel = 8
        target_bytes = 256 * 1024 * 1024
        chunk_rows = max(1, target_bytes // (shape[1] * n * bytes_per_pixel))
        chunk_rows = min(chunk_rows, shape[0])

        result = np.empty(shape, dtype=np.float64)

        for row_start in range(0, shape[0], chunk_rows):
            row_end = min(row_start + chunk_rows, shape[0])
            slab_h = row_end - row_start
            slab = np.empty((n, slab_h, shape[1]), dtype=np.float64)

            for fi, (fpath, nf) in enumerate(zip(valid_paths, norm_factors)):
                data = _load_image_data(fpath)
                slab[fi] = data[row_start:row_end].astype(np.float64) * nf
                del data; gc.collect()

            result[row_start:row_end] = _combine_slab(slab, method, sigma, w_arr)
            del slab; gc.collect()

    # Compute statistics
    stack_stats = {
        "n_frames": n,
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
        "frame_medians": medians,
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
        "STACKN": n,
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
            f"Apilado: {n} frames con método {method}"
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
        "used_frames": n,
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
