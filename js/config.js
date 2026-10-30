// Network settings. Rooms are peer-to-peer (WebRTC) using PeerJS's free public signaling server.
// STUN works for most home/Wi-Fi connections. Some mobile carriers (CGNAT) and strict networks also need a TURN relay.
// The public relay below is best-effort and may be rate-limited. For rock-solid mobile play, create a free TURN account
// (e.g. metered.ca or Cloudflare Calls) and paste your own credentials here.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];
export const ROOM_PREFIX = 'holoarena-';
export const REPO_URL = 'https://github.com/WhoIsStitch/holo-arena';
