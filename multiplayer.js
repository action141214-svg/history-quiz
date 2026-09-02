// ============================================================
// ระบบเกมตอบคำถามแบบเรียลไทม์ สไตล์ Kahoot + ระบบการ์ดพลัง
// states: waiting -> question -> reveal -> leaderboard -> card_pick -> (next question) / ended
// ============================================================

const QUESTION_TIME_LIMIT_MS = 15000;
const BASE_POINTS = 1000;
const MIN_POINTS = 300;

// ---------- ฟังก์ชันสลับหน้าจอ (ย้ายมาจาก script.js เดิมที่ถูกลบไป พร้อมโหมดเล่นคนเดียว) ----------
function showScreen(target) {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  if (el) el.classList.add("active");
}

let roomCode = null;
let myPlayerId = null;
let myName = "";
let isHost = false;
let serverTimeOffset = 0;
let questionTimerInterval = null;
let hasAnsweredCurrent = false;
let roomChannel = null;
let autoRevealChecked = false;
let mpQuestions = []; // โหลดจาก Supabase (quiz_questions_public) แทนไฟล์ questions.js เดิม เพื่อไม่ให้เฉลยหลุดไปกับ client
let lastAnswerResult = null; // เก็บผลลัพธ์ล่าสุดจาก Edge Function (ถูก/ผิด/คะแนน) ไว้โชว์ตอนเฉลย
let selectedGameSlug = null; // เกม/หมวดคำถามที่ host เลือกไว้ตอนสร้างห้อง

// ---------- โหลดรายชื่อเกมทั้งหมด (โตได้เรื่อยๆ ไม่ต้องแก้โค้ดเวลาเพิ่มเกมใหม่) ----------
async function loadGameList() {
  const { data, error } = await supabaseClient
    .from("quiz_games")
    .select("*")
    .order("sort_order", { ascending: true });

  const box = document.getElementById("mp-game-list");
  if (!box) return;
  box.innerHTML = "";

  if (error || !data || data.length === 0) {
    box.innerHTML = `<p class="error-text">โหลดรายชื่อเกมไม่สำเร็จ</p>`;
    return;
  }

  data.forEach((game) => {
    const card = document.createElement("button");
    card.className = "game-card";
    card.innerHTML = `<span class="game-card-logo">${game.logo_emoji}</span>
      <span class="game-card-name">${game.name}</span>
      <span class="game-card-desc">${game.description}</span>`;
    card.addEventListener("click", () => {
      selectedGameSlug = game.slug;
      showScreen("mp-create-screen");
    });
    box.appendChild(card);
  });
}

// ---------- สถานะเกี่ยวกับการ์ด ----------
let myCardThisRound = null;   // card_id ที่เราถืออยู่สำหรับคำถามข้อปัจจุบัน
let speedUpActive = false;    // การ์ด #7 ทำให้ตัวจับเวลาของเราเดินไวขึ้น (คนอื่นถือ ไม่ใช่เรา)
let doubleChoiceSelection = []; // สำหรับการ์ด #3 (เลือก 2 คำตอบ)

// ---------- ระบบโปรไฟล์ (avatar) ----------
let myAvatar = null; // avatar URL ปัจจุบันของฉัน (null = ยังไม่ได้เลือก)

