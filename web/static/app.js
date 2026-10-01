import { Chess } from "/static/vendor/chess.js";


"use strict";


/* =========================================================================
   Share button handler
   ========================================================================= */

/*
 * Install the Share handler immediately when app.js starts.
 *
 * Event delegation means this works even if #shareGame is hidden,
 * shown, or recreated later by the application.
 */

console.log("APP.JS STARTED");

document.addEventListener(
    "click",
    async event => {

        const button =
            event.target.closest("#shareGame");

        if (!button) {
            return;
        }

        console.log(
            "SHARE BUTTON HANDLER FIRED"
        );

        if (
            !window.state ||
            !state.game ||
            !state.database
        ) {

            console.warn(
                "Cannot share: no game or database is loaded.",
                window.state
            );

            return;
        }

        const url =
            `${window.location.origin}` +
            `/game/${encodeURIComponent(state.database)}` +
            `/${state.game.number}`;

        console.log(
            "SHARE URL:",
            url
        );

        try {

            await navigator.clipboard.writeText(
                url
            );

            const originalText =
                button.textContent;

            button.textContent =
                "✓ Link copied!";

            setTimeout(
                () => {

                    button.textContent =
                        originalText;

                },
                2000
            );

            console.log(
                "LINK COPIED"
            );

        } catch (error) {

            console.warn(
                "Clipboard failed, using fallback:",
                error
            );

            window.prompt(
                "Copy this link:",
                url
            );
        }
    }
);

console.log(
    "SHARE HANDLER INSTALLED"
);


/* =========================================================================
   State
   ========================================================================= */

window.state = {
    database: null,
    games: [],
    game: null,

    // Database pagination
    page: 1,
    pages: 1,
    limit: 50,
    totalGames: 0,

    // Server-side search
    search: "",

    // 0 = starting position
    // 1 = after first move
    // 2 = after second move
    // etc.
    currentPosition: 0,

    /*
     * Stockfish analysis.
     *
     * Results are cached by position so moving backwards and forwards
     * through a game does not repeatedly run Stockfish.
     */
    analysisCache: new Map(),

    // Unique ID for the currently requested analysis.
    analysisRequestId: 0,

    // Controller for the currently running analysis request.
    analysisAbortController: null,

    // True while Stockfish is analysing the current position.
    analysisLoading: false,

    // True while the current game-list request is running.
    loadingGames: false,

    /*
     * Every game-list request gets a unique ID.
     *
     * This prevents an older request from overwriting
     * the results of a newer request.
     */
    gamesRequestId: 0,

    /*
     * Controller for the currently running game-list request.
     *
     * Starting a new search/page/database load aborts
     * the previous request.
     */
    gamesAbortController: null,

};


/* =========================================================================
   DOM
   ========================================================================= */

const databaseSelect =
    document.getElementById("databaseSelect");

const gamesSection =
    document.getElementById("gamesSection");

const gameSection =
    document.getElementById("gameSection");

const gamesTableBody =
    document.getElementById("gamesTableBody");

const gameCount =
    document.getElementById("gameCount");

const gameSearch =
    document.getElementById("gameSearch");

const previousPage =
    document.getElementById("previousPage");

const pageInfo =
    document.getElementById("pageInfo");

const nextPage =
    document.getElementById("nextPage");

const chessboard =
    document.getElementById("chessboard");

const movesList =
    document.getElementById("movesList");

const whitePlayer =
    document.getElementById("whitePlayer");

const blackPlayer =
    document.getElementById("blackPlayer");

const gameTitle =
    document.getElementById("gameTitle");

const gameEvent =
    document.getElementById("gameEvent");

const gameSite =
    document.getElementById("gameSite");

const gameDate =
    document.getElementById("gameDate");

const gameResult =
    document.getElementById("gameResult");

const moveCounter =
    document.getElementById("moveCounter");

const errorBox =
    document.getElementById("error");

const backButton =
    document.getElementById("backButton");

