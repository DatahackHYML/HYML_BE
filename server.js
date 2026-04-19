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
  return aCount >= group.length / 2 ? 'A' : 'B';
}

function getGroup(code) {
  const dim1 = code[0]; // D or R
  const dim3 = code[2]; // P or N
  if (dim1 === 'D' && dim3 === 'P') return 'Hunters';
  if (dim1 === 'D' && dim3 === 'N') return 'Wanderers';
  if (dim1 === 'R' && dim3 === 'P') return 'Guardians';
  return 'Builders';
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/quiz/score', (req, res) => {
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
});

app.post('/api/auth/save-result', async (req, res) => {
  const { user_id, code, animal, group } = req.body;
  const { error } = await supabase
    .from('profiles')
    .update({ animal_result: animal, oceanality_code: code, group_name: group })
    .eq('id', user_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase.from('events').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data });
});

app.post('/api/events/confirm-attendance', async (req, res) => {
  const { user_id, event_id, attend_code } = req.body;

  const { data: event, error: fetchError } = await supabase
    .from('events')
    .select('attend_code')
    .eq('id', event_id)
    .single();
  if (fetchError) return res.status(500).json({ error: fetchError.message });

  if (event.attend_code !== attend_code) {
    return res.json({ success: false, message: 'Wrong code' });
  }

  const { error: upsertError } = await supabase
    .from('event_signups')
    .upsert({ user_id, event_id, confirmed: true });
  if (upsertError) return res.status(500).json({ error: upsertError.message });

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('points')
    .eq('id', user_id)
    .single();
  if (profileError) return res.status(500).json({ error: profileError.message });

  const { error: pointsError } = await supabase
    .from('profiles')
    .update({ points: (profile.points || 0) + 10 })
    .eq('id', user_id);
  if (pointsError) return res.status(500).json({ error: pointsError.message });

  res.json({ success: true, points_earned: 10 });
});

app.get('/api/leaderboard', async (req, res) => {
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
});

app.get('/argovis', async (req, res) => {
  const url = 'https://argovis-api.colorado.edu/argo?startDate=2020-01-01T00:00:00Z&endDate=2020-01-15T00:00:00Z&polygon=[[-130,20],[-110,20],[-110,40],[-130,40],[-130,20]]&data=pres,temp';
  const response = await fetch(url);
  if (!response.ok) return res.status(response.status).json({ error: `Argovis returned ${response.status}` });
  const data = await response.json();
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