// รูปโปรไฟล์ให้เลือก 2 แบบ อัปโหลดไว้ที่ Supabase Storage bucket ชื่อ "avatars" (public bucket)
// ⚠️ แทนที่ URL ด้านล่างด้วย public URL จริงหลังอัปโหลดรูป profile1.jpg / profile2.jpg ขึ้น Storage แล้ว
const AVATAR_OPTIONS = [
  { id: "avatar1", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile1.jpg" },
  { id: "avatar2", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile2.jpg" },
  { id: "avatar3", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile3.jpg" },
  { id: "avatar4", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile4.jpg" },
  { id: "avatar5", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile5.jpg" },
  { id: "avatar6", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile6.jpg" },
  { id: "avatar7", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile7.jpg" },
  { id: "avatar8", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile8.jpg" },
  { id: "avatar9", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile9.jpg" },
  { id: "avatar10", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile10.jpg" },
  { id: "avatar11", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile11.jpg" },
  { id: "avatar12", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile12.jpg" },
  { id: "avatar13", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile13.jpg" },
  { id: "avatar14", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/profile14.jpg" },
  { id: "avatar15", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie16.jpg"},
  { id: "avatar16", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie17.jpg"},
  { id: "avatar17", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie18.jpg"},
  { id: "avatar18", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie19.jpg"},
  { id: "avatar19", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie20.jpg"},
  { id: "avatar20", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie22.jpg"},
  { id: "avatar21", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie21.jpg"},
  { id: "avatar22", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie23.jpg"},
  { id: "avatar23", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie24.jpg"},
  { id: "avatar24", url: "https://eysadufolqifvpbsgbum.supabase.co/storage/v1/object/public/avatars/proflie25.jpg"},
];

// รูปโปรไฟล์เริ่มต้น (ยังไม่ได้เลือก) เป็นไอคอนคนเงาแบบ inline SVG ไม่ต้องพึ่งไฟล์ภายนอก
const DEFAULT_AVATAR_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="50" fill="#2b2d42"/>' +
      '<circle cx="50" cy="38" r="18" fill="#556"/>' +
      '<ellipse cx="50" cy="92" rx="32" ry="28" fill="#556"/>' +
    "</svg>"
  );

const CARD_CATALOG = [
  { id: 1, name: "โบนัส +25%", desc: "ถ้าข้อถัดไปตอบถูก ได้คะแนนเพิ่ม 25%" },
  { id: 2, name: "เดิมพันเสี่ยง -10%", desc: "ถ้าข้อถัดไปตอบผิด เสียคะแนน 10% ของคะแนนปัจจุบัน" },
  { id: 3, name: "เลือก 2 คำตอบ", desc: "เลือกได้ 2 ตัวเลือก ถูกข้อใดข้อหนึ่งได้ x2 ผิดทั้งคู่เหลือ 25%" },
  { id: 4, name: "ขโมยคะแนน", desc: "ขโมยคะแนน 25% จากผู้เล่นสุ่ม 1 คน ทันทีที่เลือก" },
  { id: 5, name: "ตัดตัวเลือกผิด", desc: "ข้อถัดไปจะตัดตัวเลือกที่ผิดออกให้ 1 ข้อ" },
  { id: 6, name: "แช่แข็งคู่แข่ง", desc: "ผู้เล่นอื่นทั้งหมดถูกแช่แข็ง 5 วินาทีแรกของข้อถัดไป" },
  { id: 7, name: "เร่งเวลาคู่แข่ง", desc: "เวลาของข้อถัดไปจะเดินไวขึ้นสำหรับผู้เล่นอื่น" },
  { id: 8, name: "รู้ตัวเลือกผิด", desc: "ข้อถัดไปจะเห็นว่าตัวเลือกไหนผิด 1 ข้อ (ยังกดได้)" },
  { id: 9, name: "ดับเบิลออร์นัธติ้ง", desc: "ตอบถูกได้คะแนน x2 แต่ถ้าตอบผิดคะแนนเหลือ 0 ทันที" }
];

// ---------- โหลดคำถาม (ไม่มีเฉลยติดมาด้วย) จาก view ที่ปลอดภัย เฉพาะเกมที่เลือก ----------
async function loadQuestionsFromServer() {
  const { data, error } = await supabaseClient
    .from("quiz_questions_public")
    .select("*")
    .eq("game_slug", selectedGameSlug)
    .order("question_index", { ascending: true });
  if (error || !data) {
    alert("โหลดคำถามไม่สำเร็จ: " + (error?.message || "unknown"));
    return;
  }
  mpQuestions = data.map((row) => ({ question: row.question, choices: row.choices, image_url: row.image_url }));
}

// ---------- ซิงค์เวลากับ server ----------
async function syncServerTime() {
  const before = Date.now();
  const { data, error } = await supabaseClient.rpc("get_server_time");
  const after = Date.now();
  if (!error && data) {
    const roundTrip = after - before;
    serverTimeOffset = new Date(data).getTime() + roundTrip / 2 - after;
  }
}
function serverNow() {
  return Date.now() + serverTimeOffset;
}

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ============================================================
// HOST: สร้างห้อง
// ============================================================
async function createRoom() {
  if (!selectedGameSlug) {
    alert("กรุณาเลือกเกมก่อน");
    showScreen("mp-game-select-screen");
    return;
  }
  await syncServerTime();
  await loadQuestionsFromServer();
  const code = generateRoomCode();

  const { data: existing } = await supabaseClient.from("rooms").select("code").eq("code", code).maybeSingle();
  if (existing) return createRoom();

  const { error } = await supabaseClient.from("rooms").insert({
    code,
    status: "waiting",
    current_index: -1,
    question_start_at: null,
    game_slug: selectedGameSlug
  });
  if (error) {
    alert("สร้างห้องไม่สำเร็จ: " + error.message);
    return;
  }

  roomCode = code;
  isHost = true;
  listenToRoom(code);
  showScreen("mp-lobby-screen");
  document.getElementById("mp-room-code-display").textContent = code;
  document.getElementById("mp-host-controls").classList.remove("hidden");
}

// ============================================================
// PLAYER: เข้าร่วมห้อง
// ============================================================
async function joinRoom(code, playerName) {
  await syncServerTime();

  const { data: room, error: roomErr } = await supabaseClient
    .from("rooms").select("*").eq("code", code).maybeSingle();

  if (roomErr || !room) {
    document.getElementById("join-error").textContent = "ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้องอีกครั้ง";
    return false;
  }
  if (room.status !== "waiting") {
    document.getElementById("join-error").textContent = "ห้องนี้เริ่มเกมไปแล้ว ไม่สามารถเข้าร่วมได้";
    return false;
  }

  selectedGameSlug = room.game_slug; // เข้าเกมเดียวกับที่ host เลือกไว้
  await loadQuestionsFromServer();

  const { data: player, error: playerErr } = await supabaseClient
    .from("players").insert({ room_code: code, name: playerName, total_score: 0 }).select().single();

  if (playerErr || !player) {
    document.getElementById("join-error").textContent = "เข้าร่วมห้องไม่สำเร็จ กรุณาลองใหม่";
    return false;
  }

  myPlayerId = player.id;
  myName = playerName;
  roomCode = code;
  isHost = false;

  listenToRoom(code);
  showScreen("mp-lobby-screen");
  document.getElementById("mp-room-code-display").textContent = code;
  document.getElementById("mp-host-controls").classList.add("hidden");
  return true;
}

// ============================================================
// ฟัง room แบบเรียลไทม์
// ============================================================
function listenToRoom(code) {
  if (roomChannel) supabaseClient.removeChannel(roomChannel);

  roomChannel = supabaseClient
    .channel("room-" + code)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }, () => refreshRoomState())
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` }, (payload) => {
      if (payload.eventType === "DELETE" && !isHost && payload.old?.id === myPlayerId) {
        alert("คุณถูกเตะออกจากห้องโดยผู้คุมเกม");
        resetToHome();
        return;
      }
      refreshRoomState();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `room_code=eq.${code}` }, () => onAnswersChanged())
    .on("postgres_changes", { event: "*", schema: "public", table: "player_cards", filter: `room_code=eq.${code}` }, () => onCardsChanged())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "card_events", filter: `room_code=eq.${code}` }, (payload) => onCardEvent(payload.new))
    .subscribe();

  refreshRoomState();
}

// ---------- ผู้เล่นที่ถูกเตะออก: เคลียร์สถานะแล้วกลับหน้าแรก ----------
function resetToHome() {
  if (roomChannel) supabaseClient.removeChannel(roomChannel);
  roomChannel = null;
  clearInterval(questionTimerInterval);
  roomCode = null;
  myPlayerId = null;
  isHost = false;
  showScreen("mp-home-screen");
}

// ---------- HOST: เตะผู้เล่นออกจากห้อง (ใช้ได้เฉพาะตอนอยู่ในล็อบบี้) ----------
async function kickPlayer(playerId, playerName) {
  if (!isHost) return;
  if (!confirm(`ต้องการเตะ "${playerName}" ออกจากห้องใช่หรือไม่?`)) return;

  // ---- ลบออกจากรายชื่อฝั่ง host ทันที ไม่ต้องรอ Realtime ตอบกลับ ----
  const row = document.querySelector(`#mp-player-list li[data-player-id="${playerId}"]`);
  if (row) row.remove();
  const countEl = document.getElementById("mp-player-count");
  if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);

  const { error } = await supabaseClient.from("players").delete().eq("id", playerId);
  if (error) {
    alert("เตะผู้เล่นไม่สำเร็จ: " + error.message);
    await refreshRoomState(); // ลบไม่สำเร็จ ต้องดึงรายชื่อจริงกลับมาแสดงใหม่
  }
}

// ---------- เมื่อมีคนตอบเพิ่ม: host เช็คว่าตอบครบทุกคนหรือยัง ถ้าครบ auto เฉลยเลย ----------
async function onAnswersChanged() {
  await refreshRoomState();
  if (!isHost || autoRevealChecked) return;

  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room || room.status !== "question") return;

  const { data: players } = await supabaseClient.from("players").select("id").eq("room_code", roomCode);
  const { data: answers } = await supabaseClient
    .from("answers").select("player_id").eq("room_code", roomCode).eq("question_index", room.current_index);

  if (players && answers && players.length > 0 && answers.length >= players.length) {
    autoRevealChecked = true;
    await revealAnswer();
  }
}

// ---------- เมื่อมีคนเลือกการ์ดเพิ่ม: แค่ re-render หน้าเลือกการ์ด (ราคาถูก) ----------
async function onCardsChanged() {
  await refreshRoomState();
}

// ---------- เมื่อมีเหตุการณ์ขโมยคะแนนเกิดขึ้น: แจ้งเตือนคนถูกขโมยด้วยจอแดง ----------
function onCardEvent(ev) {
  if (ev.to_player_id === myPlayerId) {
    triggerStealFlash(ev.from_player_name, ev.amount);
  }
}

function triggerStealFlash(fromName, amount) {
  const overlay = document.getElementById("steal-flash-overlay");
  overlay.textContent = `⚠️ ${fromName} ขโมยคะแนนคุณไป ${amount} คะแนน!`;
  overlay.classList.add("show");
  setTimeout(() => overlay.classList.remove("show"), 2500);
}

// ---------- ดึงข้อมูลห้องล่าสุดแล้ว render ----------
async function refreshRoomState() {
  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room) return;

  const { data: players } = await supabaseClient.from("players").select("*").eq("room_code", roomCode);
  renderPlayerList(players || []);

  if (room.status === "waiting") {
    showScreen("mp-lobby-screen");
    setupLobbyProfileUI(players || []);
  } else if (room.status === "countdown") {
    renderCountdownScreen(room);
  } else if (room.status === "question") {
    await renderQuestionScreen(room);
  } else if (room.status === "reveal") {
    await renderRevealScreen(room, players || []);
  } else if (room.status === "leaderboard") {
    await renderLeaderboardScreen(room, players || []);
  } else if (room.status === "card_pick") {
    await renderCardPickScreen(room, players || []);
  } else if (room.status === "ended") {
    await renderFinalScreen(players || []);
  }
}

function renderPlayerList(players) {
  const list = document.getElementById("mp-player-list");
  if (!list) return;
  list.innerHTML = "";
  document.getElementById("mp-player-count").textContent = players.length;
  players.forEach((p) => {
    const li = document.createElement("li");
    li.dataset.playerId = p.id;

    const img = document.createElement("img");
    img.className = "avatar-circle";
    img.src = p.avatar || DEFAULT_AVATAR_URL;
    img.alt = p.name;

    const span = document.createElement("span");
    span.className = "player-list-name";
    span.textContent = p.name + (p.id === myPlayerId ? " (คุณ)" : "");

    li.appendChild(img);
    li.appendChild(span);

    if (isHost) {
      const kickBtn = document.createElement("button");
      kickBtn.className = "kick-btn";
      kickBtn.type = "button";
      kickBtn.textContent = "✕";
      kickBtn.title = "เตะออกจากห้อง";
      kickBtn.addEventListener("click", () => kickPlayer(p.id, p.name));
      li.appendChild(kickBtn);
    }

    list.appendChild(li);
  });
}

// ============================================================
// ระบบโปรไฟล์: แสดง/เปลี่ยนอวาตาร์ของฉันตอนอยู่หน้าล็อบบี้
// ============================================================

// สร้างตัวเลือกรูปโปรไฟล์ในตัวเลือก (เรียกครั้งเดียว)
function renderAvatarPickerOptions() {
  const picker = document.getElementById("mp-avatar-picker");
  if (!picker || picker.dataset.built) return;
  picker.dataset.built = "1";
  AVATAR_OPTIONS.forEach((opt) => {
    const img = document.createElement("img");
    img.src = opt.url;
    img.alt = "ตัวเลือกโปรไฟล์";
    img.className = "avatar-option";
    img.dataset.avatarUrl = opt.url;
    img.addEventListener("click", () => selectAvatar(opt.url));
    picker.appendChild(img);
  });
}

function highlightSelectedAvatar(avatarUrl) {
  const picker = document.getElementById("mp-avatar-picker");
  if (!picker) return;
  Array.from(picker.children).forEach((img) => {
    img.classList.toggle("selected", img.dataset.avatarUrl === avatarUrl);
  });
}

// เตรียม UI โปรไฟล์ตอนเข้าหน้าล็อบบี้: host ไม่ต้องเลือก, player เห็นรูปปัจจุบัน + ปุ่มเปลี่ยน
function setupLobbyProfileUI(players) {
  const section = document.getElementById("mp-my-profile-section");
  if (!section) return;
  if (isHost) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  const me = players.find((p) => p.id === myPlayerId);
  myAvatar = (me && me.avatar) || null;
  document.getElementById("mp-my-avatar-img").src = myAvatar || DEFAULT_AVATAR_URL;
  highlightSelectedAvatar(myAvatar);
}

// เรียกตอนผู้เล่นกดเลือกรูปโปรไฟล์: ยิงไป Edge Function update-profile
async function selectAvatar(avatarUrl) {
  // กันเปลี่ยนหลังเกมเริ่มไปแล้ว (เผื่อ race condition ตอน host กดเริ่มพอดี)
  const { data: room } = await supabaseClient.from("rooms").select("status").eq("code", roomCode).maybeSingle();
  if (room && room.status !== "waiting") return;

  const { data, error } = await supabaseClient.functions.invoke("update-profile", {
    body: { room_code: roomCode, player_id: myPlayerId, avatar: avatarUrl }
  });

  if (error || data?.error) {
    console.error("update-profile error:", error || data?.error);
    alert("เปลี่ยนโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่");
    return;
  }

  myAvatar = avatarUrl;
  document.getElementById("mp-my-avatar-img").src = avatarUrl;
  document.getElementById("mp-avatar-picker").classList.add("hidden");
  highlightSelectedAvatar(avatarUrl);
}

// ============================================================
// HOST: ควบคุมการไหลของเกม
// ============================================================
async function hostStartGame() {
  await supabaseClient.from("rooms").update({
    status: "countdown",
    question_start_at: new Date().toISOString() // ใช้ช่องเดิมเป็นเวลาที่เริ่มนับถอยหลัง
  }).eq("code", roomCode);

  // host เป็นคนสั่งไปข้อแรกจริงๆ หลังนับครบ 3 วิ (ทุกคนแค่ดูตัวเลขนับถอยหลังจาก state นี้)
  setTimeout(() => goToQuestion(0), 3000);
}

// ---------- หน้าจอนับถอยหลัง 3 วินาทีก่อนขึ้นคำถามข้อแรก ----------
let countdownInterval = null;
function renderCountdownScreen(room) {
  showScreen("mp-countdown-screen");
  clearInterval(countdownInterval);

  const startMs = new Date(room.question_start_at).getTime();
  const numberEl = document.getElementById("mp-countdown-number");

  countdownInterval = setInterval(() => {
    const elapsed = serverNow() - startMs;
    const remain = Math.max(0, 3 - Math.floor(elapsed / 1000));
    numberEl.textContent = remain > 0 ? remain : "เริ่ม!";
    if (elapsed >= 3000) clearInterval(countdownInterval);
  }, 100);
}

async function goToQuestion(index) {
  autoRevealChecked = false;
  await supabaseClient.from("rooms").update({
    status: "question",
    current_index: index,
    question_start_at: new Date().toISOString()
  }).eq("code", roomCode);
}

async function revealAnswer() {
  await supabaseClient.from("rooms").update({ status: "reveal" }).eq("code", roomCode);
}

async function showLeaderboard() {
  await supabaseClient.from("rooms").update({ status: "leaderboard" }).eq("code", roomCode);
}

async function hostSkipQuestion() {
  // host กดข้ามได้ทุกเมื่อระหว่างข้อคำถาม (เผื่อผู้เล่นหลุด/ค้าง)
  await revealAnswer();
}

// หลังดูสกอร์บอร์ดแล้ว host กด "ข้อถัดไป" -> ไปหน้าเลือกการ์ดก่อนเสมอ (ถ้ายังไม่ใช่ข้อสุดท้าย)
async function hostAdvanceFromLeaderboard() {
  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room) return;
  const nextIndex = room.current_index + 1;
  if (nextIndex >= mpQuestions.length) {
    await supabaseClient.from("rooms").update({ status: "ended" }).eq("code", roomCode);
  } else {
    await supabaseClient.from("rooms").update({ status: "card_pick" }).eq("code", roomCode);
  }
}

// หลังผู้เล่นเลือกการ์ดครบ (หรือ host ยอมข้าม) -> เริ่มคำถามข้อถัดไปจริงๆ
async function hostStartNextQuestionAfterCards() {
  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room) return;
  await goToQuestion(room.current_index + 1);
}

// ============================================================
// หน้าเลือกการ์ดพลัง
// ============================================================

// สุ่มการ์ด 3 ใบจาก 9 ใบ แบบ deterministic (คนเดิม+รอบเดิม = ได้ชุดเดิมเสมอ กันรีเฟรชแล้วเปลี่ยน)
function seededShuffleIndices(seedStr, n) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) | 0;
  function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function getOfferedCards(targetQuestionIndex) {
  const seed = `${roomCode}-${myPlayerId}-${targetQuestionIndex}`;
  const order = seededShuffleIndices(seed, CARD_CATALOG.length);
  return order.slice(0, 3).map((i) => CARD_CATALOG[i]);
}

async function renderCardPickScreen(room, players) {
  showScreen("mp-card-pick-screen");
  const targetIndex = room.current_index + 1;

  const choicesBox = document.getElementById("mp-card-choices");
  const pickedText = document.getElementById("mp-card-picked-text");

  if (!isHost) {
    const { data: myPick } = await supabaseClient
      .from("player_cards").select("card_id")
      .eq("room_code", roomCode).eq("target_question_index", targetIndex)
      .eq("player_id", myPlayerId).maybeSingle();

    if (myPick) {
      choicesBox.classList.add("hidden");
      pickedText.classList.remove("hidden");
    } else {
      choicesBox.classList.remove("hidden");
      pickedText.classList.add("hidden");
      choicesBox.innerHTML = "";
      getOfferedCards(targetIndex).forEach((card) => {
        const btn = document.createElement("button");
        btn.className = "card-btn";
        btn.innerHTML = `<strong>${card.name}</strong><span>${card.desc}</span>`;
        btn.addEventListener("click", () => pickCard(card.id));
        choicesBox.appendChild(btn);
      });
    }
  } else {
    choicesBox.classList.add("hidden");
    pickedText.classList.add("hidden");
  }

  const hostPanel = document.getElementById("mp-card-host-panel");
  hostPanel.classList.toggle("hidden", !isHost);
  if (!isHost) return;

  const { data: picks } = await supabaseClient
    .from("player_cards").select("player_id")
    .eq("room_code", roomCode).eq("target_question_index", targetIndex);
  const pickedCount = (picks || []).length;
  document.getElementById("mp-card-progress-text").textContent =
    `ผู้เล่นเลือกการ์ดแล้ว ${pickedCount}/${players.length} คน`;

  const allPicked = players.length > 0 && pickedCount >= players.length;
  document.getElementById("mp-card-all-picked-banner").classList.toggle("hidden", !allPicked);
  document.getElementById("mp-host-next-after-cards-btn").classList.toggle("hidden", !allPicked);

  const { data: events } = await supabaseClient
    .from("card_events").select("*")
    .eq("room_code", roomCode).eq("target_question_index", targetIndex)
    .order("created_at", { ascending: true });
  const log = document.getElementById("mp-card-events-log");
  log.innerHTML = "";
  (events || []).forEach((ev) => {
    const p = document.createElement("p");
    p.textContent = `🕵️ ${ev.from_player_name} ขโมย ${ev.amount} คะแนนจาก ${ev.to_player_name}`;
    log.appendChild(p);
  });
}

async function pickCard(cardId) {
  document.getElementById("mp-card-choices").classList.add("hidden");
  document.getElementById("mp-card-picked-text").classList.remove("hidden");

  const { data, error } = await supabaseClient.functions.invoke("pick-card", {
    body: { room_code: roomCode, player_id: myPlayerId, card_id: cardId }
  });

  if (error || data?.error) {
    console.error("pick-card error:", error || data.error);
    return;
  }
  if (data.stole) {
    alert(`คุณขโมย ${data.stole.amount} คะแนนจาก ${data.stole.from}!`);
  }
}

// ============================================================
// หน้าคำถาม + จับเวลา + สปินเนอร์รอหลังตอบ (ฝั่งผู้เล่น)
// ============================================================
async function renderQuestionScreen(room) {
  const isNewQuestion = renderQuestionScreen._lastIndex !== room.current_index;
  renderQuestionScreen._lastIndex = room.current_index;
  if (isNewQuestion) {
    hasAnsweredCurrent = false;
    lastAnswerResult = null;
    myCardThisRound = null;
    speedUpActive = false;
    doubleChoiceSelection = [];
    document.getElementById("mp-active-card-badge").classList.add("hidden");
    document.getElementById("mp-frozen-overlay").classList.add("hidden");
    document.getElementById("mp-confirm-double-btn").classList.add("hidden");
  }

  showScreen("mp-question-screen");
  clearInterval(questionTimerInterval);

  const q = mpQuestions[room.current_index];
  document.getElementById("mp-question-count").textContent = `ข้อ ${room.current_index + 1}/${mpQuestions.length}`;

  const questionTextEl = document.getElementById("mp-question-text");
  const questionImageEl = document.getElementById("mp-question-image");
  if (q.image_url) {
    questionTextEl.classList.add("hidden");
    questionImageEl.src = q.image_url;
    questionImageEl.classList.remove("hidden");
  } else {
    questionImageEl.classList.add("hidden");
    questionImageEl.src = "";
    questionTextEl.classList.remove("hidden");
    questionTextEl.textContent = q.question;
  }

  const choicesBox = document.getElementById("mp-choices");
  const waitingBox = document.getElementById("mp-waiting-spinner");

  if (isHost) {
    // host: ไม่ตอบ เห็นแค่คำถาม + เวลา + ปุ่มข้าม
    choicesBox.classList.add("hidden");
    waitingBox.classList.add("hidden");
    document.getElementById("mp-host-skip-btn").classList.remove("hidden");
  } else if (hasAnsweredCurrent) {
    // ผู้เล่นที่ตอบไปแล้ว: โชว์สปินเนอร์รอผลลัพธ์
    choicesBox.classList.add("hidden");
    waitingBox.classList.remove("hidden");
    document.getElementById("mp-host-skip-btn").classList.add("hidden");
    document.getElementById("mp-confirm-double-btn").classList.add("hidden");
  } else {
    // ผู้เล่นที่ยังไม่ตอบ: โชว์ตัวเลือก
    choicesBox.classList.remove("hidden");
    waitingBox.classList.add("hidden");
    document.getElementById("mp-host-skip-btn").classList.add("hidden");
    choicesBox.innerHTML = "";
    q.choices.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.textContent = text;
      btn.addEventListener("click", () => submitAnswer(i));
      choicesBox.appendChild(btn);
    });

    if (isNewQuestion) {
      await applyCardEffectsToQuestionUI(room, q, choicesBox);
    }
  }

  const questionStartMs = new Date(room.question_start_at).getTime();
  const timerEl = document.getElementById("mp-timer");
  questionTimerInterval = setInterval(() => {
    let elapsed = serverNow() - questionStartMs;
    if (speedUpActive) elapsed = elapsed * 1.5; // การ์ด #7: เวลาเดินไวขึ้นสำหรับคนที่ไม่ได้ถือ (คิดคะแนนจริงยังใช้เวลาจริงที่ server เสมอ)
    const remain = Math.max(0, QUESTION_TIME_LIMIT_MS - elapsed);
    timerEl.textContent = Math.ceil(remain / 1000) + " วินาที";
    if (remain <= 0) {
      clearInterval(questionTimerInterval);
      if (isHost) revealAnswer();
    }
  }, 200);
}

// ---------- ใส่เอฟเฟกต์การ์ดลงบนหน้าคำถาม (เรียกครั้งเดียวตอนข้อใหม่เริ่ม) ----------
async function applyCardEffectsToQuestionUI(room, q, choicesBox) {
  const targetIndex = room.current_index;
  const badge = document.getElementById("mp-active-card-badge");

  const { data: myCard } = await supabaseClient
    .from("player_cards").select("card_id")
    .eq("room_code", roomCode).eq("target_question_index", targetIndex)
    .eq("player_id", myPlayerId).maybeSingle();
  myCardThisRound = myCard ? myCard.card_id : null;

  if (myCardThisRound) {
    const card = CARD_CATALOG.find((c) => c.id === myCardThisRound);
    badge.textContent = `🃏 การ์ดที่ถืออยู่: ${card.name}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  // ---- การ์ด #3: เลือกได้ 2 คำตอบ ----
  if (myCardThisRound === 3) {
    setupDoubleChoiceUI(choicesBox, q);
  }

  // ---- การ์ด #5 / #8: ดูตัวเลือกที่ผิด ----
  if (myCardThisRound === 5 || myCardThisRound === 8) {
    const { data: hint } = await supabaseClient.functions.invoke("get-hint", {
      body: { room_code: roomCode, player_id: myPlayerId, question_index: targetIndex }
    });
    if (hint && typeof hint.wrong_index === "number") {
      const btn = choicesBox.children[hint.wrong_index];
      if (btn) {
        if (myCardThisRound === 5) {
          btn.remove();
        } else {
          btn.classList.add("hint-wrong");
        }
      }
    }
  }

  // ---- การ์ด #6: แช่แข็งคนอื่น (เช็คว่ามีใครถือการ์ดนี้ในรอบนี้ไหม และเราไม่ได้ถือ) ----
  const { data: freezeHolders } = await supabaseClient
    .from("player_cards").select("player_id")
    .eq("room_code", roomCode).eq("target_question_index", targetIndex).eq("card_id", 6);
  if (freezeHolders && freezeHolders.length > 0 && myCardThisRound !== 6) {
    showFrozenOverlay(5000);
  }

  // ---- การ์ด #7: เร่งเวลาคนอื่น (ผลแค่ที่จอเรา ไม่กระทบคะแนนจริง) ----
  const { data: speedHolders } = await supabaseClient
    .from("player_cards").select("player_id")
    .eq("room_code", roomCode).eq("target_question_index", targetIndex).eq("card_id", 7);
  speedUpActive = !!(speedHolders && speedHolders.length > 0 && myCardThisRound !== 7);
}

function showFrozenOverlay(durationMs) {
  const overlay = document.getElementById("mp-frozen-overlay");
  const choicesBox = document.getElementById("mp-choices");
  overlay.classList.remove("hidden");
  choicesBox.style.pointerEvents = "none";
  setTimeout(() => {
    overlay.classList.add("hidden");
    choicesBox.style.pointerEvents = "";
  }, durationMs);
}

// ---------- การ์ด #3: เปลี่ยนปุ่มตัวเลือกให้เลือกได้ 2 อัน + ปุ่มยืนยัน ----------
function setupDoubleChoiceUI(choicesBox, q) {
  doubleChoiceSelection = [];
  choicesBox.innerHTML = "";
  q.choices.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => toggleDoubleChoice(i, btn));
    choicesBox.appendChild(btn);
  });
  const confirmBtn = document.getElementById("mp-confirm-double-btn");
  confirmBtn.classList.remove("hidden");
  confirmBtn.disabled = true;
  confirmBtn.onclick = () => {
    if (doubleChoiceSelection.length === 2) {
      confirmBtn.classList.add("hidden");
      submitAnswer([...doubleChoiceSelection]);
    }
  };
}
function toggleDoubleChoice(i, btn) {
  const idx = doubleChoiceSelection.indexOf(i);
  if (idx >= 0) {
    doubleChoiceSelection.splice(idx, 1);
    btn.classList.remove("selected");
  } else {
    if (doubleChoiceSelection.length >= 2) return;
    doubleChoiceSelection.push(i);
    btn.classList.add("selected");
  }
  document.getElementById("mp-confirm-double-btn").disabled = doubleChoiceSelection.length !== 2;
}

// ============================================================
// PLAYER: ส่งคำตอบ (ผ่าน Edge Function เท่านั้น — คิดคะแนน+เช็คเฉลยที่ server)
// choiceOrArray: number ปกติ, หรือ [a, b] ถ้าถือการ์ด #3
// ============================================================
async function submitAnswer(choiceOrArray) {
  if (hasAnsweredCurrent || isHost) return;
  hasAnsweredCurrent = true;

  document.getElementById("mp-choices").classList.add("hidden");
  document.getElementById("mp-confirm-double-btn").classList.add("hidden");
  document.getElementById("mp-frozen-overlay").classList.add("hidden");
  document.getElementById("mp-waiting-spinner").classList.remove("hidden");

  const { data, error } = await supabaseClient.functions.invoke("submit-answer", {
    body: { room_code: roomCode, player_id: myPlayerId, choice: choiceOrArray }
  });

  if (error || data?.error) {
    console.error("submit-answer error:", error || data.error);
    lastAnswerResult = null;
    return;
  }
  lastAnswerResult = data; // { correct, points } — เอาไว้โชว์ตอนหน้าเฉลย
}

// ============================================================
// หน้าเฉลย: กราฟแท่งจำนวนคนตอบแต่ละตัวเลือก + ผลส่วนตัว
// ============================================================
async function renderRevealScreen(room, players) {
  clearInterval(questionTimerInterval);
  showScreen("mp-reveal-screen");

  const q = mpQuestions[room.current_index];

  // ขอเฉลยจาก server (ยอมให้ดูได้ก็ต่อเมื่อห้องเลยช่วง "question" ไปแล้วเท่านั้น)
  const { data: answerData, error: answerErr } = await supabaseClient.functions.invoke("get-answer", {
    body: { room_code: roomCode, question_index: room.current_index }
  });
  const correctIndex = !answerErr && answerData ? answerData.answer_index : -1;

  const { data: answers } = await supabaseClient
    .from("answers").select("*").eq("room_code", roomCode).eq("question_index", room.current_index);

  const counts = q.choices.map(() => 0);
  (answers || []).forEach((a) => {
    if (a.choice >= 0 && a.choice < counts.length) counts[a.choice]++;
  });
  const maxCount = Math.max(1, ...counts);

  const chartBox = document.getElementById("mp-answer-chart");
  chartBox.innerHTML = "";
  q.choices.forEach((text, i) => {
    const row = document.createElement("div");
    row.className = "chart-row";
    const isCorrectChoice = i === correctIndex;
    row.innerHTML = `
      <span class="chart-label">${text}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill ${isCorrectChoice ? "correct" : ""}" style="width:${(counts[i] / maxCount) * 100}%"></div>
      </div>
      <span class="chart-count">${counts[i]} คน</span>
    `;
    chartBox.appendChild(row);
  });

  document.getElementById("mp-reveal-correct-text").textContent =
    correctIndex >= 0 ? "เฉลย: " + q.choices[correctIndex] : "";

  const personalBox = document.getElementById("mp-personal-result");
  if (!isHost) {
    personalBox.classList.remove("hidden");
    if (lastAnswerResult) {
      personalBox.textContent = lastAnswerResult.correct
        ? `✅ คุณตอบถูก! ได้ ${lastAnswerResult.points} คะแนน`
        : `❌ คุณตอบผิด (${lastAnswerResult.points >= 0 ? "ได้ 0 คะแนน" : lastAnswerResult.points + " คะแนน"})`;
      personalBox.className = lastAnswerResult.correct ? "personal-result correct" : "personal-result wrong";
    } else {
      personalBox.textContent = "⏱️ คุณไม่ได้ตอบข้อนี้ทัน";
      personalBox.className = "personal-result wrong";
    }
  } else {
    personalBox.classList.add("hidden");
  }

  document.getElementById("mp-host-leaderboard-btn").classList.toggle("hidden", !isHost);
}

let leaderboardElements = {}; // เก็บ li element ของแต่ละผู้เล่นไว้ข้ามรอบ เพื่อทำอนิเมชันสลับตำแหน่ง

// ============================================================
// หน้ากระดานอันดับ (พร้อมอนิเมชันสลับอันดับ + ตัวเลขนับขึ้นสไตล์ LP counter)
// รวมผลจากการ์ดพลัง (โบนัส/ขโมย/ฯลฯ) เข้ากับอนิเมชันนับคะแนนด้วย
// ============================================================
async function renderLeaderboardScreen(room, players) {
  showScreen("mp-leaderboard-screen");

  const { data: answers } = await supabaseClient
    .from("answers").select("player_id, points").eq("room_code", roomCode).eq("question_index", room.current_index);

  const roundPointsByPlayer = {};
  (answers || []).forEach((a) => (roundPointsByPlayer[a.player_id] = a.points));

  // ---------- ผลขโมยคะแนนที่เกิดขึ้นระหว่างเลือกการ์ดของรอบนี้ ----------
  const { data: cardEvents } = await supabaseClient
    .from("card_events").select("*").eq("room_code", roomCode).eq("target_question_index", room.current_index);
  const thiefInfo = {};   // player_id (ผู้ขโมย) -> { amount, victimName }
  const victimLoss = {};  // player_id (ผู้ถูกขโมย) -> ยอดรวมที่เสียไป
  (cardEvents || []).forEach((ev) => {
    thiefInfo[ev.from_player_id] = { amount: ev.amount, victimName: ev.to_player_name };
    victimLoss[ev.to_player_id] = (victimLoss[ev.to_player_id] || 0) + ev.amount;
  });

  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const list = document.getElementById("mp-leaderboard-list");

  // ---------- FIRST: จำตำแหน่งเดิมของแต่ละแถวก่อนสลับ ----------
  const firstRects = {};
  Object.keys(leaderboardElements).forEach((pid) => {
    const el = leaderboardElements[pid];
    if (el && el.isConnected) firstRects[pid] = el.getBoundingClientRect();
  });

  // เก็บอันดับเดิม (ก่อนข้อนี้) ไว้เทียบว่าใครขึ้น/ลง
  const previousRank = {};
  Object.keys(leaderboardElements).forEach((pid) => {
    previousRank[pid] = leaderboardElements[pid]?.dataset.rank !== undefined
      ? parseInt(leaderboardElements[pid].dataset.rank, 10)
      : null;
  });

  // ---------- สร้าง/อัปเดตแถวใหม่ตามอันดับปัจจุบัน ----------
  const newElements = {};
  list.innerHTML = "";
  sorted.forEach((p, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    const roundPoints = roundPointsByPlayer[p.id] || 0;
    const stealGain = thiefInfo[p.id] ? thiefInfo[p.id].amount : 0;
    const stealLoss = victimLoss[p.id] || 0;
    const totalDelta = roundPoints + stealGain - stealLoss;
    const startScore = Math.max(0, p.total_score - totalDelta);
    const targetScore = p.total_score;

    const li = document.createElement("li");
    li.className = "leaderboard-row" + (i < 5 ? " top5" : "");
    li.dataset.rank = i;
    const avatarSrc = p.avatar || DEFAULT_AVATAR_URL;
    li.innerHTML = `<span class="lb-row-left"><img class="avatar-circle avatar-small" src="${avatarSrc}" alt=""><span class="lb-medal">${medal} ${p.name}</span></span><span class="lp-counter">${startScore}</span>`;
    if (thiefInfo[p.id]) {
      const note = document.createElement("div");
      note.className = "steal-note";
      note.textContent = `🗡️ ขโมย ${thiefInfo[p.id].amount} คะแนนจาก ${thiefInfo[p.id].victimName}`;
      li.appendChild(note);
    }
    list.appendChild(li);
    newElements[p.id] = li;

    animateCountUp(li.querySelector(".lp-counter"), startScore, targetScore);

    // ---------- เทียบอันดับเก่ากับใหม่ เพื่อใส่สีไฮไลต์ขึ้น/ลง ----------
    const oldRank = previousRank[p.id];
    if (oldRank !== null && oldRank !== undefined) {
      if (oldRank > i) li.classList.add("rank-up");
      else if (oldRank < i) li.classList.add("rank-down");
    }
  });
  leaderboardElements = newElements;

  // ---------- LAST + INVERT + PLAY: ย้ายจากตำแหน่งเดิมมาตำแหน่งใหม่แบบเลื่อนลื่นๆ ----------
  Object.keys(newElements).forEach((pid) => {
    const el = newElements[pid];
    const first = firstRects[pid];
    if (!first) return; // แถวใหม่ (เพิ่งเข้าห้อง) ไม่ต้องเลื่อน
    const last = el.getBoundingClientRect();
    const deltaY = first.top - last.top;
    if (deltaY === 0) return;

    el.style.transform = `translateY(${deltaY}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translateY(0)";
    });
  });

  // เอาคลาสไฮไลต์ขึ้น/ลงออกหลังอนิเมชันจบ ไม่ให้ค้างติดตาถาวร
  setTimeout(() => {
    Object.values(newElements).forEach((el) => el.classList.remove("rank-up", "rank-down"));
  }, 1400);

  const isLast = room.current_index + 1 >= mpQuestions.length;
  const nextBtn = document.getElementById("mp-host-next-question-btn");
  nextBtn.classList.toggle("hidden", !isHost);
  nextBtn.textContent = isLast ? "ดูผลสรุปสุดท้าย" : "ไปเลือกการ์ดพลัง";
}

// ---------- เอฟเฟกต์นับตัวเลขขึ้น สไตล์ Life Point counter (Yu-Gi-Oh) ----------
function animateCountUp(element, startValue, endValue) {
  if (startValue === endValue) {
    element.textContent = endValue + " คะแนน";
    return;
  }
  const duration = 1200; // มิลลิวินาที
  const startTime = performance.now();
  element.classList.add("lp-counting");

  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    // ease-out เพื่อให้ช่วงท้ายๆ นับช้าลงเหมือน LP counter จริง
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.round(startValue + (endValue - startValue) * eased);
    element.textContent = currentValue + " คะแนน";

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.textContent = endValue + " คะแนน";
      element.classList.remove("lp-counting");
      element.classList.add("lp-done");
      setTimeout(() => element.classList.remove("lp-done"), 400);
    }
  }
  requestAnimationFrame(tick);
}

// ============================================================
// หน้าสรุปผลสุดท้าย
// ============================================================
async function renderFinalScreen(players) {
  showScreen("mp-final-screen");

  // ---------- อันดับตามคะแนน (มีผลจากการ์ด/การขโมยปะปนอยู่) ----------
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const list = document.getElementById("mp-final-list");
  list.innerHTML = "";
  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    const avatarSrc = p.avatar || DEFAULT_AVATAR_URL;
    li.innerHTML = `<span class="lb-row-left"><img class="avatar-circle avatar-small" src="${avatarSrc}" alt=""><span>${medal} ${p.name}</span></span><span>${p.total_score} คะแนน</span>`;
    list.appendChild(li);
  });

  // ---------- สรุป "ตอบถูกกี่ข้อ" ล้วนๆ ไม่ปนกับคะแนนที่โดนการ์ด/ขโมย ----------
  // เหมาะเอาไว้ตัดสินรางวัลในห้องเรียน เพราะยุติธรรมกว่าคะแนนที่อาจถูกขโมยไป
  // ถ้าตอบถูกจำนวนข้อเท่ากัน ตัดสินด้วยเวลารวมที่ใช้ตอบ (ยิ่งเร็วยิ่งได้อันดับดีกว่า)
  const { data: answers } = await supabaseClient
    .from("answers")
    .select("player_id, correct, elapsed_ms")
    .eq("room_code", roomCode);

  const correctCountByPlayer = {};
  const totalElapsedByPlayer = {};
  (answers || []).forEach((a) => {
    if (!correctCountByPlayer[a.player_id]) correctCountByPlayer[a.player_id] = 0;
    if (!totalElapsedByPlayer[a.player_id]) totalElapsedByPlayer[a.player_id] = 0;
    if (a.correct) correctCountByPlayer[a.player_id]++;
    totalElapsedByPlayer[a.player_id] += a.elapsed_ms || 0;
  });

  const totalQuestions = mpQuestions.length;
  const byAccuracy = [...players].sort((a, b) => {
    const correctDiff = (correctCountByPlayer[b.id] || 0) - (correctCountByPlayer[a.id] || 0);
    if (correctDiff !== 0) return correctDiff;
    // ตอบถูกเท่ากัน -> ใครใช้เวลารวมน้อยกว่า (ตอบไวกว่า) ได้อันดับดีกว่า
    return (totalElapsedByPlayer[a.id] || 0) - (totalElapsedByPlayer[b.id] || 0);
  });

  const accuracyBox = document.getElementById("mp-final-accuracy-list");
  if (accuracyBox) {
    accuracyBox.innerHTML = "";
    byAccuracy.forEach((p, i) => {
      const li = document.createElement("li");
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
      const avatarSrc = p.avatar || DEFAULT_AVATAR_URL;
      const correctCount = correctCountByPlayer[p.id] || 0;
      li.innerHTML = `<span class="lb-row-left"><img class="avatar-circle avatar-small" src="${avatarSrc}" alt=""><span>${medal} ${p.name}</span></span><span>${correctCount}/${totalQuestions} ข้อ</span>`;
      accuracyBox.appendChild(li);
    });
  }
}

// ============================================================
// ปุ่มต่างๆ
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  renderAvatarPickerOptions();
  loadGameList();
  document.getElementById("mp-change-avatar-btn")?.addEventListener("click", () => {
    document.getElementById("mp-avatar-picker").classList.toggle("hidden");
  });
  document.getElementById("go-create-room-btn")?.addEventListener("click", () => showScreen("mp-game-select-screen"));
  document.getElementById("go-join-room-btn")?.addEventListener("click", () => showScreen("mp-join-screen"));
  document.getElementById("confirm-create-room-btn")?.addEventListener("click", () => createRoom());
  document.getElementById("confirm-join-room-btn")?.addEventListener("click", () => {
    const code = document.getElementById("join-room-code-input").value.trim();
    const name = document.getElementById("join-room-name-input").value.trim() || "ผู้เล่นนิรนาม";
    if (code.length !== 6) {
      document.getElementById("join-error").textContent = "กรุณากรอกรหัสห้อง 6 หลัก";
      return;
    }
    joinRoom(code, name);
  });
  document.getElementById("mp-host-start-btn")?.addEventListener("click", hostStartGame);
  document.getElementById("mp-host-skip-btn")?.addEventListener("click", hostSkipQuestion);
  document.getElementById("mp-host-leaderboard-btn")?.addEventListener("click", showLeaderboard);
  document.getElementById("mp-host-next-question-btn")?.addEventListener("click", hostAdvanceFromLeaderboard);
  document.getElementById("mp-host-next-after-cards-btn")?.addEventListener("click", hostStartNextQuestionAfterCards);
});