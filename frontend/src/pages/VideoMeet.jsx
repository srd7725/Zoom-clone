import React, { useEffect, useRef, useState, useContext, useMemo } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText, Snackbar, TextField, MenuItem, Select, FormControl, InputLabel } from '@mui/material';
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
import GridViewIcon from '@mui/icons-material/GridView';
import BrushIcon from '@mui/icons-material/Brush';
import server from '../environment';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';
import CollaborativeWhiteboard from './CollaborativeWhiteboard';

const server_url = server;

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

// Thresholds use WebRTC RTT/jitter seconds converted to milliseconds and interval packet loss.
const NETWORK_QUALITY_THRESHOLDS = {
    rttFairMs: 250,
    rttPoorMs: 500,
    packetLossFair: 0.03,
    packetLossPoor: 0.08,
    jitterFairMs: 20,
    jitterPoorMs: 40,
    availableBitrateFair: 900_000,
    availableBitratePoor: 300_000,
    unavailableAfterMs: 15_000,
    degradedSamplesRequired: 2,
    healthySamplesRequired: 3,
};

const attachStreamToVideoElement = (videoElement, stream, options = {}) => {
    const { muted = false, autoPlay = true, playsInline = true } = options;
    if (!videoElement) return;

    const hasSameStream = videoElement.srcObject === stream;
    if (!hasSameStream) {
        videoElement.srcObject = stream;
    }
    if (!stream) return;

    if (videoElement.muted !== muted) {
        videoElement.muted = muted;
    }
    videoElement.autoplay = autoPlay;
    videoElement.playsInline = playsInline;

    const playPromise = videoElement.play();
    if (playPromise?.catch) {
        playPromise.catch(() => {});
    }
};

const getSenderForTrackKind = (peerConnection, kind) => {
    const transceiver = peerConnection.getTransceivers().find((entry) =>
        !entry.stopped && entry.receiver.track.kind === kind
    );
    return transceiver
        ? { sender: transceiver.sender, transceiver }
        : { sender: peerConnection.getSenders().find((sender) => sender.track?.kind === kind), transceiver: null };
};

const getMediaWithAudioProcessingFallback = async (constraints) => {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        const audioConstraints = constraints.audio;
        const audioConstraintFailure = error?.name === 'OverconstrainedError' &&
            audioConstraints && typeof audioConstraints === 'object' &&
            ['echoCancellation', 'noiseSuppression', 'autoGainControl'].includes(error.constraint);
        if (!audioConstraintFailure) throw error;

        console.warn('[MEDIA] Browser rejected an audio-processing constraint; retrying with default audio processing.', {
            constraint: error.constraint,
        });
        return navigator.mediaDevices.getUserMedia({ ...constraints, audio: true });
    }
};

window.debugStats = window.debugStats || {
    peerConnections: 0,
    rtpSenders: 0,
    audioTracks: 0,
    videoTracks: 0,
    createOffer: 0,
    createAnswer: 0,
    ontrack: 0
};

