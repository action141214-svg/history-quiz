// ============================================================
// เพลงพื้นหลัง (background music)
// เล่นวนลูปตลอดตั้งแต่หน้าแรกจนจบเกม + ปุ่มปรับความดัง/มิวต์
// ============================================================

(function () {
  const audio = document.getElementById("bg-music");
  const toggleBtn = document.getElementById("music-toggle-btn");
  const volumeSlider = document.getElementById("music-volume-slider");
  if (!audio || !toggleBtn || !volumeSlider) return;

  const VOLUME_STORAGE_KEY = "bgMusicVolume";
  const MUTED_STORAGE_KEY = "bgMusicMuted";

  // จำค่าความดังล่าสุดที่ผู้เล่นตั้งไว้ (ถ้ามี) ไม่มีก็ใช้ค่าเริ่มต้นจาก slider
  const savedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
  const savedMuted = localStorage.getItem(MUTED_STORAGE_KEY) === "1";

  let currentVolume = savedVolume !== null ? parseInt(savedVolume, 10) : parseInt(volumeSlider.value, 10);
  let isMuted = savedMuted;

  volumeSlider.value = currentVolume;
  audio.volume = currentVolume / 100;
  audio.muted = isMuted;
  updateToggleIcon();

  function updateToggleIcon() {
    if (isMuted || currentVolume === 0) {
      toggleBtn.textContent = "🔇";
    } else if (currentVolume < 50) {
      toggleBtn.textContent = "🔉";
    } else {
      toggleBtn.textContent = "🔊";
    }
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
  });

  // ---------- ปุ่มมิวต์/เปิดเสียง ----------
  toggleBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    audio.muted = isMuted;
    localStorage.setItem(MUTED_STORAGE_KEY, isMuted ? "1" : "0");
    updateToggleIcon();
  });

  // ---------- เริ่มเล่นเพลง ----------
  // เบราว์เซอร์ส่วนใหญ่บล็อกไม่ให้เล่นเสียงอัตโนมัติจนกว่าจะมีการโต้ตอบจากผู้ใช้ก่อน
  // เลยพยายามเล่นทันที ถ้าโดนบล็อกก็ค่อยเล่นตอนผู้ใช้คลิก/แตะที่ไหนก็ได้ในหน้าเว็บครั้งแรก
  function tryPlay() {
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        const resumeOnInteraction = () => {
          audio.play().catch(() => {});
          document.removeEventListener("click", resumeOnInteraction);
          document.removeEventListener("touchstart", resumeOnInteraction);
          document.removeEventListener("keydown", resumeOnInteraction);
        };
        document.addEventListener("click", resumeOnInteraction, { once: true });
        document.addEventListener("touchstart", resumeOnInteraction, { once: true });
        document.addEventListener("keydown", resumeOnInteraction, { once: true });
      });
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    tryPlay();
  } else {
    document.addEventListener("DOMContentLoaded", tryPlay);
  }
})();
