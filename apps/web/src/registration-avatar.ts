export async function registrationAvatarData(file: File) {
  if (
    !file ||
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  )
    throw Error("Chọn ảnh đại diện PNG/JPEG tối đa 2 MB.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw Error("Ảnh đại diện không đọc được; chọn ảnh PNG/JPEG khác.");
  });
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192)
      throw Error("Ảnh đại diện quá lớn.");
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Chưa đọc được ảnh đại diện.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  } finally {
    bitmap.close();
  }
}
