const express = require("express");
const socketIO = require("socket.io");
const https = require("https");
const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const url = require("url");
const Room = require("./lib/room.js");

const app = express();
let rooms = new Map();

const argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: "https://172.30.1.57:8443/",
    ws_uri: "ws://172.30.1.57:8888/kurento",
  },
});

const asUrl = url.parse(argv.as_uri);
const port = asUrl.port;

/**
 * create https server
 */
const options = {
  key: fs.readFileSync("./keys/server.key"),
  cert: fs.readFileSync("./keys/server.crt"),
};

const server = https.createServer(options, app).listen(port, () => {
  console.log("Group Call started");
  console.log("Open %s in your browser", url.format(asUrl));
});

/** create socket.io server */
const io = socketIO(server);

io.on("connection", (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on("error", (err) => {
    console.log(`socket error: ${err}`);
  });

  socket.on("disconnect", (data) => {
    console.log(`disconnect: ${socket.id}`);
  });

  socket.on("message", async (message) => {
    console.log(
      `received message from ${message.userName}(${socket.id}): ${message.id}`
    );

    switch (message.id) {
      case "joinRoom":
        joinRoom(socket, message, (err) => {
          if (err) {
            console.log(`joinRoom error: ${err}`);
          }
        });
        break;

      case "sdpOffer":
        const room = await getRoom(message.roomName, (err) => {
          if (err) {
            console.log(`couldn't find room: ${message.roomName}`);
          }
        });
        try {
          room.receiveSdpOffer(
            io,
            socket.id,
            message.sdpOffer,
            (err, sdpAnswer) => {
              if (err) {
                console.log(`receiveSdpOffer error: ${err}`);
              }
              const response = {
                id: "sdpAnswer",
                userId: socket.id,
                sdpAnswer: sdpAnswer,
              };
              console.log("send message to client: " + response.id);
              socket.emit("message", response);
            }
          );
        } catch (err) {
          console.log(`sdpOffer error: ${err}`);
        }

        break;

      case "onIceCandidate":
        try {
          const room = await getRoom(message.roomName, (err) => {
            if (err) {
              console.log(`couldn't find room: ${message.roomName}`);
            }
          });
          room.processIceCandidate(socket.id, message.candidate, (err) => {
            if (err) {
              console.log(`addIceCandidate error: ${err}`);
            }
            console.log(`user: ${message.userName} addIceCandidate`);
          });
          break;
        } catch (err) {
          console.log(`onIceCandidate error: ${err}`);
          break;
        }

      case "leaveRoom":
        getRoom(message.roomName, (err, room) => {
          if (err) {
            console.log(`leaveRoom error: ${err}`);
          }
          room.leave(socket.id);
          console.log(`user: ${message.userName} left room: ${room.name}`);
        });
        break;

      default:
        console.error("invalid message id");
        break;
    }
  });
});

const joinRoom = async (socket, message, callback) => {
  try {
    const room = await getRoom(message.roomName);
    await room.join(socket.id, (err) => {
      if (err) {
        console.log(`joinRoom error: ${err}`);
      }
    });

    const response = {
      id: "joinRoomSuccess",
      userName: message.userName,
      roomName: message.roomName,
    };

    console.log(`user: ${response.userName} joined room: ${response.roomName}`);
    console.log("send message to client: " + response.id);
    socket.emit("message", response);
    callback(null);
  } catch (error) {
    callback(error);
  }
};

const getRoom = async (roomName, callback) => {
  const room = rooms.get(roomName);

  if (room == undefined) {
    try {
      const newRoom = new Room(roomName);
      rooms.set(roomName, newRoom);
      console.log(`new room created: ${roomName}`);
      return newRoom;
    } catch (error) {
      throw error;
    }
  } else {
    return room;
  }
};

app.use(express.static(path.join(__dirname, "static")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "static/index.html"));
});
