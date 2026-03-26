"""Field of View calculator for camera and eyepiece modes."""

import math


def calculate_camera_fov(
    focal_length_mm: float,
    pixel_size_um: float,
    sensor_width_px: int,
    sensor_height_px: int,
    binning: int = 1,
) -> dict:
    """Calculate camera field of view and plate scale.

    Returns FOV in arcminutes and degrees, plate scale in arcsec/pixel,
    and sensor dimensions in mm.
    """
    eff_pixel = pixel_size_um * binning

    sensor_width_mm = sensor_width_px * pixel_size_um / 1000.0
    sensor_height_mm = sensor_height_px * pixel_size_um / 1000.0

    # FOV in radians → arcminutes (×3437.747 = ×206265/60)
    fov_width_arcmin = sensor_width_mm / focal_length_mm * 3437.747
    fov_height_arcmin = sensor_height_mm / focal_length_mm * 3437.747

    plate_scale = eff_pixel / focal_length_mm * 206.265  # arcsec/pixel

    # Diagonal FOV
    sensor_diag_mm = math.sqrt(sensor_width_mm**2 + sensor_height_mm**2)
    fov_diag_arcmin = sensor_diag_mm / focal_length_mm * 3437.747

    return {
        "fov_width_arcmin": round(fov_width_arcmin, 2),
        "fov_height_arcmin": round(fov_height_arcmin, 2),
        "fov_width_deg": round(fov_width_arcmin / 60, 4),
        "fov_height_deg": round(fov_height_arcmin / 60, 4),
        "fov_diagonal_arcmin": round(fov_diag_arcmin, 2),
        "plate_scale_arcsec": round(plate_scale, 3),
        "sensor_width_mm": round(sensor_width_mm, 2),
        "sensor_height_mm": round(sensor_height_mm, 2),
        "resolution_width": sensor_width_px // binning,
        "resolution_height": sensor_height_px // binning,
    }


def calculate_eyepiece_fov(
    telescope_focal_mm: float,
    eyepiece_focal_mm: float,
    eyepiece_afov_deg: float,
) -> dict:
    """Calculate eyepiece field of view and magnification."""
    magnification = telescope_focal_mm / eyepiece_focal_mm
    true_fov_deg = eyepiece_afov_deg / magnification

    return {
        "magnification": round(magnification, 1),
        "true_fov_deg": round(true_fov_deg, 4),
        "true_fov_arcmin": round(true_fov_deg * 60, 2),
        "exit_pupil_mm": round(eyepiece_focal_mm * magnification / telescope_focal_mm, 2),
    }
