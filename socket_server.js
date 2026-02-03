const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// CORS Yapılandırması - Tek bir yerden ve düzgün yönetim
app.use(
  cors({
    origin: true, // İstek atan her adresi otomatik kabul et (Credentials için en hızlı yol)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Online kullanıcı listesi endpoint'i
app.get("/online-users", (req, res) => {
  // Map.keys()'i diziye çevirip hızlıca gönderiyoruz
  res.json(Array.from(connectedUsers.keys()));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// userId -> Set(socket.id) şeklinde tutarak birden fazla sekmeyi yönetelim
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
  socket.on("register", (userId) => {
    if (userId) {
      const uidStr = String(userId);
      socket.userId = uidStr;
      
      if (!connectedUsers.has(uidStr)) {
        connectedUsers.set(uidStr, new Set());
      }
      connectedUsers.get(uidStr).add(socket.id);
      console.log(`User registered: ${uidStr}`);
    }
  });

  socket.on("call_user", (data) => {
    const { targetUserId, callerName, callerId, note } = data;
    const targetSockets = connectedUsers.get(String(targetUserId));

    if (targetSockets && targetSockets.size > 0) {
      // Kullanıcının tüm açık sekmelerine bildirimi gönder
      targetSockets.forEach(sid => {
        io.to(sid).emit("incoming_call", {
          callerName,
          callerId,
          note: note || "",
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

  socket.on("get_online_users", (callback) => {
    if (typeof callback === "function") {
      callback(Array.from(connectedUsers.keys()));
    }
  });

  socket.on("disconnect", () => {
    if (socket.userId && connectedUsers.has(socket.userId)) {
      const userSockets = connectedUsers.get(socket.userId);
      userSockets.delete(socket.id);
      
      if (userSockets.size === 0) {
        connectedUsers.delete(socket.userId);
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
