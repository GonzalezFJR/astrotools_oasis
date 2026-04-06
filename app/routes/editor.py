"""AstroEditor routes — project management, image upload, and classification."""

import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from ..data.tutorials import get_tutorial, get_tutorial_list
from ..tools.editor_project import (
    PROJECTS_DIR,
    add_image_to_project,
    create_project,
    delete_image,
    delete_project,
    get_undo_redo_status,
    list_projects,
    load_project,
    reclassify_image,
    redo_project,
    save_project,
    undo_project,
    update_image_metadata,
)

# Base dir for bundled tutorial datasets (eagle_nebula/, antennae/)
TUTORIAL_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "tutorial_datasets"

router = APIRouter(prefix="/editor", tags=["editor"])
templates = Jinja2Templates(
    directory=Path(__file__).resolve().parent.parent / "templates"
)


# ── Page ─────────────────────────────────────────────────────────────

@router.get("", response_class=HTMLResponse)
async def editor_page(request: Request):
    return templates.TemplateResponse(request, "editor.html")


# ── Project CRUD ─────────────────────────────────────────────────────

class CreateProjectBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    date: str = ""
    object_name: str = ""
    telescope: str = ""
    observer: str = ""
    location: str = ""
    notes: str = ""


@router.post("/api/projects")
async def api_create_project(body: CreateProjectBody):
    meta = body.model_dump(exclude={"name"})
    project = create_project(body.name, metadata=meta)
    return project


@router.get("/api/projects")
async def api_list_projects():
    return list_projects()


@router.get("/api/projects/{project_id}")
async def api_get_project(project_id: str):
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}, 404
    return project


@router.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: str):
    ok = delete_project(project_id)
    return {"deleted": ok}


class UpdateProjectMetaBody(BaseModel):
    name: str | None = None
    metadata: dict | None = None


@router.patch("/api/projects/{project_id}")
async def api_update_project(project_id: str, body: UpdateProjectMetaBody):
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}
    if body.name is not None:
        project["name"] = body.name
    if body.metadata is not None:
        project["metadata"].update(body.metadata)
    save_project(project_id, project)
    return project


# ── Image upload ─────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/images")
async def api_upload_images(
    project_id: str,
    frame_type: str = Form(""),
    files: list[UploadFile] = File(...),
):
    results = []
    errors = []
    for f in files:
        try:
            content = await f.read()
            ft = frame_type if frame_type else None
            record = add_image_to_project(project_id, f.filename or "unknown", content, ft)
            results.append(record)
        except Exception as e:
            errors.append({"filename": f.filename, "error": str(e)})
    return {"uploaded": results, "errors": errors}


# ── Image management ─────────────────────────────────────────────────

class ReclassifyBody(BaseModel):
    new_type: str


@router.patch("/api/projects/{project_id}/images/{image_id}/reclassify")
async def api_reclassify(project_id: str, image_id: str, body: ReclassifyBody):
    result = reclassify_image(project_id, image_id, body.new_type)
    if result is None:
        return {"error": "Image not found"}
    return result


class UpdateImageMetaBody(BaseModel):
    user_metadata: dict


@router.patch("/api/projects/{project_id}/images/{image_id}/metadata")
async def api_update_image_meta(
    project_id: str, image_id: str, body: UpdateImageMetaBody
):
    result = update_image_metadata(project_id, image_id, body.user_metadata)
    if result is None:
        return {"error": "Image not found"}
    return result


@router.delete("/api/projects/{project_id}/images/{image_id}")
async def api_delete_image(project_id: str, image_id: str):
    ok = delete_image(project_id, image_id)
    return {"deleted": ok}


# ── Thumbnail serving ────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/thumbnails/{filename}")
async def api_get_thumbnail(project_id: str, filename: str):
    thumb_path = PROJECTS_DIR / project_id / "thumbnails" / filename
    if not thumb_path.exists():
        return {"error": "Thumbnail not found"}
    return FileResponse(thumb_path, media_type="image/jpeg")


