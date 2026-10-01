"use strict";

import { Chess } from "./vendor/chess.js";


/* =========================================================================
   State
   ========================================================================= */

let chess = new Chess();
let openingMoves = [];
let openingRequestId = 0;
let currentDatabase = "";

let selectedSquare = null;
let legalTargets = [];


/* =========================================================================
   DOM
   ========================================================================= */

const openingTree = document.getElementById("openingTree");
const openingName = document.getElementById("openingName");
const openingLine = document.getElementById("openingLine");

const openingBack = document.getElementById("openingBack");
const openingReset = document.getElementById("openingReset");
const openingRefresh = document.getElementById("openingRefresh");

const databaseSelect = document.getElementById("databaseSelect");

const chessboard = document.getElementById("chessboard");
const boardStatus = document.getElementById("boardStatus");

const openingMatches = document.getElementById("openingMatches");


/* =========================================================================
   Opening names
   ========================================================================= */

const OPENING_NAMES = [
    { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"], name: "Italian Game" },
    { moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"], name: "Ruy Lopez" },
    { moves: ["e4", "e5", "Nf3", "Nc6", "d4"], name: "Scotch Game" },
    { moves: ["e4", "e5", "Nf3", "Nc6"], name: "Four Knights Game" },
    { moves: ["e4", "e5", "Nf3"], name: "King's Knight Opening" },
    { moves: ["e4", "e5", "Nc3"], name: "Vienna Game" },
    { moves: ["e4", "e5", "Bc4"], name: "Bishop's Opening" },
    { moves: ["e4", "e5", "d4"], name: "Center Game" },
    { moves: ["e4", "e5", "f4"], name: "King's Gambit" },
    { moves: ["e4", "e5", "c3"], name: "Ponziani Opening" },

    { moves: ["e4", "c5"], name: "Sicilian Defense" },
    { moves: ["e4", "c6"], name: "Caro-Kann Defense" },
    { moves: ["e4", "e6"], name: "French Defense" },
    { moves: ["e4", "d5"], name: "Scandinavian Defense" },
    { moves: ["e4", "d6"], name: "Pirc Defense" },
    { moves: ["e4", "g6"], name: "Modern Defense" },

    { moves: ["d4", "d5", "c4"], name: "Queen's Gambit" },
    { moves: ["d4", "Nf6", "c4", "g6"], name: "King's Indian Defense" },
    { moves: ["d4", "Nf6", "c4", "e6"], name: "Queen's Indian / Nimzo-Indian" },
    { moves: ["d4", "Nf6", "c4", "c5"], name: "Benoni Defense" },
    { moves: ["d4", "Nf6", "c4"], name: "Indian Game" },
    { moves: ["d4", "d5"], name: "Queen's Pawn Game" },

    { moves: ["Nf3", "d5", "c4"], name: "Réti Opening" },
    { moves: ["Nf3", "d5"], name: "Réti Opening" },
    { moves: ["c4"], name: "English Opening" },
];


/*
 * These are deliberately separate from the main opening names.
 *
 * They allow the page to say:
 *
 *   Position: 1. e4 e5
 *
 *   Named openings from here:
 *   Nf3  King's Knight Opening
 *   Nc3  Vienna Game
 *   Bc4  Bishop's Opening
 *   d4   Center Game
 *   f4   King's Gambit
 *
 * The database tree still determines which moves actually exist and
 * how frequently they occur.
 */
const NAMED_OPENINGS = OPENING_NAMES;


/* =========================================================================
   Helpers
   ========================================================================= */

function sameMoves(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    return a.every((move, index) => move === b[index]);
}


function openingNameText() {
    if (openingMoves.length === 0) {
        return "Starting position";
    }

    let best = null;

    for (const opening of OPENING_NAMES) {
        if (opening.moves.length > openingMoves.length) {
            continue;
        }

        if (!sameMoves(
            opening.moves,
            openingMoves.slice(0, opening.moves.length)
        )) {
            continue;
        }

        if (!best || opening.moves.length > best.moves.length) {
            best = opening;
        }
    }

    return best ? best.name : "Opening position";
}


function openingLineText() {
    if (openingMoves.length === 0) {
        return "Starting position";
    }

    return openingMoves.join(" ");
}


/* =========================================================================
   Opening matches
   ========================================================================= */

function renderOpeningMatches() {
    if (!openingMatches) {
        return;
    }

    openingMatches.innerHTML = "";

    /*
     * Find named openings that can be reached by continuing the current
     * position. Only show the immediate next move.
     */
    const matches = [];

    for (const opening of NAMED_OPENINGS) {
        if (opening.moves.length <= openingMoves.length) {
            continue;
        }

        if (!sameMoves(
            openingMoves,
            opening.moves.slice(0, openingMoves.length)
        )) {
            continue;
        }

        const nextMove = opening.moves[openingMoves.length];

        /*
         * Avoid showing duplicate move/name combinations.
         */
        if (matches.some(
            item => item.move === nextMove && item.name === opening.name
        )) {
            continue;
        }

        matches.push({
            move: nextMove,
            name: opening.name,
            moves: opening.moves
        });
    }

    /*
     * At the current exact position, also show the recognized opening.
     */
    const currentName = openingNameText();

    if (openingMoves.length > 0 && currentName !== "Opening position") {
        const current = document.createElement("div");
        current.className = "opening-match-current";

        current.innerHTML = `
            <span class="opening-match-label">Current opening</span>
            <strong>${escapeHtml(currentName)}</strong>
        `;

        openingMatches.appendChild(current);
    }

    if (matches.length === 0) {
        if (openingMoves.length === 0) {
            const empty = document.createElement("div");
            empty.className = "opening-match-empty";
            empty.textContent = "Play a move to see named openings.";
            openingMatches.appendChild(empty);
        }

        return;
    }

    const heading = document.createElement("div");
    heading.className = "opening-match-heading";
    heading.textContent =
        openingMoves.length === 0
            ? "Named openings"
            : "Named openings from this position";

    openingMatches.appendChild(heading);

    for (const match of matches) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "opening-match";

        row.innerHTML = `
            <span class="opening-match-move">
                ${escapeHtml(match.move)}
            </span>
            <span class="opening-match-name">
                ${escapeHtml(match.name)}
            </span>
        `;

        row.addEventListener("click", () => {
            playMove(match.move);
        });

        openingMatches.appendChild(row);
    }
}


function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* =========================================================================
   Chessboard
   ========================================================================= */

const PIECES = {
    w: {
        p: "♙",
        n: "♘",
        b: "♗",
        r: "♖",
        q: "♕",
        k: "♔",
    },
    b: {
        p: "♟",
        n: "♞",
        b: "♝",
        r: "♜",
        q: "♛",
        k: "♚",
    },
};


function squareName(file, rank) {
    return String.fromCharCode(97 + file) + (8 - rank);
}


function renderBoard() {
    if (!chessboard) {
        return;
    }

    chessboard.innerHTML = "";

    const board = chess.board();

    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const square = squareName(file, rank);
            const piece = board[rank][file];

            const element = document.createElement("button");

            element.type = "button";
            element.className =
                `chess-square ${(file + rank) % 2 === 0 ? "light" : "dark"}`;

            element.dataset.square = square;

            if (selectedSquare === square) {
                element.classList.add("selected");
            }

            if (legalTargets.includes(square)) {
                element.classList.add("legal-target");
            }

            if (piece) {
                const pieceElement = document.createElement("span");

                pieceElement.className =
                    `chess-piece ${piece.color === "w" ? "white" : "black"}`;

                pieceElement.textContent = PIECES[piece.color][piece.type];

                element.appendChild(pieceElement);
            }

            if (file === 0) {
                const rankLabel = document.createElement("span");
                rankLabel.className = "board-coordinate rank-coordinate";
                rankLabel.textContent = String(8 - rank);
                element.appendChild(rankLabel);
            }

            if (rank === 7) {
                const fileLabel = document.createElement("span");
                fileLabel.className = "board-coordinate file-coordinate";
                fileLabel.textContent =
                    String.fromCharCode(97 + file);
                element.appendChild(fileLabel);
            }

            element.addEventListener("click", () => {
                handleSquareClick(square);
            });

            chessboard.appendChild(element);
        }
    }

    updateBoardStatus();
}


