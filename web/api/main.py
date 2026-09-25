from pathlib import Path

from fastapi import FastAPI

app = FastAPI(
    title="Scid Web API",
    version="0.1.0",
)

SCID_ROOT = Path("/opt/scid-web")
SCID_BINARY = SCID_ROOT / "scid"
DATA_DIR = SCID_ROOT / "data"


@app.get("/api/status")
def status():
    return {
        "name": "Scid Web API",
        "version": "0.1.0",
        "scid": "available" if SCID_BINARY.exists() else "missing",
    }


@app.get("/api/databases")
def databases():
    files = []

    if DATA_DIR.exists():
        for file in DATA_DIR.iterdir():
            files.append({
                "name": file.name,
                "type": "file" if file.is_file() else "directory",
            })

    return {
        "databases": files
    }