const ParticipantTile = React.memo(({ participant }) => {
    const videoRef = useRef(null);
    const audioRef = useRef(null);
    const [playbackError, setPlaybackError] = useState(false);
    const [hasVideoFrame, setHasVideoFrame] = useState(false);
    const hasVideoTrack = Boolean(participant.stream && participant.isVideoOn);
    const audioTrackKey = participant.stream?.getAudioTracks?.().map((track) => track.id).join(',') || '';

    useEffect(() => {
        const videoElement = videoRef.current;
        if (videoElement && participant.stream && hasVideoTrack) {
            videoElement.srcObject = participant.stream;
            // Remote audio is played by the separate audio element below; keep the
            // video element muted to avoid playing the same audio twice.
            videoElement.muted = true;
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            setPlaybackError(false);
            setHasVideoFrame(false);
            videoElement.play()?.catch(() => setPlaybackError(true));
        } else if (videoElement) {
            videoElement.srcObject = null;
        }

        return () => {
            if (videoElement) videoElement.srcObject = null;
        };
    }, [participant.stream, hasVideoTrack]);

    useEffect(() => {
        const audioElement = audioRef.current;
        const audioTracks = participant.stream?.getAudioTracks?.() || [];
        if (!participant.isLocal && audioElement && audioTracks.length) {
            const audioOnlyStream = new MediaStream(audioTracks);
            audioElement.srcObject = audioOnlyStream;
            audioElement.play()?.catch((error) => {
                console.warn('[AUDIO] Remote audio playback was blocked or failed.', {
                    participantId: participant.id,
                    errorName: error?.name,
                });
            });
        } else if (audioElement) {
            audioElement.srcObject = null;
        }

        return () => {
            if (audioElement) {
                audioElement.pause();
                audioElement.srcObject = null;
            }
        };
    }, [participant.stream, audioTrackKey, participant.isLocal, participant.id]);

    const initials = (participant.username || 'You').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    const displayName = `${participant.username || 'You'}${participant.isHost ? ' (Host)' : ''}`;
    const hasVideo = hasVideoTrack && hasVideoFrame && !playbackError;
    const videoStatus = participant.isCameraEnabled === false
        ? 'Camera off'
        : playbackError
            ? 'Video playback blocked'
            : hasVideo
                ? 'Video receiving'
                : hasVideoTrack
                    ? 'Video track received; waiting for frames'
                    : participant.connectionState === 'failed'
                        ? 'Connection failed'
                        : participant.connectionState === 'disconnected'
                            ? 'Connection interrupted; reconnecting'
                            : participant.connectionState === 'connected'
                                ? 'Connected; no video track received'
                                : 'Connecting; waiting for video track';

    return (
        <div className={styles.participantTile}>
            {!participant.isLocal && participant.stream?.getAudioTracks?.().length > 0 && (
                <audio ref={audioRef} autoPlay playsInline muted={!participant.isAudioOn} />
            )}
            {hasVideoTrack && (
                <video
                    ref={videoRef}
                    autoPlay playsInline muted
                    onLoadedData={(event) => {
                        setHasVideoFrame(true);
                        console.info("[MEDIA_DIAG] Remote video element received frame data", {
                            participantId: participant.id,
                            trackIds: participant.stream?.getVideoTracks?.().map((track) => track.id) || [],
                            videoWidth: event.currentTarget.videoWidth,
                            videoHeight: event.currentTarget.videoHeight,
                            readyState: event.currentTarget.readyState,
                        });
                    }}
                    onPlaying={(event) => {
                        setHasVideoFrame(true);
                        console.info("[MEDIA_DIAG] Remote video playback started", {
                            participantId: participant.id,
                            videoWidth: event.currentTarget.videoWidth,
                            videoHeight: event.currentTarget.videoHeight,
                        });
                    }}
                    className={styles.participantVideo}
                />
            )}
            {!hasVideoTrack && (
                <div className={styles.participantAvatar}>
                    <span>{initials || 'U'}</span>
                </div>
            )}
            <div className={styles.participantStatus} aria-label="Participant audio and video status">
                <span
                    className={participant.isAudioOn ? styles.statusPill : styles.statusPillOff}
                    title={participant.isAudioOn ? 'Microphone on' : 'Microphone off'}
                >
                    {participant.isAudioOn ? <MicIcon sx={{ fontSize: 15 }} /> : <MicOffIcon sx={{ fontSize: 15 }} />}
                </span>
                <span
                    className={hasVideo ? styles.statusPill : styles.statusPillOff}
                    title={videoStatus}
                    aria-label={videoStatus}
                >
                    {hasVideo ? <VideocamIcon sx={{ fontSize: 15 }} /> : <VideocamOffIcon sx={{ fontSize: 15 }} />}
                </span>
            </div>
            <div className={styles.participantLabel}>
                <span>{displayName}</span>
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
    const pendingNegotiationRef = useRef({});
    const makingOfferRef = useRef({});
    const cameraStreamRef = useRef(null);
    const screenStreamRef = useRef(null);
    const pendingIceCandidatesRef = useRef({});
    const primaryVideoRef = useRef(null);
    const localLobbyVideoRef = useRef(null);
    const localWaitingRoomVideoRef = useRef(null);
    const localMeetingVideoRef = useRef(null);
    const chatInputRef = useRef(null);
    const chatOpenRef = useRef(true);
    const peerRecoveryRef = useRef({});
    const statsPreviousRef = useRef({});
    const statsPollInFlightRef = useRef(false);
    const networkAssessmentRef = useRef({
        startedAt: Date.now(),
        stableQuality: "Checking",
        candidateQuality: null,
        candidateCount: 0,
        previousPeerStats: {},
    });
    const qualityLastChangedRef = useRef(Date.now());
    const senderQualityRef = useRef(new WeakMap());
    var socketRef = useRef();
    let socketIdRef = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);
    let [audioAvailable, setAudioAvailable] = useState(true);
    const [localStream, setLocalStream] = useState(null);
    const [peerStates, setPeerStates] = useState({});
    let [video, setVideo] = useState(false);
    let [audio, setAudio] = useState(false);
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
    const [networkQuality, setNetworkQuality] = useState("Checking");
    const [networkQualityDetails, setNetworkQualityDetails] = useState("Waiting for WebRTC connection measurements.");
    const [activeVideoQuality, setActiveVideoQuality] = useState("Medium");
    const [videoQualityMode, setVideoQualityMode] = useState("auto");
    const [qualityWarning, setQualityWarning] = useState("");
    const [breakoutState, setBreakoutState] = useState({ active: false, rooms: {}, assignments: {} });
    const [currentBreakoutRoom, setCurrentBreakoutRoom] = useState(null);
    const [showBreakoutDialog, setShowBreakoutDialog] = useState(false);
    const [breakoutRoomNames, setBreakoutRoomNames] = useState(["Room 1", "Room 2"]);
    const [breakoutMode, setBreakoutMode] = useState("auto");
    const [breakoutAssignments, setBreakoutAssignments] = useState({});
    const [whiteboardOpen, setWhiteboardOpen] = useState(false);

    useEffect(() => {
        validateMeeting();
        return () => {
            if (socketRef.current) {
                socketRef.current.emit('leave-room', meetingCode);
                socketRef.current.disconnect();
            }
            stopMediaStream(cameraStreamRef.current);
            stopMediaStream(screenStreamRef.current);
            Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
            peerConnectionsRef.current = {};
            Object.values(peerRecoveryRef.current).forEach((recovery) => {
                clearTimeout(recovery.graceTimer);
                clearTimeout(recovery.retryTimer);
            });
            peerRecoveryRef.current = {};
            Object.values(remoteVideosRef.current).forEach(stream => {
                if (stream && typeof stream.getTracks === 'function') {
                    stream.getTracks().forEach((track) => track.stop());
                }
            });
            remoteVideosRef.current = {};
            pendingIceCandidatesRef.current = {};
        };
    }, []);

    const stopMediaStream = (stream) => {
        if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach((track) => track.stop());
        }
    };

    const attachLocalStreamToAllLocalVideoElements = (stream = cameraStreamRef.current) => {
        const localVideoElements = [
            localLobbyVideoRef.current,
            localWaitingRoomVideoRef.current,
            localMeetingVideoRef.current,
        ].filter(Boolean);

        localVideoElements.forEach((videoElement) => {
            attachStreamToVideoElement(videoElement, stream, { muted: true });
        });
    };

    const attachLocalPreview = (stream = cameraStreamRef.current) => {
        attachLocalStreamToAllLocalVideoElements(stream);
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
        console.log('[MEDIA] getPermissions() called — requesting camera/mic permission...');
        try {
            const stream = await getMediaWithAudioProcessingFallback({
                video: true, 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            }).catch((error) => {
                console.warn('[MEDIA] getUserMedia failed in getPermissions:', error.name, error.message);
                if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
                    setPreviewMessage('Camera access was blocked. You can still join with the camera disabled.');
                } else {
                    setPreviewMessage('Unable to access your camera. You can still join with the camera disabled.');
                }
                return null;
            });
            const hasVideo = !!stream?.getVideoTracks()?.length;
            const hasAudio = !!stream?.getAudioTracks()?.length;
            console.log('[MEDIA] getPermissions() result — hasVideo:', hasVideo, 'hasAudio:', hasAudio);
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
                console.log('[MEDIA] Local stream obtained in getPermissions, attaching lobby preview.');
                console.log('[AUDIO_DEBUG] Local stream created in getPermissions');
                console.log('[AUDIO_DEBUG] Video track found:', hasVideo);
                console.log('[AUDIO_DEBUG] Audio track found:', hasAudio);
                syncLocalStream(stream, { shouldPreview: true, isScreenShare: false });
            }
        } catch (error) {
            console.error('[MEDIA] getPermissions() unexpected error:', error);
        }
    };

    useEffect(() => {
        if (askForUsername || inWaitingRoom) return;
        console.log('[MEDIA] getUserMedia useEffect triggered — video:', video, 'audio:', audio, 'askForUsername:', askForUsername, 'inWaitingRoom:', inWaitingRoom);
        getUserMedia();
    }, [video, audio, askForUsername, inWaitingRoom])

    const applyVideoQuality = async (quality) => {
        const settings = {
            High: { maxBitrate: 1_500_000, maxFramerate: 30, scaleResolutionDownBy: 1 },
            Medium: { maxBitrate: 700_000, maxFramerate: 24, scaleResolutionDownBy: 1.5 },
            Low: { maxBitrate: 300_000, maxFramerate: 15, scaleResolutionDownBy: 2.5 },
        }[quality];
        if (!settings) return;

        const senders = Object.values(peerConnectionsRef.current)
            .flatMap((peerConnection) => peerConnection?.getSenders?.() || [])
            .filter((sender) => sender.track?.kind === "video");
        if (!senders.length) {
            setQualityWarning("Video quality cannot be applied until a local video sender is active.");
            return false;
        }

        const results = await Promise.all(senders.map(async (sender) => {
            if (senderQualityRef.current.get(sender) === quality) return true;
            try {
                const parameters = sender.getParameters();
                if (!parameters.encodings?.length) {
                    setQualityWarning("Your browser does not expose adjustable video encoding.");
                    return false;
                }
                parameters.encodings = parameters.encodings.map((encoding) => {
                    const updatedEncoding = { ...encoding };
                    if ("maxBitrate" in encoding || encoding.maxBitrate === undefined) {
                        updatedEncoding.maxBitrate = settings.maxBitrate;
                    }
                    if ("maxFramerate" in encoding || encoding.maxFramerate === undefined) {
                        updatedEncoding.maxFramerate = settings.maxFramerate;
                    }
                    if ("scaleResolutionDownBy" in encoding || encoding.scaleResolutionDownBy === undefined) {
                        updatedEncoding.scaleResolutionDownBy = settings.scaleResolutionDownBy;
                    }
                    return updatedEncoding;
                });
                await sender.setParameters(parameters);
                senderQualityRef.current.set(sender, quality);
                const appliedParameters = sender.getParameters();
                console.info("[WEBRTC_DIAG] Applied outgoing video encoding", {
                    peerId: Object.entries(peerConnectionsRef.current)
                        .find(([, peerConnection]) => peerConnection.getSenders().includes(sender))?.[0],
                    quality,
                    encodings: appliedParameters.encodings?.map(({ maxBitrate, maxFramerate, scaleResolutionDownBy }) => ({
                        maxBitrate,
                        maxFramerate,
                        scaleResolutionDownBy,
                    })),
                });
                return true;
            } catch (error) {
                console.warn("[WEBRTC] Unable to apply outgoing video quality:", error);
                setQualityWarning("The browser could not apply the selected video quality.");
                return false;
            }
        }));
        const allApplied = results.every(Boolean);
        if (allApplied) setQualityWarning("");
        return allApplied;
    };

    const recoverPeerConnection = async (remoteSocketId) => {
        const peerConnection = peerConnectionsRef.current[remoteSocketId];
        const recovery = peerRecoveryRef.current[remoteSocketId];
        if (!peerConnection || !recovery || recovery.recovering || !socketRef.current?.connected) return;
        if (makingOfferRef.current[remoteSocketId]) {
            if (!recovery.retryTimer) {
                recovery.retryTimer = window.setTimeout(() => {
                    recovery.retryTimer = null;
                    recoverPeerConnection(remoteSocketId);
                }, 1000);
            }
            return;
        }
        if (
            ["connected", "completed"].includes(peerConnection.iceConnectionState) &&
            !["disconnected", "failed"].includes(peerConnection.connectionState)
        ) return;
        if (recovery.attempts >= 3) {
            if (!recovery.failureNotified) {
                recovery.failureNotified = true;
                setNetworkQuality("Poor");
                setSnackMessage("Unable to reconnect to a participant. Check your network and try again.");
                setSnackOpen(true);
            }
            return;
        }

        clearTimeout(recovery.retryTimer);
        recovery.retryTimer = null;
        recovery.recovering = true;
        recovery.attempts += 1;
        setNetworkQuality("Reconnecting");
        makingOfferRef.current[remoteSocketId] = true;
        try {
            if (peerConnection.signalingState !== "stable") {
                throw new Error("Connection is not ready for an ICE restart.");
            }
            peerConnection.restartIce?.();
            const offer = await peerConnection.createOffer({ iceRestart: true });
            await peerConnection.setLocalDescription(offer);
            socketRef.current.emit("offer", {
                target: remoteSocketId,
                sender: socketIdRef.current,
                sdp: peerConnection.localDescription,
                iceRestart: true,
            });
        } catch (error) {
            console.warn(`[WEBRTC] ICE restart attempt ${recovery.attempts} failed for ${remoteSocketId}:`, error);
        } finally {
            makingOfferRef.current[remoteSocketId] = false;
            recovery.recovering = false;
            if (peerRecoveryRef.current[remoteSocketId] !== recovery ||
                peerConnectionsRef.current[remoteSocketId] !== peerConnection) return;
            const delay = Math.min(12000, 1000 * (2 ** recovery.attempts));
            recovery.retryTimer = window.setTimeout(() => {
                const currentConnection = peerConnectionsRef.current[remoteSocketId];
                if (currentConnection &&
                    !["connected", "completed"].includes(currentConnection.iceConnectionState) &&
                    currentConnection.connectionState !== "connected") {
                    recoverPeerConnection(remoteSocketId);
                }
            }, delay);
        }
    };

    const monitorPeerConnection = (remoteSocketId, peerConnection) => {
        const recovery = peerRecoveryRef.current[remoteSocketId];
        if (!recovery) return;
        const state = peerConnection.iceConnectionState;
        const connectionState = peerConnection.connectionState;
        if (
            ["connected", "completed"].includes(state) &&
            !["disconnected", "failed"].includes(connectionState)
        ) {
            clearTimeout(recovery.graceTimer);
            clearTimeout(recovery.retryTimer);
            recovery.graceTimer = null;
            recovery.retryTimer = null;
            recovery.attempts = 0;
            recovery.recovering = false;
            recovery.failureNotified = false;
            setNetworkQuality((current) => current === "Reconnecting" ? "Checking" : current);
            return;
        }
        if (state === "failed" || connectionState === "failed") {
            clearTimeout(recovery.graceTimer);
            recoverPeerConnection(remoteSocketId);
            return;
        }
        if ((state === "disconnected" || connectionState === "disconnected") && !recovery.graceTimer && !recovery.recovering) {
            recovery.graceTimer = window.setTimeout(() => {
                recovery.graceTimer = null;
                const currentConnection = peerConnectionsRef.current[remoteSocketId];
                if (currentConnection &&
                    (currentConnection.iceConnectionState === "disconnected" || currentConnection.connectionState === "disconnected")) {
                    recoverPeerConnection(remoteSocketId);
                }
            }, 5000);
        }
    };

    const closePeerConnection = (remoteSocketId) => {
        const recovery = peerRecoveryRef.current[remoteSocketId];
        if (recovery) {
            clearTimeout(recovery.graceTimer);
            clearTimeout(recovery.retryTimer);
            delete peerRecoveryRef.current[remoteSocketId];
        }
        peerConnectionsRef.current[remoteSocketId]?.close();
        remoteVideosRef.current[remoteSocketId]?.getTracks?.().forEach((track) => track.stop());
        delete peerConnectionsRef.current[remoteSocketId];
        delete pendingNegotiationRef.current[remoteSocketId];
        delete makingOfferRef.current[remoteSocketId];
        delete statsPreviousRef.current[remoteSocketId];
        delete networkAssessmentRef.current.previousPeerStats[remoteSocketId];
        delete remoteVideosRef.current[remoteSocketId];
        delete pendingIceCandidatesRef.current[remoteSocketId];
        setPeerStates((previous) => {
            const next = { ...previous };
            delete next[remoteSocketId];
            return next;
        });
        setVideos((previous) => previous.filter((entry) => entry.socketId !== remoteSocketId));
        if (!Object.keys(peerConnectionsRef.current).length) {
            networkAssessmentRef.current.startedAt = Date.now();
            networkAssessmentRef.current.lastValidAt = undefined;
            networkAssessmentRef.current.stableQuality = "Checking";
            networkAssessmentRef.current.candidateQuality = null;
            networkAssessmentRef.current.candidateCount = 0;
            setNetworkQuality("Checking");
            setNetworkQualityDetails("Waiting for WebRTC connection measurements.");
        }
    };

    let getMedia = (initialVideo = videoAvailable, initialAudio = audioAvailable) => {
        setVideo(initialVideo);
        setAudio(initialAudio);
        connectToSocketServer({ initialVideo, initialAudio });
    }

    const ensurePeerConnection = (remoteSocketId) => {
        if (!remoteSocketId || remoteSocketId === socketIdRef.current) return null;
        if (peerConnectionsRef.current[remoteSocketId]) {
            console.debug("[WEBRTC_DIAG] Reusing peer connection", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                signalingState: peerConnectionsRef.current[remoteSocketId].signalingState,
                connectionState: peerConnectionsRef.current[remoteSocketId].connectionState,
            });
            return peerConnectionsRef.current[remoteSocketId];
        }

        if (!Object.keys(peerConnectionsRef.current).length) {
            networkAssessmentRef.current.startedAt = Date.now();
            networkAssessmentRef.current.lastValidAt = undefined;
            networkAssessmentRef.current.stableQuality = "Checking";
            networkAssessmentRef.current.candidateQuality = null;
            networkAssessmentRef.current.candidateCount = 0;
        }
        const peerConnection = new RTCPeerConnection(peerConfigConnections);
        console.info("[WEBRTC_DIAG] Created peer connection", {
            meetingId: meetingCode,
            localParticipantId: socketIdRef.current,
            remoteParticipantId: remoteSocketId,
            peerConnectionCount: Object.keys(peerConnectionsRef.current).length + 1,
        });
        peerRecoveryRef.current[remoteSocketId] = {
            attempts: 0,
            recovering: false,
            failureNotified: false,
            graceTimer: null,
            retryTimer: null,
        };
        const updatePeerConnectionState = () => {
            const reportedState = ["failed", "disconnected"].includes(peerConnection.iceConnectionState)
                ? peerConnection.iceConnectionState
                : peerConnection.connectionState;
            setPeerStates((previous) => ({ ...previous, [remoteSocketId]: reportedState }));
            console.info("[WEBRTC_DIAG] Peer state changed", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                iceConnectionState: peerConnection.iceConnectionState,
            });
            monitorPeerConnection(remoteSocketId, peerConnection);
        };
        peerConnection.oniceconnectionstatechange = updatePeerConnectionState;
        peerConnection.onconnectionstatechange = () => {
            updatePeerConnectionState();
        };
        peerConnection.onsignalingstatechange = () => {
            console.info("[WEBRTC_DIAG] Signaling state changed", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                iceConnectionState: peerConnection.iceConnectionState,
            });
        };
        if (window.debugStats) window.debugStats.peerConnections++;
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socketRef.current) {
                console.debug('[WEBRTC_DIAG] ICE candidate', {
                    meetingId: meetingCode,
                    localId: socketIdRef.current,
                    remoteId: remoteSocketId,
                    candidateType: event.candidate.type,
                    signalingState: peerConnection.signalingState,
                    iceConnectionState: peerConnection.iceConnectionState,
                });
                socketRef.current.emit('ice-candidate', { target: remoteSocketId, sender: socketIdRef.current, candidate: event.candidate });
            }
        };
        peerConnection.onicecandidateerror = (event) => {
            console.warn("[WEBRTC_DIAG] ICE candidate gathering error", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                errorCode: event.errorCode,
                errorText: event.errorText,
                signalingState: peerConnection.signalingState,
                iceGatheringState: peerConnection.iceGatheringState,
            });
        };

        peerConnection.ontrack = (event) => {
            if (window.debugStats) window.debugStats.ontrack++;
            console.info('[WEBRTC_DIAG] Remote track received', {
                meetingId: meetingCode,
                remoteId: remoteSocketId,
                participantId: remoteSocketId,
                kind: event.track.kind,
                trackId: event.track.id,
                readyState: event.track.readyState,
                enabled: event.track.enabled,
                muted: event.track.muted,
                streamless: !event.streams?.[0],
                streamId: event.streams?.[0]?.id || null,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                iceConnectionState: peerConnection.iceConnectionState,
            });
            // Keep exactly one stable remote MediaStream per peer socket. Some browsers
            // deliver streamless track events, and renegotiation can deliver a new track
            // for a kind already present in the peer's stream.
            let remoteStream = remoteVideosRef.current[remoteSocketId];
            if (!remoteStream) {
                remoteStream = event.streams?.[0] || new MediaStream();
                remoteVideosRef.current[remoteSocketId] = remoteStream;
            }
            const incomingTrack = event.track;
            if (!remoteStream.getTracks().some((track) => track.id === incomingTrack.id)) {
                remoteStream.getTracks()
                    .filter((track) => track.kind === incomingTrack.kind)
                    .forEach((track) => remoteStream.removeTrack(track));
                remoteStream.addTrack(incomingTrack);
            }

            const publishRemoteStream = () => {
                console.info("[WEBRTC_DIAG] Assigning remote stream", {
                    meetingId: meetingCode,
                    remoteParticipantId: remoteSocketId,
                    streamId: remoteStream.id,
                    trackKinds: remoteStream.getTracks().map((track) => ({
                        kind: track.kind,
                        trackId: track.id,
                        readyState: track.readyState,
                        enabled: track.enabled,
                        muted: track.muted,
                    })),
                    connectionState: peerConnection.connectionState,
                    iceConnectionState: peerConnection.iceConnectionState,
                });
                setVideos((previous) => {
                    const isScreenShare = remoteStream.getVideoTracks().some((track) => /screen/i.test(track.label || ''));
                    const nextPeer = { socketId: remoteSocketId, stream: remoteStream, autoplay: true, playsinline: true, isScreenShare };
                    const existingIndex = previous.findIndex((entry) => entry.socketId === remoteSocketId);
                    if (existingIndex < 0) return [...previous, nextPeer];
                    return previous.map((entry, index) => index === existingIndex ? nextPeer : entry);
                });
            };
            incomingTrack.onmute = publishRemoteStream;
            incomingTrack.onunmute = () => {
                console.info('[WEBRTC_DIAG] Remote track unmuted', { remoteId: remoteSocketId, kind: incomingTrack.kind });
                publishRemoteStream();
            };
            incomingTrack.onended = () => {
                console.warn('[WEBRTC_DIAG] Remote track ended', { remoteId: remoteSocketId, kind: incomingTrack.kind });
                publishRemoteStream();
            };
            publishRemoteStream();
            console.log('[WEBRTC] Remote stream updated for', remoteSocketId, {
                audioTracks: remoteStream.getAudioTracks().length,
                videoTracks: remoteStream.getVideoTracks().length,
            });
        };

        const localTrackSource = cameraStreamRef.current || window.localStream;
        if (localTrackSource) {
            const localTracks = localTrackSource.getTracks();
            console.info("[WEBRTC_DIAG] Adding local tracks to new peer connection", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                streamId: localTrackSource.id,
                tracks: localTracks.map((track) => ({
                    kind: track.kind,
                    trackId: track.id,
                    readyState: track.readyState,
                    enabled: track.enabled,
                })),
            });
            localTracks.forEach((track) => peerConnection.addTrack(track, localTrackSource));
        }

        peerConnectionsRef.current[remoteSocketId] = peerConnection;
        return peerConnection;
    };

    useEffect(() => {
        let active = true;
        const sampleConnections = async () => {
            if (statsPollInFlightRef.current) return;
            statsPollInFlightRef.current = true;
            try {
                const peerEntries = Object.entries(peerConnectionsRef.current);
                if (!peerEntries.length) {
                    const assessment = networkAssessmentRef.current;
                    if (Date.now() - assessment.startedAt >= NETWORK_QUALITY_THRESHOLDS.unavailableAfterMs) {
                        assessment.stableQuality = "Unavailable";
                        setNetworkQuality("Unavailable");
                        setNetworkQualityDetails("No active peer connections are available for measurement.");
                    } else {
                        setNetworkQuality("Checking");
                    }
                    return;
                }
                const readings = await Promise.all(peerEntries.map(async ([socketId, peerConnection]) => {
                    const recovery = peerRecoveryRef.current[socketId];
                    if (!peerConnection || peerConnection.signalingState === "closed") {
                        return { socketId, iceState: "closed", connectionState: "closed", metrics: {} };
                    }

                    const reading = {
                        meetingId: meetingCode,
                        socketId,
                        iceState: peerConnection.iceConnectionState,
                        connectionState: peerConnection.connectionState,
                        recovering: Boolean(recovery?.recovering || recovery?.graceTimer || recovery?.retryTimer),
                        metrics: {},
                    };
                    if (typeof peerConnection.getStats !== "function") return reading;

                    try {
                        const reports = await peerConnection.getStats();
                        const reportList = [];
                        reports.forEach((report) => reportList.push(report));
                        const transportSelectedIds = new Set(reportList
                            .filter((report) => report.type === "transport" && report.selectedCandidatePairId)
                            .map((report) => report.selectedCandidatePairId));
                        const candidatePairs = reportList.filter((report) => report.type === "candidate-pair");
                        const candidatePair = candidatePairs.find((report) => transportSelectedIds.has(report.id)) ||
                            candidatePairs.find((report) => report.selected === true) ||
                            candidatePairs.find((report) => report.state === "succeeded" && report.nominated === true);
                        const remoteInboundReports = reportList.filter((report) =>
                            report.type === "remote-inbound-rtp" && Number.isFinite(report.roundTripTime)
                        );
                        const rttSeconds = candidatePair?.currentRoundTripTime ??
                            remoteInboundReports[0]?.roundTripTime;
                        if (Number.isFinite(rttSeconds) && rttSeconds >= 0) {
                            reading.metrics.rttMs = rttSeconds * 1000;
                        }
                        if (Number.isFinite(candidatePair?.availableOutgoingBitrate) &&
                            candidatePair.availableOutgoingBitrate > 0) {
                            reading.metrics.availableOutgoingBitrate = candidatePair.availableOutgoingBitrate;
                        }

                        const inboundReports = reportList.filter((report) =>
                            report.type === "inbound-rtp" && !report.isRemote &&
                            ["audio", "video"].includes(report.kind || report.mediaType)
                        );
                        reading.inboundVideo = inboundReports
                            .filter((report) => (report.kind || report.mediaType) === "video")
                            .map((report) => ({
                                reportId: report.id,
                                bytesReceived: report.bytesReceived,
                                packetsReceived: report.packetsReceived,
                                framesReceived: report.framesReceived,
                                framesDecoded: report.framesDecoded,
                                framesDropped: report.framesDropped,
                            }));
                        const previousPeerStats = networkAssessmentRef.current.previousPeerStats[socketId] || {};
                        const nextPeerStats = {};
                        let intervalReceived = 0;
                        let intervalLost = 0;
                        let hasPacketInterval = false;
                        let maxJitterMs;
                        inboundReports.forEach((report) => {
                            if (Number.isFinite(report.jitter)) {
                                const jitterMs = report.jitter * 1000;
                                maxJitterMs = Math.max(maxJitterMs ?? 0, jitterMs);
                            }
                            const previousReport = previousPeerStats[report.id];
                            if (previousReport &&
                                Number.isFinite(report.packetsReceived) && Number.isFinite(report.packetsLost) &&
                                report.packetsReceived >= previousReport.packetsReceived &&
                                report.packetsLost >= previousReport.packetsLost) {
                                const receivedDelta = report.packetsReceived - previousReport.packetsReceived;
                                const lostDelta = Math.max(0, report.packetsLost - previousReport.packetsLost);
                                if (receivedDelta + lostDelta > 0) {
                                    intervalReceived += receivedDelta;
                                    intervalLost += lostDelta;
                                    hasPacketInterval = true;
                                }
                            }
                            nextPeerStats[report.id] = {
                                packetsReceived: report.packetsReceived,
                                packetsLost: report.packetsLost,
                            };
                        });
                        if (maxJitterMs !== undefined) reading.metrics.jitterMs = maxJitterMs;
                        if (hasPacketInterval) {
                            reading.metrics.packetLoss = intervalLost / (intervalReceived + intervalLost);
                        }
                        networkAssessmentRef.current.previousPeerStats[socketId] = nextPeerStats;

                        const outboundVideo = reportList.find((report) =>
                            report.type === "outbound-rtp" && !report.isRemote &&
                            (report.kind || report.mediaType) === "video"
                        );
                        const previousOutbound = statsPreviousRef.current[socketId];
                        const now = Date.now();
                        const videoBitrate = outboundVideo && previousOutbound &&
                            Number.isFinite(outboundVideo.bytesSent) &&
                            Number.isFinite(previousOutbound.bytesSent) &&
                            now > previousOutbound.time
                            ? Math.max(0, ((outboundVideo.bytesSent - previousOutbound.bytesSent) * 8000) /
                                (now - previousOutbound.time))
                            : undefined;
                        if (outboundVideo) {
                            statsPreviousRef.current[socketId] = { bytesSent: outboundVideo.bytesSent, time: now };
                            if (Number.isFinite(videoBitrate)) reading.metrics.outboundVideoBitrate = videoBitrate;
                            if (Number.isFinite(outboundVideo.framesPerSecond)) {
                                reading.metrics.outboundFramesPerSecond = outboundVideo.framesPerSecond;
                            }
                        }
                        console.debug("[NETWORK_DIAG] Peer stats", reading);
                    } catch (error) {
                        console.warn(`[WEBRTC] Unable to read connection statistics for ${socketId}:`, error);
                    }
                    return reading;
                }));
                if (!active) return;

                const now = Date.now();
                const assessment = networkAssessmentRef.current;
                const recoveryFailed = readings.some((reading) =>
                    peerRecoveryRef.current[reading.socketId]?.failureNotified
                );
                const reconnecting = readings.some((reading) =>
                    reading.recovering ||
                    ["disconnected", "failed"].includes(reading.iceState) ||
                    ["disconnected", "failed"].includes(reading.connectionState)
                );
                const validReadings = readings.filter((reading) =>
                    reading.connectionState === "connected" &&
                    ["rttMs", "packetLoss", "jitterMs", "availableOutgoingBitrate"]
                        .some((metric) => Number.isFinite(reading.metrics[metric]))
                );

                let measuredQuality = null;
                if (validReadings.length) {
                    let poor = false;
                    let fair = false;
                    validReadings.forEach(({ metrics }) => {
                        poor = poor || metrics.rttMs > NETWORK_QUALITY_THRESHOLDS.rttPoorMs ||
                            metrics.packetLoss > NETWORK_QUALITY_THRESHOLDS.packetLossPoor ||
                            metrics.jitterMs > NETWORK_QUALITY_THRESHOLDS.jitterPoorMs ||
                            metrics.availableOutgoingBitrate < NETWORK_QUALITY_THRESHOLDS.availableBitratePoor;
                        fair = fair || metrics.rttMs > NETWORK_QUALITY_THRESHOLDS.rttFairMs ||
                            metrics.packetLoss > NETWORK_QUALITY_THRESHOLDS.packetLossFair ||
                            metrics.jitterMs > NETWORK_QUALITY_THRESHOLDS.jitterFairMs ||
                            metrics.availableOutgoingBitrate < NETWORK_QUALITY_THRESHOLDS.availableBitrateFair;
                    });
                    measuredQuality = poor
                        ? "Poor"
                        : fair
                            ? "Fair"
                            : validReadings.length === readings.length
                                ? "Good"
                                : null;
                    assessment.lastValidAt = now;
                }

                let displayQuality;
                if (reconnecting && !recoveryFailed) {
                    displayQuality = "Reconnecting";
                    assessment.candidateQuality = null;
                    assessment.candidateCount = 0;
                } else if (recoveryFailed) {
                    displayQuality = "Poor";
                    assessment.candidateQuality = null;
                    assessment.candidateCount = 0;
                } else if (!measuredQuality) {
                    const lastValidAt = assessment.lastValidAt || assessment.startedAt;
                    displayQuality = now - lastValidAt >= NETWORK_QUALITY_THRESHOLDS.unavailableAfterMs
                        ? "Unavailable"
                        : "Checking";
                    assessment.candidateQuality = null;
                    assessment.candidateCount = 0;
                } else {
                    if (assessment.candidateQuality === measuredQuality) {
                        assessment.candidateCount += 1;
                    } else {
                        assessment.candidateQuality = measuredQuality;
                        assessment.candidateCount = 1;
                    }
                    const requiredSamples = measuredQuality === "Good"
                        ? NETWORK_QUALITY_THRESHOLDS.healthySamplesRequired
                        : NETWORK_QUALITY_THRESHOLDS.degradedSamplesRequired;
                    if (assessment.candidateCount >= requiredSamples) {
                        assessment.stableQuality = measuredQuality;
                    }
                    displayQuality = assessment.stableQuality;
                }

                const metricsSummary = validReadings.map(({ socketId, metrics }) => {
                    const values = [];
                    if (Number.isFinite(metrics.rttMs)) values.push(`RTT ${Math.round(metrics.rttMs)} ms`);
                    if (Number.isFinite(metrics.packetLoss)) values.push(`loss ${(metrics.packetLoss * 100).toFixed(1)}%`);
                    if (Number.isFinite(metrics.jitterMs)) values.push(`jitter ${Math.round(metrics.jitterMs)} ms`);
                    if (Number.isFinite(metrics.availableOutgoingBitrate)) {
                        values.push(`available ${(metrics.availableOutgoingBitrate / 1000).toFixed(0)} kbps`);
                    }
                    if (Number.isFinite(metrics.outboundVideoBitrate)) {
                        values.push(`video TX ${(metrics.outboundVideoBitrate / 1000).toFixed(0)} kbps`);
                    }
                    return `${socketId}: ${values.join(", ") || "connected; measurements unavailable"}`;
                });
                const details = metricsSummary.length
                    ? metricsSummary.join(" | ")
                    : readings.map(({ socketId, connectionState, iceState }) =>
                        `${socketId}: ${connectionState}/${iceState}`
                    ).join(" | ") || "No peer connections are available.";
                setNetworkQuality(displayQuality);
                setNetworkQualityDetails(details);
                console.info("[NETWORK_DIAG] Meeting network status", {
                    status: displayQuality,
                    measuredQuality,
                    peerCount: readings.length,
                    measuredPeerCount: validReadings.length,
                    details,
                });

                if (videoQualityMode !== "auto") {
                    const applied = await applyVideoQuality(videoQualityMode);
                    if (applied && activeVideoQuality !== videoQualityMode) {
                        setActiveVideoQuality(videoQualityMode);
                    }
                } else if (measuredQuality) {
                    const desiredQuality = measuredQuality === "Poor" ? "Low" : measuredQuality === "Fair" ? "Medium" : "High";
                    const rank = { Low: 0, Medium: 1, High: 2 };
                    const lowering = rank[desiredQuality] < rank[activeVideoQuality];
                    const canRaise = Date.now() - qualityLastChangedRef.current >= 20000;
                    const target = lowering || (rank[desiredQuality] > rank[activeVideoQuality] && canRaise)
                        ? desiredQuality
                        : activeVideoQuality;
                    const applied = await applyVideoQuality(target);
                    if (applied && target !== activeVideoQuality) {
                        setActiveVideoQuality(target);
                        qualityLastChangedRef.current = Date.now();
                    }
                }
            } catch (error) {
                console.error("[WEBRTC] Connection statistics sampling failed:", error);
            } finally {
                statsPollInFlightRef.current = false;
            }
        };

        sampleConnections();
        const timer = window.setInterval(sampleConnections, 5000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [videoQualityMode, activeVideoQuality, meetingCode]);

    const createOfferForPeer = async (remoteSocketId, queueIfBusy = true) => {
        const peerConnection = ensurePeerConnection(remoteSocketId);
        if (!peerConnection || !socketRef.current || !socketIdRef.current) return;
        if (peerConnection.signalingState !== 'stable' || makingOfferRef.current[remoteSocketId]) {
            if (queueIfBusy) pendingNegotiationRef.current[remoteSocketId] = true;
            return;
        }

        makingOfferRef.current[remoteSocketId] = true;
        try {
            if (window.debugStats) window.debugStats.createOffer++;
            console.info('[WEBRTC_DIAG] Creating offer', {
                meetingId: meetingCode,
                localId: socketIdRef.current,
                remoteId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
            });
            const offerDescription = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offerDescription);
            console.info('[WEBRTC_DIAG] Sending offer', {
                meetingId: meetingCode,
                localId: socketIdRef.current,
                remoteId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                transceivers: peerConnection.getTransceivers().map(({ mid, direction, sender }) => ({
                    mid,
                    direction,
                    kind: sender.track?.kind,
                    trackReadyState: sender.track?.readyState,
                })),
            });
            socketRef.current.emit('offer', { target: remoteSocketId, sender: socketIdRef.current, sdp: peerConnection.localDescription });
        } catch (error) {
            console.error('[WEBRTC] createOfferForPeer error:', {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                error,
            });
        } finally {
            makingOfferRef.current[remoteSocketId] = false;
        }
    };

    const reconcileMeshPeers = (participantsList) => {
        if (!socketIdRef.current || !Array.isArray(participantsList)) return;

        participantsList.forEach((participant) => {
            const remoteSocketId = participant?.socketId;
            if (!remoteSocketId || remoteSocketId === socketIdRef.current) return;

            const peerConnection = ensurePeerConnection(remoteSocketId);
            if (!peerConnection) return;

            console.info('[WEBRTC_DIAG] Reconciling mesh peer', {
                meetingId: meetingCode,
                localId: socketIdRef.current,
                remoteId: remoteSocketId,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
            });
            if (socketIdRef.current < remoteSocketId &&
                peerConnection.signalingState === 'stable' &&
                !peerConnection.localDescription &&
                !peerConnection.remoteDescription) {
                createOfferForPeer(remoteSocketId, false);
            }
        });
    };

    const syncLocalStream = (stream, options = {}) => {
        const { shouldPreview = true, isScreenShare = false } = options;

        if (!isScreenShare) {
            cameraStreamRef.current = stream;
        }

        const canonicalLocalStream = isScreenShare ? (cameraStreamRef.current || window.localStream || stream) : stream;
        window.localStream = canonicalLocalStream;
        if (!isScreenShare) {
            setLocalStream(canonicalLocalStream);
        }

        if (shouldPreview && !isScreenShare) {
            attachLocalPreview(stream);
        }

        if (!stream) {
            Object.values(peerConnectionsRef.current).forEach((peerConnection) => {
                peerConnection?.getSenders?.().forEach((sender) => {
                    if (sender.track) sender.replaceTrack(null).catch((error) => {
                        console.warn('[WEBRTC] Unable to detach an unavailable local track:', error);
                    });
                });
            });
            return;
        }

        Object.keys(peerConnectionsRef.current).forEach((remoteSocketId) => {
            const peerConnection = peerConnectionsRef.current[remoteSocketId];
            if (!peerConnection) return;

            let needsNegotiation = false;
            const trackUpdates = [];
            const streamTrackKinds = new Set(stream.getTracks().map((track) => track.kind));
            stream.getTracks().forEach((track) => {
                const { sender: existingSender, transceiver } = getSenderForTrackKind(peerConnection, track.kind);
                if (existingSender) {
                    if (!existingSender.track && transceiver && transceiver.direction !== 'sendrecv' && transceiver.direction !== 'sendonly') {
                        console.info('[WEBRTC_DIAG] Enabling local sending on existing transceiver', {
                            remoteId: remoteSocketId,
                            kind: track.kind,
                            previousDirection: transceiver.direction,
                        });
                        transceiver.direction = transceiver.direction === 'recvonly' ? 'sendrecv' : 'sendonly';
                        needsNegotiation = true;
                    }
                    trackUpdates.push(existingSender.replaceTrack(track).then(() => {
                        console.info('[WEBRTC_DIAG] Local track attached to peer sender', {
                                        meetingId: meetingCode,
                                        localParticipantId: socketIdRef.current,
                                        remoteId: remoteSocketId,
                            kind: track.kind,
                            trackId: track.id,
                            readyState: track.readyState,
                            enabled: track.enabled,
                            transceiverDirection: transceiver?.direction,
                        });
                    }));
                } else {
                    console.info('[WEBRTC_DIAG] Adding local track to peer connection', {
                        meetingId: meetingCode,
                        localParticipantId: socketIdRef.current,
                        remoteId: remoteSocketId,
                        kind: track.kind,
                        trackId: track.id,
                        readyState: track.readyState,
                        enabled: track.enabled,
                    });
                    peerConnection.addTrack(track, stream);
                    needsNegotiation = true;
                }
            });

            if (!isScreenShare) {
                peerConnection.getSenders().forEach((sender) => {
                    if (sender.track && !streamTrackKinds.has(sender.track.kind)) {
                        const trackKind = sender.track.kind;
                        sender.replaceTrack(null).catch((error) => {
                            console.warn(`[WEBRTC] Unable to detach unavailable local ${trackKind} track:`, error);
                        });
                    }
                });
            }

            Promise.all(trackUpdates)
                .then(() => {
                    if (needsNegotiation) createOfferForPeer(remoteSocketId);
                })
                .catch((error) => {
                    console.error(`[WEBRTC] Unable to synchronize local tracks with ${remoteSocketId}:`, error);
                });
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
            };
        });
    };

    let getUserMedia = () => {
        const wantsVideo = Boolean(video && videoAvailable && canUseCamera);
        const wantsAudio = Boolean(audio && audioAvailable && canUseMic);
        console.log('[MEDIA] getUserMedia() — wantsVideo:', wantsVideo, 'wantsAudio:', wantsAudio);

        if (!wantsVideo && !wantsAudio) {
            const existingStream = cameraStreamRef.current;
            const hasLiveTrack = existingStream?.getTracks().some((track) => track.readyState === 'live');
            if (hasLiveTrack) {
                existingStream.getTracks().forEach((track) => { track.enabled = false; });
                syncLocalStream(existingStream);
                return;
            }

            console.log('[MEDIA] getUserMedia() — no active devices; clearing local media tracks.');
            replaceCameraStream(null);
            return;
        }

        // REUSE: If getPermissions() already obtained a live stream, reuse it
        // instead of requesting browser permission again. This prevents a second popup.
        const existingStream = cameraStreamRef.current;
        if (existingStream) {
            const videoLive = existingStream.getVideoTracks().some(t => t.readyState === 'live');
            const audioLive = existingStream.getAudioTracks().some(t => t.readyState === 'live');
            if ((!wantsVideo || videoLive) && (!wantsAudio || audioLive)) {
                console.log('[MEDIA] getUserMedia() — reusing existing live stream from getPermissions(). Skipping new permission request.');
                // Enable/disable tracks to match current wants
                existingStream.getVideoTracks().forEach(t => { t.enabled = wantsVideo; });
                existingStream.getAudioTracks().forEach(t => { t.enabled = wantsAudio; });
                getUserMediaSuccess(existingStream);
                return;
            }
        }

        console.log('[MEDIA] getUserMedia() — requesting new stream from browser...');
        getMediaWithAudioProcessingFallback({
            video: wantsVideo, 
            audio: wantsAudio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false 
        })
            .then((stream) => {
                console.log('[MEDIA] getUserMedia() — new stream obtained successfully.');
                getUserMediaSuccess(stream);
            })
            .catch((error) => {
                console.warn('[MEDIA] getUserMedia() failed:', error.name, error.message);
                if (wantsVideo && wantsAudio) {
                    navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: false })
                        .then((stream) => {
                            console.log('[MEDIA] getUserMedia() — fallback: video-only stream obtained.');
                            setAudio(false);
                            socketRef.current?.emit('participant-muted', meetingCode);
                            getUserMediaSuccess(stream);
                        })
                        .catch(() => {
                            console.error('[MEDIA] getUserMedia() — all fallbacks failed.');
                            setVideo(false);
                            setAudio(false);
                            socketRef.current?.emit('participant-camera-disabled', meetingCode);
                            socketRef.current?.emit('participant-muted', meetingCode);
                            replaceCameraStream(null);
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
                replaceCameraStream(null);
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
            };
        });
    };

    const handleOffer = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        console.info('[WEBRTC_DIAG] Offer received', {
            meetingId: meetingCode,
            localId: socketIdRef.current,
            remoteId: payload.sender,
            signalingState: peerConnectionsRef.current[payload.sender]?.signalingState || 'new',
            sdpType: payload.sdp?.type,
        });
        const peerConnection = ensurePeerConnection(payload.sender);
        if (!peerConnection) return;
        try {
            const offerCollision = peerConnection.signalingState !== 'stable' || makingOfferRef.current[payload.sender];
            const polite = socketIdRef.current > payload.sender;
            if (offerCollision && !polite) {
                console.warn("[WEBRTC_DIAG] Ignoring colliding offer", {
                    meetingId: meetingCode,
                    localParticipantId: socketIdRef.current,
                    remoteParticipantId: payload.sender,
                    polite,
                    signalingState: peerConnection.signalingState,
                });
                pendingNegotiationRef.current[payload.sender] = true;
                return;
            }
            if (offerCollision) {
                await peerConnection.setLocalDescription({ type: 'rollback' });
            }
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            console.info("[WEBRTC_DIAG] Offer remote description applied", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
                signalingState: peerConnection.signalingState,
            });
            await applyPendingIceCandidates(payload.sender, peerConnection);
            if (window.debugStats) window.debugStats.createAnswer++;
            const answerDescription = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answerDescription);
            console.info('[WEBRTC_DIAG] Sending answer', {
                meetingId: meetingCode,
                localId: socketIdRef.current,
                remoteId: payload.sender,
                signalingState: peerConnection.signalingState,
                transceivers: peerConnection.getTransceivers().map(({ mid, direction, sender }) => ({
                    mid,
                    direction,
                    kind: sender.track?.kind,
                    trackReadyState: sender.track?.readyState,
                })),
            });
            socketRef.current.emit('answer', { target: payload.sender, sender: socketIdRef.current, sdp: peerConnection.localDescription });
            if (pendingNegotiationRef.current[payload.sender]) {
                delete pendingNegotiationRef.current[payload.sender];
                await createOfferForPeer(payload.sender);
            }
        } catch (error) {
            console.error('[WEBRTC] handleOffer error:', {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                error,
            });
        }
    };

    const handleAnswer = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        console.info('[WEBRTC_DIAG] Answer received', {
            meetingId: meetingCode,
            localId: socketIdRef.current,
            remoteId: payload.sender,
            signalingState: peerConnectionsRef.current[payload.sender]?.signalingState || 'missing-peer',
            sdpType: payload.sdp?.type,
        });
        const peerConnection = peerConnectionsRef.current[payload.sender];
        if (!peerConnection) {
            console.error("[WEBRTC_DIAG] Answer received without a peer connection", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
            });
            return;
        }
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            console.info("[WEBRTC_DIAG] Answer remote description applied", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
                signalingState: peerConnection.signalingState,
            });
            await applyPendingIceCandidates(payload.sender, peerConnection);
            console.log('[WEBRTC] Answer applied — connection with', payload.sender, 'established.');
            if (pendingNegotiationRef.current[payload.sender]) {
                delete pendingNegotiationRef.current[payload.sender];
                await createOfferForPeer(payload.sender);
            }
        } catch (error) {
            console.error('[WEBRTC] handleAnswer error:', {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
                signalingState: peerConnection.signalingState,
                connectionState: peerConnection.connectionState,
                error,
            });
        }
    };

    const applyPendingIceCandidates = async (remoteSocketId, peerConnection) => {
        const candidates = pendingIceCandidatesRef.current[remoteSocketId] || [];
        delete pendingIceCandidatesRef.current[remoteSocketId];
        if (candidates.length) {
            console.info("[WEBRTC_DIAG] Applying buffered ICE candidates", {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: remoteSocketId,
                queuedCount: candidates.length,
                signalingState: peerConnection.signalingState,
            });
        }
        for (const candidate of candidates) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('[ICE] Unable to apply queued ICE candidate:', {
                    meetingId: meetingCode,
                    localParticipantId: socketIdRef.current,
                    remoteParticipantId: remoteSocketId,
                    error,
                });
            }
        }
    };

    const handleIceCandidate = async (payload) => {
        if (!payload || payload.sender === socketIdRef.current) return;
        const peerConnection = peerConnectionsRef.current[payload.sender];
        if (!payload.candidate) return;
        if (!peerConnection || !peerConnection.remoteDescription) {
            const pendingCandidates = pendingIceCandidatesRef.current[payload.sender] || [];
            if (pendingCandidates.length < 256) {
                pendingCandidates.push(payload.candidate);
                pendingIceCandidatesRef.current[payload.sender] = pendingCandidates;
                console.debug('[WEBRTC_DIAG] Buffered ICE candidate', {
                    meetingId: meetingCode,
                    localId: socketIdRef.current,
                    remoteId: payload.sender,
                    queuedCount: pendingCandidates.length,
                    hasPeerConnection: Boolean(peerConnection),
                });
            } else {
                console.error('[ICE] Candidate queue limit reached before remote description:', payload.sender);
            }
            return;
        }
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            console.debug('[WEBRTC_DIAG] Applied ICE candidate', {
                meetingId: meetingCode,
                localId: socketIdRef.current,
                remoteId: payload.sender,
                iceConnectionState: peerConnection.iceConnectionState,
            });
        } catch (error) {
            console.error('[ICE] handleIceCandidate error:', {
                meetingId: meetingCode,
                localParticipantId: socketIdRef.current,
                remoteParticipantId: payload.sender,
                hasRemoteDescription: Boolean(peerConnection.remoteDescription),
                signalingState: peerConnection.signalingState,
                iceConnectionState: peerConnection.iceConnectionState,
                error,
            });
        }
    };

    let connectToSocketServer = ({ initialVideo = video, initialAudio = audio } = {}) => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        console.log('[SOCKET] Connecting to socket server at', server_url);
        socketRef.current = io(server_url, { transports: ['websocket'], reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });

        socketRef.current.on('connect', () => {
            socketIdRef.current = socketRef.current.id;
        console.info('[WEBRTC_DIAG] Socket connected', { localId: socketIdRef.current });
            const joinPayload = { 
                roomName: meetingCode, 
                username, 
                isHost,
                token: localStorage.getItem("token"),
                isVideoOn: Boolean(initialVideo && videoAvailable),
                isAudioOn: Boolean(initialAudio && audioAvailable)
            };
            console.log('[SOCKET] Joining meeting:', {
                meetingId: meetingCode,
                participantId: socketIdRef.current,
                username,
                requestedHost: isHost,
                isVideoOn: joinPayload.isVideoOn,
                isAudioOn: joinPayload.isAudioOn,
            });
            socketRef.current.emit('join-room', joinPayload, (result) => {
                if (result?.ok === false) {
                    setMeetingError(result.message || "Unable to join the meeting.");
                    setAskForUsername(true);
                }
            });
        });

        socketRef.current.on('disconnect', (reason) => {
            console.warn('[WEBRTC_DIAG] Socket disconnected; clearing peer connections', {
                localId: socketIdRef.current,
                reason,
            });
            Object.keys(peerConnectionsRef.current).forEach(closePeerConnection);
            setVideos([]);
            pendingIceCandidatesRef.current = {};
            pendingNegotiationRef.current = {};
            makingOfferRef.current = {};
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
                console.log('[SOCKET] admitted event received — setting inWaitingRoom=false, askForUsername=false. getUserMedia will now be triggered by useEffect.');
                setInWaitingRoom(false);
                setAskForUsername(false);
                setSnackMessage('You have been admitted into the meeting.');
                setSnackOpen(true);
            });

            socketRef.current.on('participant-admitted', () => {
                console.log('[SOCKET] participant-admitted event received.');
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
                console.info('[WEBRTC_DIAG] Peer announced', {
                    meetingId: meetingCode,
                    localId: socketIdRef.current,
                    remoteId: participant.socketId,
                    remoteUsername: participant.username,
                    remoteIsHost: participant.isHost === true,
                    shouldInitiate: participant.shouldInitiate,
                });
                setInWaitingRoom(false);
                setAskForUsername(false);
                if (participant.socketId && participant.socketId !== socketIdRef.current) {
                    const peerConnection = ensurePeerConnection(participant.socketId);
                    console.info('[WEBRTC_DIAG] Peer connection mapped', {
                        localId: socketIdRef.current,
                        remoteId: participant.socketId,
                        connectionState: peerConnection?.connectionState,
                        signalingState: peerConnection?.signalingState,
                    });
                    if (participant.shouldInitiate) {
                        console.info('[WEBRTC_DIAG] Initiating peer negotiation', {
                            localId: socketIdRef.current,
                            remoteId: participant.socketId,
                            signalingState: peerConnection?.signalingState,
                        });
                        createOfferForPeer(participant.socketId, false);
                    }
                }
            });

            socketRef.current.on('participants-updated', (participantsList) => {
                const currentParticipants = participantsList || [];
                console.info("[WEBRTC_DIAG] Participant roster received", {
                    meetingId: meetingCode,
                    localParticipantId: socketIdRef.current,
                    participants: currentParticipants.map((participant) => ({
                        participantId: participant.socketId,
                        username: participant.username,
                        isHost: participant.isHost === true,
                    })),
                });
                setParticipants(currentParticipants);
                reconcileMeshPeers(currentParticipants);
            });

            socketRef.current.on('breakout-state', (state) => {
                setBreakoutState({
                    active: state?.active === true,
                    rooms: state?.rooms || {},
                    assignments: state?.assignments || {},
                });
                setBreakoutAssignments(state?.assignments || {});
            });

            socketRef.current.on('breakout-room-changed', (room) => {
                Object.keys(peerConnectionsRef.current).forEach(closePeerConnection);
                setMessages([]);
                setCurrentBreakoutRoom(room || null);
                setSnackMessage(room?.name ? `You moved to ${room.name}.` : "You returned to the main meeting.");
                setSnackOpen(true);
            });

            socketRef.current.on('user-disconnected', ({ socketId }) => {
                closePeerConnection(socketId);
            });
    };

    let handleVideo = () => {
        if (!canUseCamera) return;
        const nextVideo = !video;
        setVideo(nextVideo);
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getVideoTracks().forEach(t => t.enabled = nextVideo);
        }
        socketRef.current?.emit(nextVideo ? 'participant-camera-enabled' : 'participant-camera-disabled', meetingCode);
    }
    let handleAudio = () => {
        if (!canUseMic) return;
        const nextAudio = !audio;
        setAudio(nextAudio);
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getAudioTracks().forEach(t => t.enabled = nextAudio);
        }
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
            stopMediaStream(cameraStreamRef.current);
            stopMediaStream(screenStreamRef.current);
            Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
            peerConnectionsRef.current = {};
            Object.values(remoteVideosRef.current).forEach(stream => {
                if (stream && typeof stream.getTracks === 'function') {
                    stream.getTracks().forEach((track) => track.stop());
                }
            });
            remoteVideosRef.current = {};
        } catch (e) { console.log(e) }
        window.location.href = "/home"
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current && !chatOpenRef.current) {
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

    const createBreakoutRooms = () => {
        const names = breakoutRoomNames.map((name) => name.trim()).filter(Boolean);
        const assignments = Object.fromEntries(
            Object.entries(breakoutAssignments).filter(([, roomId]) => Boolean(roomId))
        );
        socketRef.current?.emit("breakout-create", {
            rooms: names,
            mode: breakoutMode,
            assignments,
        }, (result) => {
            if (!result?.ok) {
                setSnackMessage(result?.message || "Unable to create breakout rooms.");
                setSnackOpen(true);
                return;
            }
            setBreakoutState(result.state);
            setShowBreakoutDialog(false);
            setSnackMessage("Breakout rooms are open.");
            setSnackOpen(true);
        });
    };

    const assignParticipantToRoom = (participantId, roomId) => {
        socketRef.current?.emit("breakout-assign", { socketId: participantId, roomId }, (result) => {
            if (!result?.ok) {
                setSnackMessage(result?.message || "Unable to update this assignment.");
                setSnackOpen(true);
                return;
            }
            setBreakoutState(result.state);
        });
    };

    const closeBreakoutRooms = () => {
        socketRef.current?.emit("breakout-close", meetingCode, (result) => {
            if (!result?.ok) {
                setSnackMessage(result?.message || "Unable to close breakout rooms.");
                setSnackOpen(true);
                return;
            }
            setShowBreakoutDialog(false);
        });
    };

    useEffect(() => {
        if (!socketIdRef.current) return;
        const me = participants.find(p => p.socketId === socketIdRef.current);
        if (me) {
            if (me.canUseMic === false && audio !== false) {
                setAudio(false);
                if (cameraStreamRef.current) {
                    cameraStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
                }
                setSnackMessage("The host has muted your microphone.");
                setSnackOpen(true);
            }
            if (me.canUseCamera === false && video !== false) {
                setVideo(false);
                if (cameraStreamRef.current) {
                    cameraStreamRef.current.getVideoTracks().forEach(t => t.enabled = false);
                }
                setSnackMessage("The host has disabled your camera.");
                setSnackOpen(true);
            }
        }
    }, [participants, audio, video]);

    const localParticipantMetadata = participants.find(p => p.socketId === socketIdRef.current);
    const canUseMic = localParticipantMetadata?.canUseMic !== false;
    const canUseCamera = localParticipantMetadata?.canUseCamera !== false;

    const remoteParticipants = useMemo(() => {
        return (participants || [])
            .filter((participant) => participant.username && participant.socketId && participant.socketId !== socketIdRef.current)
            .map((participant) => {
                const matchedStream = videos.find((entry) => entry.socketId === participant.socketId)?.stream;
                const remoteVideoTrack = matchedStream?.getVideoTracks?.().find((track) =>
                    track.readyState === 'live' && track.enabled !== false && !track.muted
                );
                return {
                    id: participant.socketId || participant.username,
                    username: participant.username,
                    isLocal: false,
                    isHost: participant.isHost === true,
                    stream: matchedStream || null,
                    isCameraEnabled: participant.isVideoOn !== false,
                    isVideoOn: participant.isVideoOn !== false && Boolean(remoteVideoTrack),
                    isAudioOn: participant.isAudioOn !== false,
                    isScreenShare: Boolean(matchedStream && participant.isScreenShare),
                    connectionState: peerStates[participant.socketId] || 'new',
                };
            });
    }, [participants, videos, peerStates]);

    const meetingParticipants = useMemo(() => {
        return [
            {
                id: 'local',
                username: username || 'You',
                isLocal: true,
                isHost,
                stream: localStream,
                isVideoOn: Boolean(
                    video && videoAvailable &&
                    localStream?.getVideoTracks?.().some((track) => track.readyState === 'live' && track.enabled)
                ) && (localParticipantMetadata ? localParticipantMetadata.isVideoOn !== false : true),
                isAudioOn: Boolean(audio && audioAvailable) && (localParticipantMetadata ? localParticipantMetadata.isAudioOn !== false : true),
                isScreenShare: false,
            },
            ...remoteParticipants,
        ];
    }, [remoteParticipants, username, localStream, video, videoAvailable, audio, audioAvailable, localParticipantMetadata, isHost]);

    const primaryContentStream = useMemo(() => {
        const sharedStream = videos.find((entry) => entry.isScreenShare)?.stream;
        if (sharedStream) return sharedStream;
        if (isSharingScreen && screenStreamRef.current) return screenStreamRef.current;
        return null;
    }, [videos, isSharingScreen]);

    useEffect(() => {
        if (primaryContentStream) {
            attachStreamToVideoElement(primaryVideoRef.current, primaryContentStream);
        } else {
            attachStreamToVideoElement(localMeetingVideoRef.current, localStream);
        }
    }, [primaryContentStream, localStream, askForUsername, inWaitingRoom, video, audio]);

    useEffect(() => {
        chatOpenRef.current = showModal;
        if (showModal) setNewMessages(0);
    }, [showModal]);

    const hostParticipant = meetingParticipants.find((participant) => participant.isLocal) || meetingParticipants[0];
    const attendeeParticipants = remoteParticipants;
    const visibleAttendees = attendeeParticipants.slice(0, 6);
    const hiddenParticipantCount = Math.max(attendeeParticipants.length - visibleAttendees.length, 0);
    const hasActiveLocalVideo = Boolean(
        video && localStream?.getVideoTracks?.().some((track) => track.readyState === 'live' && track.enabled)
    );
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
                                <video ref={localLobbyVideoRef} autoPlay muted playsInline className="h-full w-full object-cover"></video>
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '20px', background: '#0f0f10', color: 'white' }}>
                    <div style={{ position: 'relative', width: '320px', borderRadius: '16px', overflow: 'hidden', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <video ref={localWaitingRoomVideoRef} autoPlay muted playsInline style={{ width: '100%', display: 'block' }} />
                        {!videoAvailable && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e' }}>
                                <VideocamOffIcon style={{ fontSize: 48, color: 'rgba(255,255,255,0.3)' }} />
                            </div>
                        )}
                    </div>
                    <h2 style={{ margin: 0 }}>Waiting for the host to let you in...</h2>
                    <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0 }}>Please wait. The host will admit you shortly.</p>
                </div> :

                <div className={styles.meetVideoContainer}>
                    <header className={styles.meetingTopBar}>
                        <div className={styles.meetingBrand}>
                            <span className={styles.brandMark} aria-hidden="true">Z</span>
                            <span>Zoom Clone</span>
                        </div>
                        <div className={styles.meetingInfo}>
                            <span>Meeting ID</span>
                            <strong>{meetingCode}</strong>
                            {currentBreakoutRoom && <strong>{currentBreakoutRoom.name}</strong>}
                            <span
                                className={styles.networkQuality}
                                data-quality={networkQuality.toLowerCase()}
                                title={networkQualityDetails}
                                aria-label={`Network quality: ${networkQuality}. ${networkQualityDetails}`}
                            >
                                <span className={styles.networkQualityDot} aria-hidden="true" />
                                Network · {networkQuality === "Checking" ? "Checking…" : networkQuality}
                            </span>
                            <FormControl size="small" className={styles.qualityControl}>
                                <Select
                                    value={videoQualityMode}
                                    onChange={(event) => {
                                        setVideoQualityMode(event.target.value);
                                        qualityLastChangedRef.current = Date.now();
                                    }}
                                    inputProps={{ "aria-label": "Outgoing video quality" }}
                                >
                                    <MenuItem value="auto">Auto · {activeVideoQuality}</MenuItem>
                                    <MenuItem value="High">High</MenuItem>
                                    <MenuItem value="Medium">Medium</MenuItem>
                                    <MenuItem value="Low">Low</MenuItem>
                                </Select>
                            </FormControl>
                            {qualityWarning && <span className={styles.qualityWarning} title={qualityWarning}>Quality limited</span>}
                        </div>
                    </header>
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
                            <IconButton onClick={() => setModal((isOpen) => !isOpen)} style={{ color: "white" }}>
                                <ChatIcon />                        
                            </IconButton>
                        </Badge>
                        <Badge badgeContent={isHost ? waitingUsers.length : participants.length} color='error'>
                            <IconButton onClick={() => setShowParticipants(true)} style={{ color: "white" }} title="Participants">
                                <PeopleIcon />
                            </IconButton>
                        </Badge>
                        {isHost && (
                            <IconButton
                                onClick={() => {
                                    if (breakoutState.active) {
                                        setBreakoutRoomNames(Object.values(breakoutState.rooms));
                                        setBreakoutAssignments(breakoutState.assignments);
                                    }
                                    setShowBreakoutDialog(true);
                                }}
                                style={{ color: "white" }}
                                title="Breakout rooms"
                            >
                                <GridViewIcon />
                            </IconButton>
                        )}
                        <IconButton onClick={() => setWhiteboardOpen(true)} style={{ color: "white" }} title="Open whiteboard">
                            <BrushIcon />
                        </IconButton>
                        <Button variant="contained" color="error" onClick={handleEndCall} style={{ marginLeft: '10px' }}>
                            {isHost ? "End Meeting" : "Leave"}
                        </Button>
                    </div>

                    <main className={styles.meetingMainArea}>
                        <section className={styles.meetingStage}>
                            <div className={styles.meetingVideoCard}>
                                {primaryContentStream ? (
                                    <video ref={primaryVideoRef} autoPlay playsInline muted className={styles.presentationVideo} />
                                ) : (
                                    <>
                                        <video
                                            className={styles.meetUserVideo}
                                            ref={(element) => {
                                                localMeetingVideoRef.current = element;
                                                // Callback refs run when this conditional video mounts, including
                                                // after screen sharing ends. Reattach the current local stream then.
                                                if (element) {
                                                    attachStreamToVideoElement(element, localStream, { muted: true });
                                                }
                                            }}
                                            autoPlay
                                            muted={true}
                                            playsInline
                                        ></video>
                                        {!hasActiveLocalVideo && (
                                            <div className={styles.meetingAvatar}>
                                                <span>{hostInitials || 'Y'}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div className={styles.meetingStatusBar}>
                                    <span>{username || 'You'} {isHost ? '(Host)' : ''}</span>
                                    <div className={styles.statusPills}>
                                        <span className={hostParticipant?.isAudioOn ? styles.statusPill : styles.statusPillOff}>
                                            {hostParticipant?.isAudioOn ? <MicIcon sx={{ fontSize: 16 }} /> : <MicOffIcon sx={{ fontSize: 16 }} />}
                                        </span>
                                        <span className={hostParticipant?.isVideoOn ? styles.statusPill : styles.statusPillOff}>
                                            {hostParticipant?.isVideoOn ? <VideocamIcon sx={{ fontSize: 16 }} /> : <VideocamOffIcon sx={{ fontSize: 16 }} />}
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
                                <div className={styles.participantCount}>
                                    <span>{meetingParticipants.length}</span>
                                    {hiddenParticipantCount > 0 && <span>+{hiddenParticipantCount} more</span>}
                                </div>
                            </div>

                            <div className={styles.participantGrid}>
                                {visibleAttendees.map((participant) => (
                                    <ParticipantTile key={participant.id} participant={participant} />
                                ))}
                                {visibleAttendees.length === 0 && (
                                    <div className={styles.emptyParticipants}>
                                        <PeopleIcon />
                                        <p>No other participants yet</p>
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
                                        <span aria-label={`${messages.length} messages`}>{messages.length}</span>
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
                                            aria-label="Chat message"
                                        />
                                        <button type="button" className={styles.sendButton} onClick={sendMessage}>Send</button>
                                    </div>
                                </div>
                            )}
                        </aside>
                    </main>
                    
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

                    <Dialog open={showBreakoutDialog} onClose={() => setShowBreakoutDialog(false)} fullWidth maxWidth="sm">
                        <DialogTitle>{breakoutState.active ? "Manage breakout rooms" : "Create breakout rooms"}</DialogTitle>
                        <DialogContent>
                            {!breakoutState.active && (
                                <>
                                    {breakoutRoomNames.map((roomName, index) => (
                                        <div key={`breakout-${index}`} style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "10px" }}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                label={`Room ${index + 1} name`}
                                                value={roomName}
                                                onChange={(event) => setBreakoutRoomNames((previous) =>
                                                    previous.map((name, roomIndex) => roomIndex === index ? event.target.value : name)
                                                )}
                                            />
                                            {breakoutRoomNames.length > 2 && (
                                                <Button onClick={() => setBreakoutRoomNames((previous) => previous.filter((_, roomIndex) => roomIndex !== index))}>
                                                    Remove
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                    {breakoutRoomNames.length < 8 && (
                                        <Button
                                            sx={{ mt: 1 }}
                                            onClick={() => setBreakoutRoomNames((previous) => [...previous, `Room ${previous.length + 1}`])}
                                        >
                                            Add room
                                        </Button>
                                    )}
                                    <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                                        <InputLabel id="breakout-assignment-mode">Assignment</InputLabel>
                                        <Select
                                            labelId="breakout-assignment-mode"
                                            value={breakoutMode}
                                            label="Assignment"
                                            onChange={(event) => setBreakoutMode(event.target.value)}
                                        >
                                            <MenuItem value="auto">Assign participants automatically</MenuItem>
                                            <MenuItem value="manual">Assign participants manually</MenuItem>
                                        </Select>
                                    </FormControl>
                                </>
                            )}
                            {(breakoutMode === "manual" || breakoutState.active) && (
                                <div style={{ display: "grid", gap: "10px", marginTop: "16px" }}>
                                    {participants.filter((participant) => participant.username && !participant.isHost).map((participant) => (
                                        <TextField
                                            key={participant.socketId}
                                            select
                                            fullWidth
                                            size="small"
                                            label={participant.username}
                                            value={breakoutAssignments[participant.socketId] || ""}
                                            onChange={(event) => {
                                                const roomId = event.target.value;
                                                setBreakoutAssignments((previous) => ({ ...previous, [participant.socketId]: roomId }));
                                                if (breakoutState.active) assignParticipantToRoom(participant.socketId, roomId);
                                            }}
                                        >
                                            <MenuItem value="">Keep in main meeting</MenuItem>
                                            {(breakoutState.active ? Object.entries(breakoutState.rooms) : breakoutRoomNames.map((name, index) => [`room-${index + 1}`, name]))
                                                .map(([roomId, roomName]) => (
                                                    <MenuItem key={roomId} value={roomId}>{roomName}</MenuItem>
                                                ))}
                                        </TextField>
                                    ))}
                                </div>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setShowBreakoutDialog(false)}>Cancel</Button>
                            {breakoutState.active ? (
                                <Button color="error" onClick={closeBreakoutRooms}>Return everyone</Button>
                            ) : (
                                <Button variant="contained" onClick={createBreakoutRooms}>Start rooms</Button>
                            )}
                        </DialogActions>
                    </Dialog>

                    <CollaborativeWhiteboard
                        socket={socketRef.current}
                        open={whiteboardOpen}
                        onClose={() => setWhiteboardOpen(false)}
                    />
                    
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
