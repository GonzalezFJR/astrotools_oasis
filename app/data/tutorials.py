"""
Tutorial definitions for AstroEditor guided tutorials.

Three tutorials with increasing complexity:
1. Eagle Nebula (M16)     — SHO narrowband color composition
2. Antennae Galaxies      — Broadband + Hα color composition
3. M8+M20 Laguna/Trifida  — Full pipeline (calibration → export)
"""

TUTORIALS = {
    # ─────────────────────────────────────────────────────────────
    # Tutorial 1: Eagle Nebula — Composición SHO (3 canales)
    # ─────────────────────────────────────────────────────────────
    "eagle_nebula": {
        "id": "eagle_nebula",
        "title": "Nebulosa del Águila (M16) — Paleta SHO",
        "subtitle": "Composición de color con filtros narrowband",
        "icon": "bi-stars",
        "category": "Mezcla de canales y color",
        "duration": "15–20 min",
        "description": (
            "Aprende a crear una imagen en falso color usando la paleta Hubble (SHO). "
            "Trabajarás con tres exposiciones de la Nebulosa del Águila tomadas con el "
            "Hubble Space Telescope a través de filtros de banda estrecha: "
            "[SII] 673 nm, Hα 656 nm y [OIII] 502 nm."
        ),
        "credit": "ESA/Hubble",
        "credit_url": "https://esahubble.org/projects/fits_liberator/",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "bundled": True,
        "dataset_folder": "eagle_nebula",
        "total_size_mb": 19,
        "files": [
            {"name": "673nmos.fits", "filter": "SII",  "wavelength": "673 nm", "type": "light"},
            {"name": "656nmos.fits", "filter": "Ha",   "wavelength": "656 nm", "type": "light"},
            {"name": "502nmos.fits", "filter": "OIII", "wavelength": "502 nm", "type": "light"},
        ],
        "project_meta": {
            "name": "Tutorial — M16 Eagle Nebula (SHO)",
            "object": "M16",
            "telescope": "Hubble Space Telescope (WFPC2)",
            "observer": "ESA/Hubble",
            "notes": "Dataset educativo CC BY 4.0 — ESA/Hubble FITS Liberator",
        },
        "steps": [
            {
                "tab": "tab-project",
                "title": "1. Tu proyecto",
                "body": (
                    "Se ha creado un proyecto con los datos del Hubble Space Telescope. "
                    "Observa los metadatos: objeto <b>M16</b>, telescopio <b>WFPC2</b>. "
                    "En tus propios proyectos, aquí configuras nombre, fecha, telescopio…"
                ),
                "action": None,
            },
            {
                "tab": "tab-images",
                "title": "2. Las imágenes",
                "body": (
                    "Se han cargado <b>3 imágenes FITS</b> de banda estrecha:<br>"
                    "• <b>[SII] 673 nm</b> — Azufre ionizado<br>"
                    "• <b>Hα 656 nm</b> — Hidrógeno alfa<br>"
                    "• <b>[OIII] 502 nm</b> — Oxígeno doblemente ionizado<br><br>"
                    "Cada filtro captura una línea de emisión diferente de la nebulosa. "
                    "Las tres imágenes ya están clasificadas como <i>lights</i>."
                ),
                "action": None,
            },
            {
                "tab": "tab-color",
                "title": "3. Paleta de color SHO",
                "body": (
                    "La <b>paleta SHO</b> (también llamada «Hubble Palette») asigna:<br>"
                    "• <b>Rojo</b> ← SII (azufre)<br>"
                    "• <b>Verde</b> ← Hα (hidrógeno)<br>"
                    "• <b>Azul</b> ← OIII (oxígeno)<br><br>"
                    "Haz clic en <b>«Composición de color»</b> para asignar los canales. "
                    "Selecciona la paleta <b>SHO</b> del desplegable y pulsa <b>Componer</b>."
                ),
                "action": "compose_sho",
            },
            {
                "tab": "tab-liveedit",
                "title": "4. Stretching y ajustes",
                "body": (
                    "La imagen compuesta aparecerá muy oscura porque los datos están en "
                    "rango lineal. Ve a la pestaña <b>Edición</b> y selecciona la imagen "
                    "compuesta como fuente.<br><br>"
                    "Ajusta el <b>Stretch</b> (prueba Asinh o Log) para revelar los detalles "
                    "de los Pilares de la Creación. Ajusta <b>brillo</b>, <b>contraste</b> "
                    "y <b>saturación</b> a tu gusto."
                ),
                "action": None,
            },
            {
                "tab": "tab-liveedit",
                "title": "5. Resultado final",
                "body": (
                    "¡Enhorabuena! Has creado tu primera imagen en falso color con la "
                    "misma técnica que usa el Hubble.<br><br>"
                    "Puedes exportar el resultado desde esta misma pestaña con el botón "
                    "<b>Exportar PNG</b>, o ir a la pestaña <b>Exportar</b> para más formatos."
                    "<br><br>"
                    "<small class='text-secondary'>Crédito: ESA/Hubble · CC BY 4.0</small>"
                ),
                "action": None,
            },
        ],
    },

    # ─────────────────────────────────────────────────────────────
    # Tutorial 2: Antennae Galaxies — Broadband + Hα
    # ─────────────────────────────────────────────────────────────
    "antennae": {
        "id": "antennae",
        "title": "Galaxias Antennae (NGC 4038/4039) — Color RGB+Hα",
        "subtitle": "Composición broadband con línea de emisión",
        "icon": "bi-hurricane",
        "category": "Mezcla de canales y color",
        "duration": "20–25 min",
        "description": (
            "Crea una imagen en color real de las Galaxias Antennae, una espectacular "
            "colisión galáctica. Combinarás exposiciones en azul, verde y rojo con una "
            "exposición adicional en Hα que resalta las regiones de formación estelar."
        ),
        "credit": "ESA/Hubble",
        "credit_url": "https://esahubble.org/projects/fits_liberator/",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "bundled": True,
        "dataset_folder": "antennae",
        "total_size_mb": 11,
        "files": [
            {"name": "blue.fits",     "filter": "B",  "wavelength": "450 nm", "type": "light"},
            {"name": "green.fits",    "filter": "V",  "wavelength": "555 nm", "type": "light"},
            {"name": "red.fits",      "filter": "R",  "wavelength": "658 nm", "type": "light"},
            {"name": "hydrogen.fits", "filter": "Ha", "wavelength": "656 nm", "type": "light"},
        ],
        "project_meta": {
            "name": "Tutorial — Antennae Galaxies (RGB+Hα)",
            "object": "NGC 4038/4039",
            "telescope": "Hubble Space Telescope (WFPC2)",
            "observer": "ESA/Hubble",
            "notes": "Dataset educativo CC BY 4.0 — ESA/Hubble FITS Liberator",
        },
        "steps": [
            {
                "tab": "tab-project",
                "title": "1. Proyecto de galaxias",
                "body": (
                    "Este proyecto contiene imágenes de las <b>Galaxias Antennae</b>, "
                    "dos galaxias en plena colisión a 45 millones de años luz. "
                    "La interacción gravitatoria genera enormes regiones de formación estelar."
                ),
                "action": None,
            },
            {
                "tab": "tab-images",
                "title": "2. Filtros broadband + Hα",
                "body": (
                    "Tenemos <b>4 imágenes</b>:<br>"
                    "• <b>Blue</b> — filtro B (450 nm, azul)<br>"
                    "• <b>Green</b> — filtro V (555 nm, verde)<br>"
                    "• <b>Red</b> — filtro R (658 nm, rojo)<br>"
                    "• <b>Hydrogen</b> — filtro Hα (656 nm, hidrógeno)<br><br>"
                    "Los tres primeros forman una composición RGB «natural». "
                    "El cuarto (Hα) resalta el gas de hidrógeno en las zonas de formación estelar."
                ),
                "action": None,
            },
            {
                "tab": "tab-color",
                "title": "3. Composición RGB",
                "body": (
                    "Primero crearemos una imagen RGB clásica:<br>"
                    "• <b>Rojo</b> ← red.fits<br>"
                    "• <b>Verde</b> ← green.fits<br>"
                    "• <b>Azul</b> ← blue.fits<br><br>"
                    "Selecciona la paleta <b>RGB</b> y asigna cada canal manualmente. "
                    "Pulsa <b>Componer</b>."
                ),
                "action": "compose_rgb",
            },
            {
                "tab": "tab-color",
                "title": "4. Incorporar Hα",
                "body": (
                    "Ahora vamos a mejorar la imagen añadiendo la señal de hidrógeno. "
                    "Puedes asignar <b>hydrogen.fits</b> al canal rojo junto con red.fits "
                    "(se mezclarán), o usar la opción de <b>Luminancia</b> para añadirlo "
                    "como detalle extra. Prueba distintas asignaciones.<br><br>"
                    "El Hα realzará las regiones rosadas de gas ionizado."
                ),
                "action": None,
            },
            {
                "tab": "tab-liveedit",
                "title": "5. Procesado visual",
                "body": (
                    "En la pestaña <b>Edición</b>, carga la imagen compuesta y ajusta:<br>"
                    "• <b>Stretch</b>: Asinh o Log para revelar brazos galácticos<br>"
                    "• <b>Saturación</b>: sube ligeramente para realzar los colores<br>"
                    "• <b>Sombras/Luces</b>: ajusta para equilibrar núcleos brillantes y colas tenues<br><br>"
                    "Experimenta hasta que estés satisfecho con el resultado."
                ),
                "action": None,
            },
            {
                "tab": "tab-export",
                "title": "6. Exportar",
                "body": (
                    "Exporta tu resultado final. Para publicación web, usa <b>PNG</b> o <b>JPG</b>. "
                    "Para seguir procesando en otro software, elige <b>TIFF 16-bit</b> o <b>FITS</b>."
                    "<br><br>"
                    "<small class='text-secondary'>Crédito: ESA/Hubble · CC BY 4.0</small>"
                ),
                "action": None,
            },
        ],
    },

    # ─────────────────────────────────────────────────────────────
    # Tutorial 3: M8+M20 — Pipeline completo (Siril tutorial data)
    # ─────────────────────────────────────────────────────────────
    "m8_m20_pipeline": {
        "id": "m8_m20_pipeline",
        "title": "Laguna y Trífida (M8+M20) — Pipeline completo",
        "subtitle": "Calibración, alineamiento, apilado y procesado",
        "icon": "bi-diagram-3",
        "category": "Pipeline completo",
        "duration": "40–60 min",
        "description": (
            "Tutorial avanzado que cubre el flujo de trabajo completo de astrofotografía: "
            "desde la calibración con darks, flats y bias hasta la imagen final en color. "
            "Usarás 60 imágenes: 15 lights, 15 darks, 15 flats y 15 bias de las "
            "nebulosas Laguna (M8) y Trífida (M20), tomadas con una cámara ZWO ASI 2600MC."
        ),
        "credit": "Colmic (astrosurf.com) / Tutorial oficial de Siril",
        "credit_url": "https://siril.org/tutorials/tuto-scripts/",
        "license": "Uso educativo — dataset del usuario",
        "license_url": "https://siril.org/tutorials/tuto-scripts/",
        "bundled": False,
        "dataset_folder": "m8_m20_pipeline",
        "download_instructions": (
            "Este dataset no está incluido en la imagen Docker. "
            "Descárgalo desde el repositorio oficial del tutorial de Siril:<br><br>"
            "<a href='http://www.astrosurf.com/colmic/Traitement_SiriL/brutes/' "
            "target='_blank' class='btn btn-sm btn-outline-accent'>"
            "<i class='bi bi-download me-1'></i>Descargar desde astrosurf.com</a><br><br>"
            "Descarga el archivo ZIP (~1.7 GB) y descomprímelo. "
            "Luego sube las imágenes en la pestaña <b>Imágenes</b>:<br>"
            "• Carpeta <code>lights/</code> → 15 frames light<br>"
            "• Carpeta <code>darks/</code> → 15 frames dark<br>"
            "• Carpeta <code>flats/</code> → 15 frames flat<br>"
            "• Carpeta <code>biases/</code> → 15 frames bias"
        ),
        "total_size_mb": 1700,
        "files": [],  # Not bundled — user provides their own
        "project_meta": {
            "name": "Tutorial — M8+M20 Pipeline completo",
            "object": "M8 / M20",
            "telescope": "FSQ-106ED (f/3.7)",
            "observer": "",
            "notes": "Dataset del tutorial oficial de Siril (Colmic, astrosurf.com)",
        },
        "steps": [
            {
                "tab": "tab-project",
                "title": "1. Proyecto de pipeline completo",
                "body": (
                    "Este tutorial cubre <b>todo el flujo de trabajo</b> de astrofotografía: "
                    "calibración → alineamiento → apilado → procesado → composición → exportación.<br><br>"
                    "Trabajarás con datos reales del tutorial oficial de "
                    "<a href='https://siril.org/tutorials/tuto-scripts/' target='_blank'>Siril</a>: "
                    "las nebulosas Laguna (M8) y Trífida (M20)."
                ),
                "action": None,
            },
            {
                "tab": "tab-images",
                "title": "2. Cargar imágenes",
                "body": (
                    "Sube los 60 frames desde las carpetas que descargaste:<br>"
                    "• <b>15 lights</b> — 180s, Gain 100 (las exposiciones del cielo)<br>"
                    "• <b>15 darks</b> — 180s, Gain 100 (ruido térmico)<br>"
                    "• <b>15 flats</b> — 3s, Gain 100 (viñeteo óptico)<br>"
                    "• <b>15 bias</b> — mínima exposición (ruido de lectura)<br><br>"
                    "El clasificador automático debería detectar el tipo de cada frame. "
                    "Verifica y corrige si es necesario."
                ),
                "action": "upload_frames",
            },
            {
                "tab": "tab-calibration",
                "title": "3. Crear Master Bias",
                "body": (
                    "El <b>master bias</b> captura el ruido de lectura del sensor.<br><br>"
                    "Pulsa <b>Crear Master Bias</b>. Se combinan los 15 bias frames usando "
                    "el método de la mediana, eliminando píxeles anómalos y dejando solo "
                    "el patrón de ruido de lectura fijo."
                ),
                "action": "create_master_bias",
            },
            {
                "tab": "tab-calibration",
                "title": "4. Crear Master Dark",
                "body": (
                    "El <b>master dark</b> captura el ruido térmico (corriente oscura).<br><br>"
                    "Pulsa <b>Crear Master Dark</b>. Se sustrae automáticamente el master bias "
                    "de cada dark antes de combinarlos. El resultado contiene solo la señal "
                    "térmica que se acumula durante la exposición de 180s."
                ),
                "action": "create_master_dark",
            },
            {
                "tab": "tab-calibration",
                "title": "5. Crear Master Flat",
                "body": (
                    "El <b>master flat</b> corrige el viñeteo y las motas de polvo en el sensor.<br><br>"
                    "Pulsa <b>Crear Master Flat</b>. Se sustrae el master bias de cada flat "
                    "y luego se normalizan y combinan. El resultado muestra la respuesta "
                    "no uniforme del sistema óptico."
                ),
                "action": "create_master_flat",
            },
            {
                "tab": "tab-calibration",
                "title": "6. Calibrar Lights",
                "body": (
                    "Ahora aplicamos las correcciones a los 15 lights:<br>"
                    "• Se <b>sustrae</b> el master dark (elimina ruido térmico)<br>"
                    "• Se <b>divide</b> por el master flat (corrige viñeteo)<br><br>"
                    "Pulsa <b>Calibrar Lights</b>. El resultado son 15 lightscalibrados, "
                    "limpios de artefactos instrumentales."
                ),
                "action": "calibrate_lights",
            },
            {
                "tab": "tab-alignment",
                "title": "7. Alinear frames",
                "body": (
                    "La montura no es perfecta: cada frame tiene un ligero desplazamiento y rotación. "
                    "El alineamiento detecta estrellas en cada frame y calcula la transformación "
                    "geométrica necesaria para superponerlos.<br><br>"
                    "Pulsa <b>Alinear</b> usando el método <b>Similaridad</b> y marca "
                    "«Usar calibrados»."
                ),
                "action": "align_frames",
            },
            {
                "tab": "tab-stacking",
                "title": "8. Apilar frames",
                "body": (
                    "El apilado combina los 15 frames alineados en una única imagen "
                    "con mucha más señal y menos ruido.<br><br>"
                    "Selecciona el método <b>Sigma-clip</b> (el más robusto, elimina "
                    "satélites y rayos cósmicos) y pulsa <b>Apilar</b>. "
                    "El resultado es una imagen por canal con ~4× más relación señal/ruido."
                ),
                "action": "stack_frames",
            },
            {
                "tab": "tab-processing",
                "title": "9. Recortar bordes",
                "body": (
                    "Al alinear y apilar, los bordes de la imagen quedan con datos incompletos. "
                    "Usa la herramienta de <b>Recorte</b> para eliminar las bandas negras "
                    "de los bordes. Esto es importante para que las estadísticas de los pasos "
                    "siguientes no se vean afectadas."
                ),
                "action": "crop_edges",
            },
            {
                "tab": "tab-processing",
                "title": "10. Stretching",
                "body": (
                    "Los datos astronómicos son <b>lineales</b>: la mayor parte de la información está "
                    "concentrada en valores muy bajos. El <i>stretching</i> revela los detalles.<br><br>"
                    "Prueba <b>Asinh</b> primero (preserva colores mejor), luego refina con "
                    "<b>Histogram Equalization</b> si es necesario. Ajusta el factor hasta que "
                    "veas nebulosa y fondo equilibrados."
                ),
                "action": "stretch_image",
            },
            {
                "tab": "tab-liveedit",
                "title": "11. Ajustes finales",
                "body": (
                    "En el editor visual, carga la imagen apilada y aplica los ajustes finales:<br>"
                    "• <b>Saturación</b>: +0.2–0.4 para resaltar colores de M8 y M20<br>"
                    "• <b>Sombras</b>: sube un poco para iluminar detalles tenues<br>"
                    "• <b>Sharpen</b>: un toque sutil para realzar detalles<br>"
                    "• <b>Denoise</b>: si hay ruido visible en el fondo<br><br>"
                    "¡Experimenta! No hay una única respuesta correcta."
                ),
                "action": None,
            },
            {
                "tab": "tab-export",
                "title": "12. Exportar resultado",
                "body": (
                    "<b>¡Felicidades!</b> Has completado todo el pipeline de astrofotografía, "
                    "desde datos en bruto hasta la imagen final.<br><br>"
                    "Exporta en el formato que prefieras. Para web, <b>PNG</b> o <b>JPG</b>. "
                    "Para más procesado, <b>TIFF 16-bit</b>.<br><br>"
                    "<small class='text-secondary'>Dataset: Tutorial oficial de "
                    "<a href='https://siril.org/tutorials/tuto-scripts/' target='_blank'>Siril</a> "
                    "por Colmic (astrosurf.com)</small>"
                ),
                "action": None,
            },
        ],
    },
}


def get_tutorial_list():
    """Return summary list of all tutorials."""
    return [
        {
            "id": t["id"],
            "title": t["title"],
            "subtitle": t["subtitle"],
            "icon": t["icon"],
            "category": t["category"],
            "duration": t["duration"],
            "description": t["description"],
            "bundled": t["bundled"],
            "total_size_mb": t["total_size_mb"],
            "credit": t["credit"],
            "license": t["license"],
            "num_steps": len(t["steps"]),
        }
        for t in TUTORIALS.values()
    ]


def get_tutorial(tutorial_id: str):
    """Return full tutorial definition or None."""
    return TUTORIALS.get(tutorial_id)
