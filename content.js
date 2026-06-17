// Default settings
let settings = {
  autoSkip: true,
  speedUp: true,
  muteAds: true,
  closeBanners: true,
  playSkipSound: true
};

let adCheckInterval;
let playerObserver = null;

// Capture native browser HTMLMediaElement descriptors before YouTube overrides them
const nativePlaybackRateSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate')?.set;
const nativeMutedSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')?.set;
const nativePlay = HTMLMediaElement.prototype.play;

// Safe wrapper to set video playbackRate using the native browser descriptor
function setVideoPlaybackRate(video, value) {
  try {
    if (nativePlaybackRateSetter) {
      nativePlaybackRateSetter.call(video, value);
    } else {
      video.playbackRate = value;
    }
  } catch (e) {
    video.playbackRate = value;
  }
}

// Safe wrapper to set video muted state using the native browser descriptor
function setVideoMuted(video, value) {
  try {
    if (nativeMutedSetter) {
      nativeMutedSetter.call(video, value);
    } else {
      video.muted = value;
    }
  } catch (e) {
    video.muted = value;
  }
}

// State tracking
let isAdActive = false;
let userPlaybackRate = 1;
let userMutedState = false;
let adSkippedIncremented = false;
let lastVideoEl = null;
let lastAdSrc = '';

// Load settings from storage
chrome.storage.local.get(['autoSkip', 'speedUp', 'muteAds', 'closeBanners', 'playSkipSound'], (result) => {
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

// Click dispatcher mimicking the reference extension's approach
function clickElem(el) {
  try {
    const evObj = document.createEvent("Events");
    evObj.initEvent("click", true, false);
    el.dispatchEvent(evObj);
  } catch (e) {
    el.click();
  }
}

function getElementsByClassNames(classNames) {
  return classNames
    .map((name) => Array.from(document.getElementsByClassName(name)) || [])
    .reduce((acc, elems) => acc.concat(elems), [])
    .map((elem) => elem);
}

// Increment skip counter
function incrementSkipCount() {
  if (adSkippedIncremented) return;
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  
  adSkippedIncremented = true;
  chrome.storage.local.get({ totalSkipped: 0 }, (result) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({ totalSkipped: result.totalSkipped + 1 });
  });
}

// Play sound effect when skipping an ad
function playSkipSound() {
  if (!settings.playSkipSound) return;
  try {
    const audioUrl = chrome.runtime.getURL('skip_sound.mp3');
    const audio = new Audio(audioUrl);
    audio.volume = 0.4;
    audio.play().catch((e) => console.log("[toobusytowait] Sound play failed:", e));
  } catch (e) {
    console.log("[toobusytowait] Sound play error:", e);
  }
}


// Target extension skip button classes list
const skipButtonClasses = [
  "videoAdUiSkipButton",
  "ytp-ad-skip-button ytp-button",
  "ytp-ad-skip-button-modern ytp-button",
  "ytp-skip-ad-button",
];

function isVisible(el) {
  if (!el) return false;
  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  } catch (e) {
    return false;
  }
}

function clickSkipAdBtn() {
  const elems = getElementsByClassNames(skipButtonClasses);
  let clicked = false;
  elems.forEach((el) => {
    if (isVisible(el)) {
      clickElem(el);
      el.click();
      clicked = true;
    }
  });
  return clicked;
}

// Ad Active Checks (combining classes, overlays, and badge elements)
function checkAdActive(player) {
  if (!player) return false;

  const hasAdClass = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  
  // Elements check from target extension
  const advertiserBtn = document.querySelector(".ytp-ad-visit-advertiser-button");
  const advertiserLink = document.querySelector(".ytp-visit-advertiser-link");
  const adBadge = document.querySelector(".ytp-ad-badge");
  const hasAdElements = !!(
    (advertiserBtn && advertiserBtn.getAttribute("aria-label")) ||
    (advertiserLink && advertiserLink.getAttribute("aria-label")) ||
    (adBadge && adBadge.textContent && adBadge.textContent.trim())
  );

  return hasAdClass || hasAdElements;
}

