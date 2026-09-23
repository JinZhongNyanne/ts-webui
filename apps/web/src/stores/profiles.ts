import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { UserProfile } from "@jinz/protocol";
import { useTsStore } from "./ts";
import { assetToken, hasAssetToken } from "../ts/asset-token";
import { useVoiceStore } from "./voice";
import { playThroughMixer } from "../audio/useVoice";
import { clearDraft, loadDrafts, saveDraft, type ProfileDraft } from "./profileDraft";

export type ProfileAsset = "icon" | "sound";

/** Mirrors the hub's ASSET_RULES; used for client-side validation messages. */
export const ASSET_LIMITS: Record<ProfileAsset, { accept: string; maxBytes: number }> = {
  icon: { accept: "image/png,image/jpeg,image/gif,image/webp", maxBytes: 512 * 1024 },
  sound: { accept: "audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4", maxBytes: 1024 * 1024 },
};

/**
 * Everyone's own avatar icon and channel-entry sound, stored on the hub and
 * keyed by TeamSpeak UID. The list arrives over HTTP on connect; later changes
 * (by anyone) arrive as `profile.updated` over the websocket.
 *
 * Own assets can be chosen before connecting: the hub has no UID to attach them
 * to yet, so they are kept as a local draft, previewed from that draft, and
 * uploaded automatically once a session exists.
 */
