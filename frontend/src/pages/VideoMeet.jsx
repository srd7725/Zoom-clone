import React, { useEffect, useRef, useState, useContext } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText, Snackbar } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import PeopleIcon from '@mui/icons-material/People'
import server from '../environment';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';

const server_url = server;
var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

export default function VideoMeetComponent() {
    const navigate = useNavigate();
    const location = useLocation();
    const { validateMeetingCode, endActiveMeeting } = useContext(AuthContext);
    const searchParams = new URLSearchParams(location.search);
    const isHost = searchParams.get('host') === 'true';
    const meetingCode = window.location.pathname.replace('/', '');

    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    let [video, setVideo] = useState([]);
    let [audio, setAudio] = useState();
    let [screen, setScreen] = useState();
    let [showModal, setModal] = useState(true);
    let [screenAvailable, setScreenAvailable] = useState();
    let [messages, setMessages] = useState([])
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [askForUsername, setAskForUsername] = useState(true);
    let [username, setUsername] = useState("");
    const videoRef = useRef([])
    let [videos, setVideos] = useState([])

    // New states for Zoom Clone features
    let [isValidating, setIsValidating] = useState(true);
    let [meetingError, setMeetingError] = useState("");
    let [inWaitingRoom, setInWaitingRoom] = useState(false);
    let [waitingUsers, setWaitingUsers] = useState([]);
    let [showParticipants, setShowParticipants] = useState(false);
    let [snackOpen, setSnackOpen] = useState(false);
    let [snackMessage, setSnackMessage] = useState("");

    useEffect(() => {
        validateMeeting();
    }, []);

    const validateMeeting = async () => {
        try {
            await validateMeetingCode(meetingCode);
            setIsValidating(false);
            getPermissions();
        } catch (err) {
            setMeetingError(err?.response?.data?.message || "Invalid Meeting Code");
            setIsValidating(false);
        }
    }

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .then((stream) => { })
                    .catch((e) => console.log(e))
            }
        }
    }

    const getPermissions = async () => {
        try {
            const videoPermission = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
            if (videoPermission) {
                setVideoAvailable(true);
            } else {
                setVideoAvailable(false);
            }

            const audioPermission = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
            if (audioPermission) {
                setAudioAvailable(true);
            } else {
                setAudioAvailable(false);
            }

            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            } else {
                setScreenAvailable(false);
            }

            if (videoPermission || audioPermission) {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: !!videoPermission, audio: !!audioPermission });
                if (userMediaStream) {
                    window.localStream = userMediaStream;
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream;
                    }
                }
            }
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined && !askForUsername && !inWaitingRoom) {
            getUserMedia();
        }
    }, [video, audio])

    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        connectToSocketServer();
    }

    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setVideo(false);
            setAudio(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            for (let id in connections) {
                connections[id].addStream(window.localStream)

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                        })
                        .catch(e => console.log(e))
                })
            }
        })
    }

    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .catch((e) => console.log(e))
        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { }
        }
    }

    let getDislayMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setScreen(false)

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            getUserMedia()
        })
    }

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message)

        if (fromId !== socketIdRef.current) {
            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }))
                            }).catch(e => console.log(e))
                        }).catch(e => console.log(e))
                    }
                }).catch(e => console.log(e))
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e))
            }
        }
    }

    let connectToSocketServer = () => {
        socketRef.current = io.connect(server_url, { secure: false })

        socketRef.current.on('signal', gotMessageFromServer)

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-call', window.location.href, username, isHost)
            socketIdRef.current = socketRef.current.id

            socketRef.current.on('chat-message', addMessage)

            socketRef.current.on('user-left', (id) => {
                setVideos((videos) => videos.filter((video) => video.socketId !== id))
            })

            socketRef.current.on('waiting-room-request', (data) => {
                setWaitingUsers(prev => [...prev, data]);
                setSnackMessage(`${data.username} wants to join`);
                setSnackOpen(true);
            })

            socketRef.current.on('admitted', () => {
                setInWaitingRoom(false);
            })

            socketRef.current.on('rejected', () => {
                alert("The host declined your request.");
                window.location.href = "/home";
            })

            socketRef.current.on('meeting-ended', () => {
                alert("The host has ended the meeting.");
                window.location.href = "/home";
            })
            
            socketRef.current.on('removed-by-host', () => {
                alert("You have been removed from the meeting.");
                window.location.href = "/home";
            })

            socketRef.current.on('user-joined', (id, clients) => {
                // If we were in waiting room but get this, we are admitted or auto-joined
                setInWaitingRoom(false);
                
                clients.forEach((socketListId) => {
                    if (connections[socketListId]) return; // Prevent duplicate

                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections)
                    
                    connections[socketListId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }))
                        }
                    }

                    connections[socketListId].onaddstream = (event) => {
                        let videoExists = videoRef.current.find(video => video.socketId === socketListId);

                        if (videoExists) {
                            setVideos(videos => {
                                const updatedVideos = videos.map(video =>
                                    video.socketId === socketListId ? { ...video, stream: event.stream } : video
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        } else {
                            let newVideo = {
                                socketId: socketListId,
                                stream: event.stream,
                                autoplay: true,
                                playsinline: true
                            };
                            setVideos(videos => {
                                const updatedVideos = [...videos, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        }
                    };

                    if (window.localStream !== undefined && window.localStream !== null) {
                        connections[socketListId].addStream(window.localStream)
                    } else {
                        let blackSilence = (...args) => new MediaStream([black(...args), silence()])
                        window.localStream = blackSilence()
                        connections[socketListId].addStream(window.localStream)
                    }
                })

                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue

                        try {
                            connections[id2].addStream(window.localStream)
                        } catch (e) { }

                        connections[id2].createOffer().then((description) => {
                            connections[id2].setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit('signal', id2, JSON.stringify({ 'sdp': connections[id2].localDescription }))
                                })
                                .catch(e => console.log(e))
                        })
                    }
                }
            })
        })
    }

    let silence = () => {
        let ctx = new AudioContext()
        let oscillator = ctx.createOscillator()
        let dst = oscillator.connect(ctx.createMediaStreamDestination())
        oscillator.start()
        ctx.resume()
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
    }
    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height })
        canvas.getContext('2d').fillRect(0, 0, width, height)
        let stream = canvas.captureStream()
        return Object.assign(stream.getVideoTracks()[0], { enabled: false })
    }

    let handleVideo = () => {
        setVideo(!video);
    }
    let handleAudio = () => {
        setAudio(!audio)
    }

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
    }, [screen])
    
    let handleScreen = () => {
        setScreen(!screen);
    }

    let handleEndCall = async () => {
        try {
            if (isHost) {
                await endActiveMeeting(meetingCode);
                socketRef.current.emit('end-meeting-for-all', window.location.href);
            }
            let tracks = localVideoref.current.srcObject?.getTracks()
            if (tracks) tracks.forEach(track => track.stop())
        } catch (e) { console.log(e) }
        window.location.href = "/home"
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };

    let sendMessage = () => {
        socketRef.current.emit('chat-message', message, username)
        setMessage("");
    }

    let connect = () => {
        if(!username) {
            setSnackMessage("Please enter your name");
            setSnackOpen(true);
            return;
        }
        setAskForUsername(false);
        if (!isHost) {
            setInWaitingRoom(true);
        }
        getMedia();
    }
    
    // Host Control Functions
    const admitUser = (socketId) => {
        socketRef.current.emit('admit-participant', socketId, window.location.href);
        setWaitingUsers(prev => prev.filter(u => u.socketId !== socketId));
    }

    const rejectUser = (socketId) => {
        socketRef.current.emit('reject-participant', socketId, window.location.href);
        setWaitingUsers(prev => prev.filter(u => u.socketId !== socketId));
    }

    const removeUser = (socketId) => {
        socketRef.current.emit('remove-participant', socketId, window.location.href);
    }

    if (isValidating) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><h2>Validating Meeting...</h2></div>
    }

    if (meetingError) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <h2>{meetingError}</h2>
                <Button variant="contained" onClick={() => navigate('/home')} style={{ marginTop: '20px' }}>Go Home</Button>
            </div>
        )
    }

    return (
        <div>
            {askForUsername === true ?
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                    <h2>Enter into Lobby</h2>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                        <TextField id="outlined-basic" label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
                        <Button variant="contained" onClick={connect}>Join Meeting</Button>
                    </div>
                    <div style={{ width: '600px', maxWidth: '90%', borderRadius: '10px', overflow: 'hidden', backgroundColor: '#000' }}>
                        <video ref={localVideoref} autoPlay muted style={{ width: '100%' }}></video>
                    </div>
                </div> :

            inWaitingRoom ?
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                    <h2>Waiting for the host to let you in...</h2>
                </div> :

                <div className={styles.meetVideoContainer}>
                    {showModal ? <div className={styles.chatRoom}>
                        <div className={styles.chatContainer}>
                            <h1>Chat</h1>
                            <div className={styles.chattingDisplay}>
                                {messages.length !== 0 ? messages.map((item, index) => {
                                    return (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )
                                }) : <p>No Messages Yet</p>}
                            </div>
                            <div className={styles.chattingArea}>
                                <TextField value={message} onChange={(e) => setMessage(e.target.value)} id="outlined-basic" label="Enter Your chat" variant="outlined" />
                                <Button variant='contained' onClick={sendMessage}>Send</Button>
                            </div>
                        </div>
                    </div> : <></>}

                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio === true ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>
                        {screenAvailable === true ?
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen === true ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton> : <></>}
                        <Badge badgeContent={newMessages} max={999} color='warning'>
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                                <ChatIcon />                        
                            </IconButton>
                        </Badge>
                        {isHost && (
                            <Badge badgeContent={waitingUsers.length} color='error'>
                                <IconButton onClick={() => setShowParticipants(true)} style={{ color: "white" }}>
                                    <PeopleIcon />                        
                                </IconButton>
                            </Badge>
                        )}
                        <Button variant="contained" color="error" onClick={handleEndCall} style={{ marginLeft: '10px' }}>
                            {isHost ? "End Meeting" : "Leave"}
                        </Button>
                    </div>

                    <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted></video>

                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId}>
                                <video
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                >
                                </video>
                            </div>
                        ))}
                    </div>
                    
                    {/* Participants Modal for Host */}
                    <Dialog open={showParticipants} onClose={() => setShowParticipants(false)} fullWidth maxWidth="sm">
                        <DialogTitle>Participants & Waiting Room</DialogTitle>
                        <DialogContent>
                            <h3>Waiting Room ({waitingUsers.length})</h3>
                            <List>
                                {waitingUsers.map(u => (
                                    <ListItem key={u.socketId} secondaryAction={
                                        <div>
                                            <Button size="small" variant="contained" color="success" onClick={() => admitUser(u.socketId)} style={{ marginRight: '5px' }}>Admit</Button>
                                            <Button size="small" variant="contained" color="error" onClick={() => rejectUser(u.socketId)}>Reject</Button>
                                        </div>
                                    }>
                                        <ListItemText primary={u.username} />
                                    </ListItem>
                                ))}
                                {waitingUsers.length === 0 && <p style={{marginLeft: '15px'}}>No one is waiting.</p>}
                            </List>
                            <hr />
                            <h3>In Meeting ({videos.length + 1})</h3>
                            <List>
                                <ListItem>
                                    <ListItemText primary={`${username} (You)`} />
                                </ListItem>
                                {videos.map(v => {
                                    // Normally we would sync socket IDs to usernames here, but for simplicity we just show ID or generic name
                                    return (
                                    <ListItem key={v.socketId} secondaryAction={
                                        <Button size="small" variant="outlined" color="error" onClick={() => removeUser(v.socketId)}>Remove</Button>
                                    }>
                                        <ListItemText primary={`Participant (${v.socketId.substring(0,4)})`} />
                                    </ListItem>
                                )})}
                            </List>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setShowParticipants(false)}>Close</Button>
                        </DialogActions>
                    </Dialog>
                    
                    <Snackbar
                        open={snackOpen}
                        autoHideDuration={4000}
                        onClose={() => setSnackOpen(false)}
                        message={snackMessage}
                    />
                </div>
            }
        </div>
    )
}