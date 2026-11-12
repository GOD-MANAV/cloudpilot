import { mediaDevices, MediaStream, RTCPeerConnection } from "react-native-webrtc";

/**
 * Phone → meeting live takeover (non-trickle WebRTC over the agent's /live socket).
 * Your front camera and mic go into the meeting; the mic stays muted in the
 * meeting until you unmute from the app.
 */
export interface LiveSession {
  stream: MediaStream;
  stop(): void;
  switchCamera(): void;
}

export async function startLive(wsUrl: string): Promise<LiveSession> {
  const stream = (await mediaDevices.getUserMedia({
    audio: true,
    video: { facingMode: "user", width: 1280, height: 720, frameRate: 24 },
  })) as MediaStream;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);
  await new Promise<void>((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const t = setTimeout(res, 4000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        res();
      }
    });
  });
  const ws = new WebSocket(wsUrl);
  const stop = () => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end" }));
    } catch {
      /* ignore */
    }
    ws.close();
    pc.close();
    stream.getTracks().forEach((t) => t.stop());
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp }));
    ws.onerror = () => reject(new Error("Couldn't reach the machine"));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; sdp?: string; error?: string };
      if (m.type === "answer" && m.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
        resolve();
      } else if (m.type === "error") {
        stop();
        reject(new Error(m.error));
      }
    };
  });
  return {
    stream,
    stop,
    switchCamera: () => {
      const v = stream.getVideoTracks()[0] as unknown as { _switchCamera?: () => void };
      v?._switchCamera?.();
    },
  };
}
