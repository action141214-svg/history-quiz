// ===== ตัวแปรหลักของเกม =====
let currentQuestionIndex = 0;
let score = 0;
let selectedAnswer = null;

// ===== อ้างอิง element ต่างๆ =====
const startScreen = document.getElementById("start-screen");
const quizScreen = document.getElementById("quiz-screen");
const endScreen = document.getElementById("end-screen");

const startBtn = document.getElementById("start-btn");
const nextBtn = document.getElementById("next-btn");
const restartBtn = document.getElementById("restart-btn");

const questionText = document.getElementById("question-text");
const choicesContainer = document.getElementById("choices");
const feedback = document.getElementById("feedback");
const questionCount = document.getElementById("question-count");
const scoreDisplay = document.getElementById("score");
const progressFill = document.getElementById("progress-fill");

const finalScore = document.getElementById("final-score");
const finalMessage = document.getElementById("final-message");

// ===== ฟังก์ชันสลับหน้าจอ =====
function showScreen(target) {
  // รองรับทั้งการส่ง element โดยตรง หรือส่งเป็น id (string)
  const el = typeof target === "string" ? document.getElementById(target) : target;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  if (el) el.classList.add("active");
}

// ===== เริ่มเกม =====
function startGame() {
  currentQuestionIndex = 0;
  score = 0;
  scoreDisplay.textContent = "คะแนน: 0";
  showScreen(quizScreen);
  loadQuestion();
}

// ===== โหลดคำถามปัจจุบัน =====
function loadQuestion() {
  selectedAnswer = null;
  feedback.textContent = "";
  nextBtn.classList.add("hidden");

  const q = questions[currentQuestionIndex];
  questionText.textContent = q.question;
  questionCount.textContent = `คำถามที่ ${currentQuestionIndex + 1}/${questions.length}`;

  const progressPercent = ((currentQuestionIndex) / questions.length) * 100;
  progressFill.style.width = progressPercent + "%";

  choicesContainer.innerHTML = "";
  q.choices.forEach((choiceText, index) => {
    const btn = document.createElement("button");
    btn.textContent = choiceText;
    btn.classList.add("choice-btn");
    btn.addEventListener("click", () => selectAnswer(index, btn));
    choicesContainer.appendChild(btn);
  });
}

// ===== เมื่อผู้เล่นเลือกคำตอบ =====
function selectAnswer(index, btnEl) {
  if (selectedAnswer !== null) return; // กันกดซ้ำ
  selectedAnswer = index;

  const q = questions[currentQuestionIndex];
  const allButtons = document.querySelectorAll(".choice-btn");

  allButtons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.answer) {
      btn.classList.add("correct");
    } else if (i === index && index !== q.answer) {
      btn.classList.add("wrong");
    }
  });

  if (index === q.answer) {
    score++;
    scoreDisplay.textContent = "คะแนน: " + score;
    feedback.textContent = "✅ ถูกต้อง!";
    feedback.style.color = "#2ecc71";
  } else {
    feedback.textContent = "❌ ผิด! คำตอบที่ถูกคือ: " + q.choices[q.answer];
    feedback.style.color = "#e74c3c";
  }

  nextBtn.classList.remove("hidden");
}

// ===== ไปคำถามถัดไป =====
function nextQuestion() {
  currentQuestionIndex++;
  if (currentQuestionIndex < questions.length) {
    loadQuestion();
  } else {
    endGame();
  }
}

// ===== จบเกม แสดงผลคะแนน =====
function endGame() {
  progressFill.style.width = "100%";
  showScreen(endScreen);
  finalScore.textContent = `${score} / ${questions.length}`;

  const percent = (score / questions.length) * 100;
  let message = "";
  if (percent === 100) {
    message = "ยอดเยี่ยม! คุณคือผู้เชี่ยวชาญประวัติศาสตร์สงครามโลกครั้งที่สอง 🏆";
  } else if (percent >= 70) {
    message = "เก่งมาก! คุณมีความรู้ดีเยี่ยม 🎖️";
  } else if (percent >= 40) {
    message = "ไม่เลว ลองทบทวนเพิ่มอีกนิด 📚";
  } else {
    message = "ลองศึกษาเพิ่มเติมแล้วมาเล่นใหม่นะ! 💪";
  }
  finalMessage.textContent = message;
}

// ===== Event Listeners =====
startBtn.addEventListener("click", startGame);
nextBtn.addEventListener("click", nextQuestion);
restartBtn.addEventListener("click", startGame);