import { Server } from "socket.io"

let connections = {}
let messages = {}
let timeOnline = {}
let users = {} // { socketId: { username, isHost, path } }
let waitingRooms = {} // { path: [ { socketId, username } ] }
let meetingHosts = {} // { path: socketId }

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
        console.log("SOMETHING CONNECTED:", socket.id)

        socket.on("join-call", (path, username, isHost) => {
            if (connections[path] === undefined) {
                connections[path] = []
            }
            if (waitingRooms[path] === undefined) {
                waitingRooms[path] = []
            }
            
            users[socket.id] = { username, isHost, path }
            
            if (isHost) {
                meetingHosts[path] = socket.id;
            }

            // If not host and there is a host, they might go to waiting room
            // Let's implement an auto-join for now, but emit a waiting room event if needed
            // Actually the plan says: if they are not host, wait for admit-participant.
            // Let's implement a simplified waiting room logic:
            if (!isHost && meetingHosts[path]) {
                waitingRooms[path].push({ socketId: socket.id, username });
                io.to(meetingHosts[path]).emit("waiting-room-request", { socketId: socket.id, username });
                return; // Do not join call yet
            }

            // Join directly if host or no host logic is strictly enforced yet
            joinCall(socket, path, username);
        })
        
        const joinCall = (socket, path, username) => {
            if (!connections[path].includes(socket.id)) {
                connections[path].push(socket.id)
                timeOnline[socket.id] = new Date();
            }

            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a]).emit("user-joined", socket.id, connections[path])
            }

            if (messages[path] !== undefined) {
                for (let a = 0; a < messages[path].length; ++a) {
                    io.to(socket.id).emit("chat-message", messages[path][a]['data'],
                        messages[path][a]['sender'], messages[path][a]['socket-id-sender'])
                }
            }
        }

        socket.on("admit-participant", (participantSocketId, path) => {
            // Host admits a user
            if (meetingHosts[path] === socket.id) {
                waitingRooms[path] = waitingRooms[path].filter(u => u.socketId !== participantSocketId);
                const user = users[participantSocketId];
                if (user) {
                    io.to(participantSocketId).emit("admitted");
                    joinCall(io.sockets.sockets.get(participantSocketId) || { id: participantSocketId }, path, user.username);
                }
            }
        })
        
        socket.on("reject-participant", (participantSocketId, path) => {
             if (meetingHosts[path] === socket.id) {
                 waitingRooms[path] = waitingRooms[path].filter(u => u.socketId !== participantSocketId);
                 io.to(participantSocketId).emit("rejected");
             }
        })

        socket.on("signal", (toId, message) => {
            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data, sender) => {
            const [matchingRoom, found] = Object.entries(connections)
                .reduce(([room, isFound], [roomKey, roomValue]) => {
                    if (!isFound && roomValue.includes(socket.id)) {
                        return [roomKey, true];
                    }
                    return [room, isFound];
                }, ['', false]);

            if (found === true) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = []
                }
                messages[matchingRoom].push({ 'sender': sender, "data": data, "socket-id-sender": socket.id })
                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("chat-message", data, sender, socket.id)
                })
            }
        })
        
        socket.on("end-meeting-for-all", (path) => {
             if (meetingHosts[path] === socket.id) {
                 if (connections[path]) {
                     connections[path].forEach(elem => {
                         io.to(elem).emit("meeting-ended");
                     })
                     delete connections[path];
                     delete messages[path];
                     delete waitingRooms[path];
                     delete meetingHosts[path];
                 }
             }
        })
        
        socket.on("remove-participant", (participantSocketId, path) => {
             if (meetingHosts[path] === socket.id) {
                 io.to(participantSocketId).emit("removed-by-host");
             }
        })

        socket.on("disconnect", () => {
            var diffTime = Math.abs(timeOnline[socket.id] - new Date())
            var key

            for (const [k, v] of JSON.parse(JSON.stringify(Object.entries(connections)))) {
                for (let a = 0; a < v.length; ++a) {
                    if (v[a] === socket.id) {
                        key = k

                        for (let a = 0; a < connections[key].length; ++a) {
                            io.to(connections[key][a]).emit('user-left', socket.id)
                        }

                        var index = connections[key].indexOf(socket.id)
                        connections[key].splice(index, 1)

                        if (connections[key].length === 0) {
                            delete connections[key]
                        }
                    }
                }
            }
            
            if (users[socket.id]) {
                const path = users[socket.id].path;
                if (meetingHosts[path] === socket.id) {
                    delete meetingHosts[path];
                }
                if (waitingRooms[path]) {
                    waitingRooms[path] = waitingRooms[path].filter(u => u.socketId !== socket.id);
                }
                delete users[socket.id];
            }
        })
    })

    return io;
}
