import {
  Bot,
  Camera,
  CameraOff,
  Check,
  Copy,
  Github,
  Heart,
  KeyRound,
  Mic,
  Plus,
  Send,
  Share2,
  ShieldCheck,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type * as Y from "yjs";

import { buildInfo } from "../generated/buildInfo";
import {
  summarizeThread,
  transcribeAudio,
  type SummaryResult
} from "../features/ai/localAi";
import type {
  DecryptedChatRecord,
  GroupRecord,
  IdentityRecord,
  InvitePayload,
  JoinRequestPayload
} from "../features/chat/types";
import { useQRScanner } from "../features/invite/useQRScanner";
import type { AwarenessStatus } from "../features/mesh/types";

type Notice = { tone: "good" | "warn" | "bad"; text: string };

export function App() {
  const [identity, setIdentity] = useState<IdentityRecord>();
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [doc, setDoc] = useState<Y.Doc>();
  const [messages, setMessages] = useState<DecryptedChatRecord[]>([]);
  const [newGroupName, setNewGroupName] = useState("Coordination room");
  const [draft, setDraft] = useState("");
  const [capsuleInput, setCapsuleInput] = useState("");
  const [capsuleOutput, setCapsuleOutput] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteQr, setInviteQr] = useState("");
  const [joinRequest, setJoinRequest] = useState<JoinRequestPayload>();
  const [inviteFromUrl, setInviteFromUrl] = useState<InvitePayload>();
  // room-link built for the current group (shown after clicking Share)
  const [roomLink, setRoomLink] = useState("");
  // data-URL QR for the room link
  const [roomLinkQr, setRoomLinkQr] = useState("");
  const [notice, setNotice] = useState<Notice>();
  const [aiResult, setAiResult] = useState<SummaryResult>();
  const [transcript, setTranscript] = useState("");
  const [meshStatus, setMeshStatus] = useState<AwarenessStatus>({
    connectedPeers: 0,
    localTabs: 0
  });
  const [mlsOk, setMlsOk] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  // true while the joiner is waiting for the inviter to approve via mesh relay
  const [awaitingWelcome, setAwaitingWelcome] = useState(false);

  // Inviter side: ephemeral handshake rooms keyed by invite ID
  const inviterRoomsRef = useRef(
    new Map<string, { postWelcome: (c: string) => void; destroy: () => void }>()
  );
  // Joiner side: the room we posted our join-request into
  const joinerRoomRef = useRef<{ destroy: () => void } | undefined>(undefined);
  // Which invite ID produced the current pending joinRequest (so we can route the welcome back)
  const pendingInviteIdRef = useRef<string | undefined>(undefined);

  // Stable callback: only uses stable state setters and ref mutations.
  // All setX functions from useState are guaranteed stable by React.
  const onHandshakeJoinRequest = useCallback(
    (capsule: string, inviteId: string) => {
      void (async () => {
        try {
          const { openJoinRequestCapsule } = await import("../features/invite/invites");
          const opened = await openJoinRequestCapsule(capsule);
          pendingInviteIdRef.current = inviteId;
          setJoinRequest(opened.request);
          setSelectedGroupId(opened.request.groupId);
          setNotice({
            tone: "warn",
            text: `${opened.request.requester.displayName} is asking to join — received via mesh relay.`
          });
        } catch {
          // Not our invite, already used/expired, or decryption mismatch — ignore silently.
        }
      })();
    },
    [] // stable: all dependencies are guaranteed stable React state setters
  );

  // Keep a ref in sync so startInviterRoom's onJoinRequest closure always
  // calls the current handler even after re-renders.
  const onHandshakeJoinRequestRef = useRef(onHandshakeJoinRequest);
  useEffect(() => {
    onHandshakeJoinRequestRef.current = onHandshakeJoinRequest;
  }, [onHandshakeJoinRequest]);

  // ---- QR scanner (joiner side) ----------------------------------------
  // Handles any URL the camera picks up: invite links and room links.
  const handleScannedUrl = useCallback(
    (text: string) => {
      void (async () => {
        try {
          const url = new URL(text);
          const hash = url.hash;

          if (hash.startsWith("#/join/")) {
            // Secure invite: parse payload, auto-trigger join request.
            const { parseInviteFromHash } = await import("../features/invite/invites");
            const payload = parseInviteFromHash(hash);
            if (!payload) return;
            scanner.stop();
            setInviteFromUrl(payload);
            // Immediately fire the join request — joiner doesn't need to click anything.
            if (!identity) return;
            const { createJoinRequestCapsule } =
              await import("../features/invite/invites");
            const capsule = await createJoinRequestCapsule(payload, identity);
            setCapsuleOutput(capsule);

            const { HandshakeRoom } = await import("../features/invite/handshake");
            joinerRoomRef.current?.destroy();
            const room = new HandshakeRoom(payload.inviteId);
            joinerRoomRef.current = room;
            room.postJoinRequest(capsule);
            setAwaitingWelcome(true);

            const capturedIdentity = identity;
            room.onWelcome((welcomeCapsule) => {
              setAwaitingWelcome(false);
              void (async () => {
                try {
                  const { openWelcomeCapsule } =
                    await import("../features/invite/invites");
                  const joined = await openWelcomeCapsule(
                    welcomeCapsule,
                    capturedIdentity
                  );
                  joinerRoomRef.current?.destroy();
                  joinerRoomRef.current = undefined;
                  await reloadGroups(joined.id);
                  setNotice({
                    tone: "good",
                    text: "Welcome received via mesh relay. Group joined!"
                  });
                } catch (error) {
                  setNotice({ tone: "bad", text: errorMessage(error) });
                }
              })();
            });

            setNotice({
              tone: "good",
              text: "QR scanned — join request sent. Waiting for host to approve…"
            });
          } else if (hash.startsWith("#/room/")) {
            // Room link: auto-join immediately.
            if (!identity) return;
            scanner.stop();
            const { parseRoomLinkFromHash, joinFromRoomLink } =
              await import("../features/invite/invites");
            const payload = parseRoomLinkFromHash(hash);
            if (!payload) return;
            const joined = await joinFromRoomLink(payload, identity);
            await reloadGroups(joined.id);
            setNotice({ tone: "good", text: `Joined "${joined.name}" via QR scan.` });
          }
        } catch {
          setNotice({ tone: "bad", text: "QR payload not recognised." });
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity] // reloadGroups is defined in the same component and is stable enough
  );

  const scanner = useQRScanner({
    onScan: (r) => handleScannedUrl(r.text)
  });

  const meshRef = useRef<{ destroy: () => void }>(undefined);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId),
    [groups, selectedGroupId]
  );
  // Destroy all handshake rooms and stop camera on unmount.
  useEffect(() => {
    // Capture the Map object at setup time — it is mutated in place, so the
    // captured reference will still see all rooms added later.
    const inviterRooms = inviterRoomsRef.current;
    return () => {
      for (const room of inviterRooms.values()) room.destroy();
      inviterRooms.clear();
      joinerRoomRef.current?.destroy(); // ref is intentionally read at cleanup time
      scanner.stop();
    };
    // scanner.stop is stable (useCallback with no deps that change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // boot is stable (defined once per mount; intentional one-shot)

  useEffect(() => {
    if (!selectedGroup || !identity) return;
    let cleanup = () => {};
    let cancelled = false;

    void (async () => {
      const [chat, meshModule, storage, identityModule] = await Promise.all([
        import("../features/chat/groups"),
        import("../features/mesh/mesh"),
        import("../features/storage/db"),
        import("../features/identity/identity")
      ]);
      const nextDoc = chat.createDocFromGroup(selectedGroup);

      // Announce ourselves into the shared participants map so every peer
      // (including any peer who joined via room-link) sees us in the roster.
      chat.writeParticipantToDoc(nextDoc, identityModule.toParticipant(identity));

      // MeshController now uses y-webrtc: peers in the same group auto-discover
      // each other via wss://turn.0docker.com/ws and sync the Yjs doc directly.
      const mesh = new meshModule.MeshController(selectedGroup, nextDoc, setMeshStatus);

      if (cancelled) {
        mesh.destroy();
        return;
      }

      meshRef.current?.destroy();
      meshRef.current = mesh;
      setDoc(nextDoc);

      const refresh = () => {
        // Merge participants written by all peers into the local group record.
        const docParticipants = chat.readParticipantsFromDoc(nextDoc);
        const participantMap = new Map(
          selectedGroup.participants.map((p) => [p.id, p])
        );
        docParticipants.forEach((p) => participantMap.set(p.id, p));
        const mergedParticipants = [...participantMap.values()];

        const mergedGroup = {
          ...selectedGroup,
          participants: mergedParticipants,
          yState: chat.encodeDocState(nextDoc)
        };

        void chat
          .decryptMessages(mergedGroup, chat.getEncryptedMessages(nextDoc))
          .then(setMessages);
        void storage.saveGroup(mergedGroup);
        setGroups((items) =>
          items.map((item) => (item.id === mergedGroup.id ? mergedGroup : item))
        );
      };

      // y-webrtc broadcasts every doc change automatically; just refresh UI.
      const handleUpdate = () => {
        refresh();
      };

      nextDoc.on("update", handleUpdate);
      refresh();
      cleanup = () => {
        nextDoc.off("update", handleUpdate);
        mesh.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // Recreate the document only when the selected room or browser identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, identity?.id]);

  /** Open a handshake room for one invite ID (idempotent — no-op if already open). */
  async function startInviterRoom(inviteId: string): Promise<void> {
    if (inviterRoomsRef.current.has(inviteId)) return;
    const { HandshakeRoom } = await import("../features/invite/handshake");
    const room = new HandshakeRoom(inviteId);
    inviterRoomsRef.current.set(inviteId, room);
    room.onJoinRequest((capsule) => {
      onHandshakeJoinRequestRef.current?.(capsule, inviteId);
    });
  }

  async function boot() {
    const [identityModule, storage, invites] = await Promise.all([
      import("../features/identity/identity"),
      import("../features/storage/db"),
      import("../features/invite/invites")
    ]);
    const activeIdentity = await identityModule.getOrCreateIdentity();
    let savedGroups = await storage.listGroups();
    setIdentity(activeIdentity);

    // --- Room-link (#/room/…): group key is in the URL, auto-join immediately.
    try {
      const roomPayload = invites.parseRoomLinkFromHash();
      if (roomPayload) {
        // Clear the hash so a reload doesn't re-process it.
        window.history.replaceState(
          null,
          "",
          window.location.origin + window.location.pathname
        );
        const joined = await invites.joinFromRoomLink(roomPayload, activeIdentity);
        savedGroups = await storage.listGroups();
        setGroups(savedGroups);
        setSelectedGroupId(joined.id);
        setNotice({ tone: "good", text: `Joined "${joined.name}" via room link.` });
        return; // skip the regular invite-from-hash check
      }
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    }

    setGroups(savedGroups);
    setSelectedGroupId(savedGroups[0]?.id);

    // --- Invite link (#/join/…): secure one-time handshake.
    try {
      setInviteFromUrl(invites.parseInviteFromHash());
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    }

    // Open handshake rooms for every valid pending invite so the inviter's
    // browser automatically receives join requests without needing any UI.
    for (const group of savedGroups) {
      const groupInvites = await storage.listInvitesForGroup(group.id);
      for (const invite of groupInvites) {
        if (invites.checkInviteValidity(invite).ok) {
          void startInviterRoom(invite.id);
        }
      }
    }
  }

  async function reloadGroups(selectId?: string) {
    const savedGroups = await import("../features/storage/db").then((storage) =>
      storage.listGroups()
    );
    setGroups(savedGroups);
    setSelectedGroupId(selectId ?? selectedGroupId ?? savedGroups[0]?.id);
  }

  async function handleCreateGroup() {
    if (!identity) return;
    setBusy(true);
    try {
      const { createGroupRecord } = await import("../features/chat/groups");
      const group = await createGroupRecord(identity, newGroupName);
      await reloadGroups(group.id);
      setNotice({ tone: "good", text: "Room created in this browser." });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!identity || !selectedGroup || !doc) return;
    setBusy(true);
    try {
      const { addPlaintextMessage } = await import("../features/chat/groups");
      await addPlaintextMessage(doc, selectedGroup, identity, draft);
      setDraft("");
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateInvite() {
    if (!identity || !selectedGroup) return;
    setBusy(true);
    try {
      const { createInvite } = await import("../features/invite/invites");
      const result = await createInvite(selectedGroup, identity);
      setInviteLink(result.link);
      setInviteQr(result.qrDataUrl);
      // Immediately open a handshake room so join requests are received
      // automatically when the joiner opens the link.
      void startInviterRoom(result.invite.id);
      setNotice({ tone: "good", text: "One-time invite link created." });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  /** Build a room-link for the current group, generate a QR, and show both. */
  async function handleShareRoom() {
    if (!selectedGroup) return;
    const [{ buildRoomLink }, QRCode] = await Promise.all([
      import("../features/invite/invites"),
      import("qrcode")
    ]);
    const link = buildRoomLink(selectedGroup);
    const qr = await QRCode.toDataURL(link, {
      margin: 1,
      width: 240,
      color: { dark: "#14211b", light: "#f6f2e8" }
    });
    setRoomLink(link);
    setRoomLinkQr(qr);
    setNotice({
      tone: "good",
      text: "Share this link or QR — anyone with it joins instantly."
    });
  }

  async function handleCreateJoinRequest() {
    if (!identity || !inviteFromUrl) return;
    setBusy(true);
    try {
      const { createJoinRequestCapsule } = await import("../features/invite/invites");
      const capsule = await createJoinRequestCapsule(inviteFromUrl, identity);
      // Keep the manual fallback: the capsule text is still shown so the user
      // can copy-paste it if the inviter's browser isn't currently open.
      setCapsuleOutput(capsule);

      // Also relay automatically via the handshake room.
      const { HandshakeRoom } = await import("../features/invite/handshake");
      joinerRoomRef.current?.destroy();
      const room = new HandshakeRoom(inviteFromUrl.inviteId);
      joinerRoomRef.current = room;
      room.postJoinRequest(capsule);
      setAwaitingWelcome(true);

      // Capture identity now (it is guaranteed non-null at this point).
      const capturedIdentity = identity;
      room.onWelcome((welcomeCapsule) => {
        setAwaitingWelcome(false);
        void (async () => {
          try {
            const { openWelcomeCapsule } = await import("../features/invite/invites");
            const joined = await openWelcomeCapsule(welcomeCapsule, capturedIdentity);
            joinerRoomRef.current?.destroy();
            joinerRoomRef.current = undefined;
            await reloadGroups(joined.id);
            setNotice({
              tone: "good",
              text: "Welcome received via mesh relay. Group joined!"
            });
          } catch (error) {
            setNotice({ tone: "bad", text: errorMessage(error) });
          }
        })();
      });

      setNotice({
        tone: "good",
        text: "Join request relayed to host via mesh. Waiting for approval…"
      });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportCapsule() {
    if (!identity || !capsuleInput.trim()) return;
    setBusy(true);
    try {
      const { openWelcomeCapsule } = await import("../features/invite/invites");
      const joined = await openWelcomeCapsule(capsuleInput, identity);
      await reloadGroups(joined.id);
      setCapsuleInput("");
      setNotice({ tone: "good", text: "Welcome capsule opened. Group joined." });
    } catch {
      try {
        const { openJoinRequestCapsule } = await import("../features/invite/invites");
        const opened = await openJoinRequestCapsule(capsuleInput);
        setJoinRequest(opened.request);
        setSelectedGroupId(opened.request.groupId);
        setNotice({
          tone: "warn",
          text: `${opened.request.requester.displayName} is asking to join.`
        });
      } catch (error) {
        setNotice({ tone: "bad", text: errorMessage(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveJoin() {
    if (!selectedGroup || !joinRequest) return;
    setBusy(true);
    try {
      const [storage, chat, invites] = await Promise.all([
        import("../features/storage/db"),
        import("../features/chat/groups"),
        import("../features/invite/invites")
      ]);
      const freshGroup = (await storage.getGroup(joinRequest.groupId)) ?? selectedGroup;
      const welcome = await invites.createWelcomeCapsule(
        freshGroup,
        joinRequest,
        doc ? chat.encodeDocState(doc) : freshGroup.yState
      );
      setCapsuleOutput(welcome.capsule);
      // If this joinRequest arrived via mesh relay, send the welcome back the same way.
      const sourceInviteId = pendingInviteIdRef.current;
      if (sourceInviteId) {
        inviterRoomsRef.current.get(sourceInviteId)?.postWelcome(welcome.capsule);
        pendingInviteIdRef.current = undefined;
      }
      await reloadGroups(freshGroup.id);
      setJoinRequest(undefined);
      setNotice({
        tone: "good",
        text: "Welcome capsule created and relayed to joiner."
      });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSummarize() {
    setBusy(true);
    try {
      setAiResult(await summarizeThread(messages));
    } finally {
      setBusy(false);
    }
  }

  async function handleAudio(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const result = await transcribeAudio(file);
      setTranscript(result.summary);
      setAiResult(result);
    } finally {
      setBusy(false);
    }
  }

  async function handleMlsCheck() {
    setBusy(true);
    try {
      const result = await import("../features/mls/mls").then((module) =>
        module.mlsSelfTest()
      );
      setMlsOk(result);
    } catch {
      setMlsOk(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(value: string) {
    if (!identity) return;
    const { updateDisplayName } = await import("../features/identity/identity");
    const updated = await updateDisplayName(identity, value);
    setIdentity(updated);
  }

  async function handleSendTranscript() {
    if (!doc || !selectedGroup || !identity || !transcript) return;
    const { addPlaintextMessage } = await import("../features/chat/groups");
    await addPlaintextMessage(doc, selectedGroup, identity, transcript, "transcript");
  }

  return (
    <main className="min-h-screen bg-[color:var(--page)] text-[color:var(--ink)]">
      <header className="border-b border-white/10 bg-[color:var(--panel)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/cipher/icon.svg" alt="" className="h-9 w-9" />
            <div>
              <h1 className="text-xl font-semibold leading-tight">Cipher</h1>
              <p className="text-xs text-[color:var(--muted)]">No server-held state</p>
            </div>
          </div>
          <nav className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <a className="icon-link" href={buildInfo.repositoryUrl}>
              <Github size={16} /> Star repo
            </a>
            <a className="icon-link" href={buildInfo.paypalUrl}>
              <Heart size={16} /> Support
            </a>
            <span className="version-pill">
              v{buildInfo.version} · {buildInfo.commit}
            </span>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <Panel title="Identity" icon={<KeyRound size={17} />}>
            <label className="field-label" htmlFor="displayName">
              Display name
            </label>
            <input
              id="displayName"
              className="input"
              value={identity?.displayName ?? ""}
              onChange={(event) => void handleRename(event.target.value)}
            />
            <p className="mt-2 break-all text-xs text-[color:var(--muted)]">
              {identity?.boxPublicKey.slice(0, 52)}…
            </p>
          </Panel>

          <Panel title="Rooms" icon={<Users size={17} />}>
            <div className="space-y-2">
              {groups.map((group) => (
                <button
                  className={`room-button ${
                    group.id === selectedGroupId ? "room-button-active" : ""
                  }`}
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  type="button"
                >
                  <span>{group.name}</span>
                  <small>{group.participants.length}</small>
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Group name"
                className="input min-w-0 flex-1"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
              />
              <button
                aria-label="Create room"
                className="icon-button"
                disabled={busy}
                onClick={() => void handleCreateGroup()}
                type="button"
              >
                <Plus size={18} />
              </button>
            </div>
          </Panel>

          <Panel title="Security" icon={<ShieldCheck size={17} />}>
            <StatusRow
              label="MLS engine"
              value={mlsOk === undefined ? "not checked" : mlsOk ? "ready" : "failed"}
            />
            <StatusRow label="Peers" value={String(meshStatus.connectedPeers)} />
            <StatusRow label="Local tabs" value={meshStatus.localTabs ? "on" : "off"} />
            <button
              className="button mt-2 w-full"
              disabled={busy}
              onClick={() => void handleMlsCheck()}
              type="button"
            >
              <ShieldCheck size={16} /> Check MLS
            </button>
          </Panel>
        </aside>

        <section className="min-h-[70vh] rounded-lg border border-white/10 bg-[color:var(--surface)]">
          {selectedGroup ? (
            <div className="flex h-full min-h-[70vh] flex-col">
              <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-lg font-semibold">{selectedGroup.name}</h2>
                  <p className="text-xs text-[color:var(--muted)]">
                    {selectedGroup.participants.length} participants · Yjs encrypted log
                  </p>
                </div>
                <div className="ml-auto flex gap-2">
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void handleShareRoom()}
                      title="Anyone with the link or QR joins instantly — no approval needed"
                      type="button"
                    >
                      <Share2 size={16} /> Room link
                    </button>
                    <span className="text-[10px] text-[color:var(--muted)]">
                      anyone, instant
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void handleCreateInvite()}
                      title="One-time QR/link — you approve each person before they get the key"
                      type="button"
                    >
                      <KeyRound size={16} /> Secure invite
                    </button>
                    <span className="text-[10px] text-[color:var(--muted)]">
                      you approve each
                    </span>
                  </div>
                </div>
              </div>

              <div className="message-list">
                {messages.length === 0 ? (
                  <div className="empty-state">
                    <ShieldCheck size={28} />
                    <p>Messages are encrypted before they enter the shared Yjs log.</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article
                      className={`message ${
                        message.senderId === identity?.id ? "message-own" : ""
                      }`}
                      key={message.id}
                    >
                      <div className="message-meta">
                        <span>{message.senderName}</span>
                        <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
                        {message.verified ? <Check size={13} /> : null}
                      </div>
                      <p>{message.body}</p>
                    </article>
                  ))
                )}
              </div>

              <form
                className="flex gap-2 border-t border-white/10 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                <input
                  className="input"
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write an encrypted message"
                  value={draft}
                />
                <button
                  className="button"
                  disabled={busy || !draft.trim()}
                  type="submit"
                >
                  <Send size={16} /> Send
                </button>
              </form>
            </div>
          ) : (
            <div className="grid min-h-[70vh] place-items-center p-8 text-center">
              <div className="max-w-sm">
                <h2 className="text-2xl font-semibold">Create or join a room</h2>
                <p className="mt-2 text-[color:var(--muted)]">
                  Create a room and click <strong>Share</strong> to get a link. Anyone
                  who opens it joins immediately — no setup required.
                </p>
                <button
                  className="button mx-auto mt-4"
                  disabled={busy}
                  onClick={() => void handleCreateGroup()}
                  type="button"
                >
                  <Plus size={16} /> New group
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {notice ? <NoticeBox notice={notice} /> : null}

          {roomLink ? (
            <Panel
              title="Room Link — anyone joins instantly"
              icon={<Share2 size={17} />}
            >
              <p className="text-xs text-[color:var(--muted)]">
                No approval needed. Keep it private — anyone who gets this link can read
                all messages.
              </p>
              {roomLinkQr ? (
                <img
                  alt="Room QR code — scan to join instantly"
                  className="qr mx-auto mt-2"
                  src={roomLinkQr}
                />
              ) : null}
              <CopyBox value={roomLink} />
            </Panel>
          ) : null}

          {inviteFromUrl ? (
            <Panel title="Join Invite" icon={<KeyRound size={17} />}>
              <p className="text-sm text-[color:var(--muted)]">
                {inviteFromUrl.host.displayName} invited you to{" "}
                {inviteFromUrl.groupName}.
              </p>
              {awaitingWelcome ? (
                <p className="mt-3 text-sm text-[color:var(--muted)]">
                  Join request sent — waiting for host to approve…
                  <br />
                  <span className="text-xs opacity-70">
                    (Copy the capsule below if you need to send it manually.)
                  </span>
                </p>
              ) : (
                <button
                  className="button mt-3 w-full"
                  disabled={busy}
                  onClick={() => void handleCreateJoinRequest()}
                  type="button"
                >
                  <KeyRound size={16} /> Create join request
                </button>
              )}
            </Panel>
          ) : null}

          <Panel
            title="Secure Invite — you approve each joiner"
            icon={<KeyRound size={17} />}
          >
            {/* ---- Inviter side: show invite QR ---- */}
            {inviteLink ? (
              <div className="space-y-2">
                {inviteQr ? (
                  <>
                    <p className="text-xs text-[color:var(--muted)]">
                      Show this QR to the joiner — group key is <strong>never</strong>{" "}
                      exposed until after you approve.
                    </p>
                    <img
                      alt="Secure invite QR code — show to joiner"
                      className="qr mx-auto"
                      src={inviteQr}
                    />
                  </>
                ) : null}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[color:var(--muted)]">
                    copy invite link
                  </summary>
                  <textarea className="textarea mt-1" readOnly value={inviteLink} />
                </details>
              </div>
            ) : null}

            {/* ---- Joiner side: camera scanner ---- */}
            <div className="mt-3">
              <p className="mb-2 text-xs text-[color:var(--muted)]">
                Scan the host&apos;s invite QR to join securely.
              </p>
              <button
                className="button w-full"
                onClick={() => {
                  if (scanner.scanning) {
                    scanner.stop();
                  } else {
                    void scanner.start();
                  }
                }}
                type="button"
              >
                {scanner.scanning ? (
                  <>
                    <CameraOff size={16} /> Stop scanner
                  </>
                ) : (
                  <>
                    <Camera size={16} /> Scan invite QR
                  </>
                )}
              </button>
              {scanner.scanning && (
                <video
                  ref={scanner.videoRef}
                  muted
                  playsInline
                  autoPlay
                  className="mt-2 w-full rounded-lg"
                  style={{ maxHeight: "200px", objectFit: "cover" }}
                />
              )}
              {scanner.error ? (
                <p className="mt-1 text-xs text-red-400">⚠ {scanner.error}</p>
              ) : null}
            </div>

            {/* ---- Manual fallback ---- */}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[color:var(--muted)]">
                manual capsule exchange (fallback)
              </summary>
              <textarea
                className="textarea mt-2"
                onChange={(event) => setCapsuleInput(event.target.value)}
                placeholder="Paste join request or welcome capsule"
                value={capsuleInput}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="button flex-1"
                  disabled={busy || !capsuleInput.trim()}
                  onClick={() => void handleImportCapsule()}
                  type="button"
                >
                  <KeyRound size={16} /> Open
                </button>
              </div>
            </details>

            {joinRequest ? (
              <button
                className="button mt-3 w-full"
                disabled={busy}
                onClick={() => void handleApproveJoin()}
                type="button"
              >
                <Check size={16} /> Approve join request from{" "}
                {joinRequest.requester.displayName}
              </button>
            ) : null}
            {capsuleOutput ? <CopyBox value={capsuleOutput} /> : null}
          </Panel>

          <Panel title="Local AI" icon={<Bot size={17} />}>
            <button
              className="button w-full"
              disabled={busy}
              onClick={() => void handleSummarize()}
              type="button"
            >
              <Bot size={16} /> Summarize thread
            </button>
            <label className="button mt-2 w-full cursor-pointer" htmlFor="audio">
              <Mic size={16} /> Whisper audio
            </label>
            <input
              accept="audio/*"
              className="sr-only"
              id="audio"
              onChange={(event) => void handleAudio(event.target.files?.[0])}
              type="file"
            />
            {aiResult ? (
              <div className="ai-result">
                <small>{aiResult.engine}</small>
                <p>{aiResult.summary}</p>
              </div>
            ) : null}
            {transcript && doc && selectedGroup && identity ? (
              <button
                className="button mt-2 w-full"
                onClick={() => void handleSendTranscript()}
                type="button"
              >
                <Send size={16} /> Send transcript
              </button>
            ) : null}
          </Panel>
        </aside>
      </div>
    </main>
  );
}

function Panel({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[color:var(--surface)] p-3">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[color:var(--muted)]">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 py-2 first:border-t-0">
      <span className="text-sm text-[color:var(--muted)]">{label}</span>
      <strong className="text-sm">{value}</strong>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
  return (
    <div className="mt-2">
      <textarea className="textarea" readOnly value={value} />
      <button
        className="button mt-2 w-full"
        onClick={() => void navigator.clipboard.writeText(value)}
        type="button"
      >
        <Copy size={16} /> Copy
      </button>
    </div>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  return <div className={`notice notice-${notice.tone}`}>{notice.text}</div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
