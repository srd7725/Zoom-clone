import { Server } from "socket.io";
import { Meeting } from "../models/meeting.model.js";

const rooms = {};
const roomUsers = {};
const roomMessages = {};
const roomWaiting = {};
const roomHosts = {};
const userRooms = {};

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
    return { roomName };
};

const syncMeetingWithSocketState = async (roomName, update) => {
    if (!roomName) return;
    try {
        await Meeting.updateOne({ meetingCode: roomName }, update, { runValidators: true });
    } catch (error) {
        console.log(error);
    }
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

        socket.on("join-room", async ({ roomName, username, isHost, isVideoOn, isAudioOn }) => {
            const room = normalizePath(roomName);
            getRoomInfo(room);
            const roomSockets = rooms[room];
            const roomState = roomUsers[room];
            const waitingRoom = roomWaiting[room];

            userRooms[socket.id] = room;
            roomState[socket.id] = { 
                socketId: socket.id, 
                username, 
                isHost, 
                joinedAt: new Date(),
                isVideoOn: isVideoOn !== undefined ? isVideoOn : true,
                isAudioOn: isAudioOn !== undefined ? isAudioOn : true,
                canUseMic: true,
                canUseCamera: true
            };

            if (isHost) {
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

            const shouldTrackParticipant = isHost || !roomHosts[room] || roomHosts[room] === socket.id;

            if (!isHost) {
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
                if (!shouldTrackParticipant) {
                    return;
                }
            }

            if (!roomSockets.includes(socket.id)) {
                roomSockets.push(socket.id);
            }

            socket.join(room);
            await syncMeetingWithSocketState(room, {
                $set: {
                    waitingRoom: (roomWaiting[room] || []).filter((entry) => entry.socketId !== socket.id)
                },
                ...(shouldTrackParticipant ? {
                    $addToSet: {
                        participants: { socketId: socket.id, username, joinedAt: new Date() }
                    }
                } : {})
            });
            io.to(room).emit("user-connected", { socketId: socket.id, username, isHost });
            io.to(room).emit("participants-updated", Object.values(roomState));

            roomMessages[room].forEach((message) => {
                socket.emit("chat-message", message.data, message.sender, message.socketId);
            });
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
            io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
            io.to(room).emit("user-connected", { socketId: participantSocketId, username: participant.username, isHost: false });
            io.to(participantSocketId).emit("participants-updated", Object.values(roomUsers[room] || {}));
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
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
                io.to(participantSocketId).emit("participant-muted");
            }
        });

        socket.on("allow-mic-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseMic = true;
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
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
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
                io.to(participantSocketId).emit("participant-camera-disabled");
            }
        });

        socket.on("allow-camera-participant", (participantSocketId, roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            const participant = roomUsers[room]?.[participantSocketId];
            if (participant) {
                participant.canUseCamera = true;
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
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
            io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
        });

        socket.on("allow-mic-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseMic = true;
                io.to(participant.socketId).emit("participant-unmuted");
            });
            io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
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
            io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
        });

        socket.on("allow-camera-all-participants", (roomName) => {
            const room = normalizePath(roomName);
            if (roomHosts[room] !== socket.id) return;
            Object.values(roomUsers[room] || {}).forEach((participant) => {
                if (participant.socketId === socket.id) return;
                participant.canUseCamera = true;
                io.to(participant.socketId).emit("participant-camera-enabled");
            });
            io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
        });

        // Client media update events
        socket.on("participant-muted", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                user.isAudioOn = false;
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
            }
        });

        socket.on("participant-unmuted", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                if (user.canUseMic !== false) {
                    user.isAudioOn = true;
                    io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
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
                io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
            }
        });

        socket.on("participant-camera-enabled", (roomName) => {
            const room = normalizePath(roomName);
            const user = roomUsers[room]?.[socket.id];
            if (user) {
                if (user.canUseCamera !== false) {
                    user.isVideoOn = true;
                    io.to(room).emit("participants-updated", Object.values(roomUsers[room]));
                } else {
                    socket.emit("participant-camera-disabled");
                }
            }
        });

        socket.on("offer", (payload) => {
            io.to(payload.target).emit("offer", payload);
        });

        socket.on("answer", (payload) => {
            io.to(payload.target).emit("answer", payload);
        });

        socket.on("ice-candidate", (payload) => {
            io.to(payload.target).emit("ice-candidate", payload);
        });

        socket.on("chat-message", (data, sender) => {
            const room = userRooms[socket.id];
            if (!room) return;
            const messageEntry = { data, sender, socketId: socket.id };
            roomMessages[room] = roomMessages[room] || [];
            roomMessages[room].push(messageEntry);
            io.to(room).emit("chat-message", data, sender, socket.id);
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
    const roomSockets = rooms[room] || [];
    const index = roomSockets.indexOf(socket.id);
    if (index >= 0) {
        roomSockets.splice(index, 1);
    }

    if (roomUsers[room]) {
        const participantInfo = roomUsers[room][socket.id];
        delete roomUsers[room][socket.id];
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

        io.to(room).emit("participants-updated", Object.values(roomUsers[room] || {}));
        io.to(room).emit("user-disconnected", { socketId: socket.id });
    }

    delete userRooms[socket.id];
};
