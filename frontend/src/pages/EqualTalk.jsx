import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import server from '../environment';

/* ─── helpers ─────────────────────────────────────────────────── */
const fmt = (ms) => {
    if (!ms || ms < 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const getInitials = (name = '') =>
    name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';

const HUES = [220, 260, 180, 30, 340, 90, 200, 310];
const hue = (index) => HUES[index % HUES.length];

/* ─── Balance ring ────────────────────────────────────────────── */
function BalanceRing({ score }) {
    const r = 44;
    const circ = 2 * Math.PI * r;
    const dash = score != null ? (score / 100) * circ : 0;
    const color = score == null ? '#4b5563' : score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : '#f87171';

    return (
        <svg viewBox="0 0 100 100" width="110" height="110" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
                cx="50" cy="50" r={r} fill="none"
                stroke={color} strokeWidth="8"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.5s ease' }}
            />
        </svg>
    );
}

/* ─── Participant row ─────────────────────────────────────────── */
function ParticipantRow({ entry, index, isSpeaking }) {
    const barWidth = `${Math.min(100, entry.percentage)}%`;
    const color = `hsl(${hue(index)}, 70%, 60%)`;
    const bgColor = `hsla(${hue(index)}, 70%, 60%, 0.12)`;

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                borderRadius: 14,
                background: isSpeaking ? 'rgba(99,102,241,0.13)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSpeaking ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'}`,
                transition: 'background 0.3s, border-color 0.3s',
                position: 'relative',
                overflow: 'hidden',
            }}
            aria-label={`${entry.username}: ${entry.percentage}% speaking time`}
        >
            {/* Speaking pulse glow */}
            {isSpeaking && (
                <div style={{
                    position: 'absolute', inset: 0, borderRadius: 14,
                    background: 'rgba(99,102,241,0.07)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    pointerEvents: 'none',
                }} />
            )}

            {/* Avatar */}
            <div style={{
                flexShrink: 0,
                width: 42, height: 42, borderRadius: '50%',
                background: `linear-gradient(135deg, hsl(${hue(index)}, 65%, 42%), hsl(${hue(index)}, 75%, 58%))`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 14, color: '#fff',
                boxShadow: isSpeaking ? `0 0 0 3px hsl(${hue(index)}, 65%, 55%), 0 0 12px hsla(${hue(index)}, 65%, 55%, 0.4)` : 'none',
                transition: 'box-shadow 0.3s',
            }}>
                {getInitials(entry.username)}
            </div>

            {/* Name + bar */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center', gap: 8 }}>
                    <span style={{
                        fontWeight: 700, fontSize: 14, color: '#e8ecff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {entry.username}
                        {isSpeaking && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#a5b4fc', fontWeight: 600, letterSpacing: '0.04em' }}>
                                ● SPEAKING
                            </span>
                        )}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
                        {fmt(entry.totalMs)}
                    </span>
                </div>

                {/* Progress bar */}
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%', borderRadius: 999,
                        width: barWidth,
                        background: `linear-gradient(90deg, ${color}, hsl(${hue(index)}, 80%, 72%))`,
                        transition: 'width 0.8s ease',
                        boxShadow: isSpeaking ? `0 0 8px ${color}` : 'none',
                    }} />
                </div>
            </div>

            {/* Percentage badge */}
            <div style={{
                flexShrink: 0,
                minWidth: 48, textAlign: 'center',
                borderRadius: 9, padding: '4px 8px',
                background: bgColor,
                border: `1px solid ${color}33`,
                color, fontWeight: 800, fontSize: 14,
                transition: 'background 0.5s',
            }}>
                {entry.percentage.toFixed(1)}%
            </div>
        </div>
    );
}

/* ─── Main component ──────────────────────────────────────────── */
export default function EqualTalk() {
    const { meetingId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const searchParams = new URLSearchParams(location.search);
    const urlUsername = searchParams.get('username') || '';
    const isHost = searchParams.get('host') === 'true';

    const socketRef = useRef(null);
    const pollTimerRef = useRef(null);
    const alertCooldownRef = useRef({});
    const ALERT_THRESHOLD = parseInt(searchParams.get('threshold') || '60', 10); // default 60%
    const ALERT_COOLDOWN_MS = 120_000; // 2 min

    const [stats, setStats] = useState(null);
    const [speakingMap, setSpeakingMap] = useState({});
    const [finalSummary, setFinalSummary] = useState(null);
    const [connected, setConnected] = useState(false);
    const [hostAlerts, setHostAlerts] = useState([]);
    const [alertsEnabled, setAlertsEnabled] = useState(true);
    const [error, setError] = useState('');

    const dismissAlert = useCallback((id) => {
        setHostAlerts(prev => prev.filter(a => a.id !== id));
    }, []);

    const checkHostAlerts = useCallback((snapshot) => {
        if (!isHost || !alertsEnabled) return;
        const now = Date.now();
        (snapshot.participants || []).forEach(p => {
            if (p.percentage >= ALERT_THRESHOLD) {
                const lastAlert = alertCooldownRef.current[p.socketId] || 0;
                if (now - lastAlert > ALERT_COOLDOWN_MS) {
                    alertCooldownRef.current[p.socketId] = now;
                    const alertId = `${p.socketId}-${now}`;
                    setHostAlerts(prev => [
                        ...prev.slice(-4),
                        {
                            id: alertId,
                            message: `${p.username} has used ${p.percentage.toFixed(0)}% of total speaking time.`,
                            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        }
                    ]);
                    setTimeout(() => dismissAlert(alertId), 10_000);
                }
            }
        });
    }, [isHost, alertsEnabled, ALERT_THRESHOLD, dismissAlert]);

    useEffect(() => {
        if (!meetingId) { setError('No meeting ID provided.'); return; }

        const socket = io(server, { transports: ['websocket'], reconnection: true });
        socketRef.current = socket;

        socket.on('connect', () => {
            setConnected(true);
            setError('');
            // Join the meeting room as observer only (just to receive broadcasts)
            socket.emit('join-room', {
                roomName: meetingId,
                username: urlUsername || 'Observer',
                isHost: false,
                isVideoOn: false,
                isAudioOn: false,
                token: localStorage.getItem('token'),
            });
        });

        socket.on('disconnect', () => setConnected(false));

        socket.on('speaking-stats-update', (snapshot) => {
            setStats(snapshot);
            checkHostAlerts(snapshot);
        });

        socket.on('participant-speaking', ({ socketId, isSpeaking }) => {
            setSpeakingMap(prev => ({ ...prev, [socketId]: isSpeaking }));
        });

        socket.on('equaltalk-final-summary', (summary) => {
            setFinalSummary(summary);
        });

        // Poll for stats every 3 seconds
        pollTimerRef.current = setInterval(() => {
            if (socket.connected) {
                socket.emit('request-speaking-stats');
            }
        }, 3000);

        // Immediate first poll after a short delay
        setTimeout(() => {
            if (socket.connected) socket.emit('request-speaking-stats');
        }, 800);

        return () => {
            clearInterval(pollTimerRef.current);
            socket.disconnect();
        };
    }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

    const displayStats = finalSummary || stats;
    const participants = displayStats?.participants || [];
    const totalMs = displayStats?.totalMs || 0;
    const balanceScore = displayStats?.balanceScore;
    const currentSpeakers = participants.filter(p => speakingMap[p.socketId]);

    const sorted = [...participants].sort((a, b) => b.totalMs - a.totalMs);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0d0f1f 0%, #12172e 40%, #0a0c1a 100%)',
            color: '#fff',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            overflowX: 'hidden',
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
                @keyframes slideIn { from{transform:translateY(-12px);opacity:0} to{transform:translateY(0);opacity:1} }
                @keyframes fadeIn { from{opacity:0} to{opacity:1} }
                @keyframes spin { to{transform:rotate(360deg)} }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 999px; }
            `}</style>

            {/* Header */}
            <header style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 28px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(0,0,0,0.3)',
                backdropFilter: 'blur(16px)',
                position: 'sticky', top: 0, zIndex: 100,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                            color: '#fff', borderRadius: 10, padding: '6px 14px', cursor: 'pointer',
                            fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                        }}
                        aria-label="Go back to meeting"
                    >
                        ← Back
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: 10,
                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 16, fontWeight: 900,
                        }}>⚡</div>
                        <div>
                            <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: '-0.01em', lineHeight: 1.2 }}>EqualTalk</div>
                            <div style={{ fontSize: 11, color: '#8b93b8', fontWeight: 600 }}>Live Speaking Analytics</div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em' }}>
                        {meetingId}
                    </span>
                    {!finalSummary && (
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                            border: `1px solid ${connected ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                            borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700,
                            color: connected ? '#34d399' : '#f87171',
                        }}>
                            <span style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: connected ? '#34d399' : '#f87171',
                                animation: connected ? 'pulse 1.5s infinite' : 'none',
                            }} />
                            {connected ? 'LIVE' : 'Disconnected'}
                        </span>
                    )}
                    {finalSummary && (
                        <span style={{
                            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
                            borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800, color: '#a5b4fc',
                        }}>
                            Final Summary
                        </span>
                    )}
                </div>
            </header>

            {/* Host alerts */}
            {isHost && alertsEnabled && hostAlerts.length > 0 && (
                <div style={{ position: 'fixed', top: 80, right: 20, zIndex: 200, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
                    {hostAlerts.map(alert => (
                        <div key={alert.id} style={{
                            background: 'rgba(15,18,40,0.95)', border: '1px solid rgba(251,191,36,0.4)',
                            borderRadius: 14, padding: '12px 16px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                            animation: 'slideIn 0.3s ease',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10 }}>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', marginBottom: 3 }}>
                                        ⚠ Host Alert · {alert.time}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#e8ecff' }}>{alert.message}</div>
                                </div>
                                <button onClick={() => dismissAlert(alert.id)} style={{
                                    background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
                                }}>×</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {error ? (
                <div style={{ textAlign: 'center', marginTop: 80, color: '#f87171', fontSize: 16, fontWeight: 600 }}>
                    {error}
                </div>
            ) : (
                <main style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px 48px' }}>
                    {/* Top summary row */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 16, marginBottom: 28,
                    }}>
                        {/* Balance card */}
                        <div style={{
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 20, padding: '20px 24px',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                        }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <BalanceRing score={balanceScore} />
                                <div style={{
                                    position: 'absolute', textAlign: 'center',
                                    transform: 'rotate(90deg)',
                                }}>
                                    <div style={{ fontSize: 22, fontWeight: 900, color: balanceScore == null ? '#4b5563' : balanceScore >= 70 ? '#34d399' : balanceScore >= 40 ? '#fbbf24' : '#f87171' }}>
                                        {balanceScore != null ? `${balanceScore}` : '—'}
                                    </div>
                                    <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700 }}>BALANCE</div>
                                </div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#c7d2fe' }}>Participation Balance</div>
                                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
                                    {balanceScore == null ? 'Not enough data' :
                                        balanceScore >= 70 ? 'Well balanced' :
                                            balanceScore >= 40 ? 'Moderately balanced' : 'Concentrated'}
                                </div>
                            </div>
                        </div>

                        {/* Total speaking */}
                        <div style={{
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 20, padding: '20px 24px',
                        }}>
                            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Total Speaking Time</div>
                            <div style={{ fontSize: 32, fontWeight: 900, color: '#e8ecff', lineHeight: 1 }}>{fmt(totalMs)}</div>
                            <div style={{ fontSize: 12, color: '#4b5563', marginTop: 6 }}>
                                Note: simultaneous speech may exceed wall-clock time
                            </div>
                        </div>

                        {/* Speaker count */}
                        <div style={{
                            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 20, padding: '20px 24px',
                        }}>
                            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Active Speakers</div>
                            <div style={{ fontSize: 32, fontWeight: 900, color: '#e8ecff', lineHeight: 1 }}>
                                {participants.filter(p => p.totalMs > 0).length}
                                <span style={{ fontSize: 16, color: '#6b7280', fontWeight: 600 }}> / {participants.length}</span>
                            </div>
                            {currentSpeakers.length > 0 && (
                                <div style={{ fontSize: 12, color: '#818cf8', marginTop: 6, fontWeight: 600 }}>
                                    🎙 {currentSpeakers.map(p => p.username).join(', ')}
                                </div>
                            )}
                        </div>

                        {/* Host alerts toggle */}
                        {isHost && (
                            <div style={{
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 20, padding: '20px 24px',
                                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                            }}>
                                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Host Alerts</div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
                                        Alert at {ALERT_THRESHOLD}% share
                                    </span>
                                    <button
                                        onClick={() => setAlertsEnabled(v => !v)}
                                        style={{
                                            width: 44, height: 24, borderRadius: 999,
                                            background: alertsEnabled ? '#6366f1' : 'rgba(255,255,255,0.1)',
                                            border: 'none', cursor: 'pointer',
                                            position: 'relative', transition: 'background 0.3s',
                                        }}
                                        aria-label={alertsEnabled ? 'Disable host alerts' : 'Enable host alerts'}
                                        role="switch"
                                        aria-checked={alertsEnabled}
                                    >
                                        <span style={{
                                            position: 'absolute', top: 3, left: alertsEnabled ? 22 : 3,
                                            width: 18, height: 18, borderRadius: '50%', background: '#fff',
                                            transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                                        }} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Participants list */}
                    <section>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#e8ecff' }}>
                                Speaking Breakdown
                            </h2>
                            <span style={{ fontSize: 12, color: '#4b5563', fontWeight: 600 }}>
                                % of detected speaking time
                            </span>
                        </div>

                        {sorted.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '60px 24px',
                                border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 20,
                                color: '#4b5563',
                            }}>
                                <div style={{ fontSize: 40, marginBottom: 16 }}>🎙</div>
                                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#6b7280' }}>No speaking data yet</div>
                                <div style={{ fontSize: 13 }}>Analytics will appear once participants start speaking in the meeting.</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {sorted.map((entry, i) => (
                                    <ParticipantRow
                                        key={entry.socketId}
                                        entry={entry}
                                        index={i}
                                        isSpeaking={Boolean(speakingMap[entry.socketId])}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Disclaimer */}
                    <div style={{
                        marginTop: 32, padding: '14px 18px', borderRadius: 14,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        fontSize: 12, color: '#4b5563', lineHeight: 1.6,
                    }}>
                        <strong style={{ color: '#6b7280' }}>ℹ About EqualTalk:</strong> Speaking time is estimated using Web Audio API energy analysis on your local audio stream and from server-reported speaking events. It is an approximation — background noise, music, or simultaneous speech may affect accuracy. Percentages reflect share of <em>total detected speaking time</em>, not total meeting duration.
                        {balanceScore != null && (
                            <span> Balance score uses normalised entropy: 100 × (−Σ pᵢ ln(pᵢ) / ln(N)) where pᵢ is each participant's speaking share.</span>
                        )}
                    </div>
                </main>
            )}
        </div>
    );
}