const firstMove =
    document.getElementById("firstMove");

const previousMove =
    document.getElementById("previousMove");

const nextMove =
    document.getElementById("nextMove");

const lastMove =
    document.getElementById("lastMove");

const analysisPanel =
    document.getElementById("analysisPanel");

const analysisStatus =
    document.getElementById("analysisStatus");

const analysisEvaluation =
    document.getElementById("analysisEvaluation");

const analysisBestMove =
    document.getElementById("analysisBestMove");

const analysisPv =
    document.getElementById("analysisPv");


/* =========================================================================
   Chess pieces
   ========================================================================= */

const PIECES = {
    K: "♔",
    Q: "♕",
    R: "♖",
    B: "♗",
    N: "♘",
    P: "♙",

    k: "♚",
    q: "♛",
    r: "♜",
    b: "♝",
    n: "♞",
    p: "♟",
};


/* =========================================================================
   API
   ========================================================================= */

/*
 * Generic API helper.
 *
 * options allows callers to pass an AbortController signal.
 */
async function api(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
            options
        );

    if (!response.ok) {

        let detail =
            `HTTP ${response.status}`;

        try {

            const data =
                await response.json();

            if (data.detail) {
                detail =
                    data.detail;
            }

        } catch (_) {
            // Ignore JSON parsing failure.
        }

        const error =
            new Error(detail);

        error.status =
            response.status;

        error.retryAfter =
            response.headers.get(
                "Retry-After"
            );

        throw error;
    }

    return response.json();
}


/* =========================================================================
   Stockfish analysis
   ========================================================================= */

/*
 * Convert a Stockfish UCI move sequence to normal SAN notation.
 *
 * Example:
 *
 *     e2e4 e7e5 g1f3
 *
 * becomes:
 *
 *     e4 e5 Nf3
 *
 * The moves are played sequentially because SAN depends on
 * the position before each move.
 */

function uciToSan(fen, moves) {

    if (
        !fen ||
        !moves ||
        !moves.length
    ) {
        return [];
    }

    try {

        const chess =
            new Chess(fen);

        const sanMoves = [];

        for (const uci of moves) {

            if (!uci || uci.length < 4) {
                continue;
            }

            const from =
                uci.slice(0, 2);

            const to =
                uci.slice(2, 4);

            const promotion =
                uci.length >= 5
                    ? uci[4]
                    : undefined;

            const move =
                chess.move({
                    from,
                    to,
                    promotion
                });

            if (!move) {
                break;
            }

            sanMoves.push(
                move.san
            );
        }

        return sanMoves;

    } catch (error) {

        console.warn(
            "Could not convert Stockfish moves to SAN:",
            error
        );

        return [];
    }
}


function renderAnalysis(data) {

    if (!data) {

        analysisStatus.textContent =
            "Waiting for analysis…";

        analysisEvaluation.textContent =
            "—";

        analysisBestMove.textContent =
            "—";

        analysisPv.textContent =
            "—";

        return;
    }


    analysisStatus.textContent =
        "Analysis complete";


    if (data.mate !== null) {

        const mate =
            Number(data.mate);

        analysisEvaluation.textContent =
            `M${mate}`;

    } else if (data.evaluation !== null) {

        const evaluation =
            Number(data.evaluation);

        const sign =
            evaluation > 0
                ? "+"
                : "";

        analysisEvaluation.textContent =
            `${sign}${evaluation.toFixed(2)}`;

    } else {

        analysisEvaluation.textContent =
            "—";
    }


    /*
     * Convert Stockfish's UCI notation to normal SAN notation.
     */
    const sanMoves =
        uciToSan(
            data.fen,
            data.pv
        );

    analysisBestMove.textContent =
        sanMoves.length
            ? sanMoves[0]
            : (data.best_move || "—");


    analysisPv.textContent =
        sanMoves.length
            ? sanMoves.join(" ")
            : (
                data.pv && data.pv.length
                    ? data.pv.join(" ")
                    : "—"
            );
}


