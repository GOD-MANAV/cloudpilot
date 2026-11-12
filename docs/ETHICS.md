# Responsible use

CloudPilot attends meetings **on your behalf, openly**. Some design decisions follow from that.

## No fake live presence
There is no mode that plays a pre-recorded video of you as your camera. A loop of you "sitting in the meeting" exists to make other participants believe you are present and attentive when you are not, and we won't build it.

What you get instead:
- **Camera off** (default) or a **still image / name card** while you're away
- **One-tap live takeover** from your phone's real camera and mic when you want to be seen or heard
- Full **recording, screenshots and notes**, so you never miss the content

The media bridge (`packages/agent/src/inject/media.js`) only carries black frames, a still image, or your live phone stream. Pull requests adding recorded-video playback as a camera source will not be accepted.

## Recording and consent
- Recording laws and institutional policies differ. Many require that participants be told.
- Meeting platforms' terms may restrict automated participants. You are responsible for following them.
- The *labeled notetaker* option (join as e.g. "Alex's Notetaker") is the most transparent setup for meetings you don't host.

## Your data
Recordings, screenshots, Google tokens and settings stay on **your** VM and **your** Google Drive. The project has no server of its own and no telemetry.
