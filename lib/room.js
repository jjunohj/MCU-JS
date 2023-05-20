const kurento = require("kurento-client");

const DEFAULT_HUBPORT_WIDTH = 480;
const DEFAULT_HUBPORT_HEIGHT = 360;
const KURENTO_URI = "ws://10.168.69.118:8888/kurento";

class Room {
  constructor(name) {
    this.name = name;
    this.kurentoClient = null;
    this.pipeline = null;
    this.composite = null;
    this.hubPorts = new Map();
    this.webRtcEndpoints = new Map();
  }

  /**
   * 새로운 webRtcEndpoint, hubPort를 생성한다.
   * composite -> hubPort -> webRtcEndpoint 로 연결한다.
   */
  async join(socketId, callback) {
    if (!this.kurentoClient) {
      this.kurentoClient = await kurento(KURENTO_URI, (err) => {
        if (err) {
          console.error("Error connecting to Kurento", err);
          return callback(err);
        }
        console.log("new KurentoClient created");
      });
    }

    if (!this.pipeline) {
      this.pipeline = await this.kurentoClient.create("MediaPipeline");
      this.composite = await this.pipeline.create("Composite");
      console.log("new pipeline and composite created");
    }

    // 하나의 socket에 대해 WebRtcEndpoint와 HubPort를 생성한다.
    const webRtcEndpoint = await this.pipeline.create("WebRtcEndpoint");
    console.log(`new webRtcEndpoint created`);
    this.webRtcEndpoints.set(socketId, webRtcEndpoint);

    const hubPort = await this.composite.createHubPort();
    // composite에서 hubPort를 생성해 socketId를 키로 하여 저장한다.
    console.log(`new hubPort created`);
    this.hubPorts.set(socketId, hubPort);

    // hubPort에서 WebRtcEndpoint로 연결한다.
    await hubPort.connect(webRtcEndpoint);
    await webRtcEndpoint.connect(hubPort);

    callback(null);
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
        candidate: candidate,
      };
      console.log(`send message to client: ${message.id}`);
      // socketId에 해당하는 socket에게 message를 전송한다.
      io.to(socketId).emit("message", message);
    });

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

      return sdpAnswer;
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
