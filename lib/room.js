const kurento = require("kurento-client");
const KURENTO_URI = "ws://172.30.1.57:8888/kurento";

class Room {
  constructor(name) {
    this.name = name;
    this.kurentoClient = null;
    this.pipeline = null;
    this.composite = null;
    this.hubPorts = new Map();
    this.webRtcEndpoints = new Map();
    this.candidatesQueues = new Map();
  }

  /**
   * create pipeline -> composite -> hubPort -> webRtcEndpoint
   */
  async join(socketId, callback) {
    try {
      if (!this.kurentoClient) {
        this.kurentoClient = await kurento(KURENTO_URI);
        console.log("new KurentoClient created");
      }

      if (!this.pipeline) {
        this.pipeline = await this.kurentoClient.create("MediaPipeline");
        console.log("new pipeline created");
      }

      if (!this.composite) {
        this.composite = await this.pipeline.create("Composite");
        console.log("new composite created");
      }

      // create webRtcEndpoint and hubPort and store them in maps
      const webRtcEndpoint = await this.pipeline.create("WebRtcEndpoint");
      console.log(`new webRtcEndpoint created`);
      this.webRtcEndpoints.set(socketId, webRtcEndpoint);

      const hubPort = await this.composite.createHubPort();
      console.log(`new hubPort created`);
      this.hubPorts.set(socketId, hubPort);

      // connect webRtcEndpoint and hubPort
      await hubPort.connect(webRtcEndpoint);
      await webRtcEndpoint.connect(hubPort);
      callback(null);
    } catch (error) {
      console.error(`join error: ${error}`);

      callback(error);
    }
  }

  async receiveSdpOffer(io, socketId, sdpOffer, callback) {
    // socketId: 수신자의 id
    const webRtcEndpoint = this.webRtcEndpoints.get(socketId);

    if (!webRtcEndpoint) {
      return callback(new Error("There is no webRtcEndpoint for socketId"));
    }

    webRtcEndpoint.on("IceCandidateFound", (event) => {
      const candidate = kurento.getComplexType("IceCandidate")(event.candidate);
      const message = {
        id: "iceCandidate",
        userId: socketId,
        candidate: candidate,
      };
      console.log(`send message to client: ${message.id}`);
      // socketId에 해당하는 socket에게 message를 전송한다.
      io.to(socketId).emit("message", message);
    });

    if (this.candidatesQueues.get(socketId)) {
      console.log(
        "process candidate queue which is arrived before sdp answer is generated"
      );
      while (this.candidatesQueues.get(socketId).length) {
        const candidate = this.candidatesQueues.get(socketId).shift();
        webRtcEndpoint.addIceCandidate(candidate);
      }
    }

    // processOffer: SDP offer를 처리하고 SDP answer를 생성한다.
    await webRtcEndpoint.processOffer(sdpOffer, (err, sdpAnswer) => {
      if (err) {
        console.error(`processOffer error: ${err}`);
        return callback(err);
      }
      console.log(
        `sdpOffer from ${socketId} is processed and sdpAnswer is created`
      );

      webRtcEndpoint.gatherCandidates((error) => {
        if (error) {
          return callback(error);
        }
        console.log(`gathering candidates from ${socketId}`);
      });

      return callback(null, sdpAnswer);
    });
  }

  async processIceCandidate(socketId, iceCandidate, callback) {
    const webRtcEndpoint = this.webRtcEndpoints.get(socketId);

    if (webRtcEndpoint) {
      webRtcEndpoint.addIceCandidate(iceCandidate, (err) => {
        if (err) {
          console.error(`addIceCandidate error: ${err}`);
          return callback(err);
        }
        console.log(`addIceCandidate from ${socketId} is processed`);
        console.log(`iceCandidate: ${iceCandidate}`);
        callback(null);
      });
    } else {
      if (!this.candidatesQueues[socketId]) {
        this.candidatesQueues.set(socketId, []);
        this.candidatesQueues.get(socketId).push(iceCandidate);
      } else {
        this.candidatesQueues.get(socketId).push(iceCandidate);
      }
      console.log(`addIceCandidate from ${socketId} is added to queue`);
    }
  }

  async leave(socketId) {
    const hubPort = this.hubPorts.get(socketId);
    const webRtcEndpoint = this.webRtcEndpoints.get(socketId);

    if (webRtcEndpoint) {
      webRtcEndpoint.release();
      this.webRtcEndpoints.delete(socketId);
    }

    if (hubPort) {
      hubPort.release();
      this.hubPorts.delete(socketId);
    }

    if (this.webRtcEndpoints.size === 0 && this.hubPorts.size === 0) {
      this.pipeline.release();
      this.pipeline = null;
      this.composite = null;
      this.kurentoClient.close();
      this.kurentoClient = null;
      return true;
    }

    return false;
  }
}

module.exports = Room;
