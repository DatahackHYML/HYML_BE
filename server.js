require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./supabase");

const app = express();
app.use(cors());
app.use(express.json());

const ARGOVIS_BASE_URL =
  process.env.ARGOVIS_BASE_URL ?? "https://argovis-api.colorado.edu";
const ARGOVIS_DEFAULT_PARAMS = {
  startDate: "2020-01-01T00:00:00Z",
  endDate: "2020-01-15T23:59:59Z",
  polygon: "[[-130,20],[-110,20],[-110,40],[-130,40],[-130,20]]",
  data: "pres,temp",
};

const ANIMALS = {
  DCPS: "Great White Shark",
  DCPF: "Barracuda",
  DCNS: "Moray Eel",
  DCNF: "Mantis Shrimp",
  DRPS: "Sea Turtle",
  DRPF: "Manta Ray",
  DRNS: "Flying Fish",
  DRNF: "Jellyfish",
  RCPS: "Humpback Whale",
  RCPF: "Dolphin",
  RCNS: "Octopus",
  RCNF: "Seahorse",
  RRPS: "Clownfish",
  RRPF: "Sea Otter",
  RRNS: "Hermit Crab",
  RRNF: "Coral Polyp",
};

function closestAnimal(code) {
  let best = null;
  let bestScore = -1;
  for (const key of Object.keys(ANIMALS)) {
    let matches = 0;
    for (let i = 0; i < 4; i++) if (key[i] === code[i]) matches++;
    if (matches > bestScore) {
      bestScore = matches;
      best = key;
    }
  }
  return { code: best, animal: ANIMALS[best] };
}

function majority(group) {
  const aCount = group.filter((a) => a === "A").length;

  // If it's a 2-2 tie, use the first answer of the group as the tie-breaker
  if (aCount === 2) {
    return group[0];
  }

  // Otherwise, strict majority wins
  return aCount > 2 ? "A" : "B";
}

function getGroup(code) {
  const dim1 = code[0]; // D or R
  const dim2 = code[1]; // C or R (since it's normalized)

  if (dim1 === "D" && dim2 === "C") return "Hunters";
  if (dim1 === "D" && dim2 === "R") return "Wanderers";
  if (dim1 === "R" && dim2 === "C") return "Guardians";
  return "Builders";
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function buildArgovisProfilesUrl(query) {
  const params = new URLSearchParams();

  for (const [key, defaultValue] of Object.entries(ARGOVIS_DEFAULT_PARAMS)) {
    const value = query[key] ?? defaultValue;
    if (value != null && value !== "") {
      params.set(key, String(value));
    }
  }

  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "" && !params.has(key)) {
      params.set(key, String(value));
    }
  }

  return `${ARGOVIS_BASE_URL}/profiles?${params.toString()}`;
}

function scoreQuizHandler(req, res) {
  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length !== 16) {
    return res
      .status(400)
      .json({ error: "answers must be an array of 16 items" });
  }

  const dims = [
    { A: "D", B: "R" },
    { A: "C", B: "T" },
    { A: "P", B: "N" },
    { A: "S", B: "F" },
  ];

  const code = dims
    .map((dim, i) => {
      const group = answers.slice(i * 4, i * 4 + 4);
      return dim[majority(group)];
    })
    .join("");

  const normalizedCode =
    code[0] + (code[1] === "T" ? "R" : code[1]) + code[2] + code[3];
  const animal =
    ANIMALS[normalizedCode] ?? closestAnimal(normalizedCode).animal;
  const group = getGroup(normalizedCode);

  res.json({ code, animal, group });
}

async function saveResultHandler(req, res) {
  const userName = req.body.trimmedName;
  const userId = req.body.user_id ?? req.body.userId;
  const { code, animal, group } = req.body;

  if (!userId || !code || !animal || !group) {
    return res
      .status(400)
      .json({ error: "user_id, code, animal, and group are required" });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username: userName,
      animal_result: animal,
      oceanality_code: code,
      group_name: group,
    })
    .eq("id", userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}

async function getEventsHandler(req, res) {
  const { data, error } = await supabase.from("events").select("*");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data });
}

