/**
 * Mesh controller — y-webrtc edition.
 *
 * Replaces manual RTCPeerConnection + capsule signaling with WebrtcProvider,
 * which uses wss://turn.0docker.com/ws for automatic peer discovery. Peers in
 * the same group find and connect to each other with zero manual steps.
 *
 * The caller-supplied Y.Doc is the live group document. The provider syncs it
 * automatically with all remote peers; local writes are broadcast immediately.
 * Remote updates arrive as Yjs "update" events on the doc, which App.tsx's
 * handleUpdate already watches — no change needed there.
 *
 * Security: every chat record written into the doc is encrypted with the group
 * key (AES-GCM) before being committed. The provider only syncs CRDT ops over
 * these opaque blobs, so the signaling server (and any WebRTC eavesdropper)
 * sees no plaintext.
 */

import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

import type { GroupRecord } from "../chat/types";
import type { AwarenessStatus } from "./types";
import { fetchIceServers, STUN_SERVERS } from "./turnConfig";

const SIGNALING_URL = "wss://turn.0docker.com/ws";

// Populated once on first import; future RTCPeerConnections pick up TURN.
const rtcConfig: RTCConfiguration = { iceServers: STUN_SERVERS };
void fetchIceServers().then((servers) => {
  rtcConfig.iceServers = servers;
});

export class MeshController {
  private readonly provider: WebrtcProvider;

  constructor(
    group: GroupRecord,
    doc: Y.Doc,
    onStatus: (status: AwarenessStatus) => void
  ) {
    this.provider = new WebrtcProvider(`cipher:${group.id}`, doc, {
      signaling: [SIGNALING_URL],
      peerOpts: { config: rtcConfig }
    });

    const localTabs = typeof BroadcastChannel !== "undefined" ? 1 : 0;

    const reportStatus = () => {
      const count = Math.max(0, this.provider.awareness.getStates().size - 1);
      onStatus({ connectedPeers: count, localTabs });
    };

    this.provider.awareness.on("change", reportStatus);
    reportStatus();
  }

  destroy(): void {
    try {
      this.provider.destroy();
    } catch {
      // ignore teardown errors
    }
  }
}
