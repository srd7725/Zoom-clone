import mongoose, {Schema} from "mongoose";


const meetingSchema = new Schema(
    {
        user_id: {type: String}, // kept for backward compatibility (username of creator)
        meetingCode: {type: String, required: true, unique: true},
        date: {type: Date, default: Date.now, required: true},
        
        // New fields for Zoom Clone functionality
        hostId: {type: mongoose.Schema.Types.ObjectId, ref: 'user'}, // Reference to User model
        hostName: {type: String},
        createdAt: {type: Date, default: Date.now},
        endedAt: {type: Date},
        isActive: {type: Boolean, default: true},
        meetingTitle: {type: String},
        
        participants: [{
            username: {type: String},
            socketId: {type: String},
            joinedAt: {type: Date, default: Date.now}
        }],
        
        waitingRoom: [{
            username: {type: String},
            socketId: {type: String},
            requestedAt: {type: Date, default: Date.now}
        }],

        history: [{
            participant: {type: String},
            host: {type: String},
            joinedTime: {type: Date},
            leftTime: {type: Date},
            duration: {type: Number, default: 0}
        }]
    }
)

const Meeting = mongoose.model("Meeting", meetingSchema);

export {Meeting};