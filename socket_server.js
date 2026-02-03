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

  socket.on("yeni_kod", (data) => {
    io.emit("yeni_kod", data);
  });

  socket.on("disconnect", () => {
    if (socket.userId && connectedUsers.has(socket.userId)) {
      const userSockets = connectedUsers.get(socket.userId);
      userSockets.delete(socket.id);
      
      if (userSockets.size === 0) {
        connectedUsers.delete(socket.userId);
        console.log(`[${new Date().toLocaleTimeString()}] User Offline: ID ${socket.userId} (Remaining Online: ${connectedUsers.size})`);
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
