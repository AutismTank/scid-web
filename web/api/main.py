from pathlib import Path
from collections import defaultdict, deque
import os
import re
import subprocess
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


app = FastAPI(
    title="Scid Web API",
    version="0.6.1",
)


SCID_ROOT = Path("/opt/scid-web")
TCSCID = SCID_ROOT / "tcscid"

STOCKFISH = "/usr/games/stockfish"

STOCKFISH_THREADS = 2
STOCKFISH_HASH_MB = 128
STOCKFISH_MOVETIME_MS = 3000
stockfish_lock = threading.Lock()


# Stockfish rate limiting.
#
# Cloudflare/cloudflared connects to this container, so FastAPI normally
# sees the cloudflared container IP instead of the real visitor IP.
# We only trust CF-Connecting-IP when the immediate peer is our
# cloudflared container.
STOCKFISH_RATE_LIMIT = 10
STOCKFISH_RATE_WINDOW = 60.0
TRUSTED_PROXY_IP = os.environ.get(
    "TRUSTED_PROXY_IP",
    "172.20.0.4",
)

stockfish_rate_lock = threading.Lock()
stockfish_requests = defaultdict(deque)


def get_client_ip(request: Request) -> str:
    """Return the real visitor IP when the request comes through Cloudflare."""

    direct_ip = (
        request.client.host
        if request.client
        else ""
    )

    if direct_ip == TRUSTED_PROXY_IP:
        cloudflare_ip = request.headers.get(
            "CF-Connecting-IP"
        )

        if cloudflare_ip:
            return cloudflare_ip.strip()

    return direct_ip or "unknown"


def check_stockfish_rate_limit(ip: str) -> tuple[bool, int]:
    """Allow at most STOCKFISH_RATE_LIMIT analyses per IP per window."""

    now = time.monotonic()

    with stockfish_rate_lock:

        requests = stockfish_requests[ip]

        while requests and (
            now - requests[0]
        ) >= STOCKFISH_RATE_WINDOW:
            requests.popleft()

        if len(requests) >= STOCKFISH_RATE_LIMIT:

            retry_after = int(
                STOCKFISH_RATE_WINDOW
                - (now - requests[0])
            ) + 1

            return False, retry_after

        requests.append(now)

        return True, 0

DATA_DIR = SCID_ROOT / "data"
WEB_DIR = SCID_ROOT / "web"
STATIC_DIR = WEB_DIR / "static"


