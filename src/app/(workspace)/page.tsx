import { ChatWorkspace } from "@/features/translation/chat-workspace";

export default async function Home({ searchParams }: { searchParams: Promise<{ history?: string }> }) {
  const { history } = await searchParams;
  return <ChatWorkspace historyId={history} />;
}
