import React, { useContext, useState } from 'react'
import withAuth from '../utils/withAuth'
import { useNavigate } from 'react-router-dom'
import "../App.css";
import { Button, IconButton, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { AuthContext } from '../contexts/AuthContext';

function HomeComponent() {
    let navigate = useNavigate();
    const [meetingCode, setMeetingCode] = useState("");
    const [meetingTitle, setMeetingTitle] = useState("");
    
    // Modal states
    const [openCreateModal, setOpenCreateModal] = useState(false);
    const [generatedCode, setGeneratedCode] = useState("");
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState("");

    const {addToUserHistory, createNewMeeting, validateMeetingCode} = useContext(AuthContext);
    
    let handleJoinVideoCall = async () => {
        try {
            await validateMeetingCode(meetingCode);
            await addToUserHistory(meetingCode);
            navigate(`/${meetingCode}?host=false`);
        } catch (err) {
            setSnackMessage(err?.response?.data?.message || "Invalid Meeting Code");
            setSnackOpen(true);
        }
    }
    
    let handleCreateMeeting = async () => {
        try {
            const result = await createNewMeeting(meetingTitle);
            setGeneratedCode(result.meetingCode);
            await addToUserHistory(result.meetingCode);
        } catch (err) {
            setSnackMessage(err?.response?.data?.message || "Failed to create meeting");
            setSnackOpen(true);
        }
    }
    
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setSnackMessage("Copied to clipboard!");
        setSnackOpen(true);
    }

    return (
        <>
            <div className="navBar">
                <div style={{ display: "flex", alignItems: "center" }}>
                    <h2>Apna Video Call</h2>
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <IconButton onClick={() => navigate("/history")}>
                        <RestoreIcon />
                    </IconButton>
                    <p>History</p>
                    <Button onClick={() => {
                        localStorage.removeItem("token")
                        navigate("/auth")
                    }}>
                        Logout
                    </Button>
                </div>
            </div>

            <div className="meetContainer">
                <div className="leftPanel">
                    <div>
                        <h2>Providing Quality Video Call Just Like Quality Education</h2>
                        <div style={{ display: 'flex', gap: "10px", marginBottom: "20px" }}>
                            <Button onClick={() => setOpenCreateModal(true)} variant='contained' color='primary'>Create Meeting</Button>
                        </div>
                        <div style={{ display: 'flex', gap: "10px" }}>
                            <TextField onChange={e => setMeetingCode(e.target.value)} id="outlined-basic" label="Meeting Code" variant="outlined" />
                            <Button onClick={handleJoinVideoCall} variant='contained' color='secondary'>Join</Button>
                        </div>
                    </div>
                </div>
                <div className='rightPanel'>
                    <img srcSet='/logo3.png' alt="Logo" />
                </div>
            </div>
            
            {/* Create Meeting Modal */}
            <Dialog open={openCreateModal} onClose={() => setOpenCreateModal(false)}>
                <DialogTitle>Create New Meeting</DialogTitle>
                <DialogContent>
                    {!generatedCode ? (
                        <TextField
                            autoFocus
                            margin="dense"
                            id="title"
                            label="Meeting Title (Optional)"
                            type="text"
                            fullWidth
                            variant="outlined"
                            value={meetingTitle}
                            onChange={(e) => setMeetingTitle(e.target.value)}
                        />
                    ) : (
                        <div>
                            <p><strong>Meeting Code:</strong> {generatedCode} 
                                <IconButton onClick={() => copyToClipboard(generatedCode)}><ContentCopyIcon fontSize='small'/></IconButton>
                            </p>
                            <p><strong>Invite Link:</strong> {window.location.origin}/{generatedCode}
                                <IconButton onClick={() => copyToClipboard(`${window.location.origin}/${generatedCode}`)}><ContentCopyIcon fontSize='small'/></IconButton>
                            </p>
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenCreateModal(false)}>Cancel</Button>
                    {!generatedCode ? (
                        <Button onClick={handleCreateMeeting} variant='contained'>Create</Button>
                    ) : (
                        <Button onClick={() => navigate(`/${generatedCode}?host=true`)} variant='contained' color='success'>Start Meeting</Button>
                    )}
                </DialogActions>
            </Dialog>
            
            <Snackbar
                open={snackOpen}
                autoHideDuration={4000}
                onClose={() => setSnackOpen(false)}
                message={snackMessage}
            />
        </>
    )
}


export default withAuth(HomeComponent)