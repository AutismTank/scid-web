# SCID WebUI

A modern web interface for SCID vs PC, bringing chess database browsing,
game viewing, opening exploration, and Stockfish analysis to the browser.

> **Status:** Active development.

## Features

- Browse SCID chess databases
- Browse and view games
- Interactive chessboard
- Move navigation
- Opening tree exploration
- Stockfish analysis
- Evaluation, best move, and principal variation
- FastAPI REST API
- Docker deployment
- Responsive web interface
- IP-based Stockfish rate limiting

## Architecture

Browser
  |
  v
Cloudflare / Reverse Proxy
  |
  v
FastAPI
  |
  +-- SCID / tcscid
  |
  +-- Stockfish
  |
  v
SCID databases

The backend is written in Python using FastAPI.

The frontend uses HTML, CSS, and JavaScript with chess.js for chess
position handling.

## Project Structure

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

The data directory contains local chess databases and is excluded from Git.

## Running with Docker

Requirements:

- Docker
- Docker Compose
- A SCID-compatible chess database

Build the container:

    docker compose build

Start the application:

    docker compose up -d

Check the container:

    docker ps

View logs:

    docker logs scid-web

The application listens on port 8095 inside the container.

A reverse proxy such as Cloudflare Tunnel or Nginx can be used to expose
the application publicly.

## Database Files

Place SCID databases in:

    data/

The Docker Compose configuration mounts this directory into the container.

Large database files should not be committed to Git.

## Stockfish

SCID WebUI uses Stockfish for chess analysis.

Analysis currently provides:

- Position evaluation
- Best move
- Principal variation
- Analysis of positions within games

The Stockfish endpoint includes per-IP rate limiting to prevent excessive
engine usage.

## Opening Tree

The opening tree allows users to explore how positions occur throughout
a database.

It can be used to examine common moves, move frequencies, database
statistics, and opening development.

## API

Important endpoints include:

    /api/databases
    /api/databases/{database}/games/{game_number}
    /api/databases/{database}/opening-tree
    /api/databases/{database}/games/{game_number}/analyse

FastAPI documentation:

    /docs

ReDoc:

    /redoc

## Roadmap

- [ ] Improved mobile layout
- [ ] Better responsive chessboard controls
- [ ] Improved game navigation
- [ ] More advanced opening-tree presentation
- [ ] More Stockfish controls
- [ ] Engine depth/time controls
- [ ] Better database search
- [ ] Game filtering and sorting
- [ ] Player and event views
- [ ] Accessibility improvements
- [ ] Additional SCID functionality

## SCID vs PC

SCID WebUI is built around the SCID vs PC chess database ecosystem.

Upstream project:

https://github.com/benini/scid

See the upstream project for source code, documentation, and licensing
information.

## Contributing

Bug reports, feature requests, documentation improvements, and code
contributions are welcome.

## License

This repository contains substantial source code originating from SCID vs PC.

Please consult the applicable upstream license files before redistributing
the project.

---

SCID WebUI — bringing SCID chess databases to the web.
