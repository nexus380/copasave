# Copasave — Backend Setup

A Node.js + Express backend that powers the Copasave video downloader UI using **yt-dlp**.

## File Structure

```
copasave-backend/
├── server.js          ← Express API server
├── package.json
├── README.md
└── public/
    └── index.html     ← Updated frontend (served by Express)
```

---

## 1. Install yt-dlp

yt-dlp must be available on your system PATH.

**macOS (Homebrew)**
```bash
brew install yt-dlp
```

**Linux**
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

**Windows**
Download `yt-dlp.exe` from https://github.com/yt-dlp/yt-dlp/releases and add it to your PATH.

Verify it works:
```bash
yt-dlp --version
```

yt-dlp also requires **ffmpeg** for merging video+audio streams:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

---

## 2. Install Node dependencies

```bash
npm install
```

---

## 3. Run the server

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server starts at **http://localhost:3001** and serves both the API and the frontend.

Open your browser at: **http://localhost:3001**

---

## API Reference

### `POST /api/fetch`
Fetch video metadata without downloading.

**Request body:**
```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

**Response:**
```json
{
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": "3:33",
  "thumbnail": "https://...",
  "uploader": "Rick Astley",
  "platform": "Youtube",
  "formats": [
    { "id": "mp4-hd", "badge": "HD",  "label": "MP4 1080p" },
    { "id": "mp4-sd", "badge": "SD",  "label": "MP4 480p"  },
    { "id": "mp3",    "badge": "MP3", "label": "Audio only" }
  ]
}
```

---

### `GET /api/download?url=...&format=mp4-hd`
Downloads the video and streams it to the browser.

| Param    | Values                              |
|----------|-------------------------------------|
| `url`    | The video URL                       |
| `format` | `mp4-hd` · `mp4-sd` · `mp3` · `no-wm` |

The browser receives the file with `Content-Disposition: attachment`.

---

## Supported Platforms

yt-dlp supports 1000+ sites including:
- YouTube, TikTok, Instagram, Facebook, X / Twitter, Pinterest, Vimeo, Dailymotion, Reddit, Twitch, and many more.

---

## Deployment Notes

- **Keep yt-dlp updated** — platforms change their APIs frequently:
  ```bash
  yt-dlp -U
  ```
- Set `CORS` origins appropriately in `server.js` before deploying publicly.
- For high traffic, consider a **job queue** (e.g. Bull/BullMQ) instead of streaming downloads inline.
- On shared hosting, ensure your host allows running child processes (`execFile`).
- Consider adding **rate limiting** (`express-rate-limit`) to prevent abuse.
