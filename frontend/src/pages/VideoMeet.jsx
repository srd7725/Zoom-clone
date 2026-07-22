import React, { useEffect, useRef, useState, useContext, useMemo } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText, Snackbar } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import SettingsIcon from '@mui/icons-material/Settings';
import styles from "../styles/videoComponent.module.css";
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

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

const ParticipantTile = ({ participant }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && participant.stream) {
            videoRef.current.srcObject = participant.stream;
        }
    }, [participant.stream]);

    const initials = (participant.username || 'You').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    const displayName = `${participant.username || 'You'}${participant.isHost ? ' (Host)' : ''}`;

    return (
        <div className={styles.participantTile} style={{ position: 'relative' }}>
            {participant.stream && participant.isVideoOn ? (
                <video ref={videoRef} autoPlay playsInline muted className={styles.participantVideo} />
            ) : (
                <div className={styles.participantAvatar}>
                    <span>{initials || 'U'}</span>
                    <div className="absolute top-2 right-2 bg-red-500/90 p-1.5 rounded-full text-white flex items-center justify-center shadow-lg border border-red-500/20">
                        <VideocamOffIcon sx={{ fontSize: 16 }} />
                    </div>
                </div>
            )}
            
            {/* Status Icons Overlay */}
            {participant.isVideoOn && !participant.isAudioOn && (
                <div className="absolute top-2 left-2 bg-red-500/90 p-1.5 rounded-full text-white flex items-center justify-center shadow-lg border border-red-500/20">
                    <MicOffIcon sx={{ fontSize: 16 }} />
                </div>
            )}
            
            {!participant.isVideoOn && !participant.isAudioOn && (
                <div className="absolute top-2 left-2 bg-red-500/90 p-1.5 rounded-full text-white flex items-center justify-center shadow-lg border border-red-500/20">
                    <MicOffIcon sx={{ fontSize: 16 }} />
                </div>
            )}

            <div className={styles.participantLabel}>{displayName}</div>
        </div>
    );
};

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
    let [videos, setVideos] = useState([])

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
    let [isSharingScreen, setIsSharingScreen] = useState(false);

    useEffect(() => {
        validateMeeting();
        return () => {
            if (socketRef.current) {
                socketRef.current.emit('leave-room', meetingCode);
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

    const attachLocalPreview = (stream = cameraStreamRef.current) => {
        if (localVideoref.current && stream) {
            localVideoref.current.srcObject = stream;
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
                syncLocalStream(stream, { shouldPreview: true, isScreenShare: false });
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

    let getMedia = (initialVideo = videoAvailable, initialAudio = audioAvailable) => {
        setVideo(initialVideo);
        setAudio(initialAudio);
        connectToSocketServer({ initialVideo, initialAudio });
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
        if (shouldPreview && !isScreenShare) {
            attachLocalPreview(stream);
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

    const replaceCameraStream = (stream, options = {}) => {
        const previousStream = cameraStreamRef.current;
        if (previousStream && previousStream !== stream) {
            stopMediaStream(previousStream);
        }
        cameraStreamRef.current = stream;
        syncLocalStream(stream, { shouldPreview: true, isScreenShare: false, ...options });
    };

    let getUserMediaSuccess = (stream) => {
        replaceCameraStream(stream);

        stream.getTracks().forEach((track) => {
            track.onended = () => {
                if (track.kind === 'video') {
                    setVideo(false);
                    socketRef.current?.emit('participant-camera-disabled', meetingCode);
                }
                if (track.kind === 'audio') {
                    setAudio(false);
                    socketRef.current?.emit('participant-muted', meetingCode);
                }
                try {
                    stream.getTracks().forEach((trackToStop) => trackToStop.stop());
                } catch (e) { console.log(e) }
                const blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                syncLocalStream(blackSilence());
            };
        });
    };

    let getUserMedia = () => {
        const wantsVideo = Boolean(video && videoAvailable && canUseCamera);
        const wantsAudio = Boolean(audio && audioAvailable && canUseMic);

        if (!wantsVideo && !wantsAudio) {
            stopMediaStream(cameraStreamRef.current);
            cameraStreamRef.current = null;
            const blackSilence = (...args) => new MediaStream([black(...args), silence()]);
            syncLocalStream(blackSilence());
            return;
        }

        navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: wantsAudio })
            .then(getUserMediaSuccess)
            .catch((error) => {
                if (wantsVideo && wantsAudio) {
                    navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: false })
                        .then((stream) => {
                            setAudio(false);
                            getUserMediaSuccess(stream);
                        })
                        .catch(() => {
                            setVideo(false);
                            setAudio(false);
                            stopMediaStream(cameraStreamRef.current);
                            cameraStreamRef.current = null;
                            const blackSilence = (...args) => new MediaStream([black(...args), silence()]);
                            syncLocalStream(blackSilence());
                            setSnackMessage(error?.name === 'NotReadableError' ? 'Camera is already in use by another browser or app.' : 'Unable to start camera.');
                            setSnackOpen(true);
                        });
                    return;
                }

                if (wantsVideo) {
                    setVideo(false);
                    socketRef.current?.emit('participant-camera-disabled', meetingCode);
                }
                if (wantsAudio) {
                    setAudio(false);
                    socketRef.current?.emit('participant-muted', meetingCode);
                }
                setSnackMessage(error?.name === 'NotReadableError' ? 'Camera or microphone is already in use by another browser or app.' : 'Unable to start media device.');
                setSnackOpen(true);
            });
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

    let connectToSocketServer = ({ initialVideo = video, initialAudio = audio } = {}) => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        socketRef.current = io(server_url, { transports: ['websocket'], reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });

        socketRef.current.on('connect', () => {
            socketIdRef.current = socketRef.current.id;
            socketRef.current.emit('join-room', { 
                roomName: meetingCode, 
                username, 
                isHost,
                isVideoOn: Boolean(initialVideo && videoAvailable),
                isAudioOn: Boolean(initialAudio && audioAvailable)
            });

            socketRef.current.on('chat-message', addMessage);

            socketRef.current.on('waiting-room-list', (list) => {
                setWaitingUsers(list || []);
            });

            socketRef.current.on('waiting-room-request', (data) => {
                setWaitingUsers(prev => {
                    if (prev.some(u => u.socketId === data.socketId)) return prev;
                    return [...prev, data];
                });
                setSnackMessage(`${data.username} wants to join`);
                setSnackOpen(true);
            });

            socketRef.current.on('waiting-room-status', (data) => {
                setSnackMessage(data.message);
                setSnackOpen(true);
            });

            socketRef.current.on('admitted', () => {
                setInWaitingRoom(false);
                setAskForUsername(false);
                setSnackMessage('You have been admitted into the meeting.');
                setSnackOpen(true);
            });

            socketRef.current.on('participant-admitted', () => {
                setInWaitingRoom(false);
                setAskForUsername(false);
            });

            socketRef.current.on('rejected', () => {
                setSnackMessage("Host declined your request.");
                setSnackOpen(true);
                setTimeout(() => window.location.href = "/home", 1500);
            });

            socketRef.current.on('participant-rejected', () => {
                setSnackMessage("Host declined your request.");
                setSnackOpen(true);
                setTimeout(() => window.location.href = "/home", 1500);
            });

            socketRef.current.on('meeting-ended', () => {
                setSnackMessage("Meeting has ended.");
                setSnackOpen(true);
                setTimeout(() => window.location.href = "/home", 1500);
            });
            
            socketRef.current.on('removed-by-host', () => {
                setSnackMessage("You have been removed from the meeting.");
                setSnackOpen(true);
                setTimeout(() => window.location.href = "/home", 1500);
            });

            socketRef.current.on('participant-removed', () => {
                setSnackMessage("You have been removed from the meeting.");
                setSnackOpen(true);
                setTimeout(() => window.location.href = "/home", 1500);
            });

            socketRef.current.on('participant-muted', () => {
                setAudio(false);
                setSnackMessage("The host has muted your microphone.");
                setSnackOpen(true);
            });

            socketRef.current.on('participant-unmuted', () => {
                setSnackMessage("The host has allowed you to unmute.");
                setSnackOpen(true);
            });

            socketRef.current.on('participant-camera-disabled', () => {
                setVideo(false);
                setSnackMessage("The host has disabled your camera.");
                setSnackOpen(true);
            });

            socketRef.current.on('participant-camera-enabled', () => {
                setSnackMessage("The host has allowed you to start your video.");
                setSnackOpen(true);
            });

            socketRef.current.on('offer', handleOffer);
            socketRef.current.on('answer', handleAnswer);
            socketRef.current.on('ice-candidate', handleIceCandidate);

            socketRef.current.on('user-connected', (participant) => {
                setInWaitingRoom(false);
                setAskForUsername(false);
                if (participant.socketId && participant.socketId !== socketIdRef.current) {
                    ensurePeerConnection(participant.socketId);
                    createOfferForPeer(participant.socketId);
                }
            });

            socketRef.current.on('participants-updated', (participantsList) => {
                setParticipants(participantsList || []);
            });

            socketRef.current.on('user-disconnected', ({ socketId }) => {
                setVideos((prevVideos) => prevVideos.filter((video) => video.socketId !== socketId));
                if (peerConnectionsRef.current[socketId]) {
                    peerConnectionsRef.current[socketId].close();
                    delete peerConnectionsRef.current[socketId];
                }
            });
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
        if (!canUseCamera) return;
        const nextVideo = !video;
        setVideo(nextVideo);
        socketRef.current?.emit(nextVideo ? 'participant-camera-enabled' : 'participant-camera-disabled', meetingCode);
    }
    let handleAudio = () => {
        if (!canUseMic) return;
        const nextAudio = !audio;
        setAudio(nextAudio);
        socketRef.current?.emit(nextAudio ? 'participant-unmuted' : 'participant-muted', meetingCode);
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
        const trimmedMessage = message.trim();
        if (!trimmedMessage || !socketRef.current) return;
        socketRef.current.emit('chat-message', trimmedMessage, username)
        setMessage("");
        chatInputRef.current?.focus();
    }

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

    const muteAllParticipants = () => {
        socketRef.current?.emit('mute-all-participants', meetingCode);
    };

    const allowMicAllParticipants = () => {
        socketRef.current?.emit('allow-mic-all-participants', meetingCode);
    };

    const stopCameraAllParticipants = () => {
        socketRef.current?.emit('stop-camera-all-participants', meetingCode);
    };

    const allowCameraAllParticipants = () => {
        socketRef.current?.emit('allow-camera-all-participants', meetingCode);
    };

    const toggleParticipantMicPermission = (participantSocketId, isAllowed) => {
        if (!socketRef.current) return;
        if (isAllowed) {
            socketRef.current.emit("mute-participant", participantSocketId, meetingCode);
        } else {
            socketRef.current.emit("allow-mic-participant", participantSocketId, meetingCode);
        }
    };

    const toggleParticipantCameraPermission = (participantSocketId, isAllowed) => {
        if (!socketRef.current) return;
        if (isAllowed) {
            socketRef.current.emit("stop-camera-participant", participantSocketId, meetingCode);
        } else {
            socketRef.current.emit("allow-camera-participant", participantSocketId, meetingCode);
        }
    };

    useEffect(() => {
        if (!socketIdRef.current) return;
        const me = participants.find(p => p.socketId === socketIdRef.current);
        if (me) {
            if (me.canUseMic === false && audio !== false) {
                setAudio(false);
                setSnackMessage("The host has muted your microphone.");
                setSnackOpen(true);
            }
            if (me.canUseCamera === false && video !== false) {
                setVideo(false);
                setSnackMessage("The host has disabled your camera.");
                setSnackOpen(true);
            }
        }
    }, [participants, audio, video]);

    const localParticipantMetadata = participants.find(p => p.socketId === socketIdRef.current);
    const canUseMic = localParticipantMetadata?.canUseMic !== false;
    const canUseCamera = localParticipantMetadata?.canUseCamera !== false;

    const meetingParticipants = useMemo(() => {
        const list = [
            {
                id: 'local',
                username: username || 'You',
                isLocal: true,
                isHost,
                stream: cameraStreamRef.current,
                isVideoOn: Boolean(video && videoAvailable) && (localParticipantMetadata ? localParticipantMetadata.isVideoOn !== false : true),
                isAudioOn: Boolean(audio && audioAvailable) && (localParticipantMetadata ? localParticipantMetadata.isAudioOn !== false : true),
                isScreenShare: false,
            },
        ];

        participants.forEach((participant) => {
            if (!participant.username || participant.socketId === socketIdRef.current) return;
            const matchedStream = videos.find((entry) => entry.socketId === participant.socketId)?.stream;
            list.push({
                id: participant.socketId || participant.username,
                username: participant.username,
                isLocal: false,
                isHost: participant.isHost === true,
                stream: matchedStream,
                isVideoOn: participant.isVideoOn !== false && Boolean(matchedStream),
                isAudioOn: participant.isAudioOn !== false,
                isScreenShare: Boolean(matchedStream && participant.isScreenShare),
            });
        });

        return list;
    }, [participants, username, video, videoAvailable, audio, audioAvailable, videos, localParticipantMetadata]);

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

    useEffect(() => {
        if (!primaryContentStream && cameraStreamRef.current) {
            attachLocalPreview(cameraStreamRef.current);
        }
    }, [askForUsername, inWaitingRoom, primaryContentStream, video, audio]);

    const hostParticipant = meetingParticipants.find((participant) => participant.isLocal) || meetingParticipants[0];
    const attendeeParticipants = meetingParticipants.filter((participant) => !participant.isLocal);
    const visibleAttendees = attendeeParticipants.slice(0, 6);
    const hiddenParticipantCount = Math.max(attendeeParticipants.length - visibleAttendees.length, 0);
    const hasActiveLocalVideo = Boolean(cameraStreamRef.current?.getVideoTracks?.().some((track) => track.readyState === 'live' && track.enabled !== false));
    const hasActiveLocalAudio = Boolean(cameraStreamRef.current?.getAudioTracks?.().some((track) => track.readyState === 'live' && track.enabled !== false));
    const hostInitials = (hostParticipant?.username || username || 'You')
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

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
                <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-gradient-to-br from-[#2D263B] via-[#1F1B2C] to-[#120F1A] px-4 py-8 text-white sm:px-6 md:py-12">
                    <main className="w-full max-w-[880px] rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-8 md:p-10">
                        <header className="mb-8 text-center">
                            <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Enter into Lobby</h2>
                            <p className="mt-3 text-base text-gray-400 sm:text-lg">Preview your camera before joining</p>
                        </header>

                        <section className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-slate-950 shadow-2xl" aria-label="Camera preview">
                            {videoAvailable && video !== false ? (
                                <video ref={localVideoref} autoPlay muted playsInline className="h-full w-full object-cover"></video>
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center px-6 text-center bg-gradient-to-b from-slate-900 to-slate-950">
                                    <span className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/[0.04] text-slate-400 border border-white/10 shadow-lg">
                                        <VideocamOffIcon sx={{ fontSize: 36 }} />
                                    </span>
                                    <p className="text-xl font-semibold tracking-wide text-white">Camera is off</p>
                                    <p className="mt-2 text-sm text-slate-400 max-w-xs">You can still join with camera off.</p>
                                </div>
                            )}

                            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-6 pt-16">
                                <button
                                    type="button"
                                    onClick={handleAudio}
                                    aria-label={audioAvailable ? 'Toggle microphone' : 'Microphone unavailable'}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all duration-300 transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black ${
                                        audioAvailable && audio !== false
                                            ? 'border-white/10 bg-white/10 text-white hover:bg-white/20 focus:ring-indigo-500'
                                            : 'border-red-500/30 bg-red-500/80 text-white hover:bg-red-500 focus:ring-red-500'
                                    }`}
                                >
                                    {audioAvailable && audio !== false ? <MicIcon /> : <MicOffIcon />}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleVideo}
                                    aria-label={videoAvailable ? 'Toggle camera' : 'Camera unavailable'}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-all duration-300 transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black ${
                                        videoAvailable && video !== false
                                            ? 'border-white/10 bg-white/10 text-white hover:bg-white/20 focus:ring-indigo-500'
                                            : 'border-red-500/30 bg-red-500/80 text-white hover:bg-red-500 focus:ring-red-500'
                                    }`}
                                >
                                    {videoAvailable && video !== false ? <VideocamIcon /> : <VideocamOffIcon />}
                                </button>
                                <button
                                    type="button"
                                    aria-label="Open camera settings"
                                    className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white shadow-lg backdrop-blur-md transition-all duration-300 transform hover:scale-105 active:scale-95 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-black"
                                >
                                    <SettingsIcon />
                                </button>
                            </div>
                        </section>

                        <div className="mt-8 space-y-2">
                            <label htmlFor="lobby-username" className="block text-sm font-medium text-slate-300 tracking-wide">
                                Your name
                            </label>
                            <input
                                id="lobby-username"
                                type="text"
                                value={username}
                                onChange={e => {
                                    setUsername(e.target.value);
                                    setUsernameError(validateUsername(e.target.value));
                                }}
                                placeholder="Enter your name"
                                aria-invalid={Boolean(usernameError)}
                                aria-describedby={usernameError ? 'username-error' : undefined}
                                className="h-14 w-full rounded-xl border border-white/10 bg-white/[0.03] px-5 text-base text-white placeholder:text-slate-500 outline-none transition-all duration-300 focus:border-indigo-500 focus:bg-white/[0.06] focus:ring-4 focus:ring-indigo-500/20"
                            />
                            {usernameError && (
                                <p id="username-error" className="mt-1 text-sm font-medium text-red-400">
                                    {usernameError}
                                </p>
                            )}
                        </div>

                        <p className="mt-6 min-h-5 text-center text-sm text-slate-400">
                            {previewMessage || 'Your camera is live. You can preview yourself before joining.'}
                        </p>
                        <button
                            type="button"
                            onClick={connect}
                            className="mt-6 flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-base font-bold text-white shadow-[0_12px_30px_rgba(99,102,241,0.35)] transition-all duration-300 hover:scale-[1.01] hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-indigo-500/30"
                        >
                            Join Meeting
                        </button>
                    </main>
                </div> :

            inWaitingRoom ?
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                    <h2>Waiting for the host to let you in...</h2>
                </div> :

                <div className={styles.meetVideoContainer}>
                    <div className={styles.buttonContainers}>
                        <IconButton 
                            onClick={handleVideo} 
                            disabled={!canUseCamera}
                            style={{ color: canUseCamera ? "white" : "rgba(255,255,255,0.3)" }}
                            title={!canUseCamera ? "Disabled by Host" : (video === true ? "Turn off camera" : "Turn on camera")}
                        >
                            {(video === true && canUseCamera) ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton 
                            onClick={handleAudio} 
                            disabled={!canUseMic}
                            style={{ color: canUseMic ? "white" : "rgba(255,255,255,0.3)" }}
                            title={!canUseMic ? "Disabled by Host" : (audio === true ? "Mute" : "Unmute")}
                        >
                            {(audio === true && canUseMic) ? <MicIcon /> : <MicOffIcon />}
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

                    <div className={styles.meetingMainArea}>
                        <section className={styles.hostStage}>
                            <div className={styles.hostVideoCard}>
                                {primaryContentStream ? (
                                    <video ref={primaryVideoRef} autoPlay playsInline muted className={styles.presentationVideo} />
                                ) : (
                                    <>
                                        <video
                                            className={styles.meetUserVideo}
                                            ref={localVideoref}
                                            autoPlay
                                            muted
                                            playsInline
                                        ></video>
                                        {!hasActiveLocalVideo && (
                                            <div className={styles.hostAvatar}>
                                                <span>{hostInitials || 'Y'}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div className={styles.hostStatusBar}>
                                    <span>{username || 'You'} {isHost ? '(Host)' : ''}</span>
                                    <div className={styles.statusPills}>
                                        <span className={(hostParticipant?.isAudioOn || hasActiveLocalAudio) ? styles.statusPill : styles.statusPillOff}>
                                            {(hostParticipant?.isAudioOn || hasActiveLocalAudio) ? <MicIcon sx={{ fontSize: 16 }} /> : <MicOffIcon sx={{ fontSize: 16 }} />}
                                        </span>
                                        <span className={(hostParticipant?.isVideoOn || hasActiveLocalVideo) ? styles.statusPill : styles.statusPillOff}>
                                            {(hostParticipant?.isVideoOn || hasActiveLocalVideo) ? <VideocamIcon sx={{ fontSize: 16 }} /> : <VideocamOffIcon sx={{ fontSize: 16 }} />}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <aside className={styles.sidePanel}>
                            <div className={styles.panelHeader}>
                                <div>
                                    <p className={styles.panelEyebrow}>In meeting</p>
                                    <h2>Participants</h2>
                                </div>
                                {hiddenParticipantCount > 0 && (
                                    <span className={styles.viewMoreBadge}>+{hiddenParticipantCount} more</span>
                                )}
                            </div>

                            <div className={styles.participantGrid}>
                                {visibleAttendees.map((participant) => (
                                    <ParticipantTile key={participant.id} participant={participant} />
                                ))}
                                {visibleAttendees.length === 0 && (
                                    <div className={styles.emptyParticipants}>
                                        <PeopleIcon />
                                        <p>No participants yet</p>
                                    </div>
                                )}
                            </div>

                            {showModal && (
                                <div className={styles.chatCard}>
                                    <div className={styles.chatHeader}>
                                        <div>
                                            <p className={styles.panelEyebrow}>Live room</p>
                                            <h2>Chat</h2>
                                        </div>
                                        <span>{messages.length}</span>
                                    </div>
                                    <div className={styles.chattingDisplay}>
                                        {messages.length !== 0 ? messages.map((item, index) => (
                                            <div className={styles.chatBubble} key={index}>
                                                <p>{item.sender}</p>
                                                <span>{item.data}</span>
                                            </div>
                                        )) : <p className={styles.emptyChat}>No messages yet</p>}
                                    </div>
                                    <div className={styles.chattingArea}>
                                        <input
                                            ref={chatInputRef}
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            onKeyDown={handleChatKeyDown}
                                            placeholder="Enter your chat"
                                            className={styles.chatInput}
                                        />
                                        <button type="button" className={styles.sendButton} onClick={sendMessage}>Send</button>
                                    </div>
                                </div>
                            )}
                        </aside>
                    </div>
                    
                    {/* Participants Modal for Host */}
                    <Dialog open={showParticipants} onClose={() => setShowParticipants(false)} fullWidth maxWidth="sm">
                        <DialogTitle>Participants & Waiting Room</DialogTitle>
                        <DialogContent>
                            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px', marginTop: '10px' }}>
                                Waiting Room ({waitingUsers.length})
                            </h3>
                            <List>
                                {waitingUsers.map(u => {
                                    const initials = (u.username || 'Guest').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
                                    const timeStr = u.joinedAt ? new Date(u.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
                                    return (
                                        <ListItem key={u.socketId} secondaryAction={
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <Button size="small" variant="contained" color="success" onClick={() => admitUser(u.socketId)}>Admit</Button>
                                                <Button size="small" variant="contained" color="error" onClick={() => rejectUser(u.socketId)}>Reject</Button>
                                            </div>
                                        }>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div className="flex w-10 h-10 items-center justify-center rounded-full bg-indigo-600 text-white font-bold text-sm shadow-md">
                                                    {initials || 'G'}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-800 m-0" style={{ margin: 0 }}>{u.username || 'Guest'}</p>
                                                    <p className="text-xs text-slate-500 m-0" style={{ margin: 0 }}>Requested: {timeStr}</p>
                                                </div>
                                            </div>
                                        </ListItem>
                                    );
                                })}
                                {waitingUsers.length === 0 && <p style={{marginLeft: '15px', color: '#64748b'}}>No one is waiting.</p>}
                            </List>
                            <hr style={{ margin: '20px 0', borderColor: '#e2e8f0' }} />
                            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>
                                In Meeting ({participants.filter((participant) => participant.username).length + 1})
                            </h3>
                            {isHost && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginBottom: '14px' }}>
                                    <Button size="small" variant="contained" color="warning" onClick={muteAllParticipants}>Mute All</Button>
                                    <Button size="small" variant="outlined" color="success" onClick={allowMicAllParticipants}>Allow Mic All</Button>
                                    <Button size="small" variant="contained" color="error" onClick={stopCameraAllParticipants}>Stop Camera All</Button>
                                    <Button size="small" variant="outlined" color="primary" onClick={allowCameraAllParticipants}>Allow Camera All</Button>
                                </div>
                            )}
                            <List>
                                <ListItem>
                                    <ListItemText primary={`${username || 'You'} (You)`} />
                                </ListItem>
                                {participants.filter((participant) => participant.username && participant.socketId !== socketIdRef.current).map((participant) => (
                                    <ListItem key={participant.socketId || participant.username} secondaryAction={
                                        isHost ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <IconButton 
                                                    size="small" 
                                                    color={participant.canUseMic !== false ? "primary" : "error"}
                                                    onClick={() => toggleParticipantMicPermission(participant.socketId, participant.canUseMic !== false)}
                                                    title={participant.canUseMic !== false ? "Mute Microphone" : "Allow Microphone"}
                                                >
                                                    {participant.canUseMic !== false ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}
                                                </IconButton>
                                                <IconButton 
                                                    size="small" 
                                                    color={participant.canUseCamera !== false ? "primary" : "error"}
                                                    onClick={() => toggleParticipantCameraPermission(participant.socketId, participant.canUseCamera !== false)}
                                                    title={participant.canUseCamera !== false ? "Stop Camera" : "Allow Camera"}
                                                >
                                                    {participant.canUseCamera !== false ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}
                                                </IconButton>
                                                <Button size="small" variant="outlined" color="error" onClick={() => removeUser(participant.socketId)}>
                                                    Remove
                                                </Button>
                                            </div>
                                        ) : null
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