class ScidSession:
    """
    Keep one tcscid process alive and reuse it.

    This is important for very large databases such as
    LumbrasGigaBase.

    The session keeps track of the database that Scid actually has open
    and the filter currently active inside Scid.
    """

    def __init__(self):
        self.process = None
        self.lock = threading.RLock()

        self.current_database = None
        self.current_filter = None

        self.counter = 0
        self.game_counts = {}

    def start(self):
        if self.process is not None:
            if self.process.poll() is None:
                return

        environment = os.environ.copy()

        environment["PATH"] = (
            f"{SCID_ROOT}:{environment.get('PATH', '')}"
        )

        self.process = subprocess.Popen(
            [str(TCSCID)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=str(SCID_ROOT),
            env=environment,
        )

        self.current_database = None
        self.current_filter = None

    def stop(self):
        process = self.process

        if process is None:
            return

        try:
            if process.poll() is None:

                try:
                    process.stdin.write("exit\n")
                    process.stdin.flush()
                except Exception:
                    pass

                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

        except Exception:

            try:
                process.kill()
            except Exception:
                pass

        self.process = None
        self.current_database = None
        self.current_filter = None

    def restart(self):
        self.stop()
        self.start()

    def command(self, command: str) -> str:
        with self.lock:

            self.start()

            self.counter += 1

            marker = (
                f"__SCID_SESSION_{self.counter}__"
            )

            script = (
                f"puts [{command}]\n"
                f'puts "{marker}"\n'
                "flush stdout\n"
            )

            try:

                self.process.stdin.write(script)
                self.process.stdin.flush()

                output_lines = []

                while True:

                    line = self.process.stdout.readline()

                    if line == "":
                        raise RuntimeError(
                            "tcscid process terminated unexpectedly"
                        )

                    line = line.rstrip("\r\n")

                    if line == marker:
                        break

                    output_lines.append(line)

            except Exception:

                self.current_database = None
                self.current_filter = None

                self.restart()

                raise

            cleaned = []

            for line in output_lines:

                line = line.strip()

                if not line:
                    continue

                if line == "%":
                    continue

                line = re.sub(
                    r"^%\s*",
                    "",
                    line,
                )

                cleaned.append(line)

            return "\n".join(cleaned).strip()

    def close_database(self):
        with self.lock:

            if self.process is None:
                self.current_database = None
                self.current_filter = None
                return

            try:
                self.command("sc_base close")
            except Exception:
                pass

            self.current_database = None
            self.current_filter = None

    def open_database(self, database: str):
        database = str(
            Path(database).resolve()
        )

        with self.lock:

            self.start()

            # Check whether Scid still has the requested
            # database open.
            if self.current_database == database:

                actual = self.command(
                    "sc_base filename"
                ).strip()

                if actual == database:
                    return

                self.current_database = None
                self.current_filter = None

            # Close a different database.
            if self.current_database is not None:

                try:
                    self.command("sc_base close")
                except Exception:
                    pass

                self.current_database = None
                self.current_filter = None

            try:

                result = self.command(
                    f"sc_base open {{{database}}}"
                )

                if result.strip() != "1":
                    raise RuntimeError(
                        f"Could not open database: {database}"
                    )

                actual_filename = self.command(
                    "sc_base filename"
                ).strip()

                if actual_filename != database:

                    self.current_database = None
                    self.current_filter = None

                    raise RuntimeError(
                        "Scid opened the wrong database. "
                        f"Requested: {database}; "
                        f"actual: {actual_filename}"
                    )

                self.current_database = database
                self.current_filter = None

            except Exception:

                self.current_database = None
                self.current_filter = None

                raise

    def game_count(self, database: str) -> int:
        database = str(
            Path(database).resolve()
        )

        self.open_database(database)

        if database in self.game_counts:
            return self.game_counts[database]

        count = int(
            self.command("sc_base numGames")
        )

        self.game_counts[database] = count

        return count

    def apply_search(
        self,
        *,
        white=None,
        black=None,
        event=None,
        site=None,
        year=None,
        result=None,
        eco=None,
        search=None,
    ):
        """
        Apply Scid's native header search and optional
        general text search.

        Header filters are applied first.

        If a general text search is supplied, Scid's
        native `sc_filter textfind` is then used against
        the resulting filter.

        `text_matches` contains FILTER POSITIONS in the
        original Scid filter.

        Example:

            text_matches = [9, 12, 20]

        means:

            search result 1 -> filtered position 9
            search result 2 -> filtered position 12
            search result 3 -> filtered position 20
        """

        parts = [
            "sc_search header"
        ]

        # White player
        if white:
            parts.append(
                f"-white {tcl_quote(white)}"
            )

        # Black player
        if black:
            parts.append(
                f"-black {tcl_quote(black)}"
            )

        # Event
        if event:
            parts.append(
                f"-event {tcl_quote(event)}"
            )

        # Site
        if site:
            parts.append(
                f"-site {tcl_quote(site)}"
            )

        # Year
        if year:

            try:

                year_int = int(year)

                if year_int < 1 or year_int > 9999:
                    raise ValueError

            except ValueError:

                raise HTTPException(
                    status_code=400,
                    detail="year must be a valid year",
                )

            parts.append(
                f"-date {{{year_int:04d}.01.01 "
                f"{year_int:04d}.12.31}}"
            )

        # Result
        if result:

            result_map = {
                "1-0": "1 0 0 0",
                "0-1": "0 0 1 0",
                "1/2-1/2": "0 1 0 0",
                "*": "0 0 0 1",
            }

            if result not in result_map:

                raise HTTPException(
                    status_code=400,
                    detail=(
                        "result must be one of: "
                        "1-0, 0-1, 1/2-1/2, *"
                    ),
                )

            parts.append(
                f"-results {{{result_map[result]}}}"
            )

        # ECO
        if eco:

            eco_value = eco.strip().upper()

            if not re.fullmatch(
                r"[A-E][0-9]{2}[A-Z]?",
                eco_value,
            ):

                raise HTTPException(
                    status_code=400,
                    detail=(
                        "eco must be a valid ECO code "
                        "such as C50"
                    ),
                )

            parts.append(
                f"-eco {{{eco_value} {eco_value} true}}"
            )

        # Always start a fresh Scid filter.
        parts.append("-filter reset")

        command = " ".join(parts)

        self.command(command)

        self.current_filter = {
            "white": white,
            "black": black,
            "event": event,
            "site": site,
            "year": year,
            "result": result,
            "eco": eco,
            "search": search,
        }

        # ---------------------------------------------------------
        # General text search
        # ---------------------------------------------------------
        #
        # Native Scid textfind searches:
        #
        #   White
        #   Black
        #   Event
        #   Site
        #   Date
        #
        # It returns a FILTER POSITION.
        #
        # We collect those positions without changing the
        # underlying Scid filter.
        #

        if search and search.strip():

            search = search.strip()

            matches = []

            position = 0

            while True:

                found = int(
                    self.command(
                        f"sc_filter textfind 0 "
                        f"{position} "
                        f"{tcl_quote(search)}"
                    )
                )

                if found == 0:
                    break

                matches.append(found)

                # Start the next search from this match.
                position = found

            self.current_filter = {
                **self.current_filter,
                "text_matches": matches,
            }

            # IMPORTANT:
            #
            # The final result count is the number of
            # text matches, NOT the size of the original
            # Scid filter.
            return len(matches)

        # No general text search.
        #
        # The native Scid filter is the final result set.
        return int(
            self.command("sc_filter count")
        )

    def filtered_game_number(
        self,
        position: int,
    ) -> int:
        """
        Convert a 1-based filtered position into the
        actual database game number.
        """

        return int(
            self.command(
                f"sc_filter index {position}"
            )
        )


scid_session = ScidSession()


def tcl_quote(value: str) -> str:
    """
    Safely quote a string for use as a Tcl argument.
    """

    value = str(value)

    if "}" in value or "{" in value:

        value = (
            value
            .replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("$", "\\$")
            .replace("[", "\\[")
            .replace("]", "\\]")
            .replace("\n", " ")
            .replace("\r", " ")
        )

        return f'"{value}"'

    return f"{{{value}}}"


def scid_command(command: str) -> str:
    return scid_session.command(command)


def analyse_fen(fen: str) -> dict:
    """
    Analyse a FEN position with Stockfish.

    Evaluation is always returned from White's perspective.
    """

    with stockfish_lock:

        process = subprocess.Popen(
            [STOCKFISH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        try:
            commands = [
                "uci",
                f"setoption name Threads value {STOCKFISH_THREADS}",
                f"setoption name Hash value {STOCKFISH_HASH_MB}",
                "isready",
                f"position fen {fen}",
                f"go movetime {STOCKFISH_MOVETIME_MS}",
            ]

            process.stdin.write(
                "\n".join(commands) + "\n"
            )
            process.stdin.flush()

            best_move = None
            evaluation = None
            mate = None
            pv = []

            side_to_move = fen.split()[1]

            while True:

                line = process.stdout.readline()

                if not line:
                    break

                line = line.strip()

                if line.startswith("info ") and "score " in line:

                    score_match = re.search(
                        r"score (cp|mate) (-?\d+)",
                        line,
                    )

                    if score_match:

                        score_type = score_match.group(1)
                        score_value = int(
                            score_match.group(2)
                        )

                        if score_type == "cp":

                            evaluation = score_value / 100

                            if side_to_move == "b":
                                evaluation = -evaluation

                            mate = None

                        else:

                            mate = score_value

                            if side_to_move == "b":
                                mate = -mate

                            evaluation = None

                    pv_match = re.search(
                        r"\bpv\s+(.+)$",
                        line,
                    )

                    if pv_match:

                        candidate_pv = (
                            pv_match.group(1).split()
                        )

                        if len(candidate_pv) >= len(pv):
                            pv = candidate_pv

                elif line.startswith("bestmove "):

                    parts = line.split()

                    if len(parts) >= 2:
                        best_move = parts[1]

                    break

            return {
                "fen": fen,
                "evaluation": evaluation,
                "mate": mate,
                "best_move": best_move,
                "pv": pv,
            }

        finally:

            try:
                process.stdin.write("quit\n")
                process.stdin.flush()
            except Exception:
                pass

            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()



def open_database(database: str):
    scid_session.open_database(database)


def extract_result(moves: str) -> str:

    match = re.search(
        r"(1-0|0-1|1/2-1/2|\*)\s*$",
        moves.strip(),
    )

    if match:
        return match.group(1)

    return "*"


def result_from_scid(value: str) -> str:

    value = value.strip()

    mapping = {
        "1": "1-0",
        "0": "0-1",
        "2": "1/2-1/2",
        "3": "*",
    }

    return mapping.get(value, "*")


def parse_boards(
    boards: str,
) -> list[dict]:

    positions = re.findall(
        r"\{([^{}]+)\}",
        boards,
    )

    result = []

    for position in positions:

        parts = position.rsplit(" ", 1)

        if len(parts) != 2:
            continue

        board, turn = parts

        if len(board) != 64:
            continue

        if turn not in {"w", "b"}:
            continue

        result.append({
            "position": board,
            "turn": turn,
        })

    return result


def database_names() -> list[str]:

    if not DATA_DIR.exists():
        return []

    databases = set()

    for file in DATA_DIR.iterdir():

        if (
            file.is_file()
            and file.suffix.lower() in {
                ".si4",
                ".si3",
                ".si2",
                ".si1",
            }
        ):

            databases.add(file.stem)

    return sorted(databases)


def validate_database(
    database: str,
) -> Path:

    if database not in database_names():

        raise HTTPException(
            status_code=404,
            detail=f"Database not found: {database}",
        )

    return (
        DATA_DIR / database
    ).resolve()


def database_path(
    database: str,
) -> str:

    return str(
        validate_database(database)
    )


@app.get("/")
def index():

    index_file = (
        STATIC_DIR / "index.html"
    )

    if not index_file.exists():

        raise HTTPException(
            status_code=500,
            detail="WebUI index.html not found",
        )

    return FileResponse(index_file)


# -------------------------------------------------------------------------
# Shareable game links
# -------------------------------------------------------------------------

@app.get("/game/{database}/{game_number}")
async def game_page(
    database: str,
    game_number: int,
):
    """
    Serve the WebUI for a shareable game URL.

    The frontend reads the database and game number from
    window.location.pathname and then loads the game
    through the normal API.
    """

    return FileResponse(
        STATIC_DIR / "index.html"
    )


@app.get("/openings")
def openings_page():
    """
    Serve the dedicated Opening Explorer page.
    """

    openings_file = (
        STATIC_DIR / "openings.html"
    )

    if not openings_file.exists():

        raise HTTPException(
            status_code=500,
            detail="WebUI openings.html not found",
        )

    return FileResponse(openings_file)


@app.get("/api/status")
def status():

    return {
        "name": "Scid Web API",
        "version": "0.6.1",
        "tcscid": (
            "available"
            if TCSCID.exists()
            else "missing"
        ),
        "databases": len(
            database_names()
        ),
    }


@app.get("/api/databases")
def databases():

    result = []

    for name in database_names():

        db = database_path(name)

        cached_count = (
            scid_session.game_counts.get(db)
        )

        result.append({
            "name": name,
            "games": cached_count,
            "filename": db,
        })

    return {
        "databases": result,
    }


@app.get(
    "/api/databases/{database}/games"
)
def games(
    database: str,
    page: int = 1,
    limit: int = 10,
    white: str | None = None,
    black: str | None = None,
    event: str | None = None,
    site: str | None = None,
    year: str | None = None,
    result: str | None = None,
    eco: str | None = None,
    search: str | None = None,
):

    if page < 1:

        raise HTTPException(
            status_code=400,
            detail="page must be >= 1",
        )

    if limit < 1 or limit > 100:

        raise HTTPException(
            status_code=400,
            detail=(
                "limit must be between 1 and 100"
            ),
        )

    db = database_path(database)

    try:

        with scid_session.lock:

            # Make sure the requested database is open.
            total_database_games = (
                scid_session.game_count(db)
            )

            has_search = any([
                white,
                black,
                event,
                site,
                year,
                result,
                eco,
                search,
            ])

            if has_search:

                count = (
                    scid_session.apply_search(
                        white=white,
                        black=black,
                        event=event,
                        site=site,
                        year=year,
                        result=result,
                        eco=eco,
                        search=search,
                    )
                )

            else:

                # No search: restore the complete filter.
                scid_session.command(
                    "sc_filter reset"
                )

                count = total_database_games

            pages = (
                (count + limit - 1)
                // limit
            )

            start_position = (
                (page - 1) * limit
            ) + 1

            end_position = min(
                start_position + limit - 1,
                count,
            )

            search_info = {
                "white": white,
                "black": black,
                "event": event,
                "site": site,
                "year": year,
                "result": result,
                "eco": eco,
                "search": search,
            }

            if start_position > count:

                return {
                    "database": database,
                    "page": page,
                    "limit": limit,
                    "count": count,
                    "pages": pages,
                    "games": [],
                    "search": search_info,
                }

            games_list = []

            # If general text search is active, retrieve the
            # precomputed matching filter positions.
            text_matches = []

            if search and search.strip():

                text_matches = (
                    scid_session.current_filter.get(
                        "text_matches",
                        [],
                    )
                )

            for position in range(
                start_position,
                end_position + 1,
            ):

                if text_matches:

                    # `position` is the position in the
                    # FINAL search result list.
                    #
                    # `text_matches[position - 1]` is the
                    # corresponding position in Scid's
                    # original filter.

                    filtered_position = (
                        text_matches[position - 1]
                    )

                else:

                    # Normal structured search or no search.
                    filtered_position = position

                game_number = (
                    scid_session.filtered_game_number(
                        filtered_position
                    )
                )

                # Loading a game returns an empty string
                # on success. We deliberately ignore it.
                scid_command(
                    f"sc_game load {game_number}"
                )

                white_name = scid_command(
                    "sc_game tags get White"
                )

                black_name = scid_command(
                    "sc_game tags get Black"
                )

                event_name = scid_command(
                    "sc_game tags get Event"
                )

                site_name = scid_command(
                    "sc_game tags get Site"
                )

                date = scid_command(
                    "sc_game tags get Date"
                )

                round_name = scid_command(
                    "sc_game tags get Round"
                )

                eco_value = scid_command(
                    "sc_game tags get ECO"
                )

                result_value = scid_command(
                    "sc_game tags get Result"
                )

                games_list.append({
                    "number": game_number,
                    "white": white_name,
                    "black": black_name,
                    "event": event_name,
                    "site": site_name,
                    "date": date,
                    "round": round_name,
                    "result": result_from_scid(
                        result_value
                    ),
                    "eco": eco_value,
                })

            return {
                "database": database,
                "page": page,
                "limit": limit,
                "count": count,
                "pages": pages,
                "games": games_list,
                "search": search_info,
            }

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


@app.get(
    "/api/databases/{database}/games/{game_number}"
)
def game(
    database: str,
    game_number: int,
):

    if game_number < 1:

        raise HTTPException(
            status_code=404,
            detail="Invalid game number",
        )

    db = database_path(database)

    try:

        with scid_session.lock:

            count = (
                scid_session.game_count(db)
            )

            if game_number > count:

                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Game {game_number} not found"
                    ),
                )

            scid_command(
                f"sc_game load {game_number}"
            )

            white = scid_command(
                "sc_game tags get White"
            )

            black = scid_command(
                "sc_game tags get Black"
            )

            event = scid_command(
                "sc_game tags get Event"
            )

            site = scid_command(
                "sc_game tags get Site"
            )

            date = scid_command(
                "sc_game tags get Date"
            )

            round_name = scid_command(
                "sc_game tags get Round"
            )

            eco = scid_command(
                "sc_game tags get ECO"
            )

            moves = scid_command(
                "sc_game summary moves"
            )

            boards = scid_command(
                "sc_game summary boards"
            )

            result = extract_result(
                moves
            )

            return {
                "database": database,
                "number": game_number,
                "white": white,
                "black": black,
                "event": event,
                "site": site,
                "date": date,
                "round": round_name,
                "result": result,
                "eco": eco,
                "moves": moves,
                "boards": parse_boards(
                    boards
                ),
            }

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )



