import { supabase } from './supabase';

/**
 * Supabase Storage buckets (created by papeterie_supabase_full.sql):
 *  - `store-assets`    public  — factory logo, document stamps
 *  - `product-images`  public  — pictures of raw materials / finished paper
 *  - `documents`       private — scanned invoices, delivery notes, receipts
 */
export type BucketName = 'store-assets' | 'product-images' | 'documents';

/**
 * Uploads an image and returns its public URL. When the bucket is not
 * reachable the file is returned as a data URL so the screen keeps working.
 */
export async function uploadImage(bucket: BucketName, file: File, folder = ''): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${folder ? folder.replace(/\/+$/, '') + '/' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (!error) {
    if (bucket === 'documents') {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) return data.signedUrl;
    }
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  console.warn(`[storage] ${bucket}: ${error.message} — image gardée en ligne (data URL)`);
  return readAsDataUrl(file);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
