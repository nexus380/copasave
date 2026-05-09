/**
 * Copasave — Backend API
 * Node.js + Express + yt-dlp
 */
 
const express   = require('express');
const cors      = require('cors');
const { execFile, execSync } = require('child_process');
const path      = require('path');
const os        = require('os');
const fs        = require('fs');
 
const app  = express();
const PORT = process.env.PORT || 3001;
 
// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
 
// ── Find yt-dlp ───────────────────────────────────────────────────────────────
function getYtdlpCmd() {
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(__dirname, 'yt-dlp'),
    './yt-dlp',
    'yt-dlp',
    `${process.env.HOME}/.local/bin/yt-dlp`,
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/nix/var/nix/profiles/default/bin/yt-dlp',
  ].filter(Boolean);
 
  for (const cmd of candidates) {
    try { execSync(`"${cmd}" --version`, { stdio: 'ignore' }); return cmd; } catch {}
  }
 
  for (const py of ['python3', 'python']) {
    try { execSync(`${py} -m yt_dlp --version`, { stdio: 'ignore' }); return `${py} -m yt_dlp`; } catch {}
  }
 
  return 'yt-dlp';
}
 
const YTDLP_CMD = getYtdlpCmd();
console.log('✅ yt-dlp command:', YTDLP_CMD);
 
// ── Helpers ───────────────────────────────────────────────────────────────────
const FORMAT_MAP = {
  'mp4-hd': { args: ['-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best'], ext: 'mp4' },
  'mp4-sd': { args: ['-f', 'bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/best'], ext: 'mp4' },
  'mp3':    { args: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'], ext: 'mp3' },
  'no-wm':  { args: ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'], ext: 'mp4' },
};
 
function ytdlp(args) {
  return new Promise((resolve, reject) => {
    const parts   = YTDLP_CMD.split(' ');
    const cmd     = parts[0];
    const allArgs = [...parts.slice(1), ...args];
    execFile(cmd, allArgs, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}
 
function safeFilename(str) {
  return str.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').slice(0, 100);
}
 
// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'Missing or invalid url' });
 
  try {
    const raw  = await ytdlp(['--dump-json', '--no-playlist', '--no-warnings', url]);
    const info = JSON.parse(raw);
 
    const hasVideo = info.formats?.some(f => f.vcodec && f.vcodec !== 'none');
    const hasAudio = info.formats?.some(f => f.acodec && f.acodec !== 'none');
    const has1080  = info.formats?.some(f => f.height >= 1080);
    const has480   = info.formats?.some(f => f.height >= 480);
 
    const formats = [];
    if (hasVideo && has1080) formats.push({ id: 'mp4-hd', badge: 'HD',  label: 'MP4 1080p' });
    if (hasVideo && has480)  formats.push({ id: 'mp4-sd', badge: 'SD',  label: 'MP4 480p'  });
    if (hasAudio)            formats.push({ id: 'mp3',    badge: 'MP3', label: 'Audio only' });
    if (!formats.length)     formats.push({ id: 'mp4-hd', badge: 'MP4', label: 'Best available' });
 
    const secs     = info.duration || 0;
    const duration = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
 
    return res.json({
      title:     info.title    || 'Untitled video',
      duration,
      thumbnail: info.thumbnail || null,
      uploader:  info.uploader  || info.channel || null,
      platform:  info.extractor_key || 'Unknown',
      formats,
    });
  } catch (err) {
    console.error('[/api/fetch]', err.message);
    return res.status(422).json({ error: err.message || 'Could not fetch video info.' });
  }
});
 
app.get('/api/download', async (req, res) => {
  const { url, format = 'mp4-hd' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
 
  const fmt    = FORMAT_MAP[format] || FORMAT_MAP['mp4-hd'];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copasave-'));
  const outTmpl = path.join(tmpDir, '%(title)s.%(ext)s');
 
  try {
    await ytdlp([...fmt.args, '--no-playlist', '--no-warnings', '-o', outTmpl, url]);
 
    const files = fs.readdirSync(tmpDir);
    if (!files.length) throw new Error('yt-dlp produced no output file.');
 
    const filePath = path.join(tmpDir, files[0]);
    const fileName = safeFilename(files[0]);
    const stat     = fs.statSync(filePath);
 
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', fmt.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');
 
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('close', () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
  } catch (err) {
    console.error('[/api/download]', err.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) res.status(422).json({ error: err.message || 'Download failed.' });
  }
});
 
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Copasave API running at http://localhost:${PORT}`);
});