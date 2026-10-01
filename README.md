# SCID WebUI

A modern web interface for SCID vs PC, bringing chess database browsing, game viewing, opening exploration, and Stockfish analysis to the browser.

> **Status:** Active development.

## Features

* Browse SCID chess databases
* Browse and view games
* Interactive chessboard
* Move navigation
* Opening tree exploration
* Stockfish analysis
* Evaluation, best move, and principal variation
* FastAPI REST API
* Docker deployment
* Responsive web interface
* IP-based Stockfish rate limiting

## Quick Start

The easiest way to run SCID WebUI is with Docker.

### Requirements

You need:

* Linux server or another Docker-compatible system
* Docker
* Docker Compose
* A SCID-compatible chess database

Stockfish and the required SCID/Tcl components are installed as part of the Docker image.

### 1. Clone the repository

```bash
git clone https://github.com/AutismTank/scid-web.git
cd scid-web
```

The main development branch is currently `web-ui`:

```bash
git checkout web-ui
```

### 2. Add your chess database

Create the database directory:

```bash
mkdir -p data
```

Place your SCID database files inside `data/`.

For example:

```text
data/
└── MyDatabase.sg4
```

SCID databases normally consist of several files sharing the same database name, so copy all required files belonging to the database.

The `data/` directory is excluded from Git because chess databases can be very large.

### 3. Build the Docker image

```bash
docker compose build
```

This builds the SCID WebUI container and installs the required dependencies, including Stockfish.

### 4. Start SCID WebUI

```bash
docker compose up -d
```

Check that the container is running:

```bash
docker ps
```

You should see a container named:

```text
scid-web
```

### 5. Check the logs

If everything started correctly:

```bash
docker logs scid-web
```

The FastAPI server listens on port `8095` inside the container.

## Accessing the WebUI

The default Docker configuration does not publish port `8095` directly to the host. This is intentional: SCID WebUI is designed to be placed behind a reverse proxy.

You can expose it using:

* Cloudflare Tunnel
* Nginx
* Caddy
* Another reverse proxy

For example:

```text
Internet
   |
   v
Cloudflare
   |
   v
Reverse Proxy
   |
   v
scid-web:8095
```

If you want to expose port `8095` directly for local testing, temporarily change the Docker Compose configuration to publish it:

```yaml
ports:
  - "8095:8095"
```

Then restart:

```bash
docker compose down
docker compose up -d
```

The WebUI will then be available at:

```text
http://SERVER-IP:8095
```

For a public installation, a reverse proxy is recommended instead of exposing the application directly.

## Database Files

SCID WebUI reads databases from:

```text
data/
```

The Docker Compose configuration mounts this directory into the container:

```yaml
volumes:
  - ./data:/opt/scid-web/data
```

Keep all files belonging to a SCID database together.

For example:

```text
data/
├── MyDatabase.sg3
├── MyDatabase.sg4
├── MyDatabase.sg5
└── MyDatabase.si4
```

The exact files depend on the SCID database version.

Large databases should not be committed to Git.

## Stockfish

SCID WebUI includes Stockfish support.

The Docker image installs Stockfish automatically, so no separate Stockfish installation is required when using Docker.

Analysis provides:

* Position evaluation
* Best move
* Principal variation
* Analysis of positions within games

The analysis endpoint is rate-limited per IP to prevent excessive engine usage.

## Opening Tree

The opening tree allows users to explore how positions occur throughout a database.

It can be used to examine:

* Common moves
* Move frequencies
* Database statistics
* Opening development

## API

Important endpoints include:

```text
/api/databases
/api/databases/{database}/games/{game_number}
/api/databases/{database}/opening-tree
/api/databases/{database}/games/{game_number}/analyse
```

When the application is running, FastAPI's interactive documentation is available at:

```text
/docs
```

ReDoc is available at:

```text
/redoc
```

## Development

Clone the repository:

```bash
git clone https://github.com/AutismTank/scid-web.git
cd scid-web
```

Install the Python dependencies:

```bash
pip install fastapi uvicorn
```

The application can then be started with:

```bash
uvicorn web.api.main:app --host 0.0.0.0 --port 8095
```

For development, Docker is generally the easier way to ensure the required SCID/Tcl and Stockfish dependencies are available.

## Project Structure

```text
scid-web/
├── web/
│   ├── api/
│   │   └── main.py
│   └── static/
│       ├── app.js
│       ├── index.html
│       ├── style.css
│       ├── openings.js
│       ├── openings.html
│       ├── openings.css
│       └── vendor/
│           └── chess.js
├── data/
├── Dockerfile
├── compose.yml
├── Makefile
└── README.md
```

## Security

SCID WebUI is intended to run behind a properly configured reverse proxy.

The Stockfish analysis endpoint includes per-IP rate limiting.

When deployed behind Cloudflare, the application can use the `CF-Connecting-IP` header when the request originates from the configured trusted proxy.

The trusted proxy can be configured using:

```text
TRUSTED_PROXY_IP
```

Do not expose the application directly to the public internet without considering authentication, rate limiting, and network configuration.

## Roadmap

* [ ] Improved mobile layout
* [ ] Better responsive chessboard controls
* [ ] Improved game navigation
* [ ] More advanced opening-tree presentation
* [ ] More Stockfish controls
* [ ] Engine depth/time controls
* [ ] Better database search
* [ ] Game filtering and sorting
* [ ] Player and event views
* [ ] Accessibility improvements
* [ ] Additional SCID functionality

## SCID vs PC

SCID WebUI is built around the SCID vs PC chess database ecosystem.

Upstream project:

https://github.com/benini/scid

See the upstream project for source code, documentation, and licensing information.

## Contributing

Bug reports, feature requests, documentation improvements, and code contributions are welcome.

For larger changes, opening an issue before implementing the change is recommended.

## License

This repository contains substantial source code originating from SCID vs PC.

Please consult the applicable upstream license files before redistributing the project.

Additional licensing information for SCID WebUI will be documented as the project develops.

---

**SCID WebUI** — bringing SCID chess databases to the web.