# ── Save project state ──────────────────────────────────────────────

@router.post("/api/projects/{project_id}/save")
async def api_save_project(project_id: str):
    project = load_project(project_id)
    if project is None:
        return {"error": "Project not found"}
    save_project(project_id, project)
    return {"saved": True, "modified": project["modified"]}


# ── Undo / Redo ──────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/undo")
async def api_undo(project_id: str):
    result = undo_project(project_id)
    if result is None:
        return {"error": "Nothing to undo"}
    return result


@router.post("/api/projects/{project_id}/redo")
async def api_redo(project_id: str):
    result = redo_project(project_id)
    if result is None:
        return {"error": "Nothing to redo"}
    return result


@router.get("/api/projects/{project_id}/undo-redo-status")
async def api_undo_redo_status(project_id: str):
    return get_undo_redo_status(project_id)


# ── Calibration ──────────────────────────────────────────────────────

from ..tools.editor_calibration import (
    calibrate_lights,
    create_master_bias,
    create_master_dark,
    create_master_flat,
    get_calibration_status,
)


class MasterFrameBody(BaseModel):
    method: str = Field("median", pattern="^(mean|median|sigma_clip)$")
    sigma: float = Field(3.0, gt=0, le=10)
    subtract_bias: bool = True
    image_ids: list[str] | None = None


@router.get("/api/projects/{project_id}/calibration/status")
async def api_calibration_status(project_id: str):
    return get_calibration_status(project_id)


@router.post("/api/projects/{project_id}/calibration/master-bias")
async def api_create_master_bias(project_id: str, body: MasterFrameBody):
    try:
        result = create_master_bias(project_id, body.method, body.sigma, body.image_ids)
        return result
    except Exception as e:
        return {"error": str(e)}


@router.post("/api/projects/{project_id}/calibration/master-dark")
async def api_create_master_dark(project_id: str, body: MasterFrameBody):
    try:
        result = create_master_dark(
            project_id, body.method, body.sigma, body.subtract_bias, body.image_ids
        )
        return result
    except Exception as e:
        return {"error": str(e)}


@router.post("/api/projects/{project_id}/calibration/master-flat")
async def api_create_master_flat(project_id: str, body: MasterFrameBody):
    try:
        result = create_master_flat(
            project_id, body.method, body.sigma, body.subtract_bias, body.image_ids
        )
        return result
    except Exception as e:
        return {"error": str(e)}


class CalibrateLightsBody(BaseModel):
    use_dark: bool = True
    use_flat: bool = True
    hot_pixel_correction: bool = True
    hot_pixel_sigma: float = Field(5.0, gt=0, le=20)
    image_ids: list[str] | None = None


@router.post("/api/projects/{project_id}/calibration/calibrate-lights")
async def api_calibrate_lights(project_id: str, body: CalibrateLightsBody):
    try:
        result = calibrate_lights(
            project_id,
            body.use_dark,
            body.use_flat,
            body.hot_pixel_correction,
            body.hot_pixel_sigma,
            body.image_ids,
        )
        return result
    except Exception as e:
        return {"error": str(e)}


# ── Alignment ────────────────────────────────────────────────────────

from ..tools.editor_alignment import (
    align_frames,
    detect_stars_for_image,
    get_alignment_status,
)


class DetectStarsBody(BaseModel):
    image_id: str
    source: str = Field("light", pattern="^(light|calibrated)$")
    threshold_sigma: float = Field(5.0, gt=0, le=20)


@router.post("/api/projects/{project_id}/alignment/detect-stars")
async def api_detect_stars(project_id: str, body: DetectStarsBody):
    try:
        result = detect_stars_for_image(
            project_id, body.image_id, body.source, body.threshold_sigma
        )
        return result
    except Exception as e:
        return {"error": str(e)}