# -------------------------------------------------------------------------
# Opening tree
# -------------------------------------------------------------------------

def parse_opening_tree(value: str) -> list[dict]:
    """
    Parse the Tcl list returned by:

        sc_tree search -list 1

    Each move entry has the form:

        {
            line
            move
            games
            frequency
            score
            percent
            white_rating
            black_rating
            year
            extra
        }

    The final summary entry does not have a move and is ignored.
    """

    pattern = re.compile(
        r"""
        \{
            \s*
            (?P<line>\d+)
            \s+
            (?P<move>\S+)
            \s+
            (?P<games>\d+)
            \s+
            (?P<frequency>[\d.]+)
            \s+
            (?P<score>[\d.]+)
            \s+
            (?P<percent>\S+)
            \s+
            (?P<white_rating>\S+)
            \s+
            (?P<black_rating>\S+)
            \s+
            (?P<year>\S+)
            \s+
            \{\}
            \s*
        \}
        """,
        re.VERBOSE,
    )

    result = []

    for match in pattern.finditer(value):

        data = match.groupdict()

        def optional_int(value):
            if value in {"{}", ""}:
                return None
            try:
                return int(value)
            except ValueError:
                return None

        def optional_float(value):
            if value in {"{}", ""}:
                return None
            try:
                return float(value)
            except ValueError:
                return None

        percent = data["percent"]

        if percent.endswith("%"):
            percent = percent[:-1]

        result.append({
            "line": int(data["line"]),
            "move": data["move"],
            "games": int(data["games"]),
            "frequency": float(data["frequency"]),
            "score": float(data["score"]),
            "percent": float(percent),
            "white_rating": optional_int(
                data["white_rating"]
            ),
            "black_rating": optional_int(
                data["black_rating"]
            ),
            "year": optional_int(
                data["year"]
            ),
        })

    return result




