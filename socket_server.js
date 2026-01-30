const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.get("/online-users", (req, res) => {
  res.json(Array.from(connectedUsers.keys()));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
});

const connectedUsers = new Map();
let lastCheckDate = null;

function checkTimeAndSendReportPopup() {
  const now = new Date();
  const currentDate = now.toDateString();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours === 16 && minutes === 50) {
    if (lastCheckDate !== currentDate) {
      lastCheckDate = currentDate;
      console.log("Rapor popup gönderiliyor");
      io.emit("show_report_popup", {
        message: "Şuan rapor gönderilecektir",
        timestamp: now.toISOString()
      });
    }
  }
}

setInterval(checkTimeAndSendReportPopup, 60000);

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("register", (userId) => {
    if (userId) {
      connectedUsers.set(String(userId), socket.id);
      console.log(`User registered: ${userId} -> ${socket.id}`);
    }
  });

  socket.on("call_user", (data) => {
    const { targetUserId, callerName, callerId, note } = data;
    console.log(
      `Call request from ${callerName} (ID: ${callerId}) to user ${targetUserId}${note ? " with note: " + note : ""}`,
    );

    const targetSocketId = connectedUsers.get(String(targetUserId));

    if (targetSocketId) {
      io.to(targetSocketId).emit("incoming_call", {
        callerName: callerName,
        callerId: callerId,
        note: note || "",
        message: `${callerName} sizi çağırıyor`,
      });
      console.log(`Notification sent to ${targetUserId}`);

      socket.emit("call_sent", {
        targetUserId: targetUserId,
        targetName: data.targetName || `User ${targetUserId}`,
        message: `Çağrı gönderildi`,
      });
      console.log(`Call sent confirmation to caller ${callerName}`);
    } else {
      console.log(`User ${targetUserId} not found or offline`);
      socket.emit("call_sent", {
        targetUserId: targetUserId,
        error: true,
        message: `Kullanıcı çevrimdışı`,
      });
    }
  });

  socket.on("call_seen", (data) => {
    const { callerId, targetName } = data;
    console.log(`Call seen by ${targetName}, notifying caller ${callerId}`);

    const callerSocketId = connectedUsers.get(String(callerId));

    if (callerSocketId) {
      io.to(callerSocketId).emit("call_accepted", {
        targetName: targetName,
        message: `${targetName} çağrınızı gördü`,
      });
      console.log(`Call accepted notification sent to caller ${callerId}`);
    } else {
      console.log(`Caller ${callerId} not found or offline`);
    }
  });

  socket.on("yeni_kod", (data) => {
    console.log("Yeni Kod Alındı ve Yayınlanıyor:", data.kod);
    io.emit("yeni_kod", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (let [uid, sid] of connectedUsers.entries()) {
      if (sid === socket.id) {
        connectedUsers.delete(uid);
        break;
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
