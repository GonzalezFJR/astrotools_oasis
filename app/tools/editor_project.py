"""AstroEditor — Project management and image metadata extraction."""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

PROJECTS_DIR = Path("/tmp/astroeditor_projects")

FRAME_TYPES = ("light", "dark", "flat", "bias", "unclassified")

SUPPORTED_EXTENSIONS = {
    ".fits", ".fit", ".fts",
    ".png", ".jpg", ".jpeg",
    ".tif", ".tiff",
    ".cr2", ".cr3",
}


def _projects_base() -> Path:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    return PROJECTS_DIR


def create_project(name: str, metadata: dict[str, Any] | None = None) -> dict:
    project_id = uuid.uuid4().hex[:12]
    project_dir = _projects_base() / project_id

    for subdir in (*FRAME_TYPES, "masters", "results"):
        (project_dir / subdir).mkdir(parents=True, exist_ok=True)

    project = {
        "id": project_id,
        "name": name,
        "created": datetime.utcnow().isoformat(),
        "modified": datetime.utcnow().isoformat(),
        "metadata": metadata or {},
        "images": {ft: [] for ft in FRAME_TYPES},
        "masters": {},
        "processing_log": [],
    }
    _save_project(project_id, project)
    return project


def load_project(project_id: str) -> dict | None:
    path = _projects_base() / project_id / "project.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _save_project(project_id: str, data: dict) -> None:
    data["modified"] = datetime.utcnow().isoformat()
    path = _projects_base() / project_id / "project.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Undo / Redo snapshots ───────────────────────────────────────────
_MAX_UNDO = 30
_undo_stacks: dict[str, list[str]] = {}   # project_id -> [json_snapshots]
_redo_stacks: dict[str, list[str]] = {}


def _push_undo(project_id: str, data: dict) -> None:
    """Save a snapshot of the current project state for undo."""
    stack = _undo_stacks.setdefault(project_id, [])
    snapshot = json.dumps(data, ensure_ascii=False)
    stack.append(snapshot)
    if len(stack) > _MAX_UNDO:
        stack.pop(0)
    # Clear redo on new action
    _redo_stacks.pop(project_id, None)


def undo_project(project_id: str) -> dict | None:
    """Undo the last action: restore previous project state."""
    stack = _undo_stacks.get(project_id, [])
    if not stack:
        return None
    # Save current state to redo
    current = load_project(project_id)
    if current:
        redo = _redo_stacks.setdefault(project_id, [])
        redo.append(json.dumps(current, ensure_ascii=False))
    # Restore from undo stack
    snapshot = stack.pop()
    restored = json.loads(snapshot)
    _save_project(project_id, restored)
    return restored


def redo_project(project_id: str) -> dict | None:
    """Redo a previously undone action."""
    redo = _redo_stacks.get(project_id, [])
    if not redo:
        return None
    # Save current to undo (without clearing redo)
    current = load_project(project_id)
    if current:
        stack = _undo_stacks.setdefault(project_id, [])
        stack.append(json.dumps(current, ensure_ascii=False))
    snapshot = redo.pop()
    restored = json.loads(snapshot)
    _save_project(project_id, restored)
    return restored


def get_undo_redo_status(project_id: str) -> dict:
    """Return how many undo/redo steps are available."""
    return {
        "undo_count": len(_undo_stacks.get(project_id, [])),
        "redo_count": len(_redo_stacks.get(project_id, [])),
    }


def save_project(project_id: str, data: dict) -> None:
    """Save project with undo snapshot."""
    current = load_project(project_id)
    if current:
        _push_undo(project_id, current)
    _save_project(project_id, data)


def list_projects() -> list[dict]:
    base = _projects_base()
    projects = []
    for d in sorted(base.iterdir()):
        pf = d / "project.json"
        if pf.exists():
            p = json.loads(pf.read_text(encoding="utf-8"))
            projects.append({
                "id": p["id"],
                "name": p["name"],
                "created": p["created"],
                "modified": p["modified"],
                "image_count": sum(len(v) for v in p.get("images", {}).values()),
            })
    return projects


def delete_project(project_id: str) -> bool:
    path = _projects_base() / project_id
    if path.exists():
        shutil.rmtree(path)
        return True
    return False


def _infer_frame_type(filename: str, header: dict[str, Any] | None = None) -> str:
    name_lower = filename.lower()
    for ft in ("dark", "flat", "bias", "light"):
        if ft in name_lower:
            return ft

    if header:
        image_type = str(header.get("IMAGETYP", header.get("FRAME", ""))).lower()
        if "dark" in image_type:
            return "dark"
        if "flat" in image_type:
            return "flat"
        if "bias" in image_type or "zero" in image_type:
            return "bias"
        if "light" in image_type or "science" in image_type:
            return "light"

    return "unclassified"