@app.get(
    "/api/databases/{database}/games/{game_number}/analyse"
)
def analyse_game(
    database: str,
    game_number: int,
    ply: int = 0,
    request: Request = None,
):
    """
    Analyse a specific position in a game with Stockfish.

    ply=0 is the starting position.
    ply=1 is after White's first move.
    ply=2 is after Black's first move.
    """
    
    client_ip = get_client_ip(request)

    allowed, retry_after = check_stockfish_rate_limit(
        client_ip
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                "Stockfish rate limit exceeded. "
                "Please try again later."
            ),
            headers={
                "Retry-After": str(retry_after),
            },
        )


    if game_number < 1:
        raise HTTPException(
            status_code=404,
            detail="Invalid game number",
        )

    if ply < 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid ply",
        )

    db = database_path(database)

    try:

        with scid_session.lock:

            count = (
                scid_session.game_count(db)
            )

            if game_number > count:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Game {game_number} not found"
                    ),
                )

            scid_command(
                f"sc_game load {game_number}"
            )

            boards = scid_command(
                "sc_game summary boards"
            )

            board_list = parse_boards(boards)

            if ply >= len(board_list):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Invalid ply {ply}. "
                        f"Game has {len(board_list) - 1} plies."
                    ),
                )

            scid_command("sc_move start")

            for _ in range(ply):
                scid_command("sc_move forward")

            fen = scid_command("sc_pos fen")

        analysis = analyse_fen(fen)

        return {
            "database": database,
            "game": game_number,
            "ply": ply,
            **analysis,
        }

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

