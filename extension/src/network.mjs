export async function requestJson(url, options = {}, timeoutMs = 45_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal });
    let data;
    try { data = await response.json(); }
    catch {
      if (signal.aborted) throw new Error("The request timed out. Please try again.");
      throw new Error(`Invalid server response (HTTP ${response.status}). Check that Phrasebook is running.`);
    }
    if (!response.ok) throw new Error(data?.error || `Request failed (HTTP ${response.status})`);
    return data;
  } catch (error) {
    if (signal.aborted) throw new Error("The request timed out. Please try again.");
    if (error instanceof TypeError) throw new Error("Cannot connect to Phrasebook. Check your connection and run npm run dev if using localhost.");
    throw error;
  }
}
