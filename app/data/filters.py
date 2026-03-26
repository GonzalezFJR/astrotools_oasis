"""Photometric filter band data.

Zero-point photon fluxes (F0) from Bessell (1979) in photons/s/cm²/Å
for a magnitude-0 star above the atmosphere.
"""

FILTER_DATA = {
    "U": {
        "name": "U (Ultraviolet)",
        "lambda_eff": 3600,
        "bandwidth": 680,
        "F0": 417.5,
        "extinction": 0.55,
        "sky_brightness": 22.0,
        "default_qe": 0.40,
    },
    "B": {
        "name": "B (Blue)",
        "lambda_eff": 4400,
        "bandwidth": 980,
        "F0": 632.0,
        "extinction": 0.25,
        "sky_brightness": 22.7,
        "default_qe": 0.65,
    },
    "V": {
        "name": "V (Visual)",
        "lambda_eff": 5500,
        "bandwidth": 890,
        "F0": 363.1,
        "extinction": 0.15,
        "sky_brightness": 21.8,
        "default_qe": 0.80,
    },
    "R": {
        "name": "R (Red)",
        "lambda_eff": 6400,
        "bandwidth": 2200,
        "F0": 217.7,
        "extinction": 0.10,
        "sky_brightness": 20.9,
        "default_qe": 0.75,
    },
    "I": {
        "name": "I (Infrared)",
        "lambda_eff": 7900,
        "bandwidth": 2400,
        "F0": 112.6,
        "extinction": 0.05,
        "sky_brightness": 19.9,
        "default_qe": 0.50,
    },
    "L": {
        "name": "L (Luminance)",
        "lambda_eff": 5500,
        "bandwidth": 3000,
        "F0": 363.1,
        "extinction": 0.15,
        "sky_brightness": 21.8,
        "default_qe": 0.75,
    },
    "Ha": {
        "name": "Hα (Hydrogen Alpha)",
        "lambda_eff": 6563,
        "bandwidth": 70,
        "F0": 217.7,
        "extinction": 0.10,
        "sky_brightness": 17.5,
        "default_qe": 0.70,
    },
    "OIII": {
        "name": "[O III]",
        "lambda_eff": 5007,
        "bandwidth": 70,
        "F0": 363.1,
        "extinction": 0.15,
        "sky_brightness": 18.5,
        "default_qe": 0.75,
    },
    "SII": {
        "name": "[S II]",
        "lambda_eff": 6720,
        "bandwidth": 70,
        "F0": 217.7,
        "extinction": 0.09,
        "sky_brightness": 17.0,
        "default_qe": 0.68,
    },
}
