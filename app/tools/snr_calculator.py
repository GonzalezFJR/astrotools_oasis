"""Signal-to-Noise Ratio and exposure time calculator.

Implements the CCD equation for point sources observed through
a telescope with atmospheric effects.
"""

import math
from dataclasses import dataclass
from typing import Optional

from ..data.filters import FILTER_DATA


@dataclass
class CameraParams:
    pixel_size: float = 3.76       # μm
    binning: int = 1
    readout_noise: float = 6.0     # e-
    gain: float = 1.0              # e-/ADU
    temperature: float = -10.0     # °C operating temperature
    t_ref: float = 20.0            # °C reference temperature
    dark_current_ref: float = 0.1  # e-/s/pixel at t_ref


@dataclass
class TelescopeParams:
    focal_length: float = 1000.0       # mm
    diameter: float = 200.0            # mm primary
    secondary_diameter: float = 70.0   # mm secondary obstruction
    optical_efficiency: float = 0.85   # fraction


@dataclass
class ObservationParams:
    filter_band: str = "V"
    quantum_efficiency: float = 0.80
    airmass: float = 1.2
    object_magnitude: float = 10.0
    exposure_time: float = 60.0        # seconds
    seeing: float = 2.5                # arcsec FWHM
    aperture_radius: float = 5.0       # arcsec
    sky_brightness: Optional[float] = None   # mag/arcsec², None → use default
    extinction: Optional[float] = None       # mag/airmass, None → use default
    n_exposures: int = 1


def _common_rates(
    camera: CameraParams,
    telescope: TelescopeParams,
    obs: ObservationParams,
) -> dict:
    """Compute intermediate values shared by SNR and exposure-time solvers."""
    fdata = FILTER_DATA[obs.filter_band]

    # Effective collecting area (cm²)
    d_cm = telescope.diameter / 10.0
    d_sec_cm = telescope.secondary_diameter / 10.0
    a_eff = math.pi / 4.0 * (d_cm**2 - d_sec_cm**2)

    # Plate scale
    eff_pixel = camera.pixel_size * camera.binning  # μm
    plate_scale = eff_pixel / telescope.focal_length * 206.265  # arcsec/pixel
    pixel_area = plate_scale**2  # arcsec²/pixel

    # Extinction & sky
    extinction = obs.extinction if obs.extinction is not None else fdata["extinction"]
    sky_mag = obs.sky_brightness if obs.sky_brightness is not None else fdata["sky_brightness"]

    # Source signal rate (e⁻/s) — extinction-corrected
    m_corr = obs.object_magnitude + extinction * obs.airmass
    source_rate = (
        fdata["F0"]
        * fdata["bandwidth"]
        * 10 ** (-0.4 * m_corr)
        * a_eff
        * telescope.optical_efficiency
        * obs.quantum_efficiency
    )

    # Sky background rate per pixel (e⁻/s/pixel)
    sky_rate = (
        fdata["F0"]
        * fdata["bandwidth"]
        * 10 ** (-0.4 * sky_mag)
        * a_eff
        * telescope.optical_efficiency
        * obs.quantum_efficiency
        * pixel_area
    )

    # Dark current at operating temperature (doubles every ~5.8 °C)
    dark_current = camera.dark_current_ref * 2 ** (
        (camera.temperature - camera.t_ref) / 5.8
    )

    # Aperture geometry
    r_pix = obs.aperture_radius / plate_scale
    n_pix = math.pi * r_pix**2

    # Fraction of PSF captured (Gaussian model)
    sigma_pix = (obs.seeing / plate_scale) / 2.355
    if sigma_pix > 0:
        f_aperture = 1.0 - math.exp(-0.5 * (r_pix / sigma_pix) ** 2)
    else:
        f_aperture = 1.0

    return {
        "source_rate": source_rate,
        "sky_rate": sky_rate,
        "dark_current": dark_current,
        "n_pix": n_pix,
        "f_aperture": f_aperture,
        "plate_scale": plate_scale,
        "a_eff": a_eff,
        "r_pix": r_pix,
        "extinction": extinction,
        "sky_mag": sky_mag,
    }