def _extract_fits_metadata(filepath: Path) -> dict[str, Any]:
    from astropy.io import fits as astropy_fits

    meta: dict[str, Any] = {}
    try:
        with astropy_fits.open(filepath) as hdul:
            hdr = hdul[0].header
            meta["format"] = "FITS"
            meta["width"] = hdr.get("NAXIS1", 0)
            meta["height"] = hdr.get("NAXIS2", 0)
            meta["bitpix"] = hdr.get("BITPIX")
            meta["exposure"] = hdr.get("EXPTIME") or hdr.get("EXPOSURE")
            meta["gain"] = hdr.get("GAIN")
            meta["binning_x"] = hdr.get("XBINNING")
            meta["binning_y"] = hdr.get("YBINNING")
            meta["filter"] = hdr.get("FILTER")
            meta["temperature"] = hdr.get("CCD-TEMP") or hdr.get("SET-TEMP")
            meta["date_obs"] = hdr.get("DATE-OBS")
            meta["object"] = hdr.get("OBJECT")
            meta["telescope"] = hdr.get("TELESCOP")
            meta["instrument"] = hdr.get("INSTRUME")
            meta["observer"] = hdr.get("OBSERVER")
            meta["image_type"] = hdr.get("IMAGETYP") or hdr.get("FRAME")
            meta["ra"] = hdr.get("RA") or hdr.get("OBJCTRA")
            meta["dec"] = hdr.get("DEC") or hdr.get("OBJCTDEC")
            meta["pixel_size"] = hdr.get("XPIXSZ")

            data = hdul[0].data
            if data is not None:
                meta["data_min"] = float(np.nanmin(data))
                meta["data_max"] = float(np.nanmax(data))
                meta["data_mean"] = float(np.nanmean(data))
                meta["data_median"] = float(np.nanmedian(data))

            meta["_header"] = {
                k: _safe_header_value(v)
                for k, v in hdr.items()
                if k and k != "COMMENT" and k != "HISTORY"
            }
    except Exception as e:
        meta["error"] = str(e)
    return meta


def _safe_header_value(v: Any) -> Any:
    if isinstance(v, (int, float, str, bool)):
        return v
    return str(v)


def _extract_raw_metadata(filepath: Path) -> dict[str, Any]:
    import rawpy

    meta: dict[str, Any] = {"format": "RAW"}
    try:
        with rawpy.imread(str(filepath)) as raw:
            meta["width"] = raw.sizes.width
            meta["height"] = raw.sizes.height
            meta["raw_type"] = raw.raw_type.name if hasattr(raw.raw_type, 'name') else str(raw.raw_type)
            meta["num_colors"] = raw.num_colors
            meta["color_desc"] = raw.color_desc.decode() if isinstance(raw.color_desc, bytes) else str(raw.color_desc)
    except Exception as e:
        meta["error"] = str(e)
    return meta


def _extract_standard_metadata(filepath: Path) -> dict[str, Any]:
    from PIL import Image
    from PIL.ExifTags import TAGS

    meta: dict[str, Any] = {"format": filepath.suffix.upper().lstrip(".")}
    try:
        with Image.open(filepath) as img:
            meta["width"] = img.width
            meta["height"] = img.height
            meta["mode"] = img.mode

            exif = img.getexif()
            if exif:
                for tag_id, value in exif.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    if tag_name == "ExposureTime":
                        if isinstance(value, tuple):
                            meta["exposure"] = value[0] / value[1] if value[1] else None
                        else:
                            meta["exposure"] = float(value)
                    elif tag_name == "ISOSpeedRatings":
                        meta["gain"] = value
                    elif tag_name == "DateTime":
                        meta["date_obs"] = str(value)
                    elif tag_name == "Make":
                        meta["instrument"] = str(value)
                    elif tag_name == "Model":
                        meta["telescope"] = str(value)
    except Exception as e:
        meta["error"] = str(e)
    return meta


def _extract_tiff_metadata(filepath: Path) -> dict[str, Any]:
    import tifffile

    meta: dict[str, Any] = {"format": "TIFF"}
    try:
        with tifffile.TiffFile(str(filepath)) as tif:
            page = tif.pages[0]
            meta["width"] = page.shape[1] if len(page.shape) > 1 else page.shape[0]
            meta["height"] = page.shape[0]
            meta["dtype"] = str(page.dtype)
            meta["bits_per_sample"] = page.bitspersample
            if len(page.shape) > 2:
                meta["channels"] = page.shape[2]
    except Exception as e:
        meta["error"] = str(e)
    return meta


def extract_metadata(filepath: Path) -> dict[str, Any]:
    ext = filepath.suffix.lower()
    if ext in (".fits", ".fit", ".fts"):
        return _extract_fits_metadata(filepath)
    elif ext in (".cr2", ".cr3"):
        return _extract_raw_metadata(filepath)
    elif ext in (".tif", ".tiff"):
        return _extract_tiff_metadata(filepath)
    else:
        return _extract_standard_metadata(filepath)


