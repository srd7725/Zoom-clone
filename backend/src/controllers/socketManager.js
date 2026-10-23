import { Server } from "socket.io";
import { Meeting } from "../models/meeting.model.js";
import { User } from "../models/user.model.js";

const rooms = {};
const roomUsers = {};
const roomMessages = {};
const roomWaiting = {};
const roomHosts = {};
const userRooms = {};
const breakoutSessions = {};
const whiteboardStates = {};
const whiteboardRateLimits = {};

const normalizePath = (path) => {
    if (!path) return "";

    let normalized = path;
    try {
        const parsed = new URL(path);
        normalized = parsed.pathname;
    } catch (error) {
        normalized = path.split("?")[0].split("#")[0];
    }

    const cleaned = normalized.replace(/^\/+|\/+$/g, "");
    if (!cleaned) return "";

    const parts = cleaned.split("/");
    return parts[parts.length - 1] || "";
};

const getRoomInfo = (roomName) => {
    if (!rooms[roomName]) rooms[roomName] = [];
    if (!roomUsers[roomName]) roomUsers[roomName] = {};
    if (!roomMessages[roomName]) roomMessages[roomName] = [];
    if (!roomWaiting[roomName]) roomWaiting[roomName] = [];
    if (!breakoutSessions[roomName]) {
        breakoutSessions[roomName] = { active: false, rooms: {}, assignments: {} };
    }
    return { roomName };
};

const getBreakoutChannel = (meetingCode, breakoutId) => `${meetingCode}::breakout::${breakoutId}`;

const getActiveChannel = (meetingCode, socketId) => {
    const session = breakoutSessions[meetingCode];
    const breakoutId = session?.active ? session.assignments[socketId] : null;
    return breakoutId && session.rooms[breakoutId]
        ? getBreakoutChannel(meetingCode, breakoutId)
        : meetingCode;
};

const syncMeetingWithSocketState = async (roomName, update) => {
    if (!roomName) return;
    try {
        await Meeting.updateOne({ meetingCode: roomName }, update, { runValidators: true });
    } catch (error) {
        console.log(error);
    }
};

const getActiveParticipants = (roomName) => {
    const state = roomUsers[roomName] || {};
    const activeSockets = rooms[roomName] || [];
    return Object.values(state).filter(user => activeSockets.includes(user.socketId));
};

const emitParticipants = (io, roomName) => {
    const activeParticipants = getActiveParticipants(roomName);
    const session = breakoutSessions[roomName];
    const mainParticipants = activeParticipants.filter((participant) =>
        !session?.active || !session.assignments[participant.socketId]
    );
    io.to(roomName).emit("participants-updated", mainParticipants);
    if (roomHosts[roomName]) {
        io.to(roomHosts[roomName]).emit("participants-updated", activeParticipants);
    }
    if (session?.active) {
        Object.keys(session.rooms).forEach((breakoutId) => {
            const roomParticipants = activeParticipants.filter(
                (participant) => session.assignments[participant.socketId] === breakoutId
            );
            io.to(getBreakoutChannel(roomName, breakoutId)).emit("participants-updated", roomParticipants);
        });
    }
};

const notifyPeerConnections = (io, channel, joiningSocketId) => {
    const joiningParticipant = [...io.sockets.adapter.rooms.get(channel) || []]
        .map((socketId) => roomUsers[userRooms[socketId]]?.[socketId])
        .find((participant) => participant?.socketId === joiningSocketId);
    if (!joiningParticipant) return;

    for (const socketId of io.sockets.adapter.rooms.get(channel) || []) {
        if (socketId === joiningSocketId) continue;
        const participant = roomUsers[userRooms[socketId]]?.[socketId];
        if (!participant) continue;
        io.to(socketId).emit("user-connected", {
            ...joiningParticipant,
            shouldInitiate: socketId < joiningSocketId,
        });
        io.to(joiningSocketId).emit("user-connected", {
            ...participant,
            shouldInitiate: joiningSocketId < socketId,
        });
    }
};

const getWhiteboardState = (channel) => {
    if (!whiteboardStates[channel]) {
        whiteboardStates[channel] = { strokes: [], redo: [], active: {} };
    }
    return whiteboardStates[channel];
};