@app.get(
    "/api/databases/{database}/opening-tree"
)
def opening_tree(
    database: str,
    moves: str | None = None,
):
    """
    Return Scid's opening tree for the requested position.

    `moves` is an optional space-separated SAN move sequence.

    Examples:

        /opening-tree

        /opening-tree?moves=e4

        /opening-tree?moves=e4%20e5

        /opening-tree?moves=e4%20e5%20Nf3
    """

    db = database_path(database)

    try:

        with scid_session.lock:

            # Make sure the requested database is open.
            scid_session.game_count(db)

            # Opening trees should use the complete database,
            # regardless of whatever filter the game browser
            # used previously.
            scid_command(
                "sc_filter reset"
            )

            # Start from the root position.
            scid_command(
                "sc_move start"
            )

            move_list = []

            if moves and moves.strip():

                move_list = moves.strip().split()

                for move in move_list:

                    if not re.fullmatch(
                        r"[A-Za-z0-9+#=xO\-]+",
                        move,
                    ):

                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Invalid SAN move: {move}"
                            ),
                        )

                    try:

                        result = scid_command(
                            f"sc_move addSan "
                            f"{tcl_quote(move)}"
                        )

                    except Exception:

                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Invalid move sequence at: "
                                f"{move}"
                            ),
                        )

            tree_output = scid_command(
                "sc_tree search -list 1"
            )

            tree = parse_opening_tree(
                tree_output
            )

            return {
                "database": database,
                "moves": move_list,
                "tree": tree,
            }

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


if STATIC_DIR.exists():

    app.mount(
        "/static",
        StaticFiles(
            directory=str(STATIC_DIR)
        ),
        name="static",
    )

