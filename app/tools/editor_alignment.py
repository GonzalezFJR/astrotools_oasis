"""AstroEditor — Alignment: star detection, frame alignment, quality scoring."""

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


def _detect_stars(data: np.ndarray, threshold_sigma: float = 5.0, min_area: int = 5, max_stars: int = 200) -> list[dict]:
    """Detect stars using simple peak detection with local maxima.

    For large images the expensive background estimation (median_filter 64)
    is computed on a downsampled copy and then up-scaled, keeping quality
    while cutting runtime and memory by up to 16×.
    """
    from scipy.ndimage import label, median_filter, zoom

    h, w = data.shape

    # Smooth slightly to reduce noise
    smoothed = median_filter(data.astype(np.float64), size=3)

    # Adaptive background estimation: downsample if image is large
    _BG_MAX_DIM = 2048  # max dimension before downsampling
    ds_factor = max(1, max(h, w) // _BG_MAX_DIM)
    if ds_factor > 1:
        small = smoothed[::ds_factor, ::ds_factor]
        bg_small = median_filter(small, size=max(16, 64 // ds_factor))
        bg = zoom(bg_small, (h / bg_small.shape[0], w / bg_small.shape[1]), order=1)
        # Trim/pad if rounding produces slightly different shape
        bg = bg[:h, :w]
        del small, bg_small
    else:
        bg = median_filter(smoothed, size=64)

    subtracted = smoothed - bg
    del smoothed, bg

    std = np.std(subtracted)
    if std == 0:
        return []

    # Threshold
    thresh = threshold_sigma * std
    binary = subtracted > thresh

    # Label connected components
    labeled, n_features = label(binary)
    del binary
    if n_features == 0:
        return []

    stars = []
    for i in range(1, min(n_features + 1, max_stars * 3)):
        mask = labeled == i
        area = np.sum(mask)
        if area < min_area:
            continue

        ys, xs = np.where(mask)
        flux = np.sum(subtracted[mask])
        # Centroid (flux-weighted)
        cx = np.average(xs, weights=subtracted[ys, xs].clip(0.001))
        cy = np.average(ys, weights=subtracted[ys, xs].clip(0.001))
        peak = np.max(subtracted[mask])

        stars.append({
            "x": float(cx),
            "y": float(cy),
            "flux": float(flux),
            "peak": float(peak),
            "area": int(area),
        })

    # Sort by flux descending, keep top max_stars
    stars.sort(key=lambda s: s["flux"], reverse=True)
    return stars[:max_stars]


def _compute_frame_quality(stars: list[dict], data: np.ndarray) -> dict:
    """Compute quality metrics for a frame based on detected stars."""
    if not stars:
        return {"n_stars": 0, "score": 0.0, "mean_peak": 0.0, "mean_flux": 0.0, "fwhm_estimate": 0.0}

    n_stars = len(stars)
    mean_peak = np.mean([s["peak"] for s in stars])
    mean_flux = np.mean([s["flux"] for s in stars])
    mean_area = np.mean([s["area"] for s in stars])

    # FWHM estimate from mean area (circular approximation)
    fwhm_estimate = 2.0 * np.sqrt(mean_area / np.pi)

    # Score: higher = better (more stars, brighter, tighter)
    score = n_stars * mean_peak / (fwhm_estimate + 1)

    return {
        "n_stars": n_stars,
        "score": float(score),
        "mean_peak": float(mean_peak),
        "mean_flux": float(mean_flux),
        "fwhm_estimate": float(fwhm_estimate),
    }


def _match_stars(ref_stars: list[dict], target_stars: list[dict], max_dist: float = 50.0) -> list[tuple]:
    """Match stars between reference and target using triangle-based matching."""
    if len(ref_stars) < 3 or len(target_stars) < 3:
        return []

    # Use top N stars for matching
    n = min(30, len(ref_stars), len(target_stars))
    ref = ref_stars[:n]
    tgt = target_stars[:n]

    ref_pts = np.array([[s["x"], s["y"]] for s in ref])
    tgt_pts = np.array([[s["x"], s["y"]] for s in tgt])

    # Simple nearest-neighbor on triangles attempt
    # Build distance matrices
    from scipy.spatial.distance import cdist

    # Try brute-force closest match with iterative refinement
    matches = []
    used_tgt = set()

    for i, rp in enumerate(ref_pts):
        dists = np.sqrt(np.sum((tgt_pts - rp) ** 2, axis=1))
        order = np.argsort(dists)
        for j in order:
            if j not in used_tgt and dists[j] < max_dist:
                matches.append((i, int(j)))
                used_tgt.add(j)
                break

    return matches


def _compute_transform(ref_stars: list[dict], target_stars: list[dict], matches: list[tuple], method: str = "similarity"):
    """Compute geometric transformation from matches."""
    if len(matches) < 3:
        return None, float("inf")

    ref_pts = np.array([[ref_stars[i]["x"], ref_stars[i]["y"]] for i, _ in matches])
    tgt_pts = np.array([[target_stars[j]["x"], target_stars[j]["y"]] for _, j in matches])

    if method == "translation":
        # Simple translation only
        dx = np.median(ref_pts[:, 0] - tgt_pts[:, 0])
        dy = np.median(ref_pts[:, 1] - tgt_pts[:, 1])
        matrix = np.array([
            [1, 0, dx],
            [0, 1, dy],
            [0, 0, 1],
        ], dtype=np.float64)
        # Compute RMS
        transformed = tgt_pts + np.array([dx, dy])
        rms = np.sqrt(np.mean(np.sum((ref_pts - transformed) ** 2, axis=1)))
        return matrix, float(rms)

    elif method == "similarity":
        # Similarity: rotation + scale + translation
        from skimage.transform import SimilarityTransform, estimate_transform
        tform = estimate_transform("similarity", tgt_pts, ref_pts)
        transformed = tform(tgt_pts)
        rms = np.sqrt(np.mean(np.sum((ref_pts - transformed) ** 2, axis=1)))
        return tform.params, float(rms)

    elif method == "affine":
        from skimage.transform import AffineTransform, estimate_transform
        tform = estimate_transform("affine", tgt_pts, ref_pts)
        transformed = tform(tgt_pts)
        rms = np.sqrt(np.mean(np.sum((ref_pts - transformed) ** 2, axis=1)))
        return tform.params, float(rms)

    else:
        raise ValueError(f"Unknown alignment method: {method}")


def _apply_transform(data: np.ndarray, matrix: np.ndarray)-> np.ndarray:
    """Apply an affine transformation to image data."""
    from skimage.transform import warp, AffineTransform

    if isinstance(matrix, np.ndarray) and matrix.shape == (3, 3):
        tform = AffineTransform(matrix=matrix)
    else:
        tform = AffineTransform(matrix=np.array(matrix))

    # Use inverse mapping for warp
    aligned = warp(
        data,
        tform.inverse,
        output_shape=data.shape,
        order=3,
        mode="constant",
        cval=0.0,
        preserve_range=True,
    )
    return aligned


def detect_stars_for_image(project_id: str, image_id: str, source: str = "light", threshold_sigma: float = 5.0) -> dict:
    """Detect stars in a single image and return results."""
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    # Find the image
    filepath = None
    img_record = None

    if source == "calibrated":
        cal_lights = project.get("calibrated_lights", [])
        for img in cal_lights:
            if img["id"] == image_id:
                filepath = _projects_base() / project_id / "calibrated" / img["stored_name"]
                img_record = img
                break
    else:
        for ft in ("light", "dark", "flat", "bias"):
            for img in project["images"].get(ft, []):
                if img["id"] == image_id:
                    filepath = _projects_base() / project_id / ft / img["stored_name"]
                    img_record = img
                    source = ft
                    break
            if filepath:
                break

    if filepath is None or not filepath.exists():
        raise ValueError(f"Image {image_id} not found")

    data = _load_image_data(filepath)
    stars = _detect_stars(data, threshold_sigma=threshold_sigma)
    quality = _compute_frame_quality(stars, data)

    return {
        "image_id": image_id,
        "filename": img_record.get("filename", filepath.name),
        "source": source,
        "stars": stars,
        "quality": quality,
    }


def align_frames(
    project_id: str,
    method: str = "similarity",
    use_calibrated: bool = True,
    reference_id: str | None = None,
    threshold_sigma: float = 5.0,
    discard_rms_threshold: float = 0.0,
    image_ids: list[str] | None = None,
) -> dict:
    """Align all light frames to a reference frame.

    Memory-efficient two-pass approach:
      Pass 1 — detect stars & compute quality (one frame at a time, keep only
               star catalogs and quality scores — discard pixel data).
      Pass 2 — reload each frame one at a time, compute/apply transform, write
               aligned output, then discard pixel data before the next frame.
    Peak memory ≈ 2 frames (reference kept in RAM for possible future use,
    + 1 frame being processed).
    """
    import gc

    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    # Determine source images
    if use_calibrated and project.get("calibrated_lights"):
        source_images = project["calibrated_lights"]
        source_dir = "calibrated"
    else:
        source_images = project["images"].get("light", [])
        source_dir = "light"

    if image_ids:
        source_images = [img for img in source_images if img["id"] in image_ids]

    if len(source_images) < 2:
        raise ValueError("Need at least 2 frames to align")

    # ── Pass 1: detect stars + quality (no pixel data retained) ──
    frame_meta = []  # list of {img, stars, quality, path}
    for img in source_images:
        fpath = _projects_base() / project_id / source_dir / img["stored_name"]
        if not fpath.exists():
            continue
        data = _load_image_data(fpath)
        stars = _detect_stars(data, threshold_sigma=threshold_sigma)
        quality = _compute_frame_quality(stars, data)
        del data; gc.collect()
        frame_meta.append({
            "img": img,
            "stars": stars,
            "quality": quality,
            "path": fpath,
        })

    if len(frame_meta) < 2:
        raise ValueError("Not enough valid frames to align")

    # Select reference frame (highest quality)
    if reference_id:
        ref_idx = next((i for i, f in enumerate(frame_meta) if f["img"]["id"] == reference_id), None)
        if ref_idx is None:
            ref_idx = max(range(len(frame_meta)), key=lambda i: frame_meta[i]["quality"]["score"])
    else:
        ref_idx = max(range(len(frame_meta)), key=lambda i: frame_meta[i]["quality"]["score"])

    ref_meta = frame_meta[ref_idx]

    # ── Pass 2: align frames one at a time ──
    aligned_dir = _projects_base() / project_id / "aligned"
    aligned_dir.mkdir(exist_ok=True)

    results = []
    discarded = []

    for i, fm in enumerate(frame_meta):
        data = _load_image_data(fm["path"])

        if i == ref_idx:
            # Reference frame: save as-is
            al_id = uuid.uuid4().hex[:8]
            al_name = f"aligned_{al_id}_{fm['img'].get('filename', 'ref.fits')}"
            if not al_name.lower().endswith(('.fits', '.fit', '.fts')):
                al_name = al_name.rsplit('.', 1)[0] + '.fits'
            al_path = aligned_dir / al_name

            _save_fits(data, al_path, {
                "IMAGETYP": "Aligned Light",
                "ALIGNREF": "True",
                "ORIGFILE": fm["img"].get("filename", ""),
            })

            thumb = generate_thumbnail(al_path, project_id)

            results.append({
                "id": al_id,
                "original_id": fm["img"]["id"],
                "filename": al_name,
                "stored_name": al_name,
                "frame_type": "aligned_light",
                "is_reference": True,
                "n_stars": fm["quality"]["n_stars"],
                "quality_score": fm["quality"]["score"],
                "fwhm": fm["quality"]["fwhm_estimate"],
                "rms": 0.0,
                "transform": "identity",
                "thumbnail": thumb,
                "metadata": {
                    "format": "FITS",
                    "width": data.shape[1],
                    "height": data.shape[0],
                    "filter": fm["img"].get("metadata", {}).get("filter"),
                    "exposure": fm["img"].get("metadata", {}).get("exposure"),
                },
                "created": datetime.utcnow().isoformat(),
            })
            del data; gc.collect()
            continue

        # Match stars
        matches = _match_stars(ref_meta["stars"], fm["stars"])
        if len(matches) < 3:
            discarded.append({
                "image_id": fm["img"]["id"],
                "filename": fm["img"].get("filename", ""),
                "reason": f"Insufficient star matches ({len(matches)})",
            })
            del data; gc.collect()
            continue

        # Compute transform
        matrix, rms = _compute_transform(ref_meta["stars"], fm["stars"], matches, method)
        if matrix is None:
            discarded.append({
                "image_id": fm["img"]["id"],
                "filename": fm["img"].get("filename", ""),
                "reason": "Failed to compute transformation",
            })
            del data; gc.collect()
            continue

        # Discard if RMS too high
        if discard_rms_threshold > 0 and rms > discard_rms_threshold:
            discarded.append({
                "image_id": fm["img"]["id"],
                "filename": fm["img"].get("filename", ""),
                "reason": f"RMS too high ({rms:.2f} > {discard_rms_threshold:.2f})",
                "rms": rms,
            })
            del data; gc.collect()
            continue

        # Apply transform
        aligned_data = _apply_transform(data, matrix)
        del data; gc.collect()

        al_id = uuid.uuid4().hex[:8]
        al_name = f"aligned_{al_id}_{fm['img'].get('filename', 'frame.fits')}"
        if not al_name.lower().endswith(('.fits', '.fit', '.fts')):
            al_name = al_name.rsplit('.', 1)[0] + '.fits'
        al_path = aligned_dir / al_name

        matrix_list = matrix.tolist() if isinstance(matrix, np.ndarray) else matrix

        _save_fits(aligned_data, al_path, {
            "IMAGETYP": "Aligned Light",
            "ALIGNREF": "False",
            "ALIGNRMS": round(rms, 4),
            "ORIGFILE": fm["img"].get("filename", ""),
        })

        thumb = generate_thumbnail(al_path, project_id)

        results.append({
            "id": al_id,
            "original_id": fm["img"]["id"],
            "filename": al_name,
            "stored_name": al_name,
            "frame_type": "aligned_light",
            "is_reference": False,
            "n_stars": fm["quality"]["n_stars"],
            "n_matches": len(matches),
            "quality_score": fm["quality"]["score"],
            "fwhm": fm["quality"]["fwhm_estimate"],
            "rms": rms,
            "transform": matrix_list,
            "method": method,
            "thumbnail": thumb,
            "metadata": {
                "format": "FITS",
                "width": aligned_data.shape[1],
                "height": aligned_data.shape[0],
                "filter": fm["img"].get("metadata", {}).get("filter"),
                "exposure": fm["img"].get("metadata", {}).get("exposure"),
            },
            "created": datetime.utcnow().isoformat(),
        })
        del aligned_data; gc.collect()

    # Save to project
    project = load_project(project_id)
    project["aligned_lights"] = results
    project["alignment_discarded"] = discarded
    project["alignment_params"] = {
        "method": method,
        "use_calibrated": use_calibrated,
        "reference_id": frame_meta[ref_idx]["img"]["id"],
        "threshold_sigma": threshold_sigma,
        "discard_rms_threshold": discard_rms_threshold,
    }

    project["processing_log"].append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": "align_frames",
        "description": f"Alineamiento: {len(results)} alineados, {len(discarded)} descartados (método: {method})",
    })
    save_project(project_id, project)

    return {
        "aligned": len(results),
        "discarded": len(discarded),
        "reference_id": frame_meta[ref_idx]["img"]["id"],
        "method": method,
        "images": results,
        "discarded_details": discarded,
    }


def get_alignment_status(project_id: str) -> dict:
    """Get current alignment status for a project."""
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}

    return {
        "aligned_lights": project.get("aligned_lights", []),
        "discarded": project.get("alignment_discarded", []),
        "params": project.get("alignment_params"),
        "n_aligned": len(project.get("aligned_lights", [])),
        "has_calibrated": len(project.get("calibrated_lights", [])) > 0,
        "n_lights": len(project.get("images", {}).get("light", [])),
    }