export const useProfilesStore = defineStore("profiles", () => {
  const ts = useTsStore();
  const voice = useVoiceStore();
  /** uid -> revisions; null revision means "no such asset". */
  const byUid = reactive(new Map<string, UserProfile>());
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** Assets picked while offline, still waiting for a session to upload through. */
  const drafts = reactive(new Map<ProfileAsset, { url: string; type: string }>());
  const draftBlobs = new Map<ProfileAsset, Blob>();
  const pending = computed(() => drafts.size > 0);

  void restoreDrafts();

  async function restoreDrafts(): Promise<void> {
    for (const draft of await loadDrafts()) keepDraft(draft, false);
  }

  function keepDraft(draft: ProfileDraft, persist = true): void {
    const previous = drafts.get(draft.asset);
    if (previous) URL.revokeObjectURL(previous.url);
    draftBlobs.set(draft.asset, draft.blob);
    drafts.set(draft.asset, { url: URL.createObjectURL(draft.blob), type: draft.type });
    if (persist) void saveDraft(draft);
  }

  function dropDraft(asset: ProfileAsset): void {
    const draft = drafts.get(asset);
    if (draft) URL.revokeObjectURL(draft.url);
    drafts.delete(asset);
    draftBlobs.delete(asset);
    void clearDraft(asset);
  }

  function apply(profile: UserProfile): void {
    if (profile.icon === null && profile.sound === null) byUid.delete(profile.uid);
    else byUid.set(profile.uid, profile);
  }

  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/profiles", { headers: { "x-session-id": ts.sessionId } });
      if (!res.ok) return;
      const data = (await res.json()) as { profiles: UserProfile[] };
      byUid.clear();
      for (const p of data.profiles) apply(p);
    } catch {
      /* hub not reachable; icons simply stay unset */
    }
  }

  /**
   * The hub only serves profile assets to a live session, so the URL carries
   * the short-lived asset token like the TeamSpeak icon URLs do.
   */
  function assetUrl(uid: string, asset: ProfileAsset): string | null {
    const rev = byUid.get(uid)?.[asset];
    if (!rev || !hasAssetToken.value) return null;
    const token = encodeURIComponent(assetToken());
    return `/api/profile/${asset}?uid=${encodeURIComponent(uid)}&rev=${rev}&token=${token}`;
  }

  function iconUrl(uid: string): string | null {
    return assetUrl(uid, "icon");
  }

  function hasSound(uid: string): boolean {
    return Boolean(byUid.get(uid)?.sound);
  }

  /** Our own asset: the local draft wins, so a fresh pick previews immediately. */
  function ownUrl(asset: ProfileAsset): string | null {
    const draft = drafts.get(asset);
    if (draft) return draft.url;
    const uid = ts.selfClient?.uid;
    return uid ? assetUrl(uid, asset) : null;
  }

  /**
   * Plays an entry sound through the voice mixer, so the hearing-protection
   * limiter catches a clip mastered too loud. Before the audio engine runs
   * there is no mixer, and a plain <audio> at the output volume stands in.
   */
  async function playSound(url: string): Promise<void> {
    if (await playThroughMixer(url)) return;
    if (ts.selfClient?.outputMuted) return;
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, voice.master));
    void audio.play().catch(() => undefined);
  }

  /** Plays a user's entry sound, if they set one. */
  function playEntrySound(uid: string): void {
    const url = uid && uid === ts.selfClient?.uid ? ownUrl("sound") : assetUrl(uid, "sound");
    if (url) void playSound(url);
  }

  /** Plays our own entry sound (draft or uploaded) for the settings preview. */
  function playOwnSound(): void {
    const url = ownUrl("sound");
    if (url) void playSound(url);
  }

  async function send(asset: ProfileAsset, body: Blob, type: string): Promise<boolean> {
    const res = await fetch(`/api/profile/${asset}`, {
      method: "POST",
      headers: { "x-session-id": ts.sessionId, "content-type": type },
      body,
    });
    if (!res.ok) {
      error.value = res.status === 415 ? "bad-type" : res.status === 413 ? "too-large" : "failed";
      return false;
    }
    apply((await res.json()) as UserProfile);
    return true;
  }

  async function upload(asset: ProfileAsset, file: File): Promise<void> {
    error.value = null;
    if (file.size > ASSET_LIMITS[asset].maxBytes) {
      error.value = "too-large";
      return;
    }
    // Offline: keep it locally and let the connect watcher push it up later.
    if (!ts.sessionId) {
      keepDraft({ asset, blob: file, type: file.type, name: file.name });
      return;
    }
    busy.value = true;
    try {
      if (await send(asset, file, file.type)) dropDraft(asset);
    } catch {
      error.value = "failed";
    } finally {
      busy.value = false;
    }
  }

  /** Uploads whatever was picked while offline. Called once a session exists. */
  async function flushDrafts(): Promise<void> {
    if (!ts.sessionId || draftBlobs.size === 0) return;
    busy.value = true;
    try {
      for (const [asset, blob] of [...draftBlobs]) {
        const type = drafts.get(asset)?.type ?? blob.type;
        try {
          if (await send(asset, blob, type)) dropDraft(asset);
        } catch {
          error.value = "failed";
        }
      }
    } finally {
      busy.value = false;
    }
  }

  async function remove(asset: ProfileAsset): Promise<void> {
    error.value = null;
    dropDraft(asset);
    if (!ts.sessionId) return;
    busy.value = true;
    try {
      const res = await fetch(`/api/profile/${asset}`, {
        method: "DELETE",
        headers: { "x-session-id": ts.sessionId },
      });
      if (res.ok) apply((await res.json()) as UserProfile);
    } catch {
      error.value = "failed";
    } finally {
      busy.value = false;
    }
  }

  // The hub pushes every profile change to every session, so a single fetch on
  // connect plus these updates keeps the whole roster in sync.
  watch(
    () => ts.connState,
    async (state) => {
      if (state !== "connected") return;
      await refresh();
      await flushDrafts();
    },
    { immediate: true },
  );
  watch(
    () => ts.profileUpdates,
    (profile) => {
      if (profile) apply(profile);
    },
  );
  watch(
    () => ts.lastEntry,
    (entry) => {
      if (entry) playEntrySound(entry.uid);
    },
  );

  return {
    byUid,
    busy,
    error,
    pending,
    drafts,
    apply,
    refresh,
    iconUrl,
    assetUrl,
    ownUrl,
    hasSound,
    playEntrySound,
    playOwnSound,
    upload,
    remove,
  };
});
