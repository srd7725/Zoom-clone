import React, { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import server from '../environment';

/* ─── Helpers ─────────────────────────────────────────────────── */
const fmtTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return iso; }
};
const fmtDateTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
};
const durationLabel = (fromIso, toIso) => {
    try {
        const diff = Math.max(0, new Date(toIso) - new Date(fromIso));
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        if (m === 0) return `${s}s`;
        return `${m}m ${s}s`;
    } catch { return '—'; }
};

const KEYWORD_PATTERNS = [
    /\b(decide[ds]?|decision|agreed|resolved|conclusion|final(ly)?|confirmed?)\b/i,
    /\b(action item|follow[ -]?up|todo|to do|assign(ed)?|responsible|owner)\b/i,
    /\b(importan[t]|critica[l]|urgent|must|need[s]? to|blocked?|blocker)\b/i,
    /\b(deadline|due date|by (monday|tuesday|wednesday|thursday|friday|next week|eod|eow))\b/i,
];

const classifyMessage = (text = '') => {
    const lower = text.toLowerCase();
    if (/\b(decide[ds]?|decision|agreed|resolved|conclusion)\b/i.test(text)) return 'decision';
    if (/\b(action item|follow[ -]?up|todo|assign(ed)?|responsible|owner|will do|going to)\b/i.test(text)) return 'action';
    if (KEYWORD_PATTERNS.some(p => p.test(text))) return 'important';
    return 'message';
};

const TYPE_META = {
    decision: { label: '🔑 Decision', color: '#fbbf24', bg: 'rgba(251,191,36,0.09)' },
    action: { label: '✅ Action Item', color: '#34d399', bg: 'rgba(52,211,153,0.09)' },
    important: { label: '⚡ Important', color: '#f87171', bg: 'rgba(248,113,113,0.09)' },
    message: { label: '💬 Message', color: '#94a3b8', bg: 'rgba(148,163,184,0.05)' },
    joined: { label: '→ Joined', color: '#818cf8', bg: 'rgba(129,140,248,0.08)' },
    left: { label: '← Left', color: '#fb923c', bg: 'rgba(251,146,60,0.08)' },
};

/* ─── Sub-components ──────────────────────────────────────────── */
function RecapMessageCard({ item }) {
    const meta = TYPE_META[item.type] || TYPE_META.message;
    return (
        <div style={{
            padding: '12px 16px', borderRadius: 14,
            background: meta.bg, border: `1px solid ${meta.color}22`,
            marginBottom: 10, animation: 'fadeIn 0.3s ease',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: meta.color, letterSpacing: '0.04em' }}>
                    {meta.label}
                </span>
                <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 600 }}>
                    {fmtTime(item.timestamp)}
                </span>
            </div>
            {item.sender && (
                <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 700, marginBottom: 4 }}>
                    {item.sender}
                </div>
            )}
            <div style={{ fontSize: 14, color: '#d1d5db', lineHeight: 1.55, wordBreak: 'break-word' }}>
                {item.text}
            </div>
        </div>
    );
}

function EventCard({ event }) {
    const meta = event.type === 'joined' ? TYPE_META.joined : TYPE_META.left;
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', borderRadius: 12,
            background: meta.bg, border: `1px solid ${meta.color}22`,
            marginBottom: 8,
        }}>
            <span style={{ fontSize: 18 }}>{event.type === 'joined' ? '👋' : '👋'}</span>
            <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, color: '#e8ecff', fontSize: 14 }}>{event.username}</span>
                <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 8 }}>
                    {event.type === 'joined' ? 'joined the meeting' : 'left the meeting'}
                </span>
            </div>
            <span style={{ fontSize: 11, color: '#4b5563', fontWeight: 600 }}>
                {fmtTime(event.timestamp)}
            </span>
        </div>
    );
}

/* ─── Main ─────────────────────────────────────────────────────── */
export default function SmartRecap() {
    const { meetingId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const searchParams = new URLSearchParams(location.search);
    const urlUsername = searchParams.get('username') || 'You';
    const isHost = searchParams.get('host') === 'true';
    const fromParam = searchParams.get('from');    // ISO string — start of missed interval
    const toParam = searchParams.get('to');      // ISO string — end (now)

    const socketRef = useRef(null);

    const [joinedAt, setJoinedAt] = useState(fromParam || null);
    const [meetingStartedAt, setMeetingStartedAt] = useState(null);
    const [missedFrom, setMissedFrom] = useState(fromParam || null);
    const [missedTo, setMissedTo] = useState(toParam || new Date().toISOString());
    const [recap, setRecap] = useState(null);
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('all');

    useEffect(() => {
        if (!meetingId) { setError('No meeting ID provided.'); return; }

        const socket = io(server, { transports: ['websocket'], reconnection: true });
        socketRef.current = socket;

        socket.on('connect', () => {
            setConnected(true);
            setError('');
            // Join as participant to receive server events
            socket.emit('join-room', {
                roomName: meetingId,
                username: urlUsername,
                isHost: false,
                isVideoOn: false,
                isAudioOn: false,
                token: localStorage.getItem('token'),
            });
        });

        socket.on('disconnect', () => setConnected(false));

        socket.on('recap-join-history', ({ joinedAt: ja, meetingStartedAt: msa }) => {
            setJoined(true);
            if (ja) setJoinedAt(ja);
            if (msa) setMeetingStartedAt(msa);

            // If no explicit 'from' param, auto-detect missed interval
            if (!fromParam && ja && msa) {
                const jDate = new Date(ja);
                const mDate = new Date(msa);
                if (jDate > mDate) {
                    // They joined late — missed interval starts from meeting start
                    setMissedFrom(mDate.toISOString());
                    setMissedTo(jDate.toISOString());
                }
            }
        });

        socket.on('recap-result', (result) => {
            setLoading(false);
            setRecap(result);
        });

        socket.on('waiting-room-status', () => {
            // If in waiting room, we can't request recap until admitted
        });

        socket.on('admitted', () => setJoined(true));
        socket.on('participant-admitted', () => setJoined(true));

        return () => { socket.disconnect(); };
    }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

    const requestRecap = useCallback(() => {
        if (!missedFrom || !missedTo || !socketRef.current?.connected) return;
        setLoading(true);
        setRecap(null);
        socketRef.current.emit('request-recap', { missedFrom, missedTo });
    }, [missedFrom, missedTo]);

    // Auto-request if params are pre-filled
    useEffect(() => {
        if (fromParam && toParam && connected) {
            setTimeout(requestRecap, 400);
        }
    }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── Classify and merge recap items ─────────────── */
    const allItems = recap ? [
        ...(recap.messages || []).map(m => ({
            kind: 'message',
            type: classifyMessage(m.data),
            sender: m.sender,
            text: m.data,
            timestamp: m.timestamp,
        })),
        ...(recap.events || []).map(e => ({
            kind: 'event',
            type: e.type,
            username: e.username,
            timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
        })),
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];

    const decisions = allItems.filter(i => i.kind === 'message' && i.type === 'decision');
    const actions = allItems.filter(i => i.kind === 'message' && i.type === 'action');
    const important = allItems.filter(i => i.kind === 'message' && i.type === 'important');
    const events = allItems.filter(i => i.kind === 'event');

    const tabItems = {
        all: allItems,
        decisions,
        actions,
        important,
        events,
    };

    const TAB_LABELS = [
        { id: 'all', label: 'Timeline', count: allItems.length },
        { id: 'decisions', label: '🔑 Decisions', count: decisions.length },
        { id: 'actions', label: '✅ Action Items', count: actions.length },
        { id: 'important', label: '⚡ Important', count: important.length },
        { id: 'events', label: '👋 Join/Leave', count: events.length },
    ];

    const hasMissed = missedFrom && missedTo && new Date(missedTo) > new Date(missedFrom);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0d0f1f 0%, #12172e 40%, #0a0c1a 100%)',
            color: '#fff',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
                @keyframes spin { to{transform:rotate(360deg)} }
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 999px; }
            `}</style>

            {/* Header */}
            <header style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 28px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(16px)',
                position: 'sticky', top: 0, zIndex: 100,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                            color: '#fff', borderRadius: 10, padding: '6px 14px', cursor: 'pointer',
                            fontSize: 13, fontWeight: 700,
                        }}
                    >
                        ← Back
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: 10,
                            background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 17, fontWeight: 900,
                        }}>⏪</div>
                        <div>
                            <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: '-0.01em', lineHeight: 1.2 }}>Smart Recap</div>
                            <div style={{ fontSize: 11, color: '#8b93b8', fontWeight: 600 }}>What Did I Miss?</div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{meetingId}</span>
                    <span style={{
                        background: connected ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                        border: `1px solid ${connected ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                        borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                        color: connected ? '#34d399' : '#f87171',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: connected ? '#34d399' : '#f87171',
                            animation: connected ? 'pulse 1.5s infinite' : 'none',
                        }} />
                        {connected ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
            </header>

            <main style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 64px' }}>

                {/* Missed interval card */}
                <div style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20, padding: '22px 26px', marginBottom: 24,
                    animation: 'fadeIn 0.4s ease',
                }}>
                    <h2 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 800, color: '#e8ecff' }}>
                        Missed Interval
                    </h2>

                    {meetingStartedAt && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                            Meeting started at: <strong style={{ color: '#94a3b8' }}>{fmtDateTime(meetingStartedAt)}</strong>
                            {joinedAt && (
                                <> &nbsp;·&nbsp; You joined at: <strong style={{ color: '#94a3b8' }}>{fmtDateTime(joinedAt)}</strong></>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
                                MISSED FROM
                            </label>
                            <input
                                type="datetime-local"
                                value={missedFrom ? missedFrom.slice(0, 16) : ''}
                                onChange={e => setMissedFrom(e.target.value ? new Date(e.target.value).toISOString() : null)}
                                style={{
                                    width: '100%', padding: '10px 14px', borderRadius: 12,
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                                    color: '#e8ecff', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                                    colorScheme: 'dark',
                                }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
                                MISSED TO
                            </label>
                            <input
                                type="datetime-local"
                                value={missedTo ? missedTo.slice(0, 16) : ''}
                                onChange={e => setMissedTo(e.target.value ? new Date(e.target.value).toISOString() : null)}
                                style={{
                                    width: '100%', padding: '10px 14px', borderRadius: 12,
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                                    color: '#e8ecff', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                                    colorScheme: 'dark',
                                }}
                            />
                        </div>
                    </div>

                    {hasMissed && (
                        <div style={{ fontSize: 13, color: '#818cf8', marginBottom: 16, fontWeight: 600 }}>
                            Duration missed: {durationLabel(missedFrom, missedTo)}
                        </div>
                    )}

                    <button
                        id="generate-recap-btn"
                        onClick={requestRecap}
                        disabled={!hasMissed || !connected || loading}
                        style={{
                            padding: '12px 28px', borderRadius: 14, border: 'none', cursor: hasMissed && connected && !loading ? 'pointer' : 'not-allowed',
                            background: hasMissed && connected && !loading
                                ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                                : 'rgba(255,255,255,0.08)',
                            color: '#fff', fontWeight: 800, fontSize: 14,
                            boxShadow: hasMissed && connected && !loading ? '0 4px 20px rgba(239,68,68,0.25)' : 'none',
                            transition: 'all 0.3s', display: 'flex', alignItems: 'center', gap: 8,
                        }}
                        aria-busy={loading}
                    >
                        {loading
                            ? <><span style={{ width: 16, height: 16, border: '2px solid #ffffff44', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Generating...</>
                            : '⏪ Catch Me Up'}
                    </button>

                    {!connected && (
                        <p style={{ margin: '12px 0 0', fontSize: 12, color: '#f87171' }}>
                            Connecting to meeting... Please wait.
                        </p>
                    )}
                </div>

                {/* Results */}
                {recap && (
                    <div style={{ animation: 'fadeIn 0.4s ease' }}>
                        {/* Tabs */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                            {TAB_LABELS.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    style={{
                                        padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                                        background: activeTab === tab.id ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                                        border: `1px solid ${activeTab === tab.id ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                                        color: activeTab === tab.id ? '#a5b4fc' : '#94a3b8',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,0.1)', borderRadius: 999, padding: '1px 6px' }}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {tabItems[activeTab].length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '48px 24px',
                                border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 18,
                                color: '#4b5563',
                            }}>
                                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>Nothing found in this category</div>
                                <div style={{ fontSize: 13 }}>
                                    {activeTab === 'decisions' && 'No messages containing clear decisions were detected in this interval.'}
                                    {activeTab === 'actions' && 'No action items or follow-ups were detected in this interval.'}
                                    {activeTab === 'important' && 'No messages flagged as important in this interval.'}
                                    {activeTab === 'events' && 'No participants joined or left during this interval.'}
                                    {activeTab === 'all' && 'No chat messages or events were recorded during this interval.'}
                                </div>
                            </div>
                        ) : (
                            <div>
                                {tabItems[activeTab].map((item, idx) =>
                                    item.kind === 'event' ? (
                                        <EventCard key={`ev-${idx}`} event={item} />
                                    ) : (
                                        <RecapMessageCard key={`msg-${idx}`} item={item} />
                                    )
                                )}
                            </div>
                        )}

                        {/* Source note */}
                        <div style={{
                            marginTop: 24, padding: '12px 16px', borderRadius: 12,
                            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                            fontSize: 12, color: '#4b5563', lineHeight: 1.6,
                        }}>
                            <strong style={{ color: '#6b7280' }}>ℹ Source:</strong> This recap is generated from in-meeting chat messages and participant join/leave events during the selected interval. Messages are categorised by keyword analysis (decisions, action items, important topics). Since this application does not record or transcribe audio, only text-based activity is shown. Decisions and action items are keyword-detected, not AI-summarised—please review them in context.
                        </div>
                    </div>
                )}

                {error && (
                    <div style={{ textAlign: 'center', color: '#f87171', padding: 32, fontSize: 15 }}>{error}</div>
                )}
            </main>
        </div>
    );
}
