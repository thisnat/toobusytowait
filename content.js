// Default settings
let settings = {
  autoSkip: true,
  speedUp: true,
  muteAds: true,
  closeBanners: true
};

// State tracking
let isAdActive = false;
let userPlaybackRate = 1;
let userMutedState = false;
let adSkippedIncremented = false;
let lastVideoEl = null;

// Load settings from storage
chrome.storage.local.get(['autoSkip', 'speedUp', 'muteAds', 'closeBanners'], (result) => {
  settings = { ...settings, ...result };
});

// Keep settings in sync
chrome.storage.onChanged.addListener((changes) => {
  for (let [key, { newValue }] of Object.entries(changes)) {
    if (newValue !== undefined) {
      settings[key] = newValue;
    }
  }
});

// Helper to check if an element is visible
function isVisible(element) {
  if (!element) return false;
  return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

// Helper to trigger a realistic click event sequence (bypasses programmatic click blocks)
function forceClick(element) {
  if (!element) return;
  try {
    // 1. Dispatch Pointer Events
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, isPrimary: true }));
    
    // 2. Dispatch Mouse Events
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    
    // 3. Native Click
    element.click();
  } catch (err) {
    console.error('toobusytowait: click failed', err);
  }
}

// Increment skip counter
function incrementSkipCount() {
  if (adSkippedIncremented) return;
  adSkippedIncremented = true;
  chrome.storage.local.get({ totalSkipped: 0 }, (result) => {
    chrome.storage.local.set({ totalSkipped: result.totalSkipped + 1 });
  });
}

// Skip selectors
const SKIP_BUTTON_SELECTORS = [
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button-slot',
  '.ytp-ad-skip-button-container',
  'button.ytp-ad-skip-button',
  '.video-ads .ytp-ad-skip-button-slot',
  'button[aria-label*="Skip"]',
  'button[aria-label*="skip"]',
  '[class*="ytp-ad-skip-button"]',
  '[class*="skip-button"]',
  '[class*="ytp-skip-ad-button"]'
];

const BANNER_CLOSE_SELECTORS = [
  '.ytp-ad-overlay-close-button',
  'a.ytp-ad-overlay-close-button',
  '.ytp-ad-overlay-close-container button'
];

// Main function to check and handle ads
function handleAds() {
  const video = document.querySelector('video.html5-main-video');
  const player = document.querySelector('.html5-video-player');
  
  if (!video || !player) return;

  // Track the video element dynamic lifecycle
  if (video !== lastVideoEl) {
    lastVideoEl = video;
    setupVideoListeners(video);
  }

  // YouTube flags ad state with these CSS classes on the player container
  const hasAdClass = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  
  // A secondary check: check if the progress bar or elements indicate an ad is running
  const adContainer = document.querySelector('.video-ads');
  const hasAdContainerActive = adContainer && adContainer.children.length > 0;
  
  const currentAdActive = hasAdClass || hasAdContainerActive;

  if (currentAdActive) {
    // Ad has started or is continuing
    if (!isAdActive) {
      isAdActive = true;
      adSkippedIncremented = false;
      
      // Save normal video states (only if we didn't just save them)
      if (video.playbackRate !== 16) {
        userPlaybackRate = video.playbackRate;
      }
      userMutedState = video.muted;
    }

    // Apply speed up if enabled
    if (settings.speedUp) {
      if (video.playbackRate !== 16) {
        video.playbackRate = 16;
      }
      // Ensure the video is playing
      if (video.paused) {
        video.play().catch(() => {});
      }
      // Progressive Enhancement: try to jump straight to the end of the ad
      if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) {
        try {
          video.currentTime = video.duration - 0.1;
        } catch (e) {}
      }
    }

    // Apply mute if enabled
    if (settings.muteAds) {
      if (!video.muted) {
        video.muted = true;
      }
    }

    // Try to click the skip button
    if (settings.autoSkip) {
      let clicked = false;
      for (const selector of SKIP_BUTTON_SELECTORS) {
        const button = document.querySelector(selector);
        if (button && isVisible(button)) {
          forceClick(button);
          incrementSkipCount();
          clicked = true;
          break;
        }
      }

      // Dynamic text-based selector search as fallback
      if (!clicked) {
        const buttons = document.querySelectorAll('button, div, span');
        for (const el of buttons) {
          const text = (el.textContent || '').trim().toLowerCase();
          // Match precise skip buttons only (ignore countdown strings like "Skip in 5s")
          if ((text === 'skip ad' || text === 'skip' || text === 'skip ad >') && isVisible(el)) {
            if (el.className.includes('ad') || el.closest('.video-ads') || el.closest('.html5-video-player')) {
              forceClick(el);
              incrementSkipCount();
              break;
            }
          }
        }
      }
    }

    // Close banner ads
    if (settings.closeBanners) {
      for (const selector of BANNER_CLOSE_SELECTORS) {
        const closeBtn = document.querySelector(selector);
        if (closeBtn && isVisible(closeBtn)) {
          forceClick(closeBtn);
        }
      }
    }
  } else {
    // No ad is active
    if (isAdActive) {
      isAdActive = false;
      
      // Restore user original states
      if (settings.speedUp) {
        video.playbackRate = userPlaybackRate;
      }
      if (settings.muteAds) {
        video.muted = userMutedState;
      }
    } else {
      // Keep tracking the user's chosen playback speed when no ad is playing
      if (video.playbackRate !== 16 && video.playbackRate !== userPlaybackRate) {
        userPlaybackRate = video.playbackRate;
      }
    }
  }
}

// Listen for video rate changes or volume changes to enforce our ad controls
function setupVideoListeners(video) {
  if (!video) return;

  // Prevent YouTube from resetting the speed/mute during ads
  video.addEventListener('ratechange', () => {
    if (isAdActive && settings.speedUp && video.playbackRate !== 16) {
      video.playbackRate = 16;
    }
  });

  video.addEventListener('volumechange', () => {
    if (isAdActive && settings.muteAds && !video.muted) {
      video.muted = true;
    }
  });
}

// Run the checker on a high-frequency interval (200ms) for instant detection
setInterval(handleAds, 200);
