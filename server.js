const express = require("express");
const app = express();
const PORT = process.env.PORT || 3001;
const RUNWAY_KEY     = process.env.RUNWAY_API_KEY || "";
const CLAUDE_KEY     = process.env.CLAUDE_API_KEY || "";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_BASE    = "https://api.dev.runwayml.com/v1";
const CLAUDE_API     = "https://api.anthropic.com/v1/messages";

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true, claude: !!CLAUDE_KEY, runway: !!RUNWAY_KEY }));

app.post("/api/claude", async (req, res) => {
  if (!CLAUDE_KEY) return res.status(500).json({ error: "Falta CLAUDE_API_KEY en Railway" });
  try {
    const r = await fetch(CLAUDE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    console.error("[CLAUDE ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/runway/generate", async (req, res) => {
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY en Railway" });
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Falta prompt" });

 const body = { model: "gen4.5", promptText: prompt, ratio: "768:1344", duration: 10 };
  console.log("[RUNWAY GENERATE] Enviando:", JSON.stringify(body).slice(0, 200));

  try {
    const r = await fetch(`${RUNWAY_BASE}/text_to_video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNWAY_KEY}`,
        "X-Runway-Version": RUNWAY_VERSION,
      },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    console.log("[RUNWAY GENERATE] Status:", r.status);
    console.log("[RUNWAY GENERATE] Response:", text);

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) return res.status(r.status).json({ error: data.message || data.error || text });
    res.json({ taskId: data.id });
  } catch (err) {
    console.error("[RUNWAY GENERATE ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/runway/status/:taskId", async (req, res) => {
  if (!RUNWAY_KEY) return res.status(500).json({ error: "Falta RUNWAY_API_KEY en Railway" });
  try {
    const r = await fetch(`${RUNWAY_BASE}/tasks/${req.params.taskId}`, {
      headers: { "Authorization": `Bearer ${RUNWAY_KEY}`, "X-Runway-Version": RUNWAY_VERSION },
    });
    const text = await r.text();
    console.log("[RUNWAY STATUS]", req.params.taskId, "→", text.slice(0, 300));
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: data.message || text });
    res.json({ status: data.status, url: data.output?.[0] || null, failure: data.failure || null });
  } catch (err) {
    console.error("[RUNWAY STATUS ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
