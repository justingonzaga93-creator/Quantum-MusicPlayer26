
const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");

const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const favoriteBtn = document.getElementById("favoriteBtn");

const seekBar = document.getElementById("seekBar");
const volumeBar = document.getElementById("volumeBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");

const songTitle = document.getElementById("songTitle");
const songArtist = document.getElementById("songArtist");
const songCount = document.getElementById("songCount");
const songList = document.getElementById("songList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const statusEl = document.getElementById("status");

let songs = [];
let currentIndex = -1;
let favorites = new Set();
let shuffle = false;
let repeatMode = "off";
let isSeeking = false;
let playRequest = 0;
let db;
let sleepDeadline = 0;
let sleepInterval = null;

const DB_NAME = "nova-music-library";
const DB_VERSION = 1;
const STORE_NAME = "songs";

function openLibraryDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveSongRecord(song) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      id: song.id, title: song.title, artist: song.artist,
      duration: song.duration || 0, blob: song.file,
      favorite: favorites.has(song.id)
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function deleteSongRecord(id) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function persistLibrary() {
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    songs.forEach(song => store.put({
      id: song.id, title: song.title, artist: song.artist,
      duration: song.duration || 0, blob: song.file,
      favorite: favorites.has(song.id)
    }));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    setStatus("Could not save library. Check device storage.");
  }
}

async function restoreLibrary() {
  try {
    db = await openLibraryDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    records.forEach(record => {
      if (!record.blob) return;
      songs.push({
        id: record.id, file: record.blob,
        url: URL.createObjectURL(record.blob),
        title: record.title, artist: record.artist || "Local audio",
        duration: record.duration || 0
      });
      if (record.favorite) favorites.add(record.id);
    });
    renderPlaylist();
    if (songs.length) {
      setStatus("Library restored • " + songs.length + " saved song(s)");
    } else {
      setStatus("Add music to build your saved library");
    }
  } catch (error) {
    setStatus("Saved library is unavailable in this browser.");
  }
}

function startSleepTimer(minutes) {
  clearInterval(sleepInterval);
  sleepInterval = null;
  sleepDeadline = 0;
  const countdown = document.getElementById("sleepCountdown");
  if (!minutes) {
    countdown.textContent = "Timer off";
    setStatus("Sleep timer turned off");
    return;
  }
  sleepDeadline = Date.now() + minutes * 60 * 1000;
  const tick = () => {
    const remaining = Math.max(0, sleepDeadline - Date.now());
    if (!remaining) {
      audio.pause();
      clearInterval(sleepInterval);
      sleepInterval = null;
      sleepDeadline = 0;
      document.getElementById("sleepSelect").value = "0";
      countdown.textContent = "Timer finished";
      setStatus("Sleep timer finished • playback paused");
      updatePlayButton();
      return;
    }
    const totalSeconds = Math.ceil(remaining / 1000);
    countdown.textContent = "Stops in " + Math.floor(totalSeconds / 60) +
      ":" + String(totalSeconds % 60).padStart(2, "0");
  };
  tick();
  sleepInterval = setInterval(tick, 1000);
  setStatus("Sleep timer set for " + minutes + " minutes");
}

document.getElementById("sleepSelect").addEventListener("change", event => {
  startSleepTimer(Number(event.target.value));
});


// Format seconds as minutes:seconds.
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

// Add music files selected from the phone.
function openFilePicker() {
  fileInput.click();
}

document.getElementById("addBtn").addEventListener(
  "click", openFilePicker
);

document.getElementById("addTop").addEventListener(
  "click", openFilePicker
);

document.getElementById("emptyAddBtn").addEventListener(
  "click", openFilePicker
);

fileInput.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);

  const audioFiles = files.filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|m4a|aac|wav|ogg|flac|opus|weba|aiff?)$/i.test(file.name)
  );

  if (!audioFiles.length) {
    if (files.length) {
      setStatus("No supported audio files found.");
    }

    fileInput.value = "";
    return;
  }

  const newSongs = audioFiles.map(file => ({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    file,
    url: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, ""),
    artist: "Local audio",
    duration: 0
  }));

  songs.push(...newSongs);

  renderPlaylist();
  persistLibrary();
  setStatus(`${newSongs.length} song(s) added and saved`);

  // Automatically start playing if this is the first selection.
  if (currentIndex === -1 && songs.length > 0) {
    loadSong(0, true);
  }

  // Let the user select the same file again later.
  fileInput.value = "";
});