def generate_thumbnail(filepath: Path, project_id: str, max_size: int = 256) -> str | None:
    ext = filepath.suffix.lower()
    thumb_dir = _projects_base() / project_id / "thumbnails"
    thumb_dir.mkdir(exist_ok=True)
    thumb_name = filepath.stem + "_thumb.jpg"
    thumb_path = thumb_dir / thumb_name

    try:
        if ext in (".fits", ".fit", ".fts"):
            from astropy.io import fits as astropy_fits
            with astropy_fits.open(filepath) as hdul:
                data = hdul[0].data
                if data is None:
                    return None
                if data.ndim > 2:
                    data = data[0]
                vmin, vmax = np.nanpercentile(data, [1, 99])
                if vmax <= vmin:
                    vmax = vmin + 1
                stretched = np.clip((data - vmin) / (vmax - vmin) * 255, 0, 255).astype(np.uint8)
                from PIL import Image
                img = Image.fromarray(stretched, mode="L")

        elif ext in (".cr2", ".cr3"):
            import rawpy
            with rawpy.imread(str(filepath)) as raw:
                rgb = raw.postprocess(use_auto_wb=True, half_size=True)
            from PIL import Image
            img = Image.fromarray(rgb)

        elif ext in (".tif", ".tiff"):
            import tifffile
            data = tifffile.imread(str(filepath))
            if data.dtype != np.uint8:
                vmin, vmax = np.nanpercentile(data, [1, 99])
                if vmax <= vmin:
                    vmax = vmin + 1
                data = np.clip((data.astype(float) - vmin) / (vmax - vmin) * 255, 0, 255).astype(np.uint8)
            from PIL import Image
            if data.ndim == 2:
                img = Image.fromarray(data, mode="L")
            else:
                img = Image.fromarray(data)
        else:
            from PIL import Image
            img = Image.open(filepath)

        img.thumbnail((max_size, max_size))
        img = img.convert("RGB")
        img.save(thumb_path, "JPEG", quality=80)
        return f"thumbnails/{thumb_name}"

    except Exception:
        return None


def add_image_to_project(
    project_id: str,
    filename: str,
    file_bytes: bytes,
    frame_type: str | None = None,
) -> dict:
    project = load_project(project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported format: {ext}")

    safe_name = Path(filename).name
    image_id = uuid.uuid4().hex[:8]
    unique_name = f"{image_id}_{safe_name}"

    temp_path = _projects_base() / project_id / "unclassified" / unique_name
    temp_path.write_bytes(file_bytes)

    meta = extract_metadata(temp_path)

    if frame_type and frame_type in FRAME_TYPES:
        inferred_type = frame_type
    else:
        inferred_type = _infer_frame_type(filename, meta.get("_header"))

    final_dir = _projects_base() / project_id / inferred_type
    final_dir.mkdir(exist_ok=True)
    final_path = final_dir / unique_name
    if str(temp_path) != str(final_path):
        shutil.move(str(temp_path), str(final_path))

    thumbnail = generate_thumbnail(final_path, project_id)

    cleaned_meta = {k: v for k, v in meta.items() if k != "_header"}

    image_record = {
        "id": image_id,
        "filename": safe_name,
        "stored_name": unique_name,
        "frame_type": inferred_type,
        "metadata": cleaned_meta,
        "thumbnail": thumbnail,
        "added": datetime.utcnow().isoformat(),
        "user_metadata": {},
    }

    project["images"][inferred_type].append(image_record)
    _save_project(project_id, project)

    return image_record


def reclassify_image(project_id: str, image_id: str, new_type: str) -> dict | None:
    if new_type not in FRAME_TYPES:
        raise ValueError(f"Invalid frame type: {new_type}")

    project = load_project(project_id)
    if project is None:
        return None

    image_record = None
    old_type = None
    for ft in FRAME_TYPES:
        for img in project["images"][ft]:
            if img["id"] == image_id:
                image_record = img
                old_type = ft
                break
        if image_record:
            break

    if not image_record or old_type is None:
        return None

    old_path = _projects_base() / project_id / old_type / image_record["stored_name"]
    new_dir = _projects_base() / project_id / new_type
    new_dir.mkdir(exist_ok=True)
    new_path = new_dir / image_record["stored_name"]

    if old_path.exists():
        shutil.move(str(old_path), str(new_path))

    project["images"][old_type] = [
        i for i in project["images"][old_type] if i["id"] != image_id
    ]
    image_record["frame_type"] = new_type
    project["images"][new_type].append(image_record)

    _save_project(project_id, project)
    return image_record


def update_image_metadata(
    project_id: str, image_id: str, user_metadata: dict
) -> dict | None:
    project = load_project(project_id)
    if project is None:
        return None

    for ft in FRAME_TYPES:
        for img in project["images"][ft]:
            if img["id"] == image_id:
                img["user_metadata"].update(user_metadata)
                _save_project(project_id, project)
                return img
    return None


def delete_image(project_id: str, image_id: str) -> bool:
    project = load_project(project_id)
    if project is None:
        return False

    for ft in FRAME_TYPES:
        for img in project["images"][ft]:
            if img["id"] == image_id:
                file_path = _projects_base() / project_id / ft / img["stored_name"]
                if file_path.exists():
                    file_path.unlink()
                if img.get("thumbnail"):
                    thumb_path = _projects_base() / project_id / img["thumbnail"]
                    if thumb_path.exists():
                        thumb_path.unlink()
                project["images"][ft] = [
                    i for i in project["images"][ft] if i["id"] != image_id
                ]
                _save_project(project_id, project)
                return True
    return False