function updateBoardStatus() {
    if (!boardStatus) {
        return;
    }

    if (chess.isCheckmate()) {
        boardStatus.textContent =
            chess.turn() === "w"
                ? "Checkmate — Black wins"
                : "Checkmate — White wins";
        return;
    }

    if (chess.isDraw()) {
        boardStatus.textContent = "Draw";
        return;
    }

    const side = chess.turn() === "w" ? "White" : "Black";

    boardStatus.textContent =
        `${side} to move${chess.inCheck() ? " — Check!" : ""}`;
}


function handleSquareClick(square) {
    /*
     * If we already selected a piece, first try to make a legal move.
     */
    if (selectedSquare) {
        if (legalTargets.includes(square)) {
            makeBoardMove(selectedSquare, square);
            return;
        }

        /*
         * Clicking another own piece changes the selection.
         */
        const piece = chess.get(square);

        if (piece && piece.color === chess.turn()) {
            selectSquare(square);
            return;
        }

        clearSelection();
        renderBoard();
        return;
    }

    const piece = chess.get(square);

    if (!piece || piece.color !== chess.turn()) {
        return;
    }

    selectSquare(square);
}


function selectSquare(square) {
    selectedSquare = square;

    const moves = chess.moves({
        square,
        verbose: true,
    });

    legalTargets = moves.map(move => move.to);

    renderBoard();
}


