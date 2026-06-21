document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const autoSkipToggle = document.getElementById('toggle-auto-skip');
  const speedUpToggle = document.getElementById('toggle-speed-up');
  const muteToggle = document.getElementById('toggle-mute');
  const bannersToggle = document.getElementById('toggle-banners');
  const soundToggle = document.getElementById('toggle-sound');
  const hitmarkerToggle = document.getElementById('toggle-hitmarker');
  const sniperToggle = document.getElementById('toggle-sniper');
  const counterEl = document.getElementById('skipped-counter');
  const resetBtn = document.getElementById('reset-counter');

  // Load current settings and statistics
  chrome.storage.local.get({
    autoSkip: true,
    speedUp: true,
    muteAds: true,
    closeBanners: true,
    playSkipSound: true,
    playHitmarker: true,
    playSniper: true,
    totalSkipped: 0
  }, (items) => {
    autoSkipToggle.checked = items.autoSkip;
    speedUpToggle.checked = items.speedUp;
    muteToggle.checked = items.muteAds;
    bannersToggle.checked = items.closeBanners;
    soundToggle.checked = items.playSkipSound;
    hitmarkerToggle.checked = items.playHitmarker;
    sniperToggle.checked = items.playSniper;
    
    // Set counter with a smooth entry animation
    updateCounterDisplay(items.totalSkipped, false);
  });

  // Save settings on changes
  autoSkipToggle.addEventListener('change', () => {
    chrome.storage.local.set({ autoSkip: autoSkipToggle.checked });
  });

  speedUpToggle.addEventListener('change', () => {
    chrome.storage.local.set({ speedUp: speedUpToggle.checked });
  });

  muteToggle.addEventListener('change', () => {
    chrome.storage.local.set({ muteAds: muteToggle.checked });
  });

  bannersToggle.addEventListener('change', () => {
    chrome.storage.local.set({ closeBanners: bannersToggle.checked });
  });

  soundToggle.addEventListener('change', () => {
    chrome.storage.local.set({ playSkipSound: soundToggle.checked });
  });

  hitmarkerToggle.addEventListener('change', () => {
    chrome.storage.local.set({ playHitmarker: hitmarkerToggle.checked });
  });

  sniperToggle.addEventListener('change', () => {
    chrome.storage.local.set({ playSniper: sniperToggle.checked });
  });

  // Preview sound effect
  const previewSoundBtn = document.getElementById('preview-sound');
  if (previewSoundBtn) {
    previewSoundBtn.addEventListener('click', () => {
      try {
        const audio = new Audio('skip_sound.mp3');
        audio.volume = 0.4;
        audio.play().catch((e) => console.log("Sound preview play failed:", e));
      } catch (e) {
        console.log("Sound preview error:", e);
      }
    });
  }

  // Preview hitmarker effect
  const previewHitmarkerBtn = document.getElementById('preview-hitmarker');
  if (previewHitmarkerBtn) {
    previewHitmarkerBtn.addEventListener('click', () => {
      try {
        const audio = new Audio('hitmarker.mp3');
        audio.volume = 0.4;
        audio.play().catch((e) => console.log("Hitmarker preview play failed:", e));
      } catch (e) {
        console.log("Hitmarker preview error:", e);
      }
    });
  }

  // Preview sniper effect
  const previewSniperBtn = document.getElementById('preview-sniper');
  if (previewSniperBtn) {
    previewSniperBtn.addEventListener('click', () => {
      try {
        const audio = new Audio('sniper.webm');
        audio.volume = 0.5;
        audio.play().catch((e) => console.log("Sniper preview play failed:", e));
      } catch (e) {
        console.log("Sniper preview error:", e);
      }
    });
  }

  // Reset counter logic
  resetBtn.addEventListener('click', () => {
    chrome.storage.local.set({ totalSkipped: 0 }, () => {
      updateCounterDisplay(0, true);
    });
  });

  // Listen for changes from the content script (e.g. counter updates)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.totalSkipped) {
      const newValue = changes.totalSkipped.newValue !== undefined ? changes.totalSkipped.newValue : 0;
      updateCounterDisplay(newValue, true);
    }
  });

  // Function to update the counter with a scale/bump animation and standard formatting
  function updateCounterDisplay(value, animate) {
    const formattedVal = value.toLocaleString();
    if (animate) {
      counterEl.classList.add('bump');
      setTimeout(() => {
        counterEl.textContent = formattedVal;
        setTimeout(() => {
          counterEl.classList.remove('bump');
        }, 150);
      }, 50);
    } else {
      counterEl.textContent = formattedVal;
    }
  }
});
