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
  }),
);


app.get("/online-users", (req, res) => {
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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
const userNames = new Map(); // Store user names

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
        timestamp: now.toISOString(),
      });
    }
  }
}

setInterval(checkTimeAndSendReportPopup, 60000);

const socketToUser = new Map(); // socketId -> userId

io.on("connection", (socket) => {
  console.log(
    `[${new Date().toLocaleTimeString()}] New connection: ${socket.id}`,
  );

  socket.on("register", (data) => {
    const userId = typeof data === "object" ? data.userId : data;
    const userName = typeof data === "object" ? data.userName : null;

    if (!userId) return;

    const uid = String(userId);

    socket.userId = uid;
    socketToUser.set(socket.id, uid);

    if (!connectedUsers.has(uid)) {
      connectedUsers.set(uid, new Set());
    }

    connectedUsers.get(uid).add(socket.id);

    if (userName) {
      userNames.set(uid, userName);
    }

    console.log(
      `[${new Date().toLocaleTimeString()}] User Registered: ${uid} (${userName || "Unknown"}) | Online Users: ${connectedUsers.size}`,
    );
  });

  socket.on("disconnect", (reason) => {
    const userId = socketToUser.get(socket.id) || socket.userId;

    console.log(
      `[${new Date().toLocaleTimeString()}] Disconnected: ${socket.id} | User: ${userId} | Reason: ${reason}`,
    );

    if (userId) {
      const sockets = connectedUsers.get(userId);

      if (sockets) {
        sockets.delete(socket.id);

        if (sockets.size === 0) {
          connectedUsers.delete(userId);

          // Sayfa yenilemelerinde "çevrimdışı" uyarısı gitmemesi için 5 saniye bekletiyoruz
          setTimeout(() => {
            const uid = String(userId);
            if (!connectedUsers.has(uid)) {
              const adminIds = ["1", "9"];
              if (!adminIds.includes(uid)) {
                const name = userNames.get(uid) || `Kullanıcı ${uid}`;

                adminIds.forEach((adminId) => {
                  const adminSockets = connectedUsers.get(String(adminId));
                  if (adminSockets && adminSockets.size > 0) {
                    adminSockets.forEach((sid) => {
                      io.to(sid).emit("user_offline_notification", {
                        userId: uid,
                        userName: name,
                        message: `${name} çevrimdışı oldu.`,
                      });
                    });
                  }
                });
              }
              userNames.delete(uid);
            }
          }, 5000);
        }
      }
    }

    socketToUser.delete(socket.id);
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
      const callTime =
        now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0");

      targetSockets.forEach((sid) => {
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
      callerSockets.forEach((sid) => {
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
    const { targetIds, callerName, callerId } = data;
    
    // Gelen verinin dizi olduğundan emin olalım
    const targets = Array.isArray(targetIds) ? targetIds : [targetIds];

    targets.forEach(id => {
        // Map içindeki key string ise String(id), number ise Number(id) kullanın
        const targetSockets = connectedUsers.get(String(id)); 
        
        console.log(`${id} kullanıcısı için bulunan socketler:`, targetSockets);

        if (targetSockets && targetSockets.size > 0) {
            targetSockets.forEach(sid => {
                io.to(sid).emit("incoming_video_call", {
                    callerName,
                    callerId
                });
                console.log(`${sid} nolu socket'e çağrı gönderildi.`);
            });
        } else {
            console.log(`${id} ID'li kullanıcı şu an bağlı değil (offline).`);
        }
    });
});

  socket.on("yeni_kod", (data) => {
    io.emit("yeni_kod", data);
  });
});

const PORT = 3008;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
