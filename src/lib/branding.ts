import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { signedUrl } from "@/lib/storage";

export interface Branding {
  id: string;
  ref_no: string | null;
  name: string;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  address: string | null;
  vat_number: string | null;
  license_no: string | null;
  commercial_registration: string | null;
  primary_color: string;
  secondary_color: string;
  header_text: string | null;
  footer_text: string | null;
  signature_name: string | null;
  signature_title: string | null;
  show_logo_in_reports: boolean;
  show_contact_in_reports: boolean;
  show_stamp_in_reports: boolean;
  logo_path: string | null;
  stamp_path: string | null;
  logoUrl: string | null;
  stampUrl: string | null;
}

/** هوية الشركة الحالية فقط (يُمرَّر معرّف الشركة النشطة للمستخدم، وRLS يمنع غيرها). */
export async function loadBranding(supabase: SupabaseClient, orgId: string): Promise<Branding | null> {
  const { data } = await supabase.from("companies")
    .select("id, ref_no, name, legal_name, phone, email, website, city, address, vat_number, license_no, commercial_registration, primary_color, secondary_color, header_text, footer_text, signature_name, signature_title, show_logo_in_reports, show_contact_in_reports, show_stamp_in_reports, logo_path, stamp_path")
    .eq("id", orgId).maybeSingle();
  if (!data) return null;
  const [logoUrl, stampUrl] = await Promise.all([
    data.show_logo_in_reports ? signedUrl(supabase, "org-branding", data.logo_path, 600) : null,
    data.show_stamp_in_reports ? signedUrl(supabase, "org-branding", data.stamp_path, 600) : null,
  ]);
  return { ...data, logoUrl, stampUrl } as Branding;
}
