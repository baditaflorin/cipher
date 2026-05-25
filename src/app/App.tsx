import {
  ArrowLeft,
  Bot,
  Camera,
  CameraOff,
  Check,
  Copy,
  Github,
  Heart,
  KeyRound,
  Lock,
  Mic,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Trash2,
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
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [appQrCode, setAppQrCode] = useState("");
  const [showCryptoPopover, setShowCryptoPopover] = useState(false);

  // Auto-dismiss notice after 4 s
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // Generate app QR once when settings modal first opens
  useEffect(() => {
    if (modal !== "settings" || appQrCode) return;
    void import("qrcode")
      .then((QRCode) =>
        QRCode.default.toDataURL("https://baditaflorin.github.io/cipher/", {
          margin: 1,
          width: 200,
          color: { dark: "#14211b", light: "#f6f2e8" }
        })
      )
      .then(setAppQrCode);
  }, [modal, appQrCode]);

  // Close crypto popover on room switch
  useEffect(() => {
    setShowCryptoPopover(false);
  }, [selectedGroupId]);

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
        void (async () => {
          // Check for a valid owner-signed delete command.
          // If found, delete any straggler messages still in the array
          // (handles out-of-order CRDT delivery). deleteMessagesBefore is
          // idempotent — no-op when the array is already empty.
          const clearTs = await chat.getVerifiedClearTimestamp(nextDoc, mergedGroup);
          if (clearTs) chat.deleteMessagesBefore(nextDoc, clearTs);

          // Decrypt whatever remains in the array after the delete.
          const decrypted = await chat.decryptMessages(
            mergedGroup,
            chat.getEncryptedMessages(nextDoc)
          );
          setMessages(decrypted);
        })();
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
    const isFirstLaunch = !(await storage.getActiveIdentity());
    const activeIdentity = await identityModule.getOrCreateIdentity();
    let savedGroups = await storage.listGroups();
    setIdentity(activeIdentity);
    if (isFirstLaunch) setShowOnboarding(true);

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

  async function handleLeaveGroup(groupId: string) {
    const isOwner = groups.find((g) => g.id === groupId)?.ownerId === identity?.id;
    const msg = isOwner
      ? "Remove this room from your device?\n\nOther members who already have it will keep access — there is no central server to delete it from."
      : "Leave this room?\n\nThis removes it from your device. The room still exists for other members.";
    if (!confirm(msg)) return;
    meshRef.current?.destroy();
    meshRef.current = undefined;
    const { deleteGroup } = await import("../features/storage/db");
    await deleteGroup(groupId);
    if (selectedGroupId === groupId) setSelectedGroupId(undefined);
    await reloadGroups();
    setNotice({ tone: "good", text: "Room removed from your device." });
  }

  async function handleResetEverything() {
    if (
      !confirm(
        "Reset everything?\n\nThis permanently deletes your identity, all rooms, and all local data from this browser. You will be treated as a brand new user on reload."
      )
    )
      return;
    meshRef.current?.destroy();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("cipher-v1");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    window.location.reload();
  }

  async function handleClearHistory() {
    if (!doc || !selectedGroup || !identity) return;
    if (identity.id !== selectedGroup.ownerId) {
      setNotice({ tone: "bad", text: "Only the room owner can clear history." });
      return;
    }
    if (
      !confirm(
        "Delete all messages?\n\nThis permanently removes them from the room for every connected peer and from future snapshots — people who join later will not see them either. This cannot be undone."
      )
    )
      return;
    setBusy(true);
    try {
      const { postClearCommand } = await import("../features/chat/groups");
      await postClearCommand(doc, selectedGroup, identity);
      setNotice({ tone: "good", text: "Messages deleted for all peers." });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  // Open share modal, auto-generate content for the chosen tab
  async function openShare(tab: ShareTab) {
    setShareTab(tab);
    setModal("share");
    if (tab === "open-link" && !roomLink) await handleShareRoom();
    if (tab === "invite" && !inviteLink) await handleCreateInvite();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[color:var(--page)] text-[color:var(--ink)]">
      {/* ── Onboarding (first launch only) ───────────── */}
      {showOnboarding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[color:var(--page)] p-6"
          data-testid="onboarding"
        >
          <div className="flex w-full max-w-sm flex-col gap-5">
            {/* Brand */}
            <div className="flex flex-col items-center gap-3 text-center">
              <img alt="" className="h-14 w-14" src="/cipher/icon.svg" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Cipher</h1>
                <p className="mt-1 text-sm text-[color:var(--muted)]">
                  Private group chat · No servers · No accounts
                </p>
              </div>
            </div>

            {/* How it works */}
            <div className="space-y-2">
              <OnboardBullet
                icon={<KeyRound size={15} />}
                title="Keys generated here, stored here"
                detail="An Ed25519 signing key and X25519 encryption key were created in this browser using a cryptographic random number generator. They never leave your device."
              />
              <OnboardBullet
                icon={<Lock size={15} />}
                title="Messages encrypted before they leave"
                detail="XSalsa20-Poly1305 (libsodium) encrypts every message on your device. No server — and no one without the room key — can read them."
              />
              <OnboardBullet
                icon={<Share2 size={15} />}
                title="Peer-to-peer, no middleman"
                detail="Rooms sync directly between browsers over WebRTC using a CRDT (Yjs). There is no central server storing your conversations."
              />
            </div>

            {/* Display name */}
            <div>
              <label className="field-label" htmlFor="onboardName">
                Your display name
              </label>
              <input
                autoFocus
                className="input"
                id="onboardName"
                onChange={(e) => void handleRename(e.target.value)}
                placeholder="Choose a name others will see"
                value={identity?.displayName ?? ""}
              />
            </div>

            {/* CTA */}
            <button
              className="flex items-center justify-center gap-2 rounded-xl bg-[color:var(--accent)] py-3 text-sm font-bold text-[#14211b] transition-opacity hover:opacity-90 active:opacity-80"
              onClick={() => setShowOnboarding(false)}
            >
              Get started
            </button>

            <p className="text-center text-[11px] text-[color:var(--muted)]">
              Your keys are saved in this browser&apos;s IndexedDB — local to this
              device.
            </p>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────── */}
      {notice && (
        <div
          className={`notice notice-${notice.tone} fixed right-4 top-4 z-50 flex max-w-[280px] items-start gap-2 shadow-2xl backdrop-blur-sm`}
        >
          <span className="flex-1 text-sm leading-snug">{notice.text}</span>
          <button
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            onClick={() => setNotice(undefined)}
          >
            <X size={13} />
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
            <div className="border-t border-white/10 pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Security
              </p>
              <InfoRow
                label="End-to-end encryption"
                value={
                  mlsOk === undefined
                    ? "tap to verify"
                    : mlsOk
                      ? "✓ working"
                      : "✗ failed"
                }
                detail="Messages are encrypted with MLS before leaving your device. The server never sees plaintext."
              />
              <InfoRow
                label="Other devices online"
                value={
                  meshStatus.connectedPeers === 0
                    ? "none right now"
                    : `${meshStatus.connectedPeers} connected`
                }
                detail="People in the same room who are online and syncing live over WebRTC."
              />
              <InfoRow
                label="This browser"
                value={meshStatus.localTabs ? "multiple tabs open" : "single tab"}
                detail="If you open the same room in multiple tabs, they share local state automatically."
              />
              <button
                className="button w-full"
                disabled={busy}
                onClick={() => void handleMlsCheck()}
              >
                <ShieldCheck size={15} /> Verify encryption
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

            {/* Share the app */}
            <div className="border-t border-white/10 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
                Share this app
              </p>
              {appQrCode ? (
                <img alt="App QR code" className="qr mx-auto" src={appQrCode} />
              ) : (
                <div className="py-4 text-center text-xs text-[color:var(--muted)]">
                  Generating…
                </div>
              )}
              <p className="mt-2 text-center text-[11px] text-[color:var(--muted)]">
                baditaflorin.github.io/cipher
              </p>
              <button
                className="button mt-2 w-full text-xs"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    "https://baditaflorin.github.io/cipher/"
                  )
                }
              >
                <Copy size={13} /> Copy link
              </button>
            </div>

            {/* Reset */}
            <div className="border-t border-white/10 pt-4">
              <button
                className="w-full rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-left transition-colors hover:bg-red-500/14"
                onClick={() => void handleResetEverything()}
                type="button"
              >
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <Trash2 size={14} />
                  Reset everything
                </div>
                <p className="mt-0.5 text-xs text-red-400/60">
                  Deletes your identity and all rooms. Use to test as a new user.
                </p>
              </button>
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
        {/* Sidebar
            Mobile  : full-width when no room selected, hidden when chatting
            Desktop : always visible at 220 px */}
        <aside
          className={`flex-col border-r border-white/10 ${
            selectedGroupId
              ? "hidden md:flex md:w-[220px] md:shrink-0"
              : "flex w-full md:w-[220px] md:shrink-0"
          }`}
        >
          {/* App bar */}
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
            <img alt="" className="h-7 w-7" src="/cipher/icon.svg" />
            <span className="flex-1 text-sm font-semibold">Cipher</span>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-lg opacity-50 hover:opacity-100 md:h-auto md:w-auto md:p-1"
              onClick={() => void scanner.start()}
              title="Scan QR"
            >
              <Camera size={18} />
            </button>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-lg opacity-50 hover:opacity-100 md:h-auto md:w-auto md:p-1"
              onClick={() => setModal("settings")}
              title="Settings"
            >
              <Settings size={18} />
            </button>
          </div>

          {/* Room list */}
          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
            {groups.map((group) => {
              const color = roomColor(group.name);
              const initial = group.name.trim()[0]?.toUpperCase() ?? "?";
              return (
                <div
                  className={`group/room room-button ${group.id === selectedGroupId ? "room-button-active" : ""}`}
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedGroupId(group.id)}
                >
                  {/* Colored avatar */}
                  <div
                    className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: color, color: "#14211b" }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm leading-tight">{group.name}</p>
                    <p className="text-[10px] text-[color:var(--muted)]">
                      {group.participants.length}{" "}
                      {group.participants.length === 1 ? "member" : "members"}
                    </p>
                  </div>
                  <button
                    className="ml-1 hidden group-hover/room:flex shrink-0 items-center justify-center rounded p-0.5 opacity-30 hover:opacity-100 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleLeaveGroup(group.id);
                    }}
                    title={
                      group.ownerId === identity?.id ? "Remove room" : "Leave room"
                    }
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* New room */}
          <div className="flex gap-1.5 border-t border-white/10 p-2">
            <input
              aria-label="Group name"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[color:var(--ink)] outline-none placeholder:text-[color:var(--muted)] focus:border-white/20"
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

        {/* Chat area
            Mobile  : full-width when room selected, hidden when browsing list
            Desktop : always visible, takes remaining space */}
        <main
          className={`min-w-0 flex-col ${
            selectedGroupId ? "flex flex-1" : "hidden md:flex md:flex-1"
          }`}
        >
          {selectedGroup ? (
            <>
              {/* Room header */}
              <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-3 md:gap-3 md:px-5">
                {/* Back to room list — mobile only */}
                <button
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-60 hover:opacity-100 md:hidden"
                  onClick={() => setSelectedGroupId(undefined)}
                  title="Back to rooms"
                  type="button"
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{selectedGroup.name}</h2>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-[color:var(--muted)]">
                      {selectedGroup.participants.length}{" "}
                      {selectedGroup.participants.length === 1
                        ? "participant"
                        : "participants"}
                      {meshStatus.connectedPeers > 0 &&
                        ` · ${meshStatus.connectedPeers} online`}
                    </p>
                    {/* Crypto info badge */}
                    <div className="relative">
                      <button
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-[color:var(--muted)] transition-colors hover:border-[color:var(--accent)]/40 hover:text-[color:var(--accent)]"
                        onClick={() => setShowCryptoPopover((v) => !v)}
                        title="View encryption details"
                        type="button"
                      >
                        <ShieldCheck size={10} />
                        E2E
                      </button>
                      {showCryptoPopover && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowCryptoPopover(false)}
                          />
                          <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border border-white/10 bg-[color:var(--panel)] p-4 shadow-2xl">
                            <p className="mb-3 text-xs font-semibold text-[color:var(--accent)]">
                              Encryption stack
                            </p>
                            <div className="space-y-2">
                              {[
                                ["Messages", "XSalsa20-Poly1305"],
                                ["Key exchange", "X25519 ECDH"],
                                ["Signatures", "Ed25519"],
                                ["Library", "libsodium (WASM)"],
                                ["Sync", "WebRTC · Yjs CRDT"]
                              ].map(([label, value]) => (
                                <div
                                  key={label}
                                  className="flex items-baseline justify-between gap-2"
                                >
                                  <span className="text-xs text-[color:var(--muted)]">
                                    {label}
                                  </span>
                                  <span className="font-mono text-[10px] text-[color:var(--ink)]">
                                    {value}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-3 text-[10px] leading-relaxed text-[color:var(--muted)]">
                              Keys are generated and stored in your browser only. No
                              server ever sees your messages.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  className="flex items-center gap-1.5 rounded-xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 px-2.5 py-1.5 text-sm font-semibold text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)]/18 disabled:opacity-50 md:px-3"
                  disabled={busy}
                  onClick={() => void openShare("open-link")}
                >
                  <Share2 size={14} />
                  <span className="hidden sm:inline">Share</span>
                </button>
                {/* Room options menu */}
                <div className="relative">
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 opacity-60 hover:opacity-100"
                    onClick={() => setShowRoomMenu((v) => !v)}
                    title="Room options"
                    type="button"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {showRoomMenu && (
                    <>
                      {/* Backdrop to close on outside click */}
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowRoomMenu(false)}
                      />
                      <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-white/10 bg-[color:var(--panel)] shadow-2xl">
                        {/* Clear history — owner only (cryptographically enforced) */}
                        {identity?.id === selectedGroup.ownerId && (
                          <>
                            <button
                              className="w-full px-4 py-3 text-left text-sm hover:bg-white/5"
                              onClick={() => {
                                setShowRoomMenu(false);
                                void handleClearHistory();
                              }}
                              type="button"
                            >
                              Delete message history
                              <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                                Permanently removes messages for all peers
                              </p>
                            </button>
                            <div className="border-t border-white/10" />
                          </>
                        )}
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-white/5"
                          onClick={() => {
                            setShowRoomMenu(false);
                            void handleLeaveGroup(selectedGroup.id);
                          }}
                          type="button"
                        >
                          {selectedGroup.ownerId === identity?.id
                            ? "Remove from my device"
                            : "Leave room"}
                          <p className="mt-0.5 text-xs text-red-400/60">
                            Removes it from your device only
                          </p>
                        </button>
                      </div>
                    </>
                  )}
                </div>
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
                <div className="mx-auto max-w-2xl">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                      <p className="text-2xl">🔐</p>
                      <p className="text-sm font-medium text-[color:var(--muted)]">
                        No messages yet
                      </p>
                      <p className="text-xs text-[color:var(--muted)] opacity-60">
                        Messages are encrypted on your device before sending.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {messages.map((msg, index) => {
                        const isOwn = msg.senderId === identity?.id;
                        const prevMsg = index > 0 ? messages[index - 1] : null;
                        const isGrouped =
                          !!prevMsg && prevMsg.senderId === msg.senderId;
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isOwn ? "justify-end" : "justify-start"} ${
                              index === 0 ? "mt-0" : isGrouped ? "mt-0.5" : "mt-3"
                            }`}
                          >
                            <div
                              className={`max-w-[72%] rounded-2xl px-4 py-2.5 ${
                                isOwn
                                  ? "rounded-br-md bg-[color:var(--accent)] text-[#14211b]"
                                  : "rounded-bl-md bg-white/10"
                              }`}
                            >
                              {!isOwn && !isGrouped && (
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
              </div>

              {/* Message input */}
              <form
                className="shrink-0 border-t border-white/10 px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <div className="mx-auto flex max-w-2xl items-center gap-2">
                  <input
                    className="flex-1 min-w-0 rounded-full border border-white/15 bg-white/6 px-4 py-2 text-sm outline-none placeholder:text-[color:var(--muted)] focus:border-white/30"
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write an encrypted message"
                    value={draft}
                  />
                  <button
                    aria-label="Send"
                    className="icon-button shrink-0"
                    disabled={busy || !draft.trim()}
                    type="submit"
                  >
                    <Send size={15} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/5 ring-1 ring-white/8">
                <img alt="" className="h-10 w-10 opacity-30" src="/cipher/icon.svg" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Private by default</h2>
                <p className="mt-1.5 max-w-[260px] text-sm text-[color:var(--muted)] leading-relaxed">
                  All messages are end-to-end encrypted. Select a room or create a new
                  one to start chatting.
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

function OnboardBullet({
  icon,
  title,
  detail
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-white/4 p-3">
      <div className="mt-0.5 shrink-0 text-[color:var(--accent)]">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--muted)]">
          {detail}
        </p>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-white/4 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="shrink-0 text-xs text-[color:var(--muted)]">{value}</span>
      </div>
      <p className="mt-0.5 text-xs text-[color:var(--muted)] leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// ── Room avatar ───────────────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  "#7dd7c7",
  "#f2c36b",
  "#f4877c",
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#fb923c",
  "#e879f9"
];

function roomColor(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