/* =========================================================================
   Stockfish analysis
   ========================================================================= */

async function loadAnalysis() {

    if (!state.game) {
        return;
    }

    const database =
        state.game.database;

    const gameNumber =
        state.game.number;

    const ply =
        state.currentPosition;

    /*
     * Use the cached result if we have already analysed this position.
     */
    const cacheKey =
        `${database}:${gameNumber}:${ply}`;

    if (state.analysisCache.has(cacheKey)) {

        const cached =
            state.analysisCache.get(cacheKey);

        state.analysisLoading =
            false;

        renderAnalysis(cached);

        return;
    }

    /*
     * Abort an older analysis request.
     *
     * This is important when the user clicks through moves quickly.
     */
    if (state.analysisAbortController) {

        state.analysisAbortController.abort();
    }

    const controller =
        new AbortController();

    state.analysisAbortController =
        controller;

    const requestId =
        ++state.analysisRequestId;

    state.analysisLoading =
        true;

    analysisStatus.textContent =
        "Stockfish is thinking…";

    analysisEvaluation.textContent =
        "…";

    analysisBestMove.textContent =
        "…";

    analysisPv.textContent =
        "…";

    try {

        const data =
            await api(
                `/api/databases/${encodeURIComponent(database)}/games/${gameNumber}/analyse?ply=${ply}`,
                {
                    signal:
                        controller.signal
                }
            );

        /*
         * Ignore results from an older request.
         */
        if (
            requestId !==
            state.analysisRequestId
        ) {
            return;
        }

        state.analysisCache.set(
            cacheKey,
            data
        );

        renderAnalysis(data);

    } catch (error) {

        /*
         * AbortError is expected when the user changes position
         * before Stockfish has finished.
         */
        if (
            error.name ===
            "AbortError"
        ) {
            return;
        }

        /*
         * Stockfish rate limit.
         */
        if (
            error.status ===
            429
        ) {

            const seconds =
                Number(
                    error.retryAfter
                );

            const waitText =
                Number.isFinite(seconds) &&
                seconds > 0
                    ? ` Please try again in about ${seconds} seconds.`
                    : " Please try again later.";

            analysisStatus.textContent =
                "Stockfish rate limit reached.";

            analysisEvaluation.textContent =
                "";

            analysisBestMove.textContent =
                "";

            analysisPv.textContent =
                waitText.trim();

            return;
        }

        console.error(
            "Stockfish analysis failed:",
            error
        );

        analysisStatus.textContent =
            "Stockfish analysis failed.";

        analysisEvaluation.textContent =
            "";

        analysisBestMove.textContent =
            "";

        analysisPv.textContent =
            error.message ||
            "Please try again.";

    } finally {

        if (
            requestId ===
            state.analysisRequestId
        ) {

            state.analysisLoading =
                false;
        }
    }
}


/* =========================================================================
   Error handling
   ========================================================================= */

function showError(message) {

    errorBox.textContent =
        message;

    errorBox.classList.remove("hidden");
}


function hideError() {

    errorBox.textContent =
        "";

    errorBox.classList.add("hidden");
}


/* =========================================================================
   Loading state
   ========================================================================= */

function setGamesLoading(loading) {

    state.loadingGames =
        loading;

    if (previousPage) {

        previousPage.disabled =
            loading ||
            state.page <= 1;
    }

    if (nextPage) {

        nextPage.disabled =
            loading ||
            state.page >= state.pages;
    }

    if (loading) {

        pageInfo.textContent =
            "Loading…";

    } else {

        updatePagination();
    }

    if (gameCount && loading) {

        if (state.search) {

            gameCount.textContent =
                `Searching for "${state.search}"…`;

        } else {

            gameCount.textContent =
                "Loading games…";
        }
    }
}


/* =========================================================================
   Load databases
   ========================================================================= */

