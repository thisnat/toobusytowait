// Default settings
let settings = {
  autoSkip: true,
  speedUp: true,
  muteAds: true,
  closeBanners: true
};

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
  adSkippedIncremented = true;
  chrome.storage.local.get({ totalSkipped: 0 }, (result) => {
    chrome.storage.local.set({ totalSkipped: result.totalSkipped + 1 });
  });
}

// Target extension skip button classes list
const skipButtonClasses = [
  "videoAdUiSkipButton",
  "ytp-ad-skip-button ytp-button",
  "ytp-ad-skip-button-modern ytp-button",
  "ytp-skip-ad-button",
];

function clickSkipAdBtn() {
  const elems = getElementsByClassNames(skipButtonClasses);
  let clicked = false;
  if (elems.length > 0) {
    elems.forEach((el) => {
      clickElem(el);
      el.click();
      clicked = true;
    });
  }
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
  const video = document.querySelector('video.html5-main-video');
  const player = document.querySelector('.html5-video-player');
  
  if (!video || !player) return;

  // Track the video element dynamic lifecycle
  if (video !== lastVideoEl) {
    lastVideoEl = video;
    setupVideoListeners(video);
  }

  const currentAdActive = checkAdActive(player);

  if (currentAdActive) {
    // Ad has started or transitioned to a consecutive ad
    if (!isAdActive || (video.src && video.src !== lastAdSrc)) {
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
      if (video.playbackRate !== 16) {
        setVideoPlaybackRate(video, 16);
      }
      // Ensure the video is playing
      if (video.paused) {
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
      if (!video.muted) {
        setVideoMuted(video, true);
      }
    }

    // Try to click the skip button
    if (settings.autoSkip) {
      const clicked = clickSkipAdBtn();
      if (clicked) {
        incrementSkipCount();
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
      setVideoPlaybackRate(video, 16);
    }
  });

  video.addEventListener('volumechange', () => {
    if (isAdActive && settings.muteAds && !video.muted) {
      setVideoMuted(video, true);
    }
  });
}

// Run the checker on a high-frequency interval (200ms) for instant detection
setInterval(handleAds, 200);