async function attendEventHandler(req, res) {
  const userId = req.body.user_id ?? req.body.userId;
  const attendCode = req.body.attend_code ?? req.body.code;

  if (!userId || !attendCode) {
    return res.status(400).json({
      error: "user_id and attend_code are required",
    });
  }

  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("id, points")
    .eq("attend_code", attendCode)
    .single();
  if (fetchError) {
    if (fetchError.code === "PGRST116") {
      return res.json({ success: false, message: "Wrong code" });
    }
    return res.status(500).json({ error: fetchError.message });
  }

  const eventId = event.id;
  const earnedPoints = event.points ?? 10;

  const { data: existingSignup, error: signupFetchError } = await supabase
    .from("event_signups")
    .select("confirmed")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (signupFetchError)
    return res.status(500).json({ error: signupFetchError.message });

  const { error: upsertError } = await supabase
    .from("event_signups")
    .upsert({ user_id: userId, event_id: eventId, confirmed: true });
  if (upsertError) return res.status(500).json({ error: upsertError.message });

  if (existingSignup?.confirmed) {
    return res.json({
      success: true,
      points_earned: 0,
      message: "Attendance already confirmed",
    });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .single();
  if (profileError)
    return res.status(500).json({ error: profileError.message });

  const { error: pointsError } = await supabase
    .from("profiles")
    .update({ points: (profile.points || 0) + earnedPoints })
    .eq("id", userId);
  if (pointsError) return res.status(500).json({ error: pointsError.message });

  res.json({ success: true, points_earned: earnedPoints });
}

async function getLeaderboardHandler(req, res) {
  const { data, error } = await supabase
    .from("profiles")
    .select("group_name, points");
  if (error) return res.status(500).json({ error: error.message });

  const totals = {};
  for (const row of data) {
    if (!row.group_name) continue;
    totals[row.group_name] = (totals[row.group_name] || 0) + (row.points || 0);
  }

  const leaderboard = Object.entries(totals)
    .map(([group, total_points]) => ({ group, total_points }))
    .sort((a, b) => b.total_points - a.total_points);

  res.json({ leaderboard });
}

async function getUserMissionsHandler(req, res) {
  const userId = req.query.user_id ?? req.query.userId;

  if (!userId) {
    return res.status(400).json({ error: "user_id is required" });
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("*");
  if (eventsError) return res.status(500).json({ error: eventsError.message });

  const { data: signups, error: signupsError } = await supabase
    .from("event_signups")
    .select("event_id, confirmed")
    .eq("user_id", userId);
  if (signupsError)
    return res.status(500).json({ error: signupsError.message });

  const confirmedEvents = new Set(
    (signups || [])
      .filter((signup) => signup.confirmed)
      .map((signup) => signup.event_id),
  );

  const missions = (events || []).map((event) => ({
    id: event.id,
    title: event.title ?? event.name ?? `Event ${event.id}`,
    description: event.description ?? null,
    attended: confirmedEvents.has(event.id),
    points: event.points ?? 10,
  }));

  res.json({ missions });
}

async function getArgovisProfilesHandler(req, res) {
  const apiKey = process.env.ARGOVIS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "ARGOVIS_API_KEY is not configured on the server",
    });
  }

  const url = buildArgovisProfilesUrl(req.query);

  try {
    const response = await fetch(url, {
      headers: {
        "x-argokey": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Argovis request failed",
        details: body,
      });
    }

    res.json(body);
  } catch (error) {
    const isTimeout = error?.name === "TimeoutError";
    res.status(isTimeout ? 504 : 502).json({
      error: isTimeout
        ? "Argovis request timed out"
        : "Failed to reach Argovis",
      details: error.message,
    });
  }
}

app.post("/api/quiz/score", scoreQuizHandler);
app.post("/quiz/score", scoreQuizHandler);

app.post("/api/auth/save-result", saveResultHandler);
app.post("/profiles", saveResultHandler);

app.get("/api/events", getEventsHandler);
app.get("/events", getEventsHandler);

app.post("/api/events/confirm-attendance", attendEventHandler);
app.post("/events/attend", attendEventHandler);

app.get("/api/leaderboard", getLeaderboardHandler);
app.get("/leaderboard", getLeaderboardHandler);

app.get("/api/user/missions", getUserMissionsHandler);
app.get("/user/missions", getUserMissionsHandler);

app.get("/api/argovis/profiles", getArgovisProfilesHandler);
app.get("/argovis/profiles", getArgovisProfilesHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
