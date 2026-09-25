import type { Metadata } from "next";
import { PreferencesProvider } from "@/components/preferences-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phrasebook — Dịch và học từ",
  description: "Dịch nhanh từ ảnh hoặc văn bản, lưu từ và cụm từ để học."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('phrasebook-theme')==='dark'?'dark':'light'}catch{}" }} /></head><body><PreferencesProvider>{children}</PreferencesProvider></body></html>;
}