class AlignFramesBody(BaseModel):
    method: str = Field("similarity", pattern="^(translation|similarity|affine)$")
    use_calibrated: bool = True
    reference_id: str | None = None
    threshold_sigma: float = Field(5.0, gt=0, le=20)
    discard_rms_threshold: float = Field(0.0, ge=0)
    image_ids: list[str] | None = None


@router.post("/api/projects/{project_id}/alignment/align")
async def api_align_frames(project_id: str, body: AlignFramesBody):
    try:
        result = align_frames(
            project_id,
            body.method,
            body.use_calibrated,
            body.reference_id,
            body.threshold_sigma,
            body.discard_rms_threshold,
            body.image_ids,
        )
        return result
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/projects/{project_id}/alignment/status")
async def api_alignment_status(project_id: str):
    return get_alignment_status(project_id)


# ── Stacking ─────────────────────────────────────────────────────────

from ..tools.editor_stacking import (
    delete_stacked_result,
    get_stacking_status,
    stack_frames,
)


class StackFramesBody(BaseModel):
    method: str = Field("sigma_clip", pattern="^(mean|median|sigma_clip|winsorized|max|min)$")
    sigma: float = Field(3.0, gt=0, le=10)
    use_aligned: bool = True
    normalize: bool = True
    reject_percent: float = Field(0.0, ge=0, le=50)
    weight_by_quality: bool = False
    image_ids: list[str] | None = None


@router.post("/api/projects/{project_id}/stacking/stack")
async def api_stack_frames(project_id: str, body: StackFramesBody):
    try:
        result = stack_frames(
            project_id,
            body.method,
            body.sigma,
            body.use_aligned,
            body.normalize,
            body.reject_percent,
            body.image_ids,
            body.weight_by_quality,
        )
        return result
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/projects/{project_id}/stacking/status")
async def api_stacking_status(project_id: str):
    return get_stacking_status(project_id)


@router.delete("/api/projects/{project_id}/stacking/{stack_id}")
async def api_delete_stacked(project_id: str, stack_id: str):
    ok = delete_stacked_result(project_id, stack_id)
    return {"deleted": ok}


# ── Processing (crop, rotate, flip, stretch) ─────────────────────────

from ..tools.editor_processing import (
    auto_crop_borders,
    crop_image,
    delete_processed_result,
    flip_image,
    get_image_histogram,
    get_processing_status,
    get_stretch_preview,
    rotate_image,
    stretch_image,
)


class SourceRef(BaseModel):
    source_id: str
    source_type: str = Field("stacked", pattern="^(stacked|processed|aligned|calibrated|light)$")


class CropBody(SourceRef):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., ge=10)
    height: int = Field(..., ge=10)


@router.post("/api/projects/{project_id}/processing/crop")
async def api_crop(project_id: str, body: CropBody):
    try:
        return crop_image(project_id, body.source_id, body.source_type,
                          body.x, body.y, body.width, body.height)
    except Exception as e:
        return {"error": str(e)}


class RotateBody(SourceRef):
    angle: float
    auto_crop: bool = True


@router.post("/api/projects/{project_id}/processing/rotate")
async def api_rotate(project_id: str, body: RotateBody):
    try:
        return rotate_image(project_id, body.source_id, body.source_type,
                            body.angle, body.auto_crop)
    except Exception as e:
        return {"error": str(e)}


class FlipBody(SourceRef):
    axis: str = Field(..., pattern="^(horizontal|vertical)$")


@router.post("/api/projects/{project_id}/processing/flip")
async def api_flip(project_id: str, body: FlipBody):
    try:
        return flip_image(project_id, body.source_id, body.source_type, body.axis)
    except Exception as e:
        return {"error": str(e)}


class AutoCropBody(SourceRef):
    threshold_percent: float = Field(1.0, ge=0, le=50)


