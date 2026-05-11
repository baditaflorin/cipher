import type { AwarenessStatus } from "./types";
import type {
  GroupRecord,
  IdentityRecord,
  Participant,
  SignalCapsule
} from "../chat/types";
import { base64UrlToJson, jsonToBase64Url, randomId } from "../crypto/base64";
import { decryptJsonWithKey, encryptJsonWithKey } from "../crypto/sodium";
import { toParticipant } from "../identity/identity";
import { fetchIceServers, STUN_SERVERS } from "./turnConfig";

type TransportPayload =
  | {
      v: 1;
      type: "y-update";
      groupId: string;
      update: string;
      from: string;
      sentAt: string;
    }
  | {
      v: 1;
      type: "hello";
      groupId: string;
      from: Participant;
      sentAt: string;
    };

type EncryptedTransport = {
  v: 1;
  type: "cipher-transport";
  nonce: string;
  ciphertext: string;
};

// Mutable container — initialized with STUN-only and replaced once the
// turn-token-server returns fresh HMAC credentials. Future RTCPeerConnections
// pick up the relay path; existing ones keep their current config.
const rtcConfig: RTCConfiguration = { iceServers: STUN_SERVERS };
void fetchIceServers().then((servers) => { rtcConfig.iceServers = servers; });

export class MeshController {
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly tabId = randomId("tab");
  private readonly broadcastChannel: BroadcastChannel | undefined;

  constructor(
    private readonly group: GroupRecord,
    private readonly identity: IdentityRecord,
    private readonly onUpdate: (update: string) => void,
    private readonly onStatus: (status: AwarenessStatus) => void
  ) {
    this.broadcastChannel =
      "BroadcastChannel" in window
        ? new BroadcastChannel(`cipher:${group.id}`)
        : undefined;
    this.broadcastChannel?.addEventListener("message", (event: MessageEvent) => {
      void this.receiveBroadcast(event.data as EncryptedTransport & { tabId?: string });
    });
  }

  connectedPeerCount(): number {
    return [...this.channels.values()].filter(
      (channel) => channel.readyState === "open"
    ).length;
  }

  async createOffer(): Promise<string> {
    const peer = this.createPeer("pending-offer");
    const channel = peer.createDataChannel("cipher-yjs", { ordered: true });
    this.installChannel("pending-offer", channel);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);

    const capsule: SignalCapsule = {
      v: 1,
      type: "webrtc-offer",
      groupId: this.group.id,
      from: toParticipant(this.identity),
      description: peer.localDescription?.toJSON() ?? offer
    };

    return jsonToBase64Url(capsule);
  }

  async acceptSignal(capsuleText: string): Promise<string | undefined> {
    const capsule = base64UrlToJson<SignalCapsule>(capsuleText.trim());
    if (capsule.groupId !== this.group.id) {
      throw new Error("Signal capsule belongs to a different group.");
    }

    if (capsule.type === "webrtc-offer") {
      const peer = this.createPeer(capsule.from.id);
      await peer.setRemoteDescription(capsule.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);

      return jsonToBase64Url({
        v: 1,
        type: "webrtc-answer",
        groupId: this.group.id,
        from: toParticipant(this.identity),
        description: peer.localDescription?.toJSON() ?? answer
      } satisfies SignalCapsule);
    }

    const peer = this.peers.get("pending-offer");
    if (!peer) throw new Error("No pending offer exists in this tab.");
    await peer.setRemoteDescription(capsule.description);
    this.peers.delete("pending-offer");
    this.peers.set(capsule.from.id, peer);
    this.report();
    return undefined;
  }

  async broadcastYUpdate(update: string): Promise<void> {
    const payload: TransportPayload = {
      v: 1,
      type: "y-update",
      groupId: this.group.id,
      update,
      from: this.identity.id,
      sentAt: new Date().toISOString()
    };
    await this.broadcast(payload);
  }

  destroy(): void {
    this.broadcastChannel?.close();
    for (const channel of this.channels.values()) channel.close();
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.channels.clear();
  }

  private createPeer(peerId: string): RTCPeerConnection {
    const peer = new RTCPeerConnection(rtcConfig);
    this.peers.set(peerId, peer);

    peer.addEventListener("datachannel", (event) => {
      this.installChannel(peerId, event.channel);
    });
    peer.addEventListener("connectionstatechange", () => this.report());
    peer.addEventListener("iceconnectionstatechange", () => this.report());

    return peer;
  }

  private installChannel(peerId: string, channel: RTCDataChannel): void {
    this.channels.set(peerId, channel);
    channel.addEventListener("open", () => {
      this.report();
      void this.sendToChannel(channel, {
        v: 1,
        type: "hello",
        groupId: this.group.id,
        from: toParticipant(this.identity),
        sentAt: new Date().toISOString()
      });
    });
    channel.addEventListener("close", () => this.report());
    channel.addEventListener("message", (event) => {
      void this.receiveTransport(JSON.parse(String(event.data)) as EncryptedTransport);
    });
  }

  private async broadcast(payload: TransportPayload): Promise<void> {
    const encrypted = await this.encrypt(payload);
    for (const channel of this.channels.values()) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(encrypted));
      }
    }
    this.broadcastChannel?.postMessage({ ...encrypted, tabId: this.tabId });
  }

  private async sendToChannel(
    channel: RTCDataChannel,
    payload: TransportPayload
  ): Promise<void> {
    channel.send(JSON.stringify(await this.encrypt(payload)));
  }

  private async encrypt(payload: TransportPayload): Promise<EncryptedTransport> {
    const encrypted = await encryptJsonWithKey(
      this.group.groupKey,
      payload,
      this.group.id
    );
    return {
      v: 1,
      type: "cipher-transport",
      ...encrypted
    };
  }

  private async receiveBroadcast(
    envelope: EncryptedTransport & { tabId?: string }
  ): Promise<void> {
    if (envelope.tabId === this.tabId) return;
    await this.receiveTransport(envelope);
  }

  private async receiveTransport(envelope: EncryptedTransport): Promise<void> {
    const payload = await decryptJsonWithKey<TransportPayload>(
      this.group.groupKey,
      envelope,
      this.group.id
    );
    if (payload.type === "y-update" && payload.from !== this.identity.id) {
      this.onUpdate(payload.update);
    }
    this.report();
  }

  private report(): void {
    this.onStatus({
      connectedPeers: this.connectedPeerCount(),
      localTabs: this.broadcastChannel ? 1 : 0
    });
  }
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 1200);
    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  });
}
