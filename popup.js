document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const autoSkipToggle = document.getElementById('toggle-auto-skip');
  const speedUpToggle = document.getElementById('toggle-speed-up');
  const muteToggle = document.getElementById('toggle-mute');
  const bannersToggle = document.getElementById('toggle-banners');
  const counterEl = document.getElementById('skipped-counter');
  const resetBtn = document.getElementById('reset-counter');

  // Load current settings and statistics
  chrome.storage.local.get({
    autoSkip: true,
    speedUp: true,
    muteAds: true,
    closeBanners: true,
    totalSkipped: 0
  }, (items) => {
    autoSkipToggle.checked = items.autoSkip;
    speedUpToggle.checked = items.speedUp;
    muteToggle.checked = items.muteAds;
    bannersToggle.checked = items.closeBanners;
    
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