async function loadDatabases() {

    try {

        hideError();

        const data =
            await api(
                "/api/databases"
            );

        databaseSelect.innerHTML =
            "";

        for (const database of data.databases) {

            const option =
                document.createElement("option");

            option.value =
                database.name;

            /*
             * A database may not have been opened yet, so the backend
             * can return null for its game count.
             */
            const countText =
                database.games === null ||
                database.games === undefined
                    ? "not loaded"
                    : database.games.toLocaleString();

            option.textContent =
                `${database.name} (${countText})`;

            databaseSelect.appendChild(
                option
            );
        }

        if (data.databases.length === 0) {

            gameCount.textContent =
                "No databases found.";

            updatePagination();

            return;
        }

        state.database =
            data.databases[0].name;

        databaseSelect.value =
            state.database;

        /*
         * Always start a newly selected database at page 1.
         */
        state.page =
            1;

        state.search =
            "";

        gameSearch.value =
            "";

        await loadGames();

    } catch (error) {

        showError(
            `Could not load databases: ${error.message}`
        );
    }
}


/* =========================================================================
   Load games
   ========================================================================= */

async function loadGames() {

    if (!state.database) {
        return;
    }

    /*
     * Give this request a unique ID.
     *
     * Any request started after this one will have a higher ID.
     */
    const requestId =
        ++state.gamesRequestId;

    /*
     * Cancel the previous game-list request.
     *
     * This is especially useful for searches because LumbrasGigaBase
     * contains more than 10 million games.
     */
    if (state.gamesAbortController) {

        state.gamesAbortController.abort();
    }

    const controller =
        new AbortController();

    state.gamesAbortController =
        controller;

    /*
     * Capture the values belonging to THIS request.
     *
     * This prevents a later search/page/database change from
     * changing what this request thinks it is loading.
     */
    const database =
        databaseSelect.value;

    const page =
        state.page;

    const search =
        state.search;

    try {

        hideError();

        state.database =
            database;

        setGamesLoading(true);

        /*
         * URLSearchParams handles encoding automatically.
         *
         * Example:
         *
         * /api/databases/LumbrasGigaBase_OTB/games?page=1&limit=50&search=Grimm
         */
        const params =
            new URLSearchParams();

        params.set(
            "page",
            page
        );

        params.set(
            "limit",
            state.limit
        );

        if (search) {

            params.set(
                "search",
                search
            );
        }

        const url =
            `/api/databases/${encodeURIComponent(database)}/games` +
            `?${params.toString()}`;

        const data =
            await api(
                url,
                {
                    signal:
                        controller.signal,
                }
            );

        /*
         * The request finished successfully, but another request
         * may have started while we were waiting.
         *
         * If this request is no longer the newest request,
         * completely ignore its response.
         */
        if (
            requestId !==
            state.gamesRequestId
        ) {

            return;
        }

        state.games =
            data.games || [];

        state.page =
            data.page || page;

        state.pages =
            data.pages || 1;

        state.totalGames =
            data.count || 0;

        renderGames();

        updatePagination();

    } catch (error) {

        /*
         * AbortError is expected whenever a newer request
         * replaces this request.
         */
        if (
            error.name ===
            "AbortError"
        ) {

            return;
        }

        /*
         * An old request must never display an error
         * after a newer request has started.
         */
        if (
            requestId !==
            state.gamesRequestId
        ) {

            return;
        }

        showError(
            `Could not load games: ${error.message}`
        );

    } finally {

        /*
         * Only the newest request is allowed to change
         * the loading state.
         */
        if (
            requestId ===
            state.gamesRequestId
        ) {

            state.gamesAbortController =
                null;

            setGamesLoading(false);
        }
    }
}


/* =========================================================================
   Pagination
   ========================================================================= */

function updatePagination() {

    /*
     * If the HTML pagination controls haven't been added yet,
     * don't crash the entire application.
     */
    if (
        !previousPage ||
        !pageInfo ||
        !nextPage
    ) {
        return;
    }

    if (state.loadingGames) {

        pageInfo.textContent =
            "Loading…";

        return;
    }

    pageInfo.textContent =
        `Page ${state.page.toLocaleString()} of ${state.pages.toLocaleString()}`;

    previousPage.disabled =
        state.page <= 1;

    nextPage.disabled =
        state.page >= state.pages;
}