const isValidWhiteboardPoint = (point) =>
    point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

const moveParticipantToBreakout = (io, meetingCode, socketId, breakoutId) => {
    const participant = roomUsers[meetingCode]?.[socketId];
    const participantSocket = io.sockets.sockets.get(socketId);
    if (!participant || !participantSocket) return false;

    const session = breakoutSessions[meetingCode];
    if (breakoutId && !session.rooms[breakoutId]) return false;
    const newChannel = breakoutId ? getBreakoutChannel(meetingCode, breakoutId) : meetingCode;
    const oldChannel = [meetingCode, ...Object.keys(session.rooms).map((id) => getBreakoutChannel(meetingCode, id))]
        .find((channel) => participantSocket.rooms.has(channel)) || meetingCode;
    if (oldChannel === newChannel) return true;

    io.to(oldChannel).emit("user-disconnected", { socketId });
    participantSocket.leave(oldChannel);
    if (breakoutId) {
        session.assignments[socketId] = breakoutId;
        participant.roomId = breakoutId;
    } else {
        delete session.assignments[socketId];
        delete participant.roomId;
    }
    participantSocket.join(newChannel);
    participantSocket.emit("breakout-room-changed", breakoutId
        ? { id: breakoutId, name: session.rooms[breakoutId] }
        : null
    );
    (roomMessages[newChannel] || []).forEach((message) => {
        participantSocket.emit("chat-message", message.data, message.sender, message.socketId);
    });
    notifyPeerConnections(io, newChannel, socketId);
    emitParticipants(io, meetingCode);
    return true;
};

