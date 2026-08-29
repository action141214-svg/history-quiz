// ============================================================
// ระบบเกมตอบคำถามแบบเรียลไทม์ สไตล์ Kahoot
// states: waiting -> question -> reveal -> leaderboard -> (next question) / ended
// ============================================================

const QUESTION_TIME_LIMIT_MS = 15000;
const BASE_POINTS = 1000;
const MIN_POINTS = 300;

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

// ---------- โหลดคำถาม (ไม่มีเฉลยติดมาด้วย) จาก view ที่ปลอดภัย ----------
async function loadQuestionsFromServer() {
  const { data, error } = await supabaseClient
    .from("quiz_questions_public")
    .select("*")
    .order("question_index", { ascending: true });
  if (error || !data) {
    alert("โหลดคำถามไม่สำเร็จ: " + (error?.message || "unknown"));
    return;
  }
  mpQuestions = data.map((row) => ({ question: row.question, choices: row.choices }));
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
  await syncServerTime();
  await loadQuestionsFromServer();
  const code = generateRoomCode();

  const { data: existing } = await supabaseClient.from("rooms").select("code").eq("code", code).maybeSingle();
  if (existing) return createRoom();

  const { error } = await supabaseClient.from("rooms").insert({
    code,
    status: "waiting",
    current_index: -1,
    question_start_at: null
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
  await loadQuestionsFromServer();

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
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` }, () => refreshRoomState())
    .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `room_code=eq.${code}` }, () => onAnswersChanged())
    .subscribe();

  refreshRoomState();
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

// ---------- ดึงข้อมูลห้องล่าสุดแล้ว render ----------
async function refreshRoomState() {
  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room) return;

  const { data: players } = await supabaseClient.from("players").select("*").eq("room_code", roomCode);
  renderPlayerList(players || []);

  if (room.status === "waiting") {
    showScreen("mp-lobby-screen");
  } else if (room.status === "question") {
    renderQuestionScreen(room);
  } else if (room.status === "reveal") {
    await renderRevealScreen(room, players || []);
  } else if (room.status === "leaderboard") {
    await renderLeaderboardScreen(room, players || []);
  } else if (room.status === "ended") {
    renderFinalScreen(players || []);
  }
}

function renderPlayerList(players) {
  const list = document.getElementById("mp-player-list");
  if (!list) return;
  list.innerHTML = "";
  document.getElementById("mp-player-count").textContent = players.length;
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    list.appendChild(li);
  });
}

// ============================================================
// HOST: ควบคุมการไหลของเกม
// ============================================================
async function hostStartGame() {
  await goToQuestion(0);
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

async function hostAdvanceFromLeaderboard() {
  const { data: room } = await supabaseClient.from("rooms").select("*").eq("code", roomCode).maybeSingle();
  if (!room) return;
  const nextIndex = room.current_index + 1;
  if (nextIndex >= mpQuestions.length) {
    await supabaseClient.from("rooms").update({ status: "ended" }).eq("code", roomCode);
  } else {
    await goToQuestion(nextIndex);
  }
}

// ============================================================
// หน้าคำถาม + จับเวลา + สปินเนอร์รอหลังตอบ (ฝั่งผู้เล่น)
// ============================================================
function renderQuestionScreen(room) {
  const isNewQuestion = renderQuestionScreen._lastIndex !== room.current_index;
  renderQuestionScreen._lastIndex = room.current_index;
  if (isNewQuestion) {
    hasAnsweredCurrent = false;
    lastAnswerResult = null;
  }

  showScreen("mp-question-screen");
  clearInterval(questionTimerInterval);

  const q = mpQuestions[room.current_index];
  document.getElementById("mp-question-count").textContent = `ข้อ ${room.current_index + 1}/${mpQuestions.length}`;
  document.getElementById("mp-question-text").textContent = q.question;

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
      btn.addEventListener("click", () => submitAnswer(i, room));
      choicesBox.appendChild(btn);
    });
  }

  const questionStartMs = new Date(room.question_start_at).getTime();
  const timerEl = document.getElementById("mp-timer");
  questionTimerInterval = setInterval(() => {
    const elapsed = serverNow() - questionStartMs;
    const remain = Math.max(0, QUESTION_TIME_LIMIT_MS - elapsed);
    timerEl.textContent = Math.ceil(remain / 1000) + " วินาที";
    if (remain <= 0) {
      clearInterval(questionTimerInterval);
      if (isHost) revealAnswer();
    }
  }, 200);
}

// ============================================================
// PLAYER: ส่งคำตอบ (ผ่าน Edge Function เท่านั้น — คิดคะแนน+เช็คเฉลยที่ server)
// ============================================================
async function submitAnswer(choiceIndex, room) {
  if (hasAnsweredCurrent || isHost) return;
  hasAnsweredCurrent = true;

  document.getElementById("mp-choices").classList.add("hidden");
  document.getElementById("mp-waiting-spinner").classList.remove("hidden");

  const { data, error } = await supabaseClient.functions.invoke("submit-answer", {
    body: { room_code: roomCode, player_id: myPlayerId, choice: choiceIndex }
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
        : "❌ คุณตอบผิด ได้ 0 คะแนน";
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

// ============================================================
// หน้ากระดานอันดับ (พร้อมเอฟเฟกต์ตัวเลขนับขึ้นสไตล์ LP counter)
// ============================================================
async function renderLeaderboardScreen(room, players) {
  showScreen("mp-leaderboard-screen");

  // ดึงคะแนนที่ได้ในข้อล่าสุด เพื่อรู้ว่าก่อนหน้านี้คะแนนรวมเท่าไหร่ (จะได้นับขึ้นจากจุดนั้น)
  const { data: answers } = await supabaseClient
    .from("answers").select("player_id, points").eq("room_code", roomCode).eq("question_index", room.current_index);

  const roundPointsByPlayer = {};
  (answers || []).forEach((a) => (roundPointsByPlayer[a.player_id] = a.points));

  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);

  const list = document.getElementById("mp-leaderboard-list");
  list.innerHTML = "";
  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    const roundPoints = roundPointsByPlayer[p.id] || 0;
    const startScore = Math.max(0, p.total_score - roundPoints);
    const targetScore = p.total_score;

    li.innerHTML = `<span>${medal} ${p.name}</span><span class="lp-counter" data-final="${targetScore}">${startScore}</span>`;
    list.appendChild(li);

    const counterEl = li.querySelector(".lp-counter");
    animateCountUp(counterEl, startScore, targetScore);
  });

  const isLast = room.current_index + 1 >= mpQuestions.length;
  const nextBtn = document.getElementById("mp-host-next-question-btn");
  nextBtn.classList.toggle("hidden", !isHost);
  nextBtn.textContent = isLast ? "ดูผลสรุปสุดท้าย" : "ข้อถัดไป";
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
function renderFinalScreen(players) {
  showScreen("mp-final-screen");
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const list = document.getElementById("mp-final-list");
  list.innerHTML = "";
  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
    li.innerHTML = `<span>${medal} ${p.name}</span><span>${p.total_score} คะแนน</span>`;
    list.appendChild(li);
  });
}

// ============================================================
// ปุ่มต่างๆ
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("go-create-room-btn")?.addEventListener("click", () => showScreen("mp-create-screen"));
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
});