async function goToPage(page) {

    if (
        page < 1 ||
        page > state.pages
    ) {
        return;
    }

    /*
     * Don't reload the same page.
     */
    if (page === state.page) {
        return;
    }

    state.page =
        page;

    await loadGames();

    /*
     * Put the user back at the games table.
     */
    gamesSection.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}


/* =========================================================================
   Render games table
   ========================================================================= */

function renderGames() {

    gamesTableBody.innerHTML =
        "";

    /*
     * IMPORTANT:
     *
     * Search is performed by the backend.
     *
     * state.games therefore already contains exactly the games
     * that belong on this page.
     *
     * We must NOT filter them again on the client.
     */

    const games =
        state.games;

    if (state.search) {

        if (state.totalGames === 0) {

            gameCount.textContent =
                `No games found for "${state.search}".`;

        } else {

            gameCount.textContent =
                `${state.totalGames.toLocaleString()} ` +
                `matching games for "${state.search}"`;
        }

    } else {

        const firstGame =
            games.length > 0
                ? games[0].number
                : 0;

        const lastGame =
            games.length > 0
                ? games[games.length - 1].number
                : 0;

        if (games.length > 0) {

            gameCount.textContent =
                `Games ${firstGame.toLocaleString()}–` +
                `${lastGame.toLocaleString()} of ` +
                `${state.totalGames.toLocaleString()}`;

        } else {

            gameCount.textContent =
                "No games on this page.";
        }
    }

    for (const game of games) {

        const row =
            document.createElement("tr");

        row.addEventListener(
            "click",
            () => openGame(game.number)
        );

        row.innerHTML = `
            <td>${escapeHtml(game.number)}</td>
            <td>${escapeHtml(game.white || "—")}</td>
            <td>${escapeHtml(game.black || "—")}</td>
            <td>${escapeHtml(game.event || "—")}</td>
            <td>${escapeHtml(game.date || "—")}</td>
            <td class="${resultClass(game.result)}">
                ${escapeHtml(game.result || "*")}
            </td>
            <td>${escapeHtml(game.eco || "—")}</td>
        `;

        gamesTableBody.appendChild(
            row
        );
    }
}


/* =========================================================================
   Open game
   ========================================================================= */

async function openGame(number) {

    try {

        hideError();

        const data =
            await api(
                `/api/databases/${encodeURIComponent(state.database)}/games/${number}`
            );

        state.game =
            data;

        // Always start at the initial position.
        state.currentPosition =
            0;

        /*
         * Update the browser URL so this game can be bookmarked
         * or shared directly.
         */
        history.replaceState(
            null,
            "",
            `/game/${encodeURIComponent(state.database)}/${number}`
        );

        gamesSection.classList.add(
            "hidden"
        );

        gameSection.classList.remove(
            "hidden"
        );

        renderGame();
        loadAnalysis();

    } catch (error) {

        showError(
            `Could not load game: ${error.message}`
        );
    }
}


/* =========================================================================
   Open game from URL
   ========================================================================= */

function getGameFromUrl() {

    const path =
        window.location.pathname;

    const match =
        path.match(
            /^\/game\/([^/]+)\/(\d+)$/
        );

    if (!match) {
        return null;
    }

    return {
        database:
            decodeURIComponent(
                match[1]
            ),

        number:
            parseInt(
                match[2],
                10
            ),
    };
}


async function openGameFromUrl() {

    const gameInfo =
        getGameFromUrl();

    if (!gameInfo) {
        return;
    }

    /*
     * Make sure the database from the URL actually exists.
     */
    const option =
        Array.from(
            databaseSelect.options
        ).find(
            option =>
                option.value ===
                gameInfo.database
        );

    if (!option) {

        showError(
            `Database "${gameInfo.database}" was not found.`
        );

        return;
    }

    /*
     * Select the database from the URL.
     */
    state.database =
        gameInfo.database;

    databaseSelect.value =
        gameInfo.database;

    /*
     * Open the requested game.
     */
    await openGame(
        gameInfo.number
    );
}


