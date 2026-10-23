import React, { useCallback, useEffect, useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import styles from "../styles/collaborativeWhiteboard.module.css";

const drawStroke = (context, stroke, width, height) => {
    if (!stroke.points?.length) return;
    context.save();
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    stroke.points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height));
    if (stroke.points.length === 1) {
        context.lineTo(stroke.points[0].x * width + 0.01, stroke.points[0].y * height + 0.01);
    }
    context.stroke();
    context.restore();
};

export default function CollaborativeWhiteboard({ socket, open, onClose }) {
    const canvasRef = useRef(null);
    const strokesRef = useRef([]);
    const currentStrokeRef = useRef(null);
    const lastSentAtRef = useRef(0);
    const [strokes, setStrokes] = useState([]);
    const [redoStrokes, setRedoStrokes] = useState([]);
    const [tool, setTool] = useState("pen");
    const [color, setColor] = useState("#465cff");
    const [brushSize, setBrushSize] = useState(4);

    const updateStrokes = useCallback((update) => {
        setStrokes((previous) => {
            const next = typeof update === "function" ? update(previous) : update;
            strokesRef.current = next;
            return next;
        });
    }, []);

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const pixelRatio = window.devicePixelRatio || 1;
        const width = Math.round(rect.width * pixelRatio);
        const height = Math.round(rect.height * pixelRatio);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const context = canvas.getContext("2d");
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);
        strokesRef.current.forEach((stroke) => drawStroke(context, stroke, rect.width, rect.height));
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        redrawCanvas();
        const observer = new ResizeObserver(redrawCanvas);
        if (canvasRef.current) observer.observe(canvasRef.current);
        return () => observer.disconnect();
    }, [open, redrawCanvas, strokes]);

    useEffect(() => {
        if (!open || !socket) return undefined;
        const handleState = (boardStrokes) => {
            currentStrokeRef.current = null;
            setRedoStrokes([]);
            updateStrokes(Array.isArray(boardStrokes) ? boardStrokes : []);
        };
        const handleOperation = (operation) => {
            if (!operation || typeof operation !== "object") return;
            if (operation.type === "stroke-start" && operation.stroke) {
                updateStrokes((previous) => [...previous, operation.stroke]);
            } else if (operation.type === "stroke-points" && Array.isArray(operation.points)) {
                updateStrokes((previous) => previous.map((stroke) =>
                    stroke.id === operation.id
                        ? { ...stroke, points: [...stroke.points, ...operation.points] }
                        : stroke
                ));
            } else if (operation.type === "stroke-end") {
                updateStrokes((previous) => previous.map((stroke) =>
                    stroke.id === operation.id ? { ...stroke, complete: true } : stroke
                ));
            } else if (operation.type === "undo") {
                const removed = strokesRef.current.find((stroke) => stroke.id === operation.id);
                if (removed) setRedoStrokes((previous) => [...previous, removed]);
                updateStrokes((previous) => previous.filter((stroke) => stroke.id !== operation.id));
            } else if (operation.type === "redo" && operation.stroke) {
                setRedoStrokes((previous) => previous.filter((stroke) => stroke.id !== operation.stroke.id));
                updateStrokes((previous) => [...previous, operation.stroke]);
            } else if (operation.type === "clear") {
                currentStrokeRef.current = null;
                setRedoStrokes([]);
                updateStrokes([]);
            } else if (operation.type === "redo-clear") {
                setRedoStrokes([]);
            } else if (operation.type === "trim") {
                updateStrokes((previous) => previous.filter((stroke) => stroke.id !== operation.id));
            }
        };
        socket.on("whiteboard-state", handleState);
        socket.on("whiteboard-operation", handleOperation);
        socket.emit("whiteboard-join");
        return () => {
            socket.off("whiteboard-state", handleState);
            socket.off("whiteboard-operation", handleOperation);
        };
    }, [open, socket, updateStrokes]);

    const getPoint = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
    };

    const startStroke = (event) => {
        if (!socket || !canvasRef.current) return;
        event.preventDefault();
        canvasRef.current.setPointerCapture(event.pointerId);
        const point = getPoint(event);
        const stroke = {
            id: `${socket.id}:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            points: [point],
            sentPoints: 1,
            color,
            size: brushSize,
            tool,
            complete: false,
        };
        currentStrokeRef.current = stroke;
        lastSentAtRef.current = Date.now();
        updateStrokes((previous) => [...previous, stroke]);
        socket.emit("whiteboard-event", {
            type: "stroke-start",
            id: stroke.id,
            point,
            color,
            size: brushSize,
            tool,
        });
    };

    const continueStroke = (event) => {
        const stroke = currentStrokeRef.current;
        if (!stroke) return;
        event.preventDefault();
        const point = getPoint(event);
        if (stroke.points.length >= 1000) return;
        stroke.points.push(point);
        updateStrokes((previous) => previous.map((item) =>
            item.id === stroke.id ? { ...item, points: [...stroke.points] } : item
        ));
        if (Date.now() - lastSentAtRef.current >= 24) {
            const unsentPoints = stroke.points.slice(stroke.sentPoints);
            if (!unsentPoints.length) return;
            socket.emit("whiteboard-event", {
                type: "stroke-points",
                id: stroke.id,
                points: unsentPoints,
            });
            stroke.sentPoints = stroke.points.length;
            lastSentAtRef.current = Date.now();
        }
    };

    const finishStroke = () => {
        const stroke = currentStrokeRef.current;
        if (!stroke) return;
        stroke.complete = true;
        const unsentPoints = stroke.points.slice(stroke.sentPoints);
        if (unsentPoints.length) {
            socket.emit("whiteboard-event", {
                type: "stroke-points",
                id: stroke.id,
                points: unsentPoints,
            });
        }
        socket.emit("whiteboard-event", { type: "stroke-end", id: stroke.id });
        currentStrokeRef.current = null;
        updateStrokes((previous) => {
            const completed = previous.map((item) =>
                item.id === stroke.id ? { ...item, complete: true } : item
            );
            return completed.length > 250 ? completed.slice(completed.length - 250) : completed;
        });
        setRedoStrokes([]);
    };

    const undo = () => {
        if (!socket) return;
        socket.emit("whiteboard-event", { type: "undo" });
    };

    const redo = () => {
        if (!socket) return;
        socket.emit("whiteboard-event", { type: "redo" });
    };

    const clear = () => {
        if (strokesRef.current.length && window.confirm("Clear the shared whiteboard for everyone?")) {
            socket?.emit("whiteboard-event", { type: "clear" });
        }
    };

    if (!open) return null;

    return (
        <div className={styles.backdrop} role="presentation">
            <section className={styles.panel} role="dialog" aria-modal="true" aria-label="Collaborative whiteboard">
                <header className={styles.header}>
                    <div>
                        <p>MEETING COLLABORATION</p>
                        <h2>Whiteboard</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close whiteboard">
                        <CloseIcon />
                    </button>
                </header>
                <div className={styles.toolbar}>
                    <button type="button" className={tool === "pen" ? styles.selectedTool : ""} onClick={() => setTool("pen")}>Pen</button>
                    <button type="button" className={tool === "eraser" ? styles.selectedTool : ""} onClick={() => setTool("eraser")}>Eraser</button>
                    <label className={styles.colorControl}>
                        Color
                        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={tool === "eraser"} />
                    </label>
                    <label className={styles.sizeControl}>
                        Size
                        <input type="range" min="1" max="20" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
                    </label>
                    <button type="button" onClick={undo} disabled={!strokes.length} aria-label="Undo">
                        <UndoIcon fontSize="small" />
                    </button>
                    <button type="button" onClick={redo} disabled={!redoStrokes.length} aria-label="Redo">
                        <RedoIcon fontSize="small" />
                    </button>
                    <button type="button" onClick={clear} disabled={!strokes.length} aria-label="Clear whiteboard">
                        <DeleteOutlineIcon fontSize="small" />
                    </button>
                </div>
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    onPointerDown={startStroke}
                    onPointerMove={continueStroke}
                    onPointerUp={finishStroke}
                    onPointerCancel={finishStroke}
                    aria-label="Shared drawing canvas"
                />
            </section>
        </div>
    );
}
