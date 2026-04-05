const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app  = express();
const PORT = process.env.PORT || 8080;

const RUNWAY_KEY     = process.env.RUNWAY_API_KEY  || "";
const CLAUDE_KEY     = process.env.CLAUDE_API_KEY  || "";
const OPENAI_KEY     = process.env.OPENAI_API_KEY  || "";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_BASE    = "https://api.dev.runwayml.com/v1";
const CLAUDE_API     = "https://api.anthropic.com/v1/messages";
const OPENAI_TTS     = "https://api.openai.com/v1/audio/speech";

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: "10mb" }));

// ── Health ────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({
  ok: true,
  claude: !!CLAUDE_KEY,
  runway: !!RUNWAY_KEY,
  openai: !!OPENAI_KEY,
}));

// ── Claude proxy ──────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  if (!CLAUDE_KEY) return res.status(500).json({ error: "Falta CLAUDE_API_KEY" });
  try {
    const r = await fetch(CLAUDE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error("[CLAUDE]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Runway: crear tarea ───────────────────────────────────
app.post("/api/runway/generate", async (req, res) => {
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY" });
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Falta prompt" });

  try {
    const r = await fetch(`${RUNWAY_BASE}/text_to_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNWAY_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
      body: JSON.stringify({ model: "gen4.5", promptText: prompt, ratio: "720:1280", duration: 10 }),
    });
    const text = await r.text();
    console.log("[RUNWAY GENERATE] Status:", r.status, "Response:", text.slice(0, 300));
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: data.message || data.error || text });
    res.json({ taskId: data.id });
  } catch (err) {
    console.error("[RUNWAY GENERATE]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Runway: status ────────────────────────────────────────
app.get("/api/runway/status/:taskId", async (req, res) => {
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY" });
  try {
    const r = await fetch(`${RUNWAY_BASE}/tasks/${req.params.taskId}`, {
      headers: { "Authorization": `Bearer ${RUNWAY_KEY}`, "X-Runway-Version": RUNWAY_VERSION },
    });
    const data = await r.json();
    console.log("[RUNWAY STATUS]", req.params.taskId, "→", data.status);
    if (!r.ok) return res.status(r.status).json({ error: data.message || "Runway error" });
    res.json({ status: data.status, url: data.output?.[0] || null, failure: data.failure || null });
  } catch (err) {
    console.error("[RUNWAY STATUS]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── OpenAI TTS ────────────────────────────────────────────
// POST /api/tts  { text: string } → audio/mpeg
app.post("/api/tts", async (req, res) => {
  if (!OPENAI_KEY) return res.status(500).json({ error: "Falta OPENAI_API_KEY" });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Falta text" });

  try {
    const r = await fetch(OPENAI_TTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "onyx",       // voz masculina, profunda, dinámica
        speed: 1.15,         // ritmo rápido pero claro
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      console.error("[TTS]", r.status, JSON.stringify(e));
      return res.status(r.status).json({ error: e.error?.message || "TTS error" });
    }
    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error("[TTS]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Merge video + audio con ffmpeg ────────────────────────
// POST /api/merge  { videoUrl, audioUrl } → video/mp4
app.post("/api/merge", async (req, res) => {
  const { videoUrl, audioBase64 } = req.body;
  if (!videoUrl || !audioBase64) return res.status(400).json({ error: "Faltan videoUrl o audioBase64" });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  const videoPath = path.join(tmp, "video.mp4");
  const audioPath = path.join(tmp, "audio.mp3");
  const outPath   = path.join(tmp, "reel.mp4");

  try {
    // Descargar video desde Runway
    console.log("[MERGE] Descargando video:", videoUrl);
    const vRes = await fetch(videoUrl);
    if (!vRes.ok) throw new Error(`No se pudo descargar el video: ${vRes.status}`);
    const vBuf = Buffer.from(await vRes.arrayBuffer());
    fs.writeFileSync(videoPath, vBuf);

    // Guardar audio base64
    const audioBuf = Buffer.from(audioBase64, "base64");
    fs.writeFileSync(audioPath, audioBuf);

    // ffmpeg: combinar — audio dura lo que dure, video se loopea si es más corto
    console.log("[MERGE] Combinando con ffmpeg...");
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest "${outPath}"`,
      { timeout: 120000 }
    );

    const result = fs.readFileSync(outPath);
    console.log("[MERGE] Listo, tamaño:", result.length, "bytes");

    res.set("Content-Type", "video/mp4");
    res.set("Content-Disposition", 'attachment; filename="reel.mp4"');
    res.send(result);
  } catch (err) {
    console.error("[MERGE]", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.rmSync(tmp, { recursive: true }); } catch {}
  }
});

app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
