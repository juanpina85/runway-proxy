// ─────────────────────────────────────────────────────────────
// InstaInfluencer — Runway Proxy Server
// Node.js + Express
//
// Deploy en Railway:
//   1. Subí este archivo + package.json a GitHub
//   2. Conectá el repo en railway.app
//   3. Agregá variable: RUNWAY_API_KEY=key_xxx
//
// Endpoints:
//   GET  /health
//   POST /api/runway/generate   { prompt } → { taskId }
//   GET  /api/runway/status/:id            → { status, url? }
// ─────────────────────────────────────────────────────────────

const express = require("express");

const app  = express();
const PORT = process.env.PORT || 3001;

// CORS completamente abierto — necesario para llamadas desde Claude artifacts
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

const RUNWAY_KEY     = process.env.RUNWAY_API_KEY || "";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_BASE    = "https://api.dev.runwayml.com/v1";

if (!RUNWAY_KEY) {
  console.error("Falta RUNWAY_API_KEY.");
  process.exit(1);
}

// Health check
app.get("/health", (_, res) => {
  res.json({ ok: true, runway: !!RUNWAY_KEY });
});

// POST /api/runway/generate
app.post("/api/runway/generate", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Falta prompt" });

  try {
    const r = await fetch(`${RUNWAY_BASE}/text_to_video`, {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "Authorization":    `Bearer ${RUNWAY_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
      body: JSON.stringify({
        model:      "gen4_turbo",
        promptText: prompt,
        ratio:      "768:1344",
        duration:   10,
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || "Runway error" });
    res.json({ taskId: data.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/runway/status/:taskId
app.get("/api/runway/status/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const r = await fetch(`${RUNWAY_BASE}/tasks/${taskId}`, {
      headers: {
        "Authorization":    `Bearer ${RUNWAY_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || "Runway error" });

    res.json({
      status:  data.status,
      url:     data.output?.[0] || null,
      failure: data.failure || null,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy corriendo en puerto ${PORT}`);
});