// Load and play a song by its playlist index.
async function loadSong(index, autoplay = false) {
  if (!songs.length) return;

  index = (index + songs.length) % songs.length;
  currentIndex = index;

  const song = songs[currentIndex];
  const request = ++playRequest;

  audio.pause();
  audio.src = song.url;
  audio.load();

  songTitle.textContent = song.title;
  songArtist.textContent = song.artist;
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
  seekBar.value = 0;

  updateFavoriteButton();
  renderPlaylist();

  setStatus("Song selected");

  if (autoplay) {
    try {
      await audio.play();

      if (request === playRequest) {
        setStatus("Now playing");
      }
    } catch (error) {
      if (request === playRequest) {
        setStatus("Tap play to start this song");
      }
    }
  }
}

function updatePlayButton() {
  const playing = !audio.paused && !audio.ended;

  playBtn.textContent = playing ? "Ⅱ" : "▶";
  playBtn.setAttribute(
    "aria-label", playing ? "Pause" : "Play"
  );
}

playBtn.addEventListener("click", async () => {
  if (currentIndex === -1) {
    if (songs.length) {
      await loadSong(0, true);
    } else {
      openFilePicker();
    }

    return;
  }

  if (audio.paused) {
    try {
      await audio.play();
      setStatus("Now playing");
    } catch (error) {
      setStatus("Unable to play this file. Try another format.");
    }
  } else {
    audio.pause();
    setStatus("Playback paused");
  }

  updatePlayButton();
});

prevBtn.addEventListener("click", () => {
  if (!songs.length) {
    openFilePicker();
    return;
  }

  // Restart the current song if it has played for over 3 seconds.
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  playPrevious();
});

function playPrevious() {
  if (!songs.length) return;

  const wasPlaying = !audio.paused;

  let index = currentIndex - 1;

  if (shuffle && songs.length > 1) {
    index = getRandomIndex();
  }

  loadSong(index < 0 ? songs.length - 1 : index, wasPlaying);
}

nextBtn.addEventListener("click", () => {
  if (!songs.length) {
    openFilePicker();
    return;
  }

  playNext();
});

function getRandomIndex() {
  if (songs.length < 2) return currentIndex;

  let index;

  do {
    index = Math.floor(Math.random() * songs.length);
  } while (index === currentIndex);

  return index;
}

function playNext() {
  if (!songs.length) return;

  const index = shuffle
    ? getRandomIndex()
    : (currentIndex + 1) % songs.length;

  loadSong(index, true);
}

// Shuffle control.
shuffleBtn.addEventListener("click", () => {
  shuffle = !shuffle;

  shuffleBtn.classList.toggle("active", shuffle);
  shuffleBtn.setAttribute("aria-pressed", String(shuffle));

  setStatus(shuffle ? "Shuffle enabled" : "Shuffle disabled");
});

// Repeat cycles through off, repeat-all, and repeat-one.
repeatBtn.addEventListener("click", () => {
  const modes = ["off", "all", "one"];
  const index = modes.indexOf(repeatMode);

  repeatMode = modes[(index + 1) % modes.length];

  repeatBtn.classList.toggle("active", repeatMode !== "off");
  repeatBtn.textContent = repeatMode === "one" ? "↻¹" : "↻";

  repeatBtn.setAttribute(
    "aria-label", `Repeat ${repeatMode}`
  );
  repeatBtn.setAttribute(
    "aria-pressed", String(repeatMode !== "off")
  );

  audio.loop = repeatMode === "one";

  setStatus(
    repeatMode === "off" ? "Repeat disabled" :
    repeatMode === "all" ? "Repeat playlist enabled" :
    "Repeat one enabled"
  );
});

// Playback progress and duration.
audio.addEventListener("loadedmetadata", () => {
  if (currentIndex < 0) return;

  const duration = audio.duration;
  songs[currentIndex].duration = duration;
  persistLibrary();

  durationEl.textContent = formatTime(duration);
  renderPlaylist();
});

audio.addEventListener("timeupdate", () => {
  if (!isSeeking && Number.isFinite(audio.duration) &&
      audio.duration > 0) {
    seekBar.value = Math.round(
      (audio.currentTime / audio.duration) * 1000
    );
  }

  currentTimeEl.textContent = formatTime(audio.currentTime);
});

seekBar.addEventListener("input", () => {
  isSeeking = true;

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    currentTimeEl.textContent = formatTime(
      (Number(seekBar.value) / 1000) * audio.duration
    );
  }
});

