require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./supabase');

const app = express();
app.use(cors());
app.use(express.json());

const ANIMALS = {
  DCPS: 'Great White Shark', DCPF: 'Barracuda',
  DCNS: 'Moray Eel',         DCNF: 'Mantis Shrimp',
  DRPS: 'Sea Turtle',        DRPF: 'Manta Ray',
  DRNS: 'Flying Fish',       DRNF: 'Jellyfish',
  RCPS: 'Humpback Whale',    RCPF: 'Dolphin',
  RCNS: 'Octopus',           RCNF: 'Seahorse',
  RRPS: 'Clownfish',         RRPF: 'Sea Otter',
  RRNS: 'Hermit Crab',       RRNF: 'Coral Polyp',
};

function closestAnimal(code) {
  let best = null;
  let bestScore = -1;
  for (const key of Object.keys(ANIMALS)) {
    let matches = 0;
    for (let i = 0; i < 4; i++) if (key[i] === code[i]) matches++;
    if (matches > bestScore) { bestScore = matches; best = key; }
  }
  return { code: best, animal: ANIMALS[best] };
}

function majority(group) {
  const aCount = group.filter(a => a === 'A').length;
  
  // If it's a 2-2 tie, use the first answer of the group as the tie-breaker
  if (aCount === 2) {
    return group[0];
  }
  
  // Otherwise, strict majority wins
  return aCount > 2 ? 'A' : 'B';
}

function getGroup(code) {
  const dim1 = code[0]; // D or R
  const dim2 = code[1]; // C or R (since it's normalized)
  
  if (dim1 === 'D' && dim2 === 'C') return 'Hunters';
  if (dim1 === 'D' && dim2 === 'R') return 'Wanderers';
  if (dim1 === 'R' && dim2 === 'C') return 'Guardians';
  return 'Builders';
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function scoreQuizHandler(req, res) {
  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length !== 16) {
    return res.status(400).json({ error: 'answers must be an array of 16 items' });
  }

  const dims = [
    { A: 'D', B: 'R' },
    { A: 'C', B: 'T' },
    { A: 'P', B: 'N' },
    { A: 'S', B: 'F' },
  ];

  const code = dims.map((dim, i) => {
    const group = answers.slice(i * 4, i * 4 + 4);
    return dim[majority(group)];
  }).join('');

  const normalizedCode = code[0] + (code[1] === 'T' ? 'R' : code[1]) + code[2] + code[3];
  const animal = ANIMALS[normalizedCode] ?? closestAnimal(normalizedCode).animal;
  const group = getGroup(normalizedCode);

  res.json({ code, animal, group });
}

async function saveResultHandler(req, res) {
  const userId = req.body.user_id ?? req.body.userId;
  const { code, animal, group } = req.body;

  if (!userId || !code || !animal || !group) {
    return res.status(400).json({ error: 'user_id, code, animal, and group are required' });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ animal_result: animal, oceanality_code: code, group_name: group })
    .eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}

async function getEventsHandler(req, res) {
  const { data, error } = await supabase.from('events').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data });
}

async function attendEventHandler(req, res) {
  const userId = req.body.user_id ?? req.body.userId;
  const eventId = req.body.event_id ?? req.body.eventId;
  const attendCode = req.body.attend_code ?? req.body.code;

  if (!userId || !eventId || !attendCode) {
    return res.status(400).json({
      error: 'user_id, event_id, and attend_code are required',
    });
  }

  const { data: event, error: fetchError } = await supabase
    .from('events')
    .select('attend_code')
    .eq('id', eventId)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });

  if (event.attend_code !== attendCode) {
    return res.json({ success: false, message: 'Wrong code' });
  }

  const { error: upsertError } = await supabase
    .from('event_signups')
    .upsert({ user_id: userId, event_id: eventId, confirmed: true });
  if (upsertError) return res.status(500).json({ error: upsertError.message });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('points')
    .eq('id', userId)
    .single();
  if (profileError) return res.status(500).json({ error: profileError.message });

  const { error: pointsError } = await supabase
    .from('profiles')
    .update({ points: (profile.points || 0) + 10 })
    .eq('id', userId);
  if (pointsError) return res.status(500).json({ error: pointsError.message });

  res.json({ success: true, points_earned: 10 });
}

async function getLeaderboardHandler(req, res) {
  const { data, error } = await supabase
    .from('profiles')
    .select('group_name, points');
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
    return res.status(400).json({ error: 'user_id is required' });
  }

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*');
  if (eventsError) return res.status(500).json({ error: eventsError.message });

  const { data: signups, error: signupsError } = await supabase
    .from('event_signups')
    .select('event_id, confirmed')
    .eq('user_id', userId);
  if (signupsError) return res.status(500).json({ error: signupsError.message });

  const confirmedEvents = new Set(
    (signups || []).filter(signup => signup.confirmed).map(signup => signup.event_id)
  );

  const missions = (events || []).map(event => ({
    id: event.id,
    title: event.title ?? event.name ?? `Event ${event.id}`,
    description: event.description ?? null,
    attended: confirmedEvents.has(event.id),
    points: event.points ?? 10,
  }));

  res.json({ missions });
}

app.post('/api/quiz/score', scoreQuizHandler);
app.post('/quiz/score', scoreQuizHandler);

app.post('/api/auth/save-result', saveResultHandler);
app.post('/profiles', saveResultHandler);

app.get('/api/events', getEventsHandler);
app.get('/events', getEventsHandler);

app.post('/api/events/confirm-attendance', attendEventHandler);
app.post('/events/attend', attendEventHandler);

app.get('/api/leaderboard', getLeaderboardHandler);
app.get('/leaderboard', getLeaderboardHandler);

app.get('/api/user/missions', getUserMissionsHandler);
app.get('/user/missions', getUserMissionsHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
