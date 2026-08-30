// ============================================================
// เพลงพื้นหลัง (background music)
// เล่นวนลูปตลอดตั้งแต่หน้าแรกจนจบเกม + ปุ่มปรับความดัง/มิวต์
// ============================================================

(function () {
  const audio = document.getElementById("bg-music");
  const toggleBtn = document.getElementById("music-toggle-btn");
  const volumeSlider = document.getElementById("music-volume-slider");
  const statusEl = document.getElementById("music-status");
  if (!audio || !toggleBtn || !volumeSlider) return;

  const VOLUME_STORAGE_KEY = "bgMusicVolume";
  const MUTED_STORAGE_KEY = "bgMusicMuted";

  const savedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
  const savedMuted = localStorage.getItem(MUTED_STORAGE_KEY) === "1";

  let currentVolume = savedVolume !== null ? parseInt(savedVolume, 10) : parseInt(volumeSlider.value, 10);
  let isMuted = savedMuted;
  let hasStartedOnce = false;

  volumeSlider.value = currentVolume;
  audio.volume = currentVolume / 100;
  audio.muted = isMuted;
  updateToggleIcon();

  function showStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
  }
  function hideStatus() {
    if (!statusEl) return;
    statusEl.classList.add("hidden");
  }

  function updateToggleIcon() {
    if (audio.paused) {
      toggleBtn.textContent = "▶️";
    } else if (isMuted || currentVolume === 0) {
      toggleBtn.textContent = "🔇";
    } else if (currentVolume < 50) {
      toggleBtn.textContent = "🔉";
    } else {
      toggleBtn.textContent = "🔊";
    }
  }

  // ---------- สั่งเล่นเพลงแบบตรงๆ (เรียกจากอีเวนต์คลิกของผู้ใช้เท่านั้น เพื่อให้เบราว์เซอร์ยอมให้เล่น) ----------
  function playNow() {
    audio
      .play()
      .then(() => {
        hasStartedOnce = true;
        hideStatus();
        updateToggleIcon();
      })
      .catch((err) => {
        showStatus("⚠️ เล่นเพลงไม่ได้ (อุปกรณ์นี้อาจตั้งค่าบล็อกเสียงไว้) — " + (err && err.name ? err.name : ""));
        updateToggleIcon();
      });
  }

  // ---------- ปรับความดังด้วย slider ----------
  volumeSlider.addEventListener("input", () => {
    currentVolume = parseInt(volumeSlider.value, 10);
    audio.volume = currentVolume / 100;
    if (currentVolume > 0 && isMuted) {
      isMuted = false;
      audio.muted = false;
    }
    localStorage.setItem(VOLUME_STORAGE_KEY, String(currentVolume));
    localStorage.setItem(MUTED_STORAGE_KEY, isMuted ? "1" : "0");
    updateToggleIcon();
    if (audio.paused) playNow();
  });

  // ---------- ปุ่ม: ถ้ายังไม่เล่น -> สั่งเล่นเลย / ถ้าเล่นอยู่ -> มิวต์สลับเปิด-ปิด ----------
  toggleBtn.addEventListener("click", () => {
    if (audio.paused) {
      playNow();
      return;
    }
    isMuted = !isMuted;
    audio.muted = isMuted;
    localStorage.setItem(MUTED_STORAGE_KEY, isMuted ? "1" : "0");
    updateToggleIcon();
  });

  // ---------- ลองเล่นอัตโนมัติตอนโหลดหน้า (ถ้าเบราว์เซอร์อนุญาต) ----------
  function tryAutoPlay() {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          hasStartedOnce = true;
          updateToggleIcon();
        })
        .catch(() => {
          updateToggleIcon();
          const resumeOnInteraction = () => {
            if (!hasStartedOnce) playNow();
            document.removeEventListener("click", resumeOnInteraction);
          };
          document.addEventListener("click", resumeOnInteraction, { once: true });
        });
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    tryAutoPlay();
  } else {
    document.addEventListener("DOMContentLoaded", tryAutoPlay);
  }
})();