/* =========================================================================
   Render game
   ========================================================================= */

function renderGame() {

    if (!state.game) {
        return;
    }

    const game =
        state.game;

    whitePlayer.textContent =
        game.white || "Unknown";

    blackPlayer.textContent =
        game.black || "Unknown";

    gameTitle.textContent =
        `${game.white || "White"}  ${game.result || "*"}  ${game.black || "Black"}`;

    gameEvent.textContent =
        game.event || "Unknown event";

    gameSite.textContent =
        game.site || "Unknown site";

    gameDate.textContent =
        game.date || "";

    gameResult.textContent =
        game.result || "*";

    renderBoard();

    renderMoves();

    updateControls();
}


/* =========================================================================
   Board
   ========================================================================= */

function renderBoard() {

    chessboard.innerHTML =
        "";

    if (
        !state.game ||
        !state.game.boards
    ) {
        return;
    }

    const boards =
        state.game.boards;

    if (boards.length === 0) {
        return;
    }

    /*
     * The API returns one board for every position.
     *
     * boards[0] = starting position
     * boards[1] = after first move
     * boards[2] = after second move
     * ...
     */

    const position =
        boards[state.currentPosition] ||
        boards[0];

    if (
        !position ||
        !position.position
    ) {
        return;
    }

    /*
     * SCID returns the board as rank 1 → rank 8.
     * Reverse the 8 ranks while keeping a → h
     * in the correct order within each rank.
     */
    const board =
        position.position
            .match(/.{8}/g)
            .reverse()
            .join("");

    for (
        let rank = 0;
        rank < 8;
        rank++
    ) {

        for (
            let file = 0;
            file < 8;
            file++
        ) {

            const square =
                document.createElement("div");

            square.classList.add(
                "square"
            );

            const isLight =
                (rank + file) % 2 === 0;

            square.classList.add(
                isLight
                    ? "light"
                    : "dark"
            );

            /*
             * Scid stores the board as:
             *
             * rank 8 → index 0
             * rank 7 → index 8
             * ...
             * rank 1 → index 56
             */

            const index =
                rank * 8 + file;

            const piece =
                board[index];

            if (piece !== ".") {

                const pieceElement =
                    document.createElement("span");

                pieceElement.classList.add(
                    "piece"
                );

                pieceElement.textContent =
                    PIECES[piece] || piece;

                square.appendChild(
                    pieceElement
                );
            }

            chessboard.appendChild(
                square
            );
        }
    }
}


/* =========================================================================
   Move parsing
   ========================================================================= */

function parseMoves(moveText) {

    /*
     * Remove the final game result.
     */

    let text =
        moveText
            .replace(
                /\s+(1-0|0-1|1\/2-1\/2|\*)\s*$/,
                ""
            )
            .trim();

    if (!text) {
        return [];
    }

    /*
     * Split into tokens.
     */

    const tokens =
        text.split(/\s+/);

    const moves = [];

    let moveNumber =
        1;

    let color =
        "white";

    for (let token of tokens) {

        /*
         * Handle tokens such as:
         *
         * 1.e4
         * 23...Qxd1
         */

        const match =
            token.match(
                /^(\d+)\.(\.\.)?(.*)$/
            );

        if (match) {

            moveNumber =
                parseInt(
                    match[1],
                    10
                );

            const blackMove =
                Boolean(match[2]);

            token =
                match[3];

            if (!token) {

                color =
                    blackMove
                        ? "black"
                        : "white";

                continue;
            }

            color =
                blackMove
                    ? "black"
                    : "white";
        }

        if (!token) {
            continue;
        }

        /*
         * Some PGNs may have move numbers separated from moves:
         *
         * 1. e4 e5
         */

        if (/^\d+\.+$/.test(token)) {
            continue;
        }

        moves.push({
            number: moveNumber,
            color: color,
            notation: token,
        });

        if (color === "white") {

            color =
                "black";

        } else {

            color =
                "white";

            moveNumber++;
        }
    }

    return moves;
}


