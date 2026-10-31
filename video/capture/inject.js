// Injected before the CHALK page loads. It replaces the microphone with a
// scripted "student" voice, taps the tutor's WebRTC audio, logs Realtime
// data-channel events with wall-clock times, and draws a visible cursor.
(() => {
  const state = { events: [], ctx: null, micDest: null, tutorDest: null, recorders: [] };
  window.__cap = state;

  function ensure() {
    if (!state.ctx) {
      state.ctx = new AudioContext({ sampleRate: 48000 });
      state.micDest = state.ctx.createMediaStreamDestination();
      state.tutorDest = state.ctx.createMediaStreamDestination();
      // A real microphone never sends digital zero; without a faint room-tone
      // floor WebRTC DTX stops sending frames and server VAD never sees the
      // student's turn end.
      const len = state.ctx.sampleRate * 2;
      const noise = state.ctx.createBuffer(1, len, state.ctx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * 0.0015;
      const floor = state.ctx.createBufferSource();
      floor.buffer = noise;
      floor.loop = true;
      floor.connect(state.micDest);
      floor.start();
    }
    return state.ctx;
  }

  navigator.mediaDevices.getUserMedia = async () => {
    ensure();
    await state.ctx.resume();
    return new MediaStream([state.micDest.stream.getAudioTracks()[0].clone()]);
  };

  const OrigPC = window.RTCPeerConnection;
  function PatchedPC(...args) {
    const pc = new OrigPC(...args);
    pc.addEventListener("track", (event) => {
      ensure();
      const stream = event.streams[0] || new MediaStream([event.track]);
      // Chrome only feeds WebAudio from a remote stream that is also attached
      // to a media element; the app does that, and we keep our own sink too.
      const sink = new Audio();
      sink.muted = true;
      sink.srcObject = stream;
      sink.play().catch(() => {});
      state.ctx.createMediaStreamSource(stream).connect(state.tutorDest);
      state.events.push({ t: Date.now(), type: "cap.remote_track" });
    });
    const origCreate = pc.createDataChannel.bind(pc);
    pc.createDataChannel = (...a) => {
      const dc = origCreate(...a);
      dc.addEventListener("message", (m) => {
        try {
          const e = JSON.parse(m.data);
          const keep = {
            t: Date.now(),
            type: e.type,
            response_id: e.response_id || (e.response && e.response.id),
            item_id: e.item_id,
          };
          if (typeof e.delta === "string" && e.type.includes("transcript")) keep.delta = e.delta;
          if (typeof e.transcript === "string") keep.transcript = e.transcript;
          if (e.type === "response.function_call_arguments.done") {
            keep.name = e.name;
            keep.arguments = e.arguments;
          }
          if (e.type === "error") keep.error = e.error;
          state.events.push(keep);
        } catch {
          /* non-JSON frames are ignored */
        }
      });
      return dc;
    };
    return pc;
  }
  PatchedPC.prototype = OrigPC.prototype;
  window.RTCPeerConnection = PatchedPC;

  window.__chalkSay = async (b64) => {
    ensure();
    await state.ctx.resume();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await state.ctx.decodeAudioData(bytes.buffer);
    const src = state.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(state.micDest);
    const t = Date.now();
    src.start();
    state.events.push({ t, type: "cap.student_say", duration: buf.duration });
    return buf.duration;
  };

  window.__recStart = () => {
    ensure();
    state.recT0 = Date.now();
    state.chunks = { mic: [], tutor: [] };
    for (const [name, dest] of [["mic", state.micDest], ["tutor", state.tutorDest]]) {
      const rec = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 256000 });
      rec.ondataavailable = (e) => e.data.size && state.chunks[name].push(e.data);
      rec.start(1000);
      state.recorders.push(rec);
    }
    return state.recT0;
  };

  window.__recStop = async () => {
    await Promise.all(
      state.recorders.map((r) => new Promise((res) => { r.onstop = res; r.stop(); })),
    );
    const out = {};
    for (const name of ["mic", "tutor"]) {
      const buf = await new Blob(state.chunks[name], { type: "audio/webm" }).arrayBuffer();
      let s = "";
      const u = new Uint8Array(buf);
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      out[name] = btoa(s);
    }
    return out;
  };

  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      #__cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-3px,-2px);transition:transform .08s ease-out;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      #__cursor.down{transform:translate(-3px,-2px) scale(.86)}
      #__ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
        border:2px solid rgba(214,104,40,.85);pointer-events:none;z-index:2147483646;opacity:0}
      #__ripple.go{animation:__rip .5s ease-out}
      @keyframes __rip{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.4)}}`;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const r = document.createElement("div");
    r.id = "__ripple";
    document.body.append(c, r);
    c.style.left = "-100px";
    window.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    window.addEventListener("mousedown", (e) => {
      c.classList.add("down");
      r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      r.classList.remove("go"); void r.offsetWidth; r.classList.add("go");
    }, true);
    window.addEventListener("mouseup", () => c.classList.remove("down"), true);
  });
})();
