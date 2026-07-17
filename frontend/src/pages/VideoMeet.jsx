import React, { useEffect, useRef, useState, useContext, useMemo, useCallback } from 'react'
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
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PersonIcon from '@mui/icons-material/Person'
import server from '../environment';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';

const server_url = server;

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

const ParticipantTile = React.memo(function ParticipantTile({ participant }) {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && participant.stream) {
            videoRef.current.srcObject = participant.stream;
        }
    }, [participant.stream]);

    const initials = (participant.username || 'You').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    const isCameraOn = Boolean(participant.stream && participant.isVideoOn);
    const isMicOn = participant.isAudioOn !== false;

    return (
        <div className={styles.participantTile}>
            <div className={styles.participantMedia}>
                {isCameraOn ? (
                    <video ref={videoRef} autoPlay playsInline muted className={styles.participantVideo} />
                ) : (
                    <div className={styles.participantAvatar}>
                        <span>{initials || 'U'}</span>
                    </div>
                )}
            </div>
            <div className={styles.participantInfo}>
                <div className={styles.participantName}>{participant.username || 'You'}</div>
                <div className={styles.participantStatusRow}>
                    <span className={styles.statusPill}>
                        {isCameraOn ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}
                        <span>{isCameraOn ? 'On' : 'Off'}</span>
                    </span>
                    <span className={styles.statusPill}>
                        {isMicOn ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
                        <span>{isMicOn ? 'On' : 'Off'}</span>
                    </span>
                </div>
            </div>
        </div>
    );
});

