import { Meeting } from "../models/meeting.model.js";
import { User } from "../models/user.model.js";
import httpStatus from "http-status";
import crypto from "crypto";

export const createMeeting = async (req, res) => {
    try {
        const { token, meetingTitle } = req.body;
        
        let user;
        if (token) {
            user = await User.findOne({ token });
        }
        
        if (!user) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "User not found or unauthorized to create a meeting" });
        }
        
        // Generate a random meeting code e.g. MEET-A1B2C3
        const randomCode = crypto.randomBytes(3).toString("hex").toUpperCase();
        const meetingCode = `MEET-${randomCode}`;
        
        const newMeeting = new Meeting({
            meetingCode: meetingCode,
            hostId: user._id,
            hostName: user.name || user.username,
            user_id: user.username, // keeping for backward compatibility
            meetingTitle: meetingTitle || `${user.name || user.username}'s Meeting`,
            isActive: true,
            date: new Date()
        });
        
        await newMeeting.save();
        
        return res.status(httpStatus.CREATED).json({
            message: "Meeting created successfully",
            meetingCode: newMeeting.meetingCode,
            meetingTitle: newMeeting.meetingTitle,
            hostName: newMeeting.hostName
        });
        
    } catch (e) {
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ message: `Something went wrong: ${e.message}` });
    }
};

export const validateMeeting = async (req, res) => {
    try {
        const { meetingCode } = req.params;
        
        const meeting = await Meeting.findOne({ meetingCode });
        
        if (!meeting) {
            return res.status(httpStatus.NOT_FOUND).json({ message: "Invalid Meeting Code" });
        }
        
        if (!meeting.isActive) {
            return res.status(httpStatus.BAD_REQUEST).json({ message: "This meeting has already ended." });
        }
        
        return res.status(httpStatus.OK).json({ 
            message: "Meeting is valid", 
            hostName: meeting.hostName,
            meetingTitle: meeting.meetingTitle
        });
        
    } catch (e) {
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ message: `Something went wrong: ${e.message}` });
    }
};

export const endMeeting = async (req, res) => {
    try {
        const { token, meetingCode } = req.body;
        
        const user = await User.findOne({ token });
        if (!user) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized" });
        }
        
        const meeting = await Meeting.findOne({ meetingCode });
        
        if (!meeting) {
            return res.status(httpStatus.NOT_FOUND).json({ message: "Meeting not found" });
        }
        
        if (meeting.hostId.toString() !== user._id.toString() && meeting.user_id !== user.username) {
            return res.status(httpStatus.FORBIDDEN).json({ message: "Only the host can end the meeting" });
        }
        
        meeting.isActive = false;
        meeting.endedAt = new Date();
        await meeting.save();
        
        return res.status(httpStatus.OK).json({ message: "Meeting ended successfully" });
        
    } catch (e) {
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ message: `Something went wrong: ${e.message}` });
    }
};
