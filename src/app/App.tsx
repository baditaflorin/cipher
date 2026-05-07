import {
  Bot,
  Check,
  Copy,
  Github,
  Heart,
  KeyRound,
  Link,
  Mic,
  Plus,
  RadioTower,
  Send,
  ShieldCheck,
  Users
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [signalInput, setSignalInput] = useState("");
  const [signalOutput, setSignalOutput] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteQr, setInviteQr] = useState("");
  const [joinRequest, setJoinRequest] = useState<JoinRequestPayload>();
  const [inviteFromUrl, setInviteFromUrl] = useState<InvitePayload>();
  const [notice, setNotice] = useState<Notice>();
  const [aiResult, setAiResult] = useState<SummaryResult>();
  const [transcript, setTranscript] = useState("");
  const [meshStatus, setMeshStatus] = useState<AwarenessStatus>({
    connectedPeers: 0,
    localTabs: 0
  });
  const [mlsOk, setMlsOk] = useState<boolean>();
  const [busy, setBusy] = useState(false);

  const meshRef = useRef<{
    destroy: () => void;
    createOffer: () => Promise<string>;
    acceptSignal: (value: string) => Promise<string | undefined>;
  }>(undefined);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId),
    [groups, selectedGroupId]
  );
  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (!selectedGroup || !identity) return;
    let cleanup = () => {};
    let cancelled = false;

    void (async () => {
      const [Yjs, chat, meshModule, storage] = await Promise.all([
        import("yjs"),
        import("../features/chat/groups"),
        import("../features/mesh/mesh"),
        import("../features/storage/db")
      ]);
      const nextDoc = chat.createDocFromGroup(selectedGroup);
      const mesh = new meshModule.MeshController(
        selectedGroup,
        identity,
        (update) => Yjs.applyUpdate(nextDoc, chat.decodeYUpdate(update), "remote"),
        setMeshStatus
      );

      if (cancelled) {
        mesh.destroy();
        return;
      }

      meshRef.current?.destroy();
      meshRef.current = mesh;
      setDoc(nextDoc);

      const refresh = () => {
        void chat
          .decryptMessages(selectedGroup, chat.getEncryptedMessages(nextDoc))
          .then(setMessages);
        const nextGroup = { ...selectedGroup, yState: chat.encodeDocState(nextDoc) };
        void storage.saveGroup(nextGroup);
        setGroups((items) =>
          items.map((item) => (item.id === nextGroup.id ? nextGroup : item))
        );
      };

      const handleUpdate = (update: Uint8Array, origin: unknown) => {
        refresh();
        if (origin !== "remote" && origin !== "storage") {
          void mesh.broadcastYUpdate(chat.encodeYUpdate(update));
        }
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

  async function boot() {
    const [identityModule, storage, invites] = await Promise.all([
      import("../features/identity/identity"),
      import("../features/storage/db"),
      import("../features/invite/invites")
    ]);
    const activeIdentity = await identityModule.getOrCreateIdentity();
    const savedGroups = await storage.listGroups();
    setIdentity(activeIdentity);
    setGroups(savedGroups);
    setSelectedGroupId(savedGroups[0]?.id);
    try {
      setInviteFromUrl(invites.parseInviteFromHash());
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
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
      const invite = await createInvite(selectedGroup, identity);
      setInviteLink(invite.link);
      setInviteQr(invite.qrDataUrl);
      setNotice({ tone: "good", text: "One-time invite link created." });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJoinRequest() {
    if (!identity || !inviteFromUrl) return;
    setBusy(true);
    try {
      const { createJoinRequestCapsule } = await import("../features/invite/invites");
      setCapsuleOutput(await createJoinRequestCapsule(inviteFromUrl, identity));
      setNotice({
        tone: "good",
        text: "Join request capsule encrypted to the inviter pre-key."
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
      await reloadGroups(freshGroup.id);
      setJoinRequest(undefined);
      setNotice({ tone: "good", text: "Welcome capsule created for the joiner." });
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateOffer() {
    setBusy(true);
    try {
      setSignalOutput((await meshRef.current?.createOffer()) ?? "");
    } catch (error) {
      setNotice({ tone: "bad", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSignal() {
    setBusy(true);
    try {
      const answer = await meshRef.current?.acceptSignal(signalInput);
      if (answer) setSignalOutput(answer);
      setSignalInput("");
      setNotice({ tone: "good", text: "Signal capsule accepted." });
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
                <button
                  className="button ml-auto"
                  disabled={busy}
                  onClick={() => void handleCreateInvite()}
                  type="button"
                >
                  <Link size={16} /> Invite
                </button>
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
                  Identity keys stay in IndexedDB. Group state is exchanged only by
                  capsules you copy between browsers.
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

          {inviteFromUrl ? (
            <Panel title="Join Invite" icon={<KeyRound size={17} />}>
              <p className="text-sm text-[color:var(--muted)]">
                {inviteFromUrl.host.displayName} invited you to{" "}
                {inviteFromUrl.groupName}.
              </p>
              <button
                className="button mt-3 w-full"
                disabled={busy}
                onClick={() => void handleCreateJoinRequest()}
                type="button"
              >
                <KeyRound size={16} /> Create join request
              </button>
            </Panel>
          ) : null}

          <Panel title="Invite Capsules" icon={<Link size={17} />}>
            {inviteLink ? (
              <div className="space-y-2">
                <textarea className="textarea" readOnly value={inviteLink} />
                {inviteQr ? (
                  <img alt="Invite QR code" className="qr" src={inviteQr} />
                ) : null}
              </div>
            ) : null}
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
              {joinRequest ? (
                <button
                  className="button flex-1"
                  disabled={busy}
                  onClick={() => void handleApproveJoin()}
                  type="button"
                >
                  <Check size={16} /> Approve
                </button>
              ) : null}
            </div>
            {capsuleOutput ? <CopyBox value={capsuleOutput} /> : null}
          </Panel>

          <Panel title="WebRTC Mesh" icon={<RadioTower size={17} />}>
            <button
              className="button w-full"
              disabled={busy || !selectedGroup}
              onClick={() => void handleCreateOffer()}
              type="button"
            >
              <RadioTower size={16} /> Create peer offer
            </button>
            <textarea
              className="textarea mt-2"
              onChange={(event) => setSignalInput(event.target.value)}
              placeholder="Paste WebRTC offer or answer"
              value={signalInput}
            />
            <button
              className="button mt-2 w-full"
              disabled={busy || !signalInput.trim()}
              onClick={() => void handleImportSignal()}
              type="button"
            >
              <KeyRound size={16} /> Accept signal
            </button>
            {signalOutput ? <CopyBox value={signalOutput} /> : null}
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
