# Guía de instalación — Oasis AstroTools

Esta guía te permite instalar y ejecutar **Oasis AstroTools** en tu ordenador personal usando **Docker Desktop**. No necesitas experiencia en programación.

---

## 1. Instalar Docker Desktop

Docker Desktop es un programa gratuito que permite ejecutar aplicaciones empaquetadas (contenedores) en cualquier sistema operativo.

### Windows

1. Ve a [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Haz clic en **Download for Windows**
3. Ejecuta el instalador (`Docker Desktop Installer.exe`)
4. Sigue el asistente de instalación
   - Si te pregunta por **WSL 2**, acepta e instálalo — es necesario
   - Si te pide reiniciar el PC, hazlo
5. Abre **Docker Desktop** desde el menú de inicio
6. Espera a que el icono de la ballena en la barra de tareas se quede fijo (puede tardar un minuto la primera vez)

> **Requisitos de Windows**: Windows 10 (versión 2004 o superior) o Windows 11, 64 bits, con virtualización habilitada en la BIOS.

### macOS

1. Ve a [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Descarga la versión para **Mac con chip Apple** o **Mac con Intel** según tu equipo
3. Abre el `.dmg` y arrastra Docker a la carpeta Aplicaciones
4. Ábrelo desde Aplicaciones y concede los permisos que solicite

### Linux

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Cierra sesión y vuelve a abrirla para aplicar el cambio de grupo
```

---

## 2. Descargar Oasis AstroTools

Descarga el programa de una de estas formas:

### Opción A: Descargar como ZIP

1. Descarga el archivo ZIP del programa (te lo proporcionará tu profesor o supervisor)
2. Descomprime el ZIP en una carpeta, por ejemplo: `C:\Users\TuUsuario\AstroTools`

### Opción B: Usando Git (avanzado)

```bash
git clone <URL_DEL_REPOSITORIO> AstroTools
cd AstroTools
```

---

## 3. Ejecutar la aplicación

### En Windows

1. Asegúrate de que **Docker Desktop** está abierto y funcionando (icono de la ballena fijo en la barra de tareas)
2. Abre una **terminal** (PowerShell o Símbolo del sistema):
   - Pulsa `Windows + R`, escribe `powershell`, pulsa Enter
3. Navega a la carpeta del programa:
   ```powershell
   cd C:\Users\TuUsuario\AstroTools
   ```
4. Ejecuta el comando:
   ```powershell
   docker compose up -d
   ```
5. La primera vez tardará unos minutos en descargar e instalar todo automáticamente
6. Cuando termine, abre tu navegador web y escribe:
   ```
   http://localhost:8000
   ```

### En macOS / Linux

1. Asegúrate de que Docker Desktop (o el servicio Docker) está activo
2. Abre un terminal y navega a la carpeta del programa:
   ```bash
   cd ~/AstroTools
   ```
3. Ejecuta:
   ```bash
   docker compose up -d
   ```
4. Abre en el navegador: [http://localhost:8000](http://localhost:8000)

---

## 4. Uso diario

| Acción | Comando |
|---|---|
| **Iniciar** la aplicación | `docker compose up -d` |
| **Parar** la aplicación | `docker compose down` |
| **Ver si está funcionando** | `docker compose ps` |
| **Ver los logs** (si algo falla) | `docker compose logs` |

> **Nota**: los proyectos del editor se guardan dentro del contenedor. Si quieres que persistan entre actualizaciones, asegúrate de usar la configuración con volumen (tu instructor te indicará cómo).

---

## 5. Actualizar a una nueva versión

1. Descarga o actualiza los archivos del programa (nuevo ZIP o `git pull`)
2. Ejecuta:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

---

## 6. Desinstalar

1. Para la aplicación:
   ```bash
   docker compose down
   ```
2. Elimina la imagen de Docker:
   ```bash
   docker rmi astrotools-web
   ```
3. (Opcional) Desinstala Docker Desktop desde el panel de control de Windows o la carpeta de Aplicaciones en macOS

---

## Solución de problemas

| Problema | Solución |
|---|---|
| "Docker Desktop is not running" | Abre Docker Desktop y espera a que se inicie |
| "port 8000 already in use" | Cambia el puerto: edita `docker-compose.yml` y cambia `"8000:8000"` por `"9000:8000"`, luego abre `http://localhost:9000` |
| La página tarda en cargar | La primera vez puede tardar. Refresca con `Ctrl + F5` |
| "WSL 2 installation is incomplete" (Windows) | Sigue las instrucciones de Microsoft para instalar WSL 2: [https://aka.ms/wsl2install](https://aka.ms/wsl2install) |
| Error de virtualización | Entra en la BIOS de tu PC y activa Intel VT-x o AMD-V |

---

## Requisitos mínimos del PC

- **Sistema operativo**: Windows 10/11 (64 bits), macOS 12+, o Linux
- **RAM**: 4 GB mínimo (8 GB recomendado para imágenes grandes)
- **Disco**: 3 GB libres para la instalación + espacio para tus imágenes
- **Navegador**: Chrome, Firefox, Edge, o Safari actualizado
