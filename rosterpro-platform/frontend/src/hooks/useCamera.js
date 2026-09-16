import { useCallback, useEffect, useRef, useState } from "react";

// Photo-capture-for-audit only (a timestamped selfie for manual review) —
// deliberately not biometric face-matching, which would need a real
// face-recognition service and separate legal sign-off. No existing
// getUserMedia usage anywhere else in this app to match against; this
// establishes the convention.
//
// Captured frames are downscaled and JPEG-compressed client-side (480px
// longest edge, quality 0.6) before they ever leave the device — the
// backend has no S3/file-storage integration yet (see attendanceService.js)
// and stores the photo directly in Postgres, capped at ~400KB; sending a
// full-resolution photo would blow that budget on most phone cameras.
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.6;

export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  const start = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch (err) {
      setError(err.message || "Couldn't access the camera — check camera permissions for this app.");
      setActive(false);
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error("Camera isn't ready yet — wait a moment and try again.");
    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, active, error, start, stop, capture };
}
