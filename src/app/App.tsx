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
  Settings,
  Share2,
  ShieldCheck,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
type ModalKind = "share" | "settings" | null;
type ShareTab = "open-link" | "invite";

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
  const [roomLink, setRoomLink] = useState("");
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
  const [awaitingWelcome, setAwaitingWelcome] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [shareTab, setShareTab] = useState<ShareTab>("open-link");

  // Auto-dismiss notice after 4 s
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Auto-scroll to newest message
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const inviterRoomsRef = useRef(
    new Map<string, { postWelcome: (c: string) => void; destroy: () => void }>()
  );
  const joinerRoomRef = useRef<{ destroy: () => void } | undefined>(undefined);
  const pendingInviteIdRef = useRef<string | undefined>(undefined);

  const onHandshakeJoinRequest = useCallback((capsule: string, inviteId: string) => {
    void (async () => {
      try {
        const { openJoinRequestCapsule } = await import("../features/invite/invites");
        const opened = await openJoinRequestCapsule(capsule);
        pendingInviteIdRef.current = inviteId;
        setJoinRequest(opened.request);
        setSelectedGroupId(opened.request.groupId);
        setNotice({
          tone: "warn",
          text: `${opened.request.requester.displayName} wants to join`
        });
      } catch {
        // Not our invite — ignore silently.
      }
    })();
  }, []);

  const onHandshakeJoinRequestRef = useRef(onHandshakeJoinRequest);
  useEffect(() => {
    onHandshakeJoinRequestRef.current = onHandshakeJoinRequest;
  }, [onHandshakeJoinRequest]);

  // QR scanner — handles both invite and room-link QRs
  const handleScannedUrl = useCallback(
    (text: string) => {
      void (async () => {
        try {
          const url = new URL(text);
          const hash = url.hash;

          if (hash.startsWith("#/join/")) {
            const { parseInviteFromHash } = await import("../features/invite/invites");
            const payload = parseInviteFromHash(hash);
            if (!payload) return;
            scanner.stop();
            setInviteFromUrl(payload);
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
                  setNotice({ tone: "good", text: "Joined! Welcome." });
                } catch (error) {
                  setNotice({ tone: "bad", text: errorMessage(error) });
                }
              })();
            });

            setNotice({
              tone: "good",
              text: "Join request sent. Waiting for approval…"
            });
          } else if (hash.startsWith("#/room/")) {
            if (!identity) return;
            scanner.stop();
            const { parseRoomLinkFromHash, joinFromRoomLink } =
              await import("../features/invite/invites");
            const payload = parseRoomLinkFromHash(hash);
            if (!payload) return;
            const joined = await joinFromRoomLink(payload, identity);
            await reloadGroups(joined.id);
            setNotice({ tone: "good", text: `Joined "${joined.name}"` });
          }
        } catch {
          setNotice({ tone: "bad", text: "QR not recognised." });
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity]
  );

  const scanner = useQRScanner({ onScan: (r) => handleScannedUrl(r.text) });

  const meshRef = useRef<{ destroy: () => void }>(undefined);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  useEffect(() => {
    const inviterRooms = inviterRoomsRef.current;
    return () => {
      for (const room of inviterRooms.values()) room.destroy();
      inviterRooms.clear();
      joinerRoomRef.current?.destroy();
      scanner.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      chat.writeParticipantToDoc(nextDoc, identityModule.toParticipant(identity));
      const mesh = new meshModule.MeshController(selectedGroup, nextDoc, setMeshStatus);

      if (cancelled) {
        mesh.destroy();
        return;
      }

      meshRef.current?.destroy();
      meshRef.current = mesh;
      setDoc(nextDoc);

      const refresh = () => {
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

      nextDoc.on("update", refresh);
      refresh();
      cleanup = () => {
        nextDoc.off("update", refresh);
        mesh.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, identity?.id]);

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

    try {
      const roomPayload = invites.parseRoomLinkFromHash();
      if (roomPayload) {
        window.history.replaceState(
          null,
          "",
          window.location.origin + window.location.pathname
        );
        const joined = await invites.joinFromRoomLink(roomPayload, activeIdentity);
        savedGroups = await storage.listGroups();
        setGroups(savedGroups);
        setSelectedGroupId(joined.id);
        setNotice({ tone: "good", text: `Joined "${joined.name}"` });
        return;
      }
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    }

    setGroups(savedGroups);
    setSelectedGroupId(savedGroups[0]?.id);

    try {
      setInviteFromUrl(invites.parseInviteFromHash());
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    }

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
    const savedGroups = await import("../features/storage/db").then((s) =>
      s.listGroups()
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
      setNotice({ tone: "good", text: "Room created." });
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
      void startInviterRoom(result.invite.id);
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

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
  }

  async function handleCreateJoinRequest() {
    if (!identity || !inviteFromUrl) return;
    setBusy(true);
    try {
      const { createJoinRequestCapsule } = await import("../features/invite/invites");
      const capsule = await createJoinRequestCapsule(inviteFromUrl, identity);
      setCapsuleOutput(capsule);

      const { HandshakeRoom } = await import("../features/invite/handshake");
      joinerRoomRef.current?.destroy();
      const room = new HandshakeRoom(inviteFromUrl.inviteId);
      joinerRoomRef.current = room;
      room.postJoinRequest(capsule);
      setAwaitingWelcome(true);
      setInviteFromUrl(undefined);

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
            setNotice({ tone: "good", text: "Joined! Welcome." });
          } catch (error) {
            setNotice({ tone: "bad", text: errorMessage(error) });
          }
        })();
      });

      setNotice({ tone: "good", text: "Join request sent. Waiting for approval…" });
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
      setNotice({ tone: "good", text: "Group joined." });
    } catch {
      try {
        const { openJoinRequestCapsule } = await import("../features/invite/invites");
        const opened = await openJoinRequestCapsule(capsuleInput);
        setJoinRequest(opened.request);
        setSelectedGroupId(opened.request.groupId);
        setNotice({
          tone: "warn",
          text: `${opened.request.requester.displayName} wants to join.`
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
      const sourceInviteId = pendingInviteIdRef.current;
      if (sourceInviteId) {
        inviterRoomsRef.current.get(sourceInviteId)?.postWelcome(welcome.capsule);
        pendingInviteIdRef.current = undefined;
      }
      await reloadGroups(freshGroup.id);
      setJoinRequest(undefined);
      setNotice({ tone: "good", text: "Approved — they're in." });
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
      const result = await import("../features/mls/mls").then((m) => m.mlsSelfTest());
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

  // Open share modal, auto-generate content for the chosen tab
  async function openShare(tab: ShareTab) {
    setShareTab(tab);
    setModal("share");
    if (tab === "open-link" && !roomLink) await handleShareRoom();
    if (tab === "invite" && !inviteLink) await handleCreateInvite();
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[color:var(--page)] text-[color:var(--ink)]">
      {/* ── Toast ─────────────────────────────────────── */}
      {notice && (
        <div
          className={`notice notice-${notice.tone} fixed right-4 top-4 z-50 flex max-w-xs items-start gap-2 shadow-xl`}
        >
          <span className="flex-1 text-sm">{notice.text}</span>
          <button
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={() => setNotice(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Camera overlay ───────────────────────────── */}
      {scanner.scanning && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black">
          <p className="text-lg font-semibold text-white">Scan QR code</p>
          <video
            ref={scanner.videoRef}
            autoPlay
            muted
            playsInline
            className="w-full max-w-xs rounded-2xl"
            style={{ maxHeight: "60vh", objectFit: "cover" }}
          />
          {scanner.error && <p className="text-sm text-red-400">⚠ {scanner.error}</p>}
          <button className="button" onClick={scanner.stop}>
            <CameraOff size={16} /> Cancel
          </button>
        </div>
      )}

      {/* ── Invite-from-URL modal ─────────────────────── */}
      {inviteFromUrl && !awaitingWelcome && (
        <Backdrop onClose={() => setInviteFromUrl(undefined)}>
          <Sheet>
            <SheetHeader
              title="You've been invited"
              onClose={() => setInviteFromUrl(undefined)}
            />
            <p className="text-sm text-[color:var(--muted)]">
              <strong className="text-[color:var(--ink)]">
                {inviteFromUrl.host.displayName}
              </strong>{" "}
              invited you to join{" "}
              <strong className="text-[color:var(--ink)]">
                {inviteFromUrl.groupName}
              </strong>
              .
            </p>
            <button
              className="button w-full"
              disabled={busy}
              onClick={() => void handleCreateJoinRequest()}
            >
              <KeyRound size={15} /> Send join request
            </button>
          </Sheet>
        </Backdrop>
      )}

      {/* ── Share modal ───────────────────────────────── */}
      {modal === "share" && selectedGroup && (
        <Backdrop onClose={() => setModal(null)}>
          <Sheet>
            <SheetHeader
              title={`Add people · ${selectedGroup.name}`}
              onClose={() => setModal(null)}
            />

            {/* Tab bar */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
              {(["open-link", "invite"] as ShareTab[]).map((t) => (
                <button
                  key={t}
                  className={`rounded-lg py-2 text-sm transition-colors ${
                    shareTab === t ? "bg-white/10 font-semibold" : "opacity-50"
                  }`}
                  onClick={() => {
                    setShareTab(t);
                    if (t === "open-link" && !roomLink) void handleShareRoom();
                    if (t === "invite" && !inviteLink) void handleCreateInvite();
                  }}
                >
                  {t === "open-link" ? "Open link" : "Invite"}
                </button>
              ))}
            </div>

            {shareTab === "open-link" && (
              <div className="space-y-3">
                <p className="text-xs text-[color:var(--muted)]">
                  Anyone who has this link joins instantly. Treat it like a key — only
                  share with people you already trust.
                </p>
                {roomLinkQr ? (
                  <img alt="Room QR" className="qr mx-auto" src={roomLinkQr} />
                ) : (
                  <p className="py-6 text-center text-sm text-[color:var(--muted)]">
                    Generating…
                  </p>
                )}
                {roomLink && (
                  <button
                    className="button w-full"
                    onClick={() => void navigator.clipboard.writeText(roomLink)}
                  >
                    <Copy size={15} /> Copy link
                  </button>
                )}
              </div>
            )}

            {shareTab === "invite" && (
              <div className="space-y-3">
                {joinRequest ? (
                  <>
                    <p className="text-sm">
                      <strong>{joinRequest.requester.displayName}</strong> wants to
                      join.
                    </p>
                    <button
                      className="button w-full"
                      disabled={busy}
                      onClick={() => void handleApproveJoin()}
                    >
                      <Check size={15} /> Approve
                    </button>
                  </>
                ) : awaitingWelcome ? (
                  <p className="py-4 text-center text-sm text-[color:var(--muted)]">
                    Join request sent — waiting for host to approve…
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-[color:var(--muted)]">
                      Show this QR to the person you want to add. They scan it and send
                      a request; you approve and they&apos;re in.
                    </p>
                    {inviteQr ? (
                      <img alt="Invite QR" className="qr mx-auto" src={inviteQr} />
                    ) : (
                      <p className="py-6 text-center text-sm text-[color:var(--muted)]">
                        Generating…
                      </p>
                    )}
                    {inviteLink && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-[color:var(--muted)]">
                          Copy invite link instead
                        </summary>
                        <div className="mt-2 flex gap-2">
                          <textarea
                            className="textarea text-xs"
                            readOnly
                            value={inviteLink}
                          />
                        </div>
                        <button
                          className="button mt-2 w-full text-xs"
                          onClick={() => void navigator.clipboard.writeText(inviteLink)}
                        >
                          <Copy size={13} /> Copy
                        </button>
                      </details>
                    )}
                    <div className="border-t border-white/10 pt-3">
                      <p className="mb-2 text-xs text-[color:var(--muted)]">
                        Joining via a link someone shared with you?
                      </p>
                      <button
                        className="button w-full"
                        onClick={() => {
                          setModal(null);
                          void scanner.start();
                        }}
                      >
                        <Camera size={15} /> Scan their QR
                      </button>
                    </div>
                    {/* Manual capsule fallback */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-[color:var(--muted)]">
                        Manual capsule exchange (advanced)
                      </summary>
                      <textarea
                        className="textarea mt-2 text-xs"
                        onChange={(e) => setCapsuleInput(e.target.value)}
                        placeholder="Paste join request or welcome capsule"
                        value={capsuleInput}
                      />
                      <button
                        className="button mt-2 w-full text-xs"
                        disabled={busy || !capsuleInput.trim()}
                        onClick={() => void handleImportCapsule()}
                      >
                        <KeyRound size={13} /> Open capsule
                      </button>
                      {capsuleOutput && (
                        <button
                          className="button mt-2 w-full text-xs"
                          onClick={() =>
                            void navigator.clipboard.writeText(capsuleOutput)
                          }
                        >
                          <Copy size={13} /> Copy capsule
                        </button>
                      )}
                    </details>
                  </>
                )}
              </div>
            )}

            <button className="button w-full" onClick={() => setModal(null)}>
              Done
            </button>
          </Sheet>
        </Backdrop>
      )}

      {/* ── Settings modal ────────────────────────────── */}
      {modal === "settings" && (
        <Backdrop onClose={() => setModal(null)}>
          <Sheet className="max-h-[85vh] overflow-y-auto">
            <SheetHeader title="Settings" onClose={() => setModal(null)} />

            {/* Identity */}
            <div>
              <label className="field-label" htmlFor="displayName">
                Display name
              </label>
              <input
                id="displayName"
                className="input"
                value={identity?.displayName ?? ""}
                onChange={(e) => void handleRename(e.target.value)}
              />
              <p className="mt-1 break-all text-xs text-[color:var(--muted)]">
                {identity?.boxPublicKey.slice(0, 52)}…
              </p>
            </div>

            {/* Security */}
            <div className="border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Security
              </p>
              <StatusRow
                label="MLS engine"
                value={mlsOk === undefined ? "not checked" : mlsOk ? "ready" : "failed"}
              />
              <StatusRow label="Peers" value={String(meshStatus.connectedPeers)} />
              <StatusRow
                label="Local tabs"
                value={meshStatus.localTabs ? "on" : "off"}
              />
              <button
                className="button mt-2 w-full"
                disabled={busy}
                onClick={() => void handleMlsCheck()}
              >
                <ShieldCheck size={15} /> Check MLS
              </button>
            </div>

            {/* Local AI */}
            <div className="border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Local AI
              </p>
              <button
                className="button w-full"
                disabled={busy}
                onClick={() => void handleSummarize()}
              >
                <Bot size={15} /> Summarize thread
              </button>
              <label className="button mt-2 w-full cursor-pointer" htmlFor="audio">
                <Mic size={15} /> Whisper audio
              </label>
              <input
                accept="audio/*"
                className="sr-only"
                id="audio"
                onChange={(e) => void handleAudio(e.target.files?.[0])}
                type="file"
              />
              {aiResult && (
                <div className="ai-result">
                  <small>{aiResult.engine}</small>
                  <p>{aiResult.summary}</p>
                </div>
              )}
              {transcript && doc && selectedGroup && identity && (
                <button
                  className="button mt-2 w-full"
                  onClick={() => void handleSendTranscript()}
                >
                  <Send size={15} /> Send transcript
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-white/10 pt-4 text-xs text-[color:var(--muted)]">
              <a className="icon-link" href={buildInfo.repositoryUrl}>
                <Github size={13} /> GitHub
              </a>
              <a className="icon-link" href={buildInfo.paypalUrl}>
                <Heart size={13} /> Support
              </a>
              <span className="ml-auto">
                v{buildInfo.version} · {buildInfo.commit}
              </span>
            </div>

            <button className="button w-full" onClick={() => setModal(null)}>
              Done
            </button>
          </Sheet>
        </Backdrop>
      )}

      {/* ── Main layout ───────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/10">
          {/* App bar */}
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
            <img alt="" className="h-7 w-7" src="/cipher/icon.svg" />
            <span className="flex-1 text-sm font-semibold">Cipher</span>
            <button
              className="p-1 opacity-50 hover:opacity-100"
              onClick={() => void scanner.start()}
              title="Scan QR"
            >
              <Camera size={16} />
            </button>
            <button
              className="p-1 opacity-50 hover:opacity-100"
              onClick={() => setModal("settings")}
              title="Settings"
            >
              <Settings size={16} />
            </button>
          </div>

          {/* Room list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {groups.map((group) => (
              <button
                className={`room-button ${group.id === selectedGroupId ? "room-button-active" : ""}`}
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                type="button"
              >
                <span className="flex-1 truncate text-left text-sm">{group.name}</span>
                <small className="shrink-0">{group.participants.length}</small>
              </button>
            ))}
          </div>

          {/* New room */}
          <div className="flex gap-1 border-t border-white/10 p-2">
            <input
              aria-label="Group name"
              className="input min-w-0 flex-1 text-sm"
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreateGroup()}
              placeholder="New room…"
              value={newGroupName}
            />
            <button
              aria-label="Create room"
              className="icon-button shrink-0"
              disabled={busy}
              onClick={() => void handleCreateGroup()}
              type="button"
            >
              <Plus size={16} />
            </button>
          </div>
        </aside>

        {/* Chat area */}
        <main className="flex min-w-0 flex-1 flex-col">
          {selectedGroup ? (
            <>
              {/* Room header */}
              <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{selectedGroup.name}</h2>
                  <p className="text-xs text-[color:var(--muted)]">
                    {selectedGroup.participants.length} participants
                    {meshStatus.connectedPeers > 0 &&
                      ` · ${meshStatus.connectedPeers} online`}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void openShare("open-link")}
                >
                  <Share2 size={15} /> Share
                </button>
              </header>

              {/* Join request banner */}
              {joinRequest && (
                <div className="mx-4 mt-3 flex shrink-0 items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <p className="flex-1 text-sm">
                    <strong>{joinRequest.requester.displayName}</strong> wants to join
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void handleApproveJoin()}
                  >
                    <Check size={14} /> Approve
                  </button>
                </div>
              )}

              {/* Awaiting welcome banner */}
              {awaitingWelcome && (
                <div className="mx-4 mt-3 shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[color:var(--muted)]">
                  Join request sent — waiting for host to approve…
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-[color:var(--muted)]">
                    No messages yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg) => {
                      const isOwn = msg.senderId === identity?.id;
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[72%] rounded-2xl px-4 py-2.5 ${
                              isOwn
                                ? "rounded-br-md bg-[color:var(--accent)] text-[#14211b]"
                                : "rounded-bl-md bg-white/10"
                            }`}
                          >
                            {!isOwn && (
                              <p className="mb-0.5 text-[11px] font-semibold opacity-60">
                                {msg.senderName}
                              </p>
                            )}
                            <p className="text-sm leading-relaxed overflow-wrap-anywhere whitespace-pre-wrap">
                              {msg.body}
                            </p>
                            <p
                              className={`mt-0.5 text-[10px] ${isOwn ? "text-right text-black/40" : "text-[color:var(--muted)]"}`}
                            >
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                              {msg.verified && " ✓"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Message input */}
              <form
                className="flex shrink-0 gap-2 border-t border-white/10 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <input
                  className="input flex-1"
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write an encrypted message"
                  value={draft}
                />
                <button
                  className="icon-button shrink-0"
                  disabled={busy || !draft.trim()}
                  type="submit"
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <img alt="" className="h-16 w-16 opacity-20" src="/cipher/icon.svg" />
              <div>
                <h2 className="text-lg font-semibold">No room selected</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">
                  Pick a room on the left, or create one.
                </p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => void handleCreateGroup()}
              >
                <Plus size={15} /> New room
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Small layout helpers ──────────────────────────────────────────────────────

function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function Sheet({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full max-w-sm space-y-4 rounded-2xl bg-[color:var(--panel)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      <button className="opacity-50 hover:opacity-100" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
