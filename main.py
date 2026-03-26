#!/usr/bin/env python3
"""Oasis AstroTools - Astronomical observation planning platform."""

import argparse
import subprocess
import sys


def run_docker(rebuild=False, detach=False):
    """Run the application with Docker Compose."""
    cmd = ["docker", "compose", "up"]
    if rebuild:
        cmd.append("--build")
    if detach:
        cmd.append("-d")
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        print("Error: Docker is not installed or not in PATH.", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Docker error: {e}", file=sys.stderr)
        sys.exit(1)


def run_local(host: str, port: int, reload_flag: bool):
    """Run the application locally with uvicorn."""
    import uvicorn

    uvicorn.run(
        "app:create_app",
        factory=True,
        host=host,
        port=port,
        reload=reload_flag,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Oasis AstroTools - Astronomical observation planning platform"
    )
    parser.add_argument(
        "--docker", action="store_true", help="Run with Docker Compose"
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Force rebuild Docker image (implies --docker)",
    )
    parser.add_argument(
        "--detach", "-d", action="store_true", help="Run Docker in detached mode"
    )
    parser.add_argument(
        "--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to bind (default: 8000)"
    )
    parser.add_argument(
        "--reload", action="store_true", help="Enable auto-reload for development"
    )

    args = parser.parse_args()

    if args.docker or args.rebuild:
        run_docker(rebuild=args.rebuild, detach=args.detach)
    else:
        run_local(args.host, args.port, args.reload)


if __name__ == "__main__":
    main()