export const connectToSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        console.log("SOMETHING CONNECTED:", socket.id);

        socket.on("join-room", async ({ roomName, username, isHost, isVideoOn, isAudioOn, token }, acknowledge) => {
            const room = normalizePath(roomName);
            if (!room || typeof username !== "string" || username.trim().length < 1 || username.length > 80) {
                acknowledge?.({ ok: false, message: "Invalid meeting or participant details." });
                return;
            }
            let authorizedHost = false;
            if (isHost === true) {
                let meeting;
                let user;
                try {
                    [meeting, user] = await Promise.all([
                        Meeting.findOne({ meetingCode: room, isActive: true }),
                        token ? User.findOne({ token }) : null,
                    ]);
                } catch (error) {
                    console.error("Unable to verify meeting host:", error);
                    acknowledge?.({ ok: false, message: "Unable to verify host permissions right now." });
                    return;
                }
                authorizedHost = Boolean(
                    meeting && user && (
                        meeting.hostId?.toString() === user._id.toString() ||
                        (!meeting.hostId && meeting.user_id === user.username)
                    )
                );
                if (!authorizedHost) {
                    acknowledge?.({ ok: false, message: "Only the meeting owner can join as host." });
                    return;
                }
            }
            getRoomInfo(room);
            const roomSockets = rooms[room];
            const roomState = roomUsers[room];
            const waitingRoom = roomWaiting[room];

            userRooms[socket.id] = room;
            roomState[socket.id] = { 
                socketId: socket.id, 
                username: username.trim(),
                isHost: authorizedHost,
                joinedAt: new Date(),
                isVideoOn: isVideoOn !== undefined ? isVideoOn : true,
                isAudioOn: isAudioOn !== undefined ? isAudioOn : true,
                canUseMic: true,
                canUseCamera: true
            };

            if (authorizedHost) {
                roomHosts[room] = socket.id;
                // Emit current waiting room list to the host on connect
                socket.emit("waiting-room-list", waitingRoom.map(entry => ({
                    socketId: entry.socketId,
                    username: entry.username,
                    joinedAt: entry.joinedAt || entry.requestedAt || new Date()
                })));
                
                const pendingGuests = waitingRoom.filter((entry) => entry.socketId);
                pendingGuests.forEach((entry) => {
                    io.to(socket.id).emit("waiting-room-request", { 
                        socketId: entry.socketId, 
                        username: entry.username,
                        joinedAt: entry.joinedAt || entry.requestedAt || new Date()
                    });
                });
            }

            if (!authorizedHost) {
                if (!waitingRoom.some((entry) => entry.socketId === socket.id)) {
                    waitingRoom.push({ socketId: socket.id, username, joinedAt: new Date() });
                }
                await syncMeetingWithSocketState(room, {
                    $set: { waitingRoom: waitingRoom.filter((entry) => entry.socketId !== undefined) }
                });
                if (roomHosts[room] && roomHosts[room] !== socket.id) {
                    io.to(roomHosts[room]).emit("waiting-room-request", { 
                        socketId: socket.id, 
                        username,
                        joinedAt: new Date()
                    });
                }
                socket.emit("waiting-room-status", { message: "Waiting for host to admit you." });
                acknowledge?.({ ok: true, waiting: true });
                return; // Enforce waiting room logic
            }

            if (!roomSockets.includes(socket.id)) {
                roomSockets.push(socket.id);
            }

            socket.join(room);
            await syncMeetingWithSocketState(room, {
                $set: {
                    waitingRoom: (roomWaiting[room] || []).filter((entry) => entry.socketId !== socket.id)
                },
                $addToSet: {
                    participants: { socketId: socket.id, username, joinedAt: new Date() }
                }
            });
            notifyPeerConnections(io, room, socket.id);
            emitParticipants(io, room);

            roomMessages[room].forEach((message) => {
                socket.emit("chat-message", message.data, message.sender, message.socketId);
            });
            socket.emit("breakout-state", authorizedHost
                ? { active: breakoutSessions[room].active, rooms: breakoutSessions[room].rooms, assignments: breakoutSessions[room].assignments }
                : { active: breakoutSessions[room].active, currentRoom: null });
            acknowledge?.({ ok: true, waiting: false });
        });

        socket.on("admit-participant", async (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;

            roomWaiting[room] = roomWaiting[room].filter((entry) => entry.socketId !== participantSocketId);
            const participant = roomUsers[room]?.[participantSocketId];
            if (!participant) return;

            const roomSockets = rooms[room] || [];
            if (!roomSockets.includes(participantSocketId)) {
                roomSockets.push(participantSocketId);
            }

            await syncMeetingWithSocketState(room, {
                $set: {
                    waitingRoom: (roomWaiting[room] || []).filter((entry) => entry.socketId !== participantSocketId)
                },
                $addToSet: {
                    participants: { socketId: participantSocketId, username: participant.username, joinedAt: new Date() }
                }
            });

            io.sockets.sockets.get(participantSocketId)?.join(room);
            io.to(participantSocketId).emit("admitted");
            io.to(participantSocketId).emit("participant-admitted");
            io.to(participantSocketId).emit("breakout-state", {
                active: breakoutSessions[room].active,
                currentRoom: null,
            });
            emitParticipants(io, room);
            notifyPeerConnections(io, room, participantSocketId);
            
            // Send existing chat messages to newly admitted user
            const messages = roomMessages[room] || [];
            messages.forEach((message) => {
                io.to(participantSocketId).emit("chat-message", message.data, message.sender, message.socketId);
            });
        });

        socket.on("breakout-create", (payload, acknowledge) => {
            const room = userRooms[socket.id];
            const session = breakoutSessions[room];
            if (!room || roomHosts[room] !== socket.id || !payload || !Array.isArray(payload.rooms)) {
                acknowledge?.({ ok: false, message: "Only the meeting host can create breakout rooms." });
                return;
            }
            const names = payload.rooms
                .filter((name) => typeof name === "string")
                .map((name) => name.trim())
                .filter(Boolean);
            if (
                names.length < 2 || names.length > 8 || names.some((name) => name.length > 40) ||
                new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
                !["auto", "manual"].includes(payload.mode)
            ) {
                acknowledge?.({ ok: false, message: "Choose between 2 and 8 room names, each under 40 characters." });
                return;
            }
            const activeParticipants = getActiveParticipants(room).filter(
                (participant) => !participant.isHost && participant.socketId !== socket.id
            );
            const roomsById = Object.fromEntries(names.map((name, index) => [`room-${index + 1}`, name]));
            const requestedAssignments = payload.assignments && typeof payload.assignments === "object"
                ? payload.assignments
                : {};
            if (payload.mode === "manual" && Object.entries(requestedAssignments).some(([participantId, breakoutId]) =>
                !activeParticipants.some((participant) => participant.socketId === participantId) ||
                !Object.hasOwn(roomsById, breakoutId)
            )) {
                acknowledge?.({ ok: false, message: "A participant or breakout room selection is invalid." });
                return;
            }

            if (session.active) {
                Object.keys(session.assignments).forEach((participantId) => {
                    moveParticipantToBreakout(io, room, participantId, null);
                });
            }
            Object.keys(session.rooms).forEach((breakoutId) => {
                const channel = getBreakoutChannel(room, breakoutId);
                delete roomMessages[channel];
                delete whiteboardStates[channel];
            });
            session.active = false;
            session.rooms = roomsById;
            session.assignments = {};
            if (payload.mode === "auto") {
                activeParticipants.forEach((participant, index) => {
                    session.assignments[participant.socketId] = `room-${index % names.length + 1}`;
                });
            } else {
                for (const [participantId, breakoutId] of Object.entries(requestedAssignments)) {
                    session.assignments[participantId] = breakoutId;
                }
            }

            session.active = true;
            Object.entries(session.assignments).forEach(([participantId, breakoutId]) => {
                moveParticipantToBreakout(io, room, participantId, breakoutId);
            });
            const state = { active: true, rooms: session.rooms, assignments: session.assignments };
            io.to(socket.id).emit("breakout-state", state);
            acknowledge?.({ ok: true, state });
        });

        socket.on("breakout-assign", (payload, acknowledge) => {
            const room = userRooms[socket.id];
            const session = breakoutSessions[room];
            if (roomHosts[room] !== socket.id || !session?.active || !payload || typeof payload.socketId !== "string") {
                acknowledge?.({ ok: false, message: "Only the host can change breakout assignments." });
                return;
            }
            const participant = roomUsers[room]?.[payload.socketId];
            if (!participant || participant.isHost || !rooms[room]?.includes(payload.socketId)) {
                acknowledge?.({ ok: false, message: "That participant is not available to assign." });
                return;
            }
            if (payload.roomId && !Object.hasOwn(session.rooms, payload.roomId)) {
                acknowledge?.({ ok: false, message: "That breakout room does not exist." });
                return;
            }
            if (!moveParticipantToBreakout(io, room, payload.socketId, payload.roomId || null)) {
                acknowledge?.({ ok: false, message: "The participant could not be moved." });
                return;
            }
            const state = { active: true, rooms: session.rooms, assignments: session.assignments };
            io.to(socket.id).emit("breakout-state", state);
            acknowledge?.({ ok: true, state });
        });

        socket.on("breakout-close", (roomName, acknowledge) => {
            const room = normalizePath(roomName);
            const session = breakoutSessions[room];
            if (roomHosts[room] !== socket.id || !session?.active) {
                acknowledge?.({ ok: false, message: "Only the host can close breakout rooms." });
                return;
            }
            Object.keys(session.assignments).forEach((participantId) => {
                moveParticipantToBreakout(io, room, participantId, null);
            });
            Object.keys(session.rooms).forEach((breakoutId) => {
                const channel = getBreakoutChannel(room, breakoutId);
                delete roomMessages[channel];
                delete whiteboardStates[channel];
            });
            session.active = false;
            session.rooms = {};
            session.assignments = {};
            io.to(room).emit("breakout-state", { active: false, rooms: {}, assignments: {} });
            acknowledge?.({ ok: true });
        });

        socket.on("reject-participant", async (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            roomWaiting[room] = roomWaiting[room].filter((entry) => entry.socketId !== participantSocketId);
            await syncMeetingWithSocketState(room, {
                $set: {
                    waitingRoom: (roomWaiting[room] || []).filter((entry) => entry.socketId !== participantSocketId)
                }
            });
            io.to(participantSocketId).emit("rejected");
            io.to(participantSocketId).emit("participant-rejected");
        });

        // Host control events
        socket.on("mute-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseMic = false;
                participant.isAudioOn = false;
                emitParticipants(io, room);
                io.to(participantSocketId).emit("participant-muted");
            }
        });

        socket.on("allow-mic-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseMic = true;
                emitParticipants(io, room);
                io.to(participantSocketId).emit("participant-unmuted");
            }
        });

        socket.on("stop-camera-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseCamera = false;
                participant.isVideoOn = false;
                emitParticipants(io, room);
                io.to(participantSocketId).emit("participant-camera-disabled");
            }
        });

        socket.on("allow-camera-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseCamera = true;
                emitParticipants(io, room);
                io.to(participantSocketId).emit("participant-camera-enabled");
            }
        });

        socket.on("mute-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseMic = false;
                participant.isAudioOn = false;
                io.to(participant.socketId).emit("participant-muted");
            });
            emitParticipants(io, room);
        });

        socket.on("allow-mic-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseMic = true;
                io.to(participant.socketId).emit("participant-unmuted");
            });
            emitParticipants(io, room);
        });

        socket.on("stop-camera-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseCamera = false;
                participant.isVideoOn = false;
                io.to(participant.socketId).emit("participant-camera-disabled");
            });
            emitParticipants(io, room);
        });

        socket.on("allow-camera-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseCamera = true;
                io.to(participant.socketId).emit("participant-camera-enabled");
            });
            emitParticipants(io, room);
        });

        // Client media update events
        socket.on("participant-muted", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                user.isAudioOn = false;
                emitParticipants(io, room);
            }
        });

        socket.on("participant-unmuted", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                if (user.canUseMic !== false) {
                    user.isAudioOn = true;
                    emitParticipants(io, room);
                } else {
                    socket.emit("participant-muted");
                }
            }
        });

        socket.on("participant-camera-disabled", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                user.isVideoOn = false;
                emitParticipants(io, room);
            }
        });

        socket.on("participant-camera-enabled", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                if (user.canUseCamera !== false) {
                    user.isVideoOn = true;
                    emitParticipants(io, room);
                } else {
                    socket.emit("participant-camera-disabled");
                }
            }
        });

        socket.on("offer", (payload) => {
            const room = userRooms[socket.id];
            if (!room || !payload || typeof payload.target !== "string" ||
                !payload.sdp || payload.sdp.type !== "offer" || typeof payload.sdp.sdp !== "string" || payload.sdp.sdp.length > 100000 ||
                !(rooms[room] || []).includes(socket.id) ||
                !(rooms[room] || []).includes(payload.target)) return;
            const channel = getActiveChannel(room, socket.id);
            if (getActiveChannel(room, payload.target) !== channel ||
                !io.sockets.sockets.get(payload.target)?.rooms.has(channel)) return;
            io.to(payload.target).emit("offer", { ...payload, sender: socket.id });
        });

        socket.on("answer", (payload) => {
            const room = userRooms[socket.id];
            if (!room || !payload || typeof payload.target !== "string" ||
                !payload.sdp || payload.sdp.type !== "answer" || typeof payload.sdp.sdp !== "string" || payload.sdp.sdp.length > 100000 ||
                !(rooms[room] || []).includes(socket.id) ||
                !(rooms[room] || []).includes(payload.target)) return;
            const channel = getActiveChannel(room, socket.id);
            if (getActiveChannel(room, payload.target) !== channel ||
                !io.sockets.sockets.get(payload.target)?.rooms.has(channel)) return;
            io.to(payload.target).emit("answer", { ...payload, sender: socket.id });
        });

        socket.on("ice-candidate", (payload) => {
            const room = userRooms[socket.id];
            if (!room || !payload || typeof payload.target !== "string" ||
                !payload.candidate || typeof payload.candidate.candidate !== "string" ||
                payload.candidate.candidate.length > 4096 ||
                !(rooms[room] || []).includes(socket.id) ||
                !(rooms[room] || []).includes(payload.target)) return;
            const channel = getActiveChannel(room, socket.id);
            if (getActiveChannel(room, payload.target) !== channel ||
                !io.sockets.sockets.get(payload.target)?.rooms.has(channel)) return;
            io.to(payload.target).emit("ice-candidate", { ...payload, sender: socket.id });
        });

        socket.on("chat-message", (data, sender) => {
            const room = userRooms[socket.id];
            if (!room || typeof data !== "string" || !data.trim() || data.length > 4000 ||
                !(rooms[room] || []).includes(socket.id)) return;
            const channel = getActiveChannel(room, socket.id);
            if (!io.sockets.sockets.get(socket.id)?.rooms.has(channel)) return;
            const messageEntry = { data: data.trim(), sender: roomUsers[room]?.[socket.id]?.username || "Guest", socketId: socket.id };
            roomMessages[channel] = roomMessages[channel] || [];
            roomMessages[channel].push(messageEntry);
            if (roomMessages[channel].length > 500) roomMessages[channel].shift();
            io.to(channel).emit("chat-message", messageEntry.data, messageEntry.sender, socket.id);
        });

        socket.on("whiteboard-join", () => {
            const room = userRooms[socket.id];
            if (!room || !(rooms[room] || []).includes(socket.id)) return;
            const channel = getActiveChannel(room, socket.id);
            if (!io.sockets.sockets.get(socket.id)?.rooms.has(channel)) return;
            socket.emit("whiteboard-state", getWhiteboardState(channel).strokes);
        });

        socket.on("whiteboard-event", (payload) => {
            const room = userRooms[socket.id];
            if (!room || !(rooms[room] || []).includes(socket.id) || !payload || typeof payload.type !== "string") return;
            const channel = getActiveChannel(room, socket.id);
            if (!io.sockets.sockets.get(socket.id)?.rooms.has(channel)) return;
            const now = Date.now();
            const limit = whiteboardRateLimits[socket.id] || { windowStart: now, events: 0 };
            if (now - limit.windowStart >= 1000) {
                limit.windowStart = now;
                limit.events = 0;
            }
            limit.events += 1;
            whiteboardRateLimits[socket.id] = limit;
            if (limit.events > 120) return;
            const state = getWhiteboardState(channel);
            if (payload.type === "stroke-start") {
                if (
                    typeof payload.id !== "string" || !payload.id.startsWith(`${socket.id}:`) ||
                    payload.id.length > 128 || !isValidWhiteboardPoint(payload.point) ||
                    !/^#[0-9a-f]{6}$/i.test(payload.color) ||
                    !Number.isFinite(payload.size) || payload.size < 1 || payload.size > 40 ||
                    !["pen", "eraser"].includes(payload.tool) ||
                    Object.keys(state.active).length >= 100
                ) return;
                const stroke = {
                    id: payload.id,
                    points: [payload.point],
                    color: payload.color,
                    size: payload.size,
                    tool: payload.tool,
                    complete: false,
                };
                state.active[payload.id] = { stroke, owner: socket.id };
                socket.to(channel).emit("whiteboard-operation", { type: "stroke-start", stroke });
            } else if (payload.type === "stroke-points") {
                const active = state.active[payload.id];
                if (
                    !active || active.owner !== socket.id ||
                    !Array.isArray(payload.points) || payload.points.length > 32 ||
                    !payload.points.every(isValidWhiteboardPoint) ||
                    active.stroke.points.length + payload.points.length > 1000
                ) return;
                active.stroke.points.push(...payload.points);
                socket.to(channel).emit("whiteboard-operation", {
                    type: "stroke-points",
                    id: payload.id,
                    points: payload.points,
                });
            } else if (payload.type === "stroke-end") {
                const active = state.active[payload.id];
                if (!active || active.owner !== socket.id) return;
                active.stroke.complete = true;
                state.strokes.push(active.stroke);
                if (state.strokes.length > 250) {
                    const removedStroke = state.strokes.shift();
                    socket.to(channel).emit("whiteboard-operation", { type: "trim", id: removedStroke.id });
                }
                state.redo = [];
                delete state.active[payload.id];
                socket.to(channel).emit("whiteboard-operation", { type: "redo-clear" });
                socket.to(channel).emit("whiteboard-operation", { type: "stroke-end", id: payload.id });
            } else if (payload.type === "undo") {
                const stroke = state.strokes.pop();
                if (!stroke) return;
                state.redo.push(stroke);
                io.to(channel).emit("whiteboard-operation", { type: "undo", id: stroke.id });
            } else if (payload.type === "redo") {
                const stroke = state.redo.pop();
                if (!stroke) return;
                state.strokes.push(stroke);
                io.to(channel).emit("whiteboard-operation", { type: "redo", stroke });
            } else if (payload.type === "clear") {
                state.strokes = [];
                state.redo = [];
                state.active = {};
                io.to(channel).emit("whiteboard-operation", { type: "clear" });
            }
        });

        socket.on("leave-room", (roomName) => {
            const room = normalizePath(roomName);
            handleSocketLeave(io, socket, room);
        });

        socket.on("end-meeting-for-all", async (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;

            const participants = rooms[room] || [];
            participants.forEach((participantSocketId) => {
                io.to(participantSocketId).emit("meeting-ended");
            });

            await syncMeetingWithSocketState(room, {
                $set: {
                    isActive: false,
                    endedAt: new Date(),
                    participants: [],
                    waitingRoom: []
                }
            });

            delete rooms[room];
            delete roomUsers[room];
            delete roomMessages[room];
            delete roomWaiting[room];
            delete roomHosts[room];
            Object.keys(breakoutSessions[room]?.rooms || {}).forEach((breakoutId) => {
                const channel = getBreakoutChannel(room, breakoutId);
                delete roomMessages[channel];
                delete whiteboardStates[channel];
            });
            delete breakoutSessions[room];
            delete whiteboardStates[room];
        });

        socket.on("remove-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            io.to(participantSocketId).emit("removed-by-host");
            io.to(participantSocketId).emit("participant-removed");
        });

        socket.on("disconnect", () => {
            const room = userRooms[socket.id];
            if (room) {
                handleSocketLeave(io, socket, room);
            }
        });
    });

    return io;
};

