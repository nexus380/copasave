/**
 * Copasave — Backend API
 * Node.js + Express + yt-dlp
 *
 * Routes:
 *   POST /api/fetch    — fetch video metadata
 *   GET  /api/download — stream/redirect to video file
 */

const express = require('express');
const cors    = require('cors');
const { execFile } = require('child_process');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));          // tighten in production
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve the frontend

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map our format slug → yt-dlp format selector */
const FORMAT_MAP = {
  'mp4-hd': { args: ['-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best'], ext: 'mp4' },
  'mp4-sd': { args: ['-f', 'bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/best'], ext: 'mp4' },
  'mp3':    { args: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'], ext: 'mp3' },
  'no-wm':  { args: ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'], ext: 'mp4' },
};

/** Run yt-dlp and return a Promise */
function ytdlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

/** Sanitise a filename */
function safeFilename(str) {
  return str.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').slice(0, 100);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/fetch
 * Body: { url: string }
 * Returns: { title, duration, thumbnail, platform, formats[] }
 */
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url' });
  }

  try {
    // Fetch JSON metadata — no download
    const raw = await ytdlp([
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url
    ]);

    const info = JSON.parse(raw);

    // Build available format list from actual formats
    const hasVideo = info.formats?.some(f => f.vcodec && f.vcodec !== 'none');
    const hasAudio = info.formats?.some(f => f.acodec && f.acodec !== 'none');
    const has1080  = info.formats?.some(f => f.height >= 1080);
    const has480   = info.formats?.some(f => f.height >= 480);

    const formats = [];
    if (hasVideo && has1080) formats.push({ id: 'mp4-hd', badge: 'HD',  label: 'MP4 1080p' });
    if (hasVideo && has480)  formats.push({ id: 'mp4-sd', badge: 'SD',  label: 'MP4 480p' });
    if (hasAudio)            formats.push({ id: 'mp3',    badge: 'MP3', label: 'Audio only' });
    // Fallback: at least one option
    if (formats.length === 0) formats.push({ id: 'mp4-hd', badge: 'MP4', label: 'Best available' });

    // Format duration as m:ss
    const secs = info.duration || 0;
    const duration = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

    return res.json({
      title:     info.title     || 'Untitled video',
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

/**
 * GET /api/download?url=...&format=mp4-hd
 * Streams the downloaded file directly to the browser.
 */
app.get('/api/download', async (req, res) => {
  const { url, format = 'mp4-hd' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const fmt = FORMAT_MAP[format] || FORMAT_MAP['mp4-hd'];
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'copasave-'));
  const outTmpl = path.join(tmpDir, '%(title)s.%(ext)s');

  try {
    // Download to a temp folder
    await ytdlp([
      ...fmt.args,
      '--no-playlist',
      '--no-warnings',
      '-o', outTmpl,
      url,
    ]);

    // Find the output file (yt-dlp picks the final name)
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
      // Cleanup temp files after streaming
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
  } catch (err) {
    console.error('[/api/download]', err.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (!res.headersSent) {
      res.status(422).json({ error: err.message || 'Download failed.' });
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Copasave API running at http://localhost:${PORT}`);
  console.log(`   POST http://localhost:${PORT}/api/fetch`);
  console.log(`   GET  http://localhost:${PORT}/api/download?url=...&format=mp4-hd`);
});