function clearSelection() {
    selectedSquare = null;
    legalTargets = [];
}


function makeBoardMove(from, to) {
    const candidates = chess.moves({
        square: from,
        verbose: true,
    }).filter(move => move.to === to);

    if (candidates.length === 0) {
        return;
    }

    const candidate = candidates[0];

    let promotion = candidate.promotion;

    if (candidate.promotion) {
        const answer = window.prompt(
            "Promote to: queen, rook, bishop or knight",
            "queen"
        );

        const promotionMap = {
            queen: "q",
            rook: "r",
            bishop: "b",
            knight: "n",
            q: "q",
            r: "r",
            b: "b",
            n: "n",
        };

        promotion = promotionMap[
            String(answer || "q").trim().toLowerCase()
        ] || "q";
    }

    try {
        if (promotion) {
            chess.move({
                from,
                to,
                promotion,
            });
        } else {
            chess.move({
                from,
                to,
            });
        }
    } catch (error) {
        console.error("Chess move failed:", error);
        return;
    }

    openingMoves = chess.history();

    clearSelection();
    renderBoard();
    updateOpeningHeader();
    renderOpeningMatches();
    loadOpeningTree();
}


function playMove(san) {
    try {
        chess.move(san);
    } catch (error) {
        console.error("Opening move failed:", san, error);
        return;
    }

    openingMoves = chess.history();

    clearSelection();
    renderBoard();
    updateOpeningHeader();
    renderOpeningMatches();
    loadOpeningTree();
}


function rebuildBoardFromOpeningMoves() {
    chess = new Chess();

    for (const move of openingMoves) {
        try {
            chess.move(move);
        } catch (error) {
            console.error(
                "Could not rebuild chess position from move:",
                move,
                error
            );

            openingMoves = chess.history();
            break;
        }
    }

    clearSelection();
    renderBoard();
    updateOpeningHeader();
    renderOpeningMatches();
}


/* =========================================================================
   Header
   ========================================================================= */

function updateOpeningHeader() {
    if (openingName) {
        openingName.textContent = openingNameText();
    }

    if (openingLine) {
        openingLine.textContent = openingLineText();
    }

    if (openingBack) {
        openingBack.disabled = openingMoves.length === 0;
    }
}


/* =========================================================================
   Opening tree
   ========================================================================= */

function renderOpeningTree(tree) {
    openingTree.innerHTML = "";

    if (!tree || tree.length === 0) {
        const empty = document.createElement("div");
        empty.className = "opening-empty";
        empty.textContent = "No opening moves found.";
        openingTree.appendChild(empty);
        return;
    }

    const header = document.createElement("div");
    header.className = "openings-tree-header";

    header.innerHTML = `
        <span>Move</span>
        <span>Games</span>
        <span>Freq.</span>
        <span>Score</span>
    `;

    openingTree.appendChild(header);

    for (const row of tree) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "opening-move";

        button.innerHTML = `
            <span class="opening-move-name">
                ${escapeHtml(row.move)}
            </span>

            <span class="opening-move-games">
                ${Number(row.games).toLocaleString()}
            </span>

            <span class="opening-move-frequency">
                ${escapeHtml(String(row.frequency))}%
            </span>

            <span class="opening-move-score">
                ${escapeHtml(String(row.score))}%
            </span>
        `;

        button.addEventListener("click", () => {
            playMove(row.move);
        });

        openingTree.appendChild(button);
    }
}


async function loadOpeningTree() {
    if (!currentDatabase) {
        return;
    }

    const requestId = ++openingRequestId;

    openingTree.innerHTML = `
        <div class="opening-loading">
            Loading opening explorer...
        </div>
    `;

    const params = new URLSearchParams();

    if (openingMoves.length > 0) {
        params.set("moves", openingMoves.join(" "));
    }

    const query = params.toString();

    const url =
        `/api/databases/${encodeURIComponent(currentDatabase)}` +
        `/opening-tree${query ? `?${query}` : ""}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `Opening tree request failed: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        if (requestId !== openingRequestId) {
            return;
        }

        renderOpeningTree(data.tree || []);
    } catch (error) {
        if (requestId !== openingRequestId) {
            return;
        }

        console.error(error);

        openingTree.innerHTML = `
            <div class="opening-error">
                Could not load the opening explorer.
                <br>
                ${escapeHtml(error.message)}
            </div>
        `;
    }
}


/* =========================================================================
   Databases
   ========================================================================= */

async function loadDatabases() {
    databaseSelect.innerHTML = `
        <option value="">Loading databases...</option>
    `;

    try {
        const response = await fetch("/api/databases");

        if (!response.ok) {
            throw new Error(
                `Database request failed: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        const databases =
            Array.isArray(data)
                ? data
                : (data.databases || []);

        databaseSelect.innerHTML = "";

        for (const database of databases) {
            const option = document.createElement("option");

            const name =
                typeof database === "string"
                    ? database
                    : database.name;

            option.value = name;
            option.textContent = name;

            databaseSelect.appendChild(option);
        }

        if (databases.length === 0) {
            throw new Error("No databases available");
        }

        currentDatabase = databaseSelect.value;

        await loadOpeningTree();
    } catch (error) {
        console.error(error);

        databaseSelect.innerHTML = `
            <option value="">Could not load databases</option>
        `;
    }
}


/* =========================================================================
   Controls
   ========================================================================= */

openingBack.addEventListener("click", () => {
    if (openingMoves.length === 0) {
        return;
    }

    openingMoves.pop();

    rebuildBoardFromOpeningMoves();
    loadOpeningTree();
});


openingReset.addEventListener("click", () => {
    openingMoves = [];

    rebuildBoardFromOpeningMoves();
    loadOpeningTree();
});


openingRefresh.addEventListener("click", () => {
    loadOpeningTree();
});


databaseSelect.addEventListener("change", () => {
    currentDatabase = databaseSelect.value;

    openingMoves = [];

    rebuildBoardFromOpeningMoves();
    loadOpeningTree();
});


/* =========================================================================
   Initialisation
   ========================================================================= */

renderBoard();
updateOpeningHeader();
renderOpeningMatches();
loadDatabases();