function finishSeeking() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime =
      (Number(seekBar.value) / 1000) * audio.duration;
  }

  isSeeking = false;
}

seekBar.addEventListener("change", finishSeeking);
seekBar.addEventListener("pointerup", finishSeeking);
seekBar.addEventListener("touchend", finishSeeking);

// Volume.
audio.volume = Number(volumeBar.value) / 100;

volumeBar.addEventListener("input", () => {
  audio.volume = Number(volumeBar.value) / 100;
});

// When a song ends, move to the next track if appropriate.
audio.addEventListener("ended", () => {
  if (repeatMode === "one") return;

  if (currentIndex < songs.length - 1 ||
      repeatMode === "all" || shuffle) {
    playNext();
  } else {
    updatePlayButton();
    setStatus("Playlist finished");
  }
});

audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);

audio.addEventListener("error", () => {
  if (currentIndex !== -1) {
    setStatus("Cannot play this file. Try another audio format.");
  }

  updatePlayButton();
});

// Favorites are stored for this session.
favoriteBtn.addEventListener("click", () => {
  if (currentIndex === -1) {
    setStatus("Choose a song first");
    return;
  }

  const id = songs[currentIndex].id;

  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }

  updateFavoriteButton();
  renderPlaylist();
  persistLibrary();
});

function updateFavoriteButton() {
  const song = songs[currentIndex];
  const liked = song && favorites.has(song.id);

  favoriteBtn.textContent = liked ? "♥" : "♡";
  favoriteBtn.classList.toggle("active", Boolean(liked));
  favoriteBtn.setAttribute("aria-pressed", String(Boolean(liked)));
}

// Search songs by title or artist.
searchInput.addEventListener("input", renderPlaylist);

function renderPlaylist() {
  const query = searchInput.value.trim().toLowerCase();

  songList.replaceChildren();

  songs.forEach((song, index) => {
    const matches = song.title.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query);

    if (!matches) return;

    const row = document.createElement("div");
    row.className = "song-row" +
      (index === currentIndex ? " current" : "");

    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Play ${song.title}`);

    const thumb = document.createElement("div");
    thumb.className = "song-thumb";
    thumb.textContent = "♫";

    const meta = document.createElement("div");
    meta.className = "song-meta";

    const title = document.createElement("h3");
    title.textContent = song.title;

    const artist = document.createElement("p");
    artist.textContent = song.artist +
      (favorites.has(song.id) ? "  ♥" : "");

    meta.append(title, artist);

    const duration = document.createElement("span");
    duration.className = "song-duration";
    duration.textContent = formatTime(song.duration);

    const playIcon = document.createElement("span");
    playIcon.className = "song-play";
    playIcon.textContent =
      index === currentIndex && !audio.paused ? "Ⅱ" : "▶";

    const actions = document.createElement("div");
    actions.className = "song-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-song";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${song.title}`);
    deleteBtn.addEventListener("click", async event => {
      event.stopPropagation();
      const deletingCurrent = index === currentIndex;
      if (deletingCurrent) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        playRequest++;
      }
      await deleteSongRecord(song.id);
      URL.revokeObjectURL(song.url);
      favorites.delete(song.id);
      songs.splice(index, 1);
      if (!songs.length) {
        currentIndex = -1;
        songTitle.textContent = "No song selected";
        songArtist.textContent = "Choose music from your device";
        currentTimeEl.textContent = "0:00";
        durationEl.textContent = "0:00";
        seekBar.value = 0;
        updateFavoriteButton();
      } else if (deletingCurrent) {
        currentIndex = -1;
        loadSong(Math.min(index, songs.length - 1), false);
      } else if (index < currentIndex) {
        currentIndex--;
      }
      renderPlaylist();
      persistLibrary();
      setStatus("Song deleted from your library");
    });
    actions.append(playIcon, deleteBtn);
    row.append(thumb, meta, duration, actions);

    const selectSong = () => loadSong(index, true);

    row.addEventListener("click", selectSong);

    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectSong();
      }
    });

    songList.appendChild(row);
  });

  songCount.textContent = `(${songs.length})`;
  emptyState.hidden = songs.length > 0;

  if (songs.length > 0 && songList.children.length === 0) {
    const message = document.createElement("p");
    message.className = "subtext";
    message.textContent = "No songs match your search.";
    songList.appendChild(message);
  }
}

// Restore saved music from IndexedDB so it survives page refreshes.
renderPlaylist();
updatePlayButton();
restoreLibrary();
