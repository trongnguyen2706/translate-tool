export async function requestJson(url, options = {}, timeoutMs = 45_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    let data;
    try { data = await response.json(); }
    catch {
      if (signal.aborted) throw new Error("Yêu cầu quá thời gian chờ. Hãy thử lại.");
      throw new Error(`Máy chủ trả dữ liệu không hợp lệ (HTTP ${response.status}). Kiểm tra web Phrasebook đang chạy.`);
    }
    if (!response.ok) throw new Error(data?.error || `Yêu cầu thất bại (HTTP ${response.status})`);
    return data;
  } catch (error) {
    if (signal.aborted) throw new Error("Yêu cầu quá thời gian chờ. Hãy thử lại.");
    if (error instanceof TypeError) throw new Error("Không kết nối được web Phrasebook. Kiểm tra mạng và chạy npm run dev nếu đang dùng localhost.");
    throw error;
  }
}
