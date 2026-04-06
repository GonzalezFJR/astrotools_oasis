# Oasis AstroTools

Plataforma web de herramientas de planificación de observaciones astronómicas y edición de astrofotografía para el proyecto **Oasis**. Diseñada para introducir a adolescentes en el mundo de la astronomía observacional con telescopios robóticos.

## Herramientas

- **Calculadora SNR / Tiempo de Exposición** — Calcula la relación señal-ruido esperada o el tiempo de exposición necesario para alcanzar un SNR objetivo.
- **Calculadora de Campo de Visión (FOV)** — Visualiza el campo de visión de tu telescopio y cámara sobre imágenes reales del cielo.
- **AstroEditor** — Plataforma de edición de astrofotografía con pipeline completo: carga de imágenes FITS/RAW/TIFF, calibración (bias, dark, flat), alineamiento por estrellas, apilado (media, mediana, sigma-clip…), stretching, composición de color (RGB, SHO, HOO, LRGB…), editor visual en vivo con ajustes de brillo/contraste/saturación/enfoque/ruido, y exportación a FITS/TIFF/PNG/JPG.

## Requisitos

- Python 3.11+
- Docker (recomendado para despliegue)

## Inicio rápido

### Ejecución local (desarrollo)

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py --reload
```

La aplicación estará disponible en `http://localhost:8000`.

### Ejecución con Docker

```bash
python main.py --docker
```

Para forzar la reconstrucción de la imagen:

```bash
python main.py --rebuild
```

En modo desacoplado:

```bash
python main.py --docker --detach
```

## Despliegue con Docker (instrucciones técnicas)

### Requisitos del sistema

| Recurso | Mínimo (imágenes ≤ 8 MP) | Recomendado (imágenes > 16 MP) |
|---|---|---|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8–16 GB |
| Disco | 2 GB para la imagen + espacio para proyectos | 10 GB+ |

> **Nota**: las operaciones de apilado y alineamiento cargan todos los frames en memoria simultáneamente. Con 30 frames de 24 MP se necesitan ~12 GB de RAM solo para apilar. La edición visual en vivo (pestaña "Edición") se ejecuta íntegramente en el navegador y no consume recursos del servidor.

### Construir y ejecutar manualmente

```bash
# Construir la imagen
docker build -t oasis-astrotools .

# Ejecutar
docker run -d \
  --name astrotools \
  -p 8000:8000 \
  -v astrotools_projects:/tmp/astroeditor_projects \
  --restart unless-stopped \
  oasis-astrotools
```

### docker-compose (recomendado)

```bash
docker compose up -d
```

Para persistir los proyectos del editor entre reinicios, añade un volumen con nombre:

```yaml
services:
  web:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - astrotools_projects:/tmp/astroeditor_projects
    restart: unless-stopped

volumes:
  astrotools_projects:
```

### Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `APP_PORT` | `8000` | Puerto expuesto en el host |

### Actualización

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

### Notas para distribución a usuarios finales

Para que un usuario pueda ejecutar la herramienta en su PC (Windows / macOS / Linux):

1. Instalar [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Seguir las instrucciones del archivo **[INSTALL.md](INSTALL.md)**

## Estructura del proyecto

```
astrotools/
├── main.py                  # Punto de entrada
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── INSTALL.md               # Guía de instalación para usuarios
├── app/
│   ├── __init__.py          # Factory de la aplicación FastAPI
│   ├── config.py            # Configuración desde .env
│   ├── routes/              # Rutas y endpoints API
│   │   ├── home.py
│   │   ├── snr.py
│   │   ├── fov.py
│   │   └── editor.py       # API del AstroEditor
│   ├── tools/               # Lógica de cálculo
│   │   ├── snr_calculator.py
│   │   ├── fov_calculator.py
│   │   ├── editor_project.py      # Gestión de proyectos
│   │   ├── editor_calibration.py  # Calibración
│   │   ├── editor_alignment.py    # Alineamiento
│   │   ├── editor_stacking.py     # Apilado
│   │   ├── editor_processing.py   # Procesado (server-side)
│   │   └── editor_color.py        # Composición de color / exportación
│   ├── data/                # Datos de catálogos y filtros
│   │   ├── catalogs.py
│   │   ├── filters.py
│   │   ├── tutorials.py          # Definición de tutoriales guiados
│   │   └── tutorial_datasets/    # Datasets FITS empaquetados (~41 MB)
│   │       ├── eagle_nebula/     # M16 — 3 FITS narrowband (SHO)
│   │       └── antennae/         # NGC 4038/4039 — 4 FITS (BGRH)
│   ├── templates/           # Plantillas Jinja2
│   └── static/              # CSS, JavaScript
│       ├── css/
│       └── js/
│           ├── editor.js           # Lógica principal del editor
│           └── editor_imageproc.js # Motor de procesado en Canvas (client-side)
```

## Arquitectura del procesado

```
  SERVIDOR (Python)                    NAVEGADOR (Canvas)
  ─────────────────                    ──────────────────
  • Lectura FITS / RAW / TIFF         • Stretch en tiempo real
  • Calibración (master frames)       • Brillo / Contraste / Exposición
  • Detección de estrellas             • Gamma / Saturación
  • Alineamiento geométrico           • Sombras / Luces
  • Apilado (sigma-clip, mediana…)    • Enfoque (sharpen)
  • Composición de color              • Reducción de ruido
  • Exportación a FITS/TIFF           • Rotación / Volteo
                                       • Histograma en vivo
                                       • Exportación a PNG / JPG
```

## Tutoriales guiados

El AstroEditor incluye 3 tutoriales paso a paso con datos reales:

| Tutorial | Objeto | Dificultad | Datos incluidos | Crédito |
|----------|--------|------------|-----------------|---------|
| Paleta SHO | Nebulosa del Águila (M16) | Principiante | Sí (19 MB) | ESA/Hubble · CC BY 4.0 |
| RGB + Hα | Galaxias Antennae (NGC 4038/4039) | Intermedio | Sí (11 MB) | ESA/Hubble · CC BY 4.0 |
| Pipeline completo | Laguna + Trífida (M8/M20) | Avanzado | No (externo) | Colmic / Siril |

### Créditos de los datasets

- **Nebulosa del Águila (M16)** y **Galaxias Antennae (NGC 4038/4039)**: Datos del programa [FITS Liberator](https://esahubble.org/projects/fits_liberator/) de ESA/Hubble. Licencia [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Crédito: **ESA/Hubble**.
- **M8+M20 (Laguna y Trífida)**: Dataset del [tutorial oficial de Siril](https://siril.org/tutorials/tuto-scripts/) por Colmic ([astrosurf.com](http://www.astrosurf.com/colmic/Traitement_SiriL/brutes/)). Este dataset **no se distribuye** con la aplicación; el usuario debe descargarlo del enlace oficial.

## Licencia

Proyecto Oasis — Uso educativo.
