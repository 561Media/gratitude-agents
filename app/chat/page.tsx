"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import { MenuButton, useMobileNav } from "@/components/MobileNav";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const nav = useMobileNav();

  async function handleSelectConversation(id: string) {
    setConversationId(id);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setMessages(
      data.messages?.map((m: Message) => ({
        role: m.role,
        content: m.content,
      })) || []
    );
  }

  function handleNewChat() {
    setConversationId(null);
    setMessages([]);
  }

  async function handleDeleteConversation(id: string) {
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (res.ok) {
      // If we deleted the active conversation, clear the chat
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        conversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        mobileOpen={nav.open}
        onMobileClose={nav.closeNav}
      />

      <ChatInterface
        key={conversationId || "new"}
        menuButton={<MenuButton nav={nav} />}
        agentId="gratitude"
        conversationId={conversationId}
        onConversationCreated={setConversationId}
        messages={messages}
        setMessages={setMessages}
      />
    </div>
  );
}
