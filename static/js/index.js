const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const enterBtn = document.getElementById("enterBtn");
const exitBtn = document.getElementById("exitBtn");
const userNameInput = document.getElementById("userName");
const roomNameInput = document.getElementById("roomName");

let webRtcPeer;

const constraints = {
  audio: true,
  video: {
    width: 640,
    framerate: 15,
  },
};

const iceServers = [
  {
    urls: "stun:stun.l.google.com:19302",
  },
];

const socket = io("https://" + location.host);

window.onbeforeunload = () => {
  const message = {
    id: "leaveRoom",
    userName: userNameInput.value,
    roomName: roomNameInput.value,
  };
  sendMessage(message);
  socket.close();
};

socket.on("connect", () => {
  console.log(`connected to socket server: ${socket.id}`);
});

socket.on("disconnect", () => {
  console.log(`disconnected from socket server: ${socket.id}`);
});

socket.on("error", (err) => {
  console.log(`socket error: ${err}`);
});

socket.on("message", (message) => {
  console.info(`received message from server: ${message.id}`);

  switch (message.id) {
    case "joinRoomSuccess":
      initPeer();
      break;

    case "sdpAnswer":
      if (webRtcPeer) {
        webRtcPeer.processAnswer(message.sdpAnswer, (err) => {
          if (err) {
            console.log(`processAnswer error: ${err}`);
          }
          console.log(
            `sdpAnswer from ${message.userId}'s webRtcEndpoint processed`
          );
        });
      }
      break;

    case "iceCandidate":
      if (webRtcPeer) {
        console.log(`addIceCandidate from ${message.userId}`);
        console.log(message.candidate);
        webRtcPeer.addIceCandidate(message.candidate);
        break;
      }
  }
});

socket.on("stop", () => {
  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;
  }

  localVideo.style.display = "none";
  remoteVideo.style.display = "none";
  userName.style.display = "block";
  roomName.style.display = "block";
  enterBtn.style.display = "block";
});

const sendMessage = (message) => {
  console.log("send message to server: " + message.id);
  socket.emit("message", message);
};

const joinRoom = () => {
  const userName = userNameInput.value;
  const roomName = roomNameInput.value;

  document.getElementById("title").innerText = "Room " + roomName;
  userNameInput.style.display = "none";
  roomNameInput.style.display = "none";
  enterBtn.style.display = "none";
  localVideo.style.display = "block";
  remoteVideo.style.display = "block";

  const message = {
    id: "joinRoom",
    userName: userName,
    roomName: roomName,
  };
  sendMessage(message);
};

const onIceCandidate = (candidate) => {
  const message = {
    id: "onIceCandidate",
    userName: userNameInput.value,
    roomName: roomNameInput.value,
    candidate: candidate,
  };
  sendMessage(message);
};

const initPeer = async () => {
  const options = {
    localVideo: localVideo,
    remoteVideo: remoteVideo,
    onicecandidate: onIceCandidate,
    constraints: constraints,
    iceServers: iceServers,
  };
  webRtcPeer = await kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(
    options,
    (error) => {
      if (error) {
        return console.error("Error creating WebRtcPeerSendonly:", error);
      }
      console.log("WebRtcPeerSendonly created, generating local sdp offer ...");
      webRtcPeer.generateOffer(onSdpOffer);
    }
  );
};

const onSdpOffer = (error, sdpOffer) => {
  if (error) {
    console.error("Error generating SDP offer for presenter:", error);
    return;
  }

  const message = {
    id: "sdpOffer",
    userName: userNameInput.value,
    roomName: roomNameInput.value,
    sdpOffer: sdpOffer,
  };
  console.log(`${message.userName} sending sdp offer to server ...`);
  sendMessage(message);
};

const handleOnKeyPress = (e) => {
  if (e.keyCode === 13) {
    joinRoom();
  }
};

enterBtn.onclick = () => {
  joinRoom();
};

exitBtn.onclick = () => {
  const message = {
    id: "leaveRoom",
    userName: userNameInput.value,
    roomName: roomNameInput.value,
  };
  sendMessage(message);

  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;
  }

  localVideo.style.display = "none";
  remoteVideo.style.display = "none";
  userName.style.display = "block";
  roomName.style.display = "block";
  enterBtn.style.display = "block";

  socket.close();
};

userNameInput.addEventListener("keypress", handleOnKeyPress);
roomNameInput.addEventListener("keypress", handleOnKeyPress);
