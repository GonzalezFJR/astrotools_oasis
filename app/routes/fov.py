"""Field of View calculator routes."""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from ..data.catalogs import MESSIER_CATALOG, NGC_CATALOG, SOLAR_SYSTEM_CATALOG
from ..tools.fov_calculator import calculate_camera_fov, calculate_eyepiece_fov

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parent.parent / "templates")


class CameraFOVInput(BaseModel):
    pixel_size: float = Field(3.76, gt=0, description="Pixel size in μm")
    sensor_width: int = Field(4656, gt=0, description="Sensor width in pixels")
    sensor_height: int = Field(3520, gt=0, description="Sensor height in pixels")
    binning: int = Field(1, ge=1, le=8)


class EyepieceFOVInput(BaseModel):
    focal_length: float = Field(25.0, gt=0, description="Eyepiece focal length in mm")
    afov: float = Field(52.0, gt=0, le=120, description="Apparent field of view in degrees")


class FOVRequest(BaseModel):
    mode: str = Field("camera", pattern="^(camera|eyepiece)$")
    telescope_focal_length: float = Field(1000.0, gt=0, description="Telescope focal length in mm")
    telescope_diameter: float = Field(200.0, gt=0, description="Telescope aperture in mm")
    camera: CameraFOVInput = CameraFOVInput()
    eyepiece: EyepieceFOVInput = EyepieceFOVInput()
    rotation: float = Field(0.0, ge=0, lt=360, description="Field rotation in degrees")


@router.get("/fov", response_class=HTMLResponse)
async def fov_page(request: Request):
    return templates.TemplateResponse(request, "fov.html")


@router.post("/api/fov/calculate")
async def fov_calculate(data: FOVRequest):
    if data.mode == "camera":
        result = calculate_camera_fov(
            focal_length_mm=data.telescope_focal_length,
            pixel_size_um=data.camera.pixel_size,
            sensor_width_px=data.camera.sensor_width,
            sensor_height_px=data.camera.sensor_height,
            binning=data.camera.binning,
        )
    else:
        result = calculate_eyepiece_fov(
            telescope_focal_mm=data.telescope_focal_length,
            eyepiece_focal_mm=data.eyepiece.focal_length,
            eyepiece_afov_deg=data.eyepiece.afov,
        )

    result["mode"] = data.mode
    result["rotation"] = data.rotation
    result["telescope_focal_length"] = data.telescope_focal_length
    result["telescope_diameter"] = data.telescope_diameter
    result["f_ratio"] = data.telescope_focal_length / data.telescope_diameter
    return result


@router.get("/api/catalogs/{catalog_type}")
async def get_catalog(catalog_type: str):
    catalogs = {
        "messier": MESSIER_CATALOG,
        "ngc": NGC_CATALOG,
        "solar-system": SOLAR_SYSTEM_CATALOG,
    }
    if catalog_type not in catalogs:
        return {"error": f"Unknown catalog: {catalog_type}"}
    return catalogs[catalog_type]