@router.post("/api/projects/{project_id}/processing/auto-crop")
async def api_auto_crop(project_id: str, body: AutoCropBody):
    try:
        return auto_crop_borders(project_id, body.source_id, body.source_type,
                                 body.threshold_percent)
    except Exception as e:
        return {"error": str(e)}


class StretchBody(SourceRef):
    method: str = Field("asinh", pattern="^(linear|log|sqrt|asinh|histogram|midtone|curves)$")
    params: dict | None = None


@router.post("/api/projects/{project_id}/processing/stretch")
async def api_stretch(project_id: str, body: StretchBody):
    try:
        return stretch_image(project_id, body.source_id, body.source_type,
                             body.method, body.params)
    except Exception as e:
        return {"error": str(e)}


class StretchPreviewBody(SourceRef):
    method: str = Field("asinh", pattern="^(linear|log|sqrt|asinh|histogram|midtone|curves)$")
    params: dict | None = None
    max_size: int = Field(800, ge=200, le=2000)


@router.post("/api/projects/{project_id}/processing/stretch-preview")
async def api_stretch_preview(project_id: str, body: StretchPreviewBody):
    from fastapi.responses import Response
    try:
        jpeg_bytes = get_stretch_preview(project_id, body.source_id, body.source_type,
                                         body.method, body.params, body.max_size)
        return Response(content=jpeg_bytes, media_type="image/jpeg")
    except Exception as e:
        return {"error": str(e)}


class HistogramBody(SourceRef):
    n_bins: int = Field(256, ge=32, le=1024)


@router.post("/api/projects/{project_id}/processing/histogram")
async def api_histogram(project_id: str, body: HistogramBody):
    try:
        return get_image_histogram(project_id, body.source_id, body.source_type, body.n_bins)
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/projects/{project_id}/processing/status")
async def api_processing_status(project_id: str):
    return get_processing_status(project_id)


@router.delete("/api/projects/{project_id}/processing/{result_id}")
async def api_delete_processed(project_id: str, result_id: str):
    ok = delete_processed_result(project_id, result_id)
    return {"deleted": ok}


# ── Color composition ────────────────────────────────────────────────

from ..tools.editor_color import (
    compose_color,
    delete_color_composite,
    export_image,
    get_color_preview,
    get_color_status,
    get_mono_preview,
    get_palettes,
)


@router.get("/api/palettes")
async def api_palettes():
    return get_palettes()


class ComposeColorBody(BaseModel):
    channels: dict  # {"R": {"source_id":..., "source_type":...}, "G":..., "B":...}
    saturation: float = Field(1.0, ge=0, le=3)
    luminance_id: str | None = None
    luminance_type: str = "stacked"
    luminance_weight: float = Field(0.7, ge=0, le=1)
    auto_balance: bool = True
    stretch_method: str | None = None
    stretch_params: dict | None = None


@router.post("/api/projects/{project_id}/color/compose")
async def api_compose_color(project_id: str, body: ComposeColorBody):
    try:
        return compose_color(
            project_id,
            body.channels,
            body.saturation,
            body.luminance_id,
            body.luminance_type,
            body.luminance_weight,
            body.auto_balance,
            body.stretch_method,
            body.stretch_params,
        )
    except Exception as e:
        return {"error": str(e)}


@router.get("/api/projects/{project_id}/color/status")
async def api_color_status(project_id: str):
    return get_color_status(project_id)


@router.delete("/api/projects/{project_id}/color/{composite_id}")
async def api_delete_composite(project_id: str, composite_id: str):
    ok = delete_color_composite(project_id, composite_id)
    return {"deleted": ok}


# ── Preview ──────────────────────────────────────────────────────────


class ColorPreviewBody(BaseModel):
    composite_id: str
    max_size: int = Field(1200, ge=200, le=4000)


