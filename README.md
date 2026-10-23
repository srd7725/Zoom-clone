# 🎥 Zoom Clone

A production-ready **Zoom Clone** built using the **MERN Stack**, **WebRTC**, and **Socket.IO**. This application provides real-time video conferencing with features inspired by Zoom, including secure authentication, waiting room, host controls, live chat, screen sharing, and high-quality audio/video communication.

---

## 📌 Features

### 🔐 Authentication
- Google Authentication
- Secure Login
- JWT Authentication
- Protected Routes

### 🎥 Meeting Features
- Create Meeting
- Join Meeting
- Unique Meeting ID
- Meeting Validation
- Lobby Before Joining
- Waiting Room
- Admit / Reject Participants
- End Meeting

### 📹 Video Calling
- HD Video Calling
- Live Camera Preview
- Camera On/Off
- Multiple Participants
- Dynamic Video Layout
- Local & Remote Video Rendering

### 🎙 Audio Features
- Live Voice Communication
- Microphone Toggle
- Mute Participants
- Echo Cancellation
- Noise Suppression

### 💻 Screen Sharing
- Share Entire Screen
- Start/Stop Screen Sharing
- Switch Between Camera and Screen

### 💬 Chat
- Real-Time Chat
- Instant Message Delivery
- Socket.IO Based Messaging

### 👨‍💼 Host Controls
- Admit Participants
- Reject Participants
- Remove Participants
- Mute Participants
- Allow/Deny Camera
- Allow/Deny Microphone
- End Meeting For Everyone

### 🧩 Network and Collaboration
- Per-peer WebRTC connection health monitoring and bounded ICE-restart recovery
- Network quality indicator and Auto/High/Medium/Low outgoing video encoding targets
- Host-managed breakout rooms with automatic or manual assignment
- Room-scoped participant lists, chat, WebRTC signaling, and whiteboards
- Collaborative whiteboard with pen, eraser, color, brush size, undo, redo, and clear

Breakout-room assignments and whiteboard history are held in server memory and are lost when the backend restarts. Video quality settings are best-effort sender targets; browser/device support and available WebRTC statistics vary. The app uses peer-to-peer mesh connections, so connection and media load grows with the number of participants.

### 🎨 User Interface
- Zoom Inspired Interface
- Responsive Design
- Smooth User Experience
- Modern UI

---

# 🛠 Tech Stack

## Frontend
- React.js
- JavaScript (ES6+)
- HTML5
- CSS Modules

## Backend
- Node.js
- Express.js

## Database
- MongoDB Atlas
- Mongoose

## Real-Time Communication
- WebRTC
- Socket.IO

## Authentication
- Google OAuth
- JWT

---

# 📁 Project Structure

```
Zoom-Clone/
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── socket/
│   ├── utils/
│   └── server.js
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   ├── styles/
│   │   ├── utils/
│   │   └── App.js
│   │
│   └── package.json
│
├── README.md
└── .gitignore
```

---

# 🚀 Installation

## Clone Repository

```bash
git clone https://github.com/your-username/Zoom-Clone.git
```

```bash
cd Zoom-Clone
```

---

## Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file inside the backend folder.

```env
PORT=5000

MONGO_URI=Your MongoDB URI

JWT_SECRET=Your JWT Secret

GOOGLE_CLIENT_ID=Your Google Client ID

GOOGLE_CLIENT_SECRET=Your Google Client Secret
```

Start Backend

```bash
npm start
```

---

## Frontend Setup

```bash
cd frontend
npm install
```

Start Frontend

```bash
npm start
```

Application will run on:

```
http://localhost:3000
```

---

# 🔄 Application Flow

## Host Flow

```
Login
      ↓
Create Meeting
      ↓
Lobby
      ↓
Camera & Microphone Preview
      ↓
Start Meeting
      ↓
Receive Join Requests
      ↓
Admit / Reject Participants
      ↓
Manage Meeting
      ↓
End Meeting
```

---

## Participant Flow

```
Login
      ↓
Open Meeting Link
      ↓
Meeting Validation
      ↓
Lobby
      ↓
Camera & Microphone Preview
      ↓
Waiting Room
      ↓
Host Admission
      ↓
Join Meeting
      ↓
Video, Audio & Chat
      ↓
Leave Meeting
```

---

# 🔒 Security

- JWT Authentication
- Protected APIs
- Secure Google Login
- Waiting Room Verification
- Host Controlled Admission
- Secure Socket Communication

---

# ⚡ Highlights

- Real-Time Video Calling
- Live Audio Communication
- Screen Sharing
- Host Controls
- Waiting Room
- Google Login
- Lobby System
- Meeting Validation
- Chat
- Network recovery
- Adaptive video quality
- Breakout rooms
- Collaborative whiteboard
- Responsive UI
- MERN Stack
- WebRTC
- Socket.IO

---

# 📸 Screenshots

## Lobby

_Add screenshot here_

---

## Meeting Room

_Add screenshot here_

---

## Waiting Room

_Add screenshot here_

---

## Host Controls

_Add screenshot here_

---

# 🚀 Future Improvements

- Meeting Recording
- Virtual Background
- Raise Hand
- Emoji Reactions
- File Sharing
- Calendar Integration
- Live Captions
- Meeting History

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository

2. Create a new branch

```bash
git checkout -b feature-name
```

3. Commit your changes

```bash
git commit -m "Added new feature"
```

4. Push your branch

```bash
git push origin feature-name
```

5. Create a Pull Request

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Developer

**Sharad Ahirwar**

- B.Tech CSE Student
- MERN Stack Developer
- Java Developer
- Passionate about Full Stack Development, Real-Time Applications, and Software Engineering

---

## ⭐ Support

If you like this project, please give it a **⭐ Star** on GitHub.

Thank you for visiting this repository!