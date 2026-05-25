/**
 * Pre-join handshake room.
 *
 * Both the inviter and joiner connect to an ephemeral y-webrtc room keyed on
 * the invite ID, using the same signaling server as every other mesh-* app
 * (wss://turn.0docker.com/ws). The joiner posts their join-request capsule;
 * the inviter receives it and — after approval — posts the welcome capsule
 * back. The joiner then auto-joins without any manual copy-paste.
 *
 * Both capsules are already sealed-box encrypted (libsodium), so the signaling
 * server sees only opaque bytes. The handshake room name is derived from the
 * invite ID, which is already public in the shared invite link.
 *
 * If both browsers are not simultaneously online the automatic relay silently
 * does nothing; the manual capsule copy-paste path remains as a fallback.
 */

import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

const SIGNALING_URL = "wss://turn.0docker.com/ws";
const STUN: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export class HandshakeRoom {
  private readonly doc: Y.Doc;
  private readonly provider: WebrtcProvider;
  private readonly map: Y.Map<string>;

  constructor(inviteId: string) {
    this.doc = new Y.Doc();
    this.map = this.doc.getMap<string>("hs");
    this.provider = new WebrtcProvider(`cipher-hs:${inviteId}`, this.doc, {
      signaling: [SIGNALING_URL],
      peerOpts: { config: { iceServers: STUN } }
    });
  }

  /** Joiner → Inviter: broadcast the encrypted join-request capsule. */
  postJoinRequest(capsule: string): void {
    this.map.set("req", capsule);
  }

  /** Inviter → Joiner: broadcast the encrypted welcome capsule. */
  postWelcome(capsule: string): void {
    this.map.set("welcome", capsule);
  }

  /**
   * Subscribe to incoming join requests.
   * Fires immediately if a capsule is already present (handles the race where
   * the joiner posted before the inviter connected).
   * Returns an unsubscribe function.
   */
  onJoinRequest(cb: (capsule: string) => void): () => void {
    const observer = () => {
      const capsule = this.map.get("req");
      if (capsule) cb(capsule);
    };
    this.map.observe(observer);
    // Fire immediately in case the joiner already posted.
    const existing = this.map.get("req");
    if (existing) cb(existing);
    return () => this.map.unobserve(observer);
  }

  /**
   * Subscribe to the welcome capsule.
   * Fires immediately if already present.
   * Returns an unsubscribe function.
   */
  onWelcome(cb: (capsule: string) => void): () => void {
    const observer = () => {
      const capsule = this.map.get("welcome");
      if (capsule) cb(capsule);
    };
    this.map.observe(observer);
    const existing = this.map.get("welcome");
    if (existing) cb(existing);
    return () => this.map.unobserve(observer);
  }

  destroy(): void {
    try {
      this.provider.destroy();
    } catch {
      // ignore teardown errors
    }
    this.doc.destroy();
  }
}