// Main function to check and handle ads
function handleAds() {
  // Clear checker interval and stop if extension context is invalidated
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    if (adCheckInterval) {
      clearInterval(adCheckInterval);
    }
    if (playerObserver) {
      playerObserver.disconnect();
    }
    return;
  }

  const video = document.querySelector('video.html5-main-video');
  const player = document.querySelector('.html5-video-player');
  
  if (!video || !player) return;

  // Setup MutationObserver on player classes to capture ad transitions instantly
  if (!playerObserver) {
    setupPlayerObserver(player);
  }

  // Track the video element dynamic lifecycle
  if (video !== lastVideoEl) {
    lastVideoEl = video;
    setupVideoListeners(video);
  }

  const currentAdActive = checkAdActive(player);

  if (currentAdActive) {
    // Ad has started or transitioned to a consecutive ad
    if (!isAdActive || (video.src && video.src !== lastAdSrc)) {
      if (isAdActive && !adSkippedIncremented) {
        incrementSkipCount();
        playSkipSound();
      }
      isAdActive = true;
      lastAdSrc = video.src || '';
      adSkippedIncremented = false;
      
      // Save normal video states (only if we didn't just save them)
      if (video.playbackRate !== 16) {
        userPlaybackRate = video.playbackRate;
      }
      userMutedState = video.muted;
    }

    // Apply speed up if enabled (safe, native speed up without modifying currentTime directly)
    if (settings.speedUp) {
      if (adSkippedIncremented) {
        // Force normal playback rate immediately if ad is already skipped/being skipped
        if (video.playbackRate !== userPlaybackRate) {
          setVideoPlaybackRate(video, userPlaybackRate);
        }
      } else {
        const remainingTime = video.duration - video.currentTime;
        // If the ad is about to end naturally (remaining time < 1 second), reset speed to 1x
        // to allow the player to pre-buffer the main video at 1x speed and prevent black screen delays
        if (isFinite(video.duration) && video.duration > 0 && remainingTime < 1.0) {
          if (video.playbackRate !== userPlaybackRate) {
            setVideoPlaybackRate(video, userPlaybackRate);
          }
        } else {
          if (video.playbackRate !== 16) {
            setVideoPlaybackRate(video, 16);
          }
        }
      }
      
      // Ensure the video is playing (only if we haven't skipped yet)
      if (video.paused && !adSkippedIncremented) {
        try {
          if (nativePlay) {
            nativePlay.call(video).catch(() => {});
          } else {
            video.play().catch(() => {});
          }
        } catch (e) {
          video.play().catch(() => {});
        }
      }
    }

    // Apply mute if enabled
    if (settings.muteAds) {
      if (adSkippedIncremented) {
        // Restore normal volume state immediately
        if (video.muted !== userMutedState) {
          setVideoMuted(video, userMutedState);
        }
      } else {
        if (!video.muted) {
          setVideoMuted(video, true);
        }
      }
    }

    // Try to click the skip button
    if (settings.autoSkip && !adSkippedIncremented) {
      const elems = getElementsByClassNames(skipButtonClasses);
      const hasVisibleButton = elems.some(el => isVisible(el));
      
      if (hasVisibleButton) {
        // 1. Mark as skipped early to lock the state and prevent further 16x updates
        adSkippedIncremented = true;
        
        // 2. Reset playback rate and mute state immediately to stabilize the media pipeline
        setVideoPlaybackRate(video, userPlaybackRate);
        setVideoMuted(video, userMutedState);
        
        // 3. Defer the click by 150ms to give the browser's audio/video rendering thread
        // enough time to stabilize at 1x speed before YouTube switches the source
        setTimeout(() => {
          const clicked = clickSkipAdBtn();
          if (clicked) {
            incrementSkipCount();
            playSkipSound();
          } else {
            // If clicking failed or button disappeared, reset the flag so we can try again
            adSkippedIncremented = false;
          }
        }, 150);
      }
    }

    // Close banner ads
    if (settings.closeBanners) {
      const closeBtns = getElementsByClassNames(["ytp-ad-overlay-close-button"]);
      closeBtns.forEach((btn) => clickElem(btn));
    }
  } else {
    // No ad is active
    if (isAdActive) {
      if (!adSkippedIncremented) {
        incrementSkipCount();
        playSkipSound();
      }
      isAdActive = false;
      lastAdSrc = '';
      
      // Restore user original states
      if (settings.speedUp) {
        setVideoPlaybackRate(video, userPlaybackRate);
      }
      if (settings.muteAds) {
        setVideoMuted(video, userMutedState);
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

  // Prevent YouTube from resetting the speed/mute during ads by re-applying the native setter
  video.addEventListener('ratechange', () => {
    if (isAdActive && settings.speedUp && video.playbackRate !== 16) {
      handleAds();
      if (isAdActive && video.playbackRate !== 16) {
        setVideoPlaybackRate(video, 16);
      }
    }
  });

  // Listen for volume changes to re-apply mute during ads
  video.addEventListener('volumechange', () => {
    if (isAdActive && settings.muteAds && !video.muted) {
      handleAds();
      if (isAdActive && !video.muted) {
        setVideoMuted(video, true);
      }
    }
  });

  // Listen for loadstart to catch transitions immediately and reset settings
  video.addEventListener('loadstart', () => {
    handleAds();
  });
}

function setupPlayerObserver(player) {
  if (!player) return;
  if (playerObserver) {
    playerObserver.disconnect();
  }
  playerObserver = new MutationObserver(() => {
    handleAds();
  });
  playerObserver.observe(player, {
    attributes: true,
    attributeFilter: ['class']
  });
}

// Run the checker on a high-frequency interval (200ms) for instant detection
adCheckInterval = setInterval(handleAds, 200);