const handleSocketLeave = async (io, socket, room) => {
    if (!room) return;
    const activeChannel = getActiveChannel(room, socket.id);
    delete whiteboardRateLimits[socket.id];
    socket.leave(activeChannel);
    const boardState = whiteboardStates[activeChannel];
    if (boardState) {
        Object.entries(boardState.active).forEach(([strokeId, entry]) => {
            if (entry.owner === socket.id) delete boardState.active[strokeId];
        });
    }
    const roomSockets = rooms[room] || [];
    const index = roomSockets.indexOf(socket.id);
    if (index >= 0) {
        roomSockets.splice(index, 1);
    }

    if (roomUsers[room]) {
        const participantInfo = roomUsers[room][socket.id];
        delete roomUsers[room][socket.id];
        delete breakoutSessions[room]?.assignments[socket.id];
        if (roomHosts[room] === socket.id) {
            delete roomHosts[room];
        }
        roomWaiting[room] = (roomWaiting[room] || []).filter((entry) => entry.socketId !== socket.id);

        const remainingParticipants = roomUsers[room]
            ? Object.entries(roomUsers[room]).filter(([, user]) => user?.socketId !== socket.id).map(([socketId, user]) => ({ socketId, username: user.username, joinedAt: user.joinedAt }))
            : [];

        const updatePayload = {
            $set: {
                waitingRoom: (roomWaiting[room] || []).filter((entry) => entry.socketId !== socket.id),
                participants: remainingParticipants
            }
        };

        if (participantInfo?.username) {
            const hostUser = Object.values(roomUsers[room] || {}).find((user) => user.isHost);
            updatePayload.$push = {
                history: {
                    participant: participantInfo.username,
                    host: hostUser?.username || "Host",
                    joinedTime: participantInfo.joinedAt || new Date(),
                    leftTime: new Date(),
                    duration: Math.max(0, Math.floor((new Date().getTime() - (participantInfo.joinedAt?.getTime() || new Date().getTime())) / 1000))
                }
            };
        }

        await syncMeetingWithSocketState(room, updatePayload);

        emitParticipants(io, room);
        if (breakoutSessions[room]?.active && roomHosts[room]) {
            io.to(roomHosts[room]).emit("breakout-state", {
                active: true,
                rooms: breakoutSessions[room].rooms,
                assignments: breakoutSessions[room].assignments,
            });
        }
        io.to(activeChannel).emit("user-disconnected", { socketId: socket.id });
    }

    delete userRooms[socket.id];
};