@router.post("/api/projects/{project_id}/preview/color")
async def api_color_preview(project_id: str, body: ColorPreviewBody):
    from fastapi.responses import Response
    try:
        jpeg = get_color_preview(project_id, body.composite_id, body.max_size)
        return Response(content=jpeg, media_type="image/jpeg")
    except Exception as e:
        return {"error": str(e)}


class MonoPreviewBody(BaseModel):
    source_id: str
    source_type: str = Field("stacked", pattern="^(stacked|processed|aligned|calibrated|light|color_composite)$")
    stretch_method: str = Field("asinh", pattern="^(linear|log|sqrt|asinh|histogram|midtone)$")
    stretch_params: dict | None = None
    max_size: int = Field(1200, ge=200, le=4000)


@router.post("/api/projects/{project_id}/preview/mono")
async def api_mono_preview(project_id: str, body: MonoPreviewBody):
    from fastapi.responses import Response
    try:
        jpeg = get_mono_preview(
            project_id, body.source_id, body.source_type,
            body.stretch_method, body.stretch_params, body.max_size,
        )
        return Response(content=jpeg, media_type="image/jpeg")
    except Exception as e:
        return {"error": str(e)}


# ── Export ───────────────────────────────────────────────────────────


class ExportBody(BaseModel):
    source_id: str
    source_type: str = Field("stacked", pattern="^(stacked|processed|aligned|calibrated|light|color_composite)$")
    format: str = Field("fits", pattern="^(fits|tiff|png|jpg)$")
    bit_depth: int = Field(16, ge=8, le=32)
    stretch_on_export: bool = False
    stretch_method: str = Field("asinh", pattern="^(linear|log|sqrt|asinh|histogram|midtone)$")
    stretch_params: dict | None = None


@router.post("/api/projects/{project_id}/export")
async def api_export(project_id: str, body: ExportBody):
    try:
        file_path, media_type = export_image(
            project_id, body.source_id, body.source_type,
            body.format, body.bit_depth,
            body.stretch_on_export, body.stretch_method, body.stretch_params,
        )
        return FileResponse(
            file_path,
            media_type=media_type,
            filename=file_path.name,
        )
    except Exception as e:
        return {"error": str(e)}


# ── Tutorials ────────────────────────────────────────────────────────

@router.get("/api/tutorials")
async def api_list_tutorials():
    """Return summary list of all available tutorials."""
    return get_tutorial_list()


@router.get("/api/tutorials/{tutorial_id}")
async def api_get_tutorial(tutorial_id: str):
    """Return full tutorial definition with steps."""
    tut = get_tutorial(tutorial_id)
    if tut is None:
        return {"error": "Tutorial not found"}
    return tut


@router.post("/api/tutorials/{tutorial_id}/start")
async def api_start_tutorial(tutorial_id: str):
    """Create a project pre-loaded with the tutorial dataset (if bundled)."""
    tut = get_tutorial(tutorial_id)
    if tut is None:
        return {"error": "Tutorial not found"}

    # Create the project with tutorial metadata
    meta = {
        k: v for k, v in tut["project_meta"].items() if k != "name"
    }
    meta["tutorial_id"] = tutorial_id
    project = create_project(tut["project_meta"]["name"], metadata=meta)
    project_id = project["id"]

    # If bundled, copy dataset files into the project
    if tut["bundled"]:
        dataset_dir = TUTORIAL_DATA_DIR / tut["dataset_folder"]
        loaded = 0
        for file_info in tut["files"]:
            src = dataset_dir / file_info["name"]
            if src.exists():
                file_bytes = src.read_bytes()
                add_image_to_project(
                    project_id,
                    file_info["name"],
                    file_bytes,
                    frame_type=file_info["type"],
                )
                loaded += 1

        return {
            "project": load_project(project_id),
            "loaded_files": loaded,
            "tutorial": tut,
        }

    # Not bundled — project created empty, user must upload files
    return {
        "project": project,
        "loaded_files": 0,
        "tutorial": tut,
    }
