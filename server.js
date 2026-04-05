const express = require("express");
const app = express();
const PORT = process.env.PORT || 3001;

const RUNWAY_KEY     = process.env.RUNWAY_API_KEY || "";
const CLAUDE_KEY     = process.env.CLAUDE_API_KEY || "";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_BASE    = "https://api.dev.runwayml.com/v1";
const CLAUDE_API     = "https://api.anthropic.com/v1/messages";

// CORS abierto
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// Health
app.get("/health", (_, res) => res.json({
  ok: true,
  claude: !!CLAUDE_KEY,
  runway: !!RUNWAY_KEY
}));

// POST /api/claude — proxy a Claude API
app.post("/api/claude", async (req, res) => {
  if (!CLAUDE_KEY) return res.status(500).json({ error: "Falta CLAUDE_API_KEY en Railway" });
  try {
    const r = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runway/generate
app.post("/api/runway/generate", async (req, res) => {
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY en Railway" });
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
      body: JSON.stringify({
        model: "gen4_turbo",
        promptText: prompt,
        ratio: "768:1344",
        duration: 10,
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
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY en Railway" });
  try {
    const r = await fetch(`${RUNWAY_BASE}/tasks/${req.params.taskId}`, {
      headers: {
        "Authorization": `Bearer ${RUNWAY_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || "Runway error" });
    res.json({ status: data.status, url: data.output?.[0] || null, failure: data.failure || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
