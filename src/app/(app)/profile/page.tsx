"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, format, formatDistanceStrict } from "date-fns";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";

type MeResponse = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  isDemo: boolean;
  timezone: string;
  created_at: string;
  updated_at: string;
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const AVATAR_SIZE = 256;
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return format(date, "MMMM d, yyyy");
}

function formatUsageDuration(iso: string, now = new Date()): string {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return "Unknown";
  const days = Math.max(0, differenceInCalendarDays(now, start));
  if (days === 0) return "Started today";
  if (days === 1) return "1 day";
  return formatDistanceStrict(start, now, { addSuffix: false });
}

async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("Use a JPEG, PNG, WebP, or GIF image");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image must be under 8 MB");
  }

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");

  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  if (dataUrl.length > 400_000) {
    throw new Error("Image is still too large after compression");
  }
  return dataUrl;
}

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void api<MeResponse>("/api/auth/me")
      .then(setMe)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Could not load profile")
      );
  }, []);

  const displayName =
    me?.full_name?.trim() || me?.email.split("@")[0] || "Your profile";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

  async function saveAvatar(avatarUrl: string | null) {
    setUploading(true);
    try {
      const updated = await api<Omit<MeResponse, "isDemo">>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ avatar_url: avatarUrl }),
      });
      setMe((prev) =>
        prev
          ? {
              ...prev,
              avatar_url: updated.avatar_url,
              updated_at: updated.updated_at,
            }
          : prev
      );
      router.refresh();
      toast.success(avatarUrl ? "Profile photo updated" : "Profile photo removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update photo");
    } finally {
      setUploading(false);
    }
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await saveAvatar(dataUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read image");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize your photo and see your LifePilot account history.
        </p>
      </header>

      <section
        className="lp-glass animate-fade-up rounded-2xl border p-5"
        style={{ animationDelay: "40ms" }}
      >
        {!me ? (
          <p className="text-sm text-muted-foreground">Loading profile…</p>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-3 sm:items-start">
              <div className="lp-nav-avatar relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-white">
                {me.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={me.avatar_url}
                    alt={`${displayName}'s profile`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => void onFileChange(event)}
              />
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {me.avatar_url ? (
                    <Camera className="h-3.5 w-3.5" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {uploading
                    ? "Saving…"
                    : me.avatar_url
                      ? "Change photo"
                      : "Add photo"}
                </Button>
                {me.avatar_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl text-muted-foreground"
                    disabled={uploading}
                    onClick={() => void saveAvatar(null)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="max-w-[16rem] text-center text-xs text-muted-foreground sm:text-left">
                Upload a photo from your device. JPEG, PNG, WebP, or GIF up to 8 MB.
              </p>
            </div>

            <div className="min-w-0 flex-1 space-y-1 pt-1">
              <h2 className="truncate text-lg font-semibold tracking-tight">{displayName}</h2>
              <p className="truncate text-sm text-muted-foreground">{me.email}</p>
              <p className="text-xs text-muted-foreground">
                {me.isDemo ? "Local account" : "Cloud account"} · {me.timezone}
              </p>
            </div>
          </div>
        )}
      </section>

      <section
        className="lp-glass animate-fade-up rounded-2xl border p-5"
        style={{ animationDelay: "80ms" }}
      >
        <h2 className="text-sm font-semibold">History with LifePilot</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Account timeline only — not your tasks or checklists.
        </p>

        {!me ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading history…</p>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="lp-glass-soft rounded-xl border px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Started
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {formatJoinedDate(me.created_at)}
              </dd>
            </div>
            <div className="lp-glass-soft rounded-xl border px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Using LifePilot
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {formatUsageDuration(me.created_at)}
              </dd>
            </div>
            <div className="lp-glass-soft rounded-xl border px-4 py-3 sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Profile last updated
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {formatJoinedDate(me.updated_at)}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