/* =========================================================================
   Render move list
   ========================================================================= */

function renderMoves() {

    movesList.innerHTML =
        "";

    if (!state.game) {
        return;
    }

    const moves =
        parseMoves(
            state.game.moves
        );

    /*
     * Group white and black moves by move number.
     */

    const grouped =
        new Map();

    for (const move of moves) {

        if (!grouped.has(move.number)) {

            grouped.set(
                move.number,
                {}
            );
        }

        grouped.get(move.number)[move.color] =
            move.notation;
    }

    for (
        const [number, pair]
        of grouped
    ) {

        const row =
            document.createElement("div");

        row.classList.add(
            "move-row"
        );

        const numberElement =
            document.createElement("div");

        numberElement.classList.add(
            "move-number"
        );

        numberElement.textContent =
            `${number}.`;

        row.appendChild(
            numberElement
        );


        /*
         * White move
         */

        if (pair.white) {

            const moveElement =
                document.createElement("div");

            moveElement.classList.add(
                "move"
            );

            const moveIndex =
                moves.findIndex(
                    move =>
                        move.number === number &&
                        move.color === "white"
                );

            /*
             * moveIndex is zero-based.
             *
             * Position 0 = before any moves.
             * Therefore the first move corresponds
             * to position 1.
             */

            moveElement.dataset.position =
                moveIndex + 1;

            moveElement.textContent =
                pair.white;

            moveElement.addEventListener(
                "click",
                () => {

                    state.currentPosition =
                        moveIndex + 1;

                    updatePosition();
                }
            );

            if (
                state.currentPosition ===
                moveIndex + 1
            ) {

                moveElement.classList.add(
                    "active"
                );
            }

            row.appendChild(
                moveElement
            );

        } else {

            row.appendChild(
                document.createElement("div")
            );
        }


        /*
         * Black move
         */

        if (pair.black) {

            const moveElement =
                document.createElement("div");

            moveElement.classList.add(
                "move"
            );

            const moveIndex =
                moves.findIndex(
                    move =>
                        move.number === number &&
                        move.color === "black"
                );

            /*
             * As with white moves, the move index
             * is zero-based while board position 0
             * is the starting position.
             */

            moveElement.dataset.position =
                moveIndex + 1;

            moveElement.textContent =
                pair.black;

            moveElement.addEventListener(
                "click",
                () => {

                    state.currentPosition =
                        moveIndex + 1;

                    updatePosition();
                }
            );

            if (
                state.currentPosition ===
                moveIndex + 1
            ) {

                moveElement.classList.add(
                    "active"
                );
            }

            row.appendChild(
                moveElement
            );

        } else {

            row.appendChild(
                document.createElement("div")
            );
        }

        movesList.appendChild(
            row
        );
    }
}


/* =========================================================================
   Position update
   ========================================================================= */

function updatePosition() {

    renderBoard();
    renderMoves();
    updateControls();
    loadAnalysis();
}


/* =========================================================================
   Game controls
   ========================================================================= */

function updateControls() {

    if (!state.game) {
        return;
    }

    const moveCount =
        parseMoves(
            state.game.moves
        ).length;

    moveCounter.textContent =
        `${state.currentPosition} / ${moveCount}`;

    firstMove.disabled =
        state.currentPosition <= 0;

    previousMove.disabled =
        state.currentPosition <= 0;

    nextMove.disabled =
        state.currentPosition >= moveCount;

    lastMove.disabled =
        state.currentPosition >= moveCount;
}


firstMove.addEventListener(
    "click",
    () => {

        state.currentPosition =
            0;

        updatePosition();
    }
);


