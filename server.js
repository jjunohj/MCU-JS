const express = require("express");
const socketIO = require("socket.io");
const https = require("https");
const fs = require("fs");
const path = require("path");
const minimist = require("minimist");
const url = require("url");
const Room = require("./lib/room.js");

const app = express();
let rooms = {};

const argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: "https://10.168.69.118:8443/",
    ws_uri: "ws://10.168.69.118:8888/kurento",
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
        const room = getRoom(message.roomName, (err) => {
          if (err) {
            console.log(`couldn't find room: ${message.roomName}`);
          }
        });
        try {
          const sdpAnswer = room.receiveSdpOffer(
            io,
            socket.id,
            message.sdpOffer,
            (err) => {
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
        getRoom(message.roomName, (err, room) => {
          if (err) {
            console.log(`addIceCandidate error: ${err}`);
          }
          room.processIceCandidate(socket.id, message.candidate, (err) => {
            if (err) {
              console.log(`addIceCandidate error: ${err}`);
            }
          });
        });
        break;

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
  const room = await getRoom(message.roomName, (error) => {
    if (error) {
      return callback(error, null);
    }
  });
  /**
   * 새로운 webRtcEndpoint, hubPort를 생성한다.
   * composite -> hubPort -> webRtcEndpoint 로 연결한다.
   */
  room.join(socket.id, (error) => {
    if (error) {
      return callback(error);
    }

    const response = {
      id: "joinRoomSuccess",
      userName: message.userName,
      roomName: message.roomName,
    };

    console.log(`user: ${message.userName} joined room: ${room.name}`);
    console.log("send message to client: " + response.id);
    socket.emit("message", response);
    return callback(null);
  });

  return callback(null);
};

const getRoom = (roomName, callback) => {
  let room = rooms[roomName];

  if (room == null) {
    const newRoom = new Room(roomName, (error) => {
      if (error) {
        return callback(error);
      }
      console.log(`new room created: ${roomName}`);
    });
    rooms[roomName] = newRoom;

    return newRoom;
  } else {
    return room;
  }
};

app.get("/", (req, res) => {
  res.send("Group Call Server");
});

app.use(express.static(path.join(__dirname, "static")));