def calculate_snr(
    camera: CameraParams,
    telescope: TelescopeParams,
    obs: ObservationParams,
) -> dict:
    """Calculate the signal-to-noise ratio for given parameters."""
    r = _common_rates(camera, telescope, obs)
    t = obs.exposure_time

    signal = r["source_rate"] * t * r["f_aperture"]

    noise_source = max(signal, 0)
    noise_sky = r["n_pix"] * r["sky_rate"] * t
    noise_dark = r["n_pix"] * r["dark_current"] * t
    noise_read = r["n_pix"] * camera.readout_noise**2

    total_variance = noise_source + noise_sky + noise_dark + noise_read
    snr_single = signal / math.sqrt(total_variance) if total_variance > 0 else 0.0
    snr_total = snr_single * math.sqrt(obs.n_exposures)

    return {
        "snr": round(snr_total, 2),
        "snr_single": round(snr_single, 2),
        "signal_electrons": round(signal, 1),
        "noise_source": round(math.sqrt(noise_source), 2) if noise_source > 0 else 0,
        "noise_sky": round(math.sqrt(noise_sky), 2),
        "noise_dark": round(math.sqrt(noise_dark), 2),
        "noise_read": round(math.sqrt(noise_read), 2),
        "total_noise": round(math.sqrt(total_variance), 2) if total_variance > 0 else 0,
        "pixel_scale": round(r["plate_scale"], 3),
        "n_pix_aperture": round(r["n_pix"], 1),
        "f_aperture": round(r["f_aperture"], 4),
        "source_rate": round(r["source_rate"], 4),
        "sky_rate_per_pixel": round(r["sky_rate"], 6),
        "dark_current": round(r["dark_current"], 6),
        "collecting_area_cm2": round(r["a_eff"], 2),
        "aperture_radius_px": round(r["r_pix"], 2),
        "mode": "snr",
    }


def calculate_exposure_time(
    camera: CameraParams,
    telescope: TelescopeParams,
    obs: ObservationParams,
    target_snr: float,
) -> dict:
    """Solve for exposure time to achieve a target SNR.

    Uses the quadratic formula on the CCD equation:
        SNR² · (s·f·t + n·(B+D)·t + n·R²) = (s·f·t)²
    where s = source_rate, f = f_aperture, B = sky_rate,
    D = dark_current, R = readout_noise, n = n_pix.
    """
    r = _common_rates(camera, telescope, obs)

    # Effective SNR per single exposure
    snr_1 = target_snr / math.sqrt(obs.n_exposures)
    n2 = snr_1**2

    sf = r["source_rate"] * r["f_aperture"]
    nd = r["n_pix"] * (r["sky_rate"] + r["dark_current"])
    nr = r["n_pix"] * camera.readout_noise**2

    # Quadratic: (sf)²·t² − N²·(sf + nd)·t − N²·nr = 0
    a = sf**2
    b = -n2 * (sf + nd)
    c = -n2 * nr

    if a <= 0:
        return {"error": "Source signal is zero or negative — check parameters."}

    discriminant = b**2 - 4 * a * c
    if discriminant < 0:
        return {"error": "No solution — target SNR is not achievable."}

    t_exp = (-b + math.sqrt(discriminant)) / (2 * a)

    # Re-calculate SNR at the solved exposure time to verify
    obs_check = ObservationParams(
        filter_band=obs.filter_band,
        quantum_efficiency=obs.quantum_efficiency,
        airmass=obs.airmass,
        object_magnitude=obs.object_magnitude,
        exposure_time=t_exp,
        seeing=obs.seeing,
        aperture_radius=obs.aperture_radius,
        sky_brightness=obs.sky_brightness,
        extinction=obs.extinction,
        n_exposures=obs.n_exposures,
    )
    result = calculate_snr(camera, telescope, obs_check)
    result["mode"] = "exposure"
    result["required_exposure_time"] = round(t_exp, 2)
    result["target_snr"] = target_snr
    return result