previousMove.addEventListener(
    "click",
    () => {

        if (
            state.currentPosition > 0
        ) {

            state.currentPosition--;

            updatePosition();
        }
    }
);


nextMove.addEventListener(
    "click",
    () => {

        const count =
            parseMoves(
                state.game.moves
            ).length;

        if (
            state.currentPosition < count
        ) {

            state.currentPosition++;

            updatePosition();
        }
    }
);


lastMove.addEventListener(
    "click",
    () => {

        const count =
            parseMoves(
                state.game.moves
            ).length;

        state.currentPosition =
            count;

        updatePosition();
    }
);



/* =========================================================================
   Pagination controls
   ========================================================================= */

if (previousPage) {

    previousPage.addEventListener(
        "click",
        async () => {

            await goToPage(
                state.page - 1
            );
        }
    );
}


if (nextPage) {

    nextPage.addEventListener(
        "click",
        async () => {

            await goToPage(
                state.page + 1
            );
        }
    );
}


/* =========================================================================
   Back button
   ========================================================================= */

backButton.addEventListener(
    "click",
    () => {

        state.game =
            null;

        gameSection.classList.add(
            "hidden"
        );

        gamesSection.classList.remove(
            "hidden"
        );

        /*
         * Remove the shareable game URL and return to
         * the normal WebUI URL.
         */
        history.replaceState(
            null,
            "",
            "/"
        );

        hideError();
    }
);


/* =========================================================================
   Database selector
   ========================================================================= */

databaseSelect.addEventListener(
    "change",
    async () => {

        /*
         * Starting a new database load automatically aborts
         * any previous game-list request.
         */

        state.database =
            databaseSelect.value;

        /*
         * Every database starts at page 1.
         */
        state.page =
            1;

        /*
         * Clear the previous search.
         */
        state.search =
            "";

        gameSearch.value =
            "";

        /*
         * Clear any previous game.
         */
        state.game =
            null;

        /*
         * Return to the normal database URL.
         */
        history.replaceState(
            null,
            "",
            "/"
        );

        /*
         * Make sure the games section is visible.
         */
        gameSection.classList.add(
            "hidden"
        );

        gamesSection.classList.remove(
            "hidden"
        );

        await loadGames();
    }
);


/* =========================================================================
   Search
   ========================================================================= */

async function performSearch() {

    const query =
        gameSearch.value.trim();

    /*
     * Don't perform a duplicate search.
     */
    if (query === state.search) {
        return;
    }

    state.search =
        query;

    /*
     * Every new search starts at page 1.
     */
    state.page =
        1;

    /*
     * Wait for the protected game-loading process.
     *
     * loadGames() will abort the previous request and ensure
     * that only this request can update the UI.
     */
    await loadGames();
}


/*
 * Search when Enter is pressed.
 *
 * This is deliberately NOT an "input" listener because the database
 * contains more than 10 million games and each general search can
 * be expensive.
 */
gameSearch.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {

            event.preventDefault();

            performSearch();
        }

        /*
         * Escape clears the search and immediately reloads
         * the normal database listing.
         */
        if (event.key === "Escape") {

            event.preventDefault();

            if (
                gameSearch.value ||
                state.search
            ) {

                gameSearch.value =
                    "";

                state.search =
                    "";

                state.page =
                    1;

                loadGames();
            }
        }
    }
);


/*
 * If the search box is manually cleared and the user presses Enter,
 * performSearch() above will restore the normal listing.
 */


/* =========================================================================
   Utility
   ========================================================================= */

function resultClass(result) {

    if (result === "1-0") {
        return "result-win";
    }

    if (result === "0-1") {
        return "result-loss";
    }

    if (result === "1/2-1/2") {
        return "result-draw";
    }

    return "";
}


function escapeHtml(value) {

    return String(value)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/* =========================================================================
   Start
   ========================================================================= */

loadDatabases().then(
    () => {
        openGameFromUrl();
    }
);
