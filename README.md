# Oasis AstroTools

Plataforma web de herramientas de planificación de observaciones astronómicas para el proyecto **Oasis**. Diseñada para introducir a adolescentes en el mundo de la astronomía observacional con telescopios robóticos.

## Herramientas

- **Calculadora SNR / Tiempo de Exposición** — Calcula la relación señal-ruido esperada o el tiempo de exposición necesario para alcanzar un SNR objetivo.
- **Calculadora de Campo de Visión (FOV)** — Visualiza el campo de visión de tu telescopio y cámara sobre imágenes reales del cielo.

## Requisitos

- Python 3.11+
- Docker (opcional)

## Inicio rápido

### Ejecución local

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

## Estructura del proyecto

```
astrotools/
├── main.py                  # Punto de entrada
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env / .env.example
├── app/
│   ├── __init__.py          # Factory de la aplicación FastAPI
│   ├── config.py            # Configuración desde .env
│   ├── routes/              # Rutas y endpoints API
│   │   ├── home.py
│   │   ├── snr.py
│   │   └── fov.py
│   ├── tools/               # Lógica de cálculo
│   │   ├── snr_calculator.py
│   │   └── fov_calculator.py
│   ├── data/                # Datos de catálogos y filtros
│   │   ├── catalogs.py
│   │   └── filters.py
│   ├── templates/           # Plantillas Jinja2
│   └── static/              # CSS, JavaScript
```

## Licencia

Proyecto Oasis — Uso educativo.
