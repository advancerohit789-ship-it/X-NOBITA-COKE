const fs = require("fs");
const path = require("path");
const yts = require("yt-search");
const ytDlp = require("yt-dlp-exec");

const ROOT = path.resolve(__dirname, "..");
const COOKIE_FILE = path.join(ROOT, "cookies.txt");
const TEMP_DIR = path.join(ROOT, "temp");

function ensureDirs() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function extractVideoId(input) {
  const value = String(input || "").trim();
  const patterns = [
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
    /^([A-Za-z0-9_-]{11})$/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isYouTubeUrl(input) {
  return !!extractVideoId(input);
}

function toYouTubeUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

async function searchYouTube(query) {
  const result = await yts(query);
  if (!result?.videos?.length) throw new Error("No songs found.");
  return result.videos[0];
}

function safeFileName(title) {
  return String(title || "song")
    .replace(/[\\/:*?"<>|\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "song";
}

function hasCookies() {
  try {
    return fs.existsSync(COOKIE_FILE) && fs.statSync(COOKIE_FILE).size > 20;
  } catch {
    return false;
  }
}

async function runYtDlp(videoUrl, outputTemplate) {
  return ytDlp(videoUrl, {
    noPlaylist: true,
    noWarnings: true,
    newline: true,
    cookies: COOKIE_FILE,
    extractorArgs: "youtube:player_client=web,android",
    format: "bestaudio[ext=m4a]/bestaudio",
    output: outputTemplate,
    noPart: true,
    noMtime: true
  }, { timeout: 180000 });
}

async function downloadWithCookies(videoUrl, titleHint) {
  ensureDirs();

  if (!hasCookies()) {
    throw new Error("cookies.txt is missing or empty. Paste your exported YouTube cookies into cookies.txt.");
  }

  const base = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const outputTemplate = path.join(TEMP_DIR, `${base}.%(ext)s`);

  // Use the locally installed yt-dlp command. Cookies are read only from the
  // local cookies.txt file and are never sent to any third-party downloader API.
  try {
    await runYtDlp(videoUrl, outputTemplate);

    const files = fs.readdirSync(TEMP_DIR)
      .filter(name => name.startsWith(base + "."))
      .map(name => path.join(TEMP_DIR, name));

    const audio = files.find(file => /\.(mp3|m4a|webm|opus|mp4)$/i.test(file));
    if (!audio || !fs.existsSync(audio)) {
      throw new Error("yt-dlp completed but no audio file was created.");
    }

    const buffer = fs.readFileSync(audio);
    if (!buffer.length) throw new Error("Downloaded audio is empty.");

    const ext = path.extname(audio).toLowerCase();
    const finalName = `${safeFileName(titleHint)}${ext === ".m4a" ? ".m4a" : ext || ".m4a"}`;
    const mimetype = ext === ".m4a" ? "audio/mp4" : "audio/mpeg";
    return {
      buffer,
      fileName: finalName,
      mimetype,
      cleanup: () => {
        for (const file of files) {
          try { fs.unlinkSync(file); } catch {}
        }
      }
    };
  } catch (error) {
    // Remove any partial files after a failed attempt.
    try {
      for (const name of fs.readdirSync(TEMP_DIR)) {
        if (name.startsWith(base + ".")) fs.unlinkSync(path.join(TEMP_DIR, name));
      }
    } catch {}
    throw error;
  }
}

async function handlePlaySong(sock, msg, args, quotedContact) {
  const jid = msg.key.remoteJid;
  const input = args.join(" ").trim();

  if (!input) {
    await sock.sendMessage(jid, {
      text: `🥺💗 ᴜsᴀɢᴇ: .play <song name or YouTube URL>\n🌸 ᴇxᴀᴍᴘʟᴇ: .play Shape of You |`
    }, { quoted: quotedContact });
    return true;
  }

  let video;
  let download;

  try {
    if (isYouTubeUrl(input)) {
      const id = extractVideoId(input);
      video = {
        url: toYouTubeUrl(id),
        title: "YouTube Song"
      };
    } else {
      video = await searchYouTube(input);
    }

    await sock.sendMessage(jid, {
      text: `🔎💗 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ: ${video.title || input}\n🍪 ᴄᴏᴏᴋɪᴇs: ʀᴇᴀᴅʏ\n⏳ ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ... 🌸 |`
    }, { quoted: quotedContact });

    download = await downloadWithCookies(video.url, video.title || input);

    await sock.sendMessage(jid, {
      audio: download.buffer,
      mimetype: download.mimetype,
      fileName: download.fileName,
      ptt: false
    }, { quoted: quotedContact });

    return true;
  } catch (error) {
    console.error(`[PLAY/COOKIES/YTDLP] ${error?.message || error}`);
    await sock.sendMessage(jid, {
      text: `🥺💔 ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ\n🍪 ᴄʜᴇᴄᴋ ᴄᴏᴏᴋɪᴇs.ᴛxᴛ ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ 🌸 |`
    }, { quoted: quotedContact });
    return true;
  } finally {
    try { if (download?.cleanup) download.cleanup(); } catch {}
  }
}

module.exports = { handlePlaySong };
