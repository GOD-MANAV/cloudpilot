// CloudPilot media bridge — injected into the meeting tab before the site's own code runs.
//
// The meeting app receives camera/mic tracks that WE own (a canvas + a WebAudio
// destination). We never swap tracks; we only change what is drawn/mixed into them:
//   off          → black frame, silence (the bot also toggles the site's camera button off)
//   image        → a still image you uploaded (your avatar / name card)
//   live         → your phone's camera + mic, streamed in real time over WebRTC
//
// There is intentionally no "play a recorded video as my camera" mode.
(() => {
  if (window.__cp) return;
  const W = 1280;
  const H = 720;
  const FPS = 15;
  const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

  let canvas, g2d, actx, dest, image, remoteVideo, remoteAudioEl, pc, mixSrc;
  let mode = "off";

  function ensure() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    g2d = canvas.getContext("2d");
    actx = new AudioContext();
    dest = actx.createMediaStreamDestination();
    const silent = actx.createGain();
    silent.gain.value = 0;
    const osc = actx.createOscillator();
    osc.connect(silent).connect(dest);
    osc.start();
    setInterval(draw, 1000 / FPS);
  }

  function cover(src, sw, sh) {
    const s = Math.max(W / sw, H / sh);
    const w = sw * s;
    const h = sh * s;
    g2d.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  }

  function draw() {
    g2d.fillStyle = "#0b1020";
    g2d.fillRect(0, 0, W, H);
    if (mode === "live" && remoteVideo && remoteVideo.readyState >= 2) {
      cover(remoteVideo, remoteVideo.videoWidth, remoteVideo.videoHeight);
    } else if ((mode === "image" || mode === "live") && image && image.complete && image.naturalWidth) {
      cover(image, image.naturalWidth, image.naturalHeight);
    }
  }

  const md = navigator.mediaDevices;
  const origEnum = md.enumerateDevices.bind(md);
  md.getUserMedia = async (c) => {
    ensure();
    if (actx.state === "suspended") await actx.resume().catch(() => {});
    const tracks = [];
    if (c && c.video) tracks.push(canvas.captureStream(FPS).getVideoTracks()[0]);
    if (c && c.audio) tracks.push(dest.stream.getAudioTracks()[0].clone());
    return new MediaStream(tracks);
  };
  md.enumerateDevices = async () => {
    const real = await origEnum().catch(() => []);
    const outs = real.filter((d) => d.kind === "audiooutput");
    const fake = (kind, label) => ({ deviceId: "cloudpilot-" + kind, groupId: "cloudpilot", kind, label, toJSON() { return this; } });
    return [fake("videoinput", "CloudPilot Camera"), fake("audioinput", "CloudPilot Microphone"), ...outs];
  };

  function waitIce(peer) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, 4000);
      peer.addEventListener("icegatheringstatechange", () => {
        if (peer.iceGatheringState === "complete") {
          clearTimeout(t);
          res();
        }
      });
    });
  }

  function endLive() {
    if (pc) pc.close();
    pc = null;
    if (mixSrc) mixSrc.disconnect();
    mixSrc = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remoteAudioEl) remoteAudioEl.srcObject = null;
    if (mode === "live") mode = image ? "image" : "off";
  }

  window.__cp = {
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m === "live" || m === "image" ? m : "off";
      return mode;
    },
    async setImage(dataUrl) {
      ensure();
      const img = new Image();
      img.src = dataUrl;
      await img.decode().catch(() => {});
      image = img;
    },
    /** Accept a non-trickle SDP offer from the phone; returns the answer SDP. */
    async acceptOffer(offerSdp) {
      ensure();
      endLive();
      pc = new RTCPeerConnection({ iceServers: ICE });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] || new MediaStream([ev.track]);
        if (ev.track.kind === "video") {
          if (!remoteVideo) {
            remoteVideo = document.createElement("video");
            remoteVideo.muted = true;
            remoteVideo.playsInline = true;
            remoteVideo.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
            document.documentElement.appendChild(remoteVideo);
          }
          remoteVideo.srcObject = stream;
          remoteVideo.play().catch(() => {});
        } else {
          // Chrome only feeds remote WebRTC audio into WebAudio if it is also attached to a media element.
          if (!remoteAudioEl) {
            remoteAudioEl = new Audio();
            remoteAudioEl.muted = true;
          }
          remoteAudioEl.srcObject = stream;
          remoteAudioEl.play().catch(() => {});
          mixSrc = actx.createMediaStreamSource(stream);
          mixSrc.connect(dest);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) endLive();
      };
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      mode = "live";
      return pc.localDescription.sdp;
    },
    endLive,
  };
})();