export default function VideoMeetComponent() {
    const navigate = useNavigate();
    const location = useLocation();
    const { validateMeetingCode, endActiveMeeting } = useContext(AuthContext);
    const searchParams = new URLSearchParams(location.search);
    const isHost = searchParams.get('host') === 'true';
    const meetingCode = window.location.pathname.replace('/', '');

    const peerConnectionsRef = useRef({});
    const remoteVideosRef = useRef({});
    const cameraStreamRef = useRef(null);
    const screenStreamRef = useRef(null);
    const primaryVideoRef = useRef(null);
    const chatInputRef = useRef(null);
    var socketRef = useRef();
    let socketIdRef = useRef();
    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    let [video, setVideo] = useState(false);
    let [audio, setAudio] = useState(false);
    let [screen, setScreen] = useState(false);
    let [showModal, setModal] = useState(true);
    let [screenAvailable, setScreenAvailable] = useState();
    let [messages, setMessages] = useState([])
    let [message, setMessage] = useState("");
    let [newMessages, setNewMessages] = useState(0);
    let [askForUsername, setAskForUsername] = useState(true);
    let [username, setUsername] = useState("");
    const videoRef = useRef([])
    let [videos, setVideos] = useState([])
    let [localStream, setLocalStream] = useState(null);

    // New states for Zoom Clone features
    let [isValidating, setIsValidating] = useState(true);
    let [meetingError, setMeetingError] = useState("");
    let [inWaitingRoom, setInWaitingRoom] = useState(false);
    let [waitingUsers, setWaitingUsers] = useState([]);
    let [showParticipants, setShowParticipants] = useState(false);
    let [snackOpen, setSnackOpen] = useState(false);
    let [snackMessage, setSnackMessage] = useState("");
    let [participants, setParticipants] = useState([]);
    let [usernameError, setUsernameError] = useState("");
    let [previewMessage, setPreviewMessage] = useState("");
    let [localVideoPosition, setLocalVideoPosition] = useState({ x: 24, y: 24 });
    let [localVideoSize, setLocalVideoSize] = useState({ width: 240, height: 160 });
    let [isSharingScreen, setIsSharingScreen] = useState(false);
    const dragStateRef = useRef(null);
    const resizeStateRef = useRef(null);

    const emitMediaState = useCallback((nextVideoState, nextAudioState) => {
        if (socketRef.current?.connected) {
            socketRef.current.emit('media-state-change', {
                roomName: meetingCode,
                isVideoOn: nextVideoState,
                isAudioOn: nextAudioState,
            });
        }
    }, [meetingCode]);

    useEffect(() => {
        validateMeeting();
        const updateDefaultVideoSize = () => {
            const width = Math.min(320, Math.max(200, window.innerWidth < 900 ? 220 : 260));
            setLocalVideoSize({ width, height: Math.round(width / 1.6) });
        };
        updateDefaultVideoSize();
        window.addEventListener('resize', updateDefaultVideoSize);
        return () => {
            window.removeEventListener('resize', updateDefaultVideoSize);
            if (socketRef.current) {
                socketRef.current.emit('leave-room', meetingCode);
                socketRef.current.removeAllListeners();
                socketRef.current.disconnect();
            }
            const stream = localVideoref.current?.srcObject;
            if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    const stopMediaStream = (stream) => {
        if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach((track) => track.stop());
        }
    };

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
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch((error) => {
                if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
                    setPreviewMessage('Camera access was blocked. You can still join with the camera disabled.');
                } else {
                    setPreviewMessage('Unable to access your camera. You can still join with the camera disabled.');
                }
                return null;
            });
            const hasVideo = !!stream?.getVideoTracks()?.length;
            const hasAudio = !!stream?.getAudioTracks()?.length;
            setVideoAvailable(hasVideo);
            setAudioAvailable(hasAudio);

            if (navigator.mediaDevices.getDisplayMedia) {
                setScreenAvailable(true);
            } else {
                setScreenAvailable(false);
            }

            if (stream) {
                setPreviewMessage('');
                cameraStreamRef.current = stream;
                setLocalStream(stream);
                syncLocalStream(stream, { shouldPreview: true, isScreenShare: false });
            }
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined && !askForUsername && !inWaitingRoom && !cameraStreamRef.current) {
            getUserMedia();
        }
    }, [askForUsername, inWaitingRoom, video, audio])

    let getMedia = () => {
        const initialVideoState = videoAvailable;
        const initialAudioState = audioAvailable;
        setVideo(initialVideoState);
        setAudio(initialAudioState);
        connectToSocketServer(initialVideoState, initialAudioState);
    }

    const ensurePeerConnection = (remoteSocketId) => {
        if (!remoteSocketId || remoteSocketId === socketIdRef.current) return null;
        if (peerConnectionsRef.current[remoteSocketId]) return peerConnectionsRef.current[remoteSocketId];

        const peerConnection = new RTCPeerConnection(peerConfigConnections);
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socketRef.current) {
                socketRef.current.emit('ice-candidate', { target: remoteSocketId, sender: socketIdRef.current, candidate: event.candidate });
            }
        };

        peerConnection.ontrack = (event) => {
            const stream = event.streams?.[0] || new MediaStream([event.track]);
            const isScreenShare = /screen/i.test(event.track?.label || '') || stream.getVideoTracks().some((track) => /screen/i.test(track.label || ''));
            setVideos((prevVideos) => {
                const existing = prevVideos.find((video) => video.socketId === remoteSocketId);
                if (existing) {
                    return prevVideos.map((video) => video.socketId === remoteSocketId ? { ...video, stream, isScreenShare } : video);
                }
                return [...prevVideos, { socketId: remoteSocketId, stream, autoplay: true, playsinline: true, isScreenShare }];
            });
            remoteVideosRef.current[remoteSocketId] = stream;
        };

        if (window.localStream) {
            window.localStream.getTracks().forEach((track) => peerConnection.addTrack(track, window.localStream));
        }

        peerConnectionsRef.current[remoteSocketId] = peerConnection;
        return peerConnection;
    };

    const createOfferForPeer = async (remoteSocketId) => {
        const peerConnection = ensurePeerConnection(remoteSocketId);
        if (!peerConnection || !socketRef.current || !socketIdRef.current) return;
        if (peerConnection.signalingState !== 'stable') return;

        try {
            const offerDescription = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offerDescription);
            socketRef.current.emit('offer', { target: remoteSocketId, sender: socketIdRef.current, sdp: peerConnection.localDescription });
        } catch (error) {
            console.log(error);
        }
    };

    const syncLocalStream = (stream, options = {}) => {
        const { shouldPreview = true, isScreenShare = false } = options;
        window.localStream = stream;
        setLocalStream(stream);
        if (shouldPreview && localVideoref.current && !isScreenShare) {
            localVideoref.current.srcObject = stream;
        }

        Object.keys(peerConnectionsRef.current).forEach((remoteSocketId) => {
            const peerConnection = peerConnectionsRef.current[remoteSocketId];
            if (!peerConnection) return;

            stream.getTracks().forEach((track) => {
                const existingSender = peerConnection.getSenders().find((sender) => sender.track?.kind === track.kind);
                if (existingSender) {
                    existingSender.replaceTrack(track).catch(() => {});
                } else {
                    peerConnection.addTrack(track, stream);
                }
            });

            createOfferForPeer(remoteSocketId);
        });
    };

    let getUserMediaSuccess = (stream) => {
        cameraStreamRef.current = stream;
        setLocalStream(stream);
        syncLocalStream(stream, { shouldPreview: true, isScreenShare: false });

        stream.getTracks().forEach((track) => {
            track.onended = () => {
                setVideo(false);
                setAudio(false);
                try {
                    stream.getTracks().forEach((trackToStop) => trackToStop.stop());
                } catch (e) { console.log(e) }
                const blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                syncLocalStream(blackSilence());
            };
        });
    };

    let getUserMedia = () => {
        if (cameraStreamRef.current) {
            getUserMediaSuccess(cameraStreamRef.current);
            return;
        }

        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: Boolean(video && videoAvailable), audio: Boolean(audio && audioAvailable) })
                .then(getUserMediaSuccess)
                .catch((e) => console.log(e));
        } else {
            try {
                window.localStream?.getTracks().forEach((track) => track.stop());
            } catch (e) { }
        }
    };

    let getDislayMediaSuccess = (stream) => {
        screenStreamRef.current = stream;
        setIsSharingScreen(true);
        syncLocalStream(stream, { shouldPreview: false, isScreenShare: true });

        stream.getTracks().forEach((track) => {
            track.onended = () => {
                setScreen(false);
                setIsSharingScreen(false);
                if (cameraStreamRef.current) {
                    syncLocalStream(cameraStreamRef.current, { shouldPreview: true, isScreenShare: false });
                }
                getUserMedia();
            };
        });
    };

    const handleOffer = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        const peerConnection = ensurePeerConnection(payload.sender);
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answerDescription = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answerDescription);
            socketRef.current.emit('answer', { target: payload.sender, sender: socketIdRef.current, sdp: peerConnection.localDescription });
        } catch (error) {
            console.log(error);
        }
    };

    const handleAnswer = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        const peerConnection = peerConnectionsRef.current[payload.sender];
        if (!peerConnection) return;
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } catch (error) {
            console.log(error);
        }
    };

    const handleIceCandidate = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        const peerConnection = peerConnectionsRef.current[payload.sender];
        if (!peerConnection || !payload.candidate) return;
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (error) {
            console.log(error);
        }
    };

    let connectToSocketServer = (initialVideoState = video, initialAudioState = audio) => {
        if (socketRef.current) {
            socketRef.current.removeAllListeners();
            socketRef.current.disconnect();
        }

        const socket = io(server_url, { transports: ['websocket'], reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });
        socketRef.current = socket;

        socket.on('connect', () => {
            socketIdRef.current = socket.id;
            socket.emit('join-room', { roomName: meetingCode, username, isHost });
            emitMediaState(initialVideoState, initialAudioState);
        });

        socket.on('chat-message', addMessage);

        socket.on('waiting-room-request', (data) => {
            setWaitingUsers(prev => [...prev, data]);
            setSnackMessage(`${data.username} wants to join`);
            setSnackOpen(true);
        });

        socket.on('waiting-room-status', (data) => {
            setSnackMessage(data.message);
            setSnackOpen(true);
        });

        socket.on('admitted', () => {
            setInWaitingRoom(false);
            setAskForUsername(false);
            setSnackMessage('You have been admitted into the meeting.');
            setSnackOpen(true);
        });

        socket.on('rejected', () => {
            setSnackMessage("The host declined your request.");
            setSnackOpen(true);
            setTimeout(() => window.location.href = "/home", 1500);
        });

        socket.on('meeting-ended', () => {
            setSnackMessage("The host has ended the meeting.");
            setSnackOpen(true);
            setTimeout(() => window.location.href = "/home", 1500);
        });
        
        socket.on('removed-by-host', () => {
            setSnackMessage("You have been removed from the meeting.");
            setSnackOpen(true);
            setTimeout(() => window.location.href = "/home", 1500);
        });

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);

        socket.on('user-connected', (participant) => {
            setInWaitingRoom(false);
            setAskForUsername(false);
            if (participant.socketId && participant.socketId !== socketIdRef.current) {
                ensurePeerConnection(participant.socketId);
                createOfferForPeer(participant.socketId);
            }
        });

        socket.on('participants-updated', (participantsList) => {
            const uniqueParticipants = [];
            const seen = new Set();

            (participantsList || []).forEach((participant) => {
                if (!participant?.socketId || participant.socketId === socketIdRef.current) return;
                if (seen.has(participant.socketId)) return;
                seen.add(participant.socketId);
                uniqueParticipants.push(participant);
            });

            setParticipants(uniqueParticipants);
        });

        socket.on('user-disconnected', ({ socketId }) => {
            setParticipants((prevParticipants) => prevParticipants.filter((participant) => participant.socketId !== socketId));
            setVideos((prevVideos) => prevVideos.filter((video) => video.socketId !== socketId));
            if (peerConnectionsRef.current[socketId]) {
                peerConnectionsRef.current[socketId].close();
                delete peerConnectionsRef.current[socketId];
            }
        });
    };

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
        const nextValue = !video;
        setVideo(nextValue);
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getVideoTracks().forEach((track) => {
                track.enabled = nextValue;
            });
            syncLocalStream(cameraStreamRef.current, { shouldPreview: true, isScreenShare: false });
        }
        emitMediaState(nextValue, audio);
    }
    let handleAudio = () => {
        const nextValue = !audio;
        setAudio(nextValue);
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getAudioTracks().forEach((track) => {
                track.enabled = nextValue;
            });
            syncLocalStream(cameraStreamRef.current, { shouldPreview: true, isScreenShare: false });
        }
        emitMediaState(video, nextValue);
    }

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
    }, [screen])
    
    let handleScreen = () => {
        if (screen) {
            stopMediaStream(screenStreamRef.current);
            setScreen(false);
            setIsSharingScreen(false);
            if (cameraStreamRef.current) {
                syncLocalStream(cameraStreamRef.current, { shouldPreview: true, isScreenShare: false });
            }
            return;
        }
        setScreen(true);
    }

    let handleEndCall = async () => {
        try {
            if (socketRef.current) {
                if (isHost) {
                    await endActiveMeeting(meetingCode);
                    socketRef.current.emit('end-meeting-for-all', meetingCode);
                } else {
                    socketRef.current.emit('leave-room', meetingCode);
                }
            }
            const stream = localVideoref.current?.srcObject;
            if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach((track) => track.stop());
            }
        } catch (e) { console.log(e) }
        window.location.href = "/home"
    }

    const addMessage = useCallback((data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    }, []);

    let sendMessage = useCallback(() => {
        const trimmedMessage = message.trim();
        if (!trimmedMessage || !socketRef.current) return;
        socketRef.current.emit('chat-message', trimmedMessage, username)
        setMessage("");
        chatInputRef.current?.focus();
    }, [message, username]);

    const handleChatKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    };

    const validateUsername = (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
            return "Please enter a valid username.";
        }
        if (trimmed.length < 3 || trimmed.length > 30) {
            return "Username must be between 3 and 30 characters.";
        }
        if (/^\d+$/.test(trimmed)) {
            return "Username cannot be only numbers.";
        }
        if (/^MEET-[A-Z0-9]+$/i.test(trimmed)) {
            return "Meeting code cannot be used as username.";
        }
        if (/^(https?:\/\/|localhost|localhost:\d+|wss?:\/\/)/i.test(trimmed)) {
            return "Please enter a valid username.";
        }
        if (/^[a-z0-9]{8,}$/i.test(trimmed) && !/\s/.test(trimmed)) {
            const lower = trimmed.toLowerCase();
            if (lower.includes("meet") || lower.includes("socket") || lower.includes("room") || lower.includes("localhost")) {
                return "Meeting code cannot be used as username.";
            }
        }
        if (/^[a-f0-9]{6,}$/i.test(trimmed)) {
            return "Please enter a valid username.";
        }
        return "";
    };

    let connect = () => {
        const validationMessage = validateUsername(username);
        if (validationMessage) {
            setUsernameError(validationMessage);
            setSnackMessage(validationMessage);
            setSnackOpen(true);
            return;
        }
        setUsernameError("");
        setAskForUsername(false);
        if (!isHost) {
            setInWaitingRoom(true);
        }
        getMedia();
    }
    
    // Host Control Functions
    const admitUser = (socketId) => {
        socketRef.current.emit('admit-participant', socketId, meetingCode);
        setWaitingUsers(prev => prev.filter(u => u.socketId !== socketId));
    }

    const rejectUser = (socketId) => {
        socketRef.current.emit('reject-participant', socketId, meetingCode);
        setWaitingUsers(prev => prev.filter(u => u.socketId !== socketId));
    }

    const removeUser = (socketId) => {
        socketRef.current.emit('remove-participant', socketId, meetingCode);
    }

    const clampLocalVideoPosition = (x, y, width = localVideoSize.width, height = localVideoSize.height) => {
        const maxX = Math.max(12, window.innerWidth - width - 12);
        const maxY = Math.max(12, window.innerHeight - height - 12);
        return {
            x: Math.min(Math.max(x, 12), maxX),
            y: Math.min(Math.max(y, 12), maxY),
        };
    };

    const startDraggingLocalVideo = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragStateRef.current = {
            type: 'drag',
            startX: event.clientX,
            startY: event.clientY,
            originX: localVideoPosition.x,
            originY: localVideoPosition.y,
        };
    };

    const startResizingLocalVideo = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        resizeStateRef.current = {
            type: 'resize',
            startX: event.clientX,
            startY: event.clientY,
            startWidth: localVideoSize.width,
            startHeight: localVideoSize.height,
        };
    };

    useEffect(() => {
        const handlePointerMove = (event) => {
            if (dragStateRef.current?.type === 'drag') {
                const deltaX = event.clientX - dragStateRef.current.startX;
                const deltaY = event.clientY - dragStateRef.current.startY;
                setLocalVideoPosition(clampLocalVideoPosition(dragStateRef.current.originX + deltaX, dragStateRef.current.originY + deltaY));
            }

            if (resizeStateRef.current?.type === 'resize') {
                const deltaX = event.clientX - resizeStateRef.current.startX;
                const deltaY = event.clientY - resizeStateRef.current.startY;
                const nextWidth = Math.min(360, Math.max(180, resizeStateRef.current.startWidth + deltaX));
                const nextHeight = Math.round(nextWidth / 1.6);
                const clamped = clampLocalVideoPosition(localVideoPosition.x, localVideoPosition.y, nextWidth, nextHeight);
                setLocalVideoSize({ width: nextWidth, height: nextHeight });
                setLocalVideoPosition(clamped);
            }
        };

        const stopInteraction = () => {
            dragStateRef.current = null;
            resizeStateRef.current = null;
        };

        window.addEventListener('mousemove', handlePointerMove);
        window.addEventListener('mouseup', stopInteraction);
        return () => {
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('mouseup', stopInteraction);
        };
    }, [localVideoPosition.x, localVideoPosition.y, localVideoSize.width, localVideoSize.height]);

    const meetingParticipants = useMemo(() => {
        const uniqueParticipants = new Map();

        uniqueParticipants.set('local', {
            id: 'local',
            username: username || 'You',
            isLocal: true,
            stream: localStream,
            isVideoOn: Boolean(video && videoAvailable),
            isAudioOn: Boolean(audio && audioAvailable),
            isScreenShare: false,
        });

        participants.forEach((participant) => {
            if (!participant.socketId || participant.socketId === socketIdRef.current || !participant.username) return;
            const matchedEntry = videos.find((entry) => entry.socketId === participant.socketId);
            const stream = matchedEntry?.stream || uniqueParticipants.get(participant.socketId)?.stream || null;
            uniqueParticipants.set(participant.socketId, {
                id: participant.socketId,
                username: participant.username,
                isLocal: false,
                stream,
                isVideoOn: Boolean(participant.isVideoOn ?? stream),
                isAudioOn: participant.isAudioOn ?? true,
                isScreenShare: Boolean(matchedEntry?.isScreenShare || participant.isScreenShare),
            });
        });

        videos.forEach((videoEntry) => {
            if (!videoEntry.socketId) return;
            const existing = uniqueParticipants.get(videoEntry.socketId);
            uniqueParticipants.set(videoEntry.socketId, {
                id: videoEntry.socketId,
                username: existing?.username || videoEntry.username || 'Participant',
                isLocal: false,
                stream: videoEntry.stream,
                isVideoOn: existing?.isVideoOn ?? true,
                isAudioOn: existing?.isAudioOn ?? true,
                isScreenShare: Boolean(videoEntry.isScreenShare),
            });
        });

        return Array.from(uniqueParticipants.values());
    }, [participants, username, video, videoAvailable, audio, audioAvailable, videos, localStream]);

    const primaryContentStream = useMemo(() => {
        const sharedStream = videos.find((entry) => entry.isScreenShare)?.stream;
        if (sharedStream) return sharedStream;
        if (isSharingScreen && screenStreamRef.current) return screenStreamRef.current;
        return null;
    }, [videos, isSharingScreen]);

    useEffect(() => {
        if (primaryVideoRef.current && primaryContentStream) {
            primaryVideoRef.current.srcObject = primaryContentStream;
        }
    }, [primaryContentStream]);

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
        <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center px-4 py-12">
            {askForUsername === true ?
                <div className="w-full max-w-5xl rounded-[32px] border border-slate-200 bg-white p-10 shadow-2xl">
                    <div className="flex flex-col items-center justify-center gap-10">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-sm">
                            <VideocamIcon className="text-2xl" />
                        </div>

                        <div className="flex flex-col items-center text-center gap-3">
                            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-blue-600">Ready to join</p>
                            <h1 className="text-5xl font-bold tracking-tight text-slate-900">Enter into Lobby</h1>
                            <p className="max-w-xl text-center text-base text-slate-500">Set your name, preview your camera, and join the meeting.</p>
                        </div>

                        <div className="w-full max-w-[540px] overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-2xl">
                            <div className="aspect-[16/10] w-full">
                                <video ref={localVideoref} autoPlay muted playsInline className="h-full w-full object-cover bg-black"></video>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-3">
                            <CheckCircleIcon className="text-emerald-500" />
                            <p className="text-sm text-slate-500">Your camera is live. You can preview yourself before joining.</p>
                        </div>

                        <div className="w-full max-w-[520px]">
                            <div className="relative w-full max-w-[450px] mx-auto">
                                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
                                    <PersonIcon />
                                </div>
                                <TextField
                                    placeholder="Enter Username"
                                    value={username}
                                    onChange={e => {
                                        setUsername(e.target.value);
                                        setUsernameError(validateUsername(e.target.value));
                                    }}
                                    variant="outlined"
                                    error={Boolean(usernameError)}
                                    helperText={usernameError}
                                    fullWidth
                                    InputProps={{
                                        className: 'h-14 rounded-2xl border border-slate-200 bg-white pl-12 shadow-sm transition-all duration-200 focus-within:border-blue-500',
                                    }}
                                />
                            </div>

                            <Button
                                variant="contained"
                                onClick={connect}
                                className="mt-2.5 h-14 w-[210px] mx-auto rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-4 text-base font-bold text-white shadow-xl transition-all duration-300 hover:shadow-2xl active:scale-[0.98]"
                            >
                                Join Meeting
                            </Button>
                        </div>

                        <p className="text-center text-sm text-slate-500">🔒 Your privacy is important to us. No data is stored.</p>
                    </div>
                </div> :

            inWaitingRoom ?
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                    <h2>Waiting for the host to let you in...</h2>
                </div> :

                <div className={styles.meetVideoContainer}>
                    <div className={styles.meetingShell}>
                        <div className={styles.mainMeetingColumn}>
                            <div className={styles.meetingMainArea}>
                                <div className={styles.presentationStage}>
                                    {primaryContentStream ? (
                                        <video ref={primaryVideoRef} autoPlay playsInline muted className={styles.presentationVideo} />
                                    ) : (
                                        <div className={styles.presentationFallback}>
                                            <h3>{isSharingScreen ? 'Preparing shared content...' : 'Meeting is ready'}</h3>
                                            <p>Share your screen or wait for participants to join.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <aside className={styles.participantPanel}>
                            <div className={styles.panelHeader}>
                                <PeopleIcon />
                                <span>Participants</span>
                            </div>
                            <div className={styles.participantGrid}>
                                {meetingParticipants.map((participant) => (
                                    <ParticipantTile key={participant.id} participant={participant} />
                                ))}
                            </div>
                        </aside>

                        {showModal ? (
                            <aside className={styles.chatPanel}>
                                <div className={styles.chatPanelHeader}>
                                    <h3>Chat</h3>
                                    <div className={styles.chatPanelBadge}>{messages.length}</div>
                                </div>
                                <div className={styles.chatMessages}>
                                    {messages.length !== 0 ? messages.map((item, index) => (
                                        <div className={styles.chatMessageBubble} key={index}>
                                            <p className={styles.chatMessageAuthor}>{item.sender}</p>
                                            <p className={styles.chatMessageText}>{item.data}</p>
                                        </div>
                                    )) : <div className={styles.emptyState}>No messages yet. Start the conversation.</div>}
                                </div>
                                <div className={styles.chatComposer}>
                                    <TextField
                                        inputRef={chatInputRef}
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        onKeyDown={handleChatKeyDown}
                                        id="outlined-basic"
                                        label="Type a message"
                                        variant="outlined"
                                        fullWidth
                                        size="small"
                                    />
                                    <Button variant='contained' onClick={sendMessage}>Send</Button>
                                </div>
                            </aside>
                        ) : null}
                    </div>

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

                    <div
                        className={styles.localVideoShell}
                        style={{ left: localVideoPosition.x, top: localVideoPosition.y, width: localVideoSize.width, height: localVideoSize.height }}
                        onMouseDown={startDraggingLocalVideo}
                    >
                        <video
                            className={styles.meetUserVideo}
                            ref={localVideoref}
                            autoPlay
                            muted
                            playsInline
                        ></video>
                        <div className={styles.localVideoResizeHandle} onMouseDown={startResizingLocalVideo} />
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
                                        <ListItemText primary={u.username || 'Guest'} />
                                    </ListItem>
                                ))}
                                {waitingUsers.length === 0 && <p style={{marginLeft: '15px'}}>No one is waiting.</p>}
                            </List>
                            <hr />
                            <h3>In Meeting ({participants.filter((participant) => participant.username).length + 1})</h3>
                            <List>
                                <ListItem>
                                    <ListItemText primary={`${username || 'You'} (You)`} />
                                </ListItem>
                                {participants.filter((participant) => participant.username && participant.socketId !== socketIdRef.current).map((participant) => (
                                    <ListItem key={participant.socketId || participant.username} secondaryAction={
                                        isHost ? <Button size="small" variant="outlined" color="error" onClick={() => removeUser(participant.socketId)}>Remove</Button> : null
                                    }>
                                        <ListItemText primary={participant.isHost ? `${participant.username || 'Guest'} (Host)` : (participant.username || 'Guest')} />
                                    </ListItem>
                                ))}
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