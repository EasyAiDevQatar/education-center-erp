"use client";

import { AssistantChat } from "@/components/assistant-chat";

export function AssistantClient({ ready }: { ready: boolean }) {
  return <AssistantChat ready={ready} />;
}
