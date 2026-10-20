export type DictionarySense = {
  id?: string; partOfSpeech?: string; sourceTerm?: string; ipa?: string; glossLanguage?: string;
  definitions?: string[]; examples?: string[]; synonyms?: string[]; antonyms?: string[]; collocations?: string[];
};
export function lookupExtensionDictionary(term: string, mode: string): Promise<{ senses: DictionarySense[]; dataVersion: string }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Open the extension, configure this web address and download the selected dictionary, then refresh this page.")); }, 8000);
    function cleanup() { clearTimeout(timer); window.removeEventListener("message", receive); }
    function receive(event: MessageEvent) {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== "phrasebook-dictionary-v1" || data.type !== "result" || data.id !== id) return;
      cleanup();
      if (!data.response?.ok) { reject(new Error(data.response?.error ?? "Dictionary unavailable")); return; }
      const result = data.response.data;
      if (result.missingPack) { reject(new Error("Download this dictionary from the extension first.")); return; }
      resolve({ senses: result.result?.senses ?? [], dataVersion: result.dataVersion ?? "" });
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: "phrasebook-dictionary-v1", type: "lookup", id, term, mode }, location.origin);
  });
}
