"""SNR / Exposure Time calculator routes."""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from ..data.filters import FILTER_DATA
from ..tools.snr_calculator import (
    CameraParams,
    ObservationParams,
    TelescopeParams,
    calculate_exposure_time,
    calculate_snr,
)

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).resolve().parent.parent / "templates")


class CameraInput(BaseModel):
    pixel_size: float = Field(3.76, gt=0, description="Pixel size in μm")
    binning: int = Field(1, ge=1, le=8)
    readout_noise: float = Field(6.0, ge=0, description="Read noise in e-")
    gain: float = Field(1.0, gt=0, description="Gain in e-/ADU")
    temperature: float = Field(-10.0, description="Sensor temperature in °C")
    t_ref: float = Field(20.0, description="Reference temperature for dark current in °C")
    dark_current_ref: float = Field(0.1, ge=0, description="Dark current at T_ref in e-/s/pixel")


class TelescopeInput(BaseModel):
    focal_length: float = Field(1000.0, gt=0, description="Focal length in mm")
    diameter: float = Field(200.0, gt=0, description="Primary diameter in mm")
    secondary_diameter: float = Field(70.0, ge=0, description="Secondary diameter in mm")
    optical_efficiency: float = Field(0.85, gt=0, le=1)


class ObservationInput(BaseModel):
    filter_band: str = Field("V")
    quantum_efficiency: float = Field(0.80, gt=0, le=1)
    airmass: float = Field(1.2, ge=1, le=10)
    object_magnitude: float = Field(10.0)
    exposure_time: float = Field(60.0, gt=0, description="Exposure time in seconds")
    seeing: float = Field(2.5, gt=0, description="Seeing FWHM in arcsec")
    aperture_radius: float = Field(5.0, gt=0, description="Photometric aperture radius in arcsec")
    sky_brightness: float | None = Field(None, description="Sky brightness in mag/arcsec²")
    extinction: float | None = Field(None, description="Extinction coefficient in mag/airmass")
    n_exposures: int = Field(1, ge=1, description="Number of stacked exposures")


class SNRRequest(BaseModel):
    mode: str = Field("snr", pattern="^(snr|exposure)$")
    camera: CameraInput = CameraInput()
    telescope: TelescopeInput = TelescopeInput()
    observation: ObservationInput = ObservationInput()
    target_snr: float = Field(10.0, gt=0)


@router.get("/snr", response_class=HTMLResponse)
async def snr_page(request: Request):
    return templates.TemplateResponse(
        request,
        "snr.html",
        context={"filters": list(FILTER_DATA.keys())},
    )


@router.post("/api/snr/calculate")
async def snr_calculate(data: SNRRequest):
    camera = CameraParams(
        pixel_size=data.camera.pixel_size,
        binning=data.camera.binning,
        readout_noise=data.camera.readout_noise,
        gain=data.camera.gain,
        temperature=data.camera.temperature,
        t_ref=data.camera.t_ref,
        dark_current_ref=data.camera.dark_current_ref,
    )
    telescope = TelescopeParams(
        focal_length=data.telescope.focal_length,
        diameter=data.telescope.diameter,
        secondary_diameter=data.telescope.secondary_diameter,
        optical_efficiency=data.telescope.optical_efficiency,
    )
    obs = ObservationParams(
        filter_band=data.observation.filter_band,
        quantum_efficiency=data.observation.quantum_efficiency,
        airmass=data.observation.airmass,
        object_magnitude=data.observation.object_magnitude,
        exposure_time=data.observation.exposure_time,
        seeing=data.observation.seeing,
        aperture_radius=data.observation.aperture_radius,
        sky_brightness=data.observation.sky_brightness,
        extinction=data.observation.extinction,
        n_exposures=data.observation.n_exposures,
    )

    if data.mode == "snr":
        result = calculate_snr(camera, telescope, obs)
    else:
        result = calculate_exposure_time(camera, telescope, obs, data.target_snr)

    return result
