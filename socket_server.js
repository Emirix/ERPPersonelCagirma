const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.get("/online-users", (req, res) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(Array.from(connectedUsers.keys()));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Yerel ağda sorun çıkmaması için tüm kökenlere izin ver
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

const connectedUsers = new Map();
// Video rooms: Map<roomId, Set<userId>>
const videoRooms = new Map();
// User's current room: Map<userId, roomId>
const userRooms = new Map();

function checkTimeAndSendReportPopup() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours === 16 && minutes === 50) {
    const currentDate = now.toDateString();
    if (global.lastCheckDate !== currentDate) {
      global.lastCheckDate = currentDate;
      io.emit("show_report_popup", {
        message: "Şuan rapor gönderilecektir",
        timestamp: now.toISOString()
      });
    }
  }
}

setInterval(checkTimeAndSendReportPopup, 60000);

io.on("connection", (socket) => {
  console.log(`[${new Date().toLocaleTimeString()}] New connection: ${socket.id}`);

  socket.on("register", (userId) => {
    if (userId) {
      const uidStr = String(userId);
      socket.userId = uidStr;
      
      if (!connectedUsers.has(uidStr)) {
        connectedUsers.set(uidStr, new Set());
      }
      connectedUsers.get(uidStr).add(socket.id);
      console.log(`[${new Date().toLocaleTimeString()}] User Registered: ID ${uidStr} (Total Online: ${connectedUsers.size})`);
    }
  });

  socket.on("get_online_users", (callback) => {
    if (typeof callback === "function") {
      callback(Array.from(connectedUsers.keys()));
    }
  });

  socket.on("call_user", (data) => {
    const { targetUserId, callerName, callerId, note } = data;
    const targetSockets = connectedUsers.get(String(targetUserId));

    if (targetSockets && targetSockets.size > 0) {
      const now = new Date();
      const callTime = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');

      targetSockets.forEach(sid => {
        io.to(sid).emit("incoming_call", {
          callerName,
          callerId,
          note: note || "",
          time: callTime,
          message: `${callerName} sizi çağırıyor`,
        });
      });

      socket.emit("call_sent", {
        targetUserId,
        targetName: data.targetName || `User ${targetUserId}`,
        message: `Çağrı gönderildi`,
      });
    } else {
      socket.emit("call_sent", {
        targetUserId,
        error: true,
        message: `Kullanıcı çevrimdışı`,
      });
    }
  });

  socket.on("call_seen", (data) => {
    const { callerId, targetName } = data;
    const callerSockets = connectedUsers.get(String(callerId));

    if (callerSockets) {
      callerSockets.forEach(sid => {
        io.to(sid).emit("call_accepted", {
          targetName,
          message: `${targetName} çağrınızı gördü`,
        });
      });
    }
  });

  // --- VIDEO CALL EVENTS ---

  // 1. Video Call Start (Caller -> Server -> Multiple Targets)
  socket.on("video_call_start", (data) => {
    // Ensure targetIds is always an array
    let { targetIds, callerName, callerId } = data;
    
    // Compatibility: If targetIds is missing but targetId is present (legacy client)
    if (!targetIds && data.targetId) {
        targetIds = [data.targetId];
    }
    
    // If it's still not an array (e.g. single value sent as targetIds), wrap it
    if (!Array.isArray(targetIds)) {
        targetIds = [targetIds];
    }

    // Normalize IDs to strings
    targetIds = targetIds.map(id => String(id));

    // Filter out invalid IDs
    targetIds = targetIds.filter(id => id && id !== "undefined" && id !== "null");

    if (targetIds.length === 0) {
        console.log(`[Video] Call blocked: No valid targets provided by ${callerId}`);
        return;
    }
    
    // Create a new room
    const roomId = `room-${Date.now()}-${callerId}`;
    
    // Create room set and add caller
    videoRooms.set(roomId, new Set([String(callerId)]));
    userRooms.set(String(callerId), roomId);
    
    console.log(`[Video] Call started by ${callerId} in room ${roomId}. Targets: ${targetIds}`);

    // Notify all targets
    targetIds.forEach(targetId => {
      const targetSockets = connectedUsers.get(String(targetId));
      if (targetSockets) {
        targetSockets.forEach(sid => {
          io.to(sid).emit("incoming_video_call", {
            callerName,
            callerId,
            roomId,
            participants: [callerId] // Currently only caller is in
          });
        });
      }
    });
  });

  // 2. Video Call Accepted (Target -> Server -> Caller/Room)
  socket.on("video_call_accepted", (data) => {
    const { callerId, roomId } = data; // callerId is the one who INVITED, but we use roomId now
    const myId = String(socket.userId);
    
    console.log(`[Video] Call accepted by ${myId} for room ${roomId}`);

    if (videoRooms.has(roomId)) {
      const roomUsers = videoRooms.get(roomId);
      
      // Notify existing participants that a new user joined
      roomUsers.forEach(existingUserId => {
        const existingUserSockets = connectedUsers.get(String(existingUserId));
        if (existingUserSockets) {
          existingUserSockets.forEach(sid => {
            io.to(sid).emit("user_joined_video", {
              newUserId: myId
            });
          });
        }
      });

      // Add user to room
      roomUsers.add(myId);
      userRooms.set(myId, roomId);

      // Send current participants to the new joiner so they know who else is there (optional, but good for UI)
      socket.emit("room_joined_success", {
        roomId,
        participants: Array.from(roomUsers).filter(id => id !== myId)
      });
    }
  });

  // 3. Video Call Rejected
  socket.on("video_call_rejected", (data) => {
    const { callerId, rejecterId, roomId } = data;
    console.log(`[Video] Call rejected by ${rejecterId} for room ${roomId}`);
    
    // Notify the caller (who initiated the room)
    const callerSockets = connectedUsers.get(String(callerId));
    if (callerSockets) {
      callerSockets.forEach(sid => {
        io.to(sid).emit("video_call_rejected", {
          rejecterId,
          roomId
        });
      });
    }
  });

  // 4. WebRTC Signaling (Offer, Answer, Candidate) - Relayed to specific target
  socket.on("offer", (data) => {
    const { targetId, offer, callerId } = data;
    const targetSockets = connectedUsers.get(String(targetId));

    if (targetSockets) {
      targetSockets.forEach(sid => {
        io.to(sid).emit("offer", {
          offer,
          callerId
        });
      });
    }
  });

  socket.on("answer", (data) => {
    const { targetId, answer } = data; // targetId is who we are answering (original offerer)
    const myId = String(socket.userId);
    const targetSockets = connectedUsers.get(String(targetId));

    if (targetSockets) {
      targetSockets.forEach(sid => {
        io.to(sid).emit("answer", {
          answer,
          targetId: myId // Sender of answer
        });
      });
    }
  });

  socket.on("ice_candidate", (data) => {
    const { targetId, candidate } = data;
    const myId = String(socket.userId);
    const targetSockets = connectedUsers.get(String(targetId));

    if (targetSockets) {
      targetSockets.forEach(sid => {
        io.to(sid).emit("ice_candidate", {
          candidate,
          targetId: myId // Sender of candidate
        });
      });
    }
  });

  // 5. Leave / End Call
  socket.on("leave_video_call", (data) => {
    const userId = String(socket.userId);
    const roomId = userRooms.get(userId);

    if (roomId && videoRooms.has(roomId)) {
      const roomUsers = videoRooms.get(roomId);
      roomUsers.delete(userId);
      userRooms.delete(userId);

      console.log(`[Video] User ${userId} left room ${roomId}. Remaining: ${roomUsers.size}`);

      // Notify others
      roomUsers.forEach(otherId => {
        const otherSockets = connectedUsers.get(String(otherId));
        if (otherSockets) {
          otherSockets.forEach(sid => {
            io.to(sid).emit("user_left_video", {
              userId: userId
            });
          });
        }
      });

      // Cleanup room if empty
      if (roomUsers.size === 0) {
        videoRooms.delete(roomId);
      }
    }
  });
  
  // Legacy end_call support (maps to leave)
  socket.on("end_call", (data) => {
     // Re-route to leave logic
     const userId = String(socket.userId);
     const roomId = userRooms.get(userId);
     
     if (roomId) {
         // Same logic as leave_video_call
         const roomUsers = videoRooms.get(roomId);
         if(roomUsers) {
             roomUsers.delete(userId);
             userRooms.delete(userId);
             
             roomUsers.forEach(otherId => {
                 const otherSockets = connectedUsers.get(String(otherId));
                 if (otherSockets) {
                     otherSockets.forEach(sid => {
                         io.to(sid).emit("user_left_video", { userId });
                         io.to(sid).emit("end_call", { targetId: userId }); // Backward compat
                     });
                 }
             });
             
             if (roomUsers.size === 0) videoRooms.delete(roomId);
         }
     }
  });

  socket.on("yeni_kod", (data) => {
    io.emit("yeni_kod", data);
  });

  socket.on("disconnect", () => {
    if (socket.userId) {
       // Handle video room disconnect
       const userId = String(socket.userId);
       const roomId = userRooms.get(userId);
       if (roomId && videoRooms.has(roomId)) {
          const roomUsers = videoRooms.get(roomId);
          roomUsers.delete(userId);
          userRooms.delete(userId);
          
          roomUsers.forEach(otherId => {
             const otherSockets = connectedUsers.get(String(otherId));
             if (otherSockets) {
                 otherSockets.forEach(sid => {
                     io.to(sid).emit("user_left_video", { userId });
                 });
             }
          });
          if (roomUsers.size === 0) videoRooms.delete(roomId);
       }

      if (connectedUsers.has(userId)) {
        const userSockets = connectedUsers.get(userId);
        userSockets.delete(socket.id);
        
        if (userSockets.size === 0) {
          connectedUsers.delete(userId);
          console.log(`[${new Date().toLocaleTimeString()}] User Offline: ID ${userId} (Remaining Online: ${connectedUsers.size})`);
        }
      }
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] Unregistered socket disconnected: ${socket.id}`);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
