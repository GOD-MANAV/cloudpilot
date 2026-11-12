/**
 * Send this device's camera + mic into the meeting the bot is in.
 * Non-trickle WebRTC: gather ICE fully, send the offer over the agent's /live socket, apply the answer.
 */
export interface LiveSession {
  stop(): void;
  stream: MediaStream;
}

export async function startLive(wsUrl: string, onState?: (s: unknown) => void): Promise<LiveSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  for (const t of stream.getTracks()) pc.addTrack(t, stream);
  await pc.setLocalDescription(await pc.createOffer());
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
      ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "end" }));
    } catch {
      /* ignore */
    }
    ws.close();
    pc.close();
    stream.getTracks().forEach((t) => t.stop());
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription!.sdp }));
    ws.onerror = () => reject(new Error("Couldn't reach the machine"));
    ws.onclose = (e) => e.code === 4401 && reject(new Error("Not authorised"));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data)) as { type: string; sdp?: string; error?: string; state?: unknown };
      if (m.type === "answer" && m.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
        resolve();
      } else if (m.type === "error") {
        stop();
        reject(new Error(m.error));
      } else if (m.type === "state") onState?.(m.state);
    };
  });
  return { stop, stream };
}
