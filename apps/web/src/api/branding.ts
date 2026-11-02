import { apiRequest } from "./client";

export type { BrandingAccent } from "@flaremo/contracts";

export type BrandingInfo = {
  product: string;
  accent: string;
  accent_hex?: string | null;
  mark_light_url: string | null;
  mark_dark_url: string | null;
  favicon_url?: string | null;
  favicon_content_type?: string | null;
};

export type AdminBranding = {
  product_name: string | null;
  accent: string;
  accent_hex: string | null;
  mark_light_url: string | null;
  mark_dark_url: string | null;
  favicon_url: string | null;
  favicon_content_type: string | null;
};

export type BrandingMarkVariant = "light" | "dark";
export type BrandingAssetKind = BrandingMarkVariant | "favicon";

async function brandingErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Public branding, readable without a session (login page, shared memos). */
export async function getPublicBranding(): Promise<BrandingInfo | null> {
  try {
    const response = await fetch("/api/app/branding");
    if (!response.ok) return null;
    return (await response.json()) as BrandingInfo;
  } catch {
    return null;
  }
}

export async function getAdminBranding() {
  return apiRequest<AdminBranding>("/api/app/admin/branding");
}

export async function updateAdminBrandingProductName(
  product_name: string | null,
) {
  return apiRequest<{ product: string; accent: string }>(
    "/api/app/admin/branding",
    {
      method: "PUT",
      body: JSON.stringify({ product_name }),
    },
  );
}

export async function updateAdminBrandingAccent(
  accent: string | null,
  accent_hex?: string | null,
) {
  return apiRequest<{
    product: string;
    accent: string;
    accent_hex: string | null;
  }>("/api/app/admin/branding", {
    method: "PUT",
    body: JSON.stringify({ accent, accent_hex: accent_hex ?? null }),
  });
}

export async function uploadAdminBrandingMark(
  variant: BrandingMarkVariant,
  file: File,
) {
  const bytes = await file.arrayBuffer();
  const response = await fetch(`/api/app/admin/branding/marks/${variant}`, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(
      await brandingErrorMessage(response, "Failed to upload the logo."),
    );
  }
  return (await response.json()) as { saved: boolean; variant: string };
}

export async function clearAdminBrandingMark(variant: BrandingMarkVariant) {
  const response = await fetch(`/api/app/admin/branding/marks/${variant}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      await brandingErrorMessage(response, "Failed to remove the logo."),
    );
  }
  return (await response.json()) as { removed: boolean; variant: string };
}

export async function uploadAdminBrandingFavicon(file: File) {
  const bytes = await file.arrayBuffer();
  const response = await fetch("/api/app/admin/branding/favicon", {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(
      await brandingErrorMessage(
        response,
        "Failed to upload the favicon. Supported: png, webp, svg, ico.",
      ),
    );
  }
  return (await response.json()) as { saved: boolean };
}

export async function clearAdminBrandingFavicon() {
  const response = await fetch("/api/app/admin/branding/favicon", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      await brandingErrorMessage(response, "Failed to remove the favicon."),
    );
  }
  return (await response.json()) as { removed: boolean };
}
