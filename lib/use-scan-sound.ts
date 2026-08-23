"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "checkin.scanSoundEnabled";
const CHANGE_EVENT = "checkin-scan-sound-change";

type AudioContextConstructor = typeof AudioContext;

let sharedAudioContext: AudioContext | null = null;

function subscribeScanSound(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getScanSoundSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

function getAudioContext() {
  if (typeof window === "undefined") return null;

  const audioWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Context) return null;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new Context();
  }
  return sharedAudioContext;
}

async function resumeAudio() {
  const context = getAudioContext();
  if (!context) return null;
  if (context.state === "suspended") await context.resume();
  return context;
}

/** A short, bright checkout-style confirmation beep generated without an audio file. */
async function playSuccessBeep() {
  try {
    const context = await resumeAudio();
    if (!context) return;

    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1_180, start);
    oscillator.frequency.setValueAtTime(1_480, start + 0.055);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.075, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  } catch {
    // Scanning must continue normally when the browser keeps audio locked.
  }
}

/** Shared, device-local scan-sound preference and browser-audio unlock handling. */
export function useScanSound() {
  const enabled = useSyncExternalStore(
    subscribeScanSound,
    getScanSoundSnapshot,
    () => true,
  );

  useEffect(() => {
    if (!enabled) return;
    const unlock = () => void resumeAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [enabled]);

  const playSuccess = useCallback(() => {
    if (enabled) void playSuccessBeep();
  }, [enabled]);

  const toggle = useCallback(() => {
    const next = !enabled;
    window.localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    // Enabling is a user gesture, so play a sample and unlock audio immediately.
    if (next) void playSuccessBeep();
  }, [enabled]);

  return { enabled, playSuccess, toggle };
